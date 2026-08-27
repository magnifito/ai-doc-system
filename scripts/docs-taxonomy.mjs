/**
 * The taxonomy rules: which `kind` a path implies, which status a tier forces,
 * and the path-hygiene rule. Every function takes the resolved configuration
 * (docs-config.mjs) rather than reading module-level constants, so one checkout
 * can serve several projects.
 *
 * A document's kind is DERIVED from its path, and ALSO stored in frontmatter so
 * a document read outside its tree still says what it is. The gate asserts the
 * two agree, which is what makes the duplication safe (see the design's §4.1
 * reversal note). These functions compute the path-derived half.
 */

/**
 * Turn a tier or exempt pattern into a matcher. A single `*` stands for exactly
 * one path segment: a prefix of `modules`, then a wildcard, then `state` matches
 * `modules/crm/state/x.md` and not `modules/crm/deep/state/x.md`. A pattern
 * without a wildcard keeps the cheap `startsWith` behaviour.
 */
function patternMatcher(pattern) {
  if (!pattern.includes('*')) {
    return (rest) => rest.startsWith(pattern)
  }
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+')
  // A tier prefix ends in `/` and matches a PREFIX; an exempt glob names a file
  // and must match the whole path.
  const regex = pattern.endsWith('/') ? new RegExp(`^${source}`) : new RegExp(`^${source}$`)
  return (rest) => regex.test(rest)
}

const matchers = new Map()

function matcherFor(pattern) {
  let matcher = matchers.get(pattern)
  if (!matcher) {
    matcher = patternMatcher(pattern)
    matchers.set(pattern, matcher)
  }
  return matcher
}

/** Which `kind` a repo-relative path implies. First matching tier wins. */
export function kindForPath(config, path) {
  const prefix = `${config.docsDir}/`
  if (!path.startsWith(prefix)) return null
  const rest = path.slice(prefix.length)
  for (const [tierPrefix, kind] of config.tiers) if (matcherFor(tierPrefix)(rest)) return kind
  return null
}

/**
 * Which product module a path belongs to: the segment under `moduleRoot`, or
 * the literal `platformKey` for anything under that tree. Null elsewhere —
 * generated artefacts at the docs root have no module.
 */
export function moduleForPath(config, path) {
  const prefix = `${config.docsDir}/`
  if (!path.startsWith(prefix)) return null
  const rest = path.slice(prefix.length)
  if (rest.startsWith(`${config.platformKey}/`)) return config.platformKey
  if (!rest.startsWith(config.moduleRoot)) return null
  const key = rest.slice(config.moduleRoot.length).split('/')[0]
  return key || null
}

/** True when a path is exempt from the frontmatter requirement. */
export function isExempt(config, path) {
  const prefix = `${config.docsDir}/`
  if (!path.startsWith(prefix)) return false
  const rest = path.slice(prefix.length)
  return config.exempt.some((pattern) => matcherFor(pattern)(rest))
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
 * Path hygiene AND naming. Two rules that are easy to confuse:
 *
 *   HYGIENE is a character rule — no spaces, no `&`, no underscores, no
 *   MixedCase — and it exists because those are the paths that break shell
 *   globbing and `find | xargs` loops.
 *
 *   NAMING says what a file may be CALLED. Hygiene alone lets a tree hold
 *   `scrum-tasks.md` beside `SCRUM-TASKS.md`, both legal, both the same
 *   concept. So kebab-case is the default for every basename, and ALL-CAPS is
 *   allowed only for a closed set of sentinels (config.sentinels — names whose
 *   caps mean "entry point for this folder") or a declared programme prefix
 *   (config.allowedBasenamePrefixes).
 *
 * Directory segments are always strictly lowercase-kebab; there are no sentinel
 * directories.
 */
const DIR_SEGMENT = /^[a-z0-9-]+$/
const KEBAB = /^[a-z0-9-]+$/
const ALL_CAPS = /^[A-Z0-9-]+$/

export function pathHygieneErrors(path, config) {
  const errors = []
  const segments = path.split('/')
  segments.forEach((segment, index) => {
    const isFile = index === segments.length - 1
    const bare = isFile ? segment.replace(/\.[a-z]+$/, '') : segment
    if (!isFile) {
      if (!DIR_SEGMENT.test(bare)) errors.push(`path segment "${segment}" is not kebab-case`)
      return
    }
    if (KEBAB.test(bare)) return
    if (!ALL_CAPS.test(bare)) {
      errors.push(`file name "${segment}" is not kebab-case`)
      return
    }
    // ALL-CAPS: legal only as a sentinel or under a declared programme prefix.
    if (!config) return
    const sentinel = config.sentinels.includes(bare)
    const prefixed = config.allowedBasenamePrefixes.some((prefix) => bare.startsWith(prefix))
    if (!sentinel && !prefixed) {
      errors.push(
        `file name "${segment}" is ALL-CAPS but not a sentinel ` +
          `(${config.sentinels.join(', ')})${config.allowedBasenamePrefixes.length ? ` or a declared prefix (${config.allowedBasenamePrefixes.join(', ')})` : ''}` +
          ' — rename it to kebab-case',
      )
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
