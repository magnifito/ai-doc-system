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

Errors exit 1 and end `[rule]`; warnings print in full, exit 0 unless the project raised them, and
end `[rule, warn]`. The cross-tree half of `link` — a tracked file outside the docs tree naming a
dead path — has no line to point at, so its file reads `(repo)`; `--format github` carries the same
id in `title=`. Under `--base <ref>` two more rules run against the branch's history.

## Remedies by rule id

| Rule | It means | Fix |
|---|---|---|
| `frontmatter` | No `---` block, or YAML the parser rejects. | Add the block with `ai-doc-system new` for a new file, or repair the YAML (quote a value with a colon). |
| `required` | A required field is missing: `title`, `kind`, `status`, `updated`, `module` (when the project configures modules), or a project-required field. | Add it. `kind` and `module` come from `ai-doc-system fix`. |
| `vocabulary` | A value is outside the declared set, a scalar field is written as a list or a map, or stored `kind`/`module` disagrees with what the path implies. | Use a declared `kind`/`status`; `module` from the config; lists for `evidence` and `changes`, a single path for `code`, strings elsewhere. `ai-doc-system fix` restamps `kind`/`module` to match the path; if the path itself is wrong, docs-promote moves the file. |
| `date` | `updated`, `review_by` or `verified_on` is not a real `YYYY-MM-DD` date. | Write the real date. `2026-13-45` is refused. |
| `path` | A directory segment or file name is not kebab-case, or an ALL-CAPS basename is not a declared sentinel or prefix. | Rename the file or directory (two `git mv`s for a case-only rename), or declare it in `sentinels` / `allowedBasenamePrefixes`. |
| `basename` | Two documents in one tier (and module) share a basename. | Rename one, or declare it in `sentinels` if it is a per-folder entry point. |
| `link` | A Markdown link or a tracked file names a document that does not exist case-exactly. | Point at the real file; de-link text whose target never existed. |
| `implements` | The `implements` target is missing. | Point at the live document. |
| `superseded` | `superseded_by` is missing (required when `status: superseded`), or points at a missing file. | Set it, pointing at a file that exists. |
| `evidence` | A path does not exist, a command's first word is not an allowed runner, or the field is not a list. | Fix the path or write `evidence` as a list; add the runner to `evidenceRunners` only if the project trusts it. |
| `changes` | A `changes` target does not exist, is not a `state` document, or the field is not a list. | Point at a live `state` document; write `changes` as a list. |
| `source-url` | `source_url` is not `http(s)://`. | Write the URL. |
| `summary` | `summary` is present but empty, or spans more than one line. | One sentence. |
| `index` | `INDEX.md`, `index.json`, or — where the project configures modules — a module `README.md` or `ROADMAP.md` differs from what the tree generates. | `ai-doc-system gen`. Never edit them by hand. |
| `transition` | Under `--base`: the status moved along an edge the lifecycle does not allow. | Choose an allowed edge (docs-promote lists them), or split the change. |
| `promoted-verbatim` | Under `--base`: `promoted_from` names a document that never existed, still exists, is missing on a cross-tier move, or the body is the origin's word for word. | Use `ai-doc-system mv` for the move, then rewrite the prose for this product. |
| `evidence-lock` | Path evidence changed since `verify` last hashed it, a hashed line vanished, or `<docsDir>/evidence-lock.json` is not valid JSON. | Re-run `ai-doc-system verify --only <path> --stamp`; delete a corrupt lock and re-run `verify`. |
| `shipped-code` | `status: shipped` with no `code:`. | Add a `code:` path, or the status is `active`. |
| `upstream` | The `implements` target has a later `updated` than this document. | Read the target's change; update this document and bump `updated`. |
| `review` | `review_by` is in the past. | Re-verify the claim (docs-audit), then move the date. |
| `updated-drift` | Advisory: the document was committed after the date its `updated:` field claims. | docs-audit. |
| `code-pointer` | Advisory: a `code:` path is gone. | docs-audit. |
| `verification-drift` | Advisory: evidence changed since `verified_on`. | docs-audit. |

## When to touch the severity

`rules: { "<id>": "error" | "warn" | "off" }` in `docs-system.config.json` exists for a project whose
convention genuinely differs — a tree with no lifecycle can set `transition` to `off`. It is not a
way past a red run. If you change a severity, say why in the commit message, and never set a rule
to `off` in the same change that would have tripped it.

## The edit hook

Installed as a plugin, `docs-notary` re-runs the gate on the whole tree after every Write, Edit or
MultiEdit that touches a `.md` file under the docs directory of an adopted tree (`<docsDir>/index.json`
must already exist). It reports the count of errors and warnings, plus up to 20 violation lines. Fix
errors before the next edit; a warning is a thing to go fix, not a reason to stop.

## Before you finish

```bash
ai-doc-system gen && ai-doc-system check    # OK, and the index regenerated in the same change
```
