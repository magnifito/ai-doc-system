/**
 * Tests for the package CLI (`cli/cli.mjs`) — the entry point npm consumers
 * run as `npx ai-doc-system <command>`. Driven through child processes, which
 * also proves the scripts' run-direct guards fire only when intended.
 *
 * Run: node --test scripts/cli.test.mjs
 */
import { strict as assert } from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(PACKAGE_ROOT, 'cli', 'cli.mjs')

function cli(args, options = {}) {
  return execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8', stdio: 'pipe', ...options })
}

/**
 * `cli` returns stdout only, which is all a passing command has to say. A run
 * that exits 0 while WRITING TO STDERR — the warn-only path of the gate — needs
 * both streams and the status, so it spawns rather than throwing on failure.
 */
function cliResult(args, options = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', stdio: 'pipe', ...options })
}

/** A git repository containing exactly `files` (no commit needed). */
function gitFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-cli-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' })
  return root
}

/** The same, with everything committed, for commands that read git history. */
function committedGitFixture(files) {
  const root = gitFixture(files)
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('config', 'user.email', 'test@example.test')
  git('config', 'user.name', 'Test')
  git('add', '-A')
  git('commit', '-qm', 'fixture')
  return root
}

const GOOD = '---\ntitle: Quality gate\nkind: engineering\nstatus: active\nupdated: 2026-08-27\n---\n\n# Quality gate\n'

test('--version prints the package version', () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  assert.equal(cli(['--version']).trim(), pkg.version)
})

test('an unknown command exits 2 and names the commands', () => {
  try {
    cli(['bogus'])
    assert.fail('should have exited non-zero')
  } catch (error) {
    assert.equal(error.status, 2)
    assert.match(`${error.stderr}`, /check/)
  }
})

