/**
 * Tests for the context pack and the JSONL export. The point of both commands
 * is that a document never travels without its authority: the banner in the
 * pack, the frontmatter on every chunk in the export.
 *
 * Run: node --test scripts/context-docs.test.mjs
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { parseArgs, renderContext, renderJsonl, sections, selectDocs } from './context-docs.mjs'
import { renderIndex } from './gen-docs-index.mjs'
import { DEFAULTS, withDerived } from './docs-config.mjs'

/**
 * Build a fixture repo whose docs/ contains exactly `files`, with a fresh index.
 * Copied from check-docs.test.mjs, where the helpers are private.
 */
function fixture(files, { withIndex = true, config } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'docs-context-'))
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

function doc(fields) {
  const lines = []
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) lines.push(`${key}:`, ...value.map((item) => `  - ${JSON.stringify(item)}`))
    else lines.push(`${key}: ${value}`)
  }
  return `---\n${lines.join('\n')}\n---\n\n# ${fields.title ?? 'Doc'}\n\nBody.\n`
}

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

test('sections ignores headings inside fenced code and trims closing hashes', () => {
  const body = '# One #\n\n```\n# not a heading\n```\n\n~~~md\n## also not\n~~~\n\n## Two\n\nB.\n'
  assert.deepEqual(
    sections(body).map((s) => [s.heading, s.level]),
    [['One', 1], ['Two', 2]],
  )
  assert.match(sections(body)[0].text, /# not a heading/)
})

test('renderContext keeps the first document even when it alone blows the budget', () => {
  const root = fixture({ 'docs/product/p.md': doc({ title: 'P', kind: 'product', status: 'active', updated: '2026-08-17' }) })
  try {
    const out = renderContext(root, selectDocs(root, {}), { maxChars: 1 })
    assert.match(out, /===== docs\/product\/p\.md =====/)
    assert.doesNotMatch(out, /\[context:/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the authority line names the code for shipped and the replacement for superseded', () => {
  const root = fixture({
    'docs/product/s.md': doc({ title: 'S', kind: 'product', status: 'shipped', updated: '2026-08-17', code: 'src/s.ts' }),
    'docs/product/z.md': doc({ title: 'Z', kind: 'product', status: 'superseded', updated: '2026-08-17', superseded_by: 'docs/product/s.md' }),
  })
  try {
    const out = renderContext(root, selectDocs(root, {}), {})
    assert.match(out, /AUTHORITY: built and verified — code: src\/s\.ts\./)
    assert.match(out, /AUTHORITY: replaced by docs\/product\/s\.md — do not use\./)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sections closes a fence only on the marker that opened it', () => {
  const body = '```md\n~~~\n# inside\n```\n\n# Outside\n\nB.\n'
  assert.deepEqual(sections(body).map((s) => s.heading), ['', 'Outside'])
})

test('renderJsonl emits nothing at all when nothing was selected', () => {
  const root = fixture({ 'docs/product/p.md': doc({ title: 'P', kind: 'product', status: 'active', updated: '2026-08-17' }) })
  try {
    assert.equal(renderJsonl(root, selectDocs(root, { kind: 'plan' })), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('parseArgs rejects a value flag with no value and a non-numeric budget', () => {
  assert.match(parseArgs(['--kind', '--status', 'active']).error, /--kind needs a value/)
  assert.match(parseArgs(['--kind']).error, /--kind needs a value/)
  assert.match(parseArgs(['--max-chars', 'lots']).error, /--max-chars/)
  assert.match(parseArgs(['--max-chars', '0']).error, /--max-chars/)
  assert.equal(parseArgs(['--max-chars', '500']).maxChars, 500)
})

test('parseArgs rejects a positional that is not a document path', () => {
  assert.match(parseArgs(['context', 'docs/product']).error, /not a document path docs\/product/)
  assert.deepEqual(parseArgs(['context', 'docs/product/p.md']).paths, ['docs/product/p.md'])
})
