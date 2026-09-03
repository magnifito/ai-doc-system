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
import { changedPaths, lastCommitDate, lastCommitDates } from './docs-fs.mjs'

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
  try {
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
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('lastCommitDates dates a directory from the newest path beneath it', () => {
  const root = gitFixture({ 'dir/b.md': 'b', 'dir/c.md': 'c' })
  try {
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
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * `git log --name-only` C-quotes non-ASCII paths under the default
 * `core.quotePath`, which would key the map as `"dir/caf\303\251.md"` and miss
 * every lookup. The old per-path `git log -1 -- path` never saw those bytes.
 */
test('lastCommitDates keys non-ASCII paths raw, not C-quoted', () => {
  const root = gitFixture({ 'dir/café.md': 'c' })
  try {
    const dates = lastCommitDates(root)
    assert.equal(dates.get('dir/café.md'), lastCommitDate(root, 'dir/café.md'))
    assert.ok(dates.get('dir/café.md'))
    for (const key of dates.keys()) assert.ok(!key.startsWith('"'), `C-quoted key: ${key}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('lastCommitDates is empty outside git', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-nogit-'))
  try {
    assert.equal(lastCommitDates(root).size, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * `changedPaths(root, base)` diffs from the MERGE BASE, not from the tip of
 * `base`. Against the tip, every commit landed on `base` since the fork reads
 * as this branch's work — and a file only `base` ever touched would be reported
 * as changed here, which is how the history-aware rules start judging documents
 * that are not this branch's business.
 */
test('changedPaths(base) reports the branch\'s work, not what base did after the fork', () => {
  const root = gitFixture({ 'a.md': 'a', 'docs/engineering/x.md': 'x' })
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  try {
    git('branch', '-M', 'main')
    git('checkout', '-qb', 'feature')
    // base advances after the branch forked.
    git('checkout', '-q', 'main')
    writeFileSync(join(root, 'base-only.md'), 'landed on main')
    git('add', '-A')
    git('commit', '-qm', 'base moves on')
    // the branch does its own, unrelated work.
    git('checkout', '-q', 'feature')
    writeFileSync(join(root, 'docs/engineering/x.md'), 'x2')
    const changed = changedPaths(root, 'main')
    assert.deepEqual(changed, ['docs/engineering/x.md'])
    assert.ok(!changed.includes('base-only.md'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
