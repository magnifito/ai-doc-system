#!/usr/bin/env node
/**
 * `ai-doc-system verify [--only <doc>] [--stamp]` — turn evidence from a claim
 * into a check. Command-form entries are RUN (shell, from the repo root, 60 s
 * timeout); path-form entries are hashed — the named lines, or the whole file —
 * into `<docsDir>/evidence-lock.json` so the gate can later warn when the
 * evidence moved under a document. `--stamp` sets `verified_on` to today on
 * every document whose entries all passed.
 *
 * This is the only command that executes anything from a document. It never
 * runs from the gate or from a hook; an author invokes it on purpose.
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EVIDENCE_PATH, parseFrontmatter, patchScalar } from './docs-frontmatter.mjs'
import { loadConfig } from './docs-config.mjs'
import { isExempt } from './docs-taxonomy.mjs'
import { today } from './docs-dates.mjs'
import { existsCaseExact, listDocs, repoRoot } from './docs-fs.mjs'
import { writeIndex } from './gen-docs-index.mjs'
import { runDirect } from './docs-run.mjs'

export const LOCK_FILE = 'evidence-lock.json'

const GENERATED_BY = 'scripts/verify-docs.mjs'

/** A check an author is waiting on has a minute; a hung one must not hold the terminal. */
const TIMEOUT_MS = 60_000

/** 16 MiB of captured output; the default 1 MiB is smaller than a chatty test run. */
const MAX_OUTPUT = 1 << 24

/**
 * Split `path[:from[-to]]`; null when the entry is not path-form.
 *
 * The shape is `EVIDENCE_PATH`, the same regex the gate accepts an entry with,
 * so `verify` can never lock an entry the gate would have rejected. That regex
 * captures the path only — the line suffix is whatever follows it, and `:` is
 * outside the path character class, so the split is unambiguous.
 */
export function parsePathEvidence(entry) {
  const text = entry.trim()
  const match = text.match(EVIDENCE_PATH)
  if (!match) return null
  const [from, to] = text.slice(match[1].length).replace(/^:/, '').split('-')
  return { path: match[1].replace(/\/$/, ''), from: from ? Number(from) : null, to: to ? Number(to) : null }
}

/**
 * sha256 of the named lines (1-based, inclusive) or of the whole file. Null when
 * the path is missing, is a directory, or the first line named is out of range —
 * `:0` and `:99` on a three-line file used to hash the empty string, which is a
 * stable hash of nothing and would have reported the claim as verified forever.
 */
export function hashEvidence(root, { path, from, to }) {
  const full = join(root, path)
  if (!existsSync(full)) return null
  let text
  try {
    text = readFileSync(full, 'utf8')
  } catch {
    return null // a directory: nothing to hash, existence is the whole claim
  }
  if (from !== null) {
    const lines = text.split('\n')
    // A file ending in a newline splits to a trailing '' that is not a line.
    const count = lines.length > 0 && lines.at(-1) === '' ? lines.length - 1 : lines.length
    if (from < 1 || from > count) return null
    text = lines.slice(from - 1, to ?? from).join('\n')
  }
  return createHash('sha256').update(text).digest('hex')
}

