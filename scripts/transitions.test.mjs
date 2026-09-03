/**
 * Tests for the two git-aware assertions `check --base <ref>` adds: a status
 * may only move along an allowed edge, and a promoted document may not carry
 * its origin's prose verbatim.
 *
 * These fixtures are real git repositories with a real commit, because the
 * rules compare the working tree against a ref — nothing else can exercise
 * them.
 *
 * Run: node --test scripts/transitions.test.mjs
 */
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { checkDocs } from './check-docs.mjs'
import { writeIndex } from './gen-docs-index.mjs'

/** A committed git repository containing exactly `files`. */
function gitFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-transitions-'))
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

/** Bring INDEX.md and index.json back in step with the tree. */
function regen(root) {
  writeIndex(root)
}

/** Commit whatever the fixture currently holds, so `HEAD` is that tree. */
function commitAll(root) {
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' })
  execFileSync('git', ['commit', '-qm', 'index'], { cwd: root, stdio: 'pipe' })
}

const fm = (status, extra = '') => `---\ntitle: X\nkind: product\nstatus: ${status}\nupdated: 2026-08-17\n${extra}---\n# X\n\nBody.\n`

test('a forward transition passes, a backward one fails, and no --base means no check', () => {
  const root = gitFixture({ 'docs/product/x.md': fm('shipped') })
  try {
    regen(root)
    commitAll(root)
    writeFileSync(join(root, 'docs/product/x.md'), fm('draft'))
    regen(root)
    const violations = checkDocs(root, undefined, { base: 'HEAD' })
    const hit = violations.find((v) => v.rule === 'transition')
    assert.ok(hit)
    assert.match(hit.message, /shipped -> draft/)
    assert.ok(!checkDocs(root).some((v) => v.rule === 'transition'))
    writeFileSync(join(root, 'docs/product/x.md'), fm('superseded', 'superseded_by: docs/product/y.md\n'))
    writeFileSync(join(root, 'docs/product/y.md'), fm('active'))
    regen(root)
    assert.ok(!checkDocs(root, undefined, { base: 'HEAD' }).some((v) => v.rule === 'transition'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a promoted document whose body is identical to its origin at base fails', () => {
  const origin = '---\ntitle: X\nkind: reference\nstatus: reference\nupdated: 2026-08-17\n---\n# X\n\nCompetitor prose.\n'
  const root = gitFixture({ 'docs/reference/x.md': origin })
  try {
    regen(root)
    commitAll(root)
    mkdirSync(join(root, 'docs/product'), { recursive: true })
    execFileSync('git', ['mv', 'docs/reference/x.md', 'docs/product/x.md'], { cwd: root, stdio: 'pipe' })
    writeFileSync(
      join(root, 'docs/product/x.md'),
      '---\ntitle: X\nkind: product\nstatus: draft\nupdated: 2026-09-03\npromoted_from: docs/reference/x.md\n---\n# X\n\nCompetitor prose.\n',
    )
    regen(root)
    assert.ok(checkDocs(root, undefined, { base: 'HEAD' }).some((v) => v.rule === 'promoted-verbatim'))
    writeFileSync(
      join(root, 'docs/product/x.md'),
      '---\ntitle: X\nkind: product\nstatus: draft\nupdated: 2026-09-03\npromoted_from: docs/reference/x.md\n---\n# X\n\nOur prose.\n',
    )
    regen(root)
    assert.ok(!checkDocs(root, undefined, { base: 'HEAD' }).some((v) => v.rule === 'promoted-verbatim'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reference -> active skips draft and fails; promoted_from must name a document that existed at base', () => {
  const root = gitFixture({
    'docs/reference/x.md': '---\ntitle: X\nkind: reference\nstatus: reference\nupdated: 2026-08-17\n---\n# X\n',
  })
  try {
    regen(root)
    commitAll(root)
    mkdirSync(join(root, 'docs/product'), { recursive: true })
    execFileSync('git', ['mv', 'docs/reference/x.md', 'docs/product/x.md'], { cwd: root, stdio: 'pipe' })
    writeFileSync(
      join(root, 'docs/product/x.md'),
      '---\ntitle: X\nkind: product\nstatus: active\nupdated: 2026-09-03\npromoted_from: docs/reference/x.md\n---\n# X\n\nNew.\n',
    )
    regen(root)
    const violations = checkDocs(root, undefined, { base: 'HEAD' })
    assert.ok(violations.some((v) => v.rule === 'transition' && /reference -> active/.test(v.message)))
    writeFileSync(
      join(root, 'docs/product/x.md'),
      '---\ntitle: X\nkind: product\nstatus: draft\nupdated: 2026-09-03\npromoted_from: docs/reference/nope.md\n---\n# X\n\nNew.\n',
    )
    regen(root)
    assert.ok(
      checkDocs(root, undefined, { base: 'HEAD' }).some(
        (v) => v.rule === 'promoted-verbatim' && /did not exist at HEAD/.test(v.message),
      ),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a promotion that left the origin in place is a copy, not a move, and fails', () => {
  const root = gitFixture({
    'docs/reference/x.md': '---\ntitle: X\nkind: reference\nstatus: reference\nupdated: 2026-08-17\n---\n# X\n\nTheirs.\n',
  })
  try {
    regen(root)
    commitAll(root)
    // The origin is still there: the author copied the file instead of moving it.
    mkdirSync(join(root, 'docs/product'), { recursive: true })
    writeFileSync(
      join(root, 'docs/product/x.md'),
      '---\ntitle: X\nkind: product\nstatus: draft\nupdated: 2026-09-03\npromoted_from: docs/reference/x.md\n---\n# X\n\nOurs.\n',
    )
    regen(root)
    const hit = checkDocs(root, undefined, { base: 'HEAD' }).find((v) => v.rule === 'promoted-verbatim')
    assert.ok(hit)
    assert.match(hit.message, /names docs\/reference\/x\.md, which still exists — promotion is a move/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
