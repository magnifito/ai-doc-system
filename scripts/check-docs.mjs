#!/usr/bin/env node
/**
 * The blocking documentation gate. Wire it into the host project's quality gate
 * as `lint:docs`.
 *
 * Nine assertions, each of which can only fire on a real defect:
 *   1. frontmatter present and parseable on every document outside the exempt list
 *   2. closed vocabularies — `status` in its set, `title`/`updated` present,
 *      status agrees with the tier in BOTH directions, `implements` names a
 *      file that exists
 *   3. path hygiene — kebab-case directories, kebab or ALL-CAPS basenames
 *   4. index freshness — regenerate in memory, compare with what is committed
 *   5. no dead `.md` links, inside the docs tree and from every tracked file
 *      outside it
 *   6. `status: superseded` implies a `superseded_by` whose target exists
 *   7. `kind` and `module` are PRESENT and agree with the path. They are stored
 *      as well as derived so a document read outside its tree still says what it
 *      is; this assertion is what makes the duplication safe
 *   8. per-kind required fields (config.requiredFields), closed vocabularies for
 *      optional scalars, every `evidence` entry a live path or a runnable
 *      command, and every `changes` target a live document of kind `state`
 *   9. no two documents in one tier (and module) share a basename — the naming
 *      rule stops the same name in two CASINGS; this stops it verbatim
 *
 * What it deliberately does NOT check — document age, prose style, whether
 * `code:` targets still exist, whether `updated:` matches git — is argued in
 * the design's section 5.3 (github.com/magnifito/ai-doc-system) and reported by
 * check-docs-advisory.mjs.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { parseFrontmatter } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { isExempt, kindForPath, moduleForPath, pathHygieneErrors, reservedStatuses, statusForKind } from './docs-taxonomy.mjs'
import { listDocs, repoRoot } from './docs-fs.mjs'
import { renderIndex } from './gen-docs-index.mjs'

/**
 * Evidence entries are the one field whose VALUE the gate inspects, because an
 * unevidenced claim is the failure this system exists to stop. An entry is
 * either a repository path (optionally `:line` or `:line-line`), which must
 * exist, or a command a reader can re-run. Free prose is rejected — "we checked
 * and it works" is exactly the claim that went stale unnoticed for six months.
 */
// Square brackets and parentheses are ordinary path characters in a Next.js
// tree — `app/api/booking/[calendarSlug]/route.ts`, `app/[locale]/(public)/…` —
// so a validator that rejects them rejects real evidence.
const EVIDENCE_PATH = /^([A-Za-z0-9._\-/[\]()@]+)(?::\d+(?:-\d+)?)?$/
const EVIDENCE_RUNNERS = ['bun', 'bunx', 'node', 'npm', 'npx', 'grep', 'ls', 'git', 'curl', 'psql']

function evidenceError(root, entry) {
  const first = entry.trim().split(/\s+/)[0]
  if (EVIDENCE_RUNNERS.includes(first)) return null
  const match = entry.trim().match(EVIDENCE_PATH)
  if (!match) {
    return `"${entry}" is not a path or a command — start it with ${EVIDENCE_RUNNERS.join('/')} or name a file`
  }
  if (!existsSync(join(root, match[1]))) return `"${entry}" names ${match[1]}, which does not exist`
  return null
}

/**
 * @param {string} root repo root
 * @returns {{file: string, field: string, message: string}[]}
 */
