# Documentation

This repository eats its own cooking: the tree is gated by the system it ships. `lint:docs` runs in
CI on every push.

**Agents: read [`index.json`](index.json) first.** [`INDEX.md`](INDEX.md) is the same data for
humans. Both are generated — run `node scripts/gen-docs-index.mjs` after adding or moving a
document; never hand-edit them.

The populated tiers:

| Tier | What it holds |
|---|---|
| `engineering/` | How this system works and why — the design record with its rejected alternatives and known limitations. |
| `engineering/adr/` | Architecture decision records (`kind: adr`), one per decision that was reversed or is worth defending later. |
| `plans/` | Work in flight — the debt and improvement backlog. |

The agent-facing procedure lives at the repository root as [`SKILL.md`](../SKILL.md), because skill
loaders require it there. Frontmatter, tiers and the gate's assertions are documented in
[`design.md`](engineering/design.md) and the root [`README.md`](../README.md).
