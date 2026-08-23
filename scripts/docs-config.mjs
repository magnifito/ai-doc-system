/**
 * Per-project configuration for the documentation system.
 *
 * Every script here takes a repository root and resolves its configuration from
 * that root, so one checkout of these scripts can serve several projects and the
 * test fixtures (throwaway trees with no config file) get the defaults.
 *
 * A project overrides what it needs in `docs-system.config.json` at its root.
 * A project whose answer is the defaults ships no config file at all.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CONFIG_FILE = 'docs-system.config.json'

/**
 * The defaults are the tiering this system was designed against: documents
 * grouped by AUTHORITY (how much weight a reader should give them), not topic.
 * Change `tiers` and you change what `kind` a path implies — nothing else.
 */
export const DEFAULTS = {
  /** Directory holding the documentation tree, relative to the repo root. */
  docsDir: 'docs',

  /**
   * Ordered `[prefix, kind]` pairs, prefixes relative to `docsDir`. FIRST MATCH
   * WINS, so nested tiers must precede the tier that contains them.
   */
  tiers: [
    ['reference/', 'reference'],
    ['product/', 'product'],
    ['engineering/adr/', 'adr'],
    ['engineering/runbooks/', 'runbook'],
    ['engineering/', 'engineering'],
    ['plans/', 'plan'],
    ['archive/', 'archive'],
  ],

  /** Closed status vocabulary. A misspelled status is rejected, never stored. */
  statuses: ['reference', 'draft', 'active', 'shipped', 'superseded'],

  /**
   * Tier kind -> the ONLY status its documents may carry, enforced in both
   * directions: a file in the tier must have it, and no file outside the tier
   * may. This is what makes "not a commitment" machine-detectable.
   */
  tierStatus: { reference: 'reference', archive: 'superseded' },

  /** Files exempt from frontmatter, relative to `docsDir`. */
  exempt: ['INDEX.md', 'README.md'],

  /**
   * NAMING. Path hygiene alone is a character rule — it rejects spaces and
   * MixedCase but says nothing about what a file should be CALLED, so a tree can
   * pass it while holding `scrum-tasks.md` beside `SCRUM-TASKS.md`. These two
   * settings make the convention checkable.
   *
   * `sentinels` is the closed set of ALL-CAPS basenames that are allowed to
   * shout, because their caps carry meaning: this is the entry point for its
   * folder. Everything else is kebab-case.
   */
  sentinels: ['README', 'INDEX', 'STATUS', 'ROADMAP', 'PRD', 'CHANGELOG', 'LICENSE'],

  /**
   * ALL-CAPS prefixes for named programmes whose identity is the string itself —
   * referenced by name across many documents, so renaming them costs more than
   * the consistency is worth. A declared carve-out, not an accident: a name only
   * qualifies if it starts with one of these AND is otherwise ALL-CAPS.
   */
  allowedBasenamePrefixes: [],

  /** Kind order in the generated INDEX.md; unlisted kinds follow, in tier order. */
  tierOrder: ['product', 'engineering', 'adr', 'runbook', 'plan', 'reference', 'archive'],

  /**
   * Kinds whose INDEX.md section is split into a subsection per area (the path
   * segment under the tier). One flat table stops being an index at a few dozen
   * rows; below that a heading per area is noise.
   */
  indexSubdivide: ['reference', 'plan'],

  /**
   * Paths excluded from the tracked-reference scan (check-docs assertion 5b), as
   * git pathspecs. Two classes belong here and no others:
   *
   *   - Vendored tooling trees, whose skill templates name generic `docs/` paths
   *     that are not the host project's contract.
   *   - THIS SYSTEM'S OWN TESTS, and the one-shot migration map. Both name
   *     documents that deliberately do not exist — a fixture with no
   *     frontmatter, a deliberately dead link, a destination the migration has
   *     not created yet. Without the exclusion every repository that vendors
   *     these scripts inherits a permanent false positive the moment it commits
   *     them, and the migration could never be run from a clean gate.
   *
   * Adjust the entries if the scripts live somewhere other than `scripts/`. Do
   * not add a path here to silence a real dead pointer.
   */
  referenceScanExclude: [
    '.claude',
    '.agents',
    '_bmad',
    'skills-lock.json',
    'scripts/check-docs.test.mjs',
    'scripts/docs-config.test.mjs',
    'scripts/tracked-refs.test.mjs',
    'docs-migration.map.mjs',
  ],
}

const cache = new Map()

/** Resolved configuration for one repository root. Cached per root. */
export function loadConfig(root) {
  if (cache.has(root)) return cache.get(root)
  const file = join(root, CONFIG_FILE)
  let overrides = {}
  if (existsSync(file)) {
    try {
      overrides = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      throw new Error(`${CONFIG_FILE} is not valid JSON: ${error.message}`, { cause: error })
    }
    validate(overrides)
  }
  const config = withDerived({ ...DEFAULTS, ...overrides })
  cache.set(root, config)
  return config
}

/**
 * Add the fields that are computed, never configured: the kinds in play are
 * exactly the tiers', and the exempt list is anchored to `docsDir`. Exported so
 * a caller with no repository root (a renderer handed pre-built entries) can
 * still resolve `DEFAULTS`.
 */
export function withDerived(config) {
  return {
    ...config,
    kinds: [...new Set(config.tiers.map(([, kind]) => kind))],
    exemptPaths: new Set(config.exempt.map((name) => `${config.docsDir}/${name}`)),
  }
}

/** Forget cached configuration. For tests that rewrite a config file in place. */
export function clearConfigCache() {
  cache.clear()
}

function validate(overrides) {
  for (const key of Object.keys(overrides)) {
    if (!(key in DEFAULTS)) {
      throw new Error(`${CONFIG_FILE}: unknown key "${key}" — known keys are ${Object.keys(DEFAULTS).join(', ')}`)
    }
  }
  if (overrides.tiers) {
    for (const entry of overrides.tiers) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new Error(`${CONFIG_FILE}: every "tiers" entry must be a [prefix, kind] pair`)
      }
      if (!entry[0].endsWith('/')) {
        throw new Error(`${CONFIG_FILE}: tier prefix "${entry[0]}" must end with "/"`)
      }
    }
  }
  if (overrides.tierStatus && overrides.statuses) {
    for (const status of Object.values(overrides.tierStatus)) {
      if (!overrides.statuses.includes(status)) {
        throw new Error(`${CONFIG_FILE}: tierStatus names "${status}", which is not in "statuses"`)
      }
    }
  }
}
