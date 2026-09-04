#!/usr/bin/env node
/**
 * `docs-notary impact [--base <ref>] [--json]` — which documents make claims
 * about the paths that changed. `code:` points from a document at code; nothing
 * pointed back until now. Advisory: exit 0 always; appended to
 * GITHUB_STEP_SUMMARY when set, so a pull request shows the documents it may
 * have falsified.
 *
 * Usage:  node scripts/impact-docs.mjs [--base <ref>] [--json]
 *   --base <ref>  diff from the merge base of <ref> and HEAD to the working
 *                 tree (tracked files only); default is the working tree and
 *                 the index against HEAD, untracked files included
 *   --json        print `{ changed, hits }` instead of the text report
 */
import { appendFileSync } from 'node:fs'
import { loadConfig } from './docs-config.mjs'
import { buildByCode, buildIndex } from './gen-docs-index.mjs'
import { changedPaths, repoRoot } from './docs-fs.mjs'
import { runDirect } from './docs-run.mjs'
import { flagValues } from './docs-args.mjs'

/** A changed path is covered by a claim when it equals the claim or lies beneath it. */
function covers(claim, changed) {
  return changed === claim || changed.startsWith(`${claim}/`)
}

/**
 * Every `{ doc, via, claim }` where a document's `code:` or path-form evidence
 * covers one of `changed`. One hit per document/path pair, sorted by document.
 * `verified_on` rides along when the document carries it: a claim that was
 * verified on a date is exactly the claim a code change can falsify.
 */
export function impactedDocs(root, changed, config = loadConfig(root)) {
  const entries = buildIndex(root, config)
  const byCode = buildByCode(entries, config)
  const verified = new Map(entries.map((entry) => [entry.path, entry.verified_on]))
  const hits = []
  const seen = new Set()
  for (const [claim, docs] of Object.entries(byCode)) {
    for (const path of changed) {
      if (!covers(claim, path)) continue
      for (const doc of docs) {
        // A document claiming both `src/a` and `src/a/b.ts` would otherwise be
        // named twice for the same changed file.
        const key = `${doc}|${path}`
        if (seen.has(key)) continue
        seen.add(key)
        hits.push({ doc, via: path, claim, ...(verified.get(doc) ? { verified_on: verified.get(doc) } : {}) })
      }
    }
  }
  return hits.sort((a, b) => (a.doc < b.doc ? -1 : a.doc > b.doc ? 1 : 0))
}

export function main() {
  const root = repoRoot()
  const base = flagValues('impact', process.argv, ['--base'])['--base']
  let changed
  try {
    changed = changedPaths(root, base)
  } catch (error) {
    // An unresolvable `--base` is a checkout problem, not a docs problem. This
    // pass is advisory: say what went wrong and get out of the build's way.
    console.error(`docs impact: ${error.message}`)
    process.exit(0)
  }
  const hits = impactedDocs(root, changed)
  const lines = []
  if (hits.length === 0) {
    lines.push(`docs impact: no document claims any of the ${changed.length} changed path(s)`)
  } else {
    lines.push(`docs impact: ${hits.length} claim(s) touched by this change — re-verify or update:`)
    for (const { doc, via, claim, verified_on } of hits) {
      lines.push(`  ${doc} claims ${claim}${verified_on ? ` (verified ${verified_on})` : ''} — ${via} changed`)
    }
  }
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ changed, hits }, null, 2)}\n`)
  else for (const line of lines) console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### docs impact\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`)
  }
  process.exit(0)
}

if (runDirect(import.meta.url)) main()
