#!/usr/bin/env node
/**
 * ADVISORY documentation checks — reported, never blocking. Runs as part of
 * `bun run verify:extras` and always exits 0.
 *
 * Two things the blocking gate deliberately refuses to assert (01-design.md
 * section 5.3), because either one would fail a push for a reason unrelated to
 * the change that triggered it:
 *
 *   1. `code:` pointers that no longer resolve. An ordinary refactor moves a
 *      directory; the doc is then wrong, but the refactor is not.
 *   2. `updated:` drift — a file whose last commit date is later than the date
 *      its author stamped. The field means "last substantive change, per the
 *      author" (section 4.6), so a whitespace commit legitimately moves git's
 *      date and not the field's.
 *
 * Both are worth knowing and neither is worth blocking on.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { isExempt } from './docs-taxonomy.mjs'
import { lastCommitDate, listDocs, repoRoot } from './docs-fs.mjs'

/**
 * The drift list is capped: any commit that touches many documents at once — the
 * migration that seeded every `updated:` field, a tree-wide rename — moves git's
 * date on all of them and would otherwise print hundreds of lines nobody reads.
 */
const DRIFT_CAP = 20

function main() {
  const root = repoRoot()
  const config = loadConfig(root)
  const deadCode = []
  const drifted = []

  for (const path of listDocs(root, config)) {
    if (isExempt(config, path)) continue
    const { data } = parseFrontmatter(readFileSync(join(root, path), 'utf8'))

    if (data.code) {
      const target = data.code.split('#')[0].replace(/\/$/, '')
      if (target && !existsSync(join(root, target))) deadCode.push({ path, target })
    }

    if (data.updated) {
      const committed = lastCommitDate(root, path)
      if (committed && committed > data.updated) drifted.push({ path, stamped: data.updated, committed })
    }
  }

  if (deadCode.length === 0) console.log('docs advisory: every `code:` pointer resolves')
  else {
    console.log(`docs advisory: ${deadCode.length} dead \`code:\` pointer(s)`)
    for (const { path, target } of deadCode) console.log(`  ${path} -> ${target}`)
  }

  if (drifted.length === 0) console.log('docs advisory: no `updated:` drift')
  else {
    console.log(`docs advisory: ${drifted.length} doc(s) committed after their \`updated:\` date`)
    for (const { path, stamped, committed } of drifted.slice(0, DRIFT_CAP)) {
      console.log(`  ${path} — frontmatter ${stamped}, last commit ${committed}`)
    }
    if (drifted.length > DRIFT_CAP) console.log(`  … and ${drifted.length - DRIFT_CAP} more`)
  }

  process.exit(0)
}

main()
