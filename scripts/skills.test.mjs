import { strict as assert } from 'node:assert'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseFrontmatter } from './docs-frontmatter.mjs'
import { RULES } from './docs-config.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILLS = join(ROOT, 'skills')
const EXPECTED = ['docs-adopt', 'docs-write', 'docs-promote', 'docs-audit', 'docs-gate']
// Claude Code truncates or rejects longer descriptions; the trigger must fit.
const DESCRIPTION_MAX = 1024
const COMMANDS = ['init', 'new', 'mv', 'check', 'verify', 'advisory', 'impact', 'context', 'export', 'gen', 'fix', 'migrate']

function skills() {
  return readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function skill(name) {
  const raw = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8')
  // parseFrontmatter() returns its own `raw` (the frontmatter block only), so spread it
  // first: the whole-file `raw` above must win, since every check here expects the full file.
  return { ...parseFrontmatter(raw), raw }
}

test('all five skills exist', () => {
  assert.deepEqual(skills(), [...EXPECTED].sort())
})

test('the root SKILL.md is gone: with a skills/ directory Claude Code would ignore it', () => {
  assert.equal(existsSync(join(ROOT, 'SKILL.md')), false)
})

test('every skill has frontmatter whose name is its directory and a bounded description', () => {
  for (const name of skills()) {
    const { present, data } = skill(name)
    assert.ok(present, `${name}: frontmatter block`)
    assert.equal(data.name, name, `${name}: frontmatter name`)
    assert.ok(typeof data.description === 'string' && data.description.trim().length > 0, `${name}: description`)
    assert.ok(data.description.length <= DESCRIPTION_MAX, `${name}: description is ${data.description.length} chars`)
    assert.match(data.description, /^Use when /, `${name}: description opens with the trigger`)
  }
})

test('skills locate package files through CLAUDE_PLUGIN_ROOT only', () => {
  for (const name of skills()) {
    const { raw } = skill(name)
    assert.doesNotMatch(raw, /CLAUDE_SKILL_DIR/, `${name}: CLAUDE_SKILL_DIR is not a documented variable`)
  }
})

test('every ai-doc-system command a skill names exists', () => {
  for (const name of skills()) {
    const { raw } = skill(name)
    for (const match of raw.matchAll(/ai-doc-system ([a-z]+)/g)) {
      assert.ok(COMMANDS.includes(match[1]), `${name}: unknown command "${match[1]}"`)
    }
  }
})

test('every rule id docs-gate names is a key of RULES', () => {
  if (!skills().includes('docs-gate')) return
  const { raw } = skill('docs-gate')
  // Rule ids appear as `[id]` in gate output and as a table's first column: `| \`id\` |`.
  const named = new Set([...raw.matchAll(/\| `([a-z-]+)` \|/g)].map((m) => m[1]))
  assert.ok(named.size >= 20, `docs-gate lists ${named.size} rule ids; expected the full table`)
  for (const id of named) assert.ok(id in RULES, `docs-gate: unknown rule id "${id}"`)
  for (const id of Object.keys(RULES)) assert.ok(named.has(id), `docs-gate: rule "${id}" has no remedy row`)
})

test('every skill body stays under 200 lines', () => {
  for (const name of skills()) {
    const lines = skill(name).raw.split('\n').length
    assert.ok(lines <= 200, `${name}: ${lines} lines`)
  }
})

test('every skill hands off by naming a sibling skill, never a section number of a file that no longer exists', () => {
  for (const name of skills()) {
    const { raw } = skill(name)
    assert.doesNotMatch(raw, /§\s?[1-5]\b/, `${name}: section reference to the old SKILL.md`)
    assert.doesNotMatch(raw, /\bSKILL\.md\b/, `${name}: mentions SKILL.md by file name`)
  }
})
