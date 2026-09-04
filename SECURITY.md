# Security Policy

## Supported versions

Only the latest published version of `@puralex/docs-notary` receives security fixes.

## Reporting a vulnerability

Report vulnerabilities privately via
[GitHub security advisories](https://github.com/magnifito/docs-notary/security/advisories/new).
Do not open a public issue for a security problem.

You can expect an acknowledgement within a week. Fixes ship as a patch release with a changelog
entry crediting the reporter (unless you prefer otherwise).

## Scope notes

The scripts read and write files inside the repository they run in and shell out to `git` for
tracked-file listings. They make no network requests and execute no document content. The most
plausible vulnerability class is path handling (a crafted frontmatter value or link escaping the
repo root) — reports in that area are especially welcome.
