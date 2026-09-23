# CardSpoke Feature Catalog

This catalog describes the current public CardSpoke app scope: the main local-first web app, followed by desktop and mobile packaging. It intentionally excludes OS-specific shells, spin-off apps, typed-card platform systems, runtime profiles, core-only builds, and cloud storage drivers.

**Current Public Preview:** 0.21.1 | **Schema Version:** 4

## Core Product Shape

- **Card-based knowledge app:** Presents information as hierarchical cards for lightweight knowledge organization.
- **Local-first by default:** Data stays on the user's device unless the user explicitly imports or exports it.
- **Minimal default app:** Keeps the built-in experience focused and fast while leaving optional complexity to plugins.
- **Plugin-ready foundation:** Theme, Feature, and App plugins can extend the app without bloating the default experience.
- **Portable data:** Users can export backups and readable formats directly from the app.

## User Interface Features

- **Dark/Light theme toggle:** Switch between dark and light modes via the header button or `Alt+T` keyboard shortcut.
- **Rich Text mode:** Enable Markdown-style formatting in card bodies.
- **Grid View:** Toggle between list and grid layouts for card display.
- **Compact View:** Reduce visual density with compact mode.
- **High Contrast mode:** Accessibility option for improved readability.
- **Typography presets:** Choose Default, Comfortable, Compact, or Dyslexia-Friendly reading modes.
- **Developer Mode:** Enable debug logging and developer features.
- **Save status indicator:** Visual feedback showing save state.
- **Toast notifications:** Non-blocking feedback with hover-to-pause, click-to-dismiss, and keyboard accessibility.
- **Breadcrumb navigation:** Track and navigate the card hierarchy.
- **Getting Started guide:** First-run onboarding for new users.

## Card Management

- **Hierarchical cards:** Create parent-child relationships between cards.
- **Card CRUD:** Create, read, update, and delete cards.
- **Card duplication:** Duplicate cards with or without children.
- **Card sharing:** Copy cards as JSON or Markdown.
- **Drag and drop:** Reorder and reparent cards where supported.
- **Bookmarks:** Star cards for quick access.
- **Recent cards:** Track recently viewed/edited cards.
- **Card links:** Reference other cards using `[[Card Title]]` syntax.
- **Backlinks:** Show cards that link to the current card.
- **Related cards:** Show cards that share tags with the current card.

## Tag System

- **Tag creation:** Add multiple tags per card.
- **Tag Manager:** Rename, merge, or delete tags across cards.
- **Smart tag suggestions:** Suggestions based on content similarity with other tagged cards.
- **Tag filtering:** Click tags to filter and search by tag.

## Search Features

- **Fuzzy search:** Typo-tolerant search using Levenshtein distance scoring.
- **Advanced search:** Filter by text, tag, bookmark status, or date range.
- **Keyboard navigation:** Arrow keys to navigate results, Enter to select.
- **Search highlighting:** Matched terms highlighted in results.

## User Data & Storage

- **Local-first ownership:** User data stays on-device by default.
- **Local storage focus:** The public preview focuses on LocalStorage/IndexedDB style local persistence and user-controlled import/export.
- **No default telemetry:** The core avoids analytics/tracking beacons and requires explicit consent before any off-device transmission.
- **Dataset operations:** Dataset management remains local and user-controlled.
- **Cloud storage deferred:** Google Drive, OneDrive, WebDAV, and other cloud/off-device storage drivers are not part of the current public app scope.

## Import & Export

- **Export formats:** JSON, CSV, Markdown, and TXT.
- **Import formats:** JSON and TXT.
- **Bulk operations:** Bulk export/import with hierarchy preservation where supported.
- **Timestamped exports:** Exports are named with a timestamp or date-based filename for easier backup tracking.

## Undo/Redo & Recovery

- **Undo/Redo stack:** Ctrl+Z/Ctrl+Y shortcuts for reversible edits.
- **Trash Bin:** Recover deleted cards from the trash with restore or permanent delete options.

## Keyboard Shortcuts

- `Ctrl+N` — New card
- `Ctrl+F` — Focus search
- `Ctrl+H` — Go to home
- `Ctrl+B` — Show bookmarks
- `Ctrl+R` — Show recent cards
- `Ctrl+Z` / `Ctrl+Y` — Undo / Redo
- `Ctrl+D` — Duplicate current card
- `Ctrl+E` — Show plugin manager
- `Ctrl+U` — Upload data
- `Ctrl+T` — Focus tags input when editing a card
- `Ctrl+G` — Toggle grid/list view
- `Ctrl+[` / `Ctrl+]` — Navigate to parent/first child
- `Ctrl+/` — Show keyboard shortcuts help
- `Alt+T` — Toggle theme
- `Alt+C` — Toggle compact view
- `Escape` — Close modals/go back