test('gen then check succeed in the invoking repository', () => {
  const root = gitFixture({ 'docs/engineering/quality-gate.md': GOOD })
  try {
    cli(['gen'], { cwd: root })
    assert.match(cli(['check'], { cwd: root }), /check-docs: OK/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('new writes a document the gate accepts, with no gen in between', () => {
  const root = gitFixture({})
  try {
    assert.match(cli(['new', 'docs/product/invoices.md', '--title', 'Invoices'], { cwd: root }), /created/)
    assert.match(cli(['check'], { cwd: root }), /check-docs: OK/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('advisory writes to GITHUB_STEP_SUMMARY when the variable is set', () => {
  const root = gitFixture({
    'docs/engineering/a.md':
      '---\ntitle: A\nkind: engineering\nstatus: active\nupdated: 2026-08-27\ncode: src/nowhere.ts\n---\n\n# A\n',
  })
  try {
    const summary = join(root, 'summary.md')
    cli(['advisory'], { cwd: root, env: { ...process.env, GITHUB_STEP_SUMMARY: summary } })
    assert.match(readFileSync(summary, 'utf8'), /dead `code:` pointer/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('advisory skips a block whose rule is configured off', () => {
  const doc =
    '---\ntitle: A\nkind: engineering\nstatus: active\nupdated: 2026-08-27\ncode: src/nowhere.ts\n---\n\n# A\n'
  const root = gitFixture({
    'docs-system.config.json': JSON.stringify({ rules: { 'code-pointer': 'off' } }),
    'docs/engineering/a.md': doc,
  })
  try {
    const out = cli(['advisory'], { cwd: root })
    assert.doesNotMatch(out, /code-pointer/)
    assert.doesNotMatch(out, /dead `code:` pointer/)
    assert.match(out, /\[updated-drift\]/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a rule configured `warn` prints to stderr and still exits 0', () => {
  const root = gitFixture({
    'docs-system.config.json': JSON.stringify({ rules: { implements: 'warn' } }),
    'docs/engineering/b.md':
      '---\ntitle: B\nkind: engineering\nstatus: active\nupdated: 2026-08-27\nimplements: docs/nowhere.md\n---\n\n# B\n',
  })
  try {
    cli(['gen'], { cwd: root })
    const { status, stdout, stderr } = cliResult(['check'], { cwd: root })
    assert.equal(status, 0)
    assert.match(stderr, /docs\/engineering\/b\.md:implements .* \[implements, warn\]/)
    assert.match(stdout, /check-docs: OK \(1 warning\(s\)\)/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('check --json prints a JSON report and still exits 1 on errors', () => {
  const root = gitFixture({ 'docs/engineering/x.md': '# no frontmatter\n' })
  try {
    cli(['gen'], { cwd: root })
    cli(['check', '--json'], { cwd: root })
    assert.fail('should have exited 1')
  } catch (error) {
    assert.equal(error.status, 1)
    const report = JSON.parse(error.stdout)
    assert.equal(report.ok, false)
    assert.ok(report.violations.some((v) => v.rule === 'frontmatter' && v.file === 'docs/engineering/x.md'))
    assert.equal(typeof report.errors, 'number')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('check --json on a clean tree reports ok and prints nothing else', () => {
  const root = gitFixture({ 'docs/engineering/quality-gate.md': GOOD })
  try {
    cli(['gen'], { cwd: root })
    const { status, stdout, stderr } = cliResult(['check', '--json'], { cwd: root })
    assert.equal(status, 0)
    assert.equal(stderr, '')
    assert.deepEqual(JSON.parse(stdout), { ok: true, errors: 0, warnings: 0, violations: [] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('check --format github prints workflow annotations', () => {
  const root = gitFixture({ 'docs/engineering/x.md': '# no frontmatter\n' })
  try {
    cli(['gen'], { cwd: root })
    cli(['check', '--format', 'github'], { cwd: root })
    assert.fail('should have exited 1')
  } catch (error) {
    assert.equal(error.status, 1)
    assert.match(`${error.stdout}`, /^::error file=docs\/engineering\/x\.md,title=frontmatter::/m)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('check --format github annotates a warning as ::warning and exits 0', () => {
  const root = gitFixture({
    'docs-system.config.json': JSON.stringify({ rules: { implements: 'warn' } }),
    'docs/engineering/b.md':
      '---\ntitle: B\nkind: engineering\nstatus: active\nupdated: 2026-08-27\nimplements: docs/nowhere.md\n---\n\n# B\n',
  })
  try {
    cli(['gen'], { cwd: root })
    const { status, stdout } = cliResult(['check', '--format', 'github'], { cwd: root })
    assert.equal(status, 0)
    assert.match(stdout, /^::warning file=docs\/engineering\/b\.md,title=implements::implements — /m)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('check with an unknown --format exits 2 and names the formats', () => {
  const root = gitFixture({ 'docs/engineering/quality-gate.md': GOOD })
  try {
    cli(['gen'], { cwd: root })
    const { status, stderr } = cliResult(['check', '--format', 'xml'], { cwd: root })
    assert.equal(status, 2)
    assert.match(stderr, /usage: check --format text\|github/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('check --format github escapes workflow-command metacharacters', () => {
  const root = gitFixture({
    // A double-quoted YAML scalar carrying a real newline: the value is
    // author-written, and unescaped it would end the annotation mid-line.
    'docs/engineering/c.md':
      '---\ntitle: C\nkind: engineering\nstatus: active\nupdated: 2026-08-27\nimplements: "docs/a\\nb.md"\n---\n\n# C\n',
  })
  try {
    cli(['gen'], { cwd: root })
    const { status, stdout } = cliResult(['check', '--format', 'github'], { cwd: root })
    assert.equal(status, 1)
    const lines = stdout.split('\n').filter((line) => line !== '')
    assert.ok(lines.length > 0)
    for (const line of lines) assert.match(line, /^::(error|warning) /)
    assert.match(stdout, /::error file=docs\/engineering\/c\.md,title=implements::implements — points at "docs\/a%0Ab\.md"/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('impact names the documents claiming the code that changed', () => {
  const root = committedGitFixture({
    'src/a.ts': 'x',
    'docs/product/a.md':
      '---\ntitle: A\nkind: product\nstatus: shipped\nupdated: 2026-08-27\ncode: src/a.ts\n---\n\n# A\n',
  })
  try {
    writeFileSync(join(root, 'src/a.ts'), 'changed')
    const out = cli(['impact'], { cwd: root })
    assert.match(out, /docs\/product\/a\.md claims src\/a\.ts/)
    assert.match(out, /src\/a\.ts changed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('impact with an unresolvable --base says so on stderr and still exits 0', () => {
  const root = committedGitFixture({
    'src/a.ts': 'x',
    'docs/product/a.md':
      '---\ntitle: A\nkind: product\nstatus: shipped\nupdated: 2026-08-27\ncode: src/a.ts\n---\n\n# A\n',
  })
  try {
    const { status, stderr } = cliResult(['impact', '--base', 'nope'], { cwd: root })
    assert.equal(status, 0)
    assert.match(stderr, /docs impact: base ref "nope" does not resolve/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verify runs a document command and reports the tally', () => {
  const root = gitFixture({
    'docs/engineering/verified.md':
      '---\ntitle: Verified\nkind: engineering\nstatus: active\nupdated: 2026-08-27\nevidence:\n  - node -e "process.exit(0)"\n---\n\n# Verified\n',
  })
  try {
    const { status, stdout } = cliResult(['verify'], { cwd: root })
    assert.equal(status, 0)
    assert.match(stdout, /verify: 1 passed, 0 failed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verify with an --only that matches nothing exits 2 and says so', () => {
  const root = gitFixture({
    'docs/engineering/verified.md':
      '---\ntitle: Verified\nkind: engineering\nstatus: active\nupdated: 2026-08-27\nevidence:\n  - node -e "process.exit(0)"\n---\n\n# Verified\n',
  })
  try {
    const { status, stderr } = cliResult(['verify', '--only', 'docs/nowhere.md'], { cwd: root })
    assert.equal(status, 2)
    assert.match(stderr, /verify: no document matched --only docs\/nowhere\.md/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('check --base reports a backward status transition and exits 1', () => {
  const root = committedGitFixture({
    'docs/product/x.md': '---\ntitle: X\nkind: product\nstatus: shipped\nupdated: 2026-08-27\ncode: src/x.ts\n---\n\n# X\n',
    'src/x.ts': 'x',
  })
  try {
    writeFileSync(
      join(root, 'docs/product/x.md'),
      '---\ntitle: X\nkind: product\nstatus: draft\nupdated: 2026-08-27\n---\n\n# X\n',
    )
    const { status, stderr } = cliResult(['check', '--base', 'HEAD'], { cwd: root })
    assert.equal(status, 1)
    assert.match(stderr, /docs\/product\/x\.md:status — shipped -> draft is not an allowed transition/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('check --base with a ref that does not resolve exits 2 rather than skipping the rules', () => {
  const root = committedGitFixture({ 'docs/engineering/quality-gate.md': GOOD })
  try {
    cli(['gen'], { cwd: root })
    const { status, stderr } = cliResult(['check', '--base', 'origin/nope'], { cwd: root })
    assert.equal(status, 2)
    assert.match(stderr, /check-docs: base ref "origin\/nope" does not resolve/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('context prints the authority banner for the selected documents', () => {
  const root = gitFixture({ 'docs/product/p.md': '---\ntitle: P\nkind: product\nstatus: active\nupdated: 2026-08-27\n---\n\n# P\n\nBody.\n' })
  try {
    const stdout = cli(['context', '--kind', 'product'], { cwd: root })
    assert.match(stdout, /===== docs\/product\/p\.md =====/)
    assert.match(stdout, /AUTHORITY: agreed and current — build from this\./)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('export implies --jsonl and emits one record per heading', () => {
  const root = gitFixture({ 'docs/product/p.md': '---\ntitle: P\nkind: product\nstatus: active\nupdated: 2026-08-27\n---\n\n# P\n\nBody.\n' })
  try {
    const records = cli(['export'], { cwd: root }).trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(records.map((r) => r.heading), ['P'])
    assert.equal(records[0].status, 'active')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('context with an unknown flag exits 2 with usage', () => {
  const root = gitFixture({ 'docs/product/p.md': '---\ntitle: P\nkind: product\nstatus: active\nupdated: 2026-08-27\n---\n\n# P\n' })
  try {
    const { status, stderr } = cliResult(['context', '--nope'], { cwd: root })
    assert.equal(status, 2)
    assert.match(stderr, /usage: ai-doc-system context/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('context with a path that is not a document exits 2 and names it', () => {
  const root = gitFixture({ 'docs/product/p.md': '---\ntitle: P\nkind: product\nstatus: active\nupdated: 2026-08-27\n---\n\n# P\n' })
  try {
    const { status, stderr } = cliResult(['context', 'docs/product/nope.md'], { cwd: root })
    assert.equal(status, 2)
    assert.match(stderr, /context: no document at docs\/product\/nope\.md/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
