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
| `scripts/check-docs.mjs` | The gate. Six assertions, exits 1 on any violation. Wire it in as `lint:docs`. |
| `scripts/gen-docs-index.mjs` | Generates `docs/INDEX.md` (humans) and `docs/index.json` (agents). |
| `scripts/check-docs-advisory.mjs` | Non-blocking: dead `code:` pointers, `updated:`-versus-git drift. |
| `scripts/migrate-docs.mjs` | One-shot: `git mv` into the tiers, stamp frontmatter, rewrite every tracked reference. Deleted after it runs. |
| `scripts/docs-config.mjs` | Per-project configuration, with defaults that need no config file. |
| `scripts/*.test.mjs` | 34 tests over throwaway fixture trees, some of them real git repositories. Wire them in — a suite no runner executes is green exactly once. |
| `SKILL.md` | The agent-facing procedure, including the judgement calls the mechanics do not cover. |
| `templates/` | The migration map to fill in, and the `docs/README.md` contract to adapt. |
| `reference/` | The full design: the problem, the two rejected alternatives, and the limitations that survived implementation. |

Dependency-free ESM. Node 20+. Nothing to install.

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

`kind` is **derived from the path** and is never a frontmatter field — moving a file between tiers
is what changes its kind, one `git mv`, with no second edit to forget.

Change any of it in `docs-system.config.json`; a project whose answers are the defaults ships no
config file at all.

## Frontmatter

```yaml
---
title: Recurring Invoices   # required
status: reference           # required — reference | draft | active | shipped | superseded
updated: 2026-05-29         # required — ISO date, bumped by the author of a substantive edit
---
```

Optional: `implements:` (validated when present), `code:`. Required on `superseded`:
`superseded_by:`, whose target must exist.

## What the gate asserts

1. Frontmatter present and parseable outside the exempt list.
2. Closed vocabularies — `status` in its set, `title`/`updated` present, no `kind` field, status
   agrees with the tier **in both directions**, `implements` names a file that exists.
3. Path hygiene and naming — kebab-case directories; kebab-case basenames except a closed set of
   sentinels (`README`, `INDEX`, `STATUS`, `ROADMAP`, `PRD`, …) and any programme prefix the project
   declares. Hygiene alone would let `scrum-tasks.md` and `SCRUM-TASKS.md` both be legal; the naming
   half is what stops that. Links resolve case-exactly, so a rename does not "pass" on macOS and
   break on Linux.
4. Index freshness — regenerated in memory and compared byte-for-byte with what is committed.
5. No dead `.md` links, inside the tree and from every tracked file outside it.
6. `status: superseded` implies a `superseded_by:` whose target exists.

And what it deliberately does **not** assert — document age, prose style, whether `code:` still
resolves, whether `updated:` matches git — is argued in [`reference/design.md`](reference/design.md)
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
[`reference/design.md`](reference/design.md) carries the reasoning, the two rejected alternatives,
and the limitations that survived implementation.
