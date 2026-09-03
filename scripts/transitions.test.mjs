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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { checkDocs } from './check-docs.mjs'
import { writeIndex } from './gen-docs-index.mjs'
import { mvDoc } from './mv-doc.mjs'
import { newDoc } from './new-doc.mjs'

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

/** The two history-aware rule ids, for assertions that expect none of them. */
const promotionRules = (violations) =>
  violations.filter((v) => v.rule === 'transition' || v.rule === 'promoted-verbatim')

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
    const hit = checkDocs(root, undefined, { base: 'HEAD' }).find((v) => v.rule === 'promoted-verbatim')
    assert.ok(hit)
    assert.match(hit.message, /body is identical/)
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

test('a correct promotion stays clean at the fork point and after later commits', () => {
  const root = gitFixture({
    'docs/reference/x.md': '---\ntitle: X\nkind: reference\nstatus: reference\nupdated: 2026-08-17\n---\n# X\n\nTheirs.\n',
  })
  try {
    regen(root)
    commitAll(root)
    const fork = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    mkdirSync(join(root, 'docs/product'), { recursive: true })
    execFileSync('git', ['mv', 'docs/reference/x.md', 'docs/product/x.md'], { cwd: root, stdio: 'pipe' })
    writeFileSync(
      join(root, 'docs/product/x.md'),
      '---\ntitle: X\nkind: product\nstatus: draft\nupdated: 2026-09-03\npromoted_from: docs/reference/x.md\n---\n# X\n\nOurs.\n',
    )
    regen(root)
    assert.deepEqual(promotionRules(checkDocs(root, undefined, { base: fork })), [])
    // The promotion is history now. A later, unrelated commit must not make the
    // gate re-judge it — that is the failure that never clears.
    commitAll(root)
    writeFileSync(join(root, 'README.md'), '# Later\n')
    commitAll(root)
    assert.deepEqual(promotionRules(checkDocs(root, undefined, { base: 'HEAD' })), [])
    assert.deepEqual(promotionRules(checkDocs(root, undefined, { base: fork })), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a status moved on base after the fork is not this branch\'s transition', () => {
  const root = gitFixture({ 'docs/product/x.md': fm('shipped'), 'src/a.ts': 'a\n' })
  try {
    regen(root)
    commitAll(root)
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    git('branch', '-M', 'main')
    git('checkout', '-qb', 'feature')
    // main moves on without this branch: shipped -> superseded over there.
    git('checkout', '-q', 'main')
    writeFileSync(join(root, 'docs/product/x.md'), fm('superseded', 'superseded_by: docs/product/x.md\n'))
    regen(root)
    commitAll(root)
    // The branch touched something else entirely.
    git('checkout', '-q', 'feature')
    writeFileSync(join(root, 'src/a.ts'), 'b\n')
    const violations = checkDocs(root, undefined, { base: 'main' })
    assert.deepEqual(violations.filter((v) => v.rule === 'transition'), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a cross-tier move without promoted_from is still a promotion', () => {
  const root = gitFixture({
    'docs/reference/x.md': '---\ntitle: X\nkind: reference\nstatus: reference\nupdated: 2026-08-17\n---\n# X\n\nTheirs, at length: a competitor page, copied into the reference tier so the\nteam can read it without pretending it is ours. Several sentences of it,\nbecause a real reference document is never one line long.\n',
  })
  try {
    regen(root)
    commitAll(root)
    mkdirSync(join(root, 'docs/product'), { recursive: true })
    execFileSync('git', ['mv', 'docs/reference/x.md', 'docs/product/x.md'], { cwd: root, stdio: 'pipe' })
    writeFileSync(
      join(root, 'docs/product/x.md'),
      '---\ntitle: X\nkind: product\nstatus: shipped\nupdated: 2026-09-03\n---\n# X\n\nTheirs, at length: a competitor page, copied into the reference tier so the\nteam can read it without pretending it is ours. Several sentences of it,\nbecause a real reference document is never one line long.\n',
    )
    regen(root)
    const violations = checkDocs(root, undefined, { base: 'HEAD' })
    const promotion = violations.filter((v) => v.rule === 'promoted-verbatim')
    assert.ok(promotion.some((v) => /moved from docs\/reference\/x\.md across tiers without promoted_from/.test(v.message)))
    assert.ok(promotion.some((v) => /body is identical/.test(v.message)))
    assert.ok(violations.some((v) => v.rule === 'transition' && /reference -> shipped/.test(v.message)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a document edited without changing status is not a transition', () => {
  const root = gitFixture({ 'docs/product/x.md': fm('shipped') })
  try {
    regen(root)
    commitAll(root)
    writeFileSync(join(root, 'docs/product/x.md'), `${fm('shipped')}\nA further paragraph.\n`)
    regen(root)
    assert.deepEqual(checkDocs(root, undefined, { base: 'HEAD' }).filter((v) => v.rule === 'transition'), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a status the project added to the vocabulary is never checked', () => {
  const root = gitFixture({
    'docs-system.config.json': JSON.stringify({ 'statuses+': ['proposed'] }),
    'docs/product/x.md': fm('shipped'),
  })
  try {
    regen(root)
    commitAll(root)
    // `shipped -> anything but superseded` is refused for the statuses the gate
    // owns; `proposed` is the project's, and the gate has no graph for it.
    writeFileSync(join(root, 'docs/product/x.md'), fm('proposed'))
    regen(root)
    assert.deepEqual(checkDocs(root, undefined, { base: 'HEAD' }).filter((v) => v.rule === 'transition'), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a same-tier rename is not a promotion and needs no rewrite', () => {
  const doc = '---\ntitle: X\nkind: product\nstatus: active\nupdated: 2026-08-17\n---\n# X\n\nBody that nobody has to rewrite just because the file was renamed.\n'
  const root = gitFixture({ 'docs/product/x.md': doc })
  try {
    regen(root)
    commitAll(root)
    execFileSync('git', ['mv', 'docs/product/x.md', 'docs/product/y.md'], { cwd: root, stdio: 'pipe' })
    regen(root)
    assert.deepEqual(promotionRules(checkDocs(root, undefined, { base: 'HEAD' })), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/** Replace everything after the frontmatter block, leaving the block untouched. */
function rewriteBody(root, path, body) {
  const text = readFileSync(join(root, path), 'utf8')
  const end = text.indexOf('\n---\n', 4)
  writeFileSync(join(root, path), `${text.slice(0, end + 5)}\n${body}\n`)
}

test('a document captured and promoted on the same branch is the tool\'s own output, not a defect', () => {
  const captured = '# Y\n\nTheirs, at length: a competitor page copied into the reference tier so the\nteam can read it without pretending it is ours.\n'
  const root = gitFixture({
    'docs/reference/y.md': `---\ntitle: Y\nkind: reference\nstatus: reference\nupdated: 2026-08-17\n---\n${captured}`,
  })
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    regen(root)
    commitAll(root)
    git('branch', '-M', 'main')
    git('checkout', '-qb', 'feature')

    // Born on this branch: `new` writes it, the branch commits it, `mv`
    // promotes it. Its origin never existed at the merge base, and that is the
    // tool's own output rather than a broken `promoted_from`.
    newDoc(root, 'docs/reference/x.md', { title: 'X', summary: 'Captured today.' })
    rewriteBody(root, 'docs/reference/x.md', '# X\n\nTheir words, captured this morning.')
    regen(root)
    commitAll(root)
    mvDoc(root, 'docs/reference/x.md', 'docs/product/x.md')
    rewriteBody(root, 'docs/product/x.md', '# X\n\nOur words, describing what we are building.')

    // Promoted from a document that DID exist at the base, with the prose left
    // verbatim: the check this fix must not disable.
    mvDoc(root, 'docs/reference/y.md', 'docs/product/y.md')
    regen(root)

    const violations = checkDocs(root, undefined, { base: 'main' })
    assert.deepEqual(
      violations.filter((v) => v.file === 'docs/product/x.md' && (v.rule === 'promoted-verbatim' || v.rule === 'transition')),
      [],
    )
    const verbatim = violations.filter((v) => v.rule === 'promoted-verbatim')
    assert.equal(verbatim.length, 1)
    assert.equal(verbatim[0].file, 'docs/product/y.md')
    assert.match(verbatim[0].message, /body is identical/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
