# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-09-03

### Added

- Every gate and advisory finding now carries a rule id — `frontmatter`, `required`,
  `vocabulary`, `date`, `path`, `basename`, `link`, `implements`, `superseded`,
  `evidence`, `evidence-lock`, `changes`, `source-url`, `summary`, `index`,
  `transition`, `promoted-verbatim`, `shipped-code`, `upstream`, `review`, and the
  advisory-only `updated-drift`, `code-pointer`, `verification-drift` — and a `rules`
  block in `docs-system.config.json` re-severities any of them to `error`, `warn` or
  `off`.
- Frontmatter fields `summary` (the one line the index shows), `source_url` (the
  upstream a document was read from), `review_by` (a date the gate warns past) and
  `promoted_from` (the document a promotion came from).
- Commands `new`, `mv`, `impact`, `verify`, `context` and `export`. `new` writes a
  gate-clean document (`--title`, `--summary`, `--status`); `mv` does git mv plus
  restamp plus regenerate (`--status`); `impact` lists the documents whose claims
  cover the changed paths (`--base`, `--json`); `verify` runs command evidence and
  hashes path evidence (`--only`, `--stamp`); `context` prints selected documents
  behind an authority banner within a budget (`--kind`, `--status`, `--module`,
  `--max-chars`, plus document paths), and `export` is the same selection as one
  JSON record per heading (`--jsonl`).
- `check --json` (a machine-readable report), `check --format github` (workflow
  commands that annotate a pull request) and `check --base <ref>`, which adds the
  two history-aware assertions — `transition` and `promoted-verbatim` — over the
  documents the branch changed since it forked.
- `by_code` in `docs/index.json`: a reverse map from a repository path to the
  documents whose `code:` or `evidence:` name it.
- Claude Code plugin hooks (`hooks/hooks.json`): a `Read` hook that reminds an agent
  what authority a reference document carries, and a `Write|Edit|MultiEdit` hook that
  reports gate errors and warnings on the document just edited.
- A JSON schema for the config (`schema/docs-system.config.schema.json`), so an editor
  completes and validates `docs-system.config.json` from its `$schema` key.
- `evidenceRunners` — the closed set of command names an `evidence:` entry may start
  with, so free prose stays rejected while a project's own runner can be added.
- Array settings extend rather than replace with a `+` suffix: `evidenceRunners+`,
  `referenceScanExclude+` and `sentinels+` append to the shipped defaults, so an
  upgrade's new entries still arrive.
- `docs/evidence-lock.json`, written by `verify`: the hash of every path evidence
  entry at the moment it was verified, which the gate later compares to warn on drift.
- `docs:impact` in the scripts `init` wires into the host `package.json`.
- An ADR under docs/engineering/adr/ recording why `kind` is stored in frontmatter as
  well as derived from the path.

### Changed

- `docs/INDEX.md` gains a Summary column.
- The advisory pass reads the history in one git walk instead of one per document.
- `docs-system.config.json` may use `+` keys; setting both `key` and `key+` is an
  error rather than a silent key-order decision.
- `cli/cli.mjs` strips the command word before delegating, so a script invoked
  through the CLI sees exactly the arguments direct invocation gives it.
- `context` and `export` reject a positional that is not a `.md` document, and an
  unknown flag or a flag missing its value, with exit 2 — a filter that quietly
  disappeared used to dump the whole tree.

### Fixed

- URLs in tracked files no longer trip the tracked-reference scan: a
  `https://…/docs/x.md` link is stripped before the scan looks for repository paths.
- Impossible dates (`2026-02-30`) are rejected; the check is calendar-aware, not a
  shape match.
- `implements`, `superseded_by` and `evidence` resolve case-exactly, so a reference
  that only works on a case-insensitive filesystem fails everywhere.
- `status: shipped` without a `code:` pointing at the implementation is reported
  (a warning — a blocking rule would invite placeholder paths).

## [1.2.0] - 2026-08-27

### Added

- `ai-doc-system init` — greenfield setup in one command: writes the `docs/README.md` contract,
  wires `lint:docs` / `lint:docs:advisory` / `gen:docs-index` into the host `package.json` without
  clobbering existing scripts, and generates the index so `check` passes immediately. Idempotent.
- Claude Code plugin packaging: `.claude-plugin/plugin.json` and a self-hosted marketplace
  (`/plugin marketplace add magnifito/ai-doc-system`).
- npm provenance attestation on published packages.
- CI: pack-smoke job installs the packed tarball into a fresh fixture repo and runs the CLI from
  `node_modules`; test matrix covers Node 20/22/24 on Linux and Node 20 on macOS and Windows.

### Changed

- Package entry point moved from `bin/cli.mjs` to `cli/cli.mjs` (`bin/` is a reserved directory
  for Claude Code plugins). The `ai-doc-system` command is unchanged.

## [1.1.0] - 2026-08-27

### Added

- npm packaging as `@puralex/ai-doc-system` with the `ai-doc-system` CLI
  (`check`, `advisory`, `gen`, `fix`, `migrate`).
- Advisory results append to `GITHUB_STEP_SUMMARY` when set.
- CI across ubuntu, macos and windows; the repo dogfoods its own gate.
- Apache-2.0 license.

### Fixed

- Windows: CRLF-tolerant index freshness compare, plus `.gitattributes` forcing LF.
- Windows: direct-run detection via `pathToFileURL` instead of string comparison.
- `fix-docs-frontmatter.mjs` patches raw frontmatter lines instead of re-rendering, preserving
  nested keys byte-for-byte.
- `migrate-docs.mjs` stamps `kind` and `module` from the destination path, so migrated trees pass
  the gate without a second pass.

## [1.0.0] - 2026-08-25

### Added

- Docs tiered by authority (`reference/`, `product/`, `engineering/`, `plans/`, `archive/`) with
  validated YAML frontmatter and a closed status vocabulary.
- Generated `docs/INDEX.md` and `docs/index.json`.
- Blocking gate `check-docs.mjs` (nine assertions) and non-blocking advisory checks.
- One-shot migration with reference rewriting; per-project `docs-system.config.json`.
- Optional module axis with `state` / `todo` kinds (`evidence` / `changes` validation).
- `SKILL.md` agent procedure.

[1.3.0]: https://github.com/magnifito/ai-doc-system/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/magnifito/ai-doc-system/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/magnifito/ai-doc-system/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/magnifito/ai-doc-system/releases/tag/v1.0.0
