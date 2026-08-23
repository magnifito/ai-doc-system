/**
 * The taxonomy rules: which `kind` a path implies, which status a tier forces,
 * and the path-hygiene rule. Every function takes the resolved configuration
 * (docs-config.mjs) rather than reading module-level constants, so one checkout
 * can serve several projects.
 *
 * A document's kind is DERIVED from its path — it is never a frontmatter field.
 * Storing it twice would buy one whole assertion class whose only job is to
 * check the duplication; deriving it deletes both.
 */

/** Which `kind` a repo-relative path implies. First matching tier wins. */
export function kindForPath(config, path) {
  const prefix = `${config.docsDir}/`
  if (!path.startsWith(prefix)) return null
  const rest = path.slice(prefix.length)
  for (const [tierPrefix, kind] of config.tiers) if (rest.startsWith(tierPrefix)) return kind
  return null
}

/** True when a path is exempt from the frontmatter requirement. */
export function isExempt(config, path) {
  return config.exemptPaths.has(path)
}

/** The status a tier forces on every document in it, or null when it forces none. */
export function statusForKind(config, kind) {
  return config.tierStatus[kind] ?? null
}

/** Kinds that force a status — the statuses that are legal ONLY inside one tier. */
export function reservedStatuses(config) {
  return new Map(Object.entries(config.tierStatus).map(([kind, status]) => [status, kind]))
}

/**
 * Path hygiene. Directory segments are strictly lowercase-kebab. File basenames
 * may additionally be ALL-CAPS, which is a real convention most repositories
 * already use (README, PRD, STATUS, ADR-001). Everything else — spaces,
 * underscores, MixedCase, `&` — is rejected, because those are the paths that
 * break shell globbing and `find | xargs` loops.
 */
const DIR_SEGMENT = /^[a-z0-9-]+$/
const FILE_SEGMENT = /^([a-z0-9-]+|[A-Z0-9-]+)$/

export function pathHygieneErrors(path) {
  const errors = []
  const segments = path.split('/')
  segments.forEach((segment, index) => {
    const isFile = index === segments.length - 1
    const bare = isFile ? segment.replace(/\.[a-z]+$/, '') : segment
    const ok = isFile ? FILE_SEGMENT.test(bare) : DIR_SEGMENT.test(bare)
    if (!ok) {
      errors.push(`path segment "${segment}" is not ${isFile ? 'kebab-case or ALL-CAPS' : 'kebab-case'}`)
    }
  })
  return errors
}

/** Lowercase-kebab a directory or file name that failed hygiene. */
export function slugify(name) {
  const extension = name.match(/\.[a-z]+$/i)?.[0] ?? ''
  return (
    name
      .slice(0, name.length - extension.length)
      .replace(/&/g, ' ')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') + extension.toLowerCase()
  )
}

/**
 * Normalise one path segment for a migration: leave it alone when it already
 * passes hygiene, slugify it only when it does not. Without this guard a
 * migration would rename legal ALL-CAPS basenames (PRD.md, README.md,
 * STATUS.md) for no reason.
 */
export function normalizeSegment(segment, isFile) {
  return pathHygieneErrors(isFile ? segment : `${segment}/x.md`).length === 0
    ? segment
    : slugify(segment)
}
