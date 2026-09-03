/**
 * Tests for the one-shot migration. It runs as a CLI (the script executes on
 * import), so every case drives it through a child process inside a committed
 * git fixture — which is also the only honest way to cover `git mv`.
 *
 * Run: node --test scripts/migrate-docs.test.mjs
 */
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseFrontmatter } from './docs-frontmatter.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'migrate-docs.mjs')

/** A committed git repository containing exactly `files`. */
function gitFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-migrate-'))
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

function withMigrated(files, body) {
  const root = gitFixture(files)
  try {
    execFileSync(process.execPath, [SCRIPT, '--apply'], { cwd: root, stdio: 'pipe' })
    return body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('migration stamps kind derived from the destination tier', () => {
  withMigrated(
    {
      'docs/notes/thing.md': '# Thing\n\nBody.\n',
      'docs-migration.map.mjs':
        'export function destinationFor(path) {\n' +
        "  return path === 'docs/notes/thing.md' ? 'docs/engineering/thing.md' : null\n" +
        '}\n',
    },
    (root) => {
      const moved = readFileSync(join(root, 'docs/engineering/thing.md'), 'utf8')
      assert.match(moved, /kind: engineering/)
    },
  )
})

test('existing frontmatter gains a missing kind without losing its block', () => {
  withMigrated(
    {
      'docs/old/spec.md': '---\ntitle: Spec\nstatus: active\nupdated: 2026-01-01\n---\n\n# Spec\n',
      'docs-migration.map.mjs':
        'export function destinationFor(path) {\n' +
        "  return path === 'docs/old/spec.md' ? 'docs/plans/spec.md' : null\n" +
        '}\n',
    },
    (root) => {
      const moved = readFileSync(join(root, 'docs/plans/spec.md'), 'utf8')
      assert.match(moved, /title: Spec/)
      assert.match(moved, /kind: plan/)
    },
  )
})

test('migration stamps module when the project declares modules', () => {
  withMigrated(
    {
      'docs-system.config.json': JSON.stringify({
        tiers: [['modules/*/state/', 'state']],
        modules: [{ key: 'crm', class: 'anchor', requires: [] }],
      }),
      'docs/pipelines.md': '# Pipelines\n\nBody.\n',
      'docs-migration.map.mjs':
        'export function destinationFor(path) {\n' +
        "  return path === 'docs/pipelines.md' ? 'docs/modules/crm/state/pipelines.md' : null\n" +
        '}\n',
    },
    (root) => {
      const moved = readFileSync(join(root, 'docs/modules/crm/state/pipelines.md'), 'utf8')
      assert.match(moved, /kind: state/)
      assert.match(moved, /module: crm/)
    },
  )
})

test('a blank frontmatter value falls back instead of migrating as empty', () => {
  withMigrated(
    {
      'docs/notes/thing.md': '---\ntitle:\nstatus: active\n---\n\n# Thing\n\nBody.\n',
      'docs-migration.map.mjs':
        'export function destinationFor(path) {\n' +
        "  return path === 'docs/notes/thing.md' ? 'docs/engineering/thing.md' : null\n" +
        '}\n',
    },
    (root) => {
      const moved = readFileSync(join(root, 'docs/engineering/thing.md'), 'utf8')
      assert.match(moved, /title: Thing/)
      // Filled in place: a second `title:` line would make the block duplicate-
      // keyed, which is unparseable YAML and fails the gate outright.
      const { data, error } = parseFrontmatter(moved)
      assert.equal(error, null)
      assert.equal(data.title, 'Thing')
    },
  )
})
