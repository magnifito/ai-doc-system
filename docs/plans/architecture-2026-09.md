---
title: "Architecture round 2026-09: rule engine, impact, verify, hooks, transitions, context packs, and the debt backlog"
summary: The 2026-09 build plan — rule engine, impact, verify, hooks, transitions, context packs.
kind: plan
status: active
updated: 2026-09-03
implements: docs/plans/debt.md
---

# Architecture round 2026-09 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every item in `docs/plans/debt.md` and land the seven approved architecture changes: rule engine with per-rule severity, reverse code index with an impact report, executable evidence, edit-time enforcement through plugin hooks, status-transition checks, dependency-based staleness, and context packs.

**Architecture:** The gate stays one function, `checkDocs(root, config, options)`, but every violation now carries a rule id and the config maps ids to a severity (`error`, `warn`, `off`). New commands are new scripts under `scripts/`, dispatched by `cli/cli.mjs`, each importable and each with a `main()`. The generated `index.json` gains a `by_code` reverse map. Plugin hooks under `hooks/` call the same scripts. Decision on the path-versus-frontmatter question: **`kind` stays derived from the path and stored in frontmatter** (the current design); the alternative is recorded as rejected alternative D in the design record.

**Tech Stack:** Node 20+, plain ESM, `node:test`, one dependency (`yaml`). No new dependencies.

## Global Constraints

- Node `>=20`. Plain ESM `.mjs`. No build step.
- Exactly one dependency: `yaml`. Adding another needs an issue first (CONTRIBUTING.md).
- Every behavior change lands with a test that failed before the change. Tests use `node:test` and throwaway fixture trees, following the helpers in `scripts/check-docs.test.mjs` (`fixture`, `run`, `doc`) and `scripts/cli.test.mjs` (`gitFixture`, `cli`).
- The repo dogfoods its gate: after every task, `npm test` passes, `npm run lint:docs` prints `check-docs: OK`, and if anything under `docs/` changed, `npm run gen:docs-index` ran in the same change.
- Code comments in English. Linter is oxlint only; never add ESLint anything.
- `index.json` and `INDEX.md` must regenerate byte-identically: plain codepoint sort, no `localeCompare`, LF only.
- Commit messages: `feat:` / `fix:` / `docs:` / `refactor:` / `test:`; end each commit message body with the line `Claude-Session: https://claude.ai/code/session_01GEAgt75tcCns9EJzdmC391`.
- Work on branch `feat/architecture-2026-09`. Never commit to `main`; it is protected and every change goes through a PR.
- Version bump to `1.3.0` and CHANGELOG entry happen in the last task only.

## File map

| File | Responsibility |
|---|---|
| `scripts/check-docs.mjs` | The gate. Gains rule ids, severity filtering, `--base`, `--json`, `--format github`, `--rules`. |
| `scripts/docs-config.mjs` | Config. Gains `rules`, `evidenceRunners`, `+` array extension, `RULES` default map. |
| `scripts/docs-frontmatter.mjs` | Gains `summary`, `source_url`, `review_by`, `promoted_from` in `FIELD_ORDER`; exports `patchScalar`. |
| `scripts/docs-fs.mjs` | Gains `lastCommitDates(root)` (one git walk), `changedPaths(root, base)`, `showAtRef(root, ref, path)`. |
| `scripts/docs-dates.mjs` | New. `isIsoDate(text)`, `today(now)`. |
| `scripts/gen-docs-index.mjs` | `index.json` gains `by_code`; entries gain `summary`, `source_url`, `review_by`. INDEX.md gains a summary column. |
| `scripts/check-docs-advisory.mjs` | Uses `lastCommitDates`; reports carry rule ids; honours `off`. |
| `scripts/new-doc.mjs` | New. `ai-doc-system new <path> [--title ...]`. |
| `scripts/mv-doc.mjs` | New. `ai-doc-system mv <from> <to>`. |
| `scripts/impact-docs.mjs` | New. `ai-doc-system impact [--base <ref>]`. |
| `scripts/verify-docs.mjs` | New. `ai-doc-system verify [--stamp] [--only <path>]`, `docs/evidence-lock.json`. |
| `scripts/context-docs.mjs` | New. `ai-doc-system context ...` and `ai-doc-system export --jsonl`. |
| `cli/cli.mjs` | Dispatch for the new commands. |
| `hooks/hooks.json`, `hooks/reference-read.mjs`, `hooks/docs-edit.mjs` | Plugin hooks. |
| `schema/docs-system.config.schema.json` | JSON Schema for the config file. |
| `docs/engineering/design.md`, `docs/engineering/adr/0001-store-kind-in-frontmatter.md`, `README.md`, `SKILL.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `templates/docs-README.template.md` | Documentation. |

Rule ids, used everywhere from Task 1 on:

| id | default | what |
|---|---|---|
| `frontmatter` | error | block present and parseable |
| `required` | error | `title`, `status`, `updated`, `kind`, `module`, per-kind `requiredFields` |
| `vocabulary` | error | closed sets for `status`, `commitment`, tier-status agreement |
| `date` | error | `updated`, `verified_on`, `review_by` are real ISO dates |
| `path` | error | hygiene and naming |
| `basename` | error | duplicate basename in one tier |
| `link` | error | dead links, in-tree and tracked-outside |
| `implements` | error | `implements` target exists |
| `superseded` | error | `superseded_by` present and exists |
| `evidence` | error | evidence entries are paths or commands |
| `changes` | error | `changes` targets are live `state` docs |
| `source-url` | error | `source_url` is `http(s)://` when present |
| `summary` | error | `summary` is a non-empty single line when present |
| `index` | error | generated files are fresh |
| `transition` | error | status moved along an allowed edge (only with `--base`) |
| `promoted-verbatim` | error | promoted body differs from its origin (only with `--base`) |
| `shipped-code` | warn | `status: shipped` has `code:` |
| `upstream` | warn | `implements` target updated after this doc |
| `review` | warn | `review_by` is in the past |

---

### Task 1: Rule ids and severity in the gate

**Files:**
- Modify: `scripts/docs-config.mjs`
- Modify: `scripts/check-docs.mjs`
- Test: `scripts/check-docs.test.mjs`, `scripts/docs-config.test.mjs`

**Interfaces:**
- Produces: every violation is `{ file, field, message, rule, severity }`. `checkDocs(root, config, options)` where `options = { base?: string, now?: string }` (used by later tasks). `config.rules` is `Record<ruleId, 'error'|'warn'|'off'>`. `export const RULES` in `docs-config.mjs` is the default map (table above). Exported `applySeverity(config, violations)` drops `off` and stamps `severity`.

- [ ] **Step 1: Failing config tests**

Append to `scripts/docs-config.test.mjs`:

```js
test('rules: defaults carry every known id at its default severity', () => {
  const config = withDerived(DEFAULTS)
  assert.equal(config.rules.link, 'error')
  assert.equal(config.rules['shipped-code'], 'warn')
})

test('rules: an override changes one severity and keeps the rest', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-config-'))
  writeFileSync(join(root, 'docs-system.config.json'), JSON.stringify({ rules: { basename: 'warn' } }))
  clearConfigCache()
  const config = loadConfig(root)
  assert.equal(config.rules.basename, 'warn')
  assert.equal(config.rules.link, 'error')
  rmSync(root, { recursive: true, force: true })
})

test('rules: an unknown id or severity is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-config-'))
  writeFileSync(join(root, 'docs-system.config.json'), JSON.stringify({ rules: { bogus: 'error' } }))
  clearConfigCache()
  assert.throws(() => loadConfig(root), /unknown rule "bogus"/)
  writeFileSync(join(root, 'docs-system.config.json'), JSON.stringify({ rules: { link: 'loud' } }))
  clearConfigCache()
  assert.throws(() => loadConfig(root), /severity "loud"/)
  rmSync(root, { recursive: true, force: true })
})
```

Check the file's existing imports; add `mkdtempSync`, `writeFileSync`, `rmSync`, `tmpdir`, `join`, `withDerived`, `DEFAULTS`, `clearConfigCache`, `loadConfig` if missing.

- [ ] **Step 2: Run, expect failure**

Run: `node --test scripts/docs-config.test.mjs`
Expected: 3 failures, `config.rules` undefined.

- [ ] **Step 3: Implement config side**

In `scripts/docs-config.mjs`, above `DEFAULTS`:

```js
/**
 * Every rule the gate and the advisory pass know, with its default severity.
 * `error` fails the gate, `warn` is printed and never fails, `off` is silent.
 * A project overrides one id at a time in `rules`; unknown ids are rejected so
 * a typo cannot silently leave a rule at its default.
 */
export const RULES = {
  frontmatter: 'error',
  required: 'error',
  vocabulary: 'error',
  date: 'error',
  path: 'error',
  basename: 'error',
  link: 'error',
  implements: 'error',
  superseded: 'error',
  evidence: 'error',
  changes: 'error',
  'source-url': 'error',
  summary: 'error',
  index: 'error',
  transition: 'error',
  'promoted-verbatim': 'error',
  'shipped-code': 'warn',
  upstream: 'warn',
  review: 'warn',
}
export const SEVERITIES = ['error', 'warn', 'off']
```

Add to `DEFAULTS`: `rules: {},`. In `loadConfig`, after `const merged = { ...DEFAULTS, ...overrides }`, set `merged.rules = { ...RULES, ...(overrides.rules ?? {}) }` before `validate`. In `validate`, add:

```js
  for (const [id, severity] of Object.entries(overrides.rules ?? {})) {
    if (!(id in RULES)) throw new Error(`${CONFIG_FILE}: unknown rule "${id}" — known rules are ${Object.keys(RULES).join(', ')}`)
    if (!SEVERITIES.includes(severity)) {
      throw new Error(`${CONFIG_FILE}: rule "${id}" has severity "${severity}" — expected ${SEVERITIES.join(' | ')}`)
    }
  }
```

In `withDerived`, keep `rules` as-is but guarantee `config.rules ?? { ...RULES }` so callers that build config from `DEFAULTS` directly (the tests do) still get the full map: `rules: { ...RULES, ...(config.rules ?? {}) },`.

- [ ] **Step 4: Failing gate tests**

Append to `scripts/check-docs.test.mjs`:

```js
test('11a. every violation carries a rule id and a severity', () => {
  const violations = run({ 'docs/engineering/x.md': '# No frontmatter\n' })
  assert.ok(violations.length > 0)
  for (const v of violations) {
    assert.equal(typeof v.rule, 'string')
    assert.ok(['error', 'warn'].includes(v.severity), `${v.rule} has severity ${v.severity}`)
  }
  assert.ok(violations.some((v) => v.rule === 'frontmatter' && v.severity === 'error'))
})

test('11b. a rule set to off produces no violation; warn keeps it but demotes it', () => {
  const files = {
    'docs/engineering/a.md': GOOD,
    'docs/engineering/b.md': doc({ title: 'B', kind: 'engineering', status: 'active', updated: '2026-08-17', implements: 'docs/nowhere.md' }),
  }
  const off = run(files, { config: { rules: { implements: 'off' } } })
  assert.ok(!off.some((v) => v.rule === 'implements'))
  const warn = run(files, { config: { rules: { implements: 'warn' } } })
  assert.ok(warn.some((v) => v.rule === 'implements' && v.severity === 'warn'))
})
```

`run(files, { config })` must pass the config to `checkDocs`: change `run` to `return checkDocs(root, options?.config ? withDerived({ ...DEFAULTS, ...options.config, rules: { ...RULES, ...(options.config.rules ?? {}) } }) : undefined)`. Import `RULES` from `./docs-config.mjs`. Check every existing call site of `run(files, { config })` still passes.

- [ ] **Step 5: Run, expect failure**

Run: `node --test scripts/check-docs.test.mjs`
Expected: 11a and 11b fail (`v.rule` undefined).

- [ ] **Step 6: Implement gate side**

In `scripts/check-docs.mjs`:

1. Change `const add = (file, field, message) => violations.push({ file, field, message })` to `const add = (rule, file, field, message) => violations.push({ rule, file, field, message })`.
2. Update every `add(...)` call with the id from the table. Mapping by current comment number: 3 path hygiene → `path`; 1 missing/unparseable → `frontmatter`; title/status/updated missing → `required`; kind and module → `required` when missing, `vocabulary` when present but wrong; basename → `basename`; status not in set, forced tier status, reserved status, vocabularies (8a) → `vocabulary`; ISO date checks → `date`; requiredFields (8) → `required`; evidence (8b) → `evidence`; changes (8c, both passes) → `changes`; implements (2b) → `implements`; superseded (6) → `superseded`; dead links (5a, 5b) → `link`; index (4) → `index`.
3. Signature: `export function checkDocs(root, config = loadConfig(root), options = {})`. Ignore `options` for now; Task 10 and 11 use it.
4. At the end, `return applySeverity(config, violations)`:

