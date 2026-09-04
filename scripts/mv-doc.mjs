#!/usr/bin/env node
/**
 * `docs-notary mv <from> <to>` — the mechanical half of the promotion
 * lifecycle: `git mv`, restamp `kind`/`module`, set the status the destination
 * tier implies, record `promoted_from`, regenerate the index. The prose
 * rewrite that promotion demands stays a human step; `promoted_from` is what
 * lets the gate check (with --base) that it happened.
 *
 * Status on arrival: the destination tier's forced status when it has one;
 * otherwise `--status` when given; otherwise `draft` when leaving `reference`;
 * otherwise the status the document already had.
 *
 * `--adopt` is for a STRAY — a document another tool wrote under a path the
 * tiering does not know, with no frontmatter. It is stamped here: `title` from
 * the first heading (else the destination's stem), the rest as above with
 * `draft` as the fallback. Sorting a stray is not a promotion — it was never a
 * document of another tier — so no `promoted_from` is written and `check
 * --base` owes it no rewrite. Without `--adopt` a source with no frontmatter is
 * refused, because `mv` cannot tell a stray from an exempt file.
 *
 * Usage: node scripts/mv-doc.mjs <from.md> <to.md> [--status <status>] [--summary "..."] [--adopt]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { firstHeading, parseFrontmatter, patchScalar, scalar } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { kindForPath, moduleForPath, pathHygieneErrors, statusForKind } from './docs-taxonomy.mjs'
import { today } from './docs-dates.mjs'
import { repoRoot } from './docs-fs.mjs'
import { writeIndex } from './gen-docs-index.mjs'
import { runDirect } from './docs-run.mjs'
import { flagValues } from './docs-args.mjs'

/**
 * @returns {{ from: string, to: string, adopted: boolean, restamped: { kind: string, module: string|null, status: string } }}
 *   `adopted` is true when the source had no frontmatter and `--adopt` wrote one
 */
export function mvDoc(root, from, to, { status, summary, adopt = false, now } = {}, config = loadConfig(root)) {
  if (!existsSync(join(root, from))) throw new Error(`${from} does not exist`)
  if (existsSync(join(root, to))) throw new Error(`${to} already exists`)
  const hygiene = pathHygieneErrors(to, config)
  if (hygiene.length > 0) throw new Error(`${to}: ${hygiene[0]}`)
  const kind = kindForPath(config, to)
  if (kind === null) throw new Error(`${to} is under no tier`)
  const moduleKey = config.modules.length > 0 ? moduleForPath(config, to) : null
  // Without this the old `module:` line would survive the move and the gate would
  // fail on a document this command itself wrote.
  if (config.modules.length > 0 && moduleKey === null) throw new Error(`${to} is in no module tree`)
  const parsed = parseFrontmatter(readFileSync(join(root, from), 'utf8'))
  if (!parsed.present && !adopt) throw new Error(`${from} has no frontmatter — pass --adopt to stamp one, or add it first`)
  const { data, body } = parsed
  // An adopted stray gets a block to patch: the title is the one field the
  // command has to guess, and the heading is the author's own answer.
  const raw = parsed.present ? parsed.raw : `title: ${scalar(firstHeading(body) || to.split('/').pop().replace(/\.md$/, ''))}`
  const fromKind = kindForPath(config, from)
  const forced = statusForKind(config, kind)
  const nextStatus = forced ?? status ?? (fromKind === 'reference' || !parsed.present ? 'draft' : data.status)
  if (!nextStatus) throw new Error(`${from} has no status — pass --status`)
  if (!config.statuses.includes(nextStatus)) {
    throw new Error(`"${nextStatus}" is not one of ${config.statuses.join(' | ')}`)
  }

  mkdirSync(join(root, dirname(to)), { recursive: true })
  try {
    execFileSync('git', ['mv', from, to], { cwd: root, stdio: 'pipe' })
  } catch (error) {
    // A document that git does not track yet is still a document; only that
    // failure falls back to a plain rename, so a real git error still surfaces.
    const stderr = `${error.stderr ?? ''}`
    // git's own first line says what went wrong; everything after it is noise
    // in a one-line CLI error.
    if (!stderr.includes('not under version control')) {
      throw new Error(`git mv: ${stderr.trim().split('\n')[0] || error.message}`)
    }
    renameSync(join(root, from), join(root, to))
  }
  let patched = summary ? patchScalar(raw, 'summary', scalar(summary), ['title']) : raw
  patched = patchScalar(patched, 'kind', kind, ['summary', 'title'])
  if (moduleKey) patched = patchScalar(patched, 'module', moduleKey, ['kind'])
  patched = patchScalar(patched, 'status', nextStatus, ['module', 'kind'])
  patched = patchScalar(patched, 'updated', today(now), ['status'])
  // A promotion is a move between two TIERS. A source under no tier (a stray)
  // has no authority to promote from, so the trail is not written.
  if (fromKind !== null && fromKind !== kind) {
    patched = patchScalar(patched, 'promoted_from', from, ['superseded_by', 'source_url', 'code', 'updated'])
  }
  writeFileSync(join(root, to), `---\n${patched}\n---\n${parsed.present ? body : body.replace(/^\n+/, '\n')}`)
  writeIndex(root, config)
  return { from, to, adopted: !parsed.present, restamped: { kind, module: moduleKey, status: nextStatus } }
}

/**
 * The `.md` positionals, in order. Flags consume the argument after them, so a
 * document is recognised by its extension, not by its position.
 */
function docPaths() {
  const args = process.argv.slice(2)
  const out = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith('--')) index += 1
    else if (args[index].endsWith('.md')) out.push(args[index])
  }
  return out
}

export function main() {
  const flags = flagValues('mv', process.argv, ['--status', '--summary'])
  const [from, to] = docPaths()
  if (!from || !to) {
    console.error('usage: docs-notary mv <from.md> <to.md> [--status <status>] [--summary "..."] [--adopt]')
    process.exit(2)
  }
  try {
    const { restamped, adopted } = mvDoc(repoRoot(), from, to, {
      status: flags['--status'],
      summary: flags['--summary'],
      adopt: process.argv.includes('--adopt'),
    })
    console.log(`moved ${from} -> ${to} (kind ${restamped.kind}, status ${restamped.status})`)
    if (adopted) console.log('Stamped frontmatter from the heading; check the title, and give it evidence or code if it claims a state.')
    else console.log('Now rewrite the prose to describe this product; promoted_from records where it came from.')
  } catch (error) {
    console.error(`mv: ${error.message}`)
    process.exit(1)
  }
}

if (runDirect(import.meta.url)) main()
