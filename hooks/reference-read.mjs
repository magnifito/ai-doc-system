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
 * EVERYTHING, imports included, is inside the `try`, and every import is
 * dynamic. A plugin install is a bare git checkout with no node_modules, so a
 * static `import` of the engine (which needs `yaml`) would throw at module
 * load — before any handler could catch it — and put a stack trace on the
 * user's every Read. `hooks/engine.mjs` decides which copy of the engine to
 * run, and answers null when there is none; then this hook exits 0 in silence.
 */
try {
  const { existsSync, readFileSync } = await import('node:fs')
  const { isAbsolute, join, relative } = await import('node:path')
  const { engineRoot, importEngine } = await import('./engine.mjs')

  const payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
  const file = payload.tool_input?.file_path
  const root = payload.cwd ?? process.cwd()
  const engine = engineRoot(root)
  if (engine && file && `${file}`.endsWith('.md')) {
    const { parseFrontmatter } = await importEngine(engine, 'scripts/docs-frontmatter.mjs')
    const { loadConfig } = await importEngine(engine, 'scripts/docs-config.mjs')
    const { kindForPath } = await importEngine(engine, 'scripts/docs-taxonomy.mjs')
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
        // Where to promote it TO is the project's tiering, not this hook's: the
        // first configured tier that is not the document's own. A project with
        // one tier gets the neutral wording instead of an invented path.
        const ownKind = kindForPath(config, rel)
        const destination = config.tiers.find(([, kind]) => kind !== ownKind)
        const promote = destination
          ? `To act on it, promote it first: docs-notary mv ${rel} ${config.docsDir}/${destination[0]}<name>.md, then rewrite the prose.`
          : 'To act on it, promote it into a higher tier first with `docs-notary mv`, then rewrite the prose.'
        const context = `${rel} has status: reference — captured from elsewhere, NOT a commitment, never a build spec. Do not implement from it. ${promote}`
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context } }))
      }
    }
  }
} catch {
  // Silence is the safe failure: say nothing, block nothing.
  process.exit(0)
}
