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
 * Every rule the gate and the advisory pass know, with its default severity.
 * `error` fails the gate, `warn` is printed and never fails, `off` is silent.
 * A project overrides one id at a time in `rules`; unknown ids are rejected so
 * a typo cannot silently leave a rule at its default.
 */
export const RULES = {
  frontmatter: 'error',
  required: 'error',
  vocabulary: 'error',
  date: 'error',
  path: 'error',
  basename: 'error',
  link: 'error',
  implements: 'error',
  superseded: 'error',
  evidence: 'error',
  changes: 'error',
  'source-url': 'error',
  summary: 'error',
  index: 'error',
  transition: 'error',
  'promoted-verbatim': 'error',
  'shipped-code': 'warn',
  upstream: 'warn',
  review: 'warn',
}

/** The severities a rule may carry. */
export const SEVERITIES = ['error', 'warn', 'off']

/**
 * The defaults are the tiering this system was designed against: documents
 * grouped by AUTHORITY (how much weight a reader should give them), not topic.
 * Change `tiers` and you change what `kind` a path implies — nothing else.
 */
export const DEFAULTS = {
  /** Directory holding the documentation tree, relative to the repo root. */
  docsDir: 'docs',

  /** Per-rule severity overrides, merged over `RULES`. */
  rules: {},

  /**
   * Command names an `evidence:` entry may start with. Anything else has to be
   * a repository path that exists, so free prose stays rejected. A project that
   * drives its checks through some other runner adds it with `evidenceRunners+`.
   */
  evidenceRunners: [
    'bun', 'bunx', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'deno', 'make', 'just',
    'cargo', 'go', 'pytest', 'python', 'python3', 'grep', 'rg', 'ls', 'git', 'curl', 'psql',
  ],

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

  /**
   * Where per-module trees live, relative to `docsDir`, and the reserved key for
   * everything cross-cutting. A project that does not group by module leaves
   * `modules` empty; every module assertion then passes vacuously.
   */
  moduleRoot: 'modules/',
  platformKey: 'platform',

  /**
   * The closed set of product modules. `class` is `core` (never sellable),
   * `anchor` (sells on its own) or `addon` (sells only alongside an anchor).
   * `requires` names the anchors an addon needs, and every name must itself be
   * registered — a typo here would otherwise describe a dependency on nothing.
   */
  modules: [],

  /**
   * Extra frontmatter fields a kind demands, beyond `title`/`status`/`updated`.
   * Keyed by kind, so the rule travels with the project rather than the script.
   */
  requiredFields: {},

  /** Closed value sets for optional scalar fields, keyed by field name. */
  vocabularies: {},

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
    // A GLOB, not one entry per file. The list used to name each test by hand
    // and fell behind every time a script gained one, and the gap only shows up
    // once the new test is COMMITTED, because the scan reads tracked files: the
    // repository's gate goes green and then fails on push. Git pathspec globs
    // do not cross `/`, so this matches `scripts/*.test.mjs` and nothing deeper.
    'scripts/*.test.mjs',
    'docs-migration.map.mjs',
  ],
}

const cache = new Map()

/**
 * Resolve `"<key>+": [...]` into `"<key>"`, appending to the DEFAULT rather than
 * replacing it. Replacing is the right default for a closed set a project owns,
 * but the array settings that grow (`referenceScanExclude`, `sentinels`,
 * `evidenceRunners`) are ones where a project wants ITS entries as well as the
 * shipped ones, and a hand-copied default silently falls behind an upgrade.
 *
 * Runs before the merge, so `validate` only ever sees plain keys.
 */
function foldExtensions(overrides) {
  const out = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (!key.endsWith('+')) {
      out[key] = value
      continue
    }
    const base = key.slice(0, -1)
    if (!Array.isArray(DEFAULTS[base])) {
      throw new Error(`${CONFIG_FILE}: "${key}" extends "${base}", which is not an array setting`)
    }
    if (!Array.isArray(value)) throw new Error(`${CONFIG_FILE}: "${key}" must be an array`)
    out[base] = [...(out[base] ?? DEFAULTS[base]), ...value]
  }
  return out
}

