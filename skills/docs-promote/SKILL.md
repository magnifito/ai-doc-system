---
name: docs-promote
description: Use when a document in a repository with docs/index.json must change authority or place — promote a captured reference document into product or engineering scope, move a file between tiers, take a plan from draft to active to shipped, supersede a document with a newer one, or retire one to archive. Drives ai-doc-system mv and the status transition rules that check --base enforces, and insists on the prose rewrite no command can do. Not for creating a document (docs-write) or a red gate (docs-gate).
---

# Promote, move, or retire a document

Authority is not a folder. A document's tier and status say how much weight a reader gives it, so
a move is a claim, and `check --base` verifies the claim against the branch's history.

## 1. Nothing in `reference/` may be implemented directly

Installed as a plugin, `docs-notary`'s `reference-read` hook says so on every Read of a document
whose status is `reference`: not a commitment, never a build spec, and here is the `mv` that
promotes it. Promote it first, then **rewrite the prose to describe this product**:

```bash
ai-doc-system mv docs/reference/<name>.md docs/product/<name>.md
```

Run these as `npx ai-doc-system …` (npm install) or `node scripts/<script>.mjs` (vendored — the script names differ from the command names: `check` is `check-docs.mjs`, `new` is `new-doc.mjs`, `mv` is `mv-doc.mjs`, `gen` is `gen-docs-index.mjs`); a bare
`ai-doc-system` is on PATH only inside an npm script.

`mv` is `git mv` plus a restamp: it sets `kind` and `module` for the destination, and sets `status`
to the destination tier's forced status if it has one, else `--status`, else `draft` when leaving
`reference`, else the status the document already had. `product/` forces nothing and no `--status`
is passed above, so this example lands on `draft` — the `reference → draft` edge. `mv` also sets
`updated` to today (a promotion is a substantive change and the rewrite is mandatory) and records
`promoted_from`. That field is what lets `check --base` tell a promotion from a copy. A bare
`git mv` across tiers records no `promoted_from` and fails `promoted-verbatim` under `check --base`.

Then rewrite. Promoting a captured document verbatim is how someone else's assumptions become your
requirements. `check --base <ref>` compares the promoted body with the origin's body before the
branch and fails `promoted-verbatim` when they are identical. Rewriting the prose is the half no
command can do.

## 2. Status transitions the gate allows

`check --base <ref>` compares each changed document's status with its status at the merge base and
allows only these edges. Any other edge is a `transition` error.

| From | To |
|---|---|
| `reference` | `draft`, `superseded` |
| `draft` | `active`, `superseded` |
| `active` | `shipped`, `superseded`, `draft` |
| `shipped` | `superseded` |
| `superseded` | nothing |

An unchanged status is always legal. A status the project added in its config is in no graph and
moves freely. `reference/` forces `reference`; `archive/` forces `superseded`.

- **`draft` → `active`**: the work is agreed. Bump `updated`.
- **`active` → `shipped`**: convention, not enforcement — name the paths in `code:` and give
  `evidence:` the gate can check anyway; `shipped` without `code:` only warns (`shipped-code`), and
  the gate requires `evidence:` on no kind by default. Never ship on the strength of the plan's own
  "done" prose; if in doubt, docs-audit runs `verify` first.
- **`active` → `draft`**: the plan was reopened. Say why in the body.

## 3. Supersede, then archive

When a newer document replaces an older one:

1. Set `superseded_by: docs/<tier>/<new-name>.md` on the old file. Leave `status` alone —
   `superseded` outside `archive/` is a `vocabulary` error.
2. Move it: `ai-doc-system mv docs/<tier>/<old-name>.md docs/archive/<old-name>.md`. The
   `archive/` tier forces `status: superseded`. The prose stays as it was — an archived document is
   a record, and `check --base` owes it no rewrite.
3. Fix every link that pointed at it — the gate will not catch these; `link` only fails a target
   that is missing.

A document whose own first line says SUPERSEDED belongs in `archive/` whatever its frontmatter
says. A "closed" plan that still lists untaken steps is a live backlog and stays `active`.

## 4. Moves within a tier and hand-made moves

A rename inside one tier keeps status and needs no `promoted_from`; `mv` handles it, and sets
`updated` to today as it does on any move. After a move made by hand, `ai-doc-system fix` restamps
`kind` and `module` — the gate asserts they agree with the path. Renaming for case alone needs
**two** `git mv`s through a temporary name on macOS and Windows.

## 5. Before you finish

```bash
ai-doc-system gen
ai-doc-system check --base <default-branch>   # transition + promoted-verbatim run only here
ai-doc-system impact --base <default-branch>  # documents whose claims cover the changed code
```

Update every link the move broke, then every document `impact` lists. A red gate is docs-gate.
