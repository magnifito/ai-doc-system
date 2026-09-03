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
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
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

/**
 * A project that groups by module, with one tier (`plans/`) deliberately
 * OUTSIDE the module trees — that is the only shape in which a destination can
 * be inside a tier and inside no module at once.
 */
const MODULE_CONFIG = {
  tiers: [
    ['modules/*/state/', 'state'],
    ['modules/*/todo/', 'todo'],
    ['plans/', 'plan'],
  ],
  tierOrder: ['state', 'todo', 'plan'],
  indexSubdivide: [],
  exempt: ['INDEX.md', 'README.md', 'ROADMAP.md', 'modules/*/README.md'],
  modules: [{ key: 'crm', class: 'anchor', requires: [] }],
}

test('mv refuses a destination in no module tree when the project declares modules', () => {
  const root = gitFixture({
    'docs-system.config.json': JSON.stringify(MODULE_CONFIG),
    'docs/modules/crm/state/pipelines.md':
      '---\ntitle: Pipelines\nkind: state\nmodule: crm\nstatus: active\nupdated: 2026-08-27\n---\n\n# Pipelines\n',
  })
  try {
    assert.throws(
      () => mvDoc(root, 'docs/modules/crm/state/pipelines.md', 'docs/plans/pipelines.md'),
      /is in no module tree/,
    )
    // The guard must fire before anything moves.
    assert.match(
      readFileSync(join(root, 'docs/modules/crm/state/pipelines.md'), 'utf8'),
      /^module: crm$/m,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('mv falls back to a plain rename for a source git does not track', () => {
  const root = gitFixture({ 'docs/engineering/a.md': GOOD })
  try {
    writeFileSync(join(root, 'docs/engineering/untracked.md'), GOOD.replace('Quality gate', 'Untracked'))
    const result = mvDoc(root, 'docs/engineering/untracked.md', 'docs/product/untracked.md', {
      now: new Date('2026-09-03T12:00:00Z'),
    })
    assert.equal(result.restamped.kind, 'product')
    assert.equal(existsSync(join(root, 'docs/engineering/untracked.md')), false)
    assert.match(readFileSync(join(root, 'docs/product/untracked.md'), 'utf8'), /^kind: product$/m)
    // `-uall` because the short form collapses a wholly-untracked directory to
    // `?? docs/product/`, which would not say WHICH file arrived.
    assert.match(
      execFileSync('git', ['status', '--short', '-uall'], { cwd: root, encoding: 'utf8' }),
      /^\?\? docs\/product\/untracked\.md$/m,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a move within one tier carries the status over and records no promotion', () => {
  const root = gitFixture({ 'docs/engineering/a.md': GOOD })
  try {
    const result = mvDoc(root, 'docs/engineering/a.md', 'docs/engineering/sub/a.md', {
      now: new Date('2026-09-03T12:00:00Z'),
    })
    assert.deepEqual(result.restamped, { kind: 'engineering', module: null, status: 'active' })
    const text = readFileSync(join(root, 'docs/engineering/sub/a.md'), 'utf8')
    assert.match(text, /^kind: engineering$/m)
    assert.match(text, /^status: active$/m)
    assert.doesNotMatch(text, /^promoted_from:/m)

    // An explicit status still wins inside a tier that forces none.
    mvDoc(root, 'docs/engineering/sub/a.md', 'docs/engineering/deep/a.md', {
      status: 'draft',
      now: new Date('2026-09-03T12:00:00Z'),
    })
    assert.match(readFileSync(join(root, 'docs/engineering/deep/a.md'), 'utf8'), /^status: draft$/m)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('mv names the missing status rather than reporting "undefined" as a value', () => {
  const root = gitFixture({
    'docs/engineering/a.md': '---\ntitle: A\nkind: engineering\nupdated: 2026-08-27\n---\n\n# A\n',
  })
  try {
    assert.throws(() => mvDoc(root, 'docs/engineering/a.md', 'docs/engineering/sub/a.md'), /has no status/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a git mv failure that is not an untracked source surfaces as one line', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'docs-mv-nogit-'))
  try {
    // Outside a repository git cannot move anything, and the failure is NOT the
    // untracked-source one, so it must be reported rather than renamed around.
    // Skipped in the unlikely case the temp directory sits inside a checkout,
    // where the file would instead be an untracked one.
    try {
      execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, stdio: 'pipe' })
      t.skip('temp directory is inside a git repository')
      return
    } catch {
      /* not a repository, which is what this test needs */
    }
    mkdirSync(join(root, 'docs/engineering'), { recursive: true })
    writeFileSync(join(root, 'docs/engineering/a.md'), GOOD)
    assert.throws(() => mvDoc(root, 'docs/engineering/a.md', 'docs/product/a.md'), /^Error: git mv: fatal: /)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
