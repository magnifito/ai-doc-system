/**
 * Minimal YAML frontmatter reader/writer for the docs system.
 *
 * Deliberately not a YAML parser. The docs schema is a handful of scalar
 * string fields with no nesting, no lists and no quoting, so a real parser
 * would be a dependency bought for nothing. If the schema ever grows a list,
 * replace this with `yaml` rather than extending it.
 *
 * `raw` is returned so a caller that must not lose fields it cannot parse
 * (lists, nested keys — see migrate-docs.mjs) can preserve the block verbatim.
 */

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * @returns {{ data: Record<string,string>, body: string, raw: string, present: boolean }}
 */
export function parseFrontmatter(source) {
  const match = source.match(FENCE)
  if (!match) return { data: {}, body: source, raw: '', present: false }

  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
    data[key] = value
  }
  return { data, body: source.slice(match[0].length), raw: match[1], present: true }
}

/** Field order is fixed so a regenerated block is byte-identical to a committed one. */
export const FIELD_ORDER = ['title', 'status', 'updated', 'implements', 'code', 'superseded_by']

export function renderFrontmatter(data) {
  const lines = FIELD_ORDER.filter((key) => data[key] != null && data[key] !== '').map(
    (key) => `${key}: ${data[key]}`,
  )
  return `---\n${lines.join('\n')}\n---\n`
}

/** The first `# ` heading, or null. Used to derive `title` during migration. */
export function firstHeading(body) {
  const match = body.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : null
}
