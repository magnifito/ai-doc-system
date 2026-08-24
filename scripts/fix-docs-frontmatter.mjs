#!/usr/bin/env node
/**
 * Restamp the two derived frontmatter fields — `kind` and `module` — from each
 * document's path.
 *
 * Storing them is what makes a document self-describing when it is read outside
 * its tree, and the gate asserts they agree with the path. The cost is that
 * `git mv` alone no longer re-tiers a file. This command pays that cost for a
 * whole move at once.
 *
 * It rewrites nothing else: every other field is passed through, and a document
 * already correct is left byte-identical so a no-op run produces no diff.
 *
 * Usage:  node scripts/fix-docs-frontmatter.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter, renderFrontmatter } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { isExempt, kindForPath, moduleForPath } from './docs-taxonomy.mjs'
import { listDocs, repoRoot } from './docs-fs.mjs'

/**
 * @returns {{path: string, from: string, to: string}[]} documents whose derived
 *   fields were wrong, with the old and new `kind/module` pair.
 */
export function fixFrontmatter(root, config = loadConfig(root), { dryRun = false } = {}) {
  const changed = []
  for (const path of listDocs(root, config)) {
    if (isExempt(config, path)) continue
    const source = readFileSync(join(root, path), 'utf8')
    const { data, body, present } = parseFrontmatter(source)
    if (!present) continue

    const kind = kindForPath(config, path)
    const moduleKey = config.modules.length > 0 ? moduleForPath(config, path) : null
    // Outside every tier the gate already reports the file; guessing a kind here
    // would paper over a document that is genuinely in the wrong place.
    if (kind === null) continue

    if (data.kind === kind && (moduleKey === null || data.module === moduleKey)) continue

    changed.push({
      path,
      from: `${data.kind ?? '-'}/${data.module ?? '-'}`,
      to: `${kind}/${moduleKey ?? '-'}`,
    })
    if (dryRun) continue

    const next = { ...data, kind, ...(moduleKey ? { module: moduleKey } : {}) }
    writeFileSync(join(root, path), `${renderFrontmatter(next)}${body}`)
  }
  return changed
}

function main() {
  const root = repoRoot()
  const dryRun = process.argv.includes('--dry-run')
  const changed = fixFrontmatter(root, loadConfig(root), { dryRun })
  for (const { path, from, to } of changed) {
    console.log(`${dryRun ? 'would fix' : 'fixed'} ${path}: ${from} -> ${to}`)
  }
  console.log(`${changed.length} document(s)${dryRun ? ' would be' : ''} restamped.`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
