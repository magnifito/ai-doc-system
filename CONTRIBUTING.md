# Contributing

Thanks for considering a contribution.

## Ground rules

- **Tests first.** Every behavior change lands with a test that failed before the change. The suite
  is plain `node --test`; run it with `npm test`.
- **The gate stays green.** `npm run lint:docs` must print `check-docs: OK` — this repo dogfoods its
  own system. If you touch anything under `docs/`, regenerate the index with
  `npm run gen:docs-index` in the same change.
- **No new dependencies** without an issue first. The package deliberately has exactly one (`yaml`).
- **Design changes go through the design doc.** `docs/engineering/design.md` records what the gate
  asserts and — as importantly — what it deliberately does not. A PR that adds an assertion should
  also argue it there.

## Getting started

```bash
git clone https://github.com/magnifito/docs-notary.git
cd docs-notary
npm ci
npm test                      # throwaway fixture trees
npm run lint:docs             # the gate, against this repo's own docs/
```

Node 20+ is required. The scripts are plain ESM — no build step.

## Pull requests

- Keep PRs focused; one behavior per PR.
- CI runs the suite on Linux/macOS/Windows and Node 20/22/24, plus a pack-smoke job that installs
  the packed tarball into a fresh repo. All of it must pass.
- Commit messages follow the existing `feat:` / `fix:` / `docs:` style.

## Reporting bugs

Open an issue with the template. The single most useful thing you can include is a minimal
`docs/` tree (three or four files) that reproduces the wrong verdict.
