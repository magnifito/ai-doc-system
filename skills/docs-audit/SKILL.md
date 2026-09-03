---
name: docs-audit
description: Use when a repository with docs/index.json needs judgement about what its documents still claim — a periodic docs review, "are these docs stale", a plan that says it is done, a state document nobody has verified, a review_by date that passed, a change that may have invalidated documents, or a decision about what to archive. Runs ai-doc-system advisory, verify, and impact, and turns their output into archive, restamp, or rewrite actions. Not for adding a document (docs-write), moving one (docs-promote) or a red gate (docs-gate).
---

# Audit the documents

The gate proves the tree is well-formed. It cannot prove a document is true. This skill is the
part that needs a reader: run the three reporting commands, then decide, document by document.

## 1. Run the three reports

```bash
ai-doc-system advisory                 # updated-drift, code-pointer, verification-drift
ai-doc-system check                    # warnings: shipped-code, upstream, review, evidence-lock
ai-doc-system impact --base <ref>      # documents whose claims cover the paths a change touched
```

None of these blocks. Each line names a document, a rule id, and a reason. Group the output by
document before deciding; one file often trips three rules for one cause.

## 2. Verify before you believe

Before claiming a state document is current, run its evidence:

```bash
ai-doc-system verify --only docs/<tier>/<name>.md --stamp
```

It runs the document's command evidence, hashes its path evidence into `docs/evidence-lock.json`,
and stamps `verified_on` only where everything passed — a date you can defend instead of one you
typed. It is the only command that executes anything written in a document, so it is never wired
into the gate, into CI, or into a hook: invoke it deliberately, and **read the evidence lines of an
untrusted document first**. Never run `verify` on a branch you have not read.

## 3. Decide, per document

| The report says | Do |
|---|---|
| `updated-drift`: `code:` paths changed after `updated` | Read the diff. Rewrite the claim and bump `updated`, or the document is now `reference`. |
| `code-pointer`: a `code:` path is gone | Find the new path and fix it, or remove the claim. A `shipped` document with no `code:` is an opinion. |
| `verification-drift` / `evidence-lock` | Re-run `verify --only … --stamp`. If it fails, the document is wrong, not the lock. |
| `review` (`review_by` in the past) | Re-verify the claim. Move the date only after the check, never before. |
| `upstream` (`implements` target moved on) | Read the target's change. Update this document or record why it does not apply. |
| `shipped-code` | Add `code:` with real paths, or the status is `active`, not `shipped`. |
| A plan says "done" with untaken steps | It is a live backlog. Keep `active`. |
| A plan is done and its work shipped | `status: shipped` with `code:` and `evidence:`; else keep `active` and say what is missing. |
| A document's first line says SUPERSEDED | docs-promote: supersede and archive. |
| Two documents make the same claim | Keep the higher tier. Supersede the other (docs-promote). |

Never stamp `shipped` on the strength of a plan's own prose. Never delete a document to make a
report shorter — tier it or archive it, unless the user answered "yes" to deletion when the system
was adopted.

## 4. Report to the user

List what you changed, what you verified and how, and the claims nobody could check with their
cost to check. A claim you could not verify stays unverified in the frontmatter — a `verified_on`
you did not earn is worse than none.

## 5. Before you finish

```bash
ai-doc-system gen
ai-doc-system check     # every restamp must still pass the gate
```
