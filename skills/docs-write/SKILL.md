---
name: docs-write
description: Use when adding a document to, or editing a document in, a repository that already has docs/index.json — a new spec, plan, ADR, runbook, or state document, or a substantive change to an existing one. Creates the file with ai-doc-system new so kind, status, updated and the index are right on the first gate run; explains every frontmatter field an author sets by hand (summary, evidence, code, implements, changes, source_url, review_by) and which the tools own. Not for moving, promoting or retiring a document (docs-promote) and not for a red gate (docs-gate).
---

# Write a document

The gate does not care how good the prose is. It cares that the frontmatter tells the truth about
the file's authority, and that the index agents read matches the tree. Hand-written frontmatter is
where most gate failures come from, so the file is created by a command, and the prose by you.

## 1. Create the file with the command, not by hand

```bash
ai-doc-system new docs/<tier>/<name>.md --title "<Title>" --summary "<one line>"
```

It derives `kind` from the path, takes the tier's forced status where the tier has one, else
`--status`, else `draft`, stamps today's `updated`, and regenerates the index. Pick the tier by
authority, not by topic:

- `product/` — what the product does or has committed to do. Read by everyone; the most trusted.
- `engineering/` — how it is built: design records, `engineering/adr/`, runbooks.
- `plans/` — work not yet done. `active` until the work lands.
- `reference/` — captured from elsewhere; **never a commitment**. Forced `status: reference`.
- `archive/` — kept for history. Forced `status: superseded`.

A `kind` the project does not declare, or a basename with spaces, uppercase or an undeclared
sentinel, is refused. Kebab-case, one basename per tier.

## 2. The fields an author sets

| Field | Write it when | What the gate checks |
|---|---|---|
| `summary` | Always. One sentence the index shows so an agent can choose without opening the file. | Non-empty string. |
| `evidence` | The document claims a current state (`shipped`, a runbook, a metrics page). A list of `path`, `path:line`, or a command starting with an allowed runner (`npm test`, `node …`). | Every path exists case-exactly; a command's first word is in `evidenceRunners`. |
| `code` | `status: shipped`, or any document that describes code. A list of paths the document is about. | Paths exist. `shipped` without `code:` warns. |
| `implements` | This document realises a plan or spec. One path. | Target exists; if the target's `updated` is later than this file's, `upstream` warns. |
| `changes` | A plan or ADR that alters another document. A list of paths. | Every path exists. |
| `source_url` | The document was captured from the web. `http(s)://`. | Shape only. A project can make it required on `reference`. |
| `review_by` | The claim goes stale on a date. `YYYY-MM-DD`. | Past date warns until you re-verify and move it. |
| `superseded_by` | Set by docs-promote when a document is retired. | Target exists and is not itself superseded. |

Two fields are the tools' and never yours: `kind` and `module` (derived from the path, stored, and
asserted equal; `ai-doc-system fix` restamps them after a hand-made move), and `promoted_from`
(written by `ai-doc-system mv`). `verified_on` is stamped only by `ai-doc-system verify --stamp`.

## 3. While you write

- **Write the prose for this product.** A document that restates someone else's assumptions is a
  `reference` document, whatever tier you put it in.
- **Link with root-relative paths** (`docs/<tier>/<name>.md`). The gate resolves every link
  case-exactly and fails a link to a file that does not exist or to a superseded document.
- **`updated:` is yours.** Bump it on a substantive edit. Nothing derives it from git, because the
  git date moves on every whitespace commit. Typos and links do not bump it.
- **A status document without `evidence` is an opinion.** Give the gate a path or a command it can
  check; docs-audit will run it.

## 4. Before you finish

```bash
ai-doc-system gen      # INDEX.md and index.json are generated — never edit them by hand
ai-doc-system check    # must print check-docs: OK; anything else is docs-gate
```

A new document ships with its frontmatter and the regenerated index in the same change. If the
document is about code that a change also touches, run `ai-doc-system impact --base <ref>` and
update every document it lists.

## 5. Handing a document to another agent

Use `ai-doc-system context docs/<tier>/<name>.md`, or `context --kind <kind> --status <status>
--max-chars <n>` for a pack, or `ai-doc-system export` for JSONL — never `cat`. Both put the
`AUTHORITY:` line on every document, so a `reference` document that leaves the tree still says it
is not a commitment.
