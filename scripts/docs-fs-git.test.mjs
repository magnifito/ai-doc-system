/**
 * Tests for the one-walk git date lookup used by the advisory pass.
 *
 * These fixtures are real git repositories with pinned commit dates: the whole
 * point of `lastCommitDates` is what git reports, so a fake tree proves nothing.
 *
 * Run: node --test scripts/docs-fs-git.test.mjs
 */
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { lastCommitDate, lastCommitDates } from './docs-fs.mjs'

/** A committed git repository containing exactly `files`. */
function gitFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-fs-git-'))
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

test('lastCommitDates maps every committed path to its last commit date in one call', () => {
  const root = gitFixture({ 'a.md': 'a', 'dir/b.md': 'b' })
  const git = (args, env) =>
    execFileSync('git', args, { cwd: root, stdio: 'pipe', env: { ...process.env, ...env } })
  writeFileSync(join(root, 'a.md'), 'a2')
  git(['commit', '-qam', 'later'], {
    GIT_AUTHOR_DATE: '2026-05-05T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-05-05T00:00:00Z',
  })
  const dates = lastCommitDates(root)
  assert.equal(dates.get('a.md'), '2026-05-05')
  assert.equal(dates.get('dir/b.md'), lastCommitDate(root, 'dir/b.md'))
  rmSync(root, { recursive: true, force: true })
})

test('lastCommitDates dates a directory from the newest path beneath it', () => {
  const root = gitFixture({ 'dir/b.md': 'b', 'dir/c.md': 'c' })
  const git = (args, env) =>
    execFileSync('git', args, { cwd: root, stdio: 'pipe', env: { ...process.env, ...env } })
  writeFileSync(join(root, 'dir/c.md'), 'c2')
  git(['commit', '-qam', 'later'], {
    GIT_AUTHOR_DATE: '2026-06-06T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-06-06T00:00:00Z',
  })
  const dates = lastCommitDates(root)
  assert.equal(dates.get('dir'), '2026-06-06')
  assert.equal(dates.get('dir/c.md'), '2026-06-06')
  rmSync(root, { recursive: true, force: true })
})

test('lastCommitDates is empty outside git', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-nogit-'))
  assert.equal(lastCommitDates(root).size, 0)
  rmSync(root, { recursive: true, force: true })
})
