# Design: a documentation system for agent-built repositories

- **Status:** implemented, and in use
- **Scope:** everything under a repository's `docs/`, plus stray Markdown at its root
- **Not in scope:** the content of any individual document, and any audit of whether a plan's claims are true

---

## 1. Problem

A mature repository's `docs/` holds hundreds of Markdown files. They are unnavigable by machine and
misleading by accident. An agent that greps the tree for a feature name finds a confident,
well-written product requirements document and cannot tell whether it describes something the
product **has**, something it has **decided to build**, or something a competitor has that it may
**never** build.

That is not a tidiness complaint. It is a correctness problem: the tree's default failure mode is an
agent implementing an uncommitted feature from a document that was never a commitment.

### 1.1 The shape of the evidence

The tree this was designed against held 301 Markdown files. The survey that motivated the design is
worth repeating on any candidate repository, because the same six defects recur:

| Population | Files | Last touched |
|---|---:|---|
| Feature documents captured from a competitor | 208 | frozen, first half of the year |
| Engineering docs, plans, runbooks, ADRs, archive | 93 | moved within the last two weeks |

**The staleness split is the strongest signal in a survey.** Every captured tree was frozen; every
engineering tree had moved recently, with nothing in between. Two different kinds of artifact
happened to share a directory. If a candidate repository shows that split, tiering is the right
answer; if it does not, be much less sure.

The specific defects, all of which the system removes:

1. **No metadata.** 2 files of 301 had YAML frontmatter. 11 had a `## Current State` section. 74
   mentioned a `**Status` line, in no consistent format. There was no machine-readable way to ask
   what any document was or whether it was current.

2. **Duplicate topic trees under two naming conventions** — `calendars_and_appointments/` (12 files)
   beside `calendars-appointments/` (10 files), holding *disjoint* subtopics rather than copies. So
   the fix is a merge, not a deletion, and a migration that assumes copies will destroy content.

3. **Paths that break shell globbing** — `Reporting/Tracking & Attribution/`, `sites/General Setup/`,
   seven sibling `Snake_Case` directories. During the survey a routine `find | head` loop failed on
   exactly these paths.

4. **No root index.** 46 scattered `README.md` and `INDEX.md` files, none linking to another tree.
   Entry into the documentation set was by guessing a directory name.

5. **A 1745-line roadmap competing with 208 per-feature documents.** The file named `PRD.md` was not
   a PRD; it was the roadmap of record, and the only document in the repository that attempted to
   answer "is this built". Its third line was a single run-on paragraph containing roughly forty
   `→ X ✅ Complete` clauses appended over six months.

6. **Stray root files** — handover notes committed at the repository root and never filed.

---

## 2. Decisions taken before designing

Four questions were settled with the repository's owner first. They constrain everything below, and
they are the questions to ask before applying this anywhere else.

| Question | Decision | Consequence |
|---|---|---|
| Who is the primary reader? | **AI agents building the platform.** Humans second. | Machine-readable metadata and a generated index beat prose navigation. |
| What are the captured feature documents? | **A reference library, not a commitment.** Only a subset will ever ship. | The system must make "not a commitment" machine-detectable, and must not delete them. |
| Should doc hygiene be enforced? | **Yes — a blocking check in the push gate.** | A script, with tests, wired in as a documented exception. |
| Which architecture? | **Tiered `docs/` with frontmatter and a generated index** (approach A of three). | Promotion between tiers is a `git mv`, so history survives. |

The two rejected approaches, recorded so the trade-off stays reviewable:

- **B — move reference docs out of `docs/` entirely** (separate tree or submodule). Cheaper: metadata
  applied to 93 files instead of 301. Rejected because promoting a reference document into a
  committed spec would cross a repository boundary instead of being one `git mv`, and the promotion
  path is the feature that makes the reference library worth keeping.
- **C — a hand-written index and nothing else.** The check would verify only that every file appears
  in the index exactly once and every indexed path exists. Genuinely useful against orphans and
  duplicates, and very cheap. Rejected because status stays invisible: an agent still cannot
  distinguish shipped from aspirational without reading prose, which is the original problem.

---

## 3. Architecture

### 3.1 The tree

Documents are grouped by **authority** — how much weight a reader should give them — rather than by
topic. Topic remains the second level, inside each tier.

