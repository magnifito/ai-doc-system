#!/usr/bin/env node
/**
 * PostToolUse hook on Write, Edit and MultiEdit. When the written file is a
 * document under the docs tree, run the gate and hand its violations back as
 * context, so the agent fixes frontmatter or regenerates the index in the same
 * turn instead of at push time. Never blocks; the blocking gate is `check` in CI.
 *
 * Two things keep this quiet where it has no standing to speak. It runs only in
 * a tree that has ADOPTED this system — proven by `<docsDir>/index.json`, which
 * `init`/`gen` write and the `index` rule keeps fresh — because `loadConfig`
 * falls back to defaults, and without that guard any repo with a `docs/` folder
 * would be told every file in it is missing frontmatter. And it separates
 * errors from warnings: only errors fail the gate, so a warning must not be
 * reported as something this edit broke.
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
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { checkDocs } from '../scripts/check-docs.mjs'
import { loadConfig } from '../scripts/docs-config.mjs'

/** The gate can find hundreds of issues in a stale tree; a hook says the first few. */
const CAP = 20

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
    const adopted = config != null && existsSync(join(root, config.docsDir, 'index.json'))
    if (adopted && rel.startsWith(`${config.docsDir}/`)) {
      const violations = checkDocs(root, config)
      const errors = violations.filter((violation) => violation.severity === 'error')
      const warnings = violations.filter((violation) => violation.severity === 'warn')
      if (violations.length > 0) {
        // Errors first: they are what blocks the push, and the cap is far more
        // likely to be reached than exhausted by warnings alone.
        const lines = [...errors, ...warnings]
          .slice(0, CAP)
          .map((v) => `${v.file}:${v.field} — ${v.message} [${v.rule}, ${v.severity}]`)
        const hint =
          errors.length > 0
            ? 'Fix frontmatter, or run `ai-doc-system gen` if the index is stale.'
            : 'Warnings do not block the gate.'
        const context = `check-docs found ${errors.length} error(s) and ${warnings.length} warning(s) after this edit:\n${lines.join('\n')}${violations.length > CAP ? '\n…' : ''}\n${hint}`
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }))
      }
    }
  }
} catch {
  // Silence is the safe failure: say nothing, block nothing.
  process.exit(0)
}
