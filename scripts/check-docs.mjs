#!/usr/bin/env node
/**
 * The blocking documentation gate. Wire it into the host project's quality gate
 * as `lint:docs`.
 *
 * Six assertions, each of which can only fire on a real defect:
 *   1. frontmatter present and parseable on every document outside the exempt list
 *   2. closed vocabularies — `status` in its set, `title`/`updated` present, no
 *      `kind` field (kind is derived from the path), status agrees with the tier
 *      in BOTH directions, `implements` names a file that exists
 *   3. path hygiene — kebab-case directories, kebab or ALL-CAPS basenames
 *   4. index freshness — regenerate in memory, compare with what is committed
 *   5. no dead `.md` links, inside the docs tree and from every tracked file
 *      outside it
 *   6. `status: superseded` implies a `superseded_by` whose target exists
 *
 * What it deliberately does NOT check — document age, prose style, whether
 * `code:` targets still exist, whether `updated:` matches git — is argued in
 * reference/design.md section 5.3 and reported by check-docs-advisory.mjs.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { parseFrontmatter } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { isExempt, kindForPath, pathHygieneErrors, reservedStatuses, statusForKind } from './docs-taxonomy.mjs'
import { listDocs, repoRoot } from './docs-fs.mjs'
import { renderIndex } from './gen-docs-index.mjs'

/**
 * @param {string} root repo root
 * @returns {{file: string, field: string, message: string}[]}
 */
export function checkDocs(root, config = loadConfig(root)) {
  const violations = []
  const add = (file, field, message) => violations.push({ file, field, message })
  const reserved = reservedStatuses(config)

  for (const path of listDocs(root, config)) {
    // 3. path hygiene — the check that makes `Tracking & Attribution` unrepeatable
    for (const message of pathHygieneErrors(path)) add(path, 'path', message)

    if (isExempt(config, path)) continue

    const source = readFileSync(join(root, path), 'utf8')
    const { data, body, present } = parseFrontmatter(source)

    // 1. frontmatter present
    if (!present) {
      add(path, 'frontmatter', 'missing — every doc outside the exempt list needs a `---` block')
      continue
    }

    // 2. closed vocabularies, and status agrees with the tier
    for (const field of ['title', 'status', 'updated']) {
      if (!data[field]) add(path, field, 'required field is missing or empty')
    }
    if (data.kind) {
      add(path, 'kind', 'kind is derived from the path — remove this field')
    }
    if (data.status && !config.statuses.includes(data.status)) {
      add(path, 'status', `"${data.status}" is not one of ${config.statuses.join(' | ')}`)
    }
    const tier = kindForPath(config, path)
    const forced = statusForKind(config, tier)
    if (forced && data.status && data.status !== forced) {
      add(path, 'status', `is "${data.status}" but everything under ${config.docsDir}/${tierPrefix(config, tier)} is status: ${forced}`)
    }
    const owner = data.status ? reserved.get(data.status) : undefined
    if (owner && tier !== owner) {
      add(path, 'status', `\`${data.status}\` is reserved for ${config.docsDir}/${tierPrefix(config, owner)} — move the file or fix the status`)
    }
    if (data.updated && !/^\d{4}-\d{2}-\d{2}$/.test(data.updated)) {
      add(path, 'updated', `"${data.updated}" is not an ISO date`)
    }

    // 2b. `implements` is optional, but when present its file half must exist
    if (data.implements) {
      const target = data.implements.split('#')[0]
      if (!existsSync(join(root, target))) {
        add(path, 'implements', `points at "${target}", which does not exist`)
      }
    }

    // 6. superseded implies a live superseded_by
    if (data.status === 'superseded') {
      if (!data.superseded_by) add(path, 'superseded_by', 'required when status is `superseded`')
      else if (!existsSync(join(root, data.superseded_by))) {
        add(path, 'superseded_by', `points at "${data.superseded_by}", which does not exist`)
      }
    }

    // 5a. dead links inside the doc body — relative, or root-relative `<docsDir>/...`
    for (const target of markdownLinks(body)) {
      const resolved = target.startsWith(`${config.docsDir}/`)
        ? target
        : relative(root, resolve(join(root, dirname(path)), target)).split(/[\\/]/).join('/')
      if (!existsSync(join(root, resolved))) add(path, 'link', `dead link -> ${target}`)
    }
  }

  // 5b. every `<docsDir>/*.md` path referenced from a tracked file OUTSIDE the
  // docs tree (code, AGENTS.md, workflows, scripts) must exist. Doc bodies are
  // covered by 5a link syntax; bare prose mentions inside the tree stay
  // unchecked because historical plans legitimately narrate old paths.
  for (const target of trackedDocRefs(root, config)) {
    if (!existsSync(join(root, target))) {
      add('(repo)', 'link', `a tracked file references ${target}, which does not exist — git grep -l '${target}'`)
    }
  }

  // 4. index freshness — regenerate in memory, compare with what is committed
  for (const [path, content] of renderIndex(root, config)) {
    const current = existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null
    if (current !== content) add(path, 'index', 'stale — run `bun run gen:docs-index`')
  }

  return violations
}