## Plugin Ecosystem

- **Plugin Manager:** View installed plugins, install plugins, browse samples, and manage plugin state.
- **Three-layer system:** Theme, Feature, and App plugins cover visual changes through deeper customizations.
- **Plugin API:** Permission-gated `ctx` contexts with UI, data, storage, events, middleware, network, and filesystem surfaces.
- **Middleware Pipeline:** Interceptors for core operations such as create, update, delete, save, and render.
- **Component Registry:** Component overrides for supported UI pieces.
- **Permission System:** User consent for sensitive operations.
- **Resource Management:** Automatic cleanup of DOM elements, event listeners, middleware, and components created through the plugin API.
- **Safe Mode:** Launch with `?safemode` to disable plugins for troubleshooting.
- **Risk assessment:** Risk scoring based on layer and code analysis.
- **Metadata transparency:** Plugins declare name, version, author, description, layer, compatibility, and permissions.
- **TypeScript support:** Type definitions available in `types/` for plugin development.
- **Plugin introspection:** Inspect installed plugins with `Plugin.get(id)` and `Plugin.list()`; setup/teardown errors surface as toasts and console warnings. There is no `Plugin.devTools` object or hook-statistics view.

## Accessibility Features

- **Focus trapping:** Modal dialogs trap keyboard focus.
- **ARIA attributes:** Proper labeling for interactive elements.
- **Reduced motion support:** Respects `prefers-reduced-motion` where implemented.
- **Keyboard navigation:** Keyboard accessibility throughout the app.
- **High contrast mode:** Enhanced visibility option.
- **Dyslexia-friendly typography:** Specialized font sizing and spacing preset.

## Deviations and Forks

- Community members may ship Deviations, but they must not use the CardSpoke name or branding.
- Deviations must provide mandatory metadata, credit CardSpoke/JX Holdings, and avoid implying official endorsement.
- Monetization is permitted when authorship and endorsement status are transparent.

## Platform & Build Footprint

- **Web app first:** The main public target is the CardSpoke web app.
- **Prebuilt web bundle:** `www/app.js` is built by Vite from `www/src/`.
- **Desktop next:** Desktop packaging should wrap the same main app experience.
- **Mobile later:** Capacitor workflows support Android and iOS iteration, but production mobile hardening is not part of the first public promise.

## Schema, Versioning, and Compatibility

- **Current schema version:** 4.
- **Default store shape:** `rootOrder`, `cards`, `plugins`, `bookmarks`, `recentCards`, `viewMode`, `activeTheme`, `richTextEnabled`.
- **Migration rules:** Schema bumps require documented migrations, idempotent steps, explicit fallbacks, and plugin impact notes.
- **Compatibility safeguards:** Plugins must declare compatibility and refuse to run on unsupported versions.

## LocalStorage Keys

CardSpoke uses LocalStorage for preferences and lightweight configuration. Public keys are prefixed with `cardspoke_`.

### User Preferences

- `cardspoke_richtext`
- `cardspoke_gridView`
- `cardspoke_highcontrast`
- `cardspoke_typography`
- `cardspoke_devmode`
- `cardspoke_theme`
- `cardspoke_activeThemeMod`

### Application State

- `cardspoke_datasets`
- `cardspoke_dataset_metadata`
- `cardspoke_lastUploadTab`
- `cardspoke_hasSeenGettingStarted`

## Developer & Testing Experience

- **Node/uvu toolchain:** Uses Node 18+, Vite, and uvu.
- **Canonical build:** `npm run build` is the main app build path.
- **Automated tests:** `npm test` runs the app and plugin tests that remain in the public app scope.
- **Capacitor workflows:** Capacitor scripts remain available for native packaging iteration.

## Community & Governance Features

- **Transparency:** Community plugins must publish versioning, creator identity, and changelogs.
- **Credit & ownership rules:** CardSpoke stays free-to-use under JX Holdings, LLC ownership; creators must credit CardSpoke/JX Holdings and avoid implying official endorsement.
- **Quality expectations:** Plugins should fail safely, avoid data corruption or obfuscation, and document install/removal steps.
