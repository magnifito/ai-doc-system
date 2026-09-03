/**
 * Tests for the frontmatter reader. The schema grew lists (`evidence`,
 * `changes`), so the reader is a real YAML parse; the renderer stays hand-rolled
 * so a regenerated block is byte-identical to a committed one.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { parseFrontmatter, patchScalar, renderFrontmatter } from './docs-frontmatter.mjs'

test('reads a list field', () => {
  const source = [
    '---',
    'title: Pipelines',
    'kind: state',
    'evidence:',
    '  - "apps/api/src/pipelines/pipelines.controller.ts:24"',
    '  - bunx nx test domain-pipelines',
    '---',
    '',
    '# Pipelines',
    '',
  ].join('\n')
  const { data, body, present } = parseFrontmatter(source)
  assert.equal(present, true)
  assert.equal(data.title, 'Pipelines')
  assert.deepEqual(data.evidence, [
    'apps/api/src/pipelines/pipelines.controller.ts:24',
    'bunx nx test domain-pipelines',
  ])
  assert.equal(body, '\n# Pipelines\n')
})

test('reads a scalar whose value contains a colon', () => {
  const { data } = parseFrontmatter('---\ntitle: "Docs: by module"\n---\n')
  assert.equal(data.title, 'Docs: by module')
})

test('a document with no frontmatter is reported absent', () => {
  const { present, data, body } = parseFrontmatter('# Bare\n')
  assert.equal(present, false)
  assert.deepEqual(data, {})
  assert.equal(body, '# Bare\n')
})

test('renders lists in field order, round-tripping', () => {
  const data = {
    title: 'Pipelines',
    kind: 'state',
    module: 'crm',
    status: 'active',
    updated: '2026-08-23',
    verified_on: '2026-08-23',
    evidence: ['apps/api/src/pipelines/pipelines.controller.ts:24'],
  }
  const rendered = renderFrontmatter(data)
  assert.equal(
    rendered,
    [
      '---',
      'title: Pipelines',
      'kind: state',
      'module: crm',
      'status: active',
      'updated: 2026-08-23',
      'verified_on: 2026-08-23',
      'evidence:',
      '  - "apps/api/src/pipelines/pipelines.controller.ts:24"',
      '---',
      '',
    ].join('\n'),
  )
  assert.deepEqual(parseFrontmatter(`${rendered}\nBody.\n`).data, data)
})

test('an empty list renders as no field at all', () => {
  assert.equal(renderFrontmatter({ title: 'X', evidence: [] }), '---\ntitle: X\n---\n')
})

test('unknown fields are preserved, after the known ones', () => {
  const data = { title: 'X', kind: 'state', status: 'active', updated: '2026-08-23', workflowType: 'bmad' }
  assert.equal(
    renderFrontmatter(data),
    '---\ntitle: X\nkind: state\nstatus: active\nupdated: 2026-08-23\nworkflowType: bmad\n---\n',
  )
})

test('an unparseable block reports the parse error', () => {
  const { present, error } = parseFrontmatter('---\ntitle: ADR: Chatbot Module\n---\n')
  assert.equal(present, true)
  assert.match(error, /Nested mappings/)
})

test('renders the authority fields in field order', () => {
  assert.equal(
    renderFrontmatter({ title: 'T', source_url: 'https://x', summary: 'S', kind: 'reference' }),
    '---\ntitle: T\nsummary: S\nkind: reference\nsource_url: "https://x"\n---\n',
  )
})

test('an empty scalar is kept as an empty string, not dropped', () => {
  // The gate has to tell "summary: " (present but empty — a defect) apart from
  // no `summary:` line at all, so a null value survives the read as ''.
  const { data } = parseFrontmatter('---\ntitle: X\nsummary:\n---\n')
  assert.equal(data.summary, '')
  assert.ok('summary' in data)
})

test('patchScalar replaces in place, inserts after the first anchor present, and falls back to the top', () => {
  const raw = 'title: X\nkind: product\nstatus: draft\nupdated: 2026-08-01'
  // Replace: every other byte survives, including the field order.
  assert.equal(
    patchScalar(raw, 'status', 'active', ['kind']),
    'title: X\nkind: product\nstatus: active\nupdated: 2026-08-01',
  )
  // Insert: the FIRST anchor found wins, so anchors are passed in decreasing
  // FIELD_ORDER proximity and the new line lands where the renderer would put it.
  assert.equal(
    patchScalar(raw, 'verified_on', '2026-09-03', ['review_by', 'updated', 'title']),
    'title: X\nkind: product\nstatus: draft\nupdated: 2026-08-01\nverified_on: 2026-09-03',
  )
  // No anchor present: the top of the block, never dropped.
  assert.equal(patchScalar('title: X', 'kind', 'product', ['module']), 'kind: product\ntitle: X')
  // `^key:` is top level only: an indented key of the same name is not the one
  // being patched, and a nested block must survive untouched.
  const nested = 'title: X\nmeta:\n  status: nested\nstatus: draft'
  assert.equal(patchScalar(nested, 'status', 'active', ['title']), 'title: X\nmeta:\n  status: nested\nstatus: active')
})
