---
name: ai-doc-system
description: Use when a repository's docs/ tree is unnavigable, misleading, or unenforced — when an agent cannot tell whether a document describes something the product has, has committed to, or will never build. Tiers docs/ by authority, puts validated frontmatter on every file, generates an agent-readable index, and adds a blocking gate. Also use to add a document to a tree that already has this system, or to promote a reference document into committed scope.
---

# Documentation system

Tier a repository's documentation by **authority** — how much weight a reader should give a
document — put machine-readable metadata on every file, generate the index agents read instead of
grepping, and enforce all of it with a blocking check.

The problem this solves is not tidiness. A tree with no metadata has one default failure mode: an
agent greps for a feature, finds a confident specification, and implements something the project
never committed to. `status: reference` is the field that makes "not a commitment" machine-detectable.

## Which task is this?

**A. The tree already has this system** (a `docs/index.json` exists) — go to §4 and §5. Do not
re-run the migration.

**B. The tree does not have it yet** — work §1 → §5 in order.

---

## 1. Survey before proposing anything

Never write the migration map from a directory listing. Gather this first, and put the numbers in
front of the user:

```bash
find docs -name '*.md' | wc -l                       # corpus size
for d in docs/*/; do printf '%-40s %s\n' "${d%/}" \
  "$(git log -1 --format=%ad --date=short -- "$d")"; done   # per-tree staleness
find docs -name '*.md' | grep -E '[ A-Z_&]'          # paths that break globbing
grep -rl '^---$' --include='*.md' docs | wc -l       # files that already have frontmatter
```

The staleness sweep is the highest-value command: a clean date split between two groups of
directories usually means the tree holds two different *kinds* of artifact under one roof, which is
the whole case for tiering. Say so with the dates, or drop the claim.

Ask the user four questions and treat the answers as constraints, not suggestions:

1. Who is the primary reader — agents or humans?
2. Which documents are captured from elsewhere and are **not** commitments?
3. Should hygiene block a push, or only report?
4. Is anything allowed to be deleted? (Default: no. Tier it, don't prune it.)

## 2. Install the scripts

Copy `scripts/*.mjs` into the target repo's `scripts/` (or wherever its tooling lives). They are
dependency-free ESM and need only Node.

If the target's answers differ from the defaults, write `docs-system.config.json` at its root —
`docsDir`, `tiers`, `statuses`, `tierStatus`, `exempt`, `tierOrder`, `indexSubdivide`,
`referenceScanExclude`. A project whose answers **are** the defaults ships no config file. Unknown
keys are rejected, so a typo cannot silently do nothing.

Wire up four scripts:

```jsonc
"lint:docs":          "node scripts/check-docs.mjs",
"lint:docs:advisory": "node scripts/check-docs-advisory.mjs",  // non-blocking
"gen:docs-index":     "node scripts/gen-docs-index.mjs",
"test:scripts":       "node --test scripts/*.test.mjs"
```

`lint:docs` and `test:scripts` go in the blocking gate — cheap, so put them before the type checks.
`lint:docs:advisory` goes wherever the project keeps non-blocking checks. **Wire the tests too:** a
suite no runner executes is green exactly once.

## 3. Migrate

Copy `templates/docs-migration.map.example.mjs` to the target root as `docs-migration.map.mjs` and
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
4. `node scripts/gen-docs-index.mjs`, then `node scripts/check-docs.mjs` until it prints OK.
5. **Delete `docs-migration.map.mjs` and `migrate-docs.mjs`** from the target. They ran once.
6. Add a section to the target's `AGENTS.md` / `CLAUDE.md`: *read `docs/index.json` first, never
   grep `docs/` blind*, plus the promotion rule.

## 4. Rules that outlive the migration

- **Nothing in `reference/` may be implemented directly.** Promote it first — `git mv` into
  `product/`, restatus, and **rewrite the prose to describe this product**. Promoting a captured
  document verbatim is how someone else's assumptions become your requirements.
- **`kind` is derived from the path, never stored.** Moving a file between tiers is what changes it.
- **`INDEX.md` and `index.json` are generated.** Fix a stale one with `gen:docs-index`, never by hand.
- **`updated:` is human-maintained** — the author of a substantive edit bumps it. Nothing derives it
  from git, because the git date moves on every whitespace commit.
- **A new document ships with frontmatter and a regenerated index in the same change.**

## 5. Judgement, not mechanics

The migration is the easy half. These are the calls that decide whether the result is honest:

- **Never stamp `shipped` on the strength of a plan's own prose.** A plan that says "✅ EXECUTED" is
  making a claim, not reporting a verified fact. Migrate every plan `active` and hand the user a
  list of the completion claims nobody checked. Auditing them is separate work with a separate cost.
- **A document whose own first line says SUPERSEDED belongs in `archive/`**, whatever its
  frontmatter says. That is evidence, not tidiness.
- **A "closed" plan that still lists untaken steps is a live backlog.** It does not belong in
  `done/`.
- **Two files with the same basename in one tier is the defect you are removing.** Rename one.
- **Settle naming before you migrate, not after.** Kebab-case is the default; decide the sentinel
  set (`README`, `INDEX`, `STATUS`, `ROADMAP`, `PRD` …) and whether the project has a programme
  prefix worth declaring (`OPUS-`, `RFC-`), and put both in `docs-system.config.json`. An undeclared
  carve-out is not a convention, it is the absence of one — and the survey will show you the proof:
  grep for the same stem in two casings. Renaming for case alone needs **two** `git mv`s through a
  temporary name on macOS and Windows.
- **Say what you deviated from and why.** The design is a record; a departure from it that nobody
  wrote down becomes a bug for the next reader.

## Reference

- `reference/design.md` — the full design: problem, rejected alternatives, metadata schema, the
  gate's six assertions, what it deliberately does not assert, known limitations, and the questions
  to settle per project.
