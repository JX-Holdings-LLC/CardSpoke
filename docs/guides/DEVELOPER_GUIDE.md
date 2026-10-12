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
- `cli/` - Command-line interface for editing CardSpoke JSON files.
- `desktop/` - Electron desktop shell and installer configuration.
- `brand/` - The logo package: wordmark and icon in every format, app icons, and the [brand guide](../../brand/README.md).
- `tests/` - uvu test suites for the public app and plugin system.
- `marketing/` - Promo video source, built from screenshots of the real app.
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

   The dev server serves the pre-built `www/app.js`. After editing files under
   `www/src/`, re-run `npm run build` (or run `npx vite build --watch` in a
   second terminal) to see the change; only `index.html`/`styles.css` edits are
   picked up live.

5. Preview the built app (`npm run build` first; `vite preview` serves the
   production site from `dist/`):

   ```bash
   npm run preview
   ```

6. Run the release checks (the same gates CI enforces before deploying):

   ```bash
   npm run smoke        # fast static checks: version consistency, CSP, bundle sanity
   npm run qa:browser   # end-to-end browser QA in headless Chromium
   ```

   `qa:browser` needs a Chromium for Playwright. If you don't have one, install
   it once with `npx playwright install --with-deps chromium`, or point
   `CHROMIUM_PATH` at an existing Chromium/Chrome binary.

Node 20.19+ or 22.12+ is recommended.

## Desktop and Mobile Packaging

The desktop app is a locked-down Electron shell in `desktop/` with installers
for Windows (NSIS `.exe`), macOS (`.dmg`/`.zip`) and Linux (`AppImage`/`.deb`):

```bash
npm run desktop:install   # one-time: installs Electron + electron-builder
npm run desktop:start     # build the web bundle and launch the desktop app
npm run desktop:dist      # build installers for the current OS into desktop/release/
npm run desktop:test      # desktop shell unit tests
```

See the [Desktop guide](./DESKTOP.md) for the data folder, the security model,
code signing and the release workflow.

Capacitor commands remain available for mobile development. The native
projects are generated, so add the platform once per fresh checkout before
syncing:

```bash
npm run platform:android   # one-time: generates android/ (npx cap add android)
npm run platform:ios       # one-time: generates ios/ (macOS only)

npm run sync
npm run sync:android
npm run sync:ios
npm run open:android
npm run open:ios
```

See the [Capacitor guide](./README.CAPACITOR.md) for prerequisites. Treat
mobile builds as experimental until platform-specific security hardening is
completed.

## Environment and Configuration

CardSpoke has no required environment variables for normal use.

| Key | Context | Notes |
|-----|---------|-------|
| `NODE_ENV` | Vite build | Set to `production` for release builds. |
| `VITE_*` prefix | Vite | Exposed to the client bundle at build time. Do not put secrets here. |

## Troubleshooting

- **`npm run build` fails with a module resolution error.** Run `npm install`
  first, then retry. If the error persists, delete `node_modules/` and
  `package-lock.json`, reinstall, and rebuild.
- **The `file://` page is blank.** Open the browser console. A missing
  `www/app.js` means the build has not been run yet. A CORS error means the
  browser is blocking local file access; run `npm run build` and serve the app
  with `npm run preview` instead.
- **Tests fail with "Cannot find module".** Ensure you are on Node 20.19+ or
  22.12+ and that `npm install` completed successfully.
- **Capacitor sync fails.** Confirm that the Android SDK or Xcode is installed
  and that `npx cap doctor` reports no blocking errors.

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
