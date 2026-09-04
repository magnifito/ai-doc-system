---
name: docs-sort
description: Use when documents in a repository with docs/index.json sit in the wrong place or carry no frontmatter — a file another skill or agent wrote under docs/superpowers/ or any path under no tier, a "frontmatter — missing" gate error, an untagged document the index does not list. Not for a document already in the tree that needs a new tier or status (docs-promote).
---

# Sort stray documents

Other tools write documents where they like: superpowers puts plans under `docs/superpowers/plans/`
and designs under `docs/superpowers/specs/`; an agent drops a `NOTES.md` next to the code. The gate
lists them, the index does not, and nothing says how much weight a reader should give them.
Sorting is three things: the right tier, a frontmatter block a command wrote, a regenerated index.

## 1. Find the strays

```bash
docs-notary check --json                          # rule "frontmatter": a document with no block
git ls-files --others --exclude-standard '*.md'     # untracked Markdown anywhere, outside docs/ too
```

Run these as `npx docs-notary …` (npm install) or `node scripts/<script>.mjs` (vendored — the
script names differ from the command names: `check` is `check-docs.mjs`, `mv` is `mv-doc.mjs`,
`gen` is `gen-docs-index.mjs`); a bare `docs-notary` is on PATH only inside an npm script.

The gate walks only the docs directory. A document outside it is invisible to `check`, which is
what the second command is for. A document inside it with a block but under no tier fails
`vocabulary` (`this path is under no tier — move the file`); that is also a stray.

## 2. Pick the tier by authority, not by who wrote it

Read the document. Never file it from its filename or the directory another tool chose.

| The document | Tier | Status |
|---|---|---|
| Work not done yet — a plan, a design for something unbuilt, a spec awaiting agreement | `plans/` | `draft`; `--status active` once agreed |
| How the built thing works — a design record, a decision, a runbook | `engineering/` (`engineering/adr/`, `engineering/runbooks/`) | `active` |
| What the product does or has committed to do | `product/` | `active` |
| Captured from elsewhere — a vendor page, a competitor's spec, a pasted article | `reference/` | forced `reference` |
| Replaced by a newer document | `archive/`, with `superseded_by` | forced `superseded` |

A document you cannot place stays where it is. Tell the user what it is and why it did not fit;
never guess a tier to make the gate green.

## 3. Move and stamp with one command

```bash
docs-notary mv docs/superpowers/plans/<date>-<name>.md docs/plans/<name>.md --adopt --summary "One line."
```

`--adopt` is for a source with no frontmatter. `mv` moves it (`git mv`, or a plain rename for a
file git does not track yet), writes the block — `title` from the first `# ` heading, `kind` from
the destination, the destination tier's forced status, else `--status`, else `draft`, today's
`updated` — and regenerates the index. It records no `promoted_from`: a stray was never a document
of another tier, so `check --base` treats the move as adoption and asks for no prose rewrite. A
source that already has frontmatter needs no `--adopt`; a change of tier or status for a document
already in the tree is docs-promote.

The destination basename must be kebab-case, and no other document in the tier may share it. Drop
a date prefix — `updated` carries the date — and rename a duplicate rather than overwrite it:
`mv` refuses an occupied destination.

## 4. Fields worth setting while the file is open

| Field | Write it when | What the gate checks |
|---|---|---|
| `summary` | Always — `--summary` above. One sentence the index shows so an agent can choose without opening the file. | Non-empty, and one line. |
| `evidence` | The document claims a current state. A list of `path`, `path:line`, `path:line-line`, a directory, or a command starting with an allowed runner (`npm test`, `node …`). | Every path exists case-exactly; a command's first word is in `evidenceRunners`. |
| `code` | The document describes code. **One** path — the file or directory it is about, not a list. | Not checked by the gate. `shipped` without `code:` warns (`shipped-code`); `docs-notary advisory` warns when a `code:` path is gone (`code-pointer`). |
| `implements` | This document realises a plan or spec. One path. | Target exists; if the target's `updated` is later than this file's, `upstream` warns. |
| `changes` | Only where the project's tiers declare a `state` kind: the state document this one alters. A list of paths. | Every path exists **and is kind `state`**. The default tiers produce no `state` kind — leave `changes` unset there. |
| `source_url` | The document was captured from the web. `http(s)://`. | Shape only. |
| `review_by` | The claim goes stale on a date. `YYYY-MM-DD`. | Past date warns until you re-verify and move it. |
| `superseded_by` | The document is replaced. | Required when `status: superseded`; the target must exist. |

`kind`, `module`, `promoted_from` and `verified_on` belong to the tools; `docs-notary fix`
restamps the first two after a hand-made move. `updated` is yours from now on: bump it on a
substantive edit, not on a typo.

## 5. Before you finish

```bash
docs-notary gen
docs-notary check                       # must print `check-docs: OK`
docs-notary check --base <default-branch>   # on a branch: the history-aware rules too
```

A `link` error naming the old path is a link the move broke — point it at the new file. Report
what you moved and where, and every document you left in place with the reason. A red gate for
any other rule is docs-gate.