```js
/** Drop rules configured `off`, stamp the configured severity on the rest. */
export function applySeverity(config, violations) {
  const out = []
  for (const violation of violations) {
    const severity = config.rules[violation.rule] ?? 'error'
    if (severity === 'off') continue
    out.push({ ...violation, severity })
  }
  return out
}
```

5. `main()`: split into errors and warnings. Print warnings as `${file}:${field} — ${message} [${rule}, warn]` on stderr, errors as `${file}:${field} — ${message} [${rule}]`. Exit 1 only when `errors.length > 0`. Keep `PRINT_CAP` on errors. When no errors and no warnings: `check-docs: OK`. When no errors but warnings: `check-docs: OK (${warnings.length} warning(s))`.

- [ ] **Step 7: Run everything**

Run: `npm test && npm run lint:docs`
Expected: all pass, `check-docs: OK`.

- [ ] **Step 8: Commit**

```bash
git add scripts/docs-config.mjs scripts/check-docs.mjs scripts/check-docs.test.mjs scripts/docs-config.test.mjs
git commit -m "feat(gate): rule ids and per-rule severity (error | warn | off)"
```

---

### Task 2: Three verified defects — URL false positive, impossible dates, case-exact targets

**Files:**
- Create: `scripts/docs-dates.mjs`
- Modify: `scripts/check-docs.mjs`
- Test: `scripts/tracked-refs.test.mjs`, `scripts/check-docs.test.mjs`, create `scripts/docs-dates.test.mjs`

**Interfaces:**
- Produces: `isIsoDate(text): boolean` and `today(now = new Date()): string` in `scripts/docs-dates.mjs`.

- [ ] **Step 1: Failing tests**

`scripts/docs-dates.test.mjs`:

```js
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { isIsoDate, today } from './docs-dates.mjs'

test('isIsoDate accepts real calendar dates only', () => {
  assert.equal(isIsoDate('2026-02-28'), true)
  assert.equal(isIsoDate('2024-02-29'), true)
  assert.equal(isIsoDate('2026-13-45'), false)
  assert.equal(isIsoDate('2026-02-30'), false)
  assert.equal(isIsoDate('2026-2-3'), false)
  assert.equal(isIsoDate('yesterday'), false)
})

test('today formats a Date as YYYY-MM-DD in UTC', () => {
  assert.equal(today(new Date('2026-09-03T23:59:00Z')), '2026-09-03')
})
```

Append to `scripts/check-docs.test.mjs`:

```js
test('2g. an impossible calendar date is rejected', () => {
  const violations = run({ 'docs/engineering/x.md': doc({ title: 'X', kind: 'engineering', status: 'active', updated: '2026-13-45' }) })
  assert.ok(violations.some((v) => v.rule === 'date' && v.field === 'updated'))
})

test('2h. implements, superseded_by and evidence resolve case-exactly', () => {
  const violations = run({
    'docs/product/target.md': doc({ title: 'T', kind: 'product', status: 'active', updated: '2026-08-17' }),
    'docs/product/a.md': doc({ title: 'A', kind: 'product', status: 'active', updated: '2026-08-17', implements: 'docs/product/TARGET.md' }),
    'docs/archive/b.md': doc({ title: 'B', kind: 'archive', status: 'superseded', updated: '2026-08-17', superseded_by: 'docs/product/Target.md' }),
  })
  assert.ok(violations.some((v) => v.field === 'implements'))
  assert.ok(violations.some((v) => v.field === 'superseded_by'))
})
```

Note: on a case-insensitive filesystem (macOS) `existsSync` reports both as present, which is why the test fails before the fix. On Linux both would already fail. The test is valid on both.

Append to `scripts/tracked-refs.test.mjs`, using its `withGitFixture` helper:

```js
test('a docs path inside a URL is not a reference to this repository', () => {
  withGitFixture(
    {
      'CLAUDE.md': 'See https://github.com/magnifito/ai-doc-system/blob/main/docs/engineering/design.md and docs/engineering/local.md\n',
      'docs/engineering/local.md': '---\ntitle: L\nkind: engineering\nstatus: active\nupdated: 2026-08-17\n---\n# L\n',
    },
    (root) => {
      const refs = trackedDocRefs(root)
      assert.ok(refs.has('docs/engineering/local.md'))
      assert.ok(!refs.has('docs/engineering/design.md'))
    },
  )
})
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test scripts/docs-dates.test.mjs scripts/check-docs.test.mjs scripts/tracked-refs.test.mjs`
Expected: new tests fail.

- [ ] **Step 3: Implement**

`scripts/docs-dates.mjs`:

```js
/** Date helpers shared by the gate, the advisory pass and the writers. */

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Today as YYYY-MM-DD, UTC. `now` is injectable so tests are deterministic. */
export function today(now = new Date()) {
  return now.toISOString().slice(0, 10)
}
```

In `scripts/check-docs.mjs`:
- Import `isIsoDate`. Replace both regex date checks with `if (data.updated && !isIsoDate(data.updated)) add('date', path, 'updated', ...)` and the same for `verified_on`.
- `evidenceError(root, entry, exists)`: pass the `exists` closure in and use `exists(match[1].replace(/\/$/, ''))` instead of `existsSync`. Note `existsCaseExact` takes a repo-relative path; a directory path is fine because every segment is checked against its parent listing.
- `implements`: `if (!exists(target))`. `superseded_by`: `if (!exists(data.superseded_by))`.
- `trackedDocRefs`: change the JavaScript post-filter to a regex with a lookbehind that rejects a preceding `/`, `.`, or word character: `const pattern = new RegExp(`(?<![\\w./-])${dir}/[A-Za-z0-9._\\-/]+\\.md`, 'g')`. The `git grep -E` pattern stays as-is (it is only a candidate filter; the post-filter decides). Apply the same lookbehind in the non-git fallback, which uses the same `pattern`.

- [ ] **Step 4: Run all**

Run: `npm test && npm run lint:docs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/docs-dates.mjs scripts/docs-dates.test.mjs scripts/check-docs.mjs scripts/check-docs.test.mjs scripts/tracked-refs.test.mjs
git commit -m "fix(gate): URLs are not doc references; real calendar dates; case-exact implements/superseded_by/evidence"
```

---

### Task 3: Config ergonomics — `+` array extension, `evidenceRunners`, `shipped-code` warning, JSON Schema

**Files:**
- Modify: `scripts/docs-config.mjs`, `scripts/check-docs.mjs`, `docs-system.config.json`
- Create: `schema/docs-system.config.schema.json`
- Test: `scripts/docs-config.test.mjs`, `scripts/check-docs.test.mjs`

**Interfaces:**
- Produces: config keys `evidenceRunners: string[]`; any array key may be written as `"<key>+": [...]` to extend the default instead of replacing it. `package.json` `files` includes `schema`.

- [ ] **Step 1: Failing tests**

`scripts/docs-config.test.mjs`:

```js
test('a "+" key extends the default array instead of replacing it', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-config-'))
  writeFileSync(join(root, 'docs-system.config.json'), JSON.stringify({ 'referenceScanExclude+': ['site'], 'sentinels+': ['SPEC'] }))
  clearConfigCache()
  const config = loadConfig(root)
  assert.ok(config.referenceScanExclude.includes('.claude'))
  assert.ok(config.referenceScanExclude.includes('site'))
  assert.ok(config.sentinels.includes('README') && config.sentinels.includes('SPEC'))
  assert.equal('referenceScanExclude+' in config, false)
  rmSync(root, { recursive: true, force: true })
})

test('a "+" key on a non-array default is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-config-'))
  writeFileSync(join(root, 'docs-system.config.json'), JSON.stringify({ 'docsDir+': ['x'] }))
  clearConfigCache()
  assert.throws(() => loadConfig(root), /"docsDir\+"/)
  rmSync(root, { recursive: true, force: true })
})

test('evidenceRunners has defaults and can be extended', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-config-'))
  writeFileSync(join(root, 'docs-system.config.json'), JSON.stringify({ 'evidenceRunners+': ['just'] }))
  clearConfigCache()
  const config = loadConfig(root)
  assert.ok(config.evidenceRunners.includes('pnpm') && config.evidenceRunners.includes('just'))
  rmSync(root, { recursive: true, force: true })
})
```

`scripts/check-docs.test.mjs`:

```js
test('8l. evidence may start with a configured runner', () => {
  const state = doc({ title: 'S', kind: 'state', status: 'active', updated: '2026-08-17', module: 'crm', verified_on: '2026-08-17', evidence: ['just test-crm'] })
  const files = { 'docs/modules/crm/state/s.md': state }
  const base = { modules: [{ key: 'crm', class: 'anchor' }], tiers: [['modules/*/state/', 'state'], ...DEFAULTS.tiers], requiredFields: { state: ['verified_on', 'evidence'] } }
  assert.ok(run(files, { config: base }).some((v) => v.rule === 'evidence'))
  assert.ok(!run(files, { config: { ...base, evidenceRunners: [...DEFAULTS.evidenceRunners, 'just'] } }).some((v) => v.rule === 'evidence'))
})

test('12a. shipped without code is a warning, not an error', () => {
  const violations = run({ 'docs/plans/done/x.md': doc({ title: 'X', kind: 'plan', status: 'shipped', updated: '2026-08-17' }) })
  const hit = violations.find((v) => v.rule === 'shipped-code')
  assert.ok(hit)
  assert.equal(hit.severity, 'warn')
})
```

Check how existing module tests in the file build their config (search for `modules:` in the test file) and reuse the same shape for 8l.

- [ ] **Step 2: Run, expect failure**

Run: `node --test scripts/docs-config.test.mjs scripts/check-docs.test.mjs`

- [ ] **Step 3: Implement**

`scripts/docs-config.mjs`:
- Add to `DEFAULTS`: `evidenceRunners: ['bun', 'bunx', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'deno', 'make', 'just', 'cargo', 'go', 'pytest', 'python', 'python3', 'grep', 'rg', 'ls', 'git', 'curl', 'psql'],` with a doc comment.
- In `loadConfig`, before merging, fold `+` keys:

```js
function foldExtensions(overrides) {
  const out = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (!key.endsWith('+')) {
      out[key] = value
      continue
    }
    const base = key.slice(0, -1)
    if (!Array.isArray(DEFAULTS[base])) {
      throw new Error(`${CONFIG_FILE}: "${key}" extends "${base}", which is not an array setting`)
    }
    if (!Array.isArray(value)) throw new Error(`${CONFIG_FILE}: "${key}" must be an array`)
    out[base] = [...(out[base] ?? DEFAULTS[base]), ...value]
  }
  return out
}
```

Call it: `overrides = foldExtensions(JSON.parse(...))`. `validate`'s unknown-key loop then sees only plain keys.

`scripts/check-docs.mjs`: delete `EVIDENCE_RUNNERS`; `evidenceError(root, entry, exists, runners)` uses `runners.includes(first)` and the message lists `runners.join('/')`. Pass `config.evidenceRunners`. Add after the superseded check:

```js
    // shipped-code: the convention is that a shipped document points at its
    // implementation. A warning, not an error — a blocking rule invites
    // placeholder paths (design section 4.3).
    if (data.status === 'shipped' && !data.code) add('shipped-code', path, 'code', 'status is `shipped` but no `code:` names the implementation')
```

`docs-system.config.json` in this repo becomes:

```json
{
  "referenceScanExclude+": [".github", "templates", "site"]
}
```

`schema/docs-system.config.schema.json`: a draft-07 schema with `$id` `https://raw.githubusercontent.com/magnifito/ai-doc-system/main/schema/docs-system.config.schema.json`, `additionalProperties: false`, one property per `DEFAULTS` key and one per `<key>+` for each array key, `rules` as an object whose `additionalProperties` is `{ "enum": ["error", "warn", "off"] }`, `modules` items with `key`, `class` enum `core|anchor|addon`, `requires` array, `tiers` as array of 2-tuples. Add a test in `scripts/docs-config.test.mjs`:

