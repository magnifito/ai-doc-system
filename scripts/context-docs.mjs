#!/usr/bin/env node
/**
 * `ai-doc-system context [--kind a,b] [--status s] [--module m] [--max-chars N] [paths…]`
 *   emits the selected documents with an AUTHORITY banner on each, within a
 *   character budget, so a document pasted into a conversation still says
 *   what it is.
 * `ai-doc-system export --jsonl [same filters]`
 *   emits one JSON record per heading section, frontmatter on every record,
 *   for RAG stores that chunk — the place where a document's status used to
 *   get lost.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { buildIndex } from './gen-docs-index.mjs'
import { repoRoot } from './docs-fs.mjs'
import { runDirect } from './docs-run.mjs'

const list = (value) => (value ? `${value}`.split(',').map((s) => s.trim()).filter(Boolean) : null)

/** The index entries a filter selects. Every filter is optional; all of them are ANDed. */
export function selectDocs(root, { kind, status, module: moduleKey, paths } = {}, config = loadConfig(root)) {
  const kinds = list(kind)
  const statuses = list(status)
  const modules = list(moduleKey)
  const wanted = paths && paths.length > 0 ? new Set(paths) : null
  return buildIndex(root, config).filter(
    (entry) =>
      (!kinds || kinds.includes(entry.kind)) &&
      (!statuses || statuses.includes(entry.status)) &&
      (!modules || modules.includes(entry.module)) &&
      (!wanted || wanted.has(entry.path)),
  )
}

/**
 * What the status entitles a reader to do with the document. This is the whole
 * point of the pack: a chunk that travels without its tier reads as fact.
 */
function authority(entry) {
  switch (entry.status) {
    case 'reference': return 'captured from elsewhere — NOT a commitment, never a build spec'
    case 'draft': return 'being written — not yet agreed'
    case 'active': return 'agreed and current — build from this'
    case 'shipped': return `built and verified — code: ${entry.code ?? 'unset'}`
    case 'superseded': return `replaced by ${entry.superseded_by ?? 'unset'} — do not use`
    default: return `project-defined status "${entry.status}"`
  }
}

export function banner(entry) {
  const meta = [
    `KIND: ${entry.kind}`,
    ...(entry.module ? [`MODULE: ${entry.module}`] : []),
    `STATUS: ${entry.status}`,
    `UPDATED: ${entry.updated}`,
  ]
  return `===== ${entry.path} =====\n${meta.join(' · ')}\nAUTHORITY: ${authority(entry)}.`
}

/**
 * The documents, banner first, whole. A document is included or omitted, never
 * truncated — half a document is the one thing worse than a missing one. The
 * first is always included, so a budget smaller than any document still emits
 * something rather than a bare tally.
 */
export function renderContext(root, entries, { maxChars = Infinity } = {}) {
  const blocks = []
  const omitted = []
  let used = 0
  for (const entry of entries) {
    const { body } = parseFrontmatter(readFileSync(join(root, entry.path), 'utf8'))
    const block = `${banner(entry)}\n\n${body.trim()}\n`
    if (used + block.length > maxChars && blocks.length > 0) {
      omitted.push(entry.path)
      continue
    }
    blocks.push(block)
    used += block.length
  }
  let out = blocks.join('\n')
  if (omitted.length > 0) {
    out += `\n[context: ${blocks.length} of ${entries.length} documents included; omitted: ${omitted.join(', ')}]\n`
  }
  return out
}

/**
 * Split a body into heading sections. The preamble before the first heading is
 * level 0, and is dropped when empty. Fenced blocks are not scanned for
 * headings: a `#` comment inside a shell sample is not a section.
 */
export function sections(body) {
  const out = [{ heading: '', level: 0, lines: [] }]
  let inFence = false
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const match = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (match) out.push({ heading: match[2], level: match[1].length, lines: [] })
    else out[out.length - 1].lines.push(line)
  }
  return out
    .map(({ heading, level, lines }) => ({ heading, level, text: lines.join('\n').trim() }))
    .filter((section) => section.text || section.heading)
}

/** One JSON object per heading section, carrying the document's frontmatter. */
export function renderJsonl(root, entries) {
  const lines = []
  for (const entry of entries) {
    const { body } = parseFrontmatter(readFileSync(join(root, entry.path), 'utf8'))
    const base = {
      path: entry.path,
      title: entry.title,
      kind: entry.kind,
      ...(entry.module ? { module: entry.module } : {}),
      status: entry.status,
      updated: entry.updated,
      ...(entry.summary ? { summary: entry.summary } : {}),
      ...(entry.source_url ? { source_url: entry.source_url } : {}),
    }
    for (const { heading, level, text } of sections(body)) lines.push(JSON.stringify({ ...base, heading, level, text }))
  }
  return `${lines.join('\n')}\n`
}

const USAGE = [
  'usage: ai-doc-system context [--kind a,b] [--status s] [--module m] [--max-chars N] [paths…]',
  '       ai-doc-system export [--jsonl] [--kind a,b] [--status s] [--module m] [paths…]',
].join('\n')

const VALUE_FLAGS = { '--kind': 'kind', '--status': 'status', '--module': 'module', '--max-chars': 'maxChars' }

/**
 * Positionals are document paths — recognised by the `.md` extension, so the
 * leading command word (`context`, when dispatched through `cli/cli.mjs`) and
 * a flag's value are never mistaken for one. An unrecognised flag is an error
 * rather than a silently ignored filter: a mistyped `--satus` that selected
 * everything would be the worst possible failure for this command.
 */
export function parseArgs(args) {
  const options = { paths: [] }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (VALUE_FLAGS[arg]) {
      options[VALUE_FLAGS[arg]] = args[index + 1]
      index += 1
    } else if (arg === '--jsonl') {
      options.jsonl = true
    } else if (arg.startsWith('--')) {
      return { error: `unknown flag ${arg}` }
    } else if (arg.endsWith('.md')) {
      options.paths.push(arg)
    }
  }
  return options
}

export function main() {
  const root = repoRoot()
  const { error, paths, kind, status, module: moduleKey, maxChars, jsonl } = parseArgs(process.argv.slice(2))
  if (error) {
    console.error(`context: ${error}\n${USAGE}`)
    process.exit(2)
  }
  const config = loadConfig(root)
  // A path that names no document is a typo or a stale reference, and an empty
  // pack would look like a document with nothing to say. Checked against the
  // whole tree, not the filtered selection: a path the filters exclude is a
  // contradiction the caller can see in the empty output, not a missing file.
  if (paths.length > 0) {
    const known = new Set(selectDocs(root, {}, config).map((entry) => entry.path))
    for (const path of paths) {
      if (!known.has(path)) {
        console.error(`context: no document at ${path}`)
        process.exit(2)
      }
    }
  }
  const entries = selectDocs(root, { kind, status, module: moduleKey, paths }, config)
  if (jsonl) process.stdout.write(renderJsonl(root, entries))
  else process.stdout.write(renderContext(root, entries, { maxChars: maxChars ? Number(maxChars) : Infinity }))
}

if (runDirect(import.meta.url)) main()
