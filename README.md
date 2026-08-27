# ai-doc-system

A documentation system for repositories whose primary reader is an AI agent.

`docs/` is tiered by **authority** — how much weight a reader should give a document — rather than
by topic. Every file carries validated frontmatter. An index is generated for agents to read instead
of grepping. A blocking check keeps all of it true.

## The problem

A documentation tree with no metadata has one default failure mode, and it is not untidiness. An
agent greps for a feature name, finds a confident, well-written specification, and cannot tell
whether it describes something the product **has**, something it has **committed to build**, or
something a competitor has that this product will **never** build. So it implements the third one.

`status: reference` is the field that fixes this. It converts a pile of ambiguous half-commitments
into an explicitly non-binding idea bank, and it is checkable by machine.

## What you get

| Piece | What it does |
|---|---|
| `scripts/check-docs.mjs` | The gate. Nine assertions, exits 1 on any violation. Wire it in as `lint:docs`. |
| `scripts/gen-docs-index.mjs` | Generates `docs/INDEX.md` (humans) and `docs/index.json` (agents). |
| `scripts/check-docs-advisory.mjs` | Non-blocking: dead `code:` pointers, `updated:`-versus-git drift. |
| `scripts/migrate-docs.mjs` | One-shot: `git mv` into the tiers, stamp frontmatter, rewrite every tracked reference. Deleted after it runs. |
| `scripts/docs-config.mjs` | Per-project configuration, with defaults that need no config file. |
| `scripts/*.test.mjs` | The test suite, over throwaway fixture trees, some of them real git repositories. Wire it in — a suite no runner executes is green exactly once. |
| `SKILL.md` | The agent-facing procedure, including the judgement calls the mechanics do not cover. |
| `templates/` | The migration map to fill in, and the `docs/README.md` contract to adapt. |
| `bin/cli.mjs` | Package entry point — `ai-doc-system check\|gen\|fix\|advisory\|migrate` — for npm-based installs. |
| `docs/` | This repo's own gated tree; `engineering/design.md` is the full design: the problem, the two rejected alternatives, and the limitations that survived implementation. |

Plain ESM, Node 20+, one dependency: the `yaml` package — frontmatter holds lists and colon-bearing
scalars that a hand-rolled parser mangled. Installing into a host repo means copying the scripts
**and** adding `yaml` to its dependencies.

## The default tiers

```
docs/
  README.md      # hand-written contract. Exempt from frontmatter.
  INDEX.md       # GENERATED, for humans
  index.json     # GENERATED, the agent entry point

  reference/     # captured from elsewhere. NEVER a build spec.      status: reference
  product/       # committed scope
  engineering/   # how this repository works        (+ adr/, runbooks/)
  plans/         # work in flight                   (+ done/)
  archive/       # replaced                                          status: superseded
```

`kind` is **derived from the path** and mirrored in frontmatter — moving a file between tiers is
what changes its kind: `git mv`, then `fix-docs-frontmatter.mjs` to restamp the stored copy.

Change any of it in `docs-system.config.json`; a project whose answers are the defaults ships no
config file at all.

## Frontmatter

```yaml
---
title: Recurring Invoices   # required
kind: reference             # required — must equal what the path implies
module: billing             # required when the project declares modules
status: reference           # required — reference | draft | active | shipped | superseded
updated: 2026-05-29         # required — ISO date, bumped by the author of a substantive edit
---
```

Optional: `implements:` (validated when present), `code:`. Required on `superseded`:
`superseded_by:`, whose target must exist.

`kind` and `module` are derived from the path **and** stored, and the gate rejects a document where
the two disagree. Storing them is what lets a document say what it is when it is read outside the
tree; the assertion is what stops the duplicate drifting. After moving files, run
`fix-docs-frontmatter.mjs` to restamp both.

### The optional module axis

A project may group `docs/` by product module first and tier second — `docs/modules/<key>/state/` —
by declaring `modules` and wildcard tier prefixes in `docs-system.config.json`. Two families carry
their own required fields:

| Kind | Means | Required |
|---|---|---|
| `state` | Reflection — what the system IS today | `verified_on`, `evidence` |
| `todo` | Wishlist — what we want | `commitment`, `changes` |

```yaml
kind: state
verified_on: 2026-08-23
evidence:
  - "apps/api/src/pipelines/pipelines.controller.ts:24"   # a path that exists
  - bunx nx test domain-pipelines                          # or a command to re-run
```

Every `evidence` entry must be a live path or a runnable command — free prose is rejected. Every
`changes` entry must name a live document of kind `state`. A project that declares no modules is
unaffected by any of this.

## What the gate asserts

1. Frontmatter present and parseable outside the exempt list.
2. Closed vocabularies — `status` in its set, `title`/`updated` present, dates ISO-formatted, status
   agrees with the tier **in both directions**, `implements` names a file that exists.
3. Path hygiene and naming — kebab-case directories; kebab-case basenames except a closed set of
   sentinels (`README`, `INDEX`, `STATUS`, `ROADMAP`, `PRD`, …) and any programme prefix the project
   declares. Hygiene alone would let `scrum-tasks.md` and `SCRUM-TASKS.md` both be legal; the naming
   half is what stops that. Links resolve case-exactly on every path segment, so a rename does not
   "pass" on macOS and break on Linux.
4. Index freshness — regenerated in memory and compared byte-for-byte with what is committed.
5. No dead `.md` links — inline and reference-style, inside the tree and from every tracked file
   outside it.
6. `status: superseded` implies a `superseded_by:` whose target exists.
7. `kind` and `module` are present and agree with what the path implies.
8. Per-kind required fields, closed vocabularies for optional scalars, every `evidence` entry a
   live path or a runnable command, every `changes` target a live `state` document.
9. No two documents in one tier (and module) share a basename — sentinels excepted.

And what it deliberately does **not** assert — document age, prose style, whether `code:` still
resolves, whether `updated:` matches git — is argued in [`docs/engineering/design.md`](docs/engineering/design.md)
§5.3. A gate that cries wolf gets bypassed.

## Using it

Install as a skill and let an agent drive it:

```bash
git clone https://github.com/magnifito/ai-doc-system.git
ln -s "$PWD/ai-doc-system" ~/.claude/skills/ai-doc-system
```

Then, in the target repository, ask for the documentation system. [`SKILL.md`](SKILL.md) is the
procedure: survey first, migrate, then the rules that outlive the migration.

By hand, the short version:

```bash
cp /path/to/ai-doc-system/scripts/*.mjs scripts/
npm install yaml            # or the host's package manager equivalent
cp /path/to/ai-doc-system/templates/docs-migration.map.example.mjs docs-migration.map.mjs
$EDITOR docs-migration.map.mjs
node scripts/migrate-docs.mjs --dry-run    # iterate until every row is right
node scripts/migrate-docs.mjs --apply
node scripts/gen-docs-index.mjs && node scripts/check-docs.mjs
rm docs-migration.map.mjs scripts/migrate-docs.mjs
```

## Provenance

Designed and first applied to a 301-document monorepo in August 2026, where 208 of those documents
were captured from elsewhere and indistinguishable from committed scope until this ran.
[`docs/engineering/design.md`](docs/engineering/design.md) carries the reasoning, the two rejected alternatives,
and the limitations that survived implementation.

## License

[Apache-2.0](LICENSE).
