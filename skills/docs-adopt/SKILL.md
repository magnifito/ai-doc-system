---
name: docs-adopt
description: Use when a repository has no docs/index.json and its docs tree is unnavigable, misleading, or unenforced — an agent cannot tell whether a document describes something the product has, has committed to, or will never build. Surveys the tree, asks the four questions, installs @puralex/ai-doc-system, writes the migration map, tiers every document by authority, stamps validated frontmatter, generates the agent-readable index, and wires the blocking gate into CI. Not for a tree that already has docs/index.json — use docs-write, docs-promote, docs-audit or docs-gate there.
---

# Adopt the documentation system

Tier a repository's documentation by **authority** — how much weight a reader should give a
document — put machine-readable metadata on every file, generate the index agents read instead of
grepping, and enforce all of it with a blocking check.

The problem this solves is not tidiness. A tree with no metadata has one default failure mode: an
agent greps for a feature, finds a confident specification, and implements something the project
never committed to. `status: reference` is the field that makes "not a commitment" machine-detectable.

**Stop if `docs/index.json` exists.** The tree is adopted. Adding a document is docs-write, moving
or promoting one is docs-promote, cleaning up is docs-audit, a red gate is docs-gate.

## 1. Survey before proposing anything

Never write the migration map from a directory listing. Gather this first, and put the numbers in
front of the user:

```bash
find docs -name '*.md' | wc -l                       # corpus size
for d in docs/*/; do printf '%-40s %s\n' "${d%/}" \
  "$(git log -1 --format=%ad --date=short -- "$d")"; done   # per-tree staleness
find docs -name '*.md' | grep -E '[ A-Z_&]'          # paths that break globbing
grep -rl '^---$' --include='*.md' docs | wc -l       # files with a `---` line (frontmatter or a rule — an upper bound)
```

The staleness sweep is the highest-value command: a clean date split between two groups of
directories usually means the tree holds two different *kinds* of artifact under one roof, which is
the whole case for tiering. Say so with the dates, or drop the claim.

Ask the user four questions and treat the answers as constraints, not suggestions:

