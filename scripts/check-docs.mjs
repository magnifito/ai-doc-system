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
 *      command, every `changes` target a live document of kind `state`, and a
 *      warning when path evidence drifted from the hash `verify` locked
 *   9. no two documents in one tier (and module) share a basename — the naming
 *      rule stops the same name in two CASINGS; this stops it verbatim
 *
 * Two more assertions need history, so they run ONLY with `--base <ref>`, and
 * only over the documents this branch changed since it forked from that ref:
 *  10. `transition` — a document's `status` moved along an allowed edge of
 *      TRANSITIONS, compared against the document's origin at the merge base
 *      (`promoted_from`, else a rename git detected, else its own path)
 *  11. `promoted-verbatim` — a promotion is a real promotion: `promoted_from`
 *      named a document that existed at the base and is gone from the tree now,
 *      a cross-tier move records `promoted_from` at all, and the body is not
 *      the origin's prose word for word
 *
 * Two more are dependency staleness. They need no history and never block —
 * they are `warn` by default, because a stale document is a thing to go fix,
 * not a reason to refuse a commit:
 *  12. `upstream` — a document's `implements` target carries an `updated` later
 *      than the document's own, so the thing it derives from moved on without it
 *  13. `review` — `review_by` is in the past
 *
 * What it deliberately does NOT check — document age, prose style, whether
 * `code:` targets still exist, whether `updated:` matches git — is argued in
 * the design's section 5.3 (github.com/magnifito/ai-doc-system) and reported by
 * check-docs-advisory.mjs.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { runDirect } from './docs-run.mjs'
import { flagValues } from './docs-args.mjs'
import { EVIDENCE_PATH, LIST_FIELDS, SCALAR_FIELDS, parseFrontmatter } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { isIsoDate, today } from './docs-dates.mjs'
import { isExempt, kindForPath, moduleForPath, pathHygieneErrors, reservedStatuses, statusForKind } from './docs-taxonomy.mjs'
import { changedPaths, existsCaseExact, listDocs, mergeBase, refExists, renamedFrom, repoRoot, showAtRef, showLastInRange, touchedInRange } from './docs-fs.mjs'
import { renderIndex } from './gen-docs-index.mjs'
import { LOCK_FILE, LOCK_UNREADABLE, hashEvidence, parsePathEvidence, readLock } from './verify-docs.mjs'

/**
 * Evidence entries are the one field whose VALUE the gate inspects, because an
 * unevidenced claim is the failure this system exists to stop. An entry is
 * either a repository path (optionally `:line` or `:line-line`), which must
 * exist, or a command a reader can re-run. Free prose is rejected — "we checked
 * and it works" is exactly the claim that went stale unnoticed for six months.
 */
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
 * The status graph. An edge is a move a document may make on its own: a
 * reference can be picked up as a draft, a draft can be adopted, an adopted
 * document ships or is sent back to draft, and anything can be superseded.
 * `superseded` is terminal — a retired document is replaced, not revived.
 * Statuses a project adds to the vocabulary are not in this map and are never
 * checked; the gate has no opinion about a graph it was not given.
 */
export const TRANSITIONS = {
  reference: ['draft', 'superseded'],
  draft: ['active', 'superseded'],
  active: ['shipped', 'superseded', 'draft'],
  shipped: ['superseded'],
  superseded: [],
}

/**
 * @param {string} root repo root
 * @param {object} [config] resolved configuration; loaded from `root` by default
 * @param {{base?: string, now?: Date}} [options] `base` is a git ref the tree is
 *   compared against — without it the git-aware assertions do not run at all
 * @returns {{rule: string, file: string, field: string, message: string, severity: string}[]}
 */
