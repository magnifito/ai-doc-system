#!/usr/bin/env node
/**
 * Package entry point: `npx ai-doc-system <command>` run from the host
 * repository's root. Each command is one of the scripts; flags after the
 * command pass straight through (`--apply`, `--dry-run`, `--check`, `--all`).
 * Vendoring the scripts and running them with `node` directly stays supported —
 * this file only dispatches.
 */
import { readFileSync } from 'node:fs'

const COMMANDS = {
  init: ['init-docs.mjs', 'give this repo a gated docs tree'],
  new: ['new-doc.mjs', 'write a gate-clean document at <path>'],
  mv: ['mv-doc.mjs', 'git mv + restamp + regenerate (promotion)'],
  check: ['check-docs.mjs', 'run the blocking gate'],
  advisory: ['check-docs-advisory.mjs', 'non-blocking drift report'],
  gen: ['gen-docs-index.mjs', 'regenerate INDEX.md and index.json'],
  fix: ['fix-docs-frontmatter.mjs', 'restamp kind/module after moves'],
  migrate: ['migrate-docs.mjs', 'one-shot migration (needs a map)'],
}

const command = process.argv[2]

if (command === '--version' || command === '-v') {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  console.log(pkg.version)
  process.exit(0)
}

if (!COMMANDS[command]) {
  console.error('usage: ai-doc-system <command> [flags]\n')
  for (const [name, [, help]] of Object.entries(COMMANDS)) {
    console.error(`  ${name.padEnd(10)} ${help}`)
  }
  console.error('  --version  print the package version')
  process.exit(2)
}

const mod = await import(new URL(`../scripts/${COMMANDS[command][0]}`, import.meta.url))
await mod.main()
