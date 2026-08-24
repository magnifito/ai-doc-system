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
 * @returns {{ data: Record<string, string|string[]>, body: string, raw: string, present: boolean, error: string|null }}
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
    else if (value != null) data[key] = String(value)
  }
  return { data, body: source.slice(match[0].length), raw: match[1], present: true, error }
}

/** Field order is fixed so a regenerated block is byte-identical to a committed one. */
export const FIELD_ORDER = [
  'title',
  'kind',
  'module',
  'status',
  'updated',
  'verified_on',
  'evidence',
  'commitment',
  'changes',
  'implements',
  'code',
  'superseded_by',
]

/** Fields rendered as a block sequence rather than a scalar. */
export const LIST_FIELDS = new Set(['evidence', 'changes'])

/** Quote a scalar only when leaving it bare would change how YAML reads it. */
function scalar(value) {
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

/** The first `# ` heading, or null. Used to derive `title` during migration. */
export function firstHeading(body) {
  const match = body.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : null
}