export function checkDocs(root, config = loadConfig(root), options = {}) {
  const violations = []
  const changeTargets = []
  const implementsPairs = []
  const updatedByPath = new Map()
  const basenames = new Map()
  const listings = new Map()
  const exists = (target) => existsCaseExact(root, target, listings)
  const add = (rule, file, field, message) => violations.push({ rule, file, field, message })
  const reserved = reservedStatuses(config)
  // Read once: every document's lock rows come out of the same file. A repo
  // that has never run `verify` has no lock, and no `evidence-lock` warnings.
  const lock = readLock(root, config)
  // 8e. a lock file the tool cannot parse. Reported rather than thrown: the
  // gate and both plugin hooks used to die on an unhandled SyntaxError from a
  // generated file no author edits by hand. It rides on `evidence-lock`, so a
  // project that has turned that rule off is not told about a file it does not
  // use, and one that has raised it to `error` is stopped by it.
  if (lock.error) add('evidence-lock', `${config.docsDir}/${LOCK_FILE}`, 'evidence-lock', LOCK_UNREADABLE)
  // The history-aware assertions resolve their ref ONCE, not once per document:
  // the merge base (what this branch forked from), the set of documents this
  // branch actually touched, and the renames git detected across that span.
  const baseSha = options.base ? mergeBase(root, options.base) : null
  // The branch's work is the diff from the fork PLUS what is not committed yet:
  // the base diff covers tracked files only, and a promotion made a minute ago
  // is still untracked — which is exactly when these rules have something
  // useful to say.
  const changed = options.base ? new Set([...changedPaths(root, options.base), ...changedPaths(root)]) : null
  const renames = options.base ? renamedFrom(root, baseSha) : null

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
    // 13. review — the date the author picked has arrived. Strictly past, so a
    // document reviewed today is not overdue on the day it was written.
    if (data.review_by && isIsoDate(data.review_by) && data.review_by < today(options.now)) {
      add('review', path, 'review_by', `${data.review_by} has passed — review the document and move or remove the date`)
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
      const locked = lock.entries[path] ?? {}
      for (const entry of data.evidence) {
        const message = evidenceError(entry, exists, config.evidenceRunners)
        if (message) {
          add('evidence', path, 'evidence', message)
          continue // a path that no longer exists is already the bigger defect
        }
        // 8d. evidence-lock — the entry still exists, but what it points at is
        // no longer what was verified. A warning: the code moving on is normal,
        // silently keeping the old `verified_on` is not.
        const parsed = locked[entry] ? parsePathEvidence(entry) : null
        if (!parsed) continue
        const current = hashEvidence(root, parsed)
        const fix = `run \`ai-doc-system verify --only ${path} --stamp\``
        // A null hash on a path the `evidence` check just passed means the file
        // shrank past the named line. That is drift, not "nothing to compare" —
        // reading it as the latter is how a claim outlives its evidence.
        if (current === null) {
          add('evidence-lock', path, 'evidence', `"${entry}" names a line past the end of the file since it was verified — ${fix}`)
        } else if (current !== locked[entry]) {
          add('evidence-lock', path, 'evidence', `"${entry}" changed since it was verified — ${fix}`)
        }
      }
    }

    // 8c. `changes` names state documents. Deferred to a second pass because it
    // needs every document's kind, and this loop has only seen part of the tree.
    if (Array.isArray(data.changes)) {
      for (const target of data.changes) changeTargets.push({ path, target })
    }

    // Every document's own `updated`, for the 12 pass below: the upstream half
    // of a pair may be read after the document that names it.
    updatedByPath.set(path, data.updated)

    // 2b. `implements` is optional, but when present its file half must exist
    if (data.implements) {
      const target = data.implements.split('#')[0]
      if (!exists(target)) {
        add('implements', path, 'implements', `points at "${target}", which does not exist`)
      }
      implementsPairs.push({ path, target, updated: data.updated })
    }

    // 6. superseded implies a live superseded_by
    if (data.status === 'superseded') {
      if (!data.superseded_by) add('superseded', path, 'superseded_by', 'required when status is `superseded`')
      else if (!exists(data.superseded_by)) {
        add('superseded', path, 'superseded_by', `points at "${data.superseded_by}", which does not exist`)
      }
    }

    // 10 and 11, history-aware. Only documents this branch changed are judged:
    // a document untouched since the fork is base's business, not this branch's,
    // and judging it would keep failing for ever after the branch merges.
    if (options.base && changed.has(path)) {
      // The origin this document came from: what it says (`promoted_from`),
      // else what git saw (a rename), else itself. Rename detection pairs
      // TRACKED entries only, so a plain `mv` that has not been staged is
      // unpaired and the document is simply judged against its own path.
      const renamedOrigin = renames.get(path)
      const originPath = data.promoted_from ?? renamedOrigin ?? path
      // Only a move that changed the document's AUTHORITY is a promotion. A
      // same-tier rename changes a filename and nothing else — demanding a
      // rewrite of prose that stayed true is noise.
      const crossedTier = originPath !== path && kindForPath(config, originPath) !== kindForPath(config, path)
      const before = showAtRef(root, baseSha, originPath)
      if (data.promoted_from) {
        // An origin the BRANCH created and then moved away never existed at the
        // base, and saying so would reject this tool's own output: `new` a
        // reference document and `mv` it to product on one branch and the origin
        // is born and gone between the two ends of the diff. So this fires only
        // when the origin existed NOWHERE in the branch's history — not at the
        // merge base, not in the uncommitted work (`changed`), and in no commit
        // since the fork. The last of the three is the only one that survives
        // committing the promotion: a two-point diff cannot see a path that is
        // absent at both ends. A `promoted_from` the branch never touched at all
        // is still the typo this check exists for.
        if (
          before === null &&
          !changed.has(data.promoted_from) &&
          !touchedInRange(root, baseSha, 'HEAD', data.promoted_from)
        ) {
          add('promoted-verbatim', path, 'promoted_from', `names ${data.promoted_from}, which did not exist at ${options.base}`)
        }
        // A promotion is a move. Both copies alive means the tree now claims the
        // same material at two authority levels, and readers cannot tell which
        // one binds.
        if (exists(data.promoted_from)) {
          add('promoted-verbatim', path, 'promoted_from', `names ${data.promoted_from}, which still exists — promotion is a move`)
        }
      } else if (renamedOrigin && crossedTier) {
        // Crossing a tier boundary IS promotion, whether or not the author
        // called it that: the document's authority changed and the trail of
        // where the prose came from has to survive the move.
        add('promoted-verbatim', path, 'promoted_from', `moved from ${renamedOrigin} across tiers without promoted_from — add promoted_from: ${renamedOrigin}`)
      }
      // 10. transition, against the merge base and nothing else. What the
      // document's status was at the fork is the only "before" this branch can
      // be held to; a status the branch itself set on the way here is its own
      // work, not an edge it has to justify.
      if (before !== null) {
        const prior = parseFrontmatter(before)
        const from = prior.data.status
        const to = data.status
        // Statuses outside the default vocabulary belong to the project and are
        // not checked: the gate has no opinion about a graph it was not given.
        if (from && to && from !== to && from in TRANSITIONS && to in TRANSITIONS && !TRANSITIONS[from].includes(to)) {
          add('transition', path, 'status', `${from} -> ${to} is not an allowed transition — allowed from ${from}: ${TRANSITIONS[from].join(', ') || 'nothing'}`)
        }
      }
      // 11. promotion without a rewrite is the failure the reference tier
      // exists to prevent: someone else's prose, wearing this product's
      // authority. The prose to compare against is the origin at the merge
      // base; when the branch itself captured the origin there is no copy
      // there, so it is read from the last commit that held it. A capture and a
      // promotion in one branch must still rewrite the prose.
      if (data.promoted_from || crossedTier) {
        const priorSource = before ?? showLastInRange(root, baseSha, 'HEAD', originPath)
        const where = before === null ? 'before this branch moved it' : `at ${options.base}`
        if (priorSource !== null && parseFrontmatter(priorSource).body.trim() === body.trim()) {
          add('promoted-verbatim', path, 'promoted_from', `body is identical to ${originPath} ${where} — rewrite the prose to describe this product`)
        }
      }
    }

    // shipped-code: the convention is that a shipped document points at its
    // implementation. The GATE reports it, at `warn` — the advisory pass has no
    // part in it — because a blocking rule here would invite placeholder paths
    // (design sections 4.3 and 5.2).
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

  // 12, second pass. Both dates come from the tree, so this needs every
  // document's `updated` and cannot run inside the loop. A target outside the
  // docs tree has no `updated` to compare and is silently skipped; ISO dates
  // sort lexically, which is why the comparison is a plain string one.
  for (const { path, target, updated } of implementsPairs) {
    const upstream = updatedByPath.get(target)
    if (upstream && updated && isIsoDate(upstream) && isIsoDate(updated) && upstream > updated) {
      add('upstream', path, 'updated', `${target} was updated ${upstream}, after this document (${updated}) — re-read it and bump updated`)
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
    .replace(/(^|[\s"'([<])\.\//g, '$1')
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
      // stderr is captured, not inherited: outside a git repository (the test
      // fixtures) git's `fatal: not a git repository` is an expected answer
      // here, and letting it through would print into every test run.
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
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

/**
 * GitHub workflow commands are line-oriented, and every part of an annotation
 * below is author-written frontmatter: a value carrying a newline would end the
 * command mid-message and leave the rest as an orphan log line, and one
 * carrying `,` or `:` inside a property would forge a property. The runner's
 * documented escaping is percent-encoding — `%` first, so it cannot re-encode
 * the escapes that follow it.
 * https://docs.github.com/actions/reference/workflow-commands-for-github-actions
 */
export function escapeData(value) {
  return `${value}`.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

/** `escapeData` plus the two characters that delimit a property list. */
export function escapeProperty(value) {
  return escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C')
}

export function main() {
  const root = repoRoot()
  // Both value flags are read BEFORE anything else runs, `--json` included: a
  // command line the gate cannot parse has no output contract to honour yet,
  // and a `--base` that silently vanished is a gate reporting green on rules it
  // never ran.
  const flags = flagValues('check', process.argv, ['--base', '--format'])
  const base = flags['--base']
  // A base that does not resolve is refused rather than ignored. On a shallow
  // CI checkout `origin/main` is often not fetched, and quietly dropping the
  // git-aware rules would report a green gate that checked less than it says.
  if (base && !refExists(root, base)) {
    console.error(`check-docs: base ref "${base}" does not resolve — fetch it or omit --base`)
    process.exit(2)
  }
  const violations = checkDocs(root, undefined, { base })
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

  const format = flags['--format'] ?? 'text'
  if (format === 'github') {
    for (const violation of violations) {
      const level = violation.severity === 'error' ? 'error' : 'warning'
      // `(repo)` is the pseudo-file of the cross-tree reference scan: there is
      // no line for Actions to annotate, so the property is left off entirely.
      const file = violation.file === '(repo)' ? '' : `file=${escapeProperty(violation.file)},`
      const body = `${escapeData(violation.field)} — ${escapeData(violation.message)}`
      process.stdout.write(`::${level} ${file}title=${escapeProperty(violation.rule)}::${body}\n`)
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