/** The committed lock, or an empty one. A missing lock means nothing is locked yet. */
export function readLock(root, config) {
  const file = join(root, config.docsDir, LOCK_FILE)
  if (!existsSync(file)) return { generated: GENERATED_BY, entries: {} }
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * Run one command entry. `stdio: 'pipe'` keeps a chatty check out of the report;
 * the first line of stderr is what an author needs to see. A test suite easily
 * prints more than the 1 MiB default buffer, and being killed for succeeding
 * loudly would read as a failing claim, so the buffer is raised to 16 MiB and
 * overflowing it is reported as itself rather than as a signal.
 */
function runCommand(root, command) {
  try {
    execSync(command, { cwd: root, stdio: 'pipe', timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT })
    return { ok: true, detail: 'exit 0' }
  } catch (error) {
    if (error.code === 'ENOBUFS') return { ok: false, detail: `printed more than ${MAX_OUTPUT >> 20} MiB` }
    if (error.killed) return { ok: false, detail: `timed out after ${TIMEOUT_MS / 1000} s` }
    if (error.signal) return { ok: false, detail: `killed by ${error.signal}` }
    const first = `${error.stderr ?? error.message}`.split('\n')[0].trim()
    return { ok: false, detail: first ? `exit ${error.status}: ${first}` : `exit ${error.status}` }
  }
}

/**
 * @param {string} root repo root
 * @param {{only?: string, stamp?: boolean, now?: Date, run?: Function}} [options]
 * @param {object} [config] resolved configuration; loaded from `root` by default
 * @returns {{results: {doc: string, entry: string, kind: 'command'|'path', ok: boolean, detail: string}[], stamped: string[], matched: number}}
 */
export function verifyDocs(root, { only, stamp = false, now, run = runCommand } = {}, config = loadConfig(root)) {
  const results = []
  const stamped = []
  const listings = new Map()
  const lock = readLock(root, config)
  let matched = 0
  for (const path of listDocs(root, config)) {
    if (isExempt(config, path) || (only && path !== only)) continue
    matched += 1
    const source = readFileSync(join(root, path), 'utf8')
    const { data, raw, body } = parseFrontmatter(source)
    if (!Array.isArray(data.evidence) || data.evidence.length === 0) continue
    let allOk = true
    const hashes = {}
    for (const entry of data.evidence) {
      const first = entry.trim().split(/\s+/)[0]
      if (config.evidenceRunners.includes(first)) {
        const { ok, detail } = run(root, entry.trim())
        results.push({ doc: path, entry, kind: 'command', ok, detail })
        allOk &&= ok
        continue
      }
      const parsed = parsePathEvidence(entry)
      // Case-exact, like the gate: `./FOO.ts` must not verify against `foo.ts`
      // on macOS and then fail the same tree on Linux.
      const exists = parsed !== null && existsCaseExact(root, parsed.path, listings)
      const hash = exists ? hashEvidence(root, parsed) : null
      // A file that exists but whose named line does not is a stale claim, not
      // a passing one — the line moved out from under the document.
      const ok = exists && (parsed.from === null || hash !== null)
      const detail = !exists ? 'missing' : ok ? (hash ? `sha256 ${hash.slice(0, 12)}` : 'exists') : `line ${parsed.from} is past end of file`
      if (ok && hash) hashes[entry] = hash
      results.push({ doc: path, entry, kind: 'path', ok, detail })
      allOk &&= ok
    }
    // A document with no hashable entries left carries no lock rows, so an
    // entry that was deleted or turned into a command stops being compared.
    if (Object.keys(hashes).length > 0) lock.entries[path] = hashes
    else delete lock.entries[path]
    if (stamp && allOk) {
      writeFileSync(join(root, path), `---\n${patchScalar(raw, 'verified_on', today(now), ['review_by', 'updated', 'title'])}\n---\n${body}`)
      stamped.push(path)
    }
  }
  // Sorted, so regenerating the lock is byte-stable and its diff is readable.
  // `--only` still writes the whole file: the other documents' rows are read
  // back above and carried through untouched.
  const docsDir = join(root, config.docsDir)
  // `--only` that matched nothing verified nothing, so it has nothing to say
  // about the lock. Rewriting it here would silently drop every other
  // document's rows on a typo'd path.
  if (matched > 0 && existsSync(docsDir)) {
    const sorted = Object.fromEntries(Object.keys(lock.entries).sort().map((key) => [key, lock.entries[key]]))
    writeFileSync(join(docsDir, LOCK_FILE), `${JSON.stringify({ generated: GENERATED_BY, entries: sorted }, null, 2)}\n`)
  }
  // `verified_on` is a field the index carries, so stamping it without
  // regenerating would leave a previously clean tree failing assertion 4.
  if (stamped.length > 0) writeIndex(root, config)
  return { results, stamped, matched }
}

function flagValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

export function main() {
  const only = flagValue('--only')
  const { results, stamped, matched } = verifyDocs(repoRoot(), { only, stamp: process.argv.includes('--stamp') })
  if (matched === 0 && only) {
    console.error(`verify: no document matched --only ${only}`)
    process.exit(2)
  }
  const failed = results.filter((r) => !r.ok)
  for (const { doc, entry, ok, detail } of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${doc} — ${entry} (${detail})`)
  for (const doc of stamped) console.log(`stamped verified_on on ${doc}`)
  console.log(`\nverify: ${results.length - failed.length} passed, ${failed.length} failed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

if (runDirect(import.meta.url)) main()
