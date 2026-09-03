/**
 * Tests for the reverse lookup — which documents claim the code that changed.
 *
 * The fixtures are real git repositories, because `changedPaths` reads the
 * working tree, the index and the merge base; none of that can be exercised
 * against a bare temporary directory.
 *
 * Run: node --test scripts/impact-docs.test.mjs
 */
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { clearConfigCache } from './docs-config.mjs'
import { changedPaths } from './docs-fs.mjs'
import { impactedDocs } from './impact-docs.mjs'

/** A committed git repository containing exactly `files`. */
function gitFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-impact-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 'test@example.test')
  git('config', 'user.name', 'Test')
  git('add', '-A')
  git('commit', '-qm', 'fixture')
  clearConfigCache()
  return root
}

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
    clearConfigCache()
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
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})
