/**
 * Tests for `scripts/new-doc.mjs` — the writer that produces a document the
 * gate accepts on its first run. The assertions that matter are the derived
 * ones: `kind` from the path, the tier's forced status, today's `updated`, and
 * a tree that still passes `checkDocs` afterwards.
 *
 * Run: node --test scripts/new-doc.test.mjs
 */
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { checkDocs } from './check-docs.mjs'
import { newDoc } from './new-doc.mjs'

/** A git repository containing exactly `files` (no commit needed). */
function gitFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-new-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' })
  return root
}

test('new writes a gate-clean document and regenerates the index', () => {
  const root = gitFixture({})
  try {
    const { frontmatter } = newDoc(
      root,
      'docs/product/invoices.md',
      { title: 'Invoices', summary: 'Committed scope for invoices.', now: new Date('2026-09-03T12:00:00Z') },
    )
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
    const { frontmatter } = newDoc(root, 'docs/reference/vendor/x.md', {
      title: 'X',
      now: new Date('2026-09-03T12:00:00Z'),
    })
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
