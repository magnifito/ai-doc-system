/**
 * Tests for the restamp command. Moving a document changes what its path
 * implies; this rewrites the two derived fields to match, and touches nothing
 * else in the block.
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { CONFIG_FILE, clearConfigCache, loadConfig } from './docs-config.mjs'
import { fixFrontmatter } from './fix-docs-frontmatter.mjs'

const CONFIG = {
  tiers: [
    ['modules/*/state/', 'state'],
    ['modules/*/todo/', 'todo'],
  ],
  exempt: ['INDEX.md', 'README.md', 'ROADMAP.md', 'modules/*/README.md'],
  modules: [{ key: 'crm', class: 'anchor', requires: [] }],
  requiredFields: { state: ['verified_on', 'evidence'] },
}

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-fix-'))
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify(CONFIG))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  clearConfigCache()
  return root
}

test('stamps kind and module from the path, preserving lists', () => {
  const root = fixture({
    'docs/modules/crm/state/pipelines.md':
      '---\ntitle: Pipelines\nkind: todo\nmodule: core\nstatus: active\nupdated: 2026-08-23\n' +
      'verified_on: 2026-08-23\nevidence:\n  - "bunx nx test domain-pipelines"\n---\n\n# Pipelines\n',
  })
  try {
    const changed = fixFrontmatter(root, loadConfig(root))
    assert.equal(changed.length, 1)
    const written = readFileSync(join(root, 'docs/modules/crm/state/pipelines.md'), 'utf8')
    assert.match(written, /kind: state/)
    assert.match(written, /module: crm/)
    // The renderer quotes only what YAML would otherwise read differently, so a
    // command with no colon comes back bare. That is deterministic, which is
    // what index freshness needs.
    assert.match(written, /evidence:\n {2}- bunx nx test domain-pipelines/)
    assert.match(written, /# Pipelines/)
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a document already correct is left byte-identical', () => {
  const source =
    '---\ntitle: Pipelines\nkind: state\nmodule: crm\nstatus: active\nupdated: 2026-08-23\n' +
    'verified_on: 2026-08-23\nevidence:\n  - "bunx nx test domain-pipelines"\n---\n\n# Pipelines\n'
  const root = fixture({ 'docs/modules/crm/state/pipelines.md': source })
  try {
    assert.deepEqual(fixFrontmatter(root, loadConfig(root)), [])
    assert.equal(readFileSync(join(root, 'docs/modules/crm/state/pipelines.md'), 'utf8'), source)
  } finally {
    clearConfigCache()
    rmSync(root, { recursive: true, force: true })
  }
})
