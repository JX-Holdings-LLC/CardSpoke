# CardSpoke

![CardSpoke logo](./CardSpoke.svg)

**Version:** 0.21.1 Public Preview | **Schema:** v4

CardSpoke is a lightweight, local-first, card-based knowledge app for organizing notes, ideas, references, writing, research, and personal information in flexible card trees.

Created by [Jeffrey Guntly](https://github.com/jxburros) and [JX Holdings, LLC](https://jxholdings.com). The source of truth is the [CardSpoke repository](https://github.com/jxburros/CardSpoke).

The public app is focused on the main CardSpoke experience first: the web app, followed by desktop packaging, then mobile packaging. Spin-offs, alternate shells, OS-specific app suites, typed-card platform experiments, runtime profiles, and cloud storage drivers are intentionally out of scope for this repository's current public version.

## What CardSpoke Is

- **A card-based knowledge app:** Create cards, nest cards inside other cards, and move through information as a hierarchy instead of a flat document list.
- **Local-first by default:** User data stays on the user's device unless they explicitly export or import it.
- **Portable:** Export data as JSON, TXT, Markdown, or CSV from the app.
- **Extensible:** A three-layer plugin system lets users and developers add themes, features, and deeper app customizations without bloating the default experience.
- **Lightweight:** The default app is meant to stay fast, understandable, and useful without requiring accounts, servers, or hosted sync.

## What Is Not In This Public Version

The first public CardSpoke scope does not include:

- OS-specific shells or app suites
- Alternate products built on CardSpoke
- Typed-card platform/domain systems
- Runtime profiles such as `lite` or `os`
- A separate core-only build target
- Cloud storage drivers such as Google Drive, OneDrive, or WebDAV
- Production-ready mobile security hardening
- Real-time collaboration or hosted sync

Cloud/off-device storage may return in a future version, but the public preview keeps storage local and user-controlled.

## Current Feature Set

### Cards and Organization

- Hierarchical parent/child cards
- Card create, read, update, delete, duplicate, and reparent flows
- Bookmarks and recent cards
- Card links using `[[Card Title]]` syntax
- Backlinks and related-card panels
- Tags, tag filtering, tag management, and tag suggestions

### Search and Navigation

- Fuzzy search
- Advanced search filters
- Keyboard navigation for search results
- Breadcrumb navigation through card trees
- Grid/list/compact display options

### Editing and Recovery

- Markdown-style rich text mode
- Formatting toolbar
- Undo/redo
- Trash recovery
- Import text into card bodies

### Import and Export

- JSON backup/export
- TXT export
- Markdown export
- CSV export
- JSON/TXT import flows

### Appearance and Accessibility

- Dark/light theme toggle
- High contrast option
- Typography presets, including a dyslexia-friendly option
- Keyboard shortcuts
- Focus management for modals
- Reduced-motion support where applicable

### Plugin System

CardSpoke keeps its default app small while allowing optional extensions through plugins.

Plugin layers:

- **Theme:** CSS-only visual changes.
- **Feature:** Adds UI or behavior through the plugin API.
- **App:** Deeper customization with higher risk and explicit user control.

The plugin runtime includes consent prompts, risk labels, safe mode, resource cleanup, middleware hooks, component overrides, and sample plugins.

**Trust model:** JavaScript packages run in dedicated workers with permission-checked API calls and restricted UI descriptions. Workers reduce risk but are not a complete hostile-code sandbox. The app asks for `plugin-code` trust consent before running any package JavaScript; plugins can read unlocked cards and dynamic imports are not covered by the host network permission. Only allow authors you trust. See [Security & Safety](./docs/policies/SECURITY_AND_SAFETY.md).


## Getting Started

1. Install dependencies. Node 20.19+ or 22.12+ is recommended.

   ```bash
   npm install
   ```

2. Build the web bundle.

   ```bash
   npm run build
   ```

3. Run tests.

   ```bash
   npm test
   ```

4. Start local development.

   ```bash
   npm run dev
   ```

   Note: the dev server serves the pre-built `www/app.js`. After editing files
   under `www/src/`, re-run `npm run build` (or run `npx vite build --watch` in a
   second terminal) to see the change; only `index.html`/`styles.css` edits are
   picked up live.

5. Preview the built app (`npm run build` first; `vite preview` serves the
   production site from `dist/`).

   ```bash
   npm run preview
   ```

6. Run the release checks (the same gates CI enforces before deploying).

   ```bash
   npm run smoke        # fast static checks: version consistency, CSP, bundle sanity
   npm run qa:browser   # end-to-end browser QA in headless Chromium
   ```

   `qa:browser` needs a Chromium for Playwright. If you don't have one, install
   it once with `npx playwright install --with-deps chromium`, or point
   `CHROMIUM_PATH` at an existing Chromium/Chrome binary.

## Desktop and Mobile Packaging

The public product focus is:

1. Web app first
2. Desktop packaging next
3. Mobile packaging after that

### Desktop (Windows, macOS, Linux)

The desktop app is a locked-down Electron shell in [`desktop/`](./desktop/)
with installers for Windows (NSIS `.exe`), macOS (`.dmg`/`.zip`) and Linux
(`AppImage`/`.deb`):

```bash
npm run desktop:install   # one-time: installs Electron + electron-builder
npm run desktop:start     # build the web bundle and launch the desktop app
npm run desktop:dist      # build installers for the current OS into desktop/release/
npm run desktop:test      # desktop shell unit tests
```

See the [Desktop guide](./docs/guides/DESKTOP.md) for installer details, the
security model, code signing and the release workflow.

### Mobile (Capacitor)

Capacitor commands remain available for development. The native projects are
generated, so add the platform once per fresh checkout before syncing:

```bash
npm run platform:android   # one-time: generates android/ (npx cap add android)
npm run platform:ios       # one-time: generates ios/ (macOS only)

npm run sync
npm run sync:android
npm run sync:ios
npm run open:android
npm run open:ios
```

See the [Capacitor guide](./docs/guides/README.CAPACITOR.md) for prerequisites.

Mobile builds should be treated as experimental until platform-specific security hardening is completed.

## Project Layout

- `www/` - Web assets consumed by the app and Capacitor shells.
- `www/src/` - Source slices compiled by Vite into `www/app.js`.
- `www/src/core/` - Plugin runtime modules used by the main CardSpoke app.
- `desktop/` - Electron desktop shell and installer configuration.
- `tests/` - Automated uvu tests.
- `docs/` - User, developer, API, policy, and release documentation.
- `sample-plugins/` - Example plugin packages.

## Documentation

Start with the [Documentation home](./docs/README.md) for a role-based map and the [AI & contributor context](./docs/AI_CONTEXT.md) for document precedence and review rules.

### Guides

- [Developer Guide](./docs/guides/DEVELOPER_GUIDE.md)
- [Code & Plugin System Handbook](./docs/guides/CODE_AND_PLUGIN_SYSTEM_HANDBOOK.md)
- [Test Guide](./docs/guides/TEST_GUIDE.md)
- [Desktop App Guide](./docs/guides/DESKTOP.md)
- [Capacitor Guide](./docs/guides/README.CAPACITOR.md)
- [Deviation Guide](./docs/guides/DEVIATION_GUIDE.md)
- [Feature Catalog](./docs/guides/FEATURES.md)

### API and Schema

- [API Reference](./docs/api/API_REFERENCE.md)
- [Schema & Migration Docs](./docs/api/SCHEMA.md)
- [Schema Reference](./docs/api/SCHEMA_REFERENCE.md)
- [Storage Model](./docs/api/STORAGE_DRIVER_INTERFACE.md)

### Plugin System

- [Plugin System Overview](./docs/architecture/PLUGIN_SYSTEM.md)
- [Plugin Invariants](./docs/architecture/PLUGIN_INVARIANTS.md)

### Policies

- [Code of Conduct](./docs/policies/CODE_OF_CONDUCT.md)
- [Security & Safety](./docs/policies/SECURITY_AND_SAFETY.md)
- [Storage & Privacy](./docs/policies/STORAGE_AND_PRIVACY.md)
- [Release & Versioning](./docs/policies/RELEASE_AND_VERSIONING.md)

### Specifications

- [CardSpoke Specification v1](./docs/specifications/cardspoke_spec_v1.md)
- [First Public Scope](./docs/specifications/FIRST_PUBLIC_SCOPE.md)

## Storage Model

CardSpoke is local-first. The public preview uses local browser/device storage and user-controlled import/export. Preferences live under `cardspoke_*` LocalStorage keys. Dataset storage defaults to local storage on the user's device.

The current public version does not include cloud sync or cloud storage drivers. Users can export backups and move them wherever they choose.

## Environment and Configuration

CardSpoke has no required environment variables for normal use.

| Key | Context | Notes |
|-----|---------|-------|
| `NODE_ENV` | Vite build | Set to `production` for release builds. |
| `VITE_*` prefix | Vite | Exposed to the client bundle at build time. Do not put secrets here. |

## Troubleshooting

### `npm run build` fails with a module resolution error

Run `npm install` first, then retry. If the error persists, delete `node_modules/` and `package-lock.json`, reinstall, and rebuild.

### `file://` page is blank

Open the browser console. A missing `www/app.js` means the build has not been run yet. A browser CORS error means the browser is blocking local file access; run `npm run build` and serve the app with `npm run preview` instead.

### Tests fail with "Cannot find module"

Ensure you are on Node 20.19+ or 22.12+ and that `npm install` completed successfully.

### Capacitor sync fails

Confirm that Android SDK or Xcode is installed and that `npx cap doctor` reports no blocking errors. See the Capacitor guide for platform-specific setup.

## Maintained by

CardSpoke is created by [Jeffrey Guntly](https://github.com/jxburros) and maintained by [JX Holdings, LLC](https://jxholdings.com). See [Contributing](./CONTRIBUTING.md) for contribution terms and expectations.

## Contributing

- Keep the default app lightweight and local-first.
- Do not add hosted sync, telemetry, cloud storage, or network services without explicit future-version planning.
- Follow plugin development practices in the Plugin System Overview.
- Adhere to the Security & Safety policy.
- Keep spin-offs, OS-specific shells, and alternate app suites outside this repository unless the public CardSpoke scope changes later.

---

## Project Stewardship

This project is developed by **Jeffrey** through **JX Holdings, LLC**. GitHub: [`jxburros`](https://github.com/jxburros).
