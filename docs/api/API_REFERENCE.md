# CardSpoke API Reference

This reference documents the surfaces plugin developers can rely on. It
consolidates the runtime contracts assembled by
`www/src/core/global-api.js` and consumed across `www/src/`.

**Current Version:** 0.21.1 | **Schema Version:** 4

For the narrative guide, worked examples, and lifecycle walkthrough see
[`../architecture/PLUGIN_SYSTEM.md`](../architecture/PLUGIN_SYSTEM.md). For the stability contract (what
must not change) see [`../architecture/PLUGIN_INVARIANTS.md`](../architecture/PLUGIN_INVARIANTS.md).

## Global objects

`window.CardSpoke` is assembled and frozen by
`www/src/core/global-api.js` before any app-layer code runs. It exposes:

Convenience entry points:

- **`registerPlugin(id, definition)`** — registers **and enables** a plugin
  (session-only; not persisted). Returns `Promise<string>`.
- **`installPlugin(pkg)`** — persistent install (alias of `Plugin.install`).
- **`requestPermissions(pluginId, pluginName, permissions)`** — prompts the
  user to grant permissions. Returns `Promise<boolean>`.

Runtime subsystems:

- **`Plugin`** — the plugin manager (see below).
- **`PluginSandbox`** — `{ createFunction(code) }`, the single compilation
  point for setup-body strings.
- **`Middleware`** — the priority pipeline (`register`, `unregister`, `run`,
  `list`, `clear`).
- **`ComponentRegistry`** — component overrides (`register`, `unregister`,
  `get`, `list`).
- **`StorageDriverRegistry`** — pluggable storage drivers (experimental; not
  yet consumed by the host app).
- **`PluginValidator`** — `validate(pkg)`, `validateCSS(css)`,
  `validateJS(js)`.