```
docs/
  README.md           # hand-written. How this system works. ~40 lines.
  INDEX.md            # GENERATED. Human-readable table of every document.
  index.json          # GENERATED. Agent entry point. Flat array of every doc.

  reference/          # Captured from elsewhere. NEVER a build spec.
  product/            # Committed scope. What the product will actually have.
    ROADMAP.md
  engineering/        # How this repository works. Current, authoritative.
    architecture/
    adr/
    runbooks/
  plans/              # Work in flight.
    done/             # closed plans
    specs/            # design output
  archive/            # Superseded. Present in the index like everything else —
                      # agents filter it out by status.
```

Tiers are configurable (`docs-system.config.json`), but the *principle* is not: group by authority,
not by topic. A topic folder cuts across tiers and reintroduces the ambiguity the system exists to
remove.

### 3.2 Renames that remove the glob-breaking paths

Every move uses `git mv`, so `git log --follow` continues to work on each file. The classes to
expect:

| From | To |
|---|---|
| `docs/Reporting/` | `docs/reference/reporting/` |
| `docs/Reporting/Tracking & Attribution/` | `docs/reference/reporting/tracking-attribution/` |
| `docs/sites/General Setup/` | `docs/reference/sites/general-setup/` |
| `docs/sites/SEO/Backlink_Analysis/` and siblings | `docs/reference/sites/seo/backlink-analysis/` |
| `docs/topic_with_underscores/*` | merged into the kebab-case sibling, subdirectories kebab-cased |

### 3.3 Root strays

Root-level Markdown that does not belong at the root is **reported, never moved automatically**.
Each one needs a human to read it first: a file called `MIGRATION.md` at the root may be a different
document from `plans/legacy-port/MIGRATION.md`, and a "closeout" may turn out to be a live backlog.
No blind overwrite, and no guess at a destination.

### 3.4 Files needing a human judgement call

List them rather than guessing. Each is presented for a decision during implementation — a spec for
a real surface that may be current or superseded, a plan whose completion nobody has verified, and
the design bundle for this system itself if it lives inside the tree being migrated.

---

## 4. Metadata

### 4.1 Schema

YAML frontmatter on every `.md` under `docs/`, except two exempt files: `INDEX.md` (generated) and
`docs/README.md` (the hand-written preface). `index.json` is not Markdown and never enters the walk.

```yaml
---
title: Recurring Invoices     # string, required
status: reference             # enum, required — see 4.3
updated: 2026-05-29           # ISO date, required — see 4.6 for who maintains it
---
```

`kind` is **derived from the path and also stored** (§4.2), and the gate asserts the two agree.

> **Reversal, 2026-08-23.** This section used to forbid a `kind:` field, on the argument that
> storing a derived value duplicates what the path already says and buys one assertion class whose
> only job is to check the duplication. That argument weighed the wrong cost. A document is
> routinely read **outside its tree** — pasted into a conversation, handed to an agent as a blob,
> opened from a search result — and in that setting a path-derived field is simply absent. The
> document then cannot say what it is. Self-containment is worth one cheap assertion, and a
> duplicate that is machine-checked on every push cannot drift. The price is that `git mv` alone no
> longer re-tiers a file; `fix-docs-frontmatter.mjs` restamps a whole move in one command.

Documents in `product/` or `plans/` may carry two additional fields:

```yaml
implements: docs/product/ROADMAP.md#6.4   # optional — what committed scope this serves
code: apps/web/app/api/invoices/          # optional — omit while unbuilt
```

`implements` is optional everywhere — a requirement the migration cannot honestly derive for existing
files would be stamped as a lie — but when present, its file half must exist (§5.2.2).

Documents of `status: superseded` carry one additional field:

```yaml
superseded_by: docs/product/invoices.md   # required, and the target must exist
```

### 4.2 `kind` — derived from the path, and stored

Kind is computed from the tier a file lives in, with nested tiers matched before the tier that
contains them. A tier prefix may hold a single `*` standing for exactly one path segment, so a
project can group by something else first — `modules/*/state/` — and still derive kind from the
tier segment inside it.

It appears in `index.json`, and in frontmatter, and the gate rejects a document where the two
disagree. Moving a file between tiers changes its kind; run `fix-docs-frontmatter.mjs` afterwards to
restamp the field.

### 4.2a `module` — the optional second axis

A project may declare a closed set of `modules` in its configuration, each with a `class` (`core`,
`anchor` or `addon`) and a `requires` list. Documents then live under `<moduleRoot><key>/<tier>/`,
`module` is derived the same way `kind` is, stored the same way, and asserted the same way. A
project that declares no modules is unaffected: every module assertion passes vacuously.

