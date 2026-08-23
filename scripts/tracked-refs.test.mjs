/**
 * Tests for assertion 5b — every `docs/....md` path named by a tracked file
 * OUTSIDE the docs tree must exist.
 *
 * These fixtures are real git repositories, unlike the ones in
 * check-docs.test.mjs. That is the point: 5b's `git grep` branch and its
 * exclusion list cannot be exercised any other way, and the exclusion list is
 * load-bearing — it is what stops every repository that vendors these scripts
 * from inheriting a false positive off their own test fixtures.
 *
 * Run: node --test scripts/tracked-refs.test.mjs
 */
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { clearConfigCache } from './docs-config.mjs'
import { trackedDocRefs } from './check-docs.mjs'

/** A committed git repository containing exactly `files`. */
function gitFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-refs-'))
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
  return root
}

function withGitFixture(files, body) {
  const root = gitFixture(files)
  try {
    clearConfigCache()
    return body(root)
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
}

const DOC = '---\ntitle: A doc\nstatus: active\nupdated: 2026-08-23\n---\n\n# A doc\n'

test('a docs path named by tracked code is collected', () => {
  withGitFixture(
    {
      'docs/engineering/testing.md': DOC,
      'src/app.ts': '// See docs/engineering/testing.md for the suite.\n',
    },
    (root) => {
      assert.deepEqual([...trackedDocRefs(root)], ['docs/engineering/testing.md'])
    },
  )
})

test('paths inside the docs tree are not collected — 5a covers those', () => {
  withGitFixture(
    {
      'docs/engineering/a.md': `${DOC}\nMentions docs/engineering/b.md in prose.\n`,
      'docs/engineering/b.md': DOC,
    },
    (root) => {
      assert.deepEqual([...trackedDocRefs(root)], [])
    },
  )
})

test('an untracked file is invisible to the scan', () => {
  withGitFixture({ 'docs/engineering/a.md': DOC }, (root) => {
    writeFileSync(join(root, 'scratch.md'), 'docs/never-committed.md\n')
    assert.deepEqual([...trackedDocRefs(root)], [])
  })
})

test('excluded paths are skipped, so vendored fixtures cannot fail the gate', () => {
  withGitFixture(
    {
      'docs/engineering/a.md': DOC,
      // The default exclusion list names these two by path.
      'scripts/check-docs.test.mjs': "run({ 'docs/engineering/bare.md': '# Bare' })\n",
      'scripts/docs-config.test.mjs': "run({ 'docs/ideas/bad.md': '# Bad' })\n",
      'scripts/other.mjs': "// docs/engineering/a.md\n",
    },
    (root) => {
      assert.deepEqual([...trackedDocRefs(root)], ['docs/engineering/a.md'])
    },
  )
})

test('the exclusion list is configurable per project', () => {
  withGitFixture(
    {
      'docs-system.config.json': JSON.stringify({ referenceScanExclude: ['vendor'] }),
      'docs/engineering/a.md': DOC,
      'vendor/template.md': 'docs/somewhere/else.md\n',
      // No longer excluded once the project overrides the list.
      'scripts/check-docs.test.mjs': "run({ 'docs/fixture-only.md': '# X' })\n",
    },
    (root) => {
      // vendor/ is excluded by the override; the test file no longer is.
      assert.deepEqual([...trackedDocRefs(root)], ['docs/fixture-only.md'])
    },
  )
})
