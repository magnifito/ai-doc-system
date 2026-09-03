---
title: Technical debt and improvement backlog
kind: plan
status: active
updated: 2026-09-03
---

# Technical debt and improvement backlog

Findings from a full read of the system on 2026-09-03: README, SKILL.md, the design record, every
script and test, CI, templates, and open issues. Baseline at the time: 95 tests passing, gate green,
advisory clean. Items are ranked within each section; the first section is verified defects.

## 1. Defects (verified in a fixture tree)

1. **URLs trip assertion 5b.** A tracked file outside `docs/` that contains
   `https://github.com/magnifito/ai-doc-system/blob/main/docs/engineering/design.md` fails the gate
   with "a tracked file references docs/engineering/design.md, which does not exist". The `git grep`
   pattern and the JavaScript regex in `scripts/check-docs.mjs` (`trackedDocRefs`) match inside
   URLs. Any host repository that links to this project's own docs on GitHub hits it. Fix: drop
   matches whose preceding character is `/`, in both the grep pattern and the post-filter.
2. **Impossible dates pass.** `updated: 2026-13-45` produces no violation. The check in
   `scripts/check-docs.mjs` tests shape (`\d{4}-\d{2}-\d{2}`) only; `verified_on` has the same gap.
   Fix: parse with `Date.UTC` and require a round-trip to the same string.
3. **Case-exact resolution is inconsistent.** Markdown links and `changes` targets go through
   `existsCaseExact`; `implements`, `superseded_by` and `evidence` paths use plain `existsSync`.
   Design section 5.2.3 promises case-exactness so a rename does not pass on macOS and fail on
   Linux. Route all three through the shared `exists` helper.
4. **The design promises an advisory the code lacks.** Design section 4.3 says enforcing `code:`
   on `status: shipped` "belongs to the advisory pass". `scripts/check-docs-advisory.mjs` does not
   report a shipped document without `code:`. Add the report.

## 2. Agent value

5. **`summary:` field, surfaced in `index.json` and `INDEX.md`.** An agent choosing between
   documents has only `title`. One author-written line per document lets it pick without opening
   several files. Optional; validated as a non-empty string when present.
6. **`source_url:` field** (GitHub issue #9). Optional, validated as `http(s)://`, surfaced in the
   index. A project can make it mandatory on captured documents through
   `requiredFields.reference`. Add it to `FIELD_ORDER` in `scripts/docs-frontmatter.mjs`.
7. **`ai-doc-system new <path>` and `ai-doc-system mv <from> <to>`.** `new` writes a document with
   the correct `kind`, the tier-forced status or `draft`, today's `updated`, then regenerates the
   index. `mv` is `git mv`, restamp, regenerate in one step: the mechanical half of the promotion
   lifecycle in SKILL.md section 4. Most gate failures today come from hand-written frontmatter.
8. **Machine-readable gate output.** `check --json` for agents and `--format github` for CI
   annotations (`::error file=…,line=…::`). Same violation list, two renderers.

## 3. Configuration and performance

9. **Array keys replace defaults instead of extending them.** `loadConfig` spreads overrides over
   `DEFAULTS`, so a project that wants one extra `referenceScanExclude` entry must copy all six
   defaults. This repository's own `docs-system.config.json` shows the cost. Support an extension
   form (`"referenceScanExclude+": [...]`) or merge arrays for `referenceScanExclude`, `sentinels`
   and `exempt`.
10. **`EVIDENCE_RUNNERS` is hardcoded** in `scripts/check-docs.mjs`. It lacks `pnpm`, `yarn`,
    `make`, `cargo`, `pytest`, `go`, `just`. Make it a config key (`evidenceRunners`) with the
    current list as the default.
11. **The advisory pass spawns one `git log` per document.** `lastCommitDate` in
    `scripts/docs-fs.mjs` is called once per document and again per `state` document's `code:`
    path. Three hundred documents means several hundred subprocesses. One
    `git log --name-only --format=%ad --date=short` walk can fill a path-to-date map in a single
    call.
12. **Ship a JSON Schema for `docs-system.config.json`** so editors validate keys and shapes before
    the loader does, and reference it from the README.

## 4. Dogfooding and documentation

13. **The "Reversal, 2026-08-23" note in design section 4.1 is an ADR living inside a design
    document.** Move it to `docs/engineering/adr/0001-store-kind-in-frontmatter.md` so this
    repository's own tree exercises the `adr` tier.
14. **`CONTRIBUTING.md` hardcodes "95 tests".** The number drifts with every added test. Remove it.

## Order of work

Items 1 to 4 first: small, testable, no design change. Then 7 and 5, which change what agents do
every day. Then 9 to 12. Items 13 and 14 whenever the design record is next touched.
