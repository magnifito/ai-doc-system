---
name: docs-gate
description: Use when ai-doc-system check fails or warns — "check-docs FAILED", a GitHub annotation from check --format github, the plugin's edit hook reporting errors after a Write or Edit, or CI red on lint:docs. Reads the rule id in brackets, applies the one remedy that fixes the cause, and never silences a rule to make CI pass. Not for creating (docs-write), moving (docs-promote) or reviewing (docs-audit) documents.
---

# Fix a red gate

Every violation ends with a rule id in brackets: `docs/<tier>/<name>.md:field — reason [rule]`. The
id is the key to this table. Fix the cause the row names; do not edit the index by hand, and do not
change a rule's severity to get a green run.

```bash
ai-doc-system check --json     # the same list, one object per violation, for a long run
```

Errors exit 1. Warnings print in full and exit 0 unless the project raised them. Under
`--base <ref>` two more rules run against the branch's history.

## Remedies by rule id

| Rule | It means | Fix |
|---|---|---|
| `frontmatter` | No `---` block, or YAML the parser rejects. | Add the block with `ai-doc-system new` for a new file, or repair the YAML (quote a value with a colon). |
| `required` | A required field is missing: `title`, `kind`, `status`, `updated`, or a project-required field. | Add it. `kind` and `module` come from `ai-doc-system fix`. |
| `vocabulary` | A value is outside the declared set, or a field has the wrong shape (a list where a string belongs). | Use a declared `kind`/`status`; `module` from the config; lists for `evidence`, `code`, `changes`; strings elsewhere. |
| `date` | `updated`, `review_by` or `verified_on` is not a real `YYYY-MM-DD` date. | Write the real date. `2026-13-45` is refused. |
| `path` | Stored `kind` or `module` disagrees with the path. | `ai-doc-system fix` restamps both. If the path is wrong, docs-promote moves the file. |
| `basename` | Not kebab-case, duplicate basename in one tier, or an undeclared ALL-CAPS name. | Rename (two `git mv`s for a case-only rename), or declare the sentinel in the config. |
| `link` | A Markdown link or a tracked file names a document that does not exist case-exactly, or a superseded one. | Point at the real file; de-link text whose target never existed; follow `superseded_by`. |
| `implements` | The `implements` target is missing or superseded. | Point at the live document. |
| `superseded` | `superseded_by` is missing, points at a missing file, or at a superseded one. | Set it on every `superseded` document; follow the chain to a live target. |
| `evidence` | A path does not exist, a `:line` is out of range, or a command's first word is not an allowed runner. | Fix the path or line; add the runner to `evidenceRunners` only if the project trusts it. |
| `changes` | A `changes` entry is missing or unresolvable. | Point at the real file. |
| `source-url` | `source_url` is not `http(s)://`, or is required on this tier and absent. | Write the URL. |
| `summary` | `summary` is present but empty or not a string. | One sentence. |
| `index` | `INDEX.md` or `index.json` differs from what the tree generates. | `ai-doc-system gen`. Never edit them by hand. |
| `transition` | Under `--base`: the status moved along an edge the lifecycle does not allow. | Choose an allowed edge (docs-promote lists them), or split the change. |
| `promoted-verbatim` | Under `--base`: `promoted_from` names a document that never existed, still exists, is missing on a cross-tier move, or the body is the origin's word for word. | Use `ai-doc-system mv` for the move, then rewrite the prose for this product. |
| `evidence-lock` | Path evidence changed since `verify` last hashed it, a hashed line vanished, or `docs/evidence-lock.json` is not valid JSON. | Re-run `ai-doc-system verify --only <path> --stamp`; delete a corrupt lock and re-run `verify`. |
| `shipped-code` | `status: shipped` with no `code:`. | Add the paths, or the status is `active`. |
| `upstream` | The `implements` target has a later `updated` than this document. | Read the target's change; update this document and bump `updated`. |
| `review` | `review_by` is in the past. | Re-verify the claim (docs-audit), then move the date. |
| `updated-drift` | Advisory: `code:` paths changed after `updated`. | docs-audit. |
| `code-pointer` | Advisory: a `code:` path is gone. | docs-audit. |
| `verification-drift` | Advisory: evidence changed since `verified_on`. | docs-audit. |

## When to touch the severity

`rules: { "<id>": "warn" | "off" }` in `docs-system.config.json` exists for a project whose
convention genuinely differs — a tree with no lifecycle can set `transition` to `off`. It is not a
way past a red run. If you change a severity, say why in the commit message, and never set a rule
to `off` in the same change that would have tripped it.

## The edit hook

Installed as a plugin, `docs-notary` re-runs the gate after every Write or Edit under the docs
directory of an adopted tree and reports the count of errors and warnings. Fix errors before the
next edit; a warning is a thing to go fix, not a reason to stop.

## Before you finish

```bash
ai-doc-system gen && ai-doc-system check    # OK, and the index regenerated in the same change
```
