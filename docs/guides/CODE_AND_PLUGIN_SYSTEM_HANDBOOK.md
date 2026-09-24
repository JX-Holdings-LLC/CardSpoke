# CardSpoke Code & Plugin System Handbook

For new distributed JSON plugins, start with the [standalone authoring guide](./PLUGIN_AUTHORING_GUIDE.md).
It distinguishes worker-package APIs from session-only host-code examples and includes tested templates.

This handbook is the implementation-level guide to how CardSpoke works and how to build plugins for it safely.

It is intentionally specific: you’ll find concrete field names, hook signatures, storage keys, runtime APIs, and practical examples tied to the current architecture.

---

## 1) What Runs in Production

CardSpoke’s runtime is a **single browser bundle** (`www/app.js`) produced by a real Vite build, entry point `www/src/main.js`. A Rollup plugin (`flattenAppScope` in `vite.config.js`) fuses the following domain-named "app-layer" source slices into one shared scope, in this order:

1. `www/src/state.js` (shared application state)
2. `www/src/kernel.js` (Layer 0: headless, pure data/hierarchy engine, no browser deps)
3. `www/src/metadata.js` (metadata and utilities)
4. `www/src/storage.js` (storage drivers and plugin wiring)
5. `www/src/data.js` (CRUD operations and modals)
6. `www/src/rendering.js` (rendering and initialization)
7. `www/src/systems.js` (advanced systems and boot)

`main.js` also imports the plugin runtime as proper ESM modules from `www/src/core/`. The single assembly point is `www/src/core/global-api.js`, which imports the subsystems (`middleware.js`, `component-registry.js`, `plugin-api.js`, `storage-driver-registry.js`, `plugin-validator.js`, `permissions.js`) and assembles + **freezes** `window.CardSpoke` **before any app-layer code runs**. These core modules are left fully intact by the Rollup plugin rather than fused into the app-layer scope.

Boot order is guaranteed two ways: `main.js` imports `./core/global-api.js` first, and `flattenAppScope` in `vite.config.js` **prepends** `import '@core/global-api.js';` to the fused app-layer module — so the runtime initializes before any app-layer statement executes.

Build command:

```bash
npm run build
```

There is exactly **one** build of the app: `npm run build` **is** the Vite build (→ `www/app.js`, loaded by `www/app-loader.js`). There is no `build:vite`, no `build:cat`, and no `build:core` script, and there is no top-level `www/src/core.js` — an earlier diverging duplicate runtime by that name was removed (it is what originally broke the plugin system). Do not confuse anything with the `www/src/core/` ESM **directory**, which holds the actual plugin runtime described above.

