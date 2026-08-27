# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.2.0]: https://github.com/magnifito/ai-doc-system/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/magnifito/ai-doc-system/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/magnifito/ai-doc-system/releases/tag/v1.0.0