Two families are what make the axis worth having:

| Kind | Means | Extra required fields |
|---|---|---|
| `state` | Reflection. What the system IS today. | `verified_on`, `evidence` |
| `todo` | Wishlist. What we want. | `commitment`, `changes` |

Which kind demands which fields is configuration (`requiredFields`), not a constant in the scripts.

`evidence` is the one field whose **value** the gate inspects: each entry is either a repository
path that exists, optionally with `:line`, or a command a reader can re-run. Free prose is rejected,
because an unevidenced claim is indistinguishable from a stale one — and a stale claim that nothing
checks is the failure this whole system exists to prevent.

`archive` is its own kind: an archived engineering doc and an archived plan share a lifecycle
(`superseded`), and pretending they are still `plan`s would misclassify half of them.

### 4.3 `status` — a closed set

| Value | Meaning | Who has it initially |
|---|---|---|
| `reference` | Captured from elsewhere. **Not a commitment. Never implement from this file.** | everything in `reference/` |
| `draft` | Being written; not yet agreed | new specs |
| `active` | Agreed and current. Build from this. | engineering docs, live plans, the roadmap |
| `shipped` | Built and verified. `code:` points at the implementation. | `plans/done/` |
| `superseded` | Replaced. `superseded_by:` names the replacement. | everything in `archive/` |

The value that earns the whole schema is `reference`. It converts hundreds of ambiguous
half-commitments into an explicitly non-binding idea bank, and it is checkable by machine.

Both sets are closed and validated. A misspelled status is rejected rather than silently stored.

Status and tier are tied where only one value is honest: everything under `reference/` must be
`status: reference` (and `reference` is legal nowhere else — promotion means leaving the tier), and
everything under `archive/` must be `status: superseded`. The gate enforces both directions.

One softness, stated rather than hidden: the gate does **not** require `code:` on `shipped` — the
table's "`code:` points at the implementation" is the convention, not an assertion. Enforcing it
belongs to the advisory pass (§5.3), because a blocking rule here would just invite placeholder
paths.

### 4.4 Applying metadata to an existing tree

A one-shot `migrate-docs.mjs`, driven by a per-project map, deleted after the migration commit. It
derives:

- `title` from the first `#` heading, falling back to the filename stem
- `updated` from `git log -1 --format=%ad --date=short -- <file>`
- `status` from the destination tier

Three safety properties, each of which the first draft of this design lacked:

1. **Existing frontmatter is preserved.** Files that already have a block may carry lists and nested
   keys a minimal parser cannot read; the migration keeps those lines untouched and appends only
   missing required fields. It never rewrites a block it cannot fully represent.
2. **Destination collisions abort before the first `git mv`.** Two sources mapping to one
   destination, or a destination already occupied, is reported and nothing moves — a merge of two
   topic trees stays safe even if they stop being disjoint. Deliberately over-cautious: a move chain
   (a → b while b → c) also aborts rather than being ordered.
3. **Tracked references are rewritten, and previewed.** Candidates come from `git grep -Il` over the
   whole tracked tree — extensionless files included, binaries skipped, the same population §5.2.5
   later polices. Every root-relative docs path is rewritten in the same run; `--dry-run` prints the
   exact file list first. Relative links that cross tiers are the remainder, and §5.2.5 catches them.

Documents in the reference tier can be accepted as derived. Everything in `engineering/`, `plans/`
and `product/` is hand-reviewed, because that is where a derived status can be wrong.

### 4.5 Dropping a roadmap's status line

A roadmap whose header has accumulated a forty-clause status paragraph loses it, replaced by
`status: active` in frontmatter plus a `Last verified:` date. Per-feature status already lives in the
phase tables below it, which is the correct home. Nothing is lost; an unreadable paragraph is
removed.

### 4.6 Who maintains `updated:`

The author of a substantive edit bumps it, the same way they would a changelog line. It is seeded
from `git log` once, by the migration, and never again derived automatically: regenerating it from
git at index time would stale the index on every commit that touches a doc, and blocking on
frontmatter-versus-git drift would punish typo fixes. So the contract is honest and small: `updated`
means "last substantive change, per the author", and the advisory pass reports drift without blocking
anything.

---

## 5. The gate

### 5.1 Placement

`check-docs.mjs`, exposed as `lint:docs`, wired into the host project's blocking gate. It is
filesystem reads plus one `git grep`, costing well under a second for a few hundred files, so place
it early — before the expensive typecheck and test steps.

