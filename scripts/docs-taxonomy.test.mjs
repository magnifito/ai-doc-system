/**
 * Tests for path-derived taxonomy: which kind a path implies when a tier prefix
 * contains a wildcard segment, which module it belongs to, and which paths are
 * exempt from the frontmatter requirement.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { withDerived, DEFAULTS } from './docs-config.mjs'
import { isExempt, kindForPath, moduleForPath } from './docs-taxonomy.mjs'

const CONFIG = withDerived({
  ...DEFAULTS,
  tiers: [
    ['modules/*/reference/', 'reference'],
    ['modules/*/archive/', 'archive'],
    ['modules/*/state/', 'state'],
    ['modules/*/todo/', 'todo'],
    ['platform/reference/', 'reference'],
    ['platform/archive/', 'archive'],
    ['platform/state/', 'state'],
    ['platform/todo/', 'todo'],
  ],
  statuses: ['reference', 'draft', 'active', 'shipped', 'superseded'],
  exempt: ['INDEX.md', 'README.md', 'ROADMAP.md', 'modules/*/README.md'],
})

test('a wildcard segment matches exactly one segment', () => {
  assert.equal(kindForPath(CONFIG, 'docs/modules/crm/state/pipelines.md'), 'state')
  assert.equal(kindForPath(CONFIG, 'docs/modules/crm/todo/stage-trigger.md'), 'todo')
  assert.equal(kindForPath(CONFIG, 'docs/platform/state/quality-gate.md'), 'state')
})

test('a wildcard segment does not match across a slash', () => {
  assert.equal(kindForPath(CONFIG, 'docs/modules/crm/deep/state/x.md'), null)
})

test('a path outside every tier has no kind', () => {
  assert.equal(kindForPath(CONFIG, 'docs/modules/crm/README.md'), null)
})

test('module comes from the segment under the module root', () => {
  assert.equal(moduleForPath(CONFIG, 'docs/modules/crm/state/pipelines.md'), 'crm')
  assert.equal(moduleForPath(CONFIG, 'docs/modules/store/reference/a/b.md'), 'store')
})

test('anything under platform belongs to the platform bucket', () => {
  assert.equal(moduleForPath(CONFIG, 'docs/platform/state/quality-gate.md'), 'platform')
})

test('a path in neither tree has no module', () => {
  assert.equal(moduleForPath(CONFIG, 'docs/README.md'), null)
})

test('exempt matches a wildcard glob', () => {
  assert.equal(isExempt(CONFIG, 'docs/modules/crm/README.md'), true)
  assert.equal(isExempt(CONFIG, 'docs/ROADMAP.md'), true)
  assert.equal(isExempt(CONFIG, 'docs/modules/crm/state/pipelines.md'), false)
})
