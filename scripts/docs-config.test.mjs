/**
 * Tests for the per-project configuration layer — the part that makes one
 * checkout of these scripts serve several repositories. Each case builds a
 * throwaway tree, so `loadConfig`'s per-root cache never collides.
 *
 * Run: node --test scripts/docs-config.test.mjs
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { CONFIG_FILE, DEFAULTS, clearConfigCache, loadConfig, withDerived } from './docs-config.mjs'
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
    // The cache is keyed by root, and several bodies below write a config file
    // and call `loadConfig` — leaving a resolved config behind for a directory
    // that no longer exists. Cheap to clear, and it keeps one test from
    // deciding what the next one reads.
    clearConfigCache()
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

test('overriding statuses alone is validated against the merged tierStatus', () => {
  // The default tierStatus still names `reference` and `superseded`; a statuses
  // override that drops them leaves the merged config inconsistent.
  withFixture({}, { statuses: ['active'] }, (root) => {
    assert.throws(() => loadConfig(root), /not in "statuses"/)
  })
})

test('modules without any tier under moduleRoot are rejected', () => {
  withFixture({}, { modules: [{ key: 'crm', class: 'anchor', requires: [] }] }, (root) => {
    assert.throws(() => loadConfig(root), /moduleRoot/)
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


test('rules: defaults carry every known id at its default severity', () => {
  const config = withDerived(DEFAULTS)
  assert.equal(config.rules.link, 'error')
  assert.equal(config.rules['shipped-code'], 'warn')
  assert.equal(config.rules['evidence-lock'], 'warn')
  // The advisory-only ids: never evaluated by the gate, tunable all the same.
  assert.equal(config.rules['updated-drift'], 'warn')
  assert.equal(config.rules['code-pointer'], 'warn')
  assert.equal(config.rules['verification-drift'], 'warn')
})

test('rules: an override changes one severity and keeps the rest', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-config-'))
  try {
    writeFileSync(join(root, 'docs-system.config.json'), JSON.stringify({ rules: { basename: 'warn' } }))
    clearConfigCache()
    const config = loadConfig(root)
    assert.equal(config.rules.basename, 'warn')
    assert.equal(config.rules.link, 'error')
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('rules: an unknown id or severity is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-config-'))
  try {
    writeFileSync(join(root, 'docs-system.config.json'), JSON.stringify({ rules: { bogus: 'error' } }))
    clearConfigCache()
    assert.throws(() => loadConfig(root), /unknown rule "bogus"/)
    writeFileSync(join(root, 'docs-system.config.json'), JSON.stringify({ rules: { link: 'loud' } }))
    clearConfigCache()
    assert.throws(() => loadConfig(root), /severity "loud"/)
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})


test('a "+" key extends the default array instead of replacing it', () => {
  withFixture({}, { 'referenceScanExclude+': ['site'], 'sentinels+': ['SPEC'] }, (root) => {
    clearConfigCache()
    const config = loadConfig(root)
    assert.ok(config.referenceScanExclude.includes('.claude'))
    assert.ok(config.referenceScanExclude.includes('site'))
    assert.ok(config.sentinels.includes('README') && config.sentinels.includes('SPEC'))
    assert.equal('referenceScanExclude+' in config, false)
  })
})

test('a "+" key on a non-array default is rejected', () => {
  withFixture({}, { 'docsDir+': ['x'] }, (root) => {
    clearConfigCache()
    // Both halves matter: the message names the offending key AND says why, so
    // the unknown-key path cannot satisfy this test by accident.
    assert.throws(() => loadConfig(root), /"docsDir\+"/)
    assert.throws(() => loadConfig(root), /not an array setting/)
    // A config error is not a parse error: the JSON here is perfectly valid.
    assert.throws(() => loadConfig(root), (error) => !/not valid JSON/.test(error.message))
  })
})

test('evidenceRunners has defaults and can be extended', () => {
  withFixture({}, { 'evidenceRunners+': ['just'] }, (root) => {
    clearConfigCache()
    const config = loadConfig(root)
    assert.ok(config.evidenceRunners.includes('pnpm') && config.evidenceRunners.includes('just'))
  })
})

test('a "$schema" key is allowed and ignored', () => {
  withFixture({}, { $schema: './schema/docs-system.config.schema.json' }, (root) => {
    clearConfigCache()
    const config = loadConfig(root)
    assert.equal(config.docsDir, DEFAULTS.docsDir)
    // Editor metadata, not a setting: it must not reach the resolved config.
    assert.equal('$schema' in config, false)
  })
})

test('a key and its "+" form together is rejected', () => {
  withFixture({}, { sentinels: ['README'], 'sentinels+': ['SPEC'] }, (root) => {
    clearConfigCache()
    assert.throws(() => loadConfig(root), /"sentinels" and "sentinels\+" cannot both be set/)
  })
})

test('the JSON schema names every DEFAULTS key and its "+" form for arrays', () => {
  const schema = JSON.parse(readFileSync(new URL('../schema/docs-system.config.schema.json', import.meta.url), 'utf8'))
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(key in schema.properties, `schema lacks ${key}`)
    if (Array.isArray(value)) assert.ok(`${key}+` in schema.properties, `schema lacks ${key}+`)
  }
})