```js
test('the JSON schema names every DEFAULTS key and its "+" form for arrays', () => {
  const schema = JSON.parse(readFileSync(new URL('../schema/docs-system.config.schema.json', import.meta.url), 'utf8'))
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(key in schema.properties, `schema lacks ${key}`)
    if (Array.isArray(value)) assert.ok(`${key}+` in schema.properties, `schema lacks ${key}+`)
  }
})
```

Add `"schema"` to `package.json` `files`. Add `"$schema"` support: the loader must ignore a `$schema` key (add it to the allowed keys in `validate`: `if (key === '$schema') continue`).

- [ ] **Step 4: Run all**

Run: `npm test && npm run lint:docs`

- [ ] **Step 5: Commit**

```bash
git add scripts/docs-config.mjs scripts/docs-config.test.mjs scripts/check-docs.mjs scripts/check-docs.test.mjs docs-system.config.json schema/docs-system.config.schema.json package.json
git commit -m "feat(config): + array extension, evidenceRunners, shipped-code warning, JSON schema"
```

---

### Task 4: One git walk for the advisory pass

**Files:**
- Modify: `scripts/docs-fs.mjs`, `scripts/check-docs-advisory.mjs`
- Test: create `scripts/docs-fs-git.test.mjs`

**Interfaces:**
- Produces: `lastCommitDates(root): Map<string, string>` — repo-relative path → last commit date, for every path ever committed (renamed and deleted paths included, keyed by the path as it was). `lastCommitDate(root, path)` stays for single lookups.

- [ ] **Step 1: Failing test**

`scripts/docs-fs-git.test.mjs` (copy `gitFixture` from `scripts/tracked-refs.test.mjs`; make commits with `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` in `env` so dates are deterministic):

```js
test('lastCommitDates maps every committed path to its last commit date in one call', () => {
  const root = gitFixture({ 'a.md': 'a', 'dir/b.md': 'b' })
  const git = (args, env) => execFileSync('git', args, { cwd: root, stdio: 'pipe', env: { ...process.env, ...env } })
  writeFileSync(join(root, 'a.md'), 'a2')
  git(['commit', '-qam', 'later'], { GIT_AUTHOR_DATE: '2026-05-05T00:00:00Z', GIT_COMMITTER_DATE: '2026-05-05T00:00:00Z' })
  const dates = lastCommitDates(root)
  assert.equal(dates.get('a.md'), '2026-05-05')
  assert.equal(dates.get('dir/b.md'), lastCommitDate(root, 'dir/b.md'))
  rmSync(root, { recursive: true, force: true })
})

test('lastCommitDates is empty outside git', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-nogit-'))
  assert.equal(lastCommitDates(root).size, 0)
  rmSync(root, { recursive: true, force: true })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test scripts/docs-fs-git.test.mjs`

- [ ] **Step 3: Implement**

`scripts/docs-fs.mjs`:

```js
/**
 * Last commit date for EVERY path, from one `git log` walk. The advisory pass
 * used to spawn one `git log` per document; on a few hundred documents that is
 * a few hundred subprocesses. Newest commits come first, so the first time a
 * path is seen wins. Directories are covered too: a directory's date is the
 * newest date of any path beneath it.
 */
export function lastCommitDates(root) {
  const dates = new Map()
  let out
  try {
    out = execFileSync('git', ['log', '--name-only', '--format=%x00%ad', '--date=short'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
  } catch {
    return dates
  }
  let current = ''
  for (const line of out.split('\n')) {
    if (line.startsWith('\0')) {
      current = line.slice(1).trim()
      continue
    }
    const path = line.trim()
    if (!path) continue
    if (!dates.has(path)) dates.set(path, current)
    let dir = path
    while (dir.includes('/')) {
      dir = dir.slice(0, dir.lastIndexOf('/'))
      if (!dates.has(dir)) dates.set(dir, current)
    }
  }
  return dates
}
```

`scripts/check-docs-advisory.mjs`: call `const dates = lastCommitDates(root)` once; replace `lastCommitDate(root, path)` with `dates.get(path) ?? ''` and the `code:` lookup with `dates.get(codePath) ?? ''`. Also add rule ids: prefix each report block with its id — `updated-drift`, `code-pointer`, `verification-drift` — and skip a block when `config.rules[id] === 'off'`. Add those three ids to `RULES` in `docs-config.mjs` with default `warn` (they are advisory-only; the gate never evaluates them). Update the `RULES` test in Task 1 if it enumerates ids.

- [ ] **Step 4: Run all**

Run: `npm test && npm run lint:docs && npm run lint:docs:advisory`

- [ ] **Step 5: Commit**

```bash
git add scripts/docs-fs.mjs scripts/docs-fs-git.test.mjs scripts/check-docs-advisory.mjs scripts/docs-config.mjs scripts/docs-config.test.mjs
git commit -m "perf(advisory): one git log walk instead of one subprocess per document"
```

---

### Task 5: `summary`, `source_url`, `review_by`, `promoted_from` fields

**Files:**
- Modify: `scripts/docs-frontmatter.mjs`, `scripts/check-docs.mjs`, `scripts/gen-docs-index.mjs`
- Test: `scripts/check-docs.test.mjs`, `scripts/docs-frontmatter.test.mjs`

**Interfaces:**
- Produces: `FIELD_ORDER` = `title, summary, kind, module, status, updated, review_by, verified_on, evidence, commitment, changes, implements, code, source_url, superseded_by, promoted_from`. Index entries carry `summary`, `source_url`, `review_by` when present. `INDEX.md` tables gain a `Summary` column.

- [ ] **Step 1: Failing tests**

`scripts/check-docs.test.mjs`:

```js
test('13a. summary must be one non-empty line when present', () => {
  const bad = run({ 'docs/engineering/x.md': doc({ title: 'X', kind: 'engineering', status: 'active', updated: '2026-08-17', summary: '""' }) })
  assert.ok(bad.some((v) => v.rule === 'summary'))
  const multi = run({ 'docs/engineering/x.md': '---\ntitle: X\nkind: engineering\nstatus: active\nupdated: 2026-08-17\nsummary: |\n  one\n  two\n---\n# X\n' })
  assert.ok(multi.some((v) => v.rule === 'summary' && /one line/.test(v.message)))
  const good = run({ 'docs/engineering/x.md': doc({ title: 'X', kind: 'engineering', status: 'active', updated: '2026-08-17', summary: 'What the gate asserts.' }) })
  assert.ok(!good.some((v) => v.rule === 'summary'))
})

test('13b. source_url must be http(s) when present', () => {
  const ref = (url) => doc({ title: 'R', kind: 'reference', status: 'reference', updated: '2026-08-17', source_url: url })
  assert.ok(run({ 'docs/reference/r.md': ref('ftp://x') }).some((v) => v.rule === 'source-url'))
  assert.ok(!run({ 'docs/reference/r.md': ref('https://example.test/doc') }).some((v) => v.rule === 'source-url'))
})

test('13c. the index carries summary, source_url and review_by', () => {
  const root = fixture({
    'docs/reference/r.md': doc({ title: 'R', kind: 'reference', status: 'reference', updated: '2026-08-17', summary: 'Captured.', source_url: 'https://example.test/doc', review_by: '2027-01-01' }),
  })
  try {
    const [entry] = buildIndex(root)
    assert.equal(entry.summary, 'Captured.')
    assert.equal(entry.source_url, 'https://example.test/doc')
    assert.equal(entry.review_by, '2027-01-01')
    assert.match(renderMarkdown([entry]), /\| Summary \|/)
    assert.match(renderMarkdown([entry]), /Captured\./)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

Note that `doc({ summary: '""' })` renders `summary: ""`, an empty string in YAML.

`scripts/docs-frontmatter.test.mjs`: extend the existing FIELD_ORDER test (or add one) asserting `renderFrontmatter({ title: 'T', source_url: 'https://x', summary: 'S', kind: 'reference' })` renders `title`, then `summary`, then `kind`, then `source_url`.

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

`scripts/docs-frontmatter.mjs`: new `FIELD_ORDER` as above. `scalar()` must quote a URL (it contains `:`), which it already does because `:` is not in the bare-safe set.

`scripts/check-docs.mjs`, inside the per-document loop after the date checks:

```js
    if ('summary' in data) {
      const summary = data.summary ?? ''
      if (summary.trim() === '') add('summary', path, 'summary', 'is present but empty — write one line or remove the field')
      else if (summary.includes('\n')) add('summary', path, 'summary', 'must be one line')
    }
    if (data.source_url && !/^https?:\/\/\S+$/.test(data.source_url)) {
      add('source-url', path, 'source_url', `"${data.source_url}" is not an http(s) URL`)
    }
    if (data.review_by && !isIsoDate(data.review_by)) add('date', path, 'review_by', `"${data.review_by}" is not an ISO date`)