The Vite build produces an IIFE, so the fused app layer runs in one shared scope (matching the historical concatenation behavior expected by `file://` deployments and by the test suite's source assertions), while the `www/src/core/` modules keep proper ES module boundaries.

---

## 2) Source Slice Responsibilities (Concrete)

## `state.js`

Defines shared application state as named exports:

- App metadata constants: `APP_VERSION`, `APP_RELEASE_DATE`, `SCHEMA_VERSION`, `APP_CREATOR`
- Store factory: `createDefaultStore()`
- Mutable state with setters: `store`/`setStore`, `navState`/`setNavState`, `instanceKey`/`setInstanceKey`, `dirty`/`setDirty`, and others
- Immutable in-place arrays: `undoStack`, `redoStack`, `trashBin`
- Size limits: `MAX_UNDO_STACK` (50), `MAX_TRASH_SIZE` (100)

## `kernel.js`

The real Layer 0 of the app: a headless, pure data and hierarchy engine with no browser dependencies (no DOM, no `window`, no storage side effects). It is the second slice fused into the app-layer scope (after `state.js`) and provides the low-level card/hierarchy primitives (e.g. `uid()`, `cloneCard()`) that later slices build on. It is intentionally minimal and portable — it is what `main.js` loads before wiring up storage, rendering, and the plugin architecture.

## `www/src/core/*.js` (plugin runtime)

The plugin runtime shipped in production lives in ESM modules under `www/src/core/`, imported (via `global-api.js`) by `www/src/main.js`:

- **Public API surface** (`www/src/core/global-api.js`): the ONE place that assigns and **freezes** `window.CardSpoke`. It exposes the convenience entry points `registerPlugin(id, definition)` (registers **and** enables; session-only), `installPlugin(pkg)` (persistent install; alias of `Plugin.install`), and `requestPermissions(pluginId, pluginName, permissions)`, plus the runtime subsystems below: `Plugin`, `PluginSandbox` (`{ createFunction }`), `Middleware`, `ComponentRegistry`, `StorageDriverRegistry`, `PluginValidator`, `Permissions`, and `utils`. The root object is frozen, but `utils` is an intentionally mutable inner object populated in place by the app layer (`storage.js`).

- **Middleware Pipeline** (`www/src/core/middleware.js`, exposed as `window.CardSpoke.Middleware`):
  - `register(middleware)` - Register priority-weighted interceptors
  - `unregister(name)` - Remove middleware by name
  - `run(operation, args)` - Execute middleware pipeline for operation
  - `list()` - List all registered middlewares
  - Operations: `card.create`, `card.update`, `card.delete`, `card.save`, `card.render`

- **Component Registry** (`www/src/core/component-registry.js`, exposed as `window.CardSpoke.ComponentRegistry`):
  - `register(name, component, priority)` - Register UI components
  - `unregister(name)` - Remove component by name
  - `get(name)` - Retrieve registered component
  - `resolve(name)` - Alias for get()
  - `has(name)` - Check if component exists
  - `list()` - List all registered components
  - The registry does not predefine components. The host **queries** exactly these names: `Card` (per card-tile render, live) and `Header`, `Sidebar`, `SearchBar` (once at boot via `applyRegistryComponents()`). A plugin registers overrides for those names; a custom `render(props)` must return an `HTMLElement`, and the host falls back to the default renderer on any exception.

- **Plugin API** (`www/src/core/plugin-api.js`, exposed as `window.CardSpoke.Plugin`):
  - `install(pkg)` - Validate, register, persist to `store.plugins`, auto-enable SAFE/LOW layers
  - `register(id, definition)` - Register a definition (throws on a duplicate id; does not persist)
  - `enable(id)` / `disable(id)` - Run `setup(ctx)` / `teardown(ctx)`; persist enabled state
  - `unregister(id)` - Disable, clean up, revoke permissions, remove the store entry
  - `get(id)` / `list()` / `listAll()` - Inspect registered plugins
  - `assessModRisk(pkg)` / `syncFromStore(safeMode)` / `notifyDataUpdate(event)` / `buildSettingsPanel(id)`
  - Context APIs: `ctx.api.ui`, `ctx.api.data`, `ctx.api.storage`, `ctx.api.events`, `ctx.api.middleware`, `ctx.api.network`, `ctx.api.filesystem`
  - Plugin `js` is a **setup-function body** compiled by the single factory `_createSandboxedFunction` as `new Function('ctx', '"use strict";\n' + js)` and run on the **main thread** (no iframe/Worker sandbox)
  - Resource tracking and automatic cleanup

- **Storage Driver Registry** (`www/src/core/storage-driver-registry.js`, exposed as `window.CardSpoke.StorageDriverRegistry`):
  - `register(name, driver)` - Register storage backend
  - `unregister(name)` - Remove storage driver
  - `get(name)` - Get driver by name
  - `setActive(name)` - Switch active storage driver
  - `getActive()` - Get current active driver
  - `list()` - List all registered drivers

- **Plugin Validator** (`www/src/core/plugin-validator.js`, exposed as `window.CardSpoke.PluginValidator`): `validate(pkg)`, `validateCSS(css)`, `validateJS(js)` — screens manifest shape, size limits (100 KB CSS / 500 KB JS), and blocked patterns (CSS `@import`/`javascript:`/`expression()`/`behavior:`/`-moz-binding`; JS `eval(`/non-`ctx` `new Function(`).

- **Permissions** (`www/src/core/permissions.js`, exposed as `window.CardSpoke.Permissions`): user consent gating for the six permissions (`ui-override`, `storage`, `network`, `filesystem`, `core-override`, `data-modify`).

Because these are real ESM modules (not fused into the app-layer virtual scope), they retain proper module boundaries even inside the single IIFE bundle. `global-api.js` assembles and freezes `window.CardSpoke` from them so the runtime is available before the fused app-layer slices run.

Note: earlier internal builds also hosted a larger "Core Platform Layer" (typed cards, runtime profiles, action registry, conversions) under `www/src/core/` with its own `build:core` target. That layer is outside the public app scope and has been removed from this repository; `www/src/core/` now contains only the plugin runtime, storage-driver registry, and migrations modules described above.

## `metadata.js`

Defines metadata constants and shared primitives used by all later slices:

- Metadata: `APP_VERSION`, `APP_RELEASE_DATE`, `SCHEMA_VERSION`
- DOM helper: `h(tag, props, ...children)`
- Utility helpers:
  - `uid()`
  - `debounce(func, wait)`
  - `normalizeTagInput(raw)`
  - `escapeHtml(str)`
  - `highlightText(text, query)`
  - `cloneCard(card)`
  - `formatBytes(bytes)`
- Accessibility helper: `trapFocus(modal)`
- Store initializer: `createDefaultStore()`
- Preference accessors:
  - `isRichTextEnabled()` / `setRichTextEnabled(enabled)`
  - `getActiveThemeMod()` / `setActiveThemeMod(modId)`
  - `isDeveloperMode()`
- Toast system: `initToast()` / `showToast(message, type, duration)`

## `storage.js`

Defines persistence architecture and extension runtime:

- Storage abstraction class: `StorageDriver`
- Drivers:
  - `IndexedDBDriver`
  - `LocalStorageDriver`
  - Optional integration drivers (e.g. cloud/local-file paths)
- Data I/O:
  - `load()`
  - `save()`
- Navigation:
  - `goTo(page, opts)`
  - `goBack()`
- Built-in storage drivers (constructed directly here — the app does not consume `StorageDriverRegistry` for its own persistence)
- plugin developer API:
  - Populates `window.CardSpoke.utils` **in place** (the frozen root's mutable inner object) with async host helpers.
  - (Package validation and risk scoring live in the core runtime: `window.CardSpoke.PluginValidator.validate(pkg)` and `window.CardSpoke.Plugin.assessModRisk(pkg)`.)

## `data.js`

Owns app workflows and plugin manager UI actions:

- Data-centric UI flows: import/export, settings, bookmarks/recent dialogs
- plugin Manager UI tabs:
  - Installed (Enable / Suspend / Remove)
  - Install (from file or URL)
  - Gallery (curated list from `sample-plugins/manifest.json`)
  - Create (write manifest/JS/CSS in-app; saved persistently)
- Middleware operations fired for data ops: `card.create`, `card.update`, `card.delete` (plus `Plugin.notifyDataUpdate`)
- Utility flows frequently used by plugin users (install, export, toggle, etc.)

## `rendering.js`

Owns render pipeline and primary interaction views:

- Core renderers:
  - `renderCardList()`
  - `renderReadOnlyCard()`
  - `renderEditCard()`
  - `renderSearchResults()`
  - `render()`
- Middleware/dispatch touchpoints (there is no `runModHook`; the current model uses the middleware pipeline and data-update notifications):
  - `renderCardTile` fires the `card.render` middleware operation with args `[card, cardTileElement]`
  - card create/update/delete in `data.js` fire `card.create` / `card.update` / `card.delete` and call `Plugin.notifyDataUpdate({ type, cardId, card? })`
  - `saveNow` in `storage.js` fires `card.save` with `[store]` (a middleware `preventDefault()` aborts the save)

## `systems.js`

Owns advanced behavior and startup:

- Undo/redo engine: `pushUndo()`, `undo()`, `redo()`
- Advanced UX: shortcuts, trash bin, dataset utilities
- **HOST BRIDGE** block (runs before the boot IIFE): assigns the window globals the decoupled plugin runtime reads — `window.save`, `window.createCard`, `window.updateCard`, `window.deleteCard`, `window.cloneCard`, `window.getTags`/`addTag`/`removeTag`/`setTags`/`getAllTags`, `window.showToast` (`window.store` is kept in sync separately by `setStore` in `state.js`). This set of names is a stability contract.
- Boot sequence (actual order):
  1. `initToast()`
  2. Parse URL safe mode (`?safemode`)
  3. `load()`
  4. `populateFooter()`
  5. `updateDatasetSelector()`
  6. Apply saved typography
  7. `CardSpoke.Plugin.syncFromStore(safeMode)` - re-registers stored plugins from their persisted `js`/`teardownJs` strings; re-enables the enabled ones **unless** `safeMode` (then everything is registered but disabled). Idempotent; re-runs when an async IndexedDB/local-file dataset replaces the store.
  8. `applyRegistryComponents()` - applies `Header`/`Sidebar`/`SearchBar` overrides
  9. `render()`

---

## 3) Store Shape, Card Shape, and Persistence Keys

## Default store shape

The app initializes/persists a store with these key top-level fields:

- `rootOrder: string[]`
- `cards: Record<string, Card>`
- `plugins: Record<string, ModPackage>`
- `bookmarks: string[]`
- `recentCards: string[]`
- `viewMode: 'normal' | ...`
- `activeTheme: 'light' | 'dark'`
- `richTextEnabled: boolean`
- `metadata` (when present)

## Card object (practical shape)

A card commonly includes:

- `id: string`
- `title: string`
- `body: string`
- `parentId: string | null`
- `children: string[]`
- `tags: string[]`
- `modsData: Record<string, any>` (optional, plugin-owned payloads)

## Preference/storage keys used in LocalStorage

Common keys you will interact with:

- `cardspoke_richtext`
- `cardspoke_gridView`
- `cardspoke_highcontrast`
- `cardspoke_typography`
- `cardspoke_devmode`
- `cardspoke_theme`
- `cardspoke_activeThemeMod`
- `cardspoke_dataset_metadata` (dataset registry metadata)

---

## 4) Data Flow: Mutation → Save → Render → Hooks

The dominant flow is:

1. A user or plugin action mutates the store (card create/update/delete/tag ops)
2. `save()` persists the current dataset (firing the `card.save` middleware operation)
3. `render()` updates the visible UI (each card tile fires the `card.render` middleware operation)
4. Enabled plugins are notified through the middleware pipeline and `Plugin.notifyDataUpdate({ type, cardId, card? })`, which feeds `ctx.api.data.onUpdate` listeners

Examples (host-fired middleware operations — there is no `runModHook`/`onCard*` hook system anymore):

- Creating/updating/deleting a card fires `card.create` / `card.update` / `card.delete` (and calls `notifyDataUpdate`)
- Saving fires `card.save` (`[store]`; `preventDefault()` aborts the save)
- Rendering a card tile fires `card.render` (`[card, cardTileElement]`)

Practical takeaway: if your plugin mutates card data, prefer `ctx.api.data.*` (or `ctx.utils` / `window.CardSpoke.utils`) methods so persistence and rendering stay coherent.

---

## 5) plugin Package Contract (Exact Fields)

Canonical plugin package structure (`js`/`teardownJs` are **strings** — the body of the setup/teardown functions, receiving `ctx`):

```json
{
  "id": "my-plugin",
  "manifest": {
    "id": "my-plugin",
    "name": "My plugin",
    "version": "1.2.3",
    "author": "Your Name",
    "description": "Optional summary",
    "layer": "feature",
    "permissions": ["ui-override"],
    "config": {},
    "compatibility": ">=0.17.0"
  },
  "css": "/* injected while enabled */",
  "js": "ctx.logger.info('enabled');",
  "teardownJs": "/* optional extra cleanup */"
}
```

Top-level `id`/`config`/`overrides` are normalized into the manifest at install (explicit manifest values win). `enabled` is **not** a package field — the runtime tracks it separately in `store.plugins[id].enabled`.

## Validation

`window.CardSpoke.PluginValidator.validate(pkg)` returns `{ valid, errors, warnings, sanitized }` and enforces:

1. `pkg.id` must be a string (a non-`[a-z0-9-]` id is a warning, not an error)
2. `manifest` is required and must be an object
3. `manifest.name`, `manifest.version`, and `manifest.layer` are required
4. `manifest.layer` must be one of: `theme`, `feature`, `app`
5. Size limits: CSS ≤ 100 KB, JS ≤ 500 KB
6. Blocked JS patterns: `eval(` and non-`ctx` `new Function(` (errors); blocked CSS patterns (`@import`, `javascript:`, `expression()`, `behavior:`, `-moz-binding`) are stripped with a warning

The validator does **not** hard-reject theme-with-JS or non-app overrides — those affect the **risk score** instead (see [Risk Assessment](#10-risk-assessment-how-runtime-scores-plugins)): a theme that carries JS scores MEDIUM, and any declared `overrides` (or the `app` layer) scores HIGH. Only SAFE/LOW auto-enable on install, so a MEDIUM or HIGH package installs **suspended** and waits for an explicit user enable.

Recommended (warnings only, not hard errors):

- `manifest.author` and `manifest.description` (strings)
- ID format: lowercase letters/numbers/hyphens (`my-plugin-1`)
- Semantic versioning in `manifest.version`
- Clear `compatibility` range

---

## 6) Layer Model with Real Capability Boundaries

## Theme layer

- Intended: CSS only
- Discouraged: JS (a theme carrying JS scores MEDIUM and will not auto-enable), overrides
- Best for: colors, spacing, typography, layout tweaks
- Expected risk: SAFE (CSS-only)

## Feature layer

- Allowed: CSS + JS + middleware/components
- Not intended: overrides (declaring any override forces HIGH risk)
- Best for: additive features (badges, utilities, side-panels, keyboard helpers)
- Expected risk: LOW (auto-enabled when it declares no overrides)

## App layer

- Allowed: CSS + JS + overrides
- Best for: application-level transformations
- Expected risk: HIGH (installs suspended; requires explicit user enable)

---

## 7) Plugin Lifecycle System (Setup and Teardown)

The modern plugin system uses `setup` and `teardown` functions instead of individual hooks:

### Lifecycle Functions

- **`setup(ctx)`**: Called when the plugin is enabled. Use this for initialization, resource allocation, and registering middleware/components.
- **`teardown(ctx)`**: Called when the plugin is disabled or uninstalled. Resources are automatically cleaned up, but custom cleanup can be performed here.

### Plugin Context (`ctx`) includes

- `modId` - The plugin's unique identifier
- `appVersion` - Current app version (0.21.1)
- `schemaVersion` - Current schema version (4)
- `config` - Live `manifest.config` object (present when the manifest declares `config`)
- `api` - API object with `ui`, `data`, `storage`, `events`, `middleware`, `network`, and `filesystem` namespaces
- `utils` - Async host helpers (same object as `window.CardSpoke.utils`)
- `logger` - Plugin-scoped logger (`log`, `info`, `warn`, `error`)

### Registration Pattern

Register middleware through **`ctx.api.middleware.register`** (namespaced `<pluginId>:<name>` and auto-cleaned on disable) rather than the raw `window.CardSpoke.Middleware`, which is not tracked. The `card.render` handler receives its args as the array `[card, cardTileElement]`.

Shown here in the **session-only** module form (real `setup`/`teardown` functions via `registerPlugin`, which registers **and** enables). To ship it, move the `setup` body into a package `js` **string** and install with `window.CardSpoke.Plugin.install(pkg)` so it persists across reloads:

```js
window.CardSpoke.registerPlugin('word-counter', {
  manifest: {
    name: "Word Counter",
    version: "1.0.0",
    author: "Author Name",
    layer: "feature",
    permissions: ["ui-override"]
  },

  setup: async (ctx) => {
    ctx.logger.info('Plugin enabled');

    // Register middleware to inject word count on card render.
    // ctx.api.middleware registrations are namespaced and auto-cleaned.
    ctx.api.middleware.register({
      name: 'render-badge',
      priority: 5,
      operations: ['card.render'],
      handler: async (mw, next) => {
        const [card, element] = mw.args;
        if (card && element) {
          const words = (card.body || '').trim().split(/\s+/).filter(Boolean).length;
          const badge = document.createElement('span');
          badge.className = 'word-counter-badge';
          badge.textContent = `${words} words`;
          element.appendChild(badge);
        }
        await next();
      }
    });
  },

  teardown: async (ctx) => {
    ctx.logger.info('Plugin disabled');
    // Middleware registered via ctx.api.middleware is automatically unregistered
  }
});
```

**Note:** Resource management (DOM cleanup, listener/middleware/component removal) is automatic for anything created through `ctx.api.*`. The middleware pipeline should be used for intercepting core operations like card render, save, delete, etc.

---

## 8) Runtime APIs: `CardSpoke.Plugin` and Window Functions

## `CardSpoke.Plugin` (Plugin Manager)

Common operations:

- `install(pkg)` - Install a plugin package (validate, register, persist, auto-enable SAFE/LOW), returns the id
- `register(id, definition)` - Register a definition (throws on a duplicate id; does not persist)
- `unregister(id)` - Unregister a plugin (disable + cleanup + revoke permissions + remove store entry)
- `enable(id)` - Enable a registered plugin (permissions consent, apply CSS, run `setup`)
- `disable(id)` - Disable an enabled plugin ("suspend")
- `get(id)` - Get plugin instance by ID (`{ id, definition, context, enabled, resources }`)
- `list()` / `listAll()` - List all registered plugin instances
- `assessModRisk(pkg)` - Assess risk level (SAFE, LOW, MEDIUM, HIGH)
- `syncFromStore(safeMode)` - Restore plugins from `store.plugins` at boot
- `notifyDataUpdate(event)` - Fan a `{ type, cardId, card? }` event out to `ctx.api.data.onUpdate` listeners
- `buildSettingsPanel(id)` - Build an auto-generated settings panel from `manifest.config`

**Methods that do NOT exist** (there is no legacy hook system or `devTools`/`Plugin.events` surface):

- ~~`runHook(...)`~~ / ~~`runHookForMod(...)`~~ - Use the middleware pipeline (`ctx.api.middleware`) instead
- ~~`reload(modId)`~~ - Not implemented
- ~~`Plugin.devTools.*`~~ - No such object; inspect plugins with `Plugin.get(id)` / `Plugin.list()`
- ~~`Plugin.events.*`~~ - The event bus is per-plugin: `ctx.api.events` (`on`/`off`/`once`/`emit`), backed by a single global bus shared across plugins

Diagnostics (what actually exists):

- `Plugin.get(id)` - inspect a plugin instance (`enabled`, `definition`, `resources`)
- `Plugin.list()` / `Plugin.listAll()` - enumerate registered plugins

## `window.CardSpoke.utils` (plugin-facing helper API)

Commonly used methods include:

- Card APIs:
  - `createCard({ title, body, parentId, tags })`
  - `updateCard(cardId, changes)`
  - `getCard(cardId)`
  - `searchCards(query)`
- Tag APIs:
  - `getTags(cardId)`
  - `addTag(cardId, tag)`
  - `removeTag(cardId, tag)`
  - `setTags(cardId, tags)`
  - `getAllTags()`
- Theme/accessibility APIs:
  - `setTheme(theme)` / `getTheme()`
  - `setTypography(preset)` / `getTypography()`
  - `setHighContrast(enabled)` / `isHighContrast()`
  - `getAccessibilitySettings()`
- Misc:
  - `showToast(message, type, duration)`
  - `getDatasetMeta()`

Use these APIs instead of directly mutating `store` unless you are contributing to core itself.

---

## 9) Override System (App Layer Only)

App-layer plugins can set `overrides` to alter high-level behavior. Declaring **any** `overrides` object forces HIGH risk (installs suspended).

Currently **implemented** override:

- `appName: string` — renames the app brand button (`#brandBtn`); applied in `Plugin.enable` (`www/src/core/plugin-api.js`).

Example:

```json
{
  "overrides": {
    "appName": "Research Console"
  }
}
```

Other override keys (e.g. hiding or adding menu items) are **not wired up yet** — the runtime only reads `overrides.appName` today. Do not rely on unimplemented override fields.

Operational advice:

- Keep override scope as narrow as possible
- Document each override in your plugin description/changelog
- Test for interactions with other app-layer plugins

---

## 10) Risk Assessment (How Runtime Scores Plugins)

`Plugin.assessModRisk(pkg)` computes a risk level from the **layer** and whether the package carries JS / CSS / overrides. The exact mapping (in `www/src/core/plugin-api.js`):

- `SAFE` — `theme` layer, CSS only, no JS
- `LOW` — `feature` layer with no overrides
- `HIGH` — `app` layer, or any declared `overrides`
- `MEDIUM` — anything else (e.g. a theme that carries JS)

Only `SAFE`/`LOW` auto-enable on install; `MEDIUM`/`HIGH` install suspended until the user enables them explicitly.

Separately, the **validator** (`PluginValidator.validateJS`) screens plugin JS for blocked patterns (`eval(`, non-`ctx` `new Function(`) and enforces size limits — that is a hard gate at registration, distinct from the risk score above.

Interpretation guidance:

- `SAFE/LOW`: generally acceptable with basic review
- `MEDIUM`: inspect JS behavior and data handling
- `HIGH`: require trust, code review, and provenance checks

---

## 11) Safe Mode and Recovery

Launching with `?safemode` boots with every stored plugin **registered but disabled** — no plugin `setup` runs, so a broken plugin cannot break startup.

Practical use:

1. Open app with `?safemode`
2. Disable/uninstall problematic plugin(s)
3. Reload normally

In safe mode:

- Runtime warns in console
- A warning toast indicates plugins are disabled
- `CardSpoke.Plugin.syncFromStore(true)` still runs — it re-registers stored plugins (so the Plugin Manager can list them) but enables none of them

---

## 12) Concrete Plugin Development Workflow

## Step 1: Pick minimal layer

- Visual-only change → `theme` (CSS only, SAFE risk)
- Add behavior/UI that composes with core → `feature` (CSS+JS, LOW risk)
- Need global/app-level transformation → `app` (CSS+JS+overrides, HIGH risk)

## Step 2: Start from examples

Use `sample-plugins/` closest to your target behavior:

- themes: `sample-plugins/themes/*.json`
- feature-style plugins: `sample-plugins/features/*.json`
- app-layer patterns: `sample-plugins/apps/*.json`

## Step 3: Build iteratively

1. Implement basic `setup()` with logging
2. Add one functional behavior (often injecting UI or registering middleware)
3. Add cleanup in `teardown()` if needed (most cleanup is automatic)
4. Validate install/enable/disable cycle

Example progression:

```js
// Iteration 1: Basic logging
setup: async (ctx) => {
  ctx.logger.info('Plugin enabled');
}

// Iteration 2: Add functionality
setup: async (ctx) => {
  ctx.logger.info('Plugin enabled');
  const cards = ctx.api.data.listCards();
  ctx.logger.info(`Found ${cards.length} cards`);
}

// Iteration 3: Add UI injection
setup: async (ctx) => {
  ctx.logger.info('Plugin enabled');
  const element = document.createElement('div');
  element.textContent = 'Plugin UI';
  ctx.api.ui.inject('#sidebar', element, 'append');
}
```

## Step 4: Validate with dev tools

In console:

```js
// Get plugin instance
window.CardSpoke.Plugin.get('my-plugin');

// List all plugins
window.CardSpoke.Plugin.list();

// Check plugin details
const plugin = window.CardSpoke.Plugin.get('my-plugin');
console.log(plugin.enabled, plugin.definition);
```

## Step 5: Test safe mode fallback

Ensure app remains functional with your plugin fully bypassed by loading with `?safemode`.

---

## 13) Core Contributor Workflow (for `www/src` changes)

1. Edit the relevant source slice(s)
2. Rebuild bundle:

   ```bash
   npm run build
   ```

3. Run tests:

   ```bash
   npm test
   ```

4. Verify plugin compatibility assumptions:
   - middleware operations (`card.create/update/delete/save/render`) still fire
   - the host-bridge window globals and `window.CardSpoke.utils` contract remain intact
   - override behavior unchanged unless intentionally modified
5. Update docs when runtime behavior/contracts change

---

## 14) Testing Matrix You Should Actually Run

For core updates:

- Full automated tests (`npm test`)
- Manual smoke checks:
  - create/update/delete card
  - tag add/remove
  - search and keyboard navigation
  - undo/redo

For plugin updates:

- Install plugin from JSON
- Enable/disable repeatedly
- Reload plugin and verify no duplicate listeners/dom nodes
- Uninstall and verify cleanup
- Validate with/without safe mode
- Run with mixed layers enabled (theme + feature + app)

---

## 15) Security & Safety Rules for plugin Authors

Non-negotiable best practices:

- Do not transmit card data without explicit user intent/consent
- Avoid dynamic code execution patterns unless absolutely required
- Avoid broad DOM rewrites when a narrow target is enough
- Keep network usage transparent and documented
- Prefer feature layer over app layer where possible

If distributing to a team/community:

- Publish source alongside packaged JSON
- Include checksum/version notes
- Require review before enabling app-layer plugins

---

## 16) Common Failure Patterns and Fixes

- **Duplicate UI injection on rerender**
  - Cause: a `card.render` middleware handler appends every time
  - Fix: check for an existing marker node/class before append

- **Broken state after direct mutation**
  - Cause: plugin edits internals without save/render flow
  - Fix: use `ctx.api.data.*` (or `ctx.utils` / `window.CardSpoke.utils`) methods

- **Theme plugin rejected**
  - Cause: non-empty `js` present in theme layer
  - Fix: move logic to feature/app layer

- **Unclear install risk**
  - Cause: package metadata too thin
  - Fix: add clear description, compatibility, and changelog notes

- **Hard-to-debug lifecycle errors**
  - Cause: missing diagnostics
  - Fix: rely on `ctx.logger` (prefixed console output) and inspect state with `CardSpoke.Plugin.get(id)` / `CardSpoke.Plugin.list()`; setup/teardown errors are surfaced as toasts and logged to the console

---

## 17) Quick Reference

## Commands

```bash
npm install
npm run build
npm test
```

## Runtime globals (frozen `window.CardSpoke` surface)

Convenience entry points:

- `window.CardSpoke.registerPlugin(id, definition)` (session-only; registers + enables)
- `window.CardSpoke.installPlugin(pkg)` (persistent; alias of `Plugin.install`)
- `window.CardSpoke.requestPermissions(pluginId, pluginName, permissions)`

Runtime subsystems:

- `window.CardSpoke.Plugin`
- `window.CardSpoke.PluginSandbox` (`{ createFunction }`)
- `window.CardSpoke.Middleware`
- `window.CardSpoke.ComponentRegistry`
- `window.CardSpoke.StorageDriverRegistry` (experimental; not consumed for app persistence)
- `window.CardSpoke.PluginValidator`
- `window.CardSpoke.Permissions`
- `window.CardSpoke.utils`

## Troubleshooting

- Launch with `?safemode` when a plugin breaks startup
- Inspect plugin state with `CardSpoke.Plugin.get(id)` / `CardSpoke.Plugin.list()`; errors surface as toasts and console logs (there is no `devTools` object)

---

## 18) Companion Documents

- `README.md` — top-level orientation and doc index
- `docs/guides/DEVELOPER_GUIDE.md` — core development workflow
- `docs/architecture/PLUGIN_SYSTEM.md` — formal plugin system reference
- `docs/architecture/PLUGIN_INVARIANTS.md` — the stability contract (what must not change)
- `docs/api/API_REFERENCE.md` — API contract details
- `docs/api/PLUGIN_API.md` — per-method `ctx` API reference
- `sample-plugins/` — nine working packages (three per layer) + `TEMPLATE.json`
- `docs/guides/TEST_GUIDE.md` — testing guidance