- **`Permissions`** — grant/revoke/query helpers.
- **`utils`** — async host helpers (see [Utilities](#utilities)).

Inside plugin code, prefer `ctx.api.*` — it is permission-checked and
resource-tracked. The globals exist for the host app, for development, and
for advanced app-layer plugins.

## Plugin package format

Plugins are JSON packages; `js` is the body of the setup function (receives
`ctx`). See [`../architecture/PLUGIN_SYSTEM.md`](../architecture/PLUGIN_SYSTEM.md#plugin-package-format)
for the full field reference.

```json
{
  "id": "plugin-id",
  "manifest": {
    "id": "plugin-id",
    "name": "Plugin Name",
    "version": "1.0.0",
    "author": "Author Name",
    "description": "Plugin description",
    "layer": "feature",
    "permissions": ["ui-override", "data-modify"]
  },
  "css": "/* optional */",
  "js": "ctx.api.ui.showToast('hello', 'info');",
  "teardownJs": "/* optional */"
}
```

For session-only development you may register a module-form definition with
real `setup`/`teardown` functions via `registerPlugin` — but only string
`js`/`teardownJs` packages survive a reload.

## Plugin manager (`window.CardSpoke.Plugin`)

- **`install(pkg)`** — validates, normalizes top-level `id`/`config`/
  `overrides` into the manifest, registers, persists to `store.plugins`, and
  auto-enables SAFE/LOW-risk layers. Reinstalling an existing id updates it
  in place. Returns the installed id. A failing setup leaves the plugin
  installed but suspended; a `js` syntax error throws and installs nothing.
- **`register(id, definition)`** — registers a definition (throws on a
  duplicate id). Does not enable or persist.
- **`unregister(id)`** — disables if enabled, cleans up all tracked
  resources, revokes granted permissions, and removes the store entry.
- **`enable(id)`** — checks permissions (consent dialog), applies CSS, runs
  setup, and persists `enabled: true`. Rolls back CSS/resources and rethrows
  if setup fails.
- **`disable(id)`** — runs teardown, removes CSS, cleans up resources, and
  persists `enabled: false` ("suspend").
- **`get(id)`** — the plugin instance (`{ id, definition, context, enabled,
  resources }`) or `undefined`.
- **`list()` / `listAll()`** — array of all registered instances.
- **`assessModRisk(pkg)`** — `'SAFE'` | `'LOW'` | `'MEDIUM'` | `'HIGH'`:
  - `SAFE` — theme layer, CSS only, no JS
  - `LOW` — feature layer, no overrides
  - `HIGH` — app layer, or any overrides declared
  - `MEDIUM` — anything else
- **`syncFromStore(safeMode)`** — boot-time restore: re-registers stored
  plugins from their persisted `js`/`teardownJs` strings and re-enables the
  enabled ones. Idempotent; derives `safeMode` from `?safemode` when the
  argument is omitted.
- **`notifyDataUpdate(event)`** — fans a data-change event out to all
  `ctx.api.data.onUpdate` listeners.
- **`buildSettingsPanel(id)`** — builds an auto-generated settings panel
  (`HTMLElement`) from `manifest.config`; edits persist.

## Plugin context (`ctx`)

- **`ctx.modId`** — the plugin id.
- **`ctx.appVersion`** — `'0.21.1'`.
- **`ctx.schemaVersion`** — `4`.
- **`ctx.config`** — live `manifest.config` object (the settings panel writes
  here). Present when the manifest declares `config`.
- **`ctx.utils`** — async host helpers (same object as
  `window.CardSpoke.utils`).
- **`ctx.logger`** — `log()`, `info()`, `warn()`, `error()` (prefixed).
- **`ctx.api`** — `ui`, `data`, `storage`, `events`, `middleware`,
  `network`, `filesystem`.

Everything created through `ctx.api.*` is tracked and removed automatically
when the plugin is disabled or unregistered.

### UI API (`ctx.api.ui`) — permission: `ui-override`

- **`inject(selector, element, position)`** — insert relative to the first
  match. Position: `'before'`, `'after'`, `'prepend'`, `'append'` (default).
  Returns a cleanup function. Tracked.
- **`replace(selector, element)`** — replace the matched element (original
  restored on cleanup). Returns a cleanup function. Tracked.
- **`registerComponent(name, component)`** — register a component override
  (`component.priority` optional). Tracked. Names the app queries: `Card`,
  `Header`, `Sidebar`, `SearchBar`.
- **`unregisterComponent(name)`** — remove a component registration.
- **`showToast(message, type, duration)`** — `'info'` | `'success'` |
  `'warning'` | `'error'`. No permission required.

### Data API (`ctx.api.data`) — permission: `data-modify` for writes

Backed by the host-bridge globals (`window.createCard`, `window.updateCard`,
…) assigned in `systems.js`. Reads are ungated; writes require
`data-modify`.

- **`onUpdate(callback)`** — notified with `{ type, cardId, card? }` on each
  data change (`type` is `'card.create'` | `'card.update'` | `'card.delete'`).
  Returns a cleanup function. Tracked.
- **`getCard(id)`** — cloned card or `undefined`.
- **`listCards()`** — array of cloned cards.
- **`createCard(data)`** — `{ title, body, parentId, tags }`; tags applied in
  the same call. Returns the new card id.
- **`updateCard(id, updates)`** — returns the updated clone.
- **`deleteCard(id)`** — returns `true` on success.
- **`getTags(cardId)` / `getAllTags()`** — read tags.
- **`addTag(cardId, tag)` / `removeTag(cardId, tag)` / `setTags(cardId, tags)`**
  — mutate tags.

### Storage API (`ctx.api.storage`) — permission: `storage`

Plugin-namespaced (`plugin_<id>_`), localStorage-backed, async.

- **`get(key)`** — parsed value or `null`.
- **`set(key, value)`** — JSON-serialized.
- **`remove(key)`** — delete a key.
- **`list(prefix)`** — keys in the namespace (namespace stripped).
- **`getNamespace()`** — the `plugin_<id>_` prefix.

### Events API (`ctx.api.events`)

A **global** bus shared across plugins. No permission required.

- **`on(eventName, callback)`** — subscribe; returns a cleanup function.
  Tracked.
- **`off(eventName, callback)`** — unsubscribe.
- **`emit(eventName, ...args)`** — emit (variadic).
- **`once(eventName, callback)`** — subscribe once.

### Middleware API (`ctx.api.middleware`)

Intercept core operations. Registrations are namespaced `<pluginId>:<name>`
and tracked.

- **`register({ name, priority?, operations?, handler })`** — returns an
  unregister function. `handler(mw, next)`; call `await next()` unless
  intercepting. Host operations: `card.create` `[cardId, card]`,
  `card.update` `[cardId, card]`, `card.delete` `[cardId]`, `card.save`
  `[store]` (`preventDefault()` aborts the save), `card.render`
  `[card, cardTileElement]`.
- **`unregister(name)`** — remove one of this plugin's middlewares.

### Network API (`ctx.api.network`) — permission: `network`

- **`fetch(url, options)`** — permission-gated `window.fetch`.
- **`xhr()`** — permission-gated `XMLHttpRequest`.

### Filesystem API (`ctx.api.filesystem`) — permission: `filesystem`

- **`readFile(path, options)`** / **`writeFile(path, data, options)`** — via
  Capacitor Filesystem (mobile); throws where unavailable.

## Resource management

Automatically cleaned up on disable/unregister:

- DOM elements from `ctx.api.ui.inject()` / `replace()`
- Components from `ctx.api.ui.registerComponent()`
- Middleware from `ctx.api.middleware.register()`
- Event listeners from `ctx.api.events.on()` and `ctx.api.data.onUpdate()`
- Injected CSS (`<style data-plugin-id="…">`)

Anything created outside these APIs (timers, observers) should be cleaned up
in `teardownJs`.

## Permissions

Declared in `manifest.permissions`, checked at enable, prompted via a consent
dialog, persisted in localStorage (`cardspoke_plugin_permissions`), and
revoked when the plugin is deleted.

- **`ui-override`** — inject/replace DOM, register components
- **`storage`** — plugin-namespaced storage
- **`network`** — `ctx.api.network`
- **`filesystem`** — Capacitor filesystem (mobile)
- **`core-override`** — reserved for future core-function overrides
- **`data-modify`** — mutating `ctx.api.data` calls. Read-only calls
  (`getCard`, `listCards`, `getTags`, `getAllTags`, `onUpdate`) do not
  require it.

## Utilities

`window.CardSpoke.utils` (also `ctx.utils`) is populated in place by
`www/src/storage.js` with async host helpers: `createCard`, `updateCard`,
`getCard`, `searchCards`, tag helpers, `showToast`, `getDatasetMeta`, theme
and typography getters/setters, and accessibility queries.

`getDatasetMeta()` returns:

- `name` — dataset name
- `cardCount` — total cards
- `rootCardCount` — root-level cards
- `bookmarkCount` — bookmarked cards
- `recentCount` — recent cards tracked
- `modCount` — installed plugins
- `schemaVersion` — current schema version
- `appVersion` — current app version

Prefer `ctx.api.*` for anything permission-sensitive; `ctx.utils` is a
convenience surface for common host operations.
