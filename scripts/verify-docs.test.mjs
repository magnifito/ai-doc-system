/**
 * Tests for `verify` — the one command that executes what a document claims.
 *
 * The fixtures are real git repositories: `verifyDocs` walks the docs tree from
 * the repository root, and the gate half of the third test regenerates the
 * index in a child process, which needs `git rev-parse` to answer.
 *
 * Run: node --test scripts/verify-docs.test.mjs
 */
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { DEFAULTS, clearConfigCache } from './docs-config.mjs'
import { checkDocs } from './check-docs.mjs'
import { hashEvidence, verifyDocs } from './verify-docs.mjs'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A committed git repository containing exactly `files`. */
function gitFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-verify-'))
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

const CONFIG = JSON.stringify({
  modules: [{ key: 'crm', class: 'anchor' }],
  tiers: [['modules/*/state/', 'state'], ...DEFAULTS.tiers],
  requiredFields: { state: ['verified_on', 'evidence'] },
})

test('verify runs command evidence, hashes path evidence, writes the lock, and stamps verified_on on success', () => {
  const root = gitFixture({
    'docs-system.config.json': CONFIG,
    'src/x.ts': 'line1\nline2\nline3\n',
    'docs/modules/crm/state/s.md':
      '---\ntitle: S\nkind: state\nmodule: crm\nstatus: active\nupdated: 2026-08-01\nverified_on: 2026-08-01\nevidence:\n  - src/x.ts:2\n  - node -e "process.exit(0)"\n---\n# S\n',
  })
  clearConfigCache()
  try {
    const { results, stamped } = verifyDocs(root, { stamp: true, now: new Date('2026-09-03T12:00:00Z') })
    assert.equal(results.length, 2)
    assert.ok(results.every((r) => r.ok))
    assert.deepEqual(stamped, ['docs/modules/crm/state/s.md'])
    assert.match(readFileSync(join(root, 'docs/modules/crm/state/s.md'), 'utf8'), /^verified_on: 2026-09-03$/m)
    const lock = JSON.parse(readFileSync(join(root, 'docs/evidence-lock.json'), 'utf8'))
    assert.equal(typeof lock.entries['docs/modules/crm/state/s.md']['src/x.ts:2'], 'string')
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('verify reports a failing command and does not stamp', () => {
  const root = gitFixture({
    'docs-system.config.json': CONFIG,
    'docs/modules/crm/state/s.md':
      '---\ntitle: S\nkind: state\nmodule: crm\nstatus: active\nupdated: 2026-08-01\nverified_on: 2026-08-01\nevidence:\n  - node -e "process.exit(3)"\n---\n# S\n',
  })
  clearConfigCache()
  try {
    const { results, stamped } = verifyDocs(root, { stamp: true })
    assert.equal(results[0].ok, false)
    assert.equal(results[0].detail, 'exit 3') // no stderr, so no trailing separator
    assert.deepEqual(stamped, [])
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('the gate warns when a locked evidence line has changed', () => {
  const root = gitFixture({
    'docs-system.config.json': CONFIG,
    'src/x.ts': 'line1\nline2\n',
    'docs/modules/crm/state/s.md':
      '---\ntitle: S\nkind: state\nmodule: crm\nstatus: active\nupdated: 2026-08-01\nverified_on: 2026-08-01\nevidence:\n  - src/x.ts:2\n---\n# S\n',
  })
  clearConfigCache()
  try {
    verifyDocs(root, {})
    execFileSync(process.execPath, [join(PACKAGE_ROOT, 'scripts', 'gen-docs-index.mjs')], { cwd: root, stdio: 'pipe' })
    assert.ok(!checkDocs(root).some((v) => v.rule === 'evidence-lock'))
    writeFileSync(join(root, 'src/x.ts'), 'line1\nCHANGED\n')
    const hit = checkDocs(root).find((v) => v.rule === 'evidence-lock')
    assert.ok(hit)
    assert.equal(hit.severity, 'warn')
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('--stamp leaves the index fresh — verified_on is a field the index carries', () => {
  // Default configuration on purpose: this fixture has to be gate-clean before
  // the stamp for the assertion after it to mean anything.
  const root = gitFixture({
    'src/x.ts': 'line1\nline2\nline3\n',
    'docs/engineering/e.md':
      '---\ntitle: E\nkind: engineering\nstatus: active\nupdated: 2026-08-01\nverified_on: 2026-08-01\nevidence:\n  - src/x.ts:2\n---\n# E\n',
  })
  clearConfigCache()
  try {
    execFileSync(process.execPath, [join(PACKAGE_ROOT, 'scripts', 'gen-docs-index.mjs')], { cwd: root, stdio: 'pipe' })
    assert.deepEqual(checkDocs(root).filter((v) => v.rule === 'index'), [])
    const { stamped } = verifyDocs(root, { stamp: true, now: new Date('2026-09-03T12:00:00Z') })
    assert.deepEqual(stamped, ['docs/engineering/e.md'])
    assert.match(readFileSync(join(root, 'docs/index.json'), 'utf8'), /2026-09-03/)
    assert.deepEqual(checkDocs(root).filter((v) => v.rule === 'index'), [])
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a :line past the end of the file, or line 0, fails rather than hashing nothing', () => {
  const root = gitFixture({
    'docs-system.config.json': CONFIG,
    'src/x.ts': 'line1\nline2\nline3\n',
    'docs/modules/crm/state/s.md':
      '---\ntitle: S\nkind: state\nmodule: crm\nstatus: active\nupdated: 2026-08-01\nverified_on: 2026-08-01\nevidence:\n  - src/x.ts:99\n  - src/x.ts:0\n---\n# S\n',
  })
  clearConfigCache()
  try {
    const { results, stamped } = verifyDocs(root, { stamp: true })
    assert.deepEqual(results.map((r) => r.ok), [false, false])
    assert.match(results[0].detail, /past end of file/)
    assert.match(results[1].detail, /past end of file/)
    assert.deepEqual(stamped, [])
    const lock = JSON.parse(readFileSync(join(root, 'docs/evidence-lock.json'), 'utf8'))
    assert.equal(lock.entries['docs/modules/crm/state/s.md'], undefined)
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('--only matching nothing verifies nothing and leaves the lock alone', () => {
  const root = gitFixture({
    'docs-system.config.json': CONFIG,
    'src/x.ts': 'line1\nline2\n',
    'docs/modules/crm/state/s.md':
      '---\ntitle: S\nkind: state\nmodule: crm\nstatus: active\nupdated: 2026-08-01\nverified_on: 2026-08-01\nevidence:\n  - src/x.ts:2\n---\n# S\n',
  })
  clearConfigCache()
  try {
    verifyDocs(root, {})
    const before = readFileSync(join(root, 'docs/evidence-lock.json'), 'utf8')
    const { results, stamped, matched } = verifyDocs(root, { only: 'docs/nowhere.md', stamp: true })
    assert.deepEqual(results, [])
    assert.deepEqual(stamped, [])
    assert.equal(matched, 0)
    assert.equal(readFileSync(join(root, 'docs/evidence-lock.json'), 'utf8'), before)
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('--stamp on a block with no updated anchor writes verified_on under title, not above it', () => {
  const root = gitFixture({
    'docs/engineering/e.md': '---\ntitle: E\nkind: engineering\nstatus: active\nevidence:\n  - node -e "process.exit(0)"\n---\n# E\n',
  })
  clearConfigCache()
  try {
    verifyDocs(root, { stamp: true, now: new Date('2026-09-03T12:00:00Z') })
    assert.match(readFileSync(join(root, 'docs/engineering/e.md'), 'utf8'), /^---\ntitle: E\nverified_on: 2026-09-03\n/)
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('the gate warns when a locked evidence line has vanished, not just when it changed', () => {
  const root = gitFixture({
    'docs-system.config.json': CONFIG,
    'src/x.ts': 'line1\nline2\nline3\n',
    'docs/modules/crm/state/s.md':
      '---\ntitle: S\nkind: state\nmodule: crm\nstatus: active\nupdated: 2026-08-01\nverified_on: 2026-08-01\nevidence:\n  - src/x.ts:3\n---\n# S\n',
  })
  clearConfigCache()
  try {
    verifyDocs(root, {})
    execFileSync(process.execPath, [join(PACKAGE_ROOT, 'scripts', 'gen-docs-index.mjs')], { cwd: root, stdio: 'pipe' })
    assert.ok(!checkDocs(root).some((v) => v.rule === 'evidence-lock'))
    writeFileSync(join(root, 'src/x.ts'), 'line1\nline2\n')
    const hit = checkDocs(root).find((v) => v.rule === 'evidence-lock')
    assert.ok(hit)
    assert.equal(hit.severity, 'warn')
    assert.match(hit.message, /past the end of the file/)
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

/** A lock left holding a merge conflict — the realistic way this file breaks. */
const CONFLICTED_LOCK = '<<<<<<< HEAD\n{\n  "entries": {}\n}\n=======\n{\n  "entries": {}\n}\n>>>>>>> theirs\n'

test('a lock that is not valid JSON is reported as a violation, never thrown', () => {
  const root = gitFixture({
    'docs/engineering/x.md': '---\ntitle: X\nkind: engineering\nstatus: active\nupdated: 2026-08-27\n---\n# X\n',
    'docs/evidence-lock.json': CONFLICTED_LOCK,
  })
  clearConfigCache()
  try {
    const violations = checkDocs(root)
    const hit = violations.find((violation) => violation.rule === 'evidence-lock')
    assert.ok(hit, 'a corrupt lock must be reported')
    assert.equal(hit.file, 'docs/evidence-lock.json')
    assert.equal(hit.severity, 'warn')
    assert.match(hit.message, /is not valid JSON — delete it and re-run `ai-doc-system verify`/)
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a corrupt lock is reported at the severity the project configured for evidence-lock', () => {
  const root = gitFixture({
    'docs-system.config.json': JSON.stringify({ rules: { 'evidence-lock': 'error' } }),
    'docs/engineering/x.md': '---\ntitle: X\nkind: engineering\nstatus: active\nupdated: 2026-08-27\n---\n# X\n',
    'docs/evidence-lock.json': CONFLICTED_LOCK,
  })
  clearConfigCache()
  try {
    assert.equal(checkDocs(root).find((violation) => violation.rule === 'evidence-lock')?.severity, 'error')
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a lock configured off says nothing about a corrupt lock', () => {
  const root = gitFixture({
    'docs-system.config.json': JSON.stringify({ rules: { 'evidence-lock': 'off' } }),
    'docs/engineering/x.md': '---\ntitle: X\nkind: engineering\nstatus: active\nupdated: 2026-08-27\n---\n# X\n',
    'docs/evidence-lock.json': CONFLICTED_LOCK,
  })
  clearConfigCache()
  try {
    assert.deepEqual(checkDocs(root).filter((violation) => violation.rule === 'evidence-lock'), [])
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * The `run` seam. `runCommand`'s failure branches — a non-zero exit with
 * stderr, a timeout, a signal — are what an author reads when a claim stops
 * being true, and two of them cannot be provoked cheaply (the timeout is 60 s).
 * The seam feeds each outcome in and asserts what `verifyDocs` does with it.
 */
test('a failing command is reported with its detail and blocks the stamp, whatever the failure was', () => {
  const details = ['exit 1: AssertionError: expected 2', 'timed out after 60 s', 'killed by SIGKILL']
  for (const detail of details) {
    const root = gitFixture({
      'docs/engineering/x.md':
        '---\ntitle: X\nkind: engineering\nstatus: active\nupdated: 2026-08-27\nevidence:\n  - npm test\n---\n# X\n',
    })
    clearConfigCache()
    try {
      const calls = []
      const { results, stamped } = verifyDocs(root, {
        stamp: true,
        run: (cwd, command) => {
          calls.push(command)
          return { ok: false, detail }
        },
      })
      assert.deepEqual(calls, ['npm test'])
      assert.deepEqual(results, [{ doc: 'docs/engineering/x.md', entry: 'npm test', kind: 'command', ok: false, detail }])
      assert.deepEqual(stamped, [])
      assert.doesNotMatch(readFileSync(join(root, 'docs/engineering/x.md'), 'utf8'), /verified_on/)
    } finally {
      clearConfigCache()
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('a real non-zero exit carries git\'s own first line of stderr', () => {
  const root = gitFixture({
    'docs/engineering/x.md':
      '---\ntitle: X\nkind: engineering\nstatus: active\nupdated: 2026-08-27\nevidence:\n  - node -e "console.error(\'first line\'); process.exit(7)"\n---\n# X\n',
  })
  clearConfigCache()
  try {
    const { results } = verifyDocs(root, {})
    assert.equal(results.length, 1)
    assert.equal(results[0].ok, false)
    assert.equal(results[0].detail, 'exit 7: first line')
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('hashEvidence of `path:line` is the sha256 of that line alone, and a different line does not move it', () => {
  const root = gitFixture({ 'src/x.ts': 'alpha\nbeta\ngamma\n' })
  try {
    const expected = createHash('sha256').update('beta').digest('hex')
    assert.equal(hashEvidence(root, { path: 'src/x.ts', from: 2, to: null }), expected)
    // A range is the named lines joined by the newline that separated them.
    assert.equal(
      hashEvidence(root, { path: 'src/x.ts', from: 2, to: 3 }),
      createHash('sha256').update('beta\ngamma').digest('hex'),
    )
    writeFileSync(join(root, 'src/x.ts'), 'ALPHA\nbeta\nGAMMA\n')
    assert.equal(hashEvidence(root, { path: 'src/x.ts', from: 2, to: null }), expected)
    // The whole-file hash is a different claim and does move.
    assert.notEqual(hashEvidence(root, { path: 'src/x.ts', from: null, to: null }), expected)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('--only rewrites the whole lock and leaves every other document\'s rows byte-identical', () => {
  const root = gitFixture({
    'src/a.ts': 'a1\na2\n',
    'src/b.ts': 'b1\nb2\n',
    'docs/engineering/a.md':
      '---\ntitle: A\nkind: engineering\nstatus: active\nupdated: 2026-08-27\nevidence:\n  - src/a.ts:1\n---\n# A\n',
    'docs/engineering/b.md':
      '---\ntitle: B\nkind: engineering\nstatus: active\nupdated: 2026-08-27\nevidence:\n  - src/b.ts:1\n---\n# B\n',
  })
  clearConfigCache()
  try {
    verifyDocs(root, {})
    const before = JSON.parse(readFileSync(join(root, 'docs/evidence-lock.json'), 'utf8'))
    // b's evidence moves under it, but this run is not about b.
    writeFileSync(join(root, 'src/b.ts'), 'CHANGED\nb2\n')
    verifyDocs(root, { only: 'docs/engineering/a.md' })
    const after = JSON.parse(readFileSync(join(root, 'docs/evidence-lock.json'), 'utf8'))
    assert.deepEqual(after.entries['docs/engineering/b.md'], before.entries['docs/engineering/b.md'])
    assert.deepEqual(after.entries['docs/engineering/a.md'], before.entries['docs/engineering/a.md'])
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})
