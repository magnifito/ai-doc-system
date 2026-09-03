#!/usr/bin/env node
/**
 * `ai-doc-system mv <from> <to>` — the mechanical half of the promotion
 * lifecycle: `git mv`, restamp `kind`/`module`, set the status the destination
 * tier implies, record `promoted_from`, regenerate the index. The prose
 * rewrite that promotion demands stays a human step; `promoted_from` is what
 * lets the gate check (with --base) that it happened.
 *
 * Status on arrival: the destination tier's forced status when it has one;
 * otherwise `--status` when given; otherwise `draft` when leaving `reference`;
 * otherwise the status the document already had.
 *
 * Usage: node scripts/mv-doc.mjs <from.md> <to.md> [--status <status>]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseFrontmatter, patchScalar } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { kindForPath, moduleForPath, pathHygieneErrors, statusForKind } from './docs-taxonomy.mjs'
import { today } from './docs-dates.mjs'
import { repoRoot } from './docs-fs.mjs'
import { writeIndex } from './gen-docs-index.mjs'
import { runDirect } from './docs-run.mjs'

/**
 * @returns {{ from: string, to: string, restamped: { kind: string, module: string|null, status: string } }}
 */
export function mvDoc(root, from, to, { status, now } = {}, config = loadConfig(root)) {
  if (!existsSync(join(root, from))) throw new Error(`${from} does not exist`)
  if (existsSync(join(root, to))) throw new Error(`${to} already exists`)
  const hygiene = pathHygieneErrors(to, config)
  if (hygiene.length > 0) throw new Error(`${to}: ${hygiene[0]}`)
  const kind = kindForPath(config, to)
  if (kind === null) throw new Error(`${to} is under no tier`)
  const moduleKey = config.modules.length > 0 ? moduleForPath(config, to) : null
  const { data, raw, body, present } = parseFrontmatter(readFileSync(join(root, from), 'utf8'))
  if (!present) throw new Error(`${from} has no frontmatter — add it first`)
  const fromKind = kindForPath(config, from)
  const forced = statusForKind(config, kind)
  const nextStatus = forced ?? status ?? (fromKind === 'reference' ? 'draft' : data.status)
  if (!config.statuses.includes(nextStatus)) {
    throw new Error(`"${nextStatus}" is not one of ${config.statuses.join(' | ')}`)
  }

  mkdirSync(join(root, dirname(to)), { recursive: true })
  try {
    execFileSync('git', ['mv', from, to], { cwd: root, stdio: 'pipe' })
  } catch (error) {
    // A document that git does not track yet is still a document; only that
    // failure falls back to a plain rename, so a real git error still surfaces.
    if (!`${error.stderr ?? ''}`.includes('not under version control')) throw error
    renameSync(join(root, from), join(root, to))
  }
  let patched = patchScalar(raw, 'kind', kind, ['summary', 'title'])
  if (moduleKey) patched = patchScalar(patched, 'module', moduleKey, ['kind'])
  patched = patchScalar(patched, 'status', nextStatus, ['module', 'kind'])
  patched = patchScalar(patched, 'updated', today(now), ['status'])
  if (fromKind !== kind) {
    patched = patchScalar(patched, 'promoted_from', from, ['superseded_by', 'source_url', 'code', 'updated'])
  }
  writeFileSync(join(root, to), `---\n${patched}\n---\n${body}`)
  writeIndex(root, config)
  return { from, to, restamped: { kind, module: moduleKey, status: nextStatus } }
}

function flagValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

/**
 * The `.md` positionals, in order. Flags consume the argument after them, and
 * the leading command word (`mv`, when dispatched through `cli/cli.mjs`) is
 * not a path — so a document is recognised by its extension, not its position.
 */
function docPaths() {
  const args = process.argv.slice(2)
  const out = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith('--')) index += 1
    else if (args[index].endsWith('.md')) out.push(args[index])
  }
  return out
}

export function main() {
  const [from, to] = docPaths()
  if (!from || !to) {
    console.error('usage: ai-doc-system mv <from.md> <to.md> [--status <status>]')
    process.exit(2)
  }
  try {
    const { restamped } = mvDoc(repoRoot(), from, to, { status: flagValue('--status') })
    console.log(`moved ${from} -> ${to} (kind ${restamped.kind}, status ${restamped.status})`)
    console.log('Now rewrite the prose to describe this product; promoted_from records where it came from.')
  } catch (error) {
    console.error(`mv: ${error.message}`)
    process.exit(1)
  }
}

if (runDirect(import.meta.url)) main()