/** The configured path prefix of a tier kind, for error messages. */
function tierPrefix(config, kind) {
  return config.tiers.find(([, k]) => k === kind)?.[0] ?? `${kind}/`
}

/**
 * `.md` targets of inline Markdown links: relative or root-relative `<docsDir>/...`.
 * Skips http(s), mailto, anchors and absolute paths.
 */
function markdownLinks(body) {
  const out = []
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || !target.endsWith('.md')) continue
    if (/^([a-z]+:)?\/\//i.test(target) || target.startsWith('mailto:') || target.startsWith('/')) continue
    out.push(target)
  }
  return out
}

/**
 * Every `<docsDir>/....md` string in tracked files outside the docs tree. Uses
 * `git grep`; in a non-git tree (the test fixtures) it falls back to scanning
 * AGENTS.md and CLAUDE.md, the two highest-value pointer files.
 */
export function trackedDocRefs(root, config = loadConfig(root)) {
  const dir = config.docsDir
  const pattern = new RegExp(`${dir}/[A-Za-z0-9._\\-/]+\\.md`, 'g')
  try {
    const out = execFileSync(
      'git',
      [
        'grep', '-Ioh', '-E', `${dir}/[A-Za-z0-9._/-]+\\.md`, '--',
        `:(exclude)${dir}`,
        ...config.referenceScanExclude.map((path) => `:(exclude)${path}`),
      ],
      { cwd: root, encoding: 'utf8' },
    )
    return new Set(out.match(pattern) ?? [])
  } catch (error) {
    if (error.status === 1) return new Set() // git grep: no matches
    // Outside a git repo (the test fixtures) fall back silently; any OTHER git
    // failure degrades the scan and must not look like a thorough run.
    if (!`${error.stderr ?? ''}${error.message}`.includes('not a git repository')) {
      console.warn(`check-docs: git grep failed (${error.message.split('\n')[0]}) — scanning only AGENTS.md/CLAUDE.md`)
    }
    const refs = new Set()
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      const file = join(root, name)
      if (!existsSync(file)) continue
      for (const ref of readFileSync(file, 'utf8').match(pattern) ?? []) refs.add(ref)
    }
    return refs
  }
}

const PRINT_CAP = 100

function main() {
  const violations = checkDocs(repoRoot())
  const cap = process.argv.includes('--all') ? Infinity : PRINT_CAP
  if (violations.length === 0) {
    console.log('check-docs: OK')
    process.exit(0)
  }
  for (const { file, field, message } of violations.slice(0, cap)) {
    console.error(`${file}:${field} — ${message}`)
  }
  if (violations.length > cap) console.error(`… and ${violations.length - cap} more`)
  console.error(`\ncheck-docs FAILED — ${violations.length} violation(s).`)
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
