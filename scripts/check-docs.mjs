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
import { runDirect } from './docs-run.mjs'
import { LIST_FIELDS, SCALAR_FIELDS, parseFrontmatter } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { isIsoDate } from './docs-dates.mjs'
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

function evidenceError(entry, exists, runners) {
  const first = entry.trim().split(/\s+/)[0]
  if (runners.includes(first)) return null
  const match = entry.trim().match(EVIDENCE_PATH)
  if (!match) {
    return `"${entry}" is not a path or a command — start it with ${runners.join('/')} or name a file`
  }
  // A trailing slash is legitimate for directory evidence; `exists` checks
  // every segment against its parent listing, so it is stripped first.
  if (!exists(match[1].replace(/\/$/, ''))) return `"${entry}" names ${match[1]}, which does not exist`
  return null
}

/**
 * @param {string} root repo root
 * @param {object} [config] resolved configuration; loaded from `root` by default
 * @param {{base?: string, now?: Date}} [options] reserved for the git-aware and
 *   date-aware assertions; ignored here
 * @returns {{rule: string, file: string, field: string, message: string, severity: string}[]}
 */
export function checkDocs(root, config = loadConfig(root), options = {}) {
  const violations = []
  const changeTargets = []
  const basenames = new Map()
  const listings = new Map()
  const exists = (target) => existsCaseExact(root, target, listings)
  const add = (rule, file, field, message) => violations.push({ rule, file, field, message })
  const reserved = reservedStatuses(config)

  for (const path of listDocs(root, config)) {
    // 3. path hygiene — the check that makes `Tracking & Attribution` unrepeatable
    for (const message of pathHygieneErrors(path, config)) add('path', path, 'path', message)

    if (isExempt(config, path)) continue

    const source = readFileSync(join(root, path), 'utf8')
    const { data, body, present, error } = parseFrontmatter(source)

    // 1. frontmatter present
    if (!present) {
      add('frontmatter', path, 'frontmatter', 'missing — every doc outside the exempt list needs a `---` block')
      continue
    }

    if (error) {
      add('frontmatter', path, 'frontmatter', `is not valid YAML — ${error}`)
      continue
    }

    // 1a. SHAPE, before anything reads a value. YAML lets any field be written
    // as a list or a map, and the checks below — plus the index renderers —
    // call `.split`, `.replace` and `join()` on these. Report the wrong shape
    // once here and DELETE the key, so every downstream check sees the field as
    // absent rather than crashing on it. A dropped `title` then also reports
    // `required`, which is the right answer: a map is not a title.
    for (const field of SCALAR_FIELDS) {
      if (field in data && typeof data[field] !== 'string') {
        add('vocabulary', path, field, 'must be a single value, not a list or a map')
        delete data[field]
      }
    }
    for (const field of LIST_FIELDS) {
      if (field in data && !Array.isArray(data[field])) {
        add(field, path, field, 'must be a list')
        delete data[field]
      }
    }

    // 2. closed vocabularies, and status agrees with the tier
    for (const field of ['title', 'status', 'updated']) {
      if (!data[field]) add('required', path, field, 'required field is missing or empty')
    }

    // 7. `kind` and `module` are stored AND derived, and must agree. The
    // duplication is deliberate: a document is often read outside its tree, so
    // it has to say what it is. This assertion is what makes drift impossible.
    const pathKind = kindForPath(config, path)
    const pathModule = moduleForPath(config, path)

    if (!data.kind) add('required', path, 'kind', 'required field is missing or empty')
    else if (pathKind === null) {
      add('vocabulary', path, 'kind', `is "${data.kind}" but this path is under no tier — move the file`)
    } else if (data.kind !== pathKind) {
      add('vocabulary', path, 'kind', `is "${data.kind}" but its path implies "${pathKind}" — set kind: ${pathKind}`)
    }

    if (config.modules.length > 0) {
      if (!data.module) add('required', path, 'module', 'required field is missing or empty')
      else if (!config.moduleKeys.includes(data.module)) {
        add('vocabulary', path, 'module', `"${data.module}" is not a registered module — one of ${config.moduleKeys.join(' | ')}`)
      } else if (pathModule === null) {
        add('vocabulary', path, 'module', `is "${data.module}" but this path is in no module tree — move the file`)
      } else if (data.module !== pathModule) {
        add('vocabulary', path, 'module', `is "${data.module}" but its path implies "${pathModule}" — set module: ${pathModule}`)
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
      if (prior) add('basename', path, 'basename', `duplicate basename in one tier — ${prior} has the same name; rename one`)
      else basenames.set(key, path)
    }

    if (data.status && !config.statuses.includes(data.status)) {
      add('vocabulary', path, 'status', `"${data.status}" is not one of ${config.statuses.join(' | ')}`)
    }
    const tier = pathKind
    const forced = statusForKind(config, tier)
    if (forced && data.status && data.status !== forced) {
      add('vocabulary', path, 'status', `is "${data.status}" but everything under ${config.docsDir}/${tierPrefix(config, tier)} is status: ${forced}`)
    }
    const owner = data.status ? reserved.get(data.status) : undefined
    if (owner && tier !== owner) {
      add('vocabulary', path, 'status', `\`${data.status}\` is reserved for ${config.docsDir}/${tierPrefix(config, owner)} — move the file or fix the status`)
    }
    if (data.updated && !isIsoDate(data.updated)) {
      add('date', path, 'updated', `"${data.updated}" is not an ISO date`)
    }
    if (data.verified_on && !isIsoDate(data.verified_on)) {
      add('date', path, 'verified_on', `"${data.verified_on}" is not an ISO date`)
    }

    // 2a. the optional authority fields. `summary` is the one line the index
    // shows, so it must be a line: an empty value is a half-written field, and
    // a multi-line block would break the generated table.
    // Shape is already settled above, so `summary` is a string or absent here.
    if ('summary' in data) {
      if (data.summary.trim() === '') {
        add('summary', path, 'summary', 'is present but empty — write one line or remove the field')
      } else if (data.summary.includes('\n')) {
        add('summary', path, 'summary', 'must be one line')
      }
    }
    if (data.source_url && !/^https?:\/\/\S+$/.test(data.source_url)) {
      add('source-url', path, 'source_url', `"${data.source_url}" is not an http(s) URL`)
    }
    if (data.review_by && !isIsoDate(data.review_by)) {
      add('date', path, 'review_by', `"${data.review_by}" is not an ISO date`)
    }

    // 8. per-kind required fields. Which kind demands what is configuration,
    // not a constant here, so three repositories can share this script.
    for (const field of config.requiredFields[pathKind] ?? []) {
      const value = data[field]
      if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
        add('required', path, field, `required on kind: ${pathKind}`)
      }
    }

    // 8a. closed vocabularies for optional scalars (commitment).
    for (const [field, allowed] of Object.entries(config.vocabularies)) {
      if (data[field] && !allowed.includes(data[field])) {
        add('vocabulary', path, field, `"${data[field]}" is not one of ${allowed.join(' | ')}`)
      }
    }

    // 8b. evidence entries are paths that exist, or commands.
    if (Array.isArray(data.evidence)) {
      for (const entry of data.evidence) {
        const message = evidenceError(entry, exists, config.evidenceRunners)
        if (message) add('evidence', path, 'evidence', message)
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
      if (!exists(target)) {
        add('implements', path, 'implements', `points at "${target}", which does not exist`)
      }
    }

    // 6. superseded implies a live superseded_by
    if (data.status === 'superseded') {
      if (!data.superseded_by) add('superseded', path, 'superseded_by', 'required when status is `superseded`')
      else if (!exists(data.superseded_by)) {
        add('superseded', path, 'superseded_by', `points at "${data.superseded_by}", which does not exist`)
      }
    }

    // shipped-code: the convention is that a shipped document points at its
    // implementation. A warning, not an error — a blocking rule invites
    // placeholder paths (design section 4.3).
    if (data.status === 'shipped' && !data.code) add('shipped-code', path, 'code', 'status is `shipped` but no `code:` names the implementation')

    // 5a. dead links inside the doc body — relative, or root-relative `<docsDir>/...`
    for (const target of markdownLinks(body)) {
      const resolved = target.startsWith(`${config.docsDir}/`)
        ? target
        : relative(root, resolve(join(root, dirname(path)), target)).split(/[\\/]/).join('/')
      if (!exists(resolved)) add('link', path, 'link', `dead link -> ${target}`)
    }
  }

  // 8c, second pass. A `changes` target must exist AND be a reflection document;
  // a todo pointing at another todo describes no reality and can never close.
  for (const { path, target } of changeTargets) {
    if (!exists(target)) {
      add('changes', path, 'changes', `points at "${target}", which does not exist`)
      continue
    }
    const targetKind = kindForPath(config, target)
    if (targetKind !== 'state') {
      add('changes', path, 'changes', `points at "${target}", which is kind "${targetKind ?? 'none'}" — changes must name state documents`)
    }
  }

  // 5b. every `<docsDir>/*.md` path referenced from a tracked file OUTSIDE the
  // docs tree (code, AGENTS.md, workflows, scripts) must exist. Doc bodies are
  // covered by 5a link syntax; bare prose mentions inside the tree stay
  // unchecked because historical plans legitimately narrate old paths.
  for (const target of trackedDocRefs(root, config)) {
    if (!exists(target)) {
      add('link', '(repo)', 'link', `a tracked file references ${target}, which does not exist — git grep -l '${target}'`)
    }
  }

  // 4. index freshness — regenerate in memory, compare with what is committed.
  // CRLF is normalised first: git on Windows checks the LF index out as CRLF
  // (autocrlf), and that is the same content, not a stale file.
  for (const [path, content] of renderIndex(root, config)) {
    const current = existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null
    if (current?.replaceAll('\r\n', '\n') !== content) {
      add('index', path, 'index', 'stale — run `node scripts/gen-docs-index.mjs`')
    }
  }

  return applySeverity(config, violations)
}

/** Drop rules configured `off`, stamp the configured severity on the rest. */
export function applySeverity(config, violations) {
  const out = []
  for (const violation of violations) {
    const severity = config.rules?.[violation.rule] ?? 'error'
    if (severity === 'off') continue
    out.push({ ...violation, severity })
  }
  return out
}

/**
 * `existsSync` with the case checked, because macOS and Windows resolve
 * `./FOO.md` to `foo.md` and would report a link as live after the file was
 * renamed. The same tree then fails on Linux. EVERY segment is checked against
 * its parent's real listing — a wrong-case directory in the middle of a link
 * is the same defect as a wrong-case basename.
 */
function existsCaseExact(root, repoRelative, listings = new Map()) {
  if (!existsSync(join(root, repoRelative))) return false
  let dir = root
  for (const segment of repoRelative.split('/')) {
    // One readdir per directory per run, not per link — `listings` is shared
    // across every target checkDocs resolves.
    let names = listings.get(dir)
    if (!names) {
      try {
        names = new Set(readdirSync(dir))
      } catch {
        names = new Set()
      }
      listings.set(dir, names)
    }
    if (!names.has(segment)) return false
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
 * The root-relative `<docsDir>/....md` references in one blob of text, in the
 * order they appear. Two normalisations run first, and both branches of the
 * scan share them:
 *
 *   - URLs are removed. `github.com/owner/repo/blob/main/<docsDir>/x.md` names
 *     a path in SOME repository on the web, not one in this checkout.
 *   - a leading `./` is dropped, because `[x](./<docsDir>/x.md)` in a root
 *     README is an ordinary reference to this tree.
 *
 * What the lookbehind then excludes is everything that cannot be root-relative
 * here: `../<docsDir>/x.md`, `/<docsDir>/x.md`, `vendor/<docsDir>/x.md`.
 */
function docRefsIn(text, dir) {
  const plain = text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
    .replace(/(^|[\s"'(\[<])\.\//g, '$1')
  return plain.match(new RegExp(`(?<![\\w./-])${dir}/[A-Za-z0-9._\\-/]+\\.md`, 'g')) ?? []
}

/**
 * Every `<docsDir>/....md` string in tracked files outside the docs tree. Uses
 * `git grep`; in a non-git tree (the test fixtures) it falls back to scanning
 * AGENTS.md and CLAUDE.md, the two highest-value pointer files.
 */
export function trackedDocRefs(root, config = loadConfig(root)) {
  const dir = config.docsDir
  try {
    const out = execFileSync(
      'git',
      [
        // Whole matching lines, not `-o` matches: the surrounding characters are
        // exactly what `pattern` needs, so this stays a candidate filter only.
        'grep', '-Ih', '-E', `${dir}/[A-Za-z0-9._/-]+\\.md`, '--',
        `:(exclude)${dir}`,
        ...config.referenceScanExclude.map((path) => `:(exclude)${path}`),
      ],
      { cwd: root, encoding: 'utf8' },
    )
    return new Set(docRefsIn(out, dir))
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
      for (const ref of docRefsIn(readFileSync(file, 'utf8'), dir)) refs.add(ref)
    }
    return refs
  }
}

const PRINT_CAP = 100

/** The value after `name` on the command line, or null when it is absent. */
function flagValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1]
}

export function main() {
  const violations = checkDocs(repoRoot())
  const cap = process.argv.includes('--all') ? Infinity : PRINT_CAP
  // Warnings are advisory: they are always printed in full and never decide the
  // exit code, so a `warn` rule can be adopted before it is enforced.
  const errors = violations.filter((violation) => violation.severity === 'error')
  const warnings = violations.filter((violation) => violation.severity === 'warn')

  // Machine-readable modes come first, and each one owns the whole output: a
  // consumer parsing stdout must not have to strip the human report out of it.
  // Both carry warnings (with their severity) and both exit exactly as the text
  // mode would, so switching format never changes whether the gate blocks.
  if (process.argv.includes('--json')) {
    const report = { ok: errors.length === 0, errors: errors.length, warnings: warnings.length, violations }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    process.exit(errors.length === 0 ? 0 : 1)
  }

  const format = flagValue('--format') ?? 'text'
  if (format === 'github') {
    for (const violation of violations) {
      const level = violation.severity === 'error' ? 'error' : 'warning'
      // `(repo)` is the pseudo-file of the cross-tree reference scan: there is
      // no line for Actions to annotate, so the property is left off entirely.
      const file = violation.file === '(repo)' ? '' : `file=${violation.file},`
      process.stdout.write(`::${level} ${file}title=${violation.rule}::${violation.field} — ${violation.message}\n`)
    }
    process.exit(errors.length === 0 ? 0 : 1)
  }
  if (format !== 'text') {
    console.error(`usage: check --format text|github — "${format}" is not a format`)
    process.exit(2)
  }

  for (const { rule, file, field, message } of warnings) {
    console.error(`${file}:${field} — ${message} [${rule}, warn]`)
  }
  if (errors.length === 0) {
    console.log(warnings.length === 0 ? 'check-docs: OK' : `check-docs: OK (${warnings.length} warning(s))`)
    process.exit(0)
  }
  for (const { rule, file, field, message } of errors.slice(0, cap)) {
    console.error(`${file}:${field} — ${message} [${rule}]`)
  }
  if (errors.length > cap) console.error(`… and ${errors.length - cap} more`)
  console.error(`\ncheck-docs FAILED — ${errors.length} violation(s).`)
  process.exit(1)
}

if (runDirect(import.meta.url)) main()
