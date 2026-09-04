#!/usr/bin/env node
/**
 * `docs-notary new <path>` — write a document that passes the gate on its
 * first run: `kind` from the path, the tier's forced status or `draft`,
 * today's `updated`, then regenerate the index. Most gate failures come from
 * hand-written frontmatter; this removes the hand.
 *
 * Usage: node scripts/new-doc.mjs docs/<tier>/<name>.md [--title "..."] [--summary "..."] [--status draft]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { renderFrontmatter } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { kindForPath, moduleForPath, pathHygieneErrors, statusForKind } from './docs-taxonomy.mjs'
import { today } from './docs-dates.mjs'
import { repoRoot } from './docs-fs.mjs'
import { writeIndex } from './gen-docs-index.mjs'
import { runDirect } from './docs-run.mjs'
import { flagValues } from './docs-args.mjs'

/**
 * @returns {{ path: string, frontmatter: string }} the document written, with
 *   the block that was rendered for it.
 */
export function newDoc(root, path, { title, summary, status, now } = {}, config = loadConfig(root)) {
  const hygiene = pathHygieneErrors(path, config)
  if (hygiene.length > 0) throw new Error(`${path}: ${hygiene[0]}`)
  const kind = kindForPath(config, path)
  if (kind === null) {
    throw new Error(
      `${path} is under no tier — tiers are ${config.tiers.map(([prefix]) => `${config.docsDir}/${prefix}`).join(', ')}`,
    )
  }
  if (existsSync(join(root, path))) throw new Error(`${path} already exists`)
  const moduleKey = config.modules.length > 0 ? moduleForPath(config, path) : null
  if (config.modules.length > 0 && moduleKey === null) throw new Error(`${path} is in no module tree`)
  const forced = statusForKind(config, kind)
  if (status && forced && status !== forced) {
    throw new Error(`everything under ${config.docsDir}/${kind} is status: ${forced}`)
  }
  if (status && !config.statuses.includes(status)) {
    throw new Error(`"${status}" is not one of ${config.statuses.join(' | ')}`)
  }
  const name = path.split('/').pop().replace(/\.md$/, '')
  const meta = {
    // `||`, not `??`: `--title ""` is a mistake, and an empty title fails the gate.
    title: title || name,
    ...(summary ? { summary } : {}),
    kind,
    ...(moduleKey ? { module: moduleKey } : {}),
    status: forced ?? status ?? 'draft',
    updated: today(now),
  }
  const frontmatter = renderFrontmatter(meta)
  mkdirSync(join(root, dirname(path)), { recursive: true })
  writeFileSync(join(root, path), `${frontmatter}\n# ${meta.title}\n`)
  writeIndex(root, config)
  return { path, frontmatter }
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
  const flags = flagValues('new', process.argv, ['--title', '--summary', '--status'])
  const [path] = docPaths()
  if (!path) {
    console.error('usage: docs-notary new docs/<tier>/<name>.md [--title "..."] [--summary "..."] [--status <status>]')
    process.exit(2)
  }
  try {
    const { frontmatter } = newDoc(repoRoot(), path, {
      title: flags['--title'],
      summary: flags['--summary'],
      status: flags['--status'],
    })
    console.log(`created ${path}\n${frontmatter}`)
  } catch (error) {
    console.error(`new: ${error.message}`)
    process.exit(1)
  }
}

if (runDirect(import.meta.url)) main()
