/**
 * Frontmatter reader and writer for the docs system.
 *
 * Reading goes through `yaml`, because the schema now holds lists (`evidence`,
 * `changes`) and because scalar values legitimately contain colons — an
 * evidence entry is `path/to/file.ts:24`. The hand-rolled splitter this
 * replaced mangled both.
 *
 * Writing stays hand-rolled and field-ordered, so a regenerated block is
 * byte-identical to a committed one. `yaml.stringify` gives no such guarantee
 * across versions, and index freshness is a blocking assertion.
 *
 * `raw` is returned so a caller that must not lose fields it cannot represent
 * can preserve the block verbatim.
 */
import { parse } from 'yaml'

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * @returns {{ data: Record<string, string|string[]|object>, body: string, raw: string, present: boolean, error: string|null }}
 */
export function parseFrontmatter(source) {
  const match = source.match(FENCE)
  if (!match) return { data: {}, body: source, raw: '', present: false }

  let parsed
  let error = null
  try {
    parsed = parse(match[1]) ?? {}
  } catch (cause) {
    // Report the parse failure rather than swallowing it. An unparseable block
    // read as empty produces three "required field is missing" violations that
    // say nothing about the actual defect — most often an unquoted colon in a
    // title, which the splitter this replaced silently truncated.
    parsed = {}
    error = cause.message.split('\n')[0]
  }

  const data = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) data[key] = value.map((item) => String(item))
    // A key with no value (`summary:`) parses as null. Keep it as '' rather
    // than dropping it: the gate must tell a field that is present but empty —
    // a defect it reports — apart from a field that was never written.
    else if (value == null) data[key] = ''
    // A map is kept as a map rather than stringified to "[object Object]", so a
    // consumer that expects a scalar can SEE that it did not get one. Flattening
    // it produced a plausible-looking string that passed every check.
    else if (typeof value === 'object') data[key] = value
    else data[key] = String(value)
  }
  return { data, body: source.slice(match[0].length), raw: match[1], present: true, error }
}

/** Field order is fixed so a regenerated block is byte-identical to a committed one. */
export const FIELD_ORDER = [
  'title',
  'summary',
  'kind',
  'module',
  'status',
  'updated',
  'review_by',
  'verified_on',
  'evidence',
  'commitment',
  'changes',
  'implements',
  'code',
  'source_url',
  'superseded_by',
  'promoted_from',
]

/** Fields rendered as a block sequence rather than a scalar. */
/**
 * The path form an `evidence` entry may take: a repository path, optionally
 * suffixed `:line` or `:line-line`. Capture group 1 is the path alone.
 *
 * Square brackets and parentheses are ordinary path characters in a Next.js
 * tree — `app/api/booking/[calendarSlug]/route.ts`, `app/[locale]/(public)/…` —
 * so a validator that rejects them rejects real evidence.
 *
 * Shared: the gate rejects an entry that is neither this nor a command, and the
 * reverse index keys only on entries that match, so the two cannot drift into
 * disagreeing about what an evidence path is.
 */
export const EVIDENCE_PATH = /^([A-Za-z0-9._\-/[\]()@]+)(?::\d+(?:-\d+)?)?$/

export const LIST_FIELDS = new Set(['evidence', 'changes'])

/**
 * Every schema field that must be a single value. YAML lets any of them be
 * written as a list or a map, and consumers reasonably call `.split`, `.replace`
 * or `join()` on them — so the gate normalises shape against this list once,
 * before any field check runs, rather than each caller guarding its own field.
 */
export const SCALAR_FIELDS = FIELD_ORDER.filter((field) => !LIST_FIELDS.has(field))

/** Quote a scalar only when leaving it bare would change how YAML reads it. */
export function scalar(value) {
  const text = String(value)
  return /^[A-Za-z0-9][A-Za-z0-9 ._\-/]*$/.test(text) ? text : JSON.stringify(text)
}

/**
 * Known fields first, in FIELD_ORDER, then anything else in the order it was
 * read. Unknown fields are PRESERVED rather than dropped: a project puts its own
 * keys in frontmatter, and a renderer that silently deletes them turns a restamp
 * into data loss. They are not validated — the schema does not know them — only
 * carried through.
 */
export function renderFrontmatter(data) {
  const lines = []
  const emit = (key, value) => {
    if (value == null || value === '') return
    if (Array.isArray(value)) {
      if (value.length === 0) return
      lines.push(`${key}:`, ...value.map((item) => `  - ${scalar(item)}`))
    } else {
      lines.push(`${key}: ${scalar(value)}`)
    }
  }
  for (const key of FIELD_ORDER) emit(key, data[key])
  for (const key of Object.keys(data)) if (!FIELD_ORDER.includes(key)) emit(key, data[key])
  return `---\n${lines.join('\n')}\n---\n`
}

/**
 * Replace or insert one top-level scalar line inside a raw frontmatter block,
 * leaving every other byte alone. Re-rendering the whole block from parsed
 * data is not an option: the parser flattens values it cannot represent (a
 * nested map becomes a string), so a full re-render would corrupt them.
 * `^key:` matches top level only — nested keys are indented.
 *
 * When the key is absent it is inserted after the FIRST anchor found, so pass
 * anchors in decreasing FIELD_ORDER proximity — the field the new line should
 * follow first, then the fallbacks. With no anchor present the line goes to the
 * top of the block.
 */
export function patchScalar(raw, key, value, anchors) {
  const line = `${key}: ${value}`
  const existing = new RegExp(`^${key}:[^\\n]*$`, 'm')
  if (existing.test(raw)) return raw.replace(existing, line)
  for (const anchor of anchors) {
    const anchorLine = raw.match(new RegExp(`^${anchor}:[^\\n]*$`, 'm'))
    if (anchorLine) return raw.replace(anchorLine[0], `${anchorLine[0]}\n${line}`)
  }
  return `${line}\n${raw}`
}

/** The first `# ` heading, or null. Used to derive `title` during migration. */
export function firstHeading(body) {
  const match = body.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : null
}
