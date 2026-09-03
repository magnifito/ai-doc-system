/**
 * Tests for the frontmatter reader. The schema grew lists (`evidence`,
 * `changes`), so the reader is a real YAML parse; the renderer stays hand-rolled
 * so a regenerated block is byte-identical to a committed one.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { parseFrontmatter, renderFrontmatter } from './docs-frontmatter.mjs'

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
