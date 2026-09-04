import { strict as assert } from 'node:assert'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { LIST_FIELDS, parseFrontmatter, SCALAR_FIELDS } from './docs-frontmatter.mjs'
import { RULES } from './docs-config.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILLS = join(ROOT, 'skills')
const EXPECTED = ['docs-adopt', 'docs-sort', 'docs-promote', 'docs-audit', 'docs-gate']
// Claude Code truncates or rejects longer descriptions; the trigger must fit.
const DESCRIPTION_MAX = 1024
// The subcommands cli/cli.mjs dispatches. Kept by hand — importing that module would run the
// dispatcher — so a command added or renamed there must be mirrored here in the same change. A
// skill naming a command the CLI does not have sends the agent straight to a usage error.
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
    // The five skills replaced one file, so each is a fragment of one workflow: a skill that names
    // no sibling is a dead end for the agent that landed on the wrong one.
    const siblings = EXPECTED.filter((other) => other !== name && raw.includes(other))
    assert.ok(siblings.length > 0, `${name}: names no sibling skill to hand off to`)
  }
})

test('docs-sort says which frontmatter fields take a list and which take one value', () => {
  if (!skills().includes('docs-sort')) return
  // The field table's rows: `| \`field\` | when to write it | what the gate checks |`.
  const rows = new Map(
    skill('docs-sort')
      .raw.split('\n')
      .filter((line) => /^\| `[a-z_]+` \|/.test(line))
      .map((line) => [/^\| `([a-z_]+)` \|/.exec(line)[1], line]),
  )
  // "A list of …" is the phrase the table uses for a repeatable field. Saying it of a scalar field
  // is the defect this guards: `code:` was documented as "a list of paths" while the writer
  // normalises it as a single value, so an author following the skill wrote frontmatter the gate
  // then rejected as a `vocabulary` violation.
  const asList = /a list of/i
  for (const field of LIST_FIELDS) {
    assert.ok(rows.has(field), `docs-sort: no field-table row for \`${field}\``)
    assert.match(rows.get(field), asList, `docs-write: \`${field}\` is a list field; its row must say so`)
  }
  assert.ok(SCALAR_FIELDS.includes('code'), 'code is expected to be a scalar field')
  assert.ok(rows.has('code'), 'docs-sort: no field-table row for `code`')
  assert.doesNotMatch(rows.get('code'), asList, 'docs-sort: `code` takes one path, not a list')
  assert.match(rows.get('code'), /\bone\b/i, 'docs-sort: the `code` row must say it takes one path')
})

test('docs-gate sends a document with no frontmatter to docs-sort, not to `new`', () => {
  if (!skills().includes('docs-gate')) return
  // The most common red gate is a stray another tool wrote under docs/ with no
  // `---` block. `new` refuses an existing file and a path under no tier, so a
  // remedy naming it sends the agent to two usage errors and then to
  // hand-written frontmatter — the failure the tools exist to remove.
  const row = skill('docs-gate').raw.split('\n').find((line) => line.startsWith('| `frontmatter` |'))
  assert.ok(row, 'docs-gate: no remedy row for `frontmatter`')
  assert.match(row, /docs-sort/)
  assert.doesNotMatch(row, /ai-doc-system new/)
})

test('no skill tells the agent a case-only rename needs two git mv steps', () => {
  // `git mv a.md A.md` is one step on a case-insensitive filesystem (verified on
  // macOS, git 2.55). The two-step dance is for a plain `mv` followed by `git add`.
  for (const name of skills()) {
    assert.doesNotMatch(skill(name).raw, /two\*?\*? ?`git mv`s/, `${name}: claims a case-only rename needs two git mv`)
  }
})

test('a skill that promises a plugin hook says the hook needs the engine in the host repo', () => {
  // hooks/engine.mjs runs the host's node_modules/@puralex/ai-doc-system, or the
  // plugin's own scripts only where `yaml` resolves. A plugin install is a bare
  // clone, so on the vendored route both hooks are silent; a skill that says
  // "installed as a plugin, the hook runs" without that condition is not true.
  for (const name of ['docs-promote', 'docs-gate']) {
    if (!skills().includes(name)) continue
    assert.match(skill(name).raw, /node_modules\/@puralex\/ai-doc-system/, `${name}: promises a hook without its engine precondition`)
  }
})
