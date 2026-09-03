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
import { renderIndex } from './gen-docs-index.mjs'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const hook = (name, payload, cwd) => execFileSync(process.execPath, [join(PACKAGE_ROOT, 'hooks', name)], { cwd, input: JSON.stringify(payload), encoding: 'utf8', stdio: 'pipe' })

/**
 * A repository containing exactly `files`. `withIndex` generates the docs index
 * the way `gen` would: `docs/index.json` is what the edit hook treats as proof
 * the tree has adopted this system, so a fixture without it is a repo that
 * merely happens to have a `docs/` folder.
 */
function gitFixture(files, { withIndex = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'docs-hook-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' })
  if (withIndex) {
    for (const [path, content] of renderIndex(root)) {
      mkdirSync(join(root, dirname(path)), { recursive: true })
      writeFileSync(join(root, path), content)
    }
  }
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

test('the emitted object carries nothing but the documented contract', () => {
  const root = gitFixture({ 'docs/reference/x.md': '---\ntitle: X\nkind: reference\nstatus: reference\nupdated: 2026-08-17\n---\n# X\n' })
  try {
    const out = JSON.parse(hook('reference-read.mjs', { tool_name: 'Read', tool_input: { file_path: join(root, 'docs/reference/x.md') }, cwd: root }, root))
    assert.deepEqual(Object.keys(out), ['hookSpecificOutput'])
    assert.deepEqual(Object.keys(out.hookSpecificOutput).sort(), ['additionalContext', 'hookEventName'])
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
  const root = gitFixture({ 'docs/engineering/x.md': '# no frontmatter\n' }, { withIndex: true })
  try {
    const out = JSON.parse(hook('docs-edit.mjs', { tool_name: 'Write', tool_input: { file_path: join(root, 'docs/engineering/x.md') }, cwd: root }, root))
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse')
    assert.match(out.hookSpecificOutput.additionalContext, /^check-docs found [1-9]\d* error\(s\) and \d+ warning\(s\) after this edit:/)
    assert.match(out.hookSpecificOutput.additionalContext, /frontmatter/)
    assert.match(out.hookSpecificOutput.additionalContext, /check-docs/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('editing in a repo that has not adopted the system prints nothing', () => {
  const root = gitFixture({ 'docs/x.md': '# just a folder called docs\n' })
  try {
    assert.equal(hook('docs-edit.mjs', { tool_name: 'Write', tool_input: { file_path: join(root, 'docs/x.md') }, cwd: root }, root).trim(), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a warning-only tree is still reported, without being called an error', () => {
  const root = gitFixture(
    {
      'docs-system.config.json': JSON.stringify({ rules: { implements: 'warn' } }),
      'docs/engineering/x.md': '---\ntitle: X\nkind: engineering\nstatus: active\nupdated: 2026-08-17\nimplements: docs/product/nope.md\n---\n\n# X\n\nBody.\n',
    },
    { withIndex: true },
  )
  try {
    const out = JSON.parse(hook('docs-edit.mjs', { tool_name: 'Edit', tool_input: { file_path: join(root, 'docs/engineering/x.md') }, cwd: root }, root))
    const context = out.hookSpecificOutput.additionalContext
    assert.match(context, /^check-docs found 0 error\(s\) and 1 warning\(s\) after this edit:/)
    assert.match(context, /\[implements, warn\]/)
    assert.match(context, /Warnings do not block the gate\./)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('editing a clean tree prints nothing', () => {
  const root = gitFixture({ 'docs/engineering/x.md': '---\ntitle: X\nkind: engineering\nstatus: active\nupdated: 2026-08-17\n---\n\n# X\n\nBody.\n' }, { withIndex: true })
  try {
    assert.equal(hook('docs-edit.mjs', { tool_name: 'Edit', tool_input: { file_path: join(root, 'docs/engineering/x.md') }, cwd: root }, root).trim(), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('editing a non-markdown file under docs/ prints nothing', () => {
  const root = gitFixture({ 'docs/engineering/x.md': '# no frontmatter\n', 'docs/assets/diagram.svg': '<svg/>\n' }, { withIndex: true })
  try {
    assert.equal(hook('docs-edit.mjs', { tool_name: 'Write', tool_input: { file_path: join(root, 'docs/assets/diagram.svg') }, cwd: root }, root).trim(), '')
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
