/**
 * Tests for the Claude Code plugin hooks (`hooks/*.mjs`) — the read-time
 * reference reminder and the edit-time gate report. Driven through child
 * processes with the real hook payload on stdin, which is the only way to prove
 * what the plugin actually gets: a JSON object on stdout, and exit 0 always.
 *
 * Run: node --test scripts/hooks.test.mjs
 */
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const hook = (name, payload, cwd) => execFileSync(process.execPath, [join(PACKAGE_ROOT, 'hooks', name)], { cwd, input: JSON.stringify(payload), encoding: 'utf8', stdio: 'pipe' })

function gitFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-hook-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' })
  return root
}

test('reading a reference document injects the not-a-commitment reminder', () => {
  const root = gitFixture({ 'docs/reference/x.md': '---\ntitle: X\nkind: reference\nstatus: reference\nupdated: 2026-08-17\n---\n# X\n' })
  try {
    const out = JSON.parse(hook('reference-read.mjs', { tool_name: 'Read', tool_input: { file_path: join(root, 'docs/reference/x.md') }, cwd: root }, root))
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse')
    assert.match(out.hookSpecificOutput.additionalContext, /status: reference/)
    assert.match(out.hookSpecificOutput.additionalContext, /not a commitment/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reading a non-reference document prints nothing', () => {
  const root = gitFixture({ 'docs/engineering/x.md': '---\ntitle: X\nkind: engineering\nstatus: active\nupdated: 2026-08-17\n---\n# X\n' })
  try {
    assert.equal(hook('reference-read.mjs', { tool_name: 'Read', tool_input: { file_path: join(root, 'docs/engineering/x.md') }, cwd: root }, root).trim(), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reading a document outside the docs tree prints nothing', () => {
  const root = gitFixture({ 'notes/x.md': '---\ntitle: X\nstatus: reference\n---\n# X\n' })
  try {
    assert.equal(hook('reference-read.mjs', { tool_name: 'Read', tool_input: { file_path: join(root, 'notes/x.md') }, cwd: root }, root).trim(), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reading a reference document with unparseable frontmatter prints nothing', () => {
  const root = gitFixture({ 'docs/reference/x.md': '---\ntitle: X: broken\nstatus: reference\n---\n# X\n' })
  try {
    assert.equal(hook('reference-read.mjs', { tool_name: 'Read', tool_input: { file_path: join(root, 'docs/reference/x.md') }, cwd: root }, root).trim(), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('editing a document under docs/ runs the gate and reports its violations', () => {
  const root = gitFixture({ 'docs/engineering/x.md': '# no frontmatter\n' })
  try {
    const out = JSON.parse(hook('docs-edit.mjs', { tool_name: 'Write', tool_input: { file_path: join(root, 'docs/engineering/x.md') }, cwd: root }, root))
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse')
    assert.match(out.hookSpecificOutput.additionalContext, /^check-docs found \d+ issue\(s\) after this edit:/)
    assert.match(out.hookSpecificOutput.additionalContext, /frontmatter/)
    assert.match(out.hookSpecificOutput.additionalContext, /check-docs/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('editing outside docs/ prints nothing', () => {
  const root = gitFixture({ 'src/a.ts': 'x' })
  try {
    assert.equal(hook('docs-edit.mjs', { tool_name: 'Edit', tool_input: { file_path: join(root, 'src/a.ts') }, cwd: root }, root).trim(), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a malformed payload exits 0 with empty stdout', () => {
  for (const name of ['reference-read.mjs', 'docs-edit.mjs']) {
    const out = execFileSync(process.execPath, [join(PACKAGE_ROOT, 'hooks', name)], { input: 'not json at all', encoding: 'utf8', stdio: 'pipe' })
    assert.equal(out.trim(), '', `${name} must print nothing for a malformed payload`)
  }
})
