#!/usr/bin/env node
/**
 * PreToolUse hook on Read. When the file being read is a document whose
 * status is `reference`, add one line of context: this is not a commitment.
 * The load-bearing rule of the design (section 6.3) enforced at read time,
 * one turn before an agent could act on the document. Never blocks.
 *
 * Contract (Claude Code hooks reference): the hook payload arrives as JSON on
 * stdin — `cwd` is the repository Claude runs in, `tool_input.file_path` the
 * file about to be read. Context is added by printing
 * `{ hookSpecificOutput: { hookEventName, additionalContext } }` and exiting 0;
 * `permissionDecision` is deliberately omitted so the Read proceeds untouched.
 *
 * The whole body is wrapped so this hook can only ever exit 0 with nothing to
 * say: a hook that throws interrupts the user's tool call with a stack trace,
 * which is a worse outcome than a missing reminder.
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { parseFrontmatter } from '../scripts/docs-frontmatter.mjs'
import { loadConfig } from '../scripts/docs-config.mjs'

try {
  const payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
  const file = payload.tool_input?.file_path
  const root = payload.cwd ?? process.cwd()
  if (file && `${file}`.endsWith('.md')) {
    const full = isAbsolute(file) ? file : join(root, file)
    const rel = relative(root, full).split(/[\\/]/).join('/')
    let config
    try {
      config = loadConfig(root)
    } catch {
      config = null
    }
    if (config && rel.startsWith(`${config.docsDir}/`) && existsSync(full)) {
      // An unparseable block yields no data, so no claim is made about it. The
      // gate reports that defect; the reminder stays silent rather than half-right.
      const { data } = parseFrontmatter(readFileSync(full, 'utf8'))
      if (data.status === 'reference') {
        const context = `${rel} has status: reference — captured from elsewhere, NOT a commitment, never a build spec. Do not implement from it. To act on it, promote it first: ai-doc-system mv ${rel} ${config.docsDir}/product/<name>.md, then rewrite the prose.`
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context } }))
      }
    }
  }
} catch {
  // Silence is the safe failure: say nothing, block nothing.
  process.exit(0)
}
