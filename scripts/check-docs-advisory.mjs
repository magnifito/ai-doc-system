#!/usr/bin/env node
/**
 * ADVISORY documentation checks — reported, never blocking. Wire it wherever
 * the host project keeps its non-blocking checks; it always exits 0.
 *
 * Three things the blocking gate deliberately refuses to assert (design section
 * 5.3 — github.com/magnifito/ai-doc-system), because any one of them would fail
 * a push for a reason unrelated to the change that triggered it:
 *
 *   1. `code-pointer` — `code:` pointers that no longer resolve. An ordinary
 *      refactor moves a directory; the doc is then wrong, but the refactor is not.
 *   2. `updated-drift` — a file whose last commit date is later than the date
 *      its author stamped. The field means "last substantive change, per the
 *      author" (section 4.6), so a whitespace commit legitimately moves git's
 *      date and not the field's.
 *   3. `verification-drift` — a `state` document whose `code:` has changed since
 *      its `verified_on`. The claim is unverified, not wrong. Blocking would let
 *      any commit under `code:` fail the docs gate, which is how a gate gets
 *      bypassed rather than fixed.
 *
 * All three are worth knowing and none is worth blocking on. Each is a rule id:
 * a project silences one block by setting that id to `off`.
 */
import { appendFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { isExempt, kindForPath } from './docs-taxonomy.mjs'
import { lastCommitDates, listDocs, repoRoot } from './docs-fs.mjs'
import { runDirect } from './docs-run.mjs'

/**
 * The drift list is capped: any commit that touches many documents at once — the
 * migration that seeded every `updated:` field, a tree-wide rename — moves git's
 * date on all of them and would otherwise print hundreds of lines nobody reads.
 */
const DRIFT_CAP = 20

/**
 * Print each line, and collect it: in CI nobody reads a green job's stdout, so
 * when GITHUB_STEP_SUMMARY is set the same report is appended there and drift
 * becomes visible on the run page without blocking anything.
 */
function reporter() {
  const lines = []
  const emit = (line) => {
    console.log(line)
    lines.push(line)
  }
  emit.flush = () => {
    const summary = process.env.GITHUB_STEP_SUMMARY
    if (!summary) return
    appendFileSync(summary, `### docs advisory\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`)
  }
  return emit
}

export function main() {
  const root = repoRoot()
  const config = loadConfig(root)
  const deadCode = []
  const drifted = []
  const unverified = []

  // One walk of the history, reused for every date lookup below.
  const dates = lastCommitDates(root)

  for (const path of listDocs(root, config)) {
    if (isExempt(config, path)) continue
    const { data } = parseFrontmatter(readFileSync(join(root, path), 'utf8'))

    if (data.code) {
      const target = data.code.split('#')[0].replace(/\/$/, '')
      if (target && !existsSync(join(root, target))) deadCode.push({ path, target })
    }

    if (data.updated) {
      const committed = dates.get(path) ?? ''
      if (committed && committed > data.updated) drifted.push({ path, stamped: data.updated, committed })
    }

    // A reflection document claims something is true as of `verified_on`. When
    // the code it points at has moved since, the claim is unverified.
    if (kindForPath(config, path) === 'state' && data.verified_on && data.code) {
      const moved = dates.get(data.code.split('#')[0].replace(/\/$/, '')) ?? ''
      if (moved && moved > data.verified_on) {
        unverified.push({ path, verified: data.verified_on, code: data.code, moved })
      }
    }
  }

  const emit = reporter()

  /** A block carries its rule id, and a project silences it with `off`. */
  const on = (id) => config.rules[id] !== 'off'

  if (on('code-pointer')) {
    if (deadCode.length === 0) emit('docs advisory [code-pointer]: every `code:` pointer resolves')
    else {
      emit(`docs advisory [code-pointer]: ${deadCode.length} dead \`code:\` pointer(s)`)
      for (const { path, target } of deadCode) emit(`  ${path} -> ${target}`)
    }
  }

  if (on('updated-drift')) {
    if (drifted.length === 0) emit('docs advisory [updated-drift]: no `updated:` drift')
    else {
      emit(`docs advisory [updated-drift]: ${drifted.length} doc(s) committed after their \`updated:\` date`)
      for (const { path, stamped, committed } of drifted.slice(0, DRIFT_CAP)) {
        emit(`  ${path} — frontmatter ${stamped}, last commit ${committed}`)
      }
      if (drifted.length > DRIFT_CAP) emit(`  … and ${drifted.length - DRIFT_CAP} more`)
    }
  }

  if (on('verification-drift')) {
    if (unverified.length === 0) emit('docs advisory [verification-drift]: no verification drift')
    else {
      emit(`docs advisory [verification-drift]: ${unverified.length} state doc(s) whose code changed after \`verified_on\``)
      for (const { path, verified, code, moved } of unverified.slice(0, DRIFT_CAP)) {
        emit(`  ${path} — verified ${verified}, ${code} changed ${moved}`)
      }
      if (unverified.length > DRIFT_CAP) emit(`  … and ${unverified.length - DRIFT_CAP} more`)
    }
  }

  emit.flush()
  process.exit(0)
}

if (runDirect(import.meta.url)) main()
