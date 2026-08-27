#!/usr/bin/env node
/**
 * ONE-SHOT migration: moves every document into the tiered tree, stamps
 * frontmatter on it, and rewrites every tracked reference to a moved path.
 * Run once per project, review the result, then DELETE the migration map. This
 * script is not part of the gate.
 *
 * Usage:
 *   node scripts/migrate-docs.mjs --dry-run [--map <file>]
 *   node scripts/migrate-docs.mjs --apply   [--map <file>]
 *
 * The map is per-project and you must write it — it is the one part of this
 * system that cannot be shared, because it encodes where THIS project's
 * documents go. Default location: `docs-migration.map.mjs` at the repo root.
 * See templates/docs-migration.map.example.mjs. It exports:
 *
 *   destinationFor(path, helpers) -> new repo-relative path, or null for
 *                                    "a human must decide"
 *   ROOT_STRAYS                   -> array of root-level files to report, untouched
 *   SKIP                          -> optional array of path prefixes to leave alone
 *
 * Derivation rules for the frontmatter it stamps:
 *   title    first `# ` heading, else the destination's filename stem
 *   kind     what the DESTINATION path implies — stamped here so the gate's
 *            kind/module assertion passes on the migration commit itself
 *   module   same, when the project declares modules
 *   status   the tier's forced status (config.tierStatus) when it has one,
 *            else `defaultStatus` from the map, else `active`
 *   updated  git log -1 for the file
 *
 * A file that ALREADY has frontmatter keeps its block verbatim; only missing
 * required fields are appended to it. The block is never re-rendered from
 * parsed data — values the parser flattens (nested keys) must not be destroyed.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { firstHeading, parseFrontmatter, renderFrontmatter } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { kindForPath, moduleForPath, normalizeSegment, slugify, statusForKind } from './docs-taxonomy.mjs'
import { lastCommitDate, listDocs, repoRoot } from './docs-fs.mjs'

const DEFAULT_MAP = 'docs-migration.map.mjs'

function flagValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1]
}

async function loadMap(root) {
  const given = flagValue('--map') ?? DEFAULT_MAP
  const file = isAbsolute(given) ? given : resolve(root, given)
  if (!existsSync(file)) {
    console.error(
      `No migration map at ${file}.\n` +
        'Copy templates/docs-migration.map.example.mjs to your repo root and edit it —\n' +
        'the map encodes where THIS project\'s documents go and cannot be shared.',
    )
    process.exit(2)
  }
  const loaded = await import(pathToFileURL(file).href)
  if (typeof loaded.destinationFor !== 'function') {
    console.error(`${file} must export a destinationFor(path, helpers) function.`)
    process.exit(2)
  }
  return loaded
}

function statusFor(config, map, destination) {
  const forced = statusForKind(config, kindForPath(config, destination))
  if (forced) return forced
  for (const [prefix, status] of Object.entries(map.STATUS_BY_PREFIX ?? {})) {
    if (destination.startsWith(prefix)) return status
  }
  return map.defaultStatus ?? 'active'
}

/** Preserve an existing frontmatter block; append only the missing required fields. */
function stampedContent(parsed, meta, body) {
  if (!parsed.present) return renderFrontmatter(meta) + body.replace(/^\n+/, '\n')
  const missing = ['title', 'kind', 'module', 'status', 'updated']
    .filter((key) => meta[key] && !parsed.data[key])
    .map((key) => `${key}: ${meta[key]}`)
  return `---\n${[parsed.raw, ...missing].join('\n')}\n---\n${body.replace(/^\n+/, '\n')}`
}

/**
 * Rewrite every occurrence of a moved path in the tracked tree — code comments,
 * AGENTS.md, workflows, hooks, doc bodies. Candidates come from `git grep -Il`
 * (all tracked text files, extensionless ones included, binaries skipped), so
 * the set matches what check-docs assertion 5b will later scan. Root-relative
 * paths only; relative links that cross tiers are caught by check-docs after.
 *
 * `config.referenceScanExclude` is honoured here as well, and it has to be:
 * those paths name documents that deliberately do not exist — most importantly
 * THIS SYSTEM'S OWN TEST FIXTURES, which build throwaway trees under the default
 * tier map. Rewriting a fixture's `docs/engineering/x.md` to wherever the host
 * project moved that file leaves the suite asserting against a path its own
 * configuration puts under no tier, and the tests fail for a reason that has
 * nothing to do with the migration.
 *
 * With `write: false` it only reports which files WOULD change (--dry-run).
 */
function rewriteReferences(root, config, mapping, skip, { write }) {
  let candidates
  try {
    candidates = execFileSync(
      'git',
      ['grep', '-Il', '-E', `${config.docsDir}/[A-Za-z0-9._/-]+\\.md`],
      { cwd: root, encoding: 'utf8' },
    ).split('\n')
  } catch (error) {
    if (error.status !== 1) throw error
    candidates = [] // no tracked file references a docs path
  }
  const changed = []
  const excluded = [...skip, ...(config.referenceScanExclude ?? [])]
  for (const file of candidates) {
    if (!file || excluded.some((prefix) => file.startsWith(prefix))) continue
    const full = join(root, file)
    if (!existsSync(full)) continue
    const before = readFileSync(full, 'utf8')
    let content = before
    for (const [from, to] of mapping) content = content.split(from).join(to)
    if (content !== before) {
      if (write) writeFileSync(full, content)
      changed.push(file)
    }
  }
  return changed
}

