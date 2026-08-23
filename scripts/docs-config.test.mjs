/**
 * Tests for the per-project configuration layer — the part that makes one
 * checkout of these scripts serve several repositories. Each case builds a
 * throwaway tree, so `loadConfig`'s per-root cache never collides.
 *
 * Run: node --test scripts/docs-config.test.mjs
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { CONFIG_FILE, DEFAULTS, loadConfig } from './docs-config.mjs'
import { kindForPath, isExempt } from './docs-taxonomy.mjs'
import { checkDocs } from './check-docs.mjs'
import { buildIndex, renderIndex } from './gen-docs-index.mjs'


function fixture(files, config) {
  const root = mkdtempSync(join(tmpdir(), 'docs-config-'))
  if (config !== undefined) {
    writeFileSync(join(root, CONFIG_FILE), typeof config === 'string' ? config : JSON.stringify(config))
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

function withFixture(files, config, body) {
  const root = fixture(files, config)
  try {
    return body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function doc(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`)
  return `---\n${lines.join('\n')}\n---\n\n# ${fields.title ?? 'Doc'}\n\nBody.\n`
}

const ACTIVE = doc({ title: 'A doc', status: 'active', updated: '2026-08-23' })

test('a project with no config file gets the defaults', () => {
  withFixture({ 'docs/engineering/a.md': ACTIVE }, undefined, (root) => {
    const config = loadConfig(root)
    assert.equal(config.docsDir, DEFAULTS.docsDir)
    assert.deepEqual(config.statuses, DEFAULTS.statuses)
    assert.equal(kindForPath(config, 'docs/engineering/a.md'), 'engineering')
    assert.ok(isExempt(config, 'docs/README.md'))
  })
})

test('docsDir moves the whole tree, index included', () => {
  withFixture({ 'documentation/engineering/a.md': ACTIVE }, { docsDir: 'documentation' }, (root) => {
    const config = loadConfig(root)
    assert.equal(kindForPath(config, 'documentation/engineering/a.md'), 'engineering')
    assert.deepEqual(
      buildIndex(root, config).map((entry) => entry.path),
      ['documentation/engineering/a.md'],
    )
    assert.deepEqual(
      renderIndex(root, config).map(([path]) => path),
      ['documentation/index.json', 'documentation/INDEX.md'],
    )
  })
})

test('custom tiers change which kind a path implies', () => {
  const config = { tiers: [['rfc/', 'rfc'], ['guides/', 'guide']], tierOrder: ['guide', 'rfc'] }
  withFixture({ 'docs/rfc/0001.md': ACTIVE }, config, (root) => {
    const resolved = loadConfig(root)
    assert.equal(kindForPath(resolved, 'docs/rfc/0001.md'), 'rfc')
    assert.equal(kindForPath(resolved, 'docs/engineering/a.md'), null)
    assert.deepEqual(resolved.kinds, ['rfc', 'guide'])
  })
})

test('a tier that forces a status is enforced in both directions', () => {
  const config = { tiers: [['ideas/', 'idea'], ['engineering/', 'engineering']], tierStatus: { idea: 'reference' } }
  const files = {
    'docs/ideas/good.md': doc({ title: 'Good', status: 'reference', updated: '2026-08-23' }),
    'docs/ideas/bad.md': doc({ title: 'Bad', status: 'active', updated: '2026-08-23' }),
    'docs/engineering/leaked.md': doc({ title: 'Leaked', status: 'reference', updated: '2026-08-23' }),
  }
  withFixture(files, config, (root) => {
    const violations = checkDocs(root).filter((v) => v.field === 'status')
    assert.deepEqual(
      violations.map((v) => v.file).sort(),
      ['docs/engineering/leaked.md', 'docs/ideas/bad.md'],
    )
  })
})

test('an unknown config key is rejected rather than silently ignored', () => {
  withFixture({}, { tierz: [] }, (root) => {
    assert.throws(() => loadConfig(root), /unknown key "tierz"/)
  })
})

test('a tier prefix without a trailing slash is rejected', () => {
  withFixture({}, { tiers: [['rfc', 'rfc']] }, (root) => {
    assert.throws(() => loadConfig(root), /must end with "\/"/)
  })
})

test('tierStatus naming a status outside the vocabulary is rejected', () => {
  withFixture({}, { statuses: ['active'], tierStatus: { idea: 'reference' } }, (root) => {
    assert.throws(() => loadConfig(root), /not in "statuses"/)
  })
})

test('a malformed config file names itself in the error', () => {
  withFixture({}, '{ not json', (root) => {
    assert.throws(() => loadConfig(root), new RegExp(CONFIG_FILE))
  })
})
