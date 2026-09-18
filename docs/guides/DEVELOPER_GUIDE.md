# Developer Guide (Core App)

This guide explains how to work on the main CardSpoke web app, run tests, and align with the project's lightweight, local-first, plugins-first philosophy.

**Current Public Preview:** 0.21.1 | **Schema Version:** 4

## Product Scope

CardSpoke's current public repository is for the main CardSpoke app.

Priorities:

1. Web app
2. Desktop packaging
3. Mobile packaging

Do not add OS-specific shells, alternate app suites, typed-card domain systems, runtime profiles, core-only build targets, or cloud storage drivers to this public app scope. Put that work in a separate future repository or future-version plan.

## Architecture Overview

- **Ultra-light app:** Keep the main bundle lean. `www/app.js` is produced by `npm run build` through Vite.
- **Card model:** UI presents hierarchical cards for navigating knowledge. The default store shape tracks `rootOrder`, card records, bookmarks, recent cards, plugins, view mode, active theme, and rich text state.
- **Plugin system:** Core exposes the plugin runtime through `window.CardSpoke`. Plugins should use the documented API instead of mutating app internals.
- **Local-first:** Default storage is local. Avoid network dependencies, hosted sync, telemetry, or cloud storage without explicit future-version planning.
- **Self-contained bundle:** The app can be opened directly from the filesystem when `www/app.js` has been built.

## Repository Layout

- `www/` - Web assets consumed by the app and Capacitor shells.
- `www/src/` - Source slices that build into the browser bundle.
- `www/src/core/` - Plugin runtime modules used by the main app.
- `tests/` - uvu test suites for the public app and plugin system.
- `docs/` - Project documentation.
- `sample-plugins/` - Example plugin packages.
- `capacitor.config.json` - Platform configuration for Capacitor.

## Development Workflow

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build the app:

   ```bash
   npm run build
   ```

3. Run tests:

   ```bash
   npm test
   ```

4. Start the dev server:

   ```bash
   npm run dev
   ```

5. Preview the built app:

   ```bash
   npm run preview
   ```

## Coding Conventions

- Keep the app lightweight.
- Keep data local-first and user-controlled.
- Do not silently collect or transmit user data.
- Prefer pure, deterministic functions where possible.
- Make side effects explicit.
- Use the plugin API, event bus, and middleware system for extensibility.
- Maintain clear separation between the main app and optional plugin content.
- Do not reintroduce extracted OS/app-suite systems into this repo.
- Do not reintroduce cloud drivers without a future-version plan, security review, and tests.

## Testing

- Use `uvu` with `npm test`.
- Co-locate tests under `tests/` with descriptive filenames.
- Keep tests focused on the public CardSpoke app and plugin runtime.
- Remove tests for extracted or deferred systems instead of keeping them as implied scope.

## Accessibility & UX

- Keep UI fast and uncluttered.
- Ensure keyboard navigation and readable contrast.
- Document any theme deviations from accessibility expectations.

## Performance

- Keep bundles small.
- Avoid unnecessary dependencies.
- Prefer lazy loading for heavy assets injected by plugins.
- Add local-only diagnostics only when they help debug performance without collecting user data.

## Release Hygiene

- Update changelog and metadata for every public release.
- Keep README, feature docs, and first-public-scope docs aligned.
- Run `npm run build`, `npm test`, `npm run smoke`, and `npm run qa:browser` before release — the same gates `.github/workflows/pages.yml` enforces, alongside `npm audit --audit-level=high`.
- Confirm `www/index.html` + `www/app.js` + `www/styles.css` can load locally.
- Clearly mark mobile builds as experimental until platform hardening is complete.

## Source Mapping & Tooling Status

- `npm run build` runs the canonical Vite build.
- There is no public-scope `build:core` script.
- There is currently no repository-enforced linter/formatter configuration. Keep style consistent with surrounding code and validate changes with `npm test`.