/**
 * Move one document, preferring `git mv` so `git log --follow` keeps working.
 *
 * An UNTRACKED file — a document written but not yet committed, which is normal
 * mid-change — makes `git mv` fail with "not under version control". There is no
 * history to follow for such a file, so a plain rename is exactly equivalent and
 * the migration must not abort halfway through the tree because of one.
 */
function move(root, from, to) {
  try {
    execFileSync('git', ['mv', from, to], { cwd: root, stdio: 'pipe' })
  } catch (error) {
    const detail = `${error.stderr ?? ''}`
    if (!detail.includes('not under version control')) throw error
    renameSync(join(root, from), join(root, to))
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const root = repoRoot()
  const config = loadConfig(root)
  const map = await loadMap(root)
  const skip = map.SKIP ?? []
  const helpers = { config, slugify, normalizeSegment, kindForPath }
  const rows = []
  const unmapped = []

  for (const path of listDocs(root, config)) {
    if (skip.some((prefix) => path.startsWith(prefix))) continue
    const destination = map.destinationFor(path, helpers)
    if (!destination) {
      unmapped.push(path)
      continue
    }
    const parsed = parseFrontmatter(readFileSync(join(root, path), 'utf8'))
    const kind = kindForPath(config, destination)
    const moduleKey = config.modules.length > 0 ? moduleForPath(config, destination) : null
    const meta = {
      title: parsed.data.title ?? firstHeading(parsed.body) ?? destination.split('/').pop().replace(/\.md$/, ''),
      // Derived from the DESTINATION: the gate requires both fields and asserts
      // they agree with the path, so the migration commit must pass on its own.
      ...(kind ? { kind } : {}),
      ...(moduleKey ? { module: moduleKey } : {}),
      status: parsed.data.status ?? statusFor(config, map, destination),
      updated: parsed.data.updated ?? lastCommitDate(root, path),
      ...(parsed.data.implements ? { implements: parsed.data.implements } : {}),
      ...(parsed.data.code ? { code: parsed.data.code } : {}),
      ...(parsed.data.superseded_by ? { superseded_by: parsed.data.superseded_by } : {}),
    }
    rows.push({ path, destination, meta, parsed })
  }

  // No two sources may land on the same destination, and no destination may
  // already be occupied by a file that is not its own source. Checked BEFORE
  // the first `git mv`, so a defective map cannot leave the tree half-migrated.
  // Deliberately over-cautious: a move CHAIN (a -> b while b -> c) also aborts,
  // although ordering could satisfy it — aborting beats guessing an order.
  const seen = new Map()
  const collisions = []
  for (const { path, destination } of rows) {
    if (seen.has(destination)) collisions.push(`${destination} <- ${seen.get(destination)} AND ${path}`)
    seen.set(destination, path)
    if (path !== destination && existsSync(join(root, destination))) {
      collisions.push(`${destination} already exists (moving ${path})`)
    }
  }
  if (collisions.length > 0) {
    console.error('destination collisions — nothing was touched:')
    for (const line of collisions) console.error(`  ${line}`)
    process.exit(1)
  }

  const moved = rows.filter(({ path, destination }) => path !== destination)
  const mapping = moved.map(({ path, destination }) => [path, destination])
  const strays = (map.ROOT_STRAYS ?? []).filter((path) => existsSync(join(root, path)))

  if (!apply) {
    process.stdout.write('from\tto\tkind\tstatus\tupdated\ttitle\n')
    for (const { path, destination, meta } of rows) {
      process.stdout.write(
        `${path}\t${destination}\t${kindForPath(config, destination) ?? ''}\t${meta.status}\t${meta.updated}\t${meta.title}\n`,
      )
    }
    for (const path of [...unmapped, ...strays]) process.stdout.write(`${path}\tNEEDS-HUMAN\t\t\t\t\n`)
    const wouldRewrite = rewriteReferences(root, config, mapping, skip, { write: false })
    console.error(`\n${rows.length} mapped, ${unmapped.length} unmapped, ${strays.length} root strays`)
    console.error(`would rewrite references in ${wouldRewrite.length} tracked files:`)
    for (const file of wouldRewrite) console.error(`  ${file}`)
    return
  }

  for (const { path, destination, meta, parsed } of rows) {
    if (path !== destination) {
      mkdirSync(join(root, dirname(destination)), { recursive: true })
      move(root, path, destination)
    }
    writeFileSync(join(root, destination), stampedContent(parsed, meta, parsed.body))
  }
  const rewritten = rewriteReferences(root, config, mapping, skip, { write: true })
  console.log(
    `migrated ${rows.length} documents (${moved.length} moved), rewrote references in ${rewritten.length} tracked files`,
  )
  if (unmapped.length + strays.length > 0) {
    console.log('\nNEEDS A HUMAN — not touched:')
    for (const path of [...unmapped, ...strays]) console.log(`  ${path}`)
  }
}

await main()
