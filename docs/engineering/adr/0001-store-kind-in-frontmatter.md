---
title: "ADR 0001: store kind in frontmatter as well as deriving it from the path"
summary: Why `kind` is stored on every document as well as derived from its path, and what that costs.
kind: adr
status: active
updated: 2026-09-03
---

# ADR 0001: store `kind` in frontmatter as well as deriving it from the path

## Context

The first version of this design forbade a `kind:` field outright: the path already says which tier
a document is in, so storing the same value again duplicates it and buys one assertion class whose
only job is to check the duplication. That reasoning held only for a document read *inside* its
tree, and documents are routinely read outside it — pasted into a conversation, handed to an agent
as a blob, opened from a search result — where a path-derived field is simply not there.

## Decision

**Reversal, 2026-08-23.** This section used to forbid a `kind:` field, on the argument that
storing a derived value duplicates what the path already says and buys one assertion class whose
only job is to check the duplication. That argument weighed the wrong cost. A document is
routinely read **outside its tree** — pasted into a conversation, handed to an agent as a blob,
opened from a search result — and in that setting a path-derived field is simply absent. The
document then cannot say what it is. Self-containment is worth one cheap assertion, and a
duplicate that is machine-checked on every push cannot drift. The price is that `git mv` alone no
longer re-tiers a file; `fix-docs-frontmatter.mjs` (today, `docs-notary fix`) restamps the whole
tree — every document, not only the one that moved — in one command.

The same argument carries `module`, which is derived, stored and asserted identically.

## Consequences

- **`git mv` alone no longer re-tiers a document.** The path implies a new `kind`, the stored field
  still says the old one, and the gate fails the pair with a `vocabulary` violation until the
  frontmatter is restamped.
- **Two commands restamp it.** `docs-notary fix` rewrites `kind` and `module` across the whole
  tree after a move; `docs-notary mv <from> <to>` does the move and the restamp together, and
  records `promoted_from` when the move crosses tiers.
- **The duplication cannot drift**, because the gate compares the two on every push. That is the
  whole trade: one cheap assertion in exchange for a document that says what it is anywhere.
