/**
 * Tests for the documentation gate. One passing and one failing case per
 * assertion in check-docs.mjs, built on throwaway fixture trees so no test
 * depends on the real `docs/`. The fixtures are not git repositories, which
 * also exercises the non-git fallback of the tracked-reference scan (5b).
 *
 * Run: node --test scripts/check-docs.test.mjs
 *
 * Uses `node:test` rather than a project's own test framework deliberately — see
 * the design's section 5.5 (github.com/magnifito/ai-doc-system): the scripts need
 * only Node plus the `yaml` package, and the suite is wired into the host
 * project's blocking gate next to `lint:docs`.
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { checkDocs } from './check-docs.mjs'
import { buildIndex, renderMarkdown, renderIndex } from './gen-docs-index.mjs'
import { DEFAULTS, RULES, clearConfigCache, loadConfig, withDerived } from './docs-config.mjs'


/**
 * Build a fixture repo whose docs/ contains exactly `files`, with a fresh index.
 * `config` is the project's overrides; the index has to be built with the SAME
 * resolved config the gate will use, or assertion 4 reports staleness that is
 * an artefact of the fixture rather than a defect.
 */
function fixture(files, { withIndex = true, config } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'docs-gate-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  mkdirSync(join(root, 'docs'), { recursive: true })
  if (withIndex) {
    const resolved = config ? withDerived({ ...DEFAULTS, ...config }) : undefined
    for (const [path, content] of renderIndex(root, resolved)) {
      mkdirSync(join(root, dirname(path)), { recursive: true })
      writeFileSync(join(root, path), content)
    }
  }
  return root
}

