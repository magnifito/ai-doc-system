# docs-notary

[![test](https://github.com/magnifito/docs-notary/actions/workflows/test.yml/badge.svg)](https://github.com/magnifito/docs-notary/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/%40puralex%2Fdocs-notary)](https://www.npmjs.com/package/@puralex/docs-notary)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

A documentation system for repositories whose primary reader is an AI agent.
**Website: [magnifito.github.io/docs-notary](https://magnifito.github.io/docs-notary/)**

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
| `check` | The gate. Every violation carries a rule id and a severity; errors exit 1, warnings never do. Wire it in as `lint:docs`. |
| `gen` | Generates `docs/INDEX.md` (humans) and `docs/index.json` (agents, with the `by_code` reverse map). |
| `new <path>` | Writes a document that passes the gate on its first run — `kind` from the path, the tier's forced status where the tier has one, else `--status`, else `draft`, today's date — and regenerates the index. |
| `mv <from> <to>` | The mechanical half of a promotion: `git mv`, restamp `kind`/`module`/`status`, restamp `updated` to today, record `promoted_from`, regenerate. The prose rewrite stays yours. |
| `verify` | Runs command-form `evidence`, hashes path-form evidence into `docs/evidence-lock.json`, and with `--stamp` sets `verified_on`. Explicit invocation only — see below. |
| `impact` | The reverse question: which documents claim the paths this change touched. Advisory, exits 0 (2 only on a malformed `--base`), writes to the GitHub step summary. |
| `context` / `export` | Documents with an `AUTHORITY:` banner inside a budget — whole documents are dropped, never truncated, and the first document is always emitted whole — and the same selection as JSONL (one record per heading) for RAG stores. |
| `advisory` | Non-blocking: dead `code:` pointers, `updated:`-versus-git drift, `state` docs whose code moved after `verified_on`. |
| `fix` | Restamps `kind` and `module` across the tree after a move. |
| `migrate` | One-shot: `git mv` into the tiers, stamp frontmatter, rewrite every tracked reference. Deleted after it runs. |
| `hooks/` | Claude Code plugin hooks — a "not a commitment" reminder when a `reference` doc is read, and the gate's verdict after every doc edit. Neither ever blocks. Both run the engine the host installed (`node_modules/@puralex/docs-notary`); with the scripts only vendored they stay silent. |
| `schema/docs-system.config.schema.json` | JSON Schema for `docs-system.config.json`: editor completion and validation of every key. |
| `scripts/docs-config.mjs` | Per-project configuration, with defaults that need no config file. |
| `scripts/*.test.mjs` | The test suite, over throwaway fixture trees, some of them real git repositories. Wire it in — a suite no runner executes is green exactly once. |
| `skills/` | Five skills an agent picks by situation: `docs-adopt` (first-time setup and migration), `docs-sort` (file and stamp documents other tools wrote), `docs-promote` (promote, move, supersede), `docs-audit` (periodic judgement: advisory, verify, impact), `docs-gate` (fix a red gate). |
| `templates/` | The migration map to fill in, and the `docs/README.md` contract to adapt. |
| `cli/cli.mjs` | Package entry point — `docs-notary init\|new\|mv\|check\|verify\|advisory\|impact\|context\|export\|gen\|fix\|migrate` — for npm-based installs. |
| `docs/` | This repo's own gated tree; `engineering/design.md` is the full design: the problem, the rejected alternatives, and the limitations that survived implementation. |

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
  plans/         # work in flight
  archive/       # replaced                                          status: superseded
```

`kind` is **derived from the path** and mirrored in frontmatter — moving a file between tiers is
what changes its kind: `docs-notary mv` does the move and the restamp together, and `docs-notary
fix` restamps a move made by hand.

Change any of it in `docs-system.config.json`; a project whose answers are the defaults ships no
config file at all.

## Frontmatter

```yaml
---
title: Recurring Invoices             # required
summary: How recurring invoices bill  # optional, one line — rides into the index and every pack
kind: reference                       # required — must equal what the path implies
module: billing                       # required when the project declares modules
status: reference                     # required — reference | draft | active | shipped | superseded
updated: 2026-05-29                   # required — ISO date, bumped by the author of a substantive edit
source_url: https://example.com/docs  # optional — where a captured document came from
---
```

A `title:` or `summary:` containing a colon has to be YAML-quoted; the gate reports the parse
failure, but quoting it up front is cheaper than reading the error.

Optional and validated when present: `implements:`, `code:`, `source_url:`, `review_by:` (an ISO
date that warns once it is in the past), `promoted_from:` (written by `mv`). Required on
`superseded`: `superseded_by:`, whose target must exist.

`kind` and `module` are derived from the path **and** stored, and the gate rejects a document where
the two disagree. Storing them is what lets a document say what it is when it is read outside the
tree; the assertion is what stops the duplicate drifting. After moving files by hand, run
`docs-notary fix` to restamp both.

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

Every violation carries a **rule id** and a severity. Errors fail the run; warnings print in full
and never change the exit code, so a rule can be adopted before it is enforced.

| Rule | Default | Fires when |
|---|---|---|
| `frontmatter` | error | no `---` block outside the exempt list, or one that is not valid YAML |
| `required` | error | a required field is missing or empty — `title`, `status`, `updated`, `kind`, `module`, plus any per-kind `requiredFields` |
| `vocabulary` | error | `status` outside its set, `kind`/`module` disagreeing with the path (in both directions), an unregistered module, a scalar written as a list or map |
| `date` | error | `updated`, `verified_on` or `review_by` is not an ISO date |
| `path` | error | a non-kebab directory, or a basename that is neither kebab-case nor a declared sentinel (`README`, `INDEX`, `STATUS`, `ROADMAP`, `PRD`, …) or programme prefix |
| `basename` | error | two documents in one tier (and module) share a basename — sentinels excepted |
| `link` | error | a dead `.md` link (inline or reference-style) inside the tree, or a dead docs path in a tracked file outside it. Every segment is matched case-exactly, so a rename cannot "pass" on macOS and break on Linux |
| `implements` | error | `implements` names a file that does not exist |
| `superseded` | error | `status: superseded` with no `superseded_by`, or one pointing at nothing |
| `evidence` | error | an `evidence` entry is neither a live path nor a command starting with a known runner |
| `changes` | error | a `changes` entry names something that does not exist, or names a document that is not `kind: state`. A missing `changes` field is `required`, not this |
| `source-url` | error | `source_url` is not an `http(s)` URL |
| `summary` | error | `summary` is present but empty, or spans more than one line |
| `index` | error | `INDEX.md` or `index.json` differs from what the generator would write |
| `transition` | error | **(`--base` only)** a `status` moved along an edge the lifecycle does not have |
| `promoted-verbatim` | error | **(`--base` only)** a "promotion" that copied instead of moving, a cross-tier move with no `promoted_from`, or prose nobody rewrote |
| `evidence-lock` | warn | path evidence changed, or its line vanished, since `verify` hashed it |
| `shipped-code` | warn | `status: shipped` with no `code:` naming the implementation |
| `upstream` | warn | the `implements` target has a later `updated` than the document deriving from it |
| `review` | warn | `review_by` has passed |
| `updated-drift` | warn | *(advisory pass)* the file's last commit is later than its `updated` |
| `code-pointer` | warn | *(advisory pass)* a `code:` pointer no longer resolves |
| `verification-drift` | warn | *(advisory pass)* a `state` document's `code:` changed after its `verified_on` |

Change any severity in `docs-system.config.json` — `{"rules": {"shipped-code": "error", "upstream":
"off"}}` — and `off` drops the rule. One caveat: a document whose frontmatter is missing or
unparseable is skipped by every other check, so `frontmatter: off` silences the message without
restoring the checks behind it.

And what it deliberately does **not** assert — document age, prose style, whether `code:` still
resolves, whether `updated:` matches git — is argued in [`docs/engineering/design.md`](docs/engineering/design.md)
§5.3. A gate that cries wolf gets bypassed.

## Using it

From npm:

```bash
npm install -D @puralex/docs-notary   # brings `yaml` with it
npx docs-notary init                  # greenfield: docs/ contract + index + scripts, gate-clean
npx docs-notary new docs/<tier>/<name>.md --title "Recurring invoices" --summary "How billing recurs"
npx docs-notary mv docs/<tier>/<name>.md docs/<other-tier>/<name>.md   # promote: move, restamp, record
npx docs-notary mv docs/<elsewhere>/<name>.md docs/<tier>/<name>.md --adopt   # sort a stray: move + stamp frontmatter
npx docs-notary gen                   # regenerate INDEX.md and index.json
npx docs-notary check                 # the blocking gate
npx docs-notary check --json          # the same verdict as machine-readable JSON
npx docs-notary check --all           # print every error, not the first 100 (warnings always print in full)
npx docs-notary check --base origin/main    # + the history-aware rules, over what this branch changed
npx docs-notary verify --only docs/<tier>/<name>.md --stamp   # run the evidence, then stamp verified_on
npx docs-notary impact --base origin/main   # which documents claim the changed paths
npx docs-notary context --kind product --status active --max-chars 40000
npx docs-notary export --status shipped > docs.jsonl
npx docs-notary advisory              # non-blocking drift report
npx docs-notary fix                   # restamp kind/module after moves
```

**Upgrade step:** run `docs-notary gen` once after upgrading — `index.json` gains `by_code` and
`INDEX.md` a Summary column, and the `index` rule compares bytes.

`check --base <ref>` resolves the merge base of `<ref>` and `HEAD`, judges only the documents the
branch changed since then (uncommitted work included), and adds the two rules that need history —
`transition` and `promoted-verbatim`. A ref that does not resolve exits 2 rather than quietly
checking less than it says, so on a shallow CI checkout fetch it first.

In CI, `--format github` turns each violation into an annotation on the offending file (there are no
line numbers yet), and `impact` posts the documents a pull request may have falsified into the job
summary:

```yaml
- run: npx docs-notary check --format github --base origin/${{ github.base_ref || 'main' }}
- run: npx docs-notary impact --base origin/${{ github.base_ref || 'main' }}
```

**`verify` is the only command that executes anything written in a document.** Command-form
`evidence` entries are run through the shell; that never happens from `check`, from CI, or from the
hooks — an author invokes it deliberately. **Never run `verify` on a branch you have not read:** an
`evidence:` line is a command a document's author chose, and running it is running their code.
Path-form entries are hashed into `docs/evidence-lock.json` instead, which is what lets the gate
warn (`evidence-lock`) when the evidence under a claim moved.

Configuration is optional. When there is a `docs-system.config.json`, point its `$schema` at the
published schema for editor completion, and use a `key+` suffix to *extend* an array default rather
than replacing it:

```json
{
  "$schema": "https://raw.githubusercontent.com/magnifito/docs-notary/main/schema/docs-system.config.schema.json",
  "evidenceRunners+": ["bazel"],
  "rules": { "shipped-code": "error" }
}
```

Setting both `key` and `key+` is an error — whichever the author meant, key order in the file would
decide it silently.

Or install as a Claude Code plugin and let an agent drive it:

```
/plugin marketplace add magnifito/docs-notary
/plugin install docs-notary@magnifito
```

(Without the plugin system, clone the repo and copy `skills/*` into `~/.claude/skills/`; read
`${CLAUDE_PLUGIN_ROOT}` in the skills as the path of your clone.)

Then, in the target repository, ask for the documentation system; the `docs-adopt` skill runs the
survey and the migration, and the other four take over once `docs/index.json` exists.

By hand, the short version:

```bash
cp /path/to/docs-notary/scripts/*.mjs scripts/
npm install yaml            # or the host's package manager equivalent
cp /path/to/docs-notary/templates/docs-migration.map.example.mjs docs-migration.map.mjs
$EDITOR docs-migration.map.mjs
node scripts/migrate-docs.mjs --dry-run    # iterate until every row is right
node scripts/migrate-docs.mjs --apply
node scripts/gen-docs-index.mjs && node scripts/check-docs.mjs
rm docs-migration.map.mjs scripts/migrate-docs.mjs
```

## It gates itself

This repository runs its own gate on its own documentation, on every push, on Linux, macOS and
Windows. `docs/` here is a real tiered tree: the design record lives in `engineering/`, the
backlog and the implementation plans live in `plans/`, every file carries validated frontmatter,
and `docs/index.json` is regenerated and byte-compared in CI. If the gate ever lets a defect
through, it lets it through here first.

That is not a slogan. During the 2026-09 refactor the gate failed the authors' own commits twice:
once for a JSDoc example that named a docs path that does not exist (in a tracked file, which is
exactly assertion 5b), and once for a CLI usage string that spelled a placeholder path as if it
were real. Then it failed a third time, on the first draft of this very paragraph, which quoted
the placeholder verbatim. All three were caught before the push landed, by the check this package
ships. A tool that cannot survive its own rules has no business enforcing them on yours.

## Provenance

Designed and first applied to a 301-document monorepo in August 2026, where 208 of those documents
were captured from elsewhere and indistinguishable from committed scope until this ran.
[`docs/engineering/design.md`](docs/engineering/design.md) carries the reasoning, the rejected alternatives,
and the limitations that survived implementation.

## License

[Apache-2.0](LICENSE).