/** Resolved configuration for one repository root. Cached per root. */
export function loadConfig(root) {
  if (cache.has(root)) return cache.get(root)
  const file = join(root, CONFIG_FILE)
  let overrides = {}
  if (existsSync(file)) {
    try {
      overrides = foldExtensions(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      throw new Error(`${CONFIG_FILE} is not valid JSON: ${error.message}`, { cause: error })
    }
  }
  const merged = { ...DEFAULTS, ...overrides }
  merged.rules = { ...RULES, ...(overrides.rules ?? {}) }
  validate(overrides, merged)
  const config = withDerived(merged)
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
    moduleKeys: [...config.modules.map((entry) => entry.key), config.platformKey],
    exemptPaths: new Set(config.exempt.map((name) => `${config.docsDir}/${name}`)),
    // Callers that build a config from DEFAULTS directly still get the full map.
    rules: { ...RULES, ...(config.rules ?? {}) },
  }
}

/** Forget cached configuration. For tests that rewrite a config file in place. */
export function clearConfigCache() {
  cache.clear()
}

/**
 * Cross-field rules run on the MERGED config, not the overrides alone: a
 * project overriding `statuses` without `tierStatus` used to slip past the
 * consistency check and fail later, one violation per document, with no hint
 * that the config was the defect.
 */
function validate(overrides, merged) {
  for (const key of Object.keys(overrides)) {
    // Editors resolve completion from `$schema`; the loader has no use for it.
    if (key === '$schema') continue
    if (!(key in DEFAULTS)) {
      throw new Error(`${CONFIG_FILE}: unknown key "${key}" — known keys are ${Object.keys(DEFAULTS).join(', ')}`)
    }
  }
  for (const [id, severity] of Object.entries(overrides.rules ?? {})) {
    if (!(id in RULES)) throw new Error(`${CONFIG_FILE}: unknown rule "${id}" — known rules are ${Object.keys(RULES).join(', ')}`)
    if (!SEVERITIES.includes(severity)) {
      throw new Error(`${CONFIG_FILE}: rule "${id}" has severity "${severity}" — expected ${SEVERITIES.join(' | ')}`)
    }
  }
  for (const entry of merged.tiers) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`${CONFIG_FILE}: every "tiers" entry must be a [prefix, kind] pair`)
    }
    if (!entry[0].endsWith('/')) {
      throw new Error(`${CONFIG_FILE}: tier prefix "${entry[0]}" must end with "/"`)
    }
  }
  for (const status of Object.values(merged.tierStatus)) {
    if (!merged.statuses.includes(status)) {
      throw new Error(`${CONFIG_FILE}: tierStatus names "${status}", which is not in "statuses"`)
    }
  }
  const CLASSES = ['core', 'anchor', 'addon']
  const keys = new Set(merged.modules.map((entry) => entry.key))
  for (const entry of merged.modules) {
    if (!entry.key) throw new Error(`${CONFIG_FILE}: every "modules" entry needs a "key"`)
    if (!CLASSES.includes(entry.class)) {
      throw new Error(
        `${CONFIG_FILE}: module "${entry.key}" has class "${entry.class}" — expected ${CLASSES.join(' | ')}`,
      )
    }
    for (const required of entry.requires ?? []) {
      if (!keys.has(required)) {
        throw new Error(
          `${CONFIG_FILE}: module "${entry.key}" requires "${required}", which is not a registered module`,
        )
      }
    }
  }
  if (merged.modules.length > 0 && !merged.tiers.some(([prefix]) => prefix.startsWith(merged.moduleRoot))) {
    throw new Error(
      `${CONFIG_FILE}: modules are declared but no tier prefix lies under moduleRoot "${merged.moduleRoot}" — ` +
        `add wildcard tiers like "${merged.moduleRoot}*/state/"`,
    )
  }
  const kinds = new Set(merged.tiers.map(([, kind]) => kind))
  for (const kind of Object.keys(merged.requiredFields)) {
    if (!kinds.has(kind)) {
      throw new Error(`${CONFIG_FILE}: requiredFields names kind "${kind}", which no tier produces`)
    }
  }
}