function run(files, options) {
  const root = fixture(files, options)
  try {
    return checkDocs(
      root,
      options?.config
        ? withDerived({ ...DEFAULTS, ...options.config, rules: { ...RULES, ...(options.config.rules ?? {}) } })
        : undefined,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function doc(fields) {
  const lines = []
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) lines.push(`${key}:`, ...value.map((item) => `  - ${JSON.stringify(item)}`))
    else lines.push(`${key}: ${value}`)
  }
  return `---\n${lines.join('\n')}\n---\n\n# ${fields.title ?? 'Doc'}\n\nBody.\n`
}

const GOOD = doc({ title: 'Quality gate', kind: 'engineering', status: 'active', updated: '2026-08-17' })

test('1a. a well-formed doc produces no violations', () => {
  assert.deepEqual(run({ 'docs/engineering/quality-gate.md': GOOD }), [])
})

test('1b. missing frontmatter is a violation', () => {
  const violations = run({ 'docs/engineering/bare.md': '# Bare\n' })
  assert.ok(violations.some((v) => v.field === 'frontmatter'))
})

test('2a. a reference doc with status reference passes', () => {
  const violations = run({
    'docs/reference/contacts/smart-lists.md': doc({
      title: 'Smart Lists', kind: 'reference', status: 'reference', updated: '2026-05-29',
    }),
  })
  assert.deepEqual(violations, [])
})

test('2b. an unknown status is rejected', () => {
  const violations = run({
    'docs/engineering/x.md': doc({ title: 'X', status: 'banana', updated: '2026-08-17' }),
  })
  assert.ok(violations.some((v) => v.field === 'status' && v.message.includes('banana')))
})

test('2c. a kind field that disagrees with the path is rejected', () => {
  // `kind` used to be FORBIDDEN in frontmatter, on the argument that storing a
  // derived value buys an assertion whose only job is to check the duplication.
  // It is required now: a document is routinely read outside its tree — pasted
  // into a conversation, handed to an agent as a blob — and has to say what it
  // is. The duplication is safe because this assertion makes drift impossible.
  const violations = run({
    'docs/engineering/x.md': doc({ title: 'X', kind: 'plan', status: 'active', updated: '2026-08-17' }),
  })
  assert.ok(violations.some((v) => v.field === 'kind' && v.message.includes('implies "engineering"')))
})

test('2d. a missing kind field is rejected', () => {
  const violations = run({
    'docs/engineering/x.md': doc({ title: 'X', status: 'active', updated: '2026-08-17' }),
  })
  assert.ok(violations.some((v) => v.field === 'kind' && /missing/.test(v.message)))
})

test('2d. status reference outside docs/reference/ is rejected', () => {
  const violations = run({
    'docs/engineering/x.md': doc({ title: 'X', status: 'reference', updated: '2026-08-17' }),
  })
  assert.ok(violations.some((v) => v.field === 'status' && v.message.includes('reserved')))
})

test('2e. a reference doc with a non-reference status is rejected', () => {
  const violations = run({
    'docs/reference/contacts/x.md': doc({ title: 'X', status: 'active', updated: '2026-05-29' }),
  })
  assert.ok(violations.some((v) => v.field === 'status'))
})

test('2f. an implements target must exist when the field is present', () => {
  const bad = run({
    'docs/plans/x.md': doc({ title: 'X', status: 'active', updated: '2026-08-17', implements: 'docs/product/ROADMAP.md#4' }),
  })
  assert.ok(bad.some((v) => v.field === 'implements'))
  const good = run({
    'docs/product/ROADMAP.md': doc({ title: 'Roadmap', status: 'active', updated: '2026-08-17' }),
    'docs/plans/x.md': doc({ title: 'X', status: 'active', updated: '2026-08-17', implements: 'docs/product/ROADMAP.md#4' }),
  })
  assert.deepEqual(good.filter((v) => v.field === 'implements'), [])
})

test('3a. kebab-case names and ALL-CAPS sentinels pass', () => {
  const violations = run({
    'docs/plans/big-plan.md': doc({ title: 'Big plan', status: 'active', updated: '2026-08-17' }),
    'docs/reference/payments/PRD.md': doc({ title: 'Payments', status: 'reference', updated: '2026-05-29' }),
    'docs/reference/payments/README.md': doc({ title: 'Payments', status: 'reference', updated: '2026-05-29' }),
  })
  assert.deepEqual(violations.filter((v) => v.field === 'path'), [])
})

test('3c. an ALL-CAPS name that is not a sentinel is rejected', () => {
  const violations = run({
    'docs/plans/BIG-PLAN.md': doc({ title: 'Big plan', status: 'active', updated: '2026-08-17' }),
  })
  const paths = violations.filter((v) => v.field === 'path')
  assert.equal(paths.length, 1)
  assert.match(paths[0].message, /not a sentinel/)
})

test('3d. the same concept in two casings cannot both be legal', () => {
  // The defect this rule exists for: hygiene alone accepted both of these.
  const violations = run({
    'docs/reference/a/scrum-tasks.md': doc({ title: 'A', status: 'reference', updated: '2026-05-29' }),
    'docs/reference/b/SCRUM-TASKS.md': doc({ title: 'B', status: 'reference', updated: '2026-05-29' }),
  })
  const paths = violations.filter((v) => v.field === 'path')
  assert.equal(paths.length, 1)
  assert.ok(paths[0].file.endsWith('SCRUM-TASKS.md'))
})

test('3b. spaces, ampersands, MixedCase and underscores are rejected', () => {
  const violations = run({
    'docs/Reporting/Tracking & Attribution/PRD.md': GOOD,
    'docs/engineering/snake_case.md': GOOD,
  })
  const paths = violations.filter((v) => v.field === 'path')
  assert.ok(paths.length >= 3)
})

test('3e. a link through a wrong-case directory segment is dead', () => {
  // existsSync resolves `../Engineering/d.md` on macOS and Windows; the tree
  // then breaks only on Linux. Every segment must match the real listing.
  const violations = run({
    'docs/engineering/a.md': doc({ title: 'A', kind: 'engineering', status: 'active', updated: '2026-08-17' }) +
      '[d](../Engineering/d.md)\n',
    'docs/engineering/d.md': doc({ title: 'D', kind: 'engineering', status: 'active', updated: '2026-08-17' }),
  })
  assert.equal(violations.filter((v) => v.field === 'link').length, 1)
})

test('4a. a freshly generated index is accepted', () => {
  assert.deepEqual(run({ 'docs/engineering/quality-gate.md': GOOD }).filter((v) => v.field === 'index'), [])
})

test('4c. an index checked out with CRLF line endings is not stale', () => {
  // Git on Windows defaults to autocrlf=true, so a committed LF index arrives
  // as CRLF. Same bytes-per-line content — only the line terminator differs.
  const root = fixture({ 'docs/engineering/quality-gate.md': GOOD })
  try {
    for (const name of ['docs/index.json', 'docs/INDEX.md']) {
      const lf = readFileSync(join(root, name), 'utf8')
      writeFileSync(join(root, name), lf.replaceAll('\n', '\r\n'))
    }
    assert.deepEqual(checkDocs(root).filter((v) => v.field === 'index'), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('4b. a stale or missing index fails', () => {
  const violations = run({ 'docs/engineering/quality-gate.md': GOOD }, { withIndex: false })
  assert.equal(violations.filter((v) => v.field === 'index').length, 2)
})

test('5a. live relative and root-relative links pass', () => {
  const violations = run({
    'docs/engineering/a.md': doc({ title: 'A', status: 'active', updated: '2026-08-17' }) +
      '[b](./b.md) [b again](docs/engineering/b.md)\n',
    'docs/engineering/b.md': doc({ title: 'B', status: 'active', updated: '2026-08-17' }),
  })
  assert.deepEqual(violations.filter((v) => v.field === 'link'), [])
})

test('5b. dead relative and root-relative links fail; external links are ignored', () => {
  const violations = run({
    'docs/engineering/a.md': doc({ title: 'A', status: 'active', updated: '2026-08-17' }) +
      '[gone](./gone.md) [also gone](docs/product/gone.md) [ext](https://example.com/x.md)\n',
  })
  assert.equal(violations.filter((v) => v.field === 'link').length, 2)
})

test('5d. a dead reference-style link definition fails', () => {
  const violations = run({
    'docs/engineering/a.md': doc({ title: 'A', kind: 'engineering', status: 'active', updated: '2026-08-17' }) +
      'See [gone][g].\n\n[g]: ./gone.md\n',
  })
  assert.equal(violations.filter((v) => v.field === 'link').length, 1)
})

test('5c. without git, docs paths named by AGENTS.md and CLAUDE.md must exist', () => {
  const violations = run({
    'AGENTS.md': 'Read docs/engineering/quality-gate.md and docs/missing.md.\n',
    'CLAUDE.md': 'See docs/also-missing.md.\n',
    'docs/engineering/quality-gate.md': GOOD,
  })
  const dead = violations.filter((v) => v.file === '(repo)')
  assert.equal(dead.length, 2)
})

test('6a. superseded with a live superseded_by passes', () => {
  const violations = run({
    'docs/archive/old.md': doc({
      title: 'Old', kind: 'archive', status: 'superseded', updated: '2026-08-09',
      superseded_by: 'docs/engineering/quality-gate.md',
    }),
    'docs/engineering/quality-gate.md': GOOD,
  })
  assert.deepEqual(violations, [])
})

test('6b. superseded without superseded_by fails, and archive must be superseded', () => {
  const violations = run({
    'docs/archive/old.md': doc({ title: 'Old', status: 'active', updated: '2026-08-09' }),
    'docs/engineering/x.md': doc({ title: 'X', status: 'superseded', updated: '2026-08-17' }),
  })
  assert.ok(violations.some((v) => v.file === 'docs/archive/old.md' && v.field === 'status'))
  assert.ok(violations.some((v) => v.file === 'docs/engineering/x.md' && v.field === 'superseded_by'))
})

// ── assertions 7, 8 and 9: modules, families, evidence ────────────────────────

const MODULE_CONFIG = {
  tiers: [
    ['modules/*/reference/', 'reference'],
    ['modules/*/archive/', 'archive'],
    ['modules/*/state/', 'state'],
    ['modules/*/todo/', 'todo'],
    ['platform/state/', 'state'],
    ['platform/todo/', 'todo'],
  ],
  tierStatus: { reference: 'reference', archive: 'superseded' },
  tierOrder: ['state', 'todo', 'reference', 'archive'],
  indexSubdivide: [],
  exempt: ['INDEX.md', 'README.md', 'ROADMAP.md', 'modules/*/README.md'],
  modules: [
    { key: 'core', class: 'core', requires: [] },
    { key: 'crm', class: 'anchor', requires: [] },
  ],
  requiredFields: { state: ['verified_on', 'evidence'], todo: ['commitment', 'changes'] },
  vocabularies: { commitment: ['committed', 'optional'] },
}

/** Fixture whose docs/ uses the module tier map. */
function runModular(files, options) {
  const root = fixture(
    { ...files, 'docs-system.config.json': JSON.stringify(MODULE_CONFIG) },
    { ...options, config: MODULE_CONFIG },
  )
  try {
    clearConfigCache()
    return checkDocs(root)
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
}

const STATE_DOC = doc({
  title: 'Pipelines',
  kind: 'state',
  module: 'crm',
  status: 'active',
  updated: '2026-08-23',
  verified_on: '2026-08-23',
  evidence: ['docs/modules/crm/state/pipelines.md'],
})

const TODO_DOC = doc({
  title: 'Stage-change trigger',
  kind: 'todo',
  module: 'crm',
  status: 'active',
  updated: '2026-08-23',
  commitment: 'committed',
  changes: ['docs/modules/crm/state/pipelines.md'],
})

test('7a. a state doc whose kind and module match its path is clean', () => {
  assert.deepEqual(runModular({ 'docs/modules/crm/state/pipelines.md': STATE_DOC }), [])
})

test('7b. a kind that disagrees with the path is a violation', () => {
  const wrong = STATE_DOC.replace('kind: state', 'kind: todo')
  const violations = runModular({ 'docs/modules/crm/state/pipelines.md': wrong })
  assert.equal(violations.filter((v) => v.field === 'kind').length, 1)
})

test('7c. a module that disagrees with the path is a violation', () => {
  const wrong = STATE_DOC.replace('module: crm', 'module: core')
  const violations = runModular({ 'docs/modules/crm/state/pipelines.md': wrong })
  assert.equal(violations.filter((v) => v.field === 'module').length, 1)
})

test('7d. a module outside the registry is a violation', () => {
  const wrong = STATE_DOC.replace('module: crm', 'module: nonesuch')
  const violations = runModular({ 'docs/modules/nonesuch/state/x.md': wrong })
  assert.ok(violations.some((v) => v.field === 'module' && /not a registered module/.test(v.message)))
})

test('7e. a missing kind is a violation', () => {
  const wrong = STATE_DOC.replace('kind: state\n', '')
  const violations = runModular({ 'docs/modules/crm/state/pipelines.md': wrong })
  assert.ok(violations.some((v) => v.field === 'kind'))
})

test('8a. a state doc with no evidence is a violation', () => {
  const wrong = STATE_DOC.replace(/evidence:\n(  - .*\n)+/, '')
  const violations = runModular({ 'docs/modules/crm/state/pipelines.md': wrong })
  assert.ok(violations.some((v) => v.field === 'evidence' && /required/.test(v.message)))
})

test('8b. a state doc with an empty evidence list is a violation', () => {
  const wrong = STATE_DOC.replace(/evidence:\n(  - .*\n)+/, 'evidence: []\n')
  const violations = runModular({ 'docs/modules/crm/state/pipelines.md': wrong })
  assert.ok(violations.some((v) => v.field === 'evidence'))
})

test('8c. evidence naming a file that does not exist is a violation', () => {
  const wrong = STATE_DOC.replace('docs/modules/crm/state/pipelines.md', 'apps/api/src/nowhere.ts:24')
  const violations = runModular({ 'docs/modules/crm/state/pipelines.md': wrong })
  assert.ok(violations.some((v) => v.field === 'evidence' && /does not exist/.test(v.message)))
})

test('8d. evidence that is a runnable command is accepted', () => {
  const ok = STATE_DOC.replace('"docs/modules/crm/state/pipelines.md"', '"bunx nx test domain-pipelines"')
  assert.deepEqual(runModular({ 'docs/modules/crm/state/pipelines.md': ok }), [])
})

test('8e. evidence that is neither a path nor a command is a violation', () => {
  const wrong = STATE_DOC.replace('"docs/modules/crm/state/pipelines.md"', '"we checked and it works"')
  const violations = runModular({ 'docs/modules/crm/state/pipelines.md': wrong })
  assert.ok(violations.some((v) => v.field === 'evidence' && /not a path or a command/.test(v.message)))
})

test('8f. a todo whose changes target exists and is state is clean', () => {
  assert.deepEqual(
    runModular({
      'docs/modules/crm/state/pipelines.md': STATE_DOC,
      'docs/modules/crm/todo/stage-trigger.md': TODO_DOC,
    }),
    [],
  )
})

test('8g. a todo whose changes target does not exist is a violation', () => {
  const wrong = TODO_DOC.replace('state/pipelines.md', 'state/nowhere.md')
  const violations = runModular({
    'docs/modules/crm/state/pipelines.md': STATE_DOC,
    'docs/modules/crm/todo/stage-trigger.md': wrong,
  })
  assert.ok(violations.some((v) => v.field === 'changes' && /does not exist/.test(v.message)))
})

test('8h. a todo pointing at another todo is a violation', () => {
  const wrong = TODO_DOC.replace('docs/modules/crm/state/pipelines.md', 'docs/modules/crm/todo/other.md')
  const violations = runModular({
    'docs/modules/crm/state/pipelines.md': STATE_DOC,
    'docs/modules/crm/todo/other.md': TODO_DOC,
    'docs/modules/crm/todo/stage-trigger.md': wrong,
  })
  assert.ok(violations.some((v) => v.field === 'changes' && /is kind "todo"/.test(v.message)))
})

test('8i. a commitment outside the vocabulary is a violation', () => {
  const wrong = TODO_DOC.replace('commitment: committed', 'commitment: maybe')
  const violations = runModular({
    'docs/modules/crm/state/pipelines.md': STATE_DOC,
    'docs/modules/crm/todo/stage-trigger.md': wrong,
  })
  assert.ok(violations.some((v) => v.field === 'commitment'))
})

test('9a. index entries carry the module', () => {
  const root = fixture(
    {
      'docs/modules/crm/state/pipelines.md': STATE_DOC,
      'docs-system.config.json': JSON.stringify(MODULE_CONFIG),
    },
    { withIndex: false, config: MODULE_CONFIG },
  )
  try {
    clearConfigCache()
    const entries = buildIndex(root, loadConfig(root))
    assert.equal(entries.length, 1)
    assert.equal(entries[0].module, 'crm')
    assert.equal(entries[0].kind, 'state')
    assert.equal(entries[0].verified_on, '2026-08-23')
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('9b. a stale module README fails the gate', () => {
  // The README has to be corrupted AFTER the fixture generates the index —
  // `fixture` writes the given files first and then renders every artefact over
  // them, so a stale copy passed in as a file would be silently repaired.
  const root = fixture(
    {
      'docs/modules/crm/state/pipelines.md': STATE_DOC,
      'docs-system.config.json': JSON.stringify(MODULE_CONFIG),
    },
    { config: MODULE_CONFIG },
  )
  try {
    writeFileSync(join(root, 'docs/modules/crm/README.md'), '# wrong\n')
    clearConfigCache()
    const violations = checkDocs(root)
    assert.ok(violations.some((v) => v.file === 'docs/modules/crm/README.md' && v.field === 'index'))
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('9c. a module README lists its state and todo documents', () => {
  const root = fixture(
    {
      'docs/modules/crm/state/pipelines.md': STATE_DOC,
      'docs/modules/crm/todo/stage-trigger.md': TODO_DOC,
      'docs-system.config.json': JSON.stringify(MODULE_CONFIG),
    },
    { withIndex: false, config: MODULE_CONFIG },
  )
  try {
    clearConfigCache()
    const rendered = new Map(renderIndex(root, loadConfig(root)))
    const readme = rendered.get('docs/modules/crm/README.md')
    assert.match(readme, /## Reflection/)
    assert.match(readme, /Pipelines/)
    assert.match(readme, /## Wishlist/)
    assert.match(readme, /Stage-change trigger/)
    assert.match(readme, /`anchor`/)
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('9d. INDEX.md subdivides by module when modules are configured', () => {
  const config = withDerived({ ...DEFAULTS, ...MODULE_CONFIG, indexSubdivide: ['reference', 'todo'] })
  const entries = [
    { path: 'docs/modules/crm/todo/a.md', title: 'A', kind: 'todo', module: 'crm', status: 'active', updated: '2026-08-23' },
    { path: 'docs/modules/store/todo/b.md', title: 'B', kind: 'todo', module: 'store', status: 'active', updated: '2026-08-23' },
  ]
  const markdown = renderMarkdown(entries, config)
  assert.match(markdown, /### crm \(1\)/)
  assert.match(markdown, /### store \(1\)/)
})

test('8k. verified_on must be an ISO date when present', () => {
  const wrong = STATE_DOC.replace('verified_on: 2026-08-23', 'verified_on: yesterday')
  const violations = runModular({ 'docs/modules/crm/state/pipelines.md': wrong })
  assert.ok(violations.some((v) => v.field === 'verified_on' && /ISO date/.test(v.message)))
})

test('10a. two files with the same basename in one tier is a violation', () => {
  const ref = (title) => doc({ title, kind: 'reference', status: 'reference', updated: '2026-05-29' })
  const violations = run({
    'docs/reference/a/foo.md': ref('A foo'),
    'docs/reference/b/foo.md': ref('B foo'),
  })
  const dups = violations.filter((v) => v.field === 'basename')
  assert.equal(dups.length, 1)
  assert.match(dups[0].message, /docs\/reference\/a\/foo\.md/)
})

test('10b. sentinels may repeat across areas of one tier', () => {
  const ref = (title) => doc({ title, kind: 'reference', status: 'reference', updated: '2026-05-29' })
  const violations = run({
    'docs/reference/a/PRD.md': ref('A'),
    'docs/reference/b/PRD.md': ref('B'),
  })
  assert.deepEqual(violations.filter((v) => v.field === 'basename'), [])
})

test('8j. evidence may name a path with Next.js dynamic segments', () => {
  const ok = STATE_DOC.replace(
    '"docs/modules/crm/state/pipelines.md"',
    '"docs/modules/crm/state/[id]/(group)/pipelines.md:24"',
  )
  const violations = runModular({
    'docs/modules/crm/state/pipelines.md': ok,
    'docs/modules/crm/state/[id]/(group)/pipelines.md': STATE_DOC,
  })
  assert.deepEqual(violations.filter((v) => v.field === 'evidence'), [])
})


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
