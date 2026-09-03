/**
 * Tests for `ai-doc-system init` — the greenfield path: give a repository a
 * gated docs tree in one command. Driven through the CLI like a consumer.
 *
 * Run: node --test scripts/init-docs.test.mjs
 */
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'cli.mjs')

function cli(args, options = {}) {
  return execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8', stdio: 'pipe', ...options })
}

function gitFixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'docs-init-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' })
  return root
}

test('init creates a gated docs tree that immediately passes the gate', () => {
  const root = gitFixture({ 'package.json': JSON.stringify({ name: 'host', version: '1.0.0' }) })
  try {
    cli(['init'], { cwd: root })
    assert.ok(existsSync(join(root, 'docs/README.md')))
    assert.ok(existsSync(join(root, 'docs/INDEX.md')))
    assert.ok(existsSync(join(root, 'docs/index.json')))
    assert.match(cli(['check'], { cwd: root }), /check-docs: OK/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('init wires the scripts into the host package.json without clobbering', () => {
  const root = gitFixture({
    'package.json': JSON.stringify({
      name: 'host',
      version: '1.0.0',
      scripts: { 'lint:docs': 'my-own-command' },
    }),
  })
  try {
    cli(['init'], { cwd: root })
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts['lint:docs'], 'my-own-command')
    assert.equal(pkg.scripts['gen:docs-index'], 'ai-doc-system gen')
    assert.equal(pkg.scripts['lint:docs:advisory'], 'ai-doc-system advisory')
    assert.equal(pkg.scripts['docs:impact'], 'ai-doc-system impact')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('init is idempotent and never overwrites an existing docs README', () => {
  const root = gitFixture({ 'package.json': JSON.stringify({ name: 'host', version: '1.0.0' }) })
  try {
    cli(['init'], { cwd: root })
    writeFileSync(join(root, 'docs/README.md'), '# Mine\n')
    cli(['init'], { cwd: root })
    assert.equal(readFileSync(join(root, 'docs/README.md'), 'utf8'), '# Mine\n')
    assert.match(cli(['check'], { cwd: root }), /check-docs: OK/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
