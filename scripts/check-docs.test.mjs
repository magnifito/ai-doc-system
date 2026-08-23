/**
 * Tests for the documentation gate. One passing and one failing case per
 * assertion in check-docs.mjs, built on throwaway fixture trees so no test
 * depends on the real `docs/`. The fixtures are not git repositories, which
 * also exercises the non-git fallback of the tracked-reference scan (5b).
 *
 * Run: node --test scripts/check-docs.test.mjs
 *
 * Uses `node:test` rather than a project's own test framework deliberately — see
 * the design's section 5.5 (github.com/magnifito/ai-doc-system): the scripts stay
 * dependency-free and portable, and the suite is wired into the host project's
 * blocking gate next to `lint:docs`.
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { checkDocs } from './check-docs.mjs'
import { buildIndex, renderJson, renderMarkdown } from './gen-docs-index.mjs'


/** Build a fixture repo whose docs/ contains exactly `files`, with a fresh index. */
function fixture(files, { withIndex = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'docs-gate-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  mkdirSync(join(root, 'docs'), { recursive: true })
  if (withIndex) {
    const entries = buildIndex(root)
    writeFileSync(join(root, 'docs/index.json'), renderJson(entries))
    writeFileSync(join(root, 'docs/INDEX.md'), renderMarkdown(entries))
  }
  return root
}

function run(files, options) {
  const root = fixture(files, options)
  try {
    return checkDocs(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function doc(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`)
  return `---\n${lines.join('\n')}\n---\n\n# ${fields.title ?? 'Doc'}\n\nBody.\n`
}

const GOOD = doc({ title: 'Quality gate', status: 'active', updated: '2026-08-17' })

test('1a. a well-formed doc produces no violations', () => {
  assert.deepEqual(run({ 'docs/engineering/quality-gate.md': GOOD }), [])
})

test('1b. missing frontmatter is a violation', () => {
  const violations = run({ 'docs/engineering/bare.md': '# Bare\n' })
  assert.ok(violations.some((v) => v.field === 'frontmatter'))
})

test('2a. a reference doc with status reference passes', () => {
  const violations = run({
    'docs/reference/contacts/smart-lists.md': doc({ title: 'Smart Lists', status: 'reference', updated: '2026-05-29' }),
  })
  assert.deepEqual(violations, [])
})

test('2b. an unknown status is rejected', () => {
  const violations = run({
    'docs/engineering/x.md': doc({ title: 'X', status: 'banana', updated: '2026-08-17' }),
  })
  assert.ok(violations.some((v) => v.field === 'status' && v.message.includes('banana')))
})

test('2c. a kind field in frontmatter is rejected — kind is derived from the path', () => {
  const violations = run({
    'docs/engineering/x.md': doc({ title: 'X', kind: 'engineering', status: 'active', updated: '2026-08-17' }),
  })
  assert.ok(violations.some((v) => v.field === 'kind' && v.message.includes('derived')))
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

test('4a. a freshly generated index is accepted', () => {
  assert.deepEqual(run({ 'docs/engineering/quality-gate.md': GOOD }).filter((v) => v.field === 'index'), [])
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
      title: 'Old', status: 'superseded', updated: '2026-08-09',
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
