/**
 * MIGRATION MAP — copy to `docs-migration.map.mjs` at your repo root and edit.
 *
 * This is the one file of the documentation system that cannot be shared: it
 * says where THIS project's existing documents belong. Write it, run
 * `migrate-docs.mjs --dry-run` until the map is right, run `--apply` once, then
 * delete this file.
 *
 * `destinationFor` returns the new repo-relative path for a document, or `null`
 * to mean "a human must decide" — the migration reports those and touches
 * nothing. Returning the path unchanged is legal and means "already correct".
 */

/**
 * Root-level Markdown that does not belong at the root. Reported, never moved:
 * each one needs a human to read it first. Leave empty if there are none.
 */
export const ROOT_STRAYS = ['MIGRATION.md']

/**
 * Path prefixes the migration leaves entirely alone — vendored trees, or a
 * design bundle that is itself under review while the migration runs.
 */
export const SKIP = []

/** Status for a destination the tier does not force one on. */
export const defaultStatus = 'active'

/**
 * Optional: destination prefixes that imply a status, checked after the tier's
 * forced statuses (config.tierStatus) and before `defaultStatus`.
 */
export const STATUS_BY_PREFIX = {
  'docs/plans/done/': 'shipped',
}

/** Top-level `docs/*.md`, each placed by hand — there are never many. */
const TOP_LEVEL = {
  'PRD.md': 'docs/product/ROADMAP.md',
  'testing.md': 'docs/engineering/testing.md',
  'localdev.md': 'docs/engineering/localdev.md',
}

/** First path segment under `docs/` -> destination prefix. */
const BY_DIRECTORY = {
  // reference tier — captured from elsewhere, never a build spec
  contacts: 'docs/reference/contacts',
  payments: 'docs/reference/payments',

  // engineering tier
  adr: 'docs/engineering/adr',
  runbooks: 'docs/engineering/runbooks',
  infrastructure: 'docs/engineering/architecture/infrastructure',

  // unchanged
  plans: 'docs/plans',
  archive: 'docs/archive',
}

/**
 * @param {string} path       current repo-relative path, e.g. `docs/Foo Bar/PRD.md`
 * @param {object} helpers    `{ config, slugify, normalizeSegment, kindForPath }`
 * @returns {string|null}     destination, or null when a human must decide
 */
export function destinationFor(path, { config, normalizeSegment }) {
  const prefix = `${config.docsDir}/`
  if (!path.startsWith(prefix)) return null
  const segments = path.slice(prefix.length).split('/')

  if (segments.length === 1) return TOP_LEVEL[segments[0]] ?? null

  const destination = BY_DIRECTORY[segments[0]]
  if (!destination) return null

  // Normalise the tail: kebab-case anything that fails path hygiene, and leave
  // alone anything that already passes (README.md, PRD.md, STATUS.md).
  const tail = segments
    .slice(1)
    .map((segment, index, all) => normalizeSegment(segment, index === all.length - 1))
  return [destination, ...tail].join('/')
}