If `git grep` fails for any reason other than "not a git repository", the check degrades to scanning
`AGENTS.md`/`CLAUDE.md` only and says so on stderr. **A degraded run must not look like a thorough
one.**

### 5.2 What it asserts

1. **Frontmatter present and parseable** on every `.md` under the docs tree, except the exempt files.
2. **Closed vocabularies.** `status` is a member of its closed set; `title` and `updated` are present;
   a `kind:` field is rejected; status agrees with the tier in both directions (§4.3); an
   `implements:` field, when present, names a file that exists.
3. **Path hygiene, and naming.** Two rules that are easy to confuse, and the second one is the one
   most trees are missing.

   *Hygiene* is a character rule: directory segments must be strictly lowercase-kebab
   (`^[a-z0-9-]+$`), and spaces, underscores, `&` and MixedCase are rejected everywhere. This is
   what makes the `Tracking & Attribution` class of defect impossible to reintroduce.

   *Naming* says what a file may be **called**. Hygiene alone accepts `scrum-tasks.md` and
   `SCRUM-TASKS.md` — the same concept, twice, both legal — which is how a tree ends up with no
   naming system at all while passing every check. So basenames are kebab-case by default, and
   ALL-CAPS is legal only for:
   - a **sentinel** from a closed set (`config.sentinels`, default `README INDEX STATUS ROADMAP PRD
     CHANGELOG LICENSE`) — names whose capitals mean *"entry point for this folder"*, which is why
     hundreds of files called `PRD.md` do not need renaming; or
   - a **declared programme prefix** (`config.allowedBasenamePrefixes`, empty by default) — for a
     named programme whose identity is the string itself, referenced by that exact name across many
     documents. A carve-out that is declared is a system; the same carve-out undeclared is the
     absence of one.

   Two consequences worth knowing before the migration. Renaming for case alone needs **two**
   `git mv`s through a temporary name, because macOS and Windows are case-insensitive. And for the
   same reason the gate resolves every link against the real directory listing rather than trusting
   `existsSync`, which reports `./FOO.md` as live after the file became `foo.md` — the tree then
   breaks only on Linux, which is the worst place to find out.
4. **Index freshness** — regenerate `INDEX.md` and `index.json` in memory, compare against the
   committed files, fail on any difference. The fix is to run the generator, never a hand edit of a
   generated file. The index is sorted in plain codepoint order — never `localeCompare`, which is
   ICU/locale-dependent and would make "byte-identical" mean different things on different machines.
5. **No dead links, inside docs and out.**
   - Every Markdown link in a doc body whose target is a `.md` file resolves to a file that exists.
   - Every root-relative docs path in a **tracked file outside the docs tree** — `CLAUDE.md`,
     `AGENTS.md`, source comments, workflows, scripts — resolves too, via one `git grep`. Vendored
     tooling trees are excluded, because their skill templates name generic `docs/` paths that are
     not this repository's contract. **So are this system's own test fixtures and the transient
     migration map**, which name documents that deliberately do not exist. Bare prose mentions
     *inside* the docs tree are deliberately unchecked: historical plans legitimately narrate old
     paths.
6. **`status: superseded` implies a `superseded_by:` whose target exists.**

### 5.3 What it deliberately does not assert

Each of these would generate noise rather than signal, and a gate that cries wolf gets bypassed:

- **Document age.** A stable document is not a stale one. There is no honest threshold.
- **Word count, heading style, spelling.**
- **Whether `code:` paths still exist.** Tempting, but an ordinary refactor would then break the docs
  gate for an unrelated reason. This goes to the advisory pass, where a broken pointer is reported
  and never blocks a push.
- **Whether `updated:` matches `git log`.** Same advisory home. The field is human-maintained (§4.6);
  a drift report names the files whose git date has moved past their frontmatter date, and blocking
  on it would punish every whitespace commit. The report is capped, because one tree-wide commit
  moves every date at once.

### 5.4 Failure behaviour

One line per violation, formatted `docs/path.md:field — <expected>`, then exit 1. Output is capped at
100 lines plus a total (`--all` prints everything) so a mass failure cannot flood the log. No autofix
inside the gate; regenerating the index is a separate, explicitly invoked command.

### 5.5 Tests

The suite ships in the same change and is **wired into the gate as a blocking step**, because a suite
no runner executes is green exactly once. It uses `node:test` rather than a project's test framework,
so the scripts stay dependency-free and portable between repositories.