```

`parseFrontmatter` currently drops `null` values (`value != null`). An empty scalar `summary:` parses as `null` and would vanish. Change the loop to keep `''` for null: `else data[key] = value == null ? '' : String(value)`. Check the existing frontmatter tests still pass; fix any that asserted null-dropping.

`scripts/gen-docs-index.mjs` `buildIndex`: add `...(data.summary ? { summary: data.summary } : {})` right after `title`, `...(data.review_by ? { review_by: data.review_by } : {})` after `updated`, `...(data.source_url ? { source_url: data.source_url } : {})` after `code`. `renderMarkdown`: header `| Document | Status | Updated | Summary |`, separator `|---|---|---|---|`, row appends `| ${(entry.summary ?? '').replace(/\|/g, '\\|')} |`. Module README and roadmap tables are unchanged.

Regenerate this repo's index: `npm run gen:docs-index`. Add a `summary:` line to `docs/engineering/design.md`, `docs/plans/debt.md` and this plan, then regenerate again.

- [ ] **Step 4: Run all**

Run: `npm test && npm run lint:docs`

- [ ] **Step 5: Commit**

```bash
git add scripts/docs-frontmatter.mjs scripts/docs-frontmatter.test.mjs scripts/check-docs.mjs scripts/check-docs.test.mjs scripts/gen-docs-index.mjs docs/
git commit -m "feat(schema): summary, source_url, review_by and promoted_from fields; summary column in INDEX.md"
```

---

### Task 6: Machine-readable gate output — `--json` and `--format github`

**Files:**
- Modify: `scripts/check-docs.mjs`
- Test: `scripts/cli.test.mjs`

- [ ] **Step 1: Failing tests**

```js
test('check --json prints a JSON report and still exits 1 on errors', () => {
  const root = gitFixture({ 'docs/engineering/x.md': '# no frontmatter\n' })
  try {
    cli(['gen'], { cwd: root })
    cli(['check', '--json'], { cwd: root })
    assert.fail('should have exited 1')
  } catch (error) {
    assert.equal(error.status, 1)
    const report = JSON.parse(error.stdout)
    assert.equal(report.ok, false)
    assert.ok(report.violations.some((v) => v.rule === 'frontmatter' && v.file === 'docs/engineering/x.md'))
    assert.equal(typeof report.errors, 'number')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('check --format github prints workflow annotations', () => {
  const root = gitFixture({ 'docs/engineering/x.md': '# no frontmatter\n' })
  try {
    cli(['gen'], { cwd: root })
    cli(['check', '--format', 'github'], { cwd: root })
    assert.fail('should have exited 1')
  } catch (error) {
    assert.match(`${error.stdout}`, /^::error file=docs\/engineering\/x\.md,title=frontmatter::/m)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test scripts/cli.test.mjs`

- [ ] **Step 3: Implement**

In `scripts/check-docs.mjs` `main()`, after computing `errors` and `warnings`:

```js
  const json = process.argv.includes('--json')
  const format = flagValue('--format') ?? 'text'
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: errors.length === 0, errors: errors.length, warnings: warnings.length, violations }, null, 2)}\n`)
    process.exit(errors.length === 0 ? 0 : 1)
  }
  if (format === 'github') {
    for (const v of violations) {
      const level = v.severity === 'error' ? 'error' : 'warning'
      const file = v.file === '(repo)' ? '' : `file=${v.file},`
      process.stdout.write(`::${level} ${file}title=${v.rule}::${v.field} — ${v.message}\n`)
    }
    process.exit(errors.length === 0 ? 0 : 1)
  }
```

Add a local `flagValue(name)` helper (same as the one in `scripts/migrate-docs.mjs`). Text output stays as Task 1 left it.

- [ ] **Step 4: Run all**, **Step 5: Commit**

```bash
git add scripts/check-docs.mjs scripts/cli.test.mjs
git commit -m "feat(cli): check --json and --format github"
```

---

### Task 7: `new` and `mv` commands

**Files:**
- Create: `scripts/new-doc.mjs`, `scripts/mv-doc.mjs`, `scripts/new-doc.test.mjs`, `scripts/mv-doc.test.mjs`
- Modify: `cli/cli.mjs`, `scripts/docs-frontmatter.mjs` (export `patchScalar`, moved from `fix-docs-frontmatter.mjs`), `scripts/fix-docs-frontmatter.mjs` (import it)

**Interfaces:**
- Produces: `newDoc(root, path, { title, summary, status, now }, config)` returns `{ path, frontmatter }` and writes the file plus regenerated index. `mvDoc(root, from, to, { status, now }, config)` returns `{ from, to, restamped: { kind, module, status } }`. Both throw `Error` with a one-line message on misuse.

- [ ] **Step 1: Failing tests**

`scripts/new-doc.test.mjs` (copy `gitFixture` from `scripts/cli.test.mjs`; no commit needed):

```js
test('new writes a gate-clean document and regenerates the index', () => {
  const root = gitFixture({})
  try {
    const { frontmatter } = newDoc(root, 'docs/product/invoices.md', { title: 'Invoices', summary: 'Committed scope for invoices.', now: new Date('2026-09-03T12:00:00Z') })
    assert.match(frontmatter, /^kind: product$/m)
    assert.match(frontmatter, /^status: draft$/m)
    assert.match(frontmatter, /^updated: 2026-09-03$/m)
    assert.match(readFileSync(join(root, 'docs/product/invoices.md'), 'utf8'), /^# Invoices$/m)
    assert.equal(checkDocs(root).filter((v) => v.severity === 'error').length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('new takes the forced status of the tier and refuses a path under no tier', () => {
  const root = gitFixture({})
  try {
    const { frontmatter } = newDoc(root, 'docs/reference/vendor/x.md', { title: 'X', now: new Date('2026-09-03T12:00:00Z') })
    assert.match(frontmatter, /^status: reference$/m)
    assert.throws(() => newDoc(root, 'docs/nowhere/x.md', { title: 'X' }), /under no tier/)
    assert.throws(() => newDoc(root, 'docs/reference/vendor/x.md', { title: 'X' }), /already exists/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('new refuses a path that fails hygiene', () => {
  const root = gitFixture({})
  try {
    assert.throws(() => newDoc(root, 'docs/product/My Doc.md', { title: 'X' }), /not kebab-case/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

`scripts/mv-doc.test.mjs` (committed fixture, copy the committing `gitFixture` from `scripts/tracked-refs.test.mjs`):

```js
test('mv moves with git, restamps kind and status, and regenerates the index', () => {
  const root = gitFixture({ 'docs/reference/vendor/prd.md': '---\ntitle: PRD\nkind: reference\nstatus: reference\nupdated: 2026-08-01\nsource_url: "https://example.test"\n---\n# PRD\n' })
  try {
    execFileSync(process.execPath, [join(PACKAGE_ROOT, 'scripts', 'gen-docs-index.mjs')], { cwd: root, stdio: 'pipe' })
    const result = mvDoc(root, 'docs/reference/vendor/prd.md', 'docs/product/prd.md', { now: new Date('2026-09-03T12:00:00Z') })
    assert.deepEqual(result.restamped, { kind: 'product', module: null, status: 'draft' })
    const text = readFileSync(join(root, 'docs/product/prd.md'), 'utf8')
    assert.match(text, /^kind: product$/m)
    assert.match(text, /^status: draft$/m)
    assert.match(text, /^promoted_from: docs\/reference\/vendor\/prd\.md$/m)
    assert.match(text, /^source_url: "https:\/\/example\.test"$/m)
    assert.match(execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }), /^R  docs\/reference\/vendor\/prd\.md -> docs\/product\/prd\.md/m)
    assert.equal(checkDocs(root).filter((v) => v.severity === 'error').length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('mv refuses an occupied destination and a destination under no tier', () => {
  const root = gitFixture({ 'docs/engineering/a.md': GOOD, 'docs/engineering/b.md': GOOD.replace('Quality gate', 'B') })
  try {
    assert.throws(() => mvDoc(root, 'docs/engineering/a.md', 'docs/engineering/b.md'), /already exists/)
    assert.throws(() => mvDoc(root, 'docs/engineering/a.md', 'docs/x/a.md'), /under no tier/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

Move `patchScalar` from `scripts/fix-docs-frontmatter.mjs` into `scripts/docs-frontmatter.mjs` as an export (same body, add a doc comment); import it back in `fix-docs-frontmatter.mjs`.

`scripts/new-doc.mjs`:

```js
#!/usr/bin/env node
/**
 * `ai-doc-system new <path>` — write a document that passes the gate on its
 * first run: `kind` from the path, the tier's forced status or `draft`,
 * today's `updated`, then regenerate the index. Most gate failures come from
 * hand-written frontmatter; this removes the hand.
 *
 * Usage: node scripts/new-doc.mjs <docs/tier/name.md> [--title "..."] [--summary "..."] [--status draft]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { renderFrontmatter } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { kindForPath, moduleForPath, pathHygieneErrors, statusForKind } from './docs-taxonomy.mjs'
import { today } from './docs-dates.mjs'
import { repoRoot } from './docs-fs.mjs'
import { writeIndex } from './gen-docs-index.mjs'
import { runDirect } from './docs-run.mjs'

export function newDoc(root, path, { title, summary, status, now } = {}, config = loadConfig(root)) {
  const hygiene = pathHygieneErrors(path, config)
  if (hygiene.length > 0) throw new Error(`${path}: ${hygiene[0]}`)
  const kind = kindForPath(config, path)
  if (kind === null) throw new Error(`${path} is under no tier — tiers are ${config.tiers.map(([p]) => `${config.docsDir}/${p}`).join(', ')}`)
  if (existsSync(join(root, path))) throw new Error(`${path} already exists`)
  const moduleKey = config.modules.length > 0 ? moduleForPath(config, path) : null
  if (config.modules.length > 0 && moduleKey === null) throw new Error(`${path} is in no module tree`)
  const forced = statusForKind(config, kind)
  if (status && forced && status !== forced) throw new Error(`everything under ${config.docsDir}/${kind} is status: ${forced}`)
  if (status && !config.statuses.includes(status)) throw new Error(`"${status}" is not one of ${config.statuses.join(' | ')}`)
  const name = path.split('/').pop().replace(/\.md$/, '')
  const meta = {
    title: title ?? name,
    ...(summary ? { summary } : {}),
    kind,
    ...(moduleKey ? { module: moduleKey } : {}),
    status: forced ?? status ?? 'draft',
    updated: today(now),
  }
  const frontmatter = renderFrontmatter(meta)
  mkdirSync(join(root, dirname(path)), { recursive: true })
  writeFileSync(join(root, path), `${frontmatter}\n# ${meta.title}\n`)
  writeIndex(root, config)
  return { path, frontmatter }
}

function flagValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

export function main() {
  const path = process.argv.slice(2).find((arg) => !arg.startsWith('--') && arg.endsWith('.md'))
  if (!path) {
    console.error('usage: ai-doc-system new <docs/tier/name.md> [--title "..."] [--summary "..."] [--status <status>]')
    process.exit(2)
  }
  try {
    const { frontmatter } = newDoc(repoRoot(), path, { title: flagValue('--title'), summary: flagValue('--summary'), status: flagValue('--status') })
    console.log(`created ${path}\n${frontmatter}`)
  } catch (error) {
    console.error(`new: ${error.message}`)
    process.exit(1)
  }
}

if (runDirect(import.meta.url)) main()
```

Add to `scripts/gen-docs-index.mjs`:

```js
/** Write every generated artefact. Returns the paths written. */
export function writeIndex(root, config = loadConfig(root)) {
  const written = []
  for (const [path, content] of renderIndex(root, config)) {
    writeFileSync(join(root, path), content)
    written.push(path)
  }
  return written
}
```

and make `main()` use it for the non-`--check` branch.

`scripts/mv-doc.mjs`:

```js
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
  if (!config.statuses.includes(nextStatus)) throw new Error(`"${nextStatus}" is not one of ${config.statuses.join(' | ')}`)

  mkdirSync(join(root, dirname(to)), { recursive: true })
  try {
    execFileSync('git', ['mv', from, to], { cwd: root, stdio: 'pipe' })
  } catch (error) {
    if (!`${error.stderr ?? ''}`.includes('not under version control')) throw error
    renameSync(join(root, from), join(root, to))
  }
  let patched = patchScalar(raw, 'kind', kind, ['summary', 'title'])
  if (moduleKey) patched = patchScalar(patched, 'module', moduleKey, ['kind'])
  patched = patchScalar(patched, 'status', nextStatus, ['module', 'kind'])
  patched = patchScalar(patched, 'updated', today(now), ['status'])
  if (fromKind !== kind) patched = patchScalar(patched, 'promoted_from', from, ['superseded_by', 'source_url', 'code', 'updated'])
  writeFileSync(join(root, to), `---\n${patched}\n---\n${body}`)
  writeIndex(root, config)
  return { from, to, restamped: { kind, module: moduleKey, status: nextStatus } }
}

function flagValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

export function main() {
  const [from, to] = process.argv.slice(2).filter((arg) => !arg.startsWith('--') && arg !== flagValue('--status'))
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
```

`patchScalar(raw, key, value, anchors)` inserts after the first anchor found; the anchor lists above put each field where `FIELD_ORDER` wants it.

`cli/cli.mjs`: add `new: ['new-doc.mjs', 'write a gate-clean document at <path>']` and `mv: ['mv-doc.mjs', 'git mv + restamp + regenerate (promotion)']`.

- [ ] **Step 4: Run all**, **Step 5: Commit**

```bash
git add scripts/new-doc.mjs scripts/new-doc.test.mjs scripts/mv-doc.mjs scripts/mv-doc.test.mjs scripts/docs-frontmatter.mjs scripts/fix-docs-frontmatter.mjs scripts/gen-docs-index.mjs cli/cli.mjs
git commit -m "feat(cli): new and mv commands"
```

---

### Task 8: Reverse code index and `impact`

**Files:**
- Create: `scripts/impact-docs.mjs`, `scripts/impact-docs.test.mjs`
- Modify: `scripts/gen-docs-index.mjs`, `scripts/docs-fs.mjs`, `cli/cli.mjs`
- Test: `scripts/check-docs.test.mjs` (index shape)

**Interfaces:**
- Produces: `index.json` top level gains `by_code: Record<string, string[]>` — every `code:` path (without `#fragment`, without trailing `/`) and every path-form `evidence` entry (without `:line`) maps to the sorted list of doc paths claiming it. `changedPaths(root, base): string[]` in `docs-fs.mjs`. `impactedDocs(root, changed, config): { doc, via, claim, verified_on? }[]` in `impact-docs.mjs`.

- [ ] **Step 1: Failing tests**

`scripts/check-docs.test.mjs`:

```js
test('14a. index.json carries a by_code reverse map over code: and evidence paths', () => {
  const root = fixture({
    'src/a.ts': 'x',
    'src/b/index.ts': 'x',
    'docs/product/a.md': doc({ title: 'A', kind: 'product', status: 'shipped', updated: '2026-08-17', code: 'src/a.ts' }),
    'docs/product/b.md': doc({ title: 'B', kind: 'product', status: 'shipped', updated: '2026-08-17', code: 'src/b/' }),
  })
  try {
    const json = JSON.parse(readFileSync(join(root, 'docs/index.json'), 'utf8'))
    assert.deepEqual(json.by_code, { 'src/a.ts': ['docs/product/a.md'], 'src/b': ['docs/product/b.md'] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

`scripts/impact-docs.test.mjs` (committing `gitFixture`):

```js
test('impactedDocs names every document whose code: or evidence covers a changed path', () => {
  const root = gitFixture({
    'src/a.ts': 'x',
    'src/b/deep/file.ts': 'x',
    'src/c.ts': 'x',
    'docs/product/a.md': '---\ntitle: A\nkind: product\nstatus: shipped\nupdated: 2026-08-17\ncode: src/a.ts\n---\n# A\n',
    'docs/product/b.md': '---\ntitle: B\nkind: product\nstatus: shipped\nupdated: 2026-08-17\ncode: src/b/\n---\n# B\n',
    'docs/product/c.md': '---\ntitle: C\nkind: product\nstatus: active\nupdated: 2026-08-17\n---\n# C\n',
  })
  try {
    const hits = impactedDocs(root, ['src/b/deep/file.ts', 'src/c.ts'])
    assert.deepEqual(hits.map((h) => h.doc), ['docs/product/b.md'])
    assert.equal(hits[0].via, 'src/b/deep/file.ts')
    assert.equal(hits[0].claim, 'src/b')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('changedPaths lists the working tree and staged changes when no base is given, and the diff against base otherwise', () => {
  const root = gitFixture({ 'src/a.ts': 'x' })
  try {
    writeFileSync(join(root, 'src/a.ts'), 'y')
    writeFileSync(join(root, 'src/new.ts'), 'z')
    assert.deepEqual(changedPaths(root).sort(), ['src/a.ts', 'src/new.ts'])
    assert.deepEqual(changedPaths(root, 'HEAD'), ['src/a.ts'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

`scripts/gen-docs-index.mjs`: in `buildIndex`, collect `evidence` paths too: after computing the entry, add `...(Array.isArray(data.evidence) && data.evidence.length > 0 ? { evidence: data.evidence } : {})`. Then:

```js
/** Normalise a `code:` or path-form evidence entry to a repo path key. */
function codeKey(value) {
  const bare = value.split('#')[0].replace(/:\d+(?:-\d+)?$/, '').replace(/\/$/, '')
  return bare
}

/** code path -> the documents that claim it. Sorted keys, sorted lists. */
export function buildByCode(entries, config) {
  const map = new Map()
  const put = (key, path) => {
    if (!map.has(key)) map.set(key, new Set())
    map.get(key).add(path)
  }
  for (const entry of entries) {
    if (entry.code) put(codeKey(entry.code), entry.path)
    for (const item of entry.evidence ?? []) {
      const first = item.trim().split(/\s+/)[0]
      if (config.evidenceRunners.includes(first)) continue
      put(codeKey(item.trim()), entry.path)
    }
  }
  return Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, [...v].sort()]))
}
```

`renderJson(entries, config)` becomes `JSON.stringify({ generated, count, docs: entries, by_code: buildByCode(entries, config) }, null, 2)`. Update `renderIndex` to pass `config`. Update any test that calls `renderJson(entries)` directly.

`scripts/docs-fs.mjs`:

```js
/**
 * Repo-relative paths that changed: against `base` when given
 * (`git diff --name-only base...HEAD`, falling back to two dots when the
 * merge base cannot be found), otherwise the working tree plus the index,
 * untracked files included.
 */
export function changedPaths(root, base) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  if (base) {
    try {
      return git(['diff', '--name-only', `${base}...HEAD`])
    } catch {
      return git(['diff', '--name-only', base])
    }
  }
  return [...new Set([...git(['diff', '--name-only', 'HEAD']), ...git(['ls-files', '--others', '--exclude-standard'])])]
}
```

`scripts/impact-docs.mjs`:

```js
#!/usr/bin/env node
/**
 * `ai-doc-system impact [--base <ref>]` — which documents make claims about
 * the paths that changed. `code:` points from a document at code; nothing
 * pointed back until now. Advisory: exit 0 always; appended to
 * GITHUB_STEP_SUMMARY when set, so a pull request shows the documents it may
 * have falsified.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './docs-config.mjs'
import { buildByCode, buildIndex } from './gen-docs-index.mjs'
import { changedPaths, repoRoot } from './docs-fs.mjs'
import { runDirect } from './docs-run.mjs'

/** A changed path is covered by a claim when it equals the claim or lies beneath it. */
function covers(claim, changed) {
  return changed === claim || changed.startsWith(`${claim}/`)
}

export function impactedDocs(root, changed, config = loadConfig(root)) {
  const entries = buildIndex(root, config)
  const byCode = buildByCode(entries, config)
  const verified = new Map(entries.map((entry) => [entry.path, entry.verified_on]))
  const hits = []
  for (const [claim, docs] of Object.entries(byCode)) {
    for (const path of changed) {
      if (!covers(claim, path)) continue
      for (const doc of docs) hits.push({ doc, via: path, claim, ...(verified.get(doc) ? { verified_on: verified.get(doc) } : {}) })
    }
  }
  const seen = new Set()
  return hits.filter((hit) => {
    const key = `${hit.doc}|${hit.via}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => (a.doc < b.doc ? -1 : a.doc > b.doc ? 1 : 0))
}

function flagValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

export function main() {
  const root = repoRoot()
  const base = flagValue('--base')
  const changed = changedPaths(root, base)
  const hits = impactedDocs(root, changed)
  const lines = []
  if (hits.length === 0) lines.push(`docs impact: no document claims any of the ${changed.length} changed path(s)`)
  else {
    lines.push(`docs impact: ${hits.length} claim(s) touched by this change — re-verify or update:`)
    for (const { doc, via, claim, verified_on } of hits) {
      lines.push(`  ${doc} claims ${claim}${verified_on ? ` (verified ${verified_on})` : ''} — ${via} changed`)
    }
  }
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ changed, hits }, null, 2)}\n`)
  else for (const line of lines) console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### docs impact\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`)
  process.exit(0)
}

if (runDirect(import.meta.url)) main()
```

`cli/cli.mjs`: `impact: ['impact-docs.mjs', 'documents whose claims cover the changed paths']`. Regenerate this repo's index (`by_code` will be `{}`).

- [ ] **Step 4: Run all**, **Step 5: Commit**

```bash
git add scripts/impact-docs.mjs scripts/impact-docs.test.mjs scripts/gen-docs-index.mjs scripts/docs-fs.mjs scripts/check-docs.test.mjs cli/cli.mjs docs/
git commit -m "feat: by_code reverse index and impact command"
```

---

### Task 9: Executable evidence — `verify` and the evidence lock

**Files:**
- Create: `scripts/verify-docs.mjs`, `scripts/verify-docs.test.mjs`
- Modify: `cli/cli.mjs`, `scripts/check-docs.mjs` (a warn rule `evidence-lock`, added to `RULES` with default `warn`)

**Interfaces:**
- Produces: `verifyDocs(root, { only, stamp, now, run }, config)` → `{ results: { doc, entry, kind: 'command'|'path', ok, detail }[], stamped: string[] }`. Lock file `<docsDir>/evidence-lock.json`: `{ "generated": "scripts/verify-docs.mjs", "entries": { "<doc path>": { "<entry>": "<sha256 of the referenced lines, or of the whole file when no :line>" } } }`. Gate rule `evidence-lock` (warn): a `state` document whose path-form evidence has a lock entry whose hash no longer matches.

Security note for the implementer and the docs: `verify` executes shell commands written in frontmatter. It only runs when invoked explicitly and never from the gate or hooks.

- [ ] **Step 1: Failing tests**

`scripts/verify-docs.test.mjs` (committing `gitFixture`; module config as in Task 3's 8l test):

```js
const CONFIG = JSON.stringify({ modules: [{ key: 'crm', class: 'anchor' }], tiers: [['modules/*/state/', 'state'], ...DEFAULTS.tiers], requiredFields: { state: ['verified_on', 'evidence'] } })

test('verify runs command evidence, hashes path evidence, writes the lock, and stamps verified_on on success', () => {
  const root = gitFixture({
    'docs-system.config.json': CONFIG,
    'src/x.ts': 'line1\nline2\nline3\n',
    'docs/modules/crm/state/s.md': '---\ntitle: S\nkind: state\nmodule: crm\nstatus: active\nupdated: 2026-08-01\nverified_on: 2026-08-01\nevidence:\n  - src/x.ts:2\n  - node -e "process.exit(0)"\n---\n# S\n',
  })
  clearConfigCache()
  try {
    const { results, stamped } = verifyDocs(root, { stamp: true, now: new Date('2026-09-03T12:00:00Z') })
    assert.equal(results.length, 2)
    assert.ok(results.every((r) => r.ok))
    assert.deepEqual(stamped, ['docs/modules/crm/state/s.md'])
    assert.match(readFileSync(join(root, 'docs/modules/crm/state/s.md'), 'utf8'), /^verified_on: 2026-09-03$/m)
    const lock = JSON.parse(readFileSync(join(root, 'docs/evidence-lock.json'), 'utf8'))
    assert.equal(typeof lock.entries['docs/modules/crm/state/s.md']['src/x.ts:2'], 'string')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verify reports a failing command and does not stamp', () => {
  const root = gitFixture({
    'docs-system.config.json': CONFIG,
    'docs/modules/crm/state/s.md': '---\ntitle: S\nkind: state\nmodule: crm\nstatus: active\nupdated: 2026-08-01\nverified_on: 2026-08-01\nevidence:\n  - node -e "process.exit(3)"\n---\n# S\n',
  })
  clearConfigCache()
  try {
    const { results, stamped } = verifyDocs(root, { stamp: true })
    assert.equal(results[0].ok, false)
    assert.match(results[0].detail, /exit 3/)
    assert.deepEqual(stamped, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the gate warns when a locked evidence line has changed', () => {
  const root = gitFixture({
    'docs-system.config.json': CONFIG,
    'src/x.ts': 'line1\nline2\n',
    'docs/modules/crm/state/s.md': '---\ntitle: S\nkind: state\nmodule: crm\nstatus: active\nupdated: 2026-08-01\nverified_on: 2026-08-01\nevidence:\n  - src/x.ts:2\n---\n# S\n',
  })
  clearConfigCache()
  try {
    verifyDocs(root, {})
    execFileSync(process.execPath, [join(PACKAGE_ROOT, 'scripts', 'gen-docs-index.mjs')], { cwd: root, stdio: 'pipe' })
    assert.ok(!checkDocs(root).some((v) => v.rule === 'evidence-lock'))
    writeFileSync(join(root, 'src/x.ts'), 'line1\nCHANGED\n')
    const hit = checkDocs(root).find((v) => v.rule === 'evidence-lock')
    assert.ok(hit)
    assert.equal(hit.severity, 'warn')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

`scripts/verify-docs.mjs`:

```js
#!/usr/bin/env node
/**
 * `ai-doc-system verify [--only <doc>] [--stamp]` — turn evidence from a claim
 * into a check. Command-form entries are RUN (shell, from the repo root, 60 s
 * timeout); path-form entries are hashed — the named lines, or the whole file —
 * into `<docsDir>/evidence-lock.json` so the gate can later warn when the
 * evidence moved under a document. `--stamp` sets `verified_on` to today on
 * every document whose entries all passed.
 *
 * This is the only command that executes anything from a document. It never
 * runs from the gate or from a hook; an author invokes it on purpose.
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter, patchScalar } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { isExempt } from './docs-taxonomy.mjs'
import { today } from './docs-dates.mjs'
import { listDocs, repoRoot } from './docs-fs.mjs'
import { runDirect } from './docs-run.mjs'

export const LOCK_FILE = 'evidence-lock.json'

/** Split `path[:from[-to]]`; null when the entry is not path-form. */
export function parsePathEvidence(entry) {
  const match = entry.trim().match(/^([A-Za-z0-9._\-/[\]()@]+?)(?::(\d+)(?:-(\d+))?)?$/)
  if (!match) return null
  return { path: match[1].replace(/\/$/, ''), from: match[2] ? Number(match[2]) : null, to: match[3] ? Number(match[3]) : null }
}

/** sha256 of the named lines (1-based, inclusive) or of the whole file. Null when the path is missing or a directory. */
export function hashEvidence(root, { path, from, to }) {
  const full = join(root, path)
  if (!existsSync(full)) return null
  let text
  try {
    text = readFileSync(full, 'utf8')
  } catch {
    return null // a directory: nothing to hash, existence is the whole claim
  }
  if (from !== null) {
    const lines = text.split('\n')
    text = lines.slice(from - 1, (to ?? from)).join('\n')
  }
  return createHash('sha256').update(text).digest('hex')
}

export function readLock(root, config) {
  const file = join(root, config.docsDir, LOCK_FILE)
  if (!existsSync(file)) return { generated: 'scripts/verify-docs.mjs', entries: {} }
  return JSON.parse(readFileSync(file, 'utf8'))
}

function runCommand(root, command) {
  try {
    execSync(command, { cwd: root, stdio: 'pipe', timeout: 60_000 })
    return { ok: true, detail: 'exit 0' }
  } catch (error) {
    const code = error.status ?? 'signal'
    return { ok: false, detail: `exit ${code}: ${`${error.stderr ?? error.message}`.split('\n')[0]}` }
  }
}

export function verifyDocs(root, { only, stamp = false, now, run = runCommand } = {}, config = loadConfig(root)) {
  const results = []
  const stamped = []
  const lock = readLock(root, config)
  for (const path of listDocs(root, config)) {
    if (isExempt(config, path) || (only && path !== only)) continue
    const source = readFileSync(join(root, path), 'utf8')
    const { data, raw, body } = parseFrontmatter(source)
    if (!Array.isArray(data.evidence) || data.evidence.length === 0) continue
    let allOk = true
    const hashes = {}
    for (const entry of data.evidence) {
      const first = entry.trim().split(/\s+/)[0]
      if (config.evidenceRunners.includes(first)) {
        const { ok, detail } = run(root, entry.trim())
        results.push({ doc: path, entry, kind: 'command', ok, detail })
        allOk &&= ok
        continue
      }
      const parsed = parsePathEvidence(entry)
      const hash = parsed ? hashEvidence(root, parsed) : null
      const ok = parsed !== null && existsSync(join(root, parsed.path))
      if (ok && hash) hashes[entry] = hash
      results.push({ doc: path, entry, kind: 'path', ok, detail: ok ? (hash ? `sha256 ${hash.slice(0, 12)}` : 'exists') : 'missing' })
      allOk &&= ok
    }
    if (Object.keys(hashes).length > 0) lock.entries[path] = hashes
    else delete lock.entries[path]
    if (stamp && allOk) {
      writeFileSync(join(root, path), `---\n${patchScalar(raw, 'verified_on', today(now), ['review_by', 'updated'])}\n---\n${body}`)
      stamped.push(path)
    }
  }
  const sorted = Object.fromEntries(Object.keys(lock.entries).sort().map((key) => [key, lock.entries[key]]))
  writeFileSync(join(root, config.docsDir, LOCK_FILE), `${JSON.stringify({ generated: 'scripts/verify-docs.mjs', entries: sorted }, null, 2)}\n`)
  return { results, stamped }
}

function flagValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

export function main() {
  const { results, stamped } = verifyDocs(repoRoot(), { only: flagValue('--only'), stamp: process.argv.includes('--stamp') })
  const failed = results.filter((r) => !r.ok)
  for (const { doc, entry, ok, detail } of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${doc} — ${entry} (${detail})`)
  for (const doc of stamped) console.log(`stamped verified_on on ${doc}`)
  console.log(`\nverify: ${results.length - failed.length} passed, ${failed.length} failed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

if (runDirect(import.meta.url)) main()
```

Gate rule in `scripts/check-docs.mjs` (import `readLock`, `parsePathEvidence`, `hashEvidence` from `./verify-docs.mjs` — no cycle, `verify-docs.mjs` does not import the gate): read the lock once before the loop; inside the evidence block (8b), for each entry with a lock hash for this doc, compare `hashEvidence(root, parsePathEvidence(entry))` with the stored value and `add('evidence-lock', path, 'evidence', `"${entry}" changed since it was verified — run \`ai-doc-system verify --only ${path} --stamp\``)` on mismatch. Add `'evidence-lock': 'warn'` to `RULES`.

`cli/cli.mjs`: `verify: ['verify-docs.mjs', 'run command evidence, hash path evidence, --stamp verified_on']`.

- [ ] **Step 4: Run all**, **Step 5: Commit**

```bash
git add scripts/verify-docs.mjs scripts/verify-docs.test.mjs scripts/check-docs.mjs scripts/docs-config.mjs cli/cli.mjs
git commit -m "feat: verify command — executable evidence and an evidence lock"
```

---

### Task 10: Status transitions and verbatim promotion — `check --base`

**Files:**
- Modify: `scripts/check-docs.mjs`, `scripts/docs-fs.mjs`
- Test: create `scripts/transitions.test.mjs`

**Interfaces:**
- Produces: `showAtRef(root, ref, path): string | null` in `docs-fs.mjs`. `checkDocs(root, config, { base })` adds `transition` and `promoted-verbatim` violations. Allowed edges (constant `TRANSITIONS` exported from `check-docs.mjs`):

```js
export const TRANSITIONS = {
  reference: ['draft', 'superseded'],
  draft: ['active', 'superseded'],
  active: ['shipped', 'superseded', 'draft'],
  shipped: ['superseded'],
  superseded: [],
}
```

Same-status is always allowed. A status outside the default vocabulary (a project's own) is never checked.

- [ ] **Step 1: Failing tests**

`scripts/transitions.test.mjs` (committing `gitFixture`, then edit and run `checkDocs(root, undefined, { base: 'HEAD' })` after regenerating the index):

```js
function regen(root) {
  execFileSync(process.execPath, [join(PACKAGE_ROOT, 'scripts', 'gen-docs-index.mjs')], { cwd: root, stdio: 'pipe' })
}
const fm = (status, extra = '') => `---\ntitle: X\nkind: product\nstatus: ${status}\nupdated: 2026-08-17\n${extra}---\n# X\n\nBody.\n`

test('a forward transition passes, a backward one fails, and no --base means no check', () => {
  const root = gitFixture({ 'docs/product/x.md': fm('shipped') })
  try {
    regen(root)
    execFileSync('git', ['add', '-A'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'index'], { cwd: root })
    writeFileSync(join(root, 'docs/product/x.md'), fm('draft'))
    regen(root)
    const violations = checkDocs(root, undefined, { base: 'HEAD' })
    const hit = violations.find((v) => v.rule === 'transition')
    assert.ok(hit)
    assert.match(hit.message, /shipped -> draft/)
    assert.ok(!checkDocs(root).some((v) => v.rule === 'transition'))
    writeFileSync(join(root, 'docs/product/x.md'), fm('superseded', 'superseded_by: docs/product/y.md\n'))
    writeFileSync(join(root, 'docs/product/y.md'), fm('active'))
    regen(root)
    assert.ok(!checkDocs(root, undefined, { base: 'HEAD' }).some((v) => v.rule === 'transition'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a promoted document whose body is identical to its origin at base fails', () => {
  const origin = '---\ntitle: X\nkind: reference\nstatus: reference\nupdated: 2026-08-17\n---\n# X\n\nCompetitor prose.\n'
  const root = gitFixture({ 'docs/reference/x.md': origin })
  try {
    regen(root)
    execFileSync('git', ['add', '-A'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'index'], { cwd: root })
    execFileSync('git', ['mv', 'docs/reference/x.md', 'docs/product/x.md'], { cwd: root })
    writeFileSync(join(root, 'docs/product/x.md'), '---\ntitle: X\nkind: product\nstatus: draft\nupdated: 2026-09-03\npromoted_from: docs/reference/x.md\n---\n# X\n\nCompetitor prose.\n')
    regen(root)
    assert.ok(checkDocs(root, undefined, { base: 'HEAD' }).some((v) => v.rule === 'promoted-verbatim'))
    writeFileSync(join(root, 'docs/product/x.md'), '---\ntitle: X\nkind: product\nstatus: draft\nupdated: 2026-09-03\npromoted_from: docs/reference/x.md\n---\n# X\n\nOur prose.\n')
    regen(root)
    assert.ok(!checkDocs(root, undefined, { base: 'HEAD' }).some((v) => v.rule === 'promoted-verbatim'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reference -> active skips draft and fails; promoted_from must name a document that existed at base', () => {
  const root = gitFixture({ 'docs/reference/x.md': '---\ntitle: X\nkind: reference\nstatus: reference\nupdated: 2026-08-17\n---\n# X\n' })
  try {
    regen(root)
    execFileSync('git', ['add', '-A'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'index'], { cwd: root })
    execFileSync('git', ['mv', 'docs/reference/x.md', 'docs/product/x.md'], { cwd: root })
    writeFileSync(join(root, 'docs/product/x.md'), '---\ntitle: X\nkind: product\nstatus: active\nupdated: 2026-09-03\npromoted_from: docs/reference/x.md\n---\n# X\n\nNew.\n')
    regen(root)
    const violations = checkDocs(root, undefined, { base: 'HEAD' })
    assert.ok(violations.some((v) => v.rule === 'transition' && /reference -> active/.test(v.message)))
    writeFileSync(join(root, 'docs/product/x.md'), '---\ntitle: X\nkind: product\nstatus: draft\nupdated: 2026-09-03\npromoted_from: docs/reference/nope.md\n---\n# X\n\nNew.\n')
    regen(root)
    assert.ok(checkDocs(root, undefined, { base: 'HEAD' }).some((v) => v.rule === 'promoted-verbatim' && /did not exist at HEAD/.test(v.message)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

`scripts/docs-fs.mjs`:

```js
/** File content at `ref:path`, or null when it did not exist there. */
export function showAtRef(root, ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
  } catch {
    return null
  }
}
```

`scripts/check-docs.mjs`, inside the loop, after the superseded block, guarded by `if (options.base)`:

```js
    if (options.base) {
      // transition: the status at base, at this path or at promoted_from, must
      // reach the status at head along an allowed edge. Statuses outside the
      // default vocabulary belong to the project and are not checked.
      const originPath = data.promoted_from ?? path
      const before = showAtRef(root, options.base, originPath)
      if (data.promoted_from && before === null) {
        add('promoted-verbatim', path, 'promoted_from', `names ${data.promoted_from}, which did not exist at ${options.base}`)
      }
      if (before !== null) {
        const prior = parseFrontmatter(before)
        const from = prior.data.status
        const to = data.status
        if (from && to && from !== to && from in TRANSITIONS && to in TRANSITIONS && !TRANSITIONS[from].includes(to)) {
          add('transition', path, 'status', `${from} -> ${to} is not an allowed transition — allowed from ${from}: ${TRANSITIONS[from].join(', ') || 'nothing'}`)
        }
        if (data.promoted_from && prior.body.trim() === body.trim()) {
          add('promoted-verbatim', path, 'promoted_from', `body is identical to ${data.promoted_from} at ${options.base} — rewrite the prose to describe this product`)
        }
      }
    }
```

`main()`: `const base = flagValue('--base')`; pass `{ base }` to `checkDocs`. Also, in the test helper `run` of `check-docs.test.mjs`, nothing changes.

- [ ] **Step 4: Run all**, **Step 5: Commit**

```bash
git add scripts/check-docs.mjs scripts/docs-fs.mjs scripts/transitions.test.mjs
git commit -m "feat(gate): --base checks status transitions and verbatim promotion"
```

---

### Task 11: Dependency staleness — `upstream` and `review` warnings

**Files:**
- Modify: `scripts/check-docs.mjs`
- Test: `scripts/check-docs.test.mjs`

**Interfaces:**
- Consumes: `checkDocs(root, config, { now })` where `now` is a `Date` (defaults to `new Date()`), used for `review`.

- [ ] **Step 1: Failing tests**

```js
test('15a. a document whose implements target was updated after it is a warning', () => {
  const violations = run({
    'docs/product/roadmap.md': doc({ title: 'R', kind: 'product', status: 'active', updated: '2026-09-01' }),
    'docs/plans/p.md': doc({ title: 'P', kind: 'plan', status: 'active', updated: '2026-08-01', implements: 'docs/product/roadmap.md' }),
  })
  const hit = violations.find((v) => v.rule === 'upstream')
  assert.ok(hit)
  assert.equal(hit.severity, 'warn')
  assert.equal(hit.file, 'docs/plans/p.md')
})

test('15b. review_by in the past is a warning; in the future it is silent', () => {
  const files = { 'docs/engineering/x.md': doc({ title: 'X', kind: 'engineering', status: 'active', updated: '2026-08-01', review_by: '2026-09-01' }) }
  const root = fixture(files)
  try {
    assert.ok(checkDocs(root, undefined, { now: new Date('2026-09-03T00:00:00Z') }).some((v) => v.rule === 'review'))
    assert.ok(!checkDocs(root, undefined, { now: new Date('2026-08-15T00:00:00Z') }).some((v) => v.rule === 'review'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

In the loop, collect `updatedByPath.set(path, data.updated)` and `implementsPairs.push({ path, target: data.implements.split('#')[0], updated: data.updated })` when `implements` is present. After the loop (second pass, like `changes`):

```js
  for (const { path, target, updated } of implementsPairs) {
    const upstream = updatedByPath.get(target)
    if (upstream && updated && upstream > updated) {
      add('upstream', path, 'updated', `${target} was updated ${upstream}, after this document (${updated}) — re-read it and bump updated`)
    }
  }
```

Inside the loop, after the `review_by` date check: `if (data.review_by && isIsoDate(data.review_by) && data.review_by < today(options.now)) add('review', path, 'review_by', `${data.review_by} has passed — review the document and move or remove the date`)`. Import `today`.

- [ ] **Step 4: Run all**, **Step 5: Commit**

```bash
git add scripts/check-docs.mjs scripts/check-docs.test.mjs
git commit -m "feat(gate): upstream and review warnings"
```

---

### Task 12: Plugin hooks — enforce at read and edit time

**Files:**
- Create: `hooks/hooks.json`, `hooks/reference-read.mjs`, `hooks/docs-edit.mjs`, `scripts/hooks.test.mjs`
- Modify: `package.json` (`files` gains `hooks`), `.claude-plugin/plugin.json` (if the hooks contract needs a key there)

**Interfaces:**
- Hook scripts read the hook JSON from stdin, print a JSON object on stdout, exit 0. They must never exit 2 (blocking) — the gate blocks at push; the hooks inform.

Contract: see the hooks contract section appended at the end of this plan (filled from the Claude Code docs before dispatch). If the contract there says PreToolUse cannot inject context, the read hook prints nothing and exits 0, and the design note in Task 14 says so.

- [ ] **Step 1: Failing tests**

`scripts/hooks.test.mjs`:

```js
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const hook = (name, payload, cwd) => execFileSync(process.execPath, [join(PACKAGE_ROOT, 'hooks', name)], { cwd, input: JSON.stringify(payload), encoding: 'utf8', stdio: 'pipe' })

function gitFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-hook-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' })
  return root
}

test('reading a reference document injects the not-a-commitment reminder', () => {
  const root = gitFixture({ 'docs/reference/x.md': '---\ntitle: X\nkind: reference\nstatus: reference\nupdated: 2026-08-17\n---\n# X\n' })
  try {
    const out = JSON.parse(hook('reference-read.mjs', { tool_name: 'Read', tool_input: { file_path: join(root, 'docs/reference/x.md') }, cwd: root }, root))
    assert.match(out.hookSpecificOutput.additionalContext, /status: reference/)
    assert.match(out.hookSpecificOutput.additionalContext, /not a commitment/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reading a non-reference document prints nothing', () => {
  const root = gitFixture({ 'docs/engineering/x.md': '---\ntitle: X\nkind: engineering\nstatus: active\nupdated: 2026-08-17\n---\n# X\n' })
  try {
    assert.equal(hook('reference-read.mjs', { tool_name: 'Read', tool_input: { file_path: join(root, 'docs/engineering/x.md') }, cwd: root }, root).trim(), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('editing a document under docs/ runs the gate and reports its violations', () => {
  const root = gitFixture({ 'docs/engineering/x.md': '# no frontmatter\n' })
  try {
    const out = JSON.parse(hook('docs-edit.mjs', { tool_name: 'Write', tool_input: { file_path: join(root, 'docs/engineering/x.md') }, cwd: root }, root))
    assert.match(out.hookSpecificOutput.additionalContext, /frontmatter/)
    assert.match(out.hookSpecificOutput.additionalContext, /check-docs/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('editing outside docs/ prints nothing', () => {
  const root = gitFixture({ 'src/a.ts': 'x' })
  try {
    assert.equal(hook('docs-edit.mjs', { tool_name: 'Edit', tool_input: { file_path: join(root, 'src/a.ts') }, cwd: root }, root).trim(), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

`hooks/reference-read.mjs`:

```js
#!/usr/bin/env node
/**
 * PreToolUse hook on Read. When the file being read is a document whose
 * status is `reference`, add one line of context: this is not a commitment.
 * The load-bearing rule of the design (section 6.3) enforced at read time,
 * one turn before an agent could act on the document. Never blocks.
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { parseFrontmatter } from '../scripts/docs-frontmatter.mjs'
import { loadConfig } from '../scripts/docs-config.mjs'

const payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
const file = payload.tool_input?.file_path
const root = payload.cwd ?? process.cwd()
if (file && `${file}`.endsWith('.md')) {
  const full = isAbsolute(file) ? file : join(root, file)
  const rel = relative(root, full).split(/[\\/]/).join('/')
  let config
  try {
    config = loadConfig(root)
  } catch {
    config = null
  }
  if (config && rel.startsWith(`${config.docsDir}/`) && existsSync(full)) {
    const { data } = parseFrontmatter(readFileSync(full, 'utf8'))
    if (data.status === 'reference') {
      const context = `${rel} has status: reference — captured from elsewhere, NOT a commitment, never a build spec. Do not implement from it. To act on it, promote it first: ai-doc-system mv ${rel} ${config.docsDir}/product/<name>.md, then rewrite the prose.`
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context } }))
    }
  }
}
process.exit(0)
```

`hooks/docs-edit.mjs`:

```js
#!/usr/bin/env node
/**
 * PostToolUse hook on Write and Edit. When the written file is under the docs
 * tree, run the gate and hand its violations back as context, so the agent
 * fixes frontmatter or regenerates the index in the same turn instead of at
 * push time. Never blocks; the blocking gate is `check` in CI.
 */
import { readFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { checkDocs } from '../scripts/check-docs.mjs'
import { loadConfig } from '../scripts/docs-config.mjs'

const payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
const file = payload.tool_input?.file_path
const root = payload.cwd ?? process.cwd()
if (file) {
  const full = isAbsolute(file) ? file : join(root, file)
  const rel = relative(root, full).split(/[\\/]/).join('/')
  let config
  try {
    config = loadConfig(root)
  } catch {
    config = null
  }
  if (config && rel.startsWith(`${config.docsDir}/`)) {
    const violations = checkDocs(root, config)
    if (violations.length > 0) {
      const lines = violations.slice(0, 20).map((v) => `${v.file}:${v.field} — ${v.message} [${v.rule}, ${v.severity}]`)
      const context = `check-docs found ${violations.length} issue(s) after this edit:\n${lines.join('\n')}${violations.length > 20 ? '\n…' : ''}\nFix frontmatter, or run \`ai-doc-system gen\` if the index is stale.`
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }))
    }
  }
}
process.exit(0)
```

`hooks/hooks.json` (adjust to the contract section at the end of this plan):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read",
        "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/reference-read.mjs\"", "timeout": 10 }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/docs-edit.mjs\"", "timeout": 30 }]
      }
    ]
  }
}
```

`package.json` `files`: add `"hooks"`. Note the hook scripts import from `../scripts/`, which works both in the plugin checkout and in `node_modules/@puralex/ai-doc-system`. `checkDocs` in the edit hook uses `repoRoot()`-free paths: it takes `root` from the payload, so no git call is needed.

- [ ] **Step 4: Run all**, **Step 5: Commit**

```bash
git add hooks/ scripts/hooks.test.mjs package.json .claude-plugin/plugin.json
git commit -m "feat(plugin): read-time reference reminder and edit-time gate hooks"
```

---

### Task 13: Context packs and JSONL export

**Files:**
- Create: `scripts/context-docs.mjs`, `scripts/context-docs.test.mjs`
- Modify: `cli/cli.mjs`

**Interfaces:**
- Produces: `selectDocs(root, { kind, status, module, paths }, config)` → index entries filtered (all filters optional, comma-separated lists allowed, `paths` is an array of repo-relative paths). `renderContext(root, entries, { maxChars })` → string: for each entry, a banner then the body; stops adding whole documents when the next one would exceed `maxChars`, and ends with a line `[context: N of M documents included; omitted: …paths]` when anything was omitted. `renderJsonl(root, entries)` → string of one JSON object per line: `{ path, title, kind, status, updated, module?, summary?, source_url?, heading, level, text }`, one per heading section (the text before the first heading is `heading: ''`, `level: 0`).

Banner format, exactly:

```
===== docs/product/invoices.md =====
KIND: product · STATUS: active · UPDATED: 2026-08-17
AUTHORITY: committed scope — build from this.
```

The `AUTHORITY` line by status: `reference` → `captured from elsewhere — NOT a commitment, never a build spec`; `draft` → `being written — not yet agreed`; `active` → `agreed and current — build from this`; `shipped` → `built and verified — code: <code or "unset">`; `superseded` → `replaced by <superseded_by> — do not use`; any other status → `project-defined status "<status>"`.

- [ ] **Step 1: Failing tests**

```js
test('selectDocs filters by kind, status and path', () => {
  const root = fixture({
    'docs/reference/r.md': doc({ title: 'R', kind: 'reference', status: 'reference', updated: '2026-08-17' }),
    'docs/product/p.md': doc({ title: 'P', kind: 'product', status: 'active', updated: '2026-08-17' }),
    'docs/plans/q.md': doc({ title: 'Q', kind: 'plan', status: 'active', updated: '2026-08-17' }),
  })
  try {
    assert.deepEqual(selectDocs(root, { kind: 'product,plan' }).map((e) => e.path), ['docs/plans/q.md', 'docs/product/p.md'])
    assert.deepEqual(selectDocs(root, { status: 'reference' }).map((e) => e.path), ['docs/reference/r.md'])
    assert.deepEqual(selectDocs(root, { paths: ['docs/product/p.md'] }).map((e) => e.path), ['docs/product/p.md'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('renderContext stamps an authority banner on every document and respects the budget', () => {
  const root = fixture({
    'docs/reference/r.md': doc({ title: 'R', kind: 'reference', status: 'reference', updated: '2026-08-17' }),
    'docs/product/p.md': doc({ title: 'P', kind: 'product', status: 'active', updated: '2026-08-17' }),
  })
  try {
    const entries = selectDocs(root, {})
    const all = renderContext(root, entries, {})
    assert.match(all, /===== docs\/product\/p\.md =====\nKIND: product · STATUS: active · UPDATED: 2026-08-17\nAUTHORITY: agreed and current — build from this\./)
    assert.match(all, /NOT a commitment/)
    const small = renderContext(root, entries, { maxChars: 200 })
    assert.match(small, /\[context: 1 of 2 documents included; omitted: docs\/reference\/r\.md\]/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('renderJsonl emits one record per heading with the frontmatter on every record', () => {
  const root = fixture({ 'docs/product/p.md': '---\ntitle: P\nkind: product\nstatus: active\nupdated: 2026-08-17\nsummary: S\n---\nIntro.\n\n# One\n\nA.\n\n## Two\n\nB.\n' })
  try {
    const records = renderJsonl(root, selectDocs(root, {})).trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(records.length, 3)
    assert.deepEqual(records.map((r) => [r.heading, r.level]), [['', 0], ['One', 1], ['Two', 2]])
    assert.ok(records.every((r) => r.status === 'active' && r.summary === 'S' && r.path === 'docs/product/p.md'))
    assert.equal(records[2].text.trim(), 'B.')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

Copy `fixture` and `doc` from `scripts/check-docs.test.mjs` into this test file (they are not exported).

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

`scripts/context-docs.mjs`:

```js
#!/usr/bin/env node
/**
 * `ai-doc-system context [--kind a,b] [--status s] [--module m] [--max-chars N] [paths…]`
 *   emits the selected documents with an AUTHORITY banner on each, within a
 *   character budget, so a document pasted into a conversation still says
 *   what it is.
 * `ai-doc-system export --jsonl [same filters]`
 *   emits one JSON record per heading section, frontmatter on every record,
 *   for RAG stores that chunk — the place where a document's status used to
 *   get lost.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { buildIndex } from './gen-docs-index.mjs'
import { repoRoot } from './docs-fs.mjs'
import { runDirect } from './docs-run.mjs'

const list = (value) => (value ? `${value}`.split(',').map((s) => s.trim()).filter(Boolean) : null)

export function selectDocs(root, { kind, status, module: moduleKey, paths } = {}, config = loadConfig(root)) {
  const kinds = list(kind)
  const statuses = list(status)
  const modules = list(moduleKey)
  const wanted = paths && paths.length > 0 ? new Set(paths) : null
  return buildIndex(root, config).filter(
    (entry) =>
      (!kinds || kinds.includes(entry.kind)) &&
      (!statuses || statuses.includes(entry.status)) &&
      (!modules || modules.includes(entry.module)) &&
      (!wanted || wanted.has(entry.path)),
  )
}

function authority(entry) {
  switch (entry.status) {
    case 'reference': return 'captured from elsewhere — NOT a commitment, never a build spec'
    case 'draft': return 'being written — not yet agreed'
    case 'active': return 'agreed and current — build from this'
    case 'shipped': return `built and verified — code: ${entry.code ?? 'unset'}`
    case 'superseded': return `replaced by ${entry.superseded_by ?? 'unset'} — do not use`
    default: return `project-defined status "${entry.status}"`
  }
}

export function banner(entry) {
  const meta = [`KIND: ${entry.kind}`, ...(entry.module ? [`MODULE: ${entry.module}`] : []), `STATUS: ${entry.status}`, `UPDATED: ${entry.updated}`]
  return `===== ${entry.path} =====\n${meta.join(' · ')}\nAUTHORITY: ${authority(entry)}.`
}

export function renderContext(root, entries, { maxChars = Infinity } = {}) {
  const blocks = []
  const omitted = []
  let used = 0
  for (const entry of entries) {
    const { body } = parseFrontmatter(readFileSync(join(root, entry.path), 'utf8'))
    const block = `${banner(entry)}\n\n${body.trim()}\n`
    if (used + block.length > maxChars && blocks.length > 0) {
      omitted.push(entry.path)
      continue
    }
    blocks.push(block)
    used += block.length
  }
  let out = blocks.join('\n')
  if (omitted.length > 0) out += `\n[context: ${blocks.length} of ${entries.length} documents included; omitted: ${omitted.join(', ')}]\n`
  return out
}

/** Split a body into heading sections. The preamble before the first heading is level 0. */
export function sections(body) {
  const out = [{ heading: '', level: 0, lines: [] }]
  let inFence = false
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence
    const match = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (match) out.push({ heading: match[2], level: match[1].length, lines: [] })
    else out[out.length - 1].lines.push(line)
  }
  return out.map(({ heading, level, lines }) => ({ heading, level, text: lines.join('\n').trim() })).filter((s) => s.text || s.heading)
}

export function renderJsonl(root, entries) {
  const lines = []
  for (const entry of entries) {
    const { body } = parseFrontmatter(readFileSync(join(root, entry.path), 'utf8'))
    const base = { path: entry.path, title: entry.title, kind: entry.kind, ...(entry.module ? { module: entry.module } : {}), status: entry.status, updated: entry.updated, ...(entry.summary ? { summary: entry.summary } : {}), ...(entry.source_url ? { source_url: entry.source_url } : {}) }
    for (const { heading, level, text } of sections(body)) lines.push(JSON.stringify({ ...base, heading, level, text }))
  }
  return `${lines.join('\n')}\n`
}

function flagValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

export function main() {
  const root = repoRoot()
  const args = process.argv.slice(2)
  const flagNames = new Set(['--kind', '--status', '--module', '--max-chars'])
  const paths = args.filter((arg, i) => !arg.startsWith('--') && !flagNames.has(args[i - 1]))
  const entries = selectDocs(root, { kind: flagValue('--kind'), status: flagValue('--status'), module: flagValue('--module'), paths })
  if (args.includes('--jsonl')) process.stdout.write(renderJsonl(root, entries))
  else process.stdout.write(renderContext(root, entries, { maxChars: flagValue('--max-chars') ? Number(flagValue('--max-chars')) : Infinity }))
}

if (runDirect(import.meta.url)) main()
```

`cli/cli.mjs`: `context: ['context-docs.mjs', 'selected documents with an authority banner, within a budget']` and `export: ['context-docs.mjs', 'one JSON record per heading (--jsonl) for RAG stores']`. Both dispatch to the same module; `export` should imply `--jsonl` — in `cli.mjs`, when `command === 'export'` and `--jsonl` is absent, push it onto `process.argv` before importing.

- [ ] **Step 4: Run all**, **Step 5: Commit**

```bash
git add scripts/context-docs.mjs scripts/context-docs.test.mjs cli/cli.mjs
git commit -m "feat(cli): context packs and jsonl export"
```

---

### Task 14: Documentation, ADR, design record, README, SKILL, templates, CONTRIBUTING

**Files:**
- Create: `docs/engineering/adr/0001-store-kind-in-frontmatter.md`
- Modify: `docs/engineering/design.md`, `README.md`, `SKILL.md`, `templates/docs-README.template.md`, `CONTRIBUTING.md`, `docs/README.md`, `scripts/init-docs.mjs` (README text and `SCRIPTS` gain `docs:impact` → `ai-doc-system impact`), `site/public/llms.txt`

No tests beyond the gate: `npm run lint:docs` must stay OK, so regenerate the index after every docs change.

- [ ] **Step 1: ADR**

Create `docs/engineering/adr/0001-store-kind-in-frontmatter.md` with frontmatter (`title: "ADR 0001: store kind in frontmatter as well as deriving it from the path"`, `summary`, `kind: adr`, `status: active`, `updated: 2026-09-03`). Body: move the "Reversal, 2026-08-23" paragraph from design §4.1 here verbatim under "## Decision", add "## Context" (two sentences: the original rule, and why it was wrong) and "## Consequences" (`git mv` alone no longer re-tiers; `fix` and `mv` restamp). In design §4.1, replace the blockquote with one line: `The reversal that introduced the stored field is recorded in engineering/adr/0001-store-kind-in-frontmatter.md.` as a Markdown link whose target is `adr/0001-store-kind-in-frontmatter.md`.

- [ ] **Step 2: Design record**

In `docs/engineering/design.md`:
- §2, after alternative C, add **D — frontmatter authoritative, path free.** "Considered 2026-09-03, after `kind` became a stored field. With `kind` stored, the path rule is what keeps the two in sync and gives humans a browsable tree; dropping it would make a document's authority invisible in a directory listing and would leave two sources of truth with no assertion between them. Rejected; the path stays the derivation source and the stored field its mirror."
- §4.1: add the new optional fields with one line each: `summary`, `source_url`, `review_by`, `promoted_from`.
- §5.2: replace the numbered assertion list's intro with the rule table (ids and default severities) from this plan; add `transition`, `promoted-verbatim` under a `--base` paragraph; add the `warn` rules; state that `rules` in config changes severity, `off` disables.
- §5.3: keep the list, add "and what is `warn` by default: `shipped-code`, `upstream`, `review`, `evidence-lock`, plus the git-based advisory reports."
- New §5.6 "Impact" (reverse index, `impact --base`), §5.7 "Executable evidence" (`verify`, the lock, the security note: it runs commands written in frontmatter; explicit invocation only), §6.4 "Hooks" (read-time and edit-time; what each injects; never blocks), §6.5 "Context packs" (banner, budget, JSONL export).
- §7 limitation 6: append "Command-form evidence can now be executed with `verify`; the check still cannot tell a truthful command from a tautological one."
- Bump `updated` to `2026-09-03`.

- [ ] **Step 3: README, SKILL, template, init, llms.txt, CONTRIBUTING, docs/README**

- `README.md`: "What you get" table gains rows for `new`, `mv`, `impact`, `verify`, `context`/`export`, hooks, schema. "What the gate asserts" becomes the rule table with severities. Frontmatter block shows `summary` and `source_url`. "Using it" lists the new commands and the `--json` / `--format github` / `--base origin/main` flags, with one CI snippet:

```yaml
- run: npx ai-doc-system check --format github --base origin/${{ github.base_ref || 'main' }}
- run: npx ai-doc-system impact --base origin/${{ github.base_ref || 'main' }}
```

- `SKILL.md` §4 add: "Add a document with `ai-doc-system new <path> --title … --summary …`. Move or promote with `ai-doc-system mv <from> <to>` — it restamps and records `promoted_from`; you still rewrite the prose." §5 add: "Before claiming a state document is current, run `ai-doc-system verify --only <path> --stamp`." Mention `impact --base` in §2's wiring block as a non-blocking PR step.
- `templates/docs-README.template.md` and the README string in `scripts/init-docs.mjs`: add `summary` to the frontmatter example; mention `new` and `mv`. `SCRIPTS` in `init-docs.mjs` gains `'docs:impact': 'ai-doc-system impact'`; update `scripts/init-docs.test.mjs` if it enumerates script keys.
- `CONTRIBUTING.md`: replace "95 tests, throwaway fixture trees" with "throwaway fixture trees".
- `docs/README.md` (this repo): tier table gains `engineering/adr/`.
- `site/public/llms.txt`: list the new commands in the Package section.
- Regenerate: `npm run gen:docs-index`; run `npm run lint:docs`.

- [ ] **Step 4: Commit**

```bash
git add docs/ README.md SKILL.md templates/ CONTRIBUTING.md scripts/init-docs.mjs scripts/init-docs.test.mjs site/public/llms.txt
git commit -m "docs: ADR 0001, design record for the 2026-09 round, README/SKILL/template updates"
```

---

### Task 15: Release prep and PR

**Files:**
- Modify: `package.json` (version `1.3.0`), `.claude-plugin/plugin.json` (version `1.3.0`), `CHANGELOG.md`, `.github/workflows/test.yml`

- [ ] **Step 1: CHANGELOG**

Add `## [1.3.0] - 2026-09-03` with Added (rule ids and `rules` severity config; `summary`, `source_url`, `review_by`, `promoted_from`; `new`, `mv`, `impact`, `verify`, `context`, `export`; `check --json`, `--format github`, `--base`; `by_code` in `index.json`; plugin hooks; JSON schema; `evidenceRunners`; `+` array extension), Changed (`INDEX.md` gains a Summary column; advisory uses one git walk; `docs-system.config.json` may use `+` keys), Fixed (URLs no longer trip the tracked-reference scan; impossible dates rejected; `implements`/`superseded_by`/`evidence` resolve case-exactly; `shipped` without `code:` is reported). Add the compare link at the bottom.

- [ ] **Step 2: CI**

In `.github/workflows/test.yml` `test` job, after `npm run lint:docs:advisory`, add:

```yaml
      - run: npm run lint:docs -- --format github
      - run: node scripts/impact-docs.mjs --base origin/main
        if: github.event_name == 'pull_request'
```

The checkout needs history for `--base`: add `with: { fetch-depth: 0 }` to `actions/checkout@v7` in that job.

- [ ] **Step 3: Full verification**

Run: `npm ci && npm test && npm run lint:docs && npm run lint:docs:advisory && node cli/cli.mjs check --json | head -5 && node cli/cli.mjs impact`
Expected: tests pass, `check-docs: OK`, JSON report `"ok": true`, impact prints a line.

Pack smoke, locally:

```bash
TARBALL="$PWD/$(npm pack | tail -1)"; FIXTURE=$(mktemp -d); cd "$FIXTURE"; git init -q; npm init -y >/dev/null; npm install "$TARBALL"; npx ai-doc-system init; npx ai-doc-system new docs/product/hello.md --title Hello --summary "First doc."; npx ai-doc-system check; npx ai-doc-system context --kind product; cd -; rm -rf "$FIXTURE"
```

- [ ] **Step 4: Commit and PR**

```bash
git add package.json .claude-plugin/plugin.json CHANGELOG.md .github/workflows/test.yml
git commit -m "chore(release): 1.3.0"
git push -u origin feat/architecture-2026-09
gh pr create --title "feat: architecture round 2026-09 — rule engine, impact, verify, hooks, transitions, context packs" --body-file <(printf '%s\n' "Closes the debt backlog in docs/plans/debt.md and lands the seven approved architecture changes. Plan: docs/plans/architecture-2026-09.md." "" "https://claude.ai/code/session_01GEAgt75tcCns9EJzdmC391")
```

Do not tag or publish. The release tag is the user's call.

---

## Hooks contract (from the Claude Code documentation, 2026-09-03)

Source: https://code.claude.com/docs/en/hooks-reference.md and https://code.claude.com/docs/en/plugins-reference.md.

- A plugin declares hooks in `hooks/hooks.json` at the plugin root. Shape: `{ "hooks": { "<Event>": [ { "matcher": "<regex>", "hooks": [ { "type": "command", "command": "<string>", "timeout": <seconds> } ] } ] } }`.
- `${CLAUDE_PLUGIN_ROOT}` resolves to the plugin install directory inside the command string, and is also exported as an environment variable to the spawned process.
- Matcher: pipe-separated tool names, `Write|Edit`. Regex allowed.
- stdin for PreToolUse: `{ "session_id", "cwd", "hook_event_name": "PreToolUse", "tool_name": "Read", "tool_input": { "file_path": "/abs/path" }, "tool_use_id" }`.
- stdin for PostToolUse: same plus `"tool_result"`; `tool_input.file_path` is present for Write and Edit.
- stdout to add context without blocking, exit 0: `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": "..." } }`. `permissionDecision` is optional; omit it so the tool call proceeds normally. PostToolUse: same shape with `"hookEventName": "PostToolUse"`.
- Exit 0 with empty stdout: nothing happens. Exit 2: blocks and shows stderr to Claude. The hooks in Task 12 always exit 0.
