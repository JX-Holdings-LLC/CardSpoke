# CardSpoke AI & Contributor Context

This is the compact review guide for people and AI agents changing CardSpoke 0.21.1. It defines where to look, what must stay aligned, and what not to infer from historical material.

## Product identity

- **Product:** CardSpoke, a lightweight local-first card-based knowledge app.
- **Creator:** [Jeffrey Guntly](https://github.com/jxburros).
- **Maintainer:** [JX Holdings, LLC](https://jxholdings.com).
- **Canonical repository:** [jxburros/CardSpoke](https://github.com/jxburros/CardSpoke).
- **Current public preview:** 0.21.1; schema version 4.

## Source-of-truth order

1. Runtime behavior and tests in `www/src/` and `tests/`.
2. Release metadata in `package.json`, `www/src/state.js`, `www/index.html`, `www/capabilities.json`, and the generated service-worker cache version.
3. Current contracts in `docs/architecture/`, `docs/api/`, and `docs/policies/`.
4. Product scope in `docs/specifications/FIRST_PUBLIC_SCOPE.md`.
5. Guides and the root README, which explain rather than redefine behavior.
6. `CHANGELOG.md` and `docs/reports/`, which are historical records.

Do not treat a roadmap, previous release note, audit report, or code comment about a future feature as evidence that the feature exists today.

## Current scope

CardSpoke is web-first and local-first. It supports card hierarchies, local datasets, import/export, recovery tools, and an optional plugin system. Desktop and mobile packaging exist as development workflows, but mobile security hardening remains experimental.

Hosted sync, telemetry, cloud storage drivers, real-time collaboration, alternate product shells, and typed-card platform systems are not in the 0.21.1 public scope. Do not add or advertise them without an explicit approved scope change, security review, and tests.

## Change checklist

- Preserve local data ownership and avoid unapproved network behavior.
- JavaScript packages run in workers with permission-checked RPC. Require plugin-code trust consent; worker isolation is not a complete hostile-code sandbox.
- Keep public plugin API changes compatible or document migration and update invariants, API references, samples, and tests together.
- For releases, update the version in every file checked by `npm run smoke`, add a changelog entry, and use the current release date.
- After source changes, run `npm run build`, `npm test`, `npm run smoke`, and relevant browser or Capacitor checks.

## Documentation writing rules

- Use plain language first; define terms before relying on them.
- State whether a feature is current, experimental, deferred, or historical.
- Prefer relative links within the repository and absolute links only for public sites.
- Keep one document authoritative for each contract; link to it instead of duplicating exact API details.
- Use stable headings, concise tables, and explicit version/schema values when they matter for review.
