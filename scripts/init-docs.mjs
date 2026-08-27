#!/usr/bin/env node
/**
 * `ai-doc-system init` — give a repository a gated docs tree in one command.
 *
 * The greenfield path, next to the migration's brownfield path: creates the
 * hand-written docs/README.md contract, wires the package.json scripts, and
 * generates the index, so `check` passes immediately. Idempotent: nothing that
 * exists is overwritten, and script keys already taken are left alone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadConfig } from './docs-config.mjs'
import { repoRoot } from './docs-fs.mjs'
import { renderIndex } from './gen-docs-index.mjs'
import { runDirect } from './docs-run.mjs'

const README = `# Documentation

Documents are grouped by **authority** — how much weight a reader should give them — not by topic.

**Agents: read [\`index.json\`](index.json) first and filter by \`kind\` and \`status\`. Never grep
this tree blind.** [\`INDEX.md\`](INDEX.md) is the same data for humans. Both are generated — run
\`gen:docs-index\` after adding, moving or restatusing a document; never hand-edit them.

| Tier | \`kind\` | What it is |
|---|---|---|
| \`reference/\` | \`reference\` | Captured from elsewhere. **Not a commitment, never a build spec.** Promote before implementing. |
| \`product/\` | \`product\` | Committed scope. |
| \`engineering/\` | \`engineering\` | How this repository works. \`engineering/adr/\` and \`engineering/runbooks/\` have their own kinds. |
| \`plans/\` | \`plan\` | Work in flight. |
| \`archive/\` | \`archive\` | Replaced — every file here is \`status: superseded\` and names its replacement. |

Every \`.md\` here carries YAML frontmatter (\`title\`, \`kind\`, \`status\`, \`updated\`); the
\`lint:docs\` script is the blocking gate that keeps all of it true.

This tree is managed by [ai-doc-system](https://github.com/magnifito/ai-doc-system).
`

const SCRIPTS = {
  'lint:docs': 'ai-doc-system check',
  'lint:docs:advisory': 'ai-doc-system advisory',
  'gen:docs-index': 'ai-doc-system gen',
}

export function initDocs(root, config = loadConfig(root)) {
  const created = []
  const skipped = []

  const readme = join(root, config.docsDir, 'README.md')
  if (existsSync(readme)) skipped.push(`${config.docsDir}/README.md`)
  else {
    mkdirSync(dirname(readme), { recursive: true })
    writeFileSync(readme, README)
    created.push(`${config.docsDir}/README.md`)
  }

  const pkgFile = join(root, 'package.json')
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    pkg.scripts ??= {}
    let changed = false
    for (const [name, command] of Object.entries(SCRIPTS)) {
      if (pkg.scripts[name]) skipped.push(`package.json scripts.${name}`)
      else {
        pkg.scripts[name] = command
        changed = true
        created.push(`package.json scripts.${name}`)
      }
    }
    if (changed) writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)
  }

  for (const [path, content] of renderIndex(root, config)) {
    writeFileSync(join(root, path), content)
    created.push(path)
  }

  return { created, skipped }
}

export function main() {
  const root = repoRoot()
  const { created, skipped } = initDocs(root)
  for (const path of created) console.log(`created ${path}`)
  for (const path of skipped) console.log(`kept    ${path}`)
  console.log(
    '\nNext: wire `lint:docs` into your blocking checks, and add to AGENTS.md/CLAUDE.md:\n' +
      '  read docs/index.json first; never grep docs/ blind.',
  )
}

if (runDirect(import.meta.url)) main()
