#!/usr/bin/env node
/**
 * PostToolUse hook on Write, Edit and MultiEdit. When the written file is under
 * the docs tree, run the gate and hand its violations back as context, so the
 * agent fixes frontmatter or regenerates the index in the same turn instead of
 * at push time. Never blocks; the blocking gate is `check` in CI.
 *
 * Contract (Claude Code hooks reference): the hook payload arrives as JSON on
 * stdin — `cwd` is the repository Claude runs in, `tool_input.file_path` the
 * file just written. Context is added by printing
 * `{ hookSpecificOutput: { hookEventName, additionalContext } }` and exiting 0.
 *
 * The whole body is wrapped so this hook can only ever exit 0 with nothing to
 * say: a hook that throws interrupts the user's tool call with a stack trace,
 * which is a worse outcome than a missing report.
 */
import { readFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { checkDocs } from '../scripts/check-docs.mjs'
import { loadConfig } from '../scripts/docs-config.mjs'

/** The gate can find hundreds of issues in a stale tree; a hook says the first few. */
const CAP = 20

try {
  const payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
  const file = payload.tool_input?.file_path
  const root = payload.cwd ?? process.cwd()
  if (file) {
    const full = isAbsolute(file) ? file : join(root, file)
    const rel = relative(root, full).split(/[\\/]/).join('/')
    let config
    try {
      config = loadConfig(root)
    } catch {
      config = null
    }
    if (config && rel.startsWith(`${config.docsDir}/`)) {
      const violations = checkDocs(root, config)
      if (violations.length > 0) {
        const lines = violations.slice(0, CAP).map((v) => `${v.file}:${v.field} — ${v.message} [${v.rule}, ${v.severity}]`)
        const context = `check-docs found ${violations.length} issue(s) after this edit:\n${lines.join('\n')}${violations.length > CAP ? '\n…' : ''}\nFix frontmatter, or run \`ai-doc-system gen\` if the index is stale.`
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }))
      }
    }
  }
} catch {
  // Silence is the safe failure: say nothing, block nothing.
}
process.exit(0)
