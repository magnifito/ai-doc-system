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
import { CONFIG_FILE, DEFAULTS, loadConfig, withDerived } from './docs-config.mjs'
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

test('sentinels and programme prefixes are configurable per project', () => {
  const config = { sentinels: ['README'], allowedBasenamePrefixes: ['RFC-'] }
  const files = {
    'docs/engineering/README.md': ACTIVE,          // sentinel — allowed
    'docs/engineering/RFC-0001.md': ACTIVE,        // declared prefix — allowed
    'docs/engineering/plain-note.md': ACTIVE,      // kebab — always allowed
    'docs/engineering/STATUS.md': ACTIVE,          // dropped from this project's sentinels
  }
  withFixture(files, config, (root) => {
    const paths = checkDocs(root).filter((v) => v.field === 'path')
    assert.deepEqual(paths.map((v) => v.file), ['docs/engineering/STATUS.md'])
    assert.match(paths[0].message, /not a sentinel/)
  })
})

test('a case-only rename is caught even on a case-insensitive filesystem', () => {
  // macOS and Windows resolve ./FOO.md to foo.md, so existsSync alone reports a
  // link as live after the file has been renamed — and the tree then breaks on
  // Linux. The gate compares the basename against the real directory listing.
  const body = '---\ntitle: A\nstatus: active\nupdated: 2026-08-23\n---\n\n# A\n\n[b](./b-note.md) [c](./C-NOTE.md)\n'
  withFixture(
    {
      'docs/engineering/a.md': body,
      'docs/engineering/b-note.md': ACTIVE,
      'docs/engineering/c-note.md': ACTIVE,
    },
    undefined,
    (root) => {
      const links = checkDocs(root).filter((v) => v.field === 'link')
      assert.deepEqual(links.map((v) => v.message), ['dead link -> ./C-NOTE.md'])
    },
  )
})


test('module keys are derived from the module registry plus the platform key', () => {
  const config = withDerived({
    ...DEFAULTS,
    modules: [
      { key: 'core', class: 'core', requires: [] },
      { key: 'crm', class: 'anchor', requires: [] },
      { key: 'affiliates', class: 'addon', requires: ['store', 'billing'] },
    ],
  })
  assert.deepEqual(config.moduleKeys, ['core', 'crm', 'affiliates', 'platform'])
})

test('a module registry entry with an unknown class is rejected', () => {
  const root = fixture({}, { modules: [{ key: 'crm', class: 'anchor2', requires: [] }] })
  assert.throws(() => loadConfig(root), /class "anchor2"/)
})

test('a module requiring a key that is not registered is rejected', () => {
  const root = fixture({}, { modules: [{ key: 'affiliates', class: 'addon', requires: ['store'] }] })
  assert.throws(() => loadConfig(root), /requires "store"/)
})

test('requiredFields naming a kind that no tier produces is rejected', () => {
  const root = fixture({}, { requiredFields: { nonesuch: ['x'] } })
  assert.throws(() => loadConfig(root), /requiredFields names kind "nonesuch"/)
})