export function checkDocs(root, config = loadConfig(root)) {
  const violations = []
  const changeTargets = []
  const basenames = new Map()
  const add = (file, field, message) => violations.push({ file, field, message })
  const reserved = reservedStatuses(config)

  for (const path of listDocs(root, config)) {
    // 3. path hygiene — the check that makes `Tracking & Attribution` unrepeatable
    for (const message of pathHygieneErrors(path, config)) add(path, 'path', message)

    if (isExempt(config, path)) continue

    const source = readFileSync(join(root, path), 'utf8')
    const { data, body, present, error } = parseFrontmatter(source)

    // 1. frontmatter present
    if (!present) {
      add(path, 'frontmatter', 'missing — every doc outside the exempt list needs a `---` block')
      continue
    }

    if (error) {
      add(path, 'frontmatter', `is not valid YAML — ${error}`)
      continue
    }

    // 2. closed vocabularies, and status agrees with the tier
    for (const field of ['title', 'status', 'updated']) {
      if (!data[field]) add(path, field, 'required field is missing or empty')
    }

    // 7. `kind` and `module` are stored AND derived, and must agree. The
    // duplication is deliberate: a document is often read outside its tree, so
    // it has to say what it is. This assertion is what makes drift impossible.
    const pathKind = kindForPath(config, path)
    const pathModule = moduleForPath(config, path)

    if (!data.kind) add(path, 'kind', 'required field is missing or empty')
    else if (pathKind === null) {
      add(path, 'kind', `is "${data.kind}" but this path is under no tier — move the file`)
    } else if (data.kind !== pathKind) {
      add(path, 'kind', `is "${data.kind}" but its path implies "${pathKind}" — set kind: ${pathKind}`)
    }

    if (config.modules.length > 0) {
      if (!data.module) add(path, 'module', 'required field is missing or empty')
      else if (!config.moduleKeys.includes(data.module)) {
        add(path, 'module', `"${data.module}" is not a registered module — one of ${config.moduleKeys.join(' | ')}`)
      } else if (pathModule === null) {
        add(path, 'module', `is "${data.module}" but this path is in no module tree — move the file`)
      } else if (data.module !== pathModule) {
        add(path, 'module', `is "${data.module}" but its path implies "${pathModule}" — set module: ${pathModule}`)
      }
    }
    // 9. duplicate basenames within one tier and module. The naming half of
    // assertion 3 stops the same name in two casings; this stops it verbatim —
    // two `foo.md` in one tier is the duplicate-tree defect coming back.
    // Sentinels repeat by design (a README per area is their whole point).
    const base = path.split('/').pop()
    if (pathKind !== null && !config.sentinels.includes(base.replace(/\.md$/, ''))) {
      const key = `${pathKind}|${pathModule ?? ''}|${base.toLowerCase()}`
      const prior = basenames.get(key)
      if (prior) add(path, 'basename', `duplicate basename in one tier — ${prior} has the same name; rename one`)
      else basenames.set(key, path)
    }

    if (data.status && !config.statuses.includes(data.status)) {
      add(path, 'status', `"${data.status}" is not one of ${config.statuses.join(' | ')}`)
    }
    const tier = pathKind
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
    if (data.verified_on && !/^\d{4}-\d{2}-\d{2}$/.test(data.verified_on)) {
      add(path, 'verified_on', `"${data.verified_on}" is not an ISO date`)
    }

    // 8. per-kind required fields. Which kind demands what is configuration,
    // not a constant here, so three repositories can share this script.
    for (const field of config.requiredFields[pathKind] ?? []) {
      const value = data[field]
      if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
        add(path, field, `required on kind: ${pathKind}`)
      }
    }

    // 8a. closed vocabularies for optional scalars (commitment).
    for (const [field, allowed] of Object.entries(config.vocabularies)) {
      if (data[field] && !allowed.includes(data[field])) {
        add(path, field, `"${data[field]}" is not one of ${allowed.join(' | ')}`)
      }
    }

    // 8b. evidence entries are paths that exist, or commands.
    if (Array.isArray(data.evidence)) {
      for (const entry of data.evidence) {
        const message = evidenceError(root, entry)
        if (message) add(path, 'evidence', message)
      }
    }

    // 8c. `changes` names state documents. Deferred to a second pass because it
    // needs every document's kind, and this loop has only seen part of the tree.
    if (Array.isArray(data.changes)) {
      for (const target of data.changes) changeTargets.push({ path, target })
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
      if (!existsCaseExact(root, resolved)) add(path, 'link', `dead link -> ${target}`)
    }
  }

  // 8c, second pass. A `changes` target must exist AND be a reflection document;
  // a todo pointing at another todo describes no reality and can never close.
  for (const { path, target } of changeTargets) {
    if (!existsCaseExact(root, target)) {
      add(path, 'changes', `points at "${target}", which does not exist`)
      continue
    }
    const targetKind = kindForPath(config, target)
    if (targetKind !== 'state') {
      add(path, 'changes', `points at "${target}", which is kind "${targetKind ?? 'none'}" — changes must name state documents`)
    }
  }

  // 5b. every `<docsDir>/*.md` path referenced from a tracked file OUTSIDE the
  // docs tree (code, AGENTS.md, workflows, scripts) must exist. Doc bodies are
  // covered by 5a link syntax; bare prose mentions inside the tree stay
  // unchecked because historical plans legitimately narrate old paths.
  for (const target of trackedDocRefs(root, config)) {
    if (!existsCaseExact(root, target)) {
      add('(repo)', 'link', `a tracked file references ${target}, which does not exist — git grep -l '${target}'`)
    }
  }

  // 4. index freshness — regenerate in memory, compare with what is committed
  for (const [path, content] of renderIndex(root, config)) {
    const current = existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null
    if (current !== content) add(path, 'index', 'stale — run `node scripts/gen-docs-index.mjs`')
  }

  return violations
}

/**
 * `existsSync` with the case checked, because macOS and Windows resolve
 * `./FOO.md` to `foo.md` and would report a link as live after the file was
 * renamed. The same tree then fails on Linux. EVERY segment is checked against
 * its parent's real listing — a wrong-case directory in the middle of a link
 * is the same defect as a wrong-case basename.
 */
function existsCaseExact(root, repoRelative) {
  if (!existsSync(join(root, repoRelative))) return false
  let dir = root
  for (const segment of repoRelative.split('/')) {
    try {
      if (!readdirSync(dir).includes(segment)) return false
    } catch {
      return false
    }
    dir = join(dir, segment)
  }
  return true
}

/** The configured path prefix of a tier kind, for error messages. */
function tierPrefix(config, kind) {
  return config.tiers.find(([, k]) => k === kind)?.[0] ?? `${kind}/`
}

/**
 * `.md` targets of Markdown links: inline `[x](target)` and reference-style
 * definitions `[ref]: target` (checked at the definition, which covers every
 * use of the reference). Relative or root-relative `<docsDir>/...` only —
 * http(s), mailto, anchors and absolute paths are skipped.
 */
function markdownLinks(body) {
  const out = []
  const push = (raw) => {
    const target = raw.split('#')[0]
    if (!target || !target.endsWith('.md')) return
    if (/^([a-z]+:)?\/\//i.test(target) || target.startsWith('mailto:') || target.startsWith('/')) return
    out.push(target)
  }
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) push(match[1])
  for (const match of body.matchAll(/^\[[^\]]+\]:[ \t]+(\S+)/gm)) push(match[1])
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
