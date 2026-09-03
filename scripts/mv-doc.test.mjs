/**
 * Tests for `scripts/mv-doc.mjs` — the mechanical half of promotion. The
 * fixtures are real committed repositories because the move goes through
 * `git mv`, and the rename staged in the index is part of what the command
 * promises.
 *
 * Run: node --test scripts/mv-doc.test.mjs
 */
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { checkDocs } from './check-docs.mjs'
import { mvDoc } from './mv-doc.mjs'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A committed git repository containing exactly `files`. */
function gitFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-mv-'))
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

const GOOD = '---\ntitle: Quality gate\nkind: engineering\nstatus: active\nupdated: 2026-08-27\n---\n\n# Quality gate\n'

test('mv moves with git, restamps kind and status, and regenerates the index', () => {
  const root = gitFixture({
    'docs/reference/vendor/prd.md':
      '---\ntitle: PRD\nkind: reference\nstatus: reference\nupdated: 2026-08-01\nsource_url: "https://example.test"\n---\n# PRD\n',
  })
  try {
    execFileSync(process.execPath, [join(PACKAGE_ROOT, 'scripts', 'gen-docs-index.mjs')], {
      cwd: root,
      stdio: 'pipe',
    })
    const result = mvDoc(root, 'docs/reference/vendor/prd.md', 'docs/product/prd.md', {
      now: new Date('2026-09-03T12:00:00Z'),
    })
    assert.deepEqual(result.restamped, { kind: 'product', module: null, status: 'draft' })
    const text = readFileSync(join(root, 'docs/product/prd.md'), 'utf8')
    assert.match(text, /^kind: product$/m)
    assert.match(text, /^status: draft$/m)
    assert.match(text, /^promoted_from: docs\/reference\/vendor\/prd\.md$/m)
    assert.match(text, /^source_url: "https:\/\/example\.test"$/m)
    // `R` in the index column is the assertion: the move went through git and
    // is staged as a rename, not as a delete plus an untracked file. The
    // worktree column is `M`, because the restamp rewrites the frontmatter
    // after the move.
    assert.match(
      execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }),
      /^R[ M] docs\/reference\/vendor\/prd\.md -> docs\/product\/prd\.md/m,
    )
    assert.equal(checkDocs(root).filter((v) => v.severity === 'error').length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('mv refuses an occupied destination and a destination under no tier', () => {
  const root = gitFixture({
    'docs/engineering/a.md': GOOD,
    'docs/engineering/b.md': GOOD.replace('Quality gate', 'B'),
  })
  try {
    assert.throws(() => mvDoc(root, 'docs/engineering/a.md', 'docs/engineering/b.md'), /already exists/)
    assert.throws(() => mvDoc(root, 'docs/engineering/a.md', 'docs/x/a.md'), /under no tier/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
