# Release & Versioning Notes

CardSpoke's current release policy is for the main public app: the web app first, then desktop packaging, then mobile packaging. CardSpoke is created by [Jeffrey Guntly](https://github.com/jxburros) and maintained by [JX Holdings, LLC](https://jxholdings.com).

## Versioning Model

- Core app releases use semantic-version-style labels where practical.
- Schema changes increment `schemaVersion` and require migration notes.
- Plugins should use semantic versioning and declare `manifest.compatibility`.
- Public release notes must distinguish current app features from deferred future work.

## Current Public Release Scope

A public CardSpoke release may include:

- Main web app changes
- Desktop/mobile packaging work for the same app
- Plugin runtime and plugin API changes
- Local-first import/export and storage improvements
- Accessibility, recovery, search, navigation, and card-management improvements

A public CardSpoke release should not include or advertise:

- OS-specific shells
- Spin-off apps built on CardSpoke
- Runtime profile systems
- Typed-card domain platforms
- Core-only build targets
- Cloud storage drivers
- Hosted sync

Those items require a separate future-version scope or another repository.

## Release Checklist (Core App)

- Update changelog with user-facing summary and breaking changes.
- Update the version in `package.json`, `package-lock.json`, `www/src/state.js`, `www/index.html`, and `www/capabilities.json`; verify the generated bundle and service-worker cache version through `npm run smoke`.
- Record schema changes and migration notes.
- Verify plugin compatibility and note known incompatibilities.
- Run `npm run build`.
- Run `npm test`.
- Run `npm run smoke` (static release checks: version consistency, CSP, bundle sanity).
- Run `npm run qa:browser` (Playwright end-to-end release QA).
- Run `npm audit --audit-level=high` (the level CI enforces).
- Confirm `www/index.html`, `www/app.js`, and `www/styles.css` still open locally after build.
- Confirm import/export smoke tests with a real dataset.
- Confirm Plugin Manager install, enable, suspend, delete, and Safe Mode flows.
- Confirm README, Feature Guide, and First Public Scope agree with the release.
- Tag release with version and schemaVersion.

> The four automated checks above are the same gates `.github/workflows/pages.yml`
> enforces before a Pages deploy; a red QA job deploys nothing.
>
> **Gap to close before the public release:** no git tags exist in this
> repository, even though 0.18.0 through 0.20.0 have shipped. The tagging step
> above is policy, not current practice. Either start tagging (and backfill the
> shipped versions) or drop the step so the policy matches reality.

## Release Checklist (Plugin)

- Update metadata: version, manifest compatibility, dependencies, and changelog.
- Document toggles, side effects, uninstall steps, and rollback steps.
- Provide compatibility notes with popular plugins and Deviations.

## Communication

- Announce whether a release is official or angled.
- Surface risk notes for plugins or app-layer customizations.
- Include rollback, backup, and Safe Mode guidance.
- Clearly mark deferred future work as deferred.

## Changelog & Distribution

- Keep changelog entries grouped by Added / Changed / Fixed / Removed.
- Explicitly call out schema-impacting changes.
- Official source and issue channel: the main GitHub repository.
- Release candidates should be shared as tagged pre-releases or clearly marked branch builds with test notes and rollback guidance.