Fixtures are throwaway trees. Most are not git repositories, which exercises the non-git fallback of
the tracked-reference scan; a separate file builds real git fixtures, which is the only way to cover
the `git grep` branch and its exclusion list.

---

## 6. How agents use it

### 6.1 Entry point

`AGENTS.md` gains one short section:

> Never grep `docs/` blind. Read `docs/index.json` first and filter by `kind` and `status`.

`index.json` is a flat array of objects — `path`, `title`, `kind`, `status`, `updated`, and where
present `implements` and `code`. At well under 100 KB for a few hundred documents it is cheap to read
in full.

The concrete win: an agent asked "is feature X built?" performs one file read, finds `kind: reference`
with no `code:` field, and answers correctly. Before, the same question produced a grep across
hundreds of files and a confident, wrong "yes, here is the spec".

### 6.2 The promotion lifecycle

```
reference/   →   product/    →   plans/   →   plans/done/
(inspiration)   (committed)     (active)      (shipped)
```

1. `git mv docs/reference/<area>/<feature>/PRD.md docs/product/<feature>.md`
2. Change `status: reference` to `draft`; add `implements:`.
3. **Rewrite the prose to describe this product, not the source it was captured from.** Mandatory.
   Promoting a reference document verbatim is the mechanism by which someone else's assumptions
   become your product's requirements.
4. Add the feature row to the roadmap.
5. Write the implementation plan in `plans/`; build it; then set `status: shipped` and fill `code:`.

### 6.3 The load-bearing rule

**Nothing in `reference/` may be implemented directly. A document must be promoted first.**

Cheap to obey, checkable at review time, and it is what turns a liability into an asset.

---

## 7. Known limitations

Stated so they are not mistaken for solved problems.

1. **This design does not establish which plans are genuinely complete.** They all migrate in as
   `status: active`. Any plan whose text claims completion without verifiable evidence is collected
   into a handover list. Auditing those claims is separate work with a separate cost.

2. **A roadmap's per-feature status is inherited exactly as written.** Some of it is likely stale. No
   check in §5 can detect this; only reading the code can.

3. **Nothing is deleted.** The decision was "reference library, not prune". If the captured files
   should later be cut, `status: reference` plus `index.json` reduces that to a single reviewable
   pass.

4. **The gate will fail on the first push after migration if any frontmatter block is wrong.** That is
   the intent. It means the migration and the gate must land together and be verified green locally.

5. **`updated:` will drift** when a file is edited without the field being bumped. Nothing blocks on
   this, by design (§4.6) — the advisory report is the only detector.

---

## 8. Deliverables

| # | Deliverable |
|---|---|
| 1 | The tree of §3.1, populated by `git mv` — history preserved on every file |
| 2 | Frontmatter on every document; reference tier generated, other tiers reviewed |
| 3 | `docs/README.md` — hand-written, ~40 lines, explains the tiers and the lifecycle |
| 4 | `check-docs.mjs` + its tests |
| 5 | `gen-docs-index.mjs` generating `INDEX.md` and `index.json` |
| 6 | `lint:docs` and the test suite wired into the blocking gate, documented as an exception |
| 7 | An `AGENTS.md` section on the `index.json` entry point and the promotion rule |
| 8 | Advisory `code:`-pointer and `updated:`-drift checks in the non-blocking pass |
| 9 | A handover list of unverified plan-completion claims |
| 10 | Fixes for every dead pointer the gate finds on its first run |

The migration script and its map are written, run, and deleted within the migration; they are not
deliverables.

---

## 9. Questions to settle per project

1. Does `product/` start with only the roadmap, or should an initial set be promoted out of
   `reference/` immediately?
2. Should `archive/` exist at all, or should superseded documents be deleted?
3. Where do the specs for real surfaces belong — `product/` if current, `archive/` if superseded?

Three earlier questions were resolved once and need not be reopened:

4. ~~Should `implements:` be required on plans?~~ **Optional everywhere, validated when present.**
   "Required" was unenforceable honestly: a migration cannot derive it without inventing values.
5. ~~Where should the test suite live?~~ **Blocking, next to `lint:docs`.** Least machinery; the
   absence of precedent was the absence of tested scripts, not an argument.
6. ~~Does `reference` need a `rejected` sibling?~~ **No.** With `kind` gone from frontmatter,
   `status: reference` is the only marker on those files and stays flat. If the idea bank ever needs
   triage, that is a new optional field (`disposition: rejected`), not a fork of the lifecycle enum.