1. Who is the primary reader — agents or humans?
2. Which documents are captured from elsewhere and are **not** commitments?
3. Should hygiene block a push, or only report?
4. Is anything allowed to be deleted? (Default: no. Tier it, don't prune it.)

## 2. Install

Two routes; prefer the first:

**npm.** `npm install -D @puralex/ai-doc-system` in the target, then `npx ai-doc-system init` for a
greenfield tree (contract, index, scripts — gate-clean immediately), or wire the commands by hand
for a migration.

**Vendor.** Copy `scripts/*.mjs` from this plugin (`${CLAUDE_PLUGIN_ROOT}/scripts/` — never resolve
the path against the target repo) into the target's `scripts/`. Plain ESM, Node 20+, one
dependency: add `yaml` to the target's dependencies — without it every script fails on import.

If the target's answers differ from the defaults, write `docs-system.config.json` at its root —
`docsDir`, `tiers`, `statuses`, `tierStatus`, `exempt`, `tierOrder`, `indexSubdivide`,
`referenceScanExclude`, `evidenceRunners`, `sentinels`, `allowedBasenamePrefixes`,
`requiredFields` (extra fields a kind demands), `vocabularies`, the module axis (`modules`,
`moduleRoot`, `platformKey` — leave `modules` empty and every module assertion passes vacuously),
and `rules` (per-rule severity: `error`, `warn` or `off`). Point `$schema` at
`https://raw.githubusercontent.com/magnifito/ai-doc-system/main/schema/docs-system.config.schema.json`
for completion, and use a `key+` suffix to extend an array default instead of replacing it. A project whose answers **are** the
defaults ships no config file. Unknown keys are rejected, so a typo cannot silently do nothing.

Settle naming before you migrate, not after. Kebab-case is the default; decide the sentinel set
(`README`, `INDEX`, `STATUS`, `ROADMAP`, `PRD` …) and whether the project has a programme prefix
worth declaring (`OPUS-`, `RFC-`), and put both in the config. The survey shows the proof: grep for
the same stem in two casings. Renaming for case alone needs **two** `git mv`s through a temporary
name on macOS and Windows.

Wire up the scripts. On the npm route these four are exactly what `init` writes (for a migration,
where `init` does not run, add them by hand):

```jsonc
"lint:docs":          "ai-doc-system check",
"lint:docs:advisory": "ai-doc-system advisory",  // non-blocking
"gen:docs-index":     "ai-doc-system gen",
"docs:impact":        "ai-doc-system impact",    // non-blocking
```

On the vendored route write the same four as `node scripts/check-docs.mjs`,
`node scripts/check-docs-advisory.mjs`, `node scripts/gen-docs-index.mjs` and
`node scripts/impact-docs.mjs`, plus a fifth: `"test:scripts": "node --test scripts/*.test.mjs"`.

Run these as `npx ai-doc-system …` (npm install) or `node scripts/<name>.mjs` (vendored); a bare
`ai-doc-system` is on PATH only inside an npm script.

`lint:docs` goes in the blocking gate — cheap, so put it before the type checks. `lint:docs:advisory`
goes wherever the project keeps non-blocking checks. On pull requests add two steps:
`check --format github --base origin/<default>` is **blocking** (exit 1 on any error), annotates
the offending file, and adds the two history-aware rules (`transition`, `promoted-verbatim`);
`impact --base origin/<default>` lists the documents whose claims cover the changed paths into the
job summary and always exits 0. Both need full history — set `fetch-depth: 0` on
`actions/checkout`, or `check --base` exits 2 with `base ref … does not resolve`.

## 3. Migrate

Copy `templates/docs-migration.map.example.mjs` (from `${CLAUDE_PLUGIN_ROOT}/templates/` or
`node_modules/@puralex/ai-doc-system/templates/`) to the target root as `docs-migration.map.mjs` and
write the real map. Then:

```bash
node scripts/migrate-docs.mjs --dry-run    # print the map + the files whose refs would change
node scripts/migrate-docs.mjs --apply      # git mv, stamp frontmatter, rewrite references
```

Iterate on `--dry-run` until every row is right and `unmapped` is only what genuinely needs a human.
`--apply` aborts before the first `git mv` if two sources collide on one destination.

Then, in this order:

1. **Handle the unmapped files and root strays by hand.** Read each one. Never guess.
2. **Repair relative links the move broke.** The gate finds them; resolve each to a real file, and
   for a link whose target never existed, de-link the text rather than inventing a target.
3. **Copy `templates/docs-README.template.md`** to `<docsDir>/README.md` and edit it to match the
   project's actual tiers.
4. `node scripts/gen-docs-index.mjs`, then `node scripts/check-docs.mjs` until it prints OK. A
   violation you do not understand is docs-gate.
5. **Delete `docs-migration.map.mjs`** (and, on the vendored route, `migrate-docs.mjs`) from the
   target. They ran once.
6. Add a section to the target's `AGENTS.md` / `CLAUDE.md`: *read `docs/index.json` first, never
   grep `docs/` blind*, plus the promotion rule.

## 4. What the migration must not decide

- **Never stamp `shipped` on the strength of a plan's own prose.** A plan that says "✅ EXECUTED" is
  making a claim, not reporting a verified fact. Migrate every plan `active` and hand the user a
  list of the completion claims nobody checked. Auditing them is docs-audit, separate work with a
  separate cost.
- **A document whose own first line says SUPERSEDED belongs in `archive/`**, whatever its
  frontmatter says. That is evidence, not tidiness.
- **Two files with the same basename in one tier is the defect you are removing.** Rename one.
- **Say what you deviated from and why.** The design is a record; a departure from it that nobody
  wrote down becomes a bug for the next reader.

## Reference

- `${CLAUDE_PLUGIN_ROOT}/docs/engineering/design.md` — the full design: problem, rejected
  alternatives, metadata schema, the gate's assertions, known limitations, and the questions to
  settle per project.
