# Documentation

Documents are grouped by **authority** — how much weight a reader should give them — not by topic.
Topic is the second level, inside each tier.

**Agents: read [`index.json`](index.json) first and filter by `kind` and `status`. Never grep this
tree blind.** [`INDEX.md`](INDEX.md) is the same data for humans. Both are generated — run
`node scripts/gen-docs-index.mjs` after adding, moving or restatusing a document; never hand-edit
them.

## The tiers

| Tier | `kind` | What it is |
|---|---|---|
| `reference/` | `reference` | Documentation captured from elsewhere (a competitor, a vendor, a prior product). **Not a commitment, and never a build spec.** Nothing here may be implemented directly — promote it first (below). |
| `product/` | `product` | Committed scope. `ROADMAP.md` is the roadmap of record. |
| `engineering/` | `engineering` | How this repository works. Current and authoritative. `engineering/adr/` holds ADRs (`adr`), `engineering/runbooks/` holds runbooks (`runbook`). |
| `plans/` | `plan` | Work in flight. Group the tier however the project's work is grouped; `plans/done/` is where a plan goes when it genuinely closes. |
| `archive/` | `archive` | Replaced. Everything here is `status: superseded` and names its replacement. |

`kind` is **derived from the path and also stored in frontmatter**; the gate rejects a document
where the two disagree. Moving a file between tiers changes what the path implies — `git mv`, then
`node scripts/fix-docs-frontmatter.mjs` to restamp the stored copy.

## Frontmatter

Every `.md` under `docs/` carries a YAML block. The only exemptions are this file and the generated
`INDEX.md`.

```yaml
---
title: Recurring Invoices   # required
kind: reference             # required — must equal what the path implies
status: reference           # required — reference | draft | active | shipped | superseded
updated: 2026-05-29         # required — ISO date, bumped by the author of a substantive edit
---
```

Optional: `implements:` (what committed scope a plan or product doc serves — its file half must
exist), `code:` (where the implementation lives; omit while unbuilt). Required when
`status: superseded`: `superseded_by:`, whose target must exist.

`status: reference` is legal only under `reference/`, and everything under `reference/` must carry
it. Everything under `archive/` must be `superseded`.

## The promotion lifecycle

```
reference/   →   product/    →   plans/   →   plans/done/
(inspiration)   (committed)     (active)      (shipped)
```

1. `git mv docs/reference/<area>/<feature>/PRD.md docs/product/<feature>.md`
2. Change `status: reference` to `draft`; add `implements: docs/product/ROADMAP.md#<phase>`.
3. **Rewrite the prose to describe this product, not the source it was captured from.** Mandatory —
   promoting a reference document verbatim is how someone else's assumptions become your
   requirements.
4. Add the feature row to `product/ROADMAP.md`.
5. Write the plan in `plans/`, build it, then set `status: shipped` and fill `code:`.

## The gate

The `lint:docs` script (`scripts/check-docs.mjs`) is a blocking step of this project's quality
gate. It asserts frontmatter is present and valid, that `kind` agrees with the path, that status
agrees with the tier, that paths are kebab-case (or ALL-CAPS basenames), that no two documents in
one tier share a basename, that the generated index is fresh, that no Markdown link to a `.md` file
is dead — inside `docs/` and from every tracked file outside it — and that `superseded` names a
live replacement. The `test:scripts` script runs its tests. Advisory-only drift reports (`code:`
pointers, `updated:` versus git) live in `check-docs-advisory.mjs`.

The system this tree implements is `ai-doc-system` — design and rationale in that repository's
`docs/engineering/design.md`.
