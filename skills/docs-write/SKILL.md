---
name: docs-write
description: Use when adding a document to, or editing a document in, a repository that already has docs/index.json — a new spec, plan, ADR, runbook, or state document, or a substantive change to an existing one. Creates the file with ai-doc-system new so kind, status, updated and the index are right on the first gate run; explains every frontmatter field an author sets by hand (summary, evidence, code, implements, changes, source_url, review_by) and which the tools own. Not for changing a document's status, tier or place (docs-promote), and not for a red gate (docs-gate).
---

# Write a document

The gate does not care how good the prose is. It cares that the frontmatter tells the truth about
the file's authority, and that the index agents read matches the tree. Hand-written frontmatter is
where most gate failures come from, so the file is created by a command, and the prose by you.

## 1. Create the file with the command, not by hand

```bash
ai-doc-system new docs/<tier>/<name>.md --title "<Title>" --summary "<one line>"
```

Run these as `npx ai-doc-system …` (npm install) or `node scripts/<script>.mjs` (vendored — the script names differ from the command names: `check` is `check-docs.mjs`, `new` is `new-doc.mjs`, `mv` is `mv-doc.mjs`, `gen` is `gen-docs-index.mjs`); a bare
`ai-doc-system` is on PATH only inside an npm script.

It derives `kind` from the path, takes the tier's forced status where the tier has one, else
`--status`, else `draft`, stamps today's `updated`, and regenerates the index. Pick the tier by
authority, not by topic:

- `product/` — what the product does or has committed to do. Read by everyone; the most trusted.
- `engineering/` — how it is built: design records, `engineering/adr/`, runbooks.
- `plans/` — work not yet done. Starts `draft`; goes `active` once agreed, and stays there until
  the work lands.
- `reference/` — captured from elsewhere; **never a commitment**. Forced `status: reference`.
- `archive/` — kept for history. Forced `status: superseded`.

A path under no tier, or a basename with spaces, uppercase or an undeclared sentinel, is refused.
The gate separately rejects two files sharing a basename in one tier.

## 2. The fields an author sets

| Field | Write it when | What the gate checks |
|---|---|---|
| `summary` | Always. One sentence the index shows so an agent can choose without opening the file. | Non-empty, and one line. |
| `evidence` | The document claims a current state (`shipped`, a runbook, a metrics page). A list of `path`, `path:line`, `path:line-line`, or a directory, or a command starting with an allowed runner (`npm test`, `node …`). | Every path exists case-exactly; a command's first word is in `evidenceRunners`. |
| `code` | `status: shipped`, or any document that describes code. **One** path — the file or directory the document is about, not a list. | Not checked by the gate. `shipped` without `code:` warns (`shipped-code`); `ai-doc-system advisory` warns when a `code:` path is gone (`code-pointer`). |
| `implements` | This document realises a plan or spec. One path. | Target exists; if the target's `updated` is later than this file's, `upstream` warns. |
| `changes` | Only where the project's tiers declare a `state` kind: the state document this one alters. A list of paths. | Every path exists **and is kind `state`**. The default tiers produce no `state` kind — leave `changes` unset there. |
| `source_url` | The document was captured from the web. `http(s)://`. | Shape only. A project can make it required on `reference`. |
| `review_by` | The claim goes stale on a date. `YYYY-MM-DD`. | Past date warns until you re-verify and move it. |
| `superseded_by` | Set by docs-promote when a document is retired. | Required when `status: superseded`, and the target must exist. Its own status is unchecked — never point at another superseded file. |

Two fields are the tools' and never yours: `kind` and `module` (derived from the path, stored, and
asserted equal; `ai-doc-system fix` restamps them after a hand-made move), and `promoted_from`
(written by `ai-doc-system mv`). `verified_on` is stamped only by `ai-doc-system verify --stamp`.

## 3. While you write

- **Write the prose for this product.** A document that restates someone else's assumptions is a
  `reference` document, whatever tier you put it in.
- **Link relatively** (`../engineering/design.md`) — that is what renders. The gate resolves
  relative links from the file, and root-relative `<docsDir>/…` from the repo root; both pass, only the
  first opens. Either way it must exist case-exactly. It does not read the target's status — a link
  left pointing at a superseded document is yours to find.
- **`updated:` is yours.** Bump it on a substantive edit. Nothing derives it from git, because the
  git date moves on every whitespace commit. Typos and links do not bump it; `mv` does.
- **A status document without `evidence` is an opinion.** Give the gate a path or a command it can
  check; docs-audit will run it.

## 4. Before you finish

```bash
ai-doc-system gen      # INDEX.md and index.json are generated — never edit them by hand
ai-doc-system check    # must print `check-docs: OK` (a warning count after it is still a pass)
```

A new document ships with its frontmatter and the regenerated index in the same change. If the
document is about code that a change also touches, run `ai-doc-system impact --base <ref>` and
update every document it lists.

## 5. Handing a document to another agent

Use `ai-doc-system context docs/<tier>/<name>.md`, or `context --kind <kind> --status <status>
--max-chars <n>` for a pack, or `ai-doc-system export` for JSONL — never `cat`. `context` puts an
`AUTHORITY:` banner on every document. `export` does not: each JSONL record carries `kind` and
`status`, and whatever consumes it has to read them.
