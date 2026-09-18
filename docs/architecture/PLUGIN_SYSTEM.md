# CardSpoke Plugin System

This is the canonical guide to CardSpoke's plugin system: what plugins are,
how to build one for each of the three layers, how the lifecycle works
(install, enable, suspend, delete, reload), and the complete `ctx` API
reference.

**App Version:** 0.21.1 | **Schema Version:** 4

Companion documents:

- [`PLUGIN_INVARIANTS.md`](./PLUGIN_INVARIANTS.md) — the stability contract:
  everything that must **not** change or the plugin system breaks. Read it
  before touching runtime code.
- [`../../sample-plugins/`](../../sample-plugins/) — nine working packages (three
  per layer) plus `TEMPLATE.json`. Every sample installs, enables, suspends,
  deletes, and survives reload; `tests/plugin-lifecycle.test.js` proves it on
  every test run.

## Overview

CardSpoke stays intentionally small; plugins are the supported way to change
it — from a coat of paint to a different product. The system has three
architectural layers, preserved from the original design:

| Layer | Contents | Risk | Enable behavior |
|---|---|---|---|
| `theme` | CSS only | SAFE | Auto-enabled on install (no JavaScript runs, no worker spun up) |
| `feature` | CSS + JS | LOW (unless it declares overrides) | Enabled at install only after required consent (JS runs in a worker) |
| `app` | CSS + JS + overrides | HIGH | Installed **suspended**; the user must enable it manually |

The runtime lives in `www/src/core/` and runs JavaScript packages in dedicated workers. Version 0.21.1 uses both worker isolation and explicit `plugin-code` trust consent. The worker has no DOM; common network, storage and nested-worker globals are disabled on the global object and its prototypes. Host RPC dispatch accepts only explicitly exported methods, and vnode rendering rejects active elements, inline event-handler strings and unsafe URLs.

This is not a complete hostile-code security sandbox. Dynamic `import()` cannot be disabled by deleting global properties. An HTTP worker does not inherit the page's meta CSP; deployments need a worker response CSP to constrain module loading. Plugins can read unlocked cards and middleware is available without a separate permission. Permission checks constrain the host API, not every possible browser capability. Only run trusted plugin code. Existing JavaScript plugins require the new trust grant on their next enable; CSS-only themes do not.

Safe Mode registers plugins without enabling them. Startup, initialization and RPC deadlines terminate failing workers. Tracked UI and components are cleaned up on suspend; component unregistration cannot remove another plugin's registration.

## Quick Start: your first plugin in five minutes

1. Run the app (`npm run dev` or open the built `www/index.html`).
2. Open the hamburger menu → **Plugin Manager** → **Create** tab.
3. Manifest:

   ```json
   {
     "name": "Hello CardSpoke",
     "version": "1.0.0",
     "author": "You",
     "layer": "feature",
     "permissions": ["ui-override"]
   }
   ```

4. JavaScript — this is the **body of your setup function**, compiled as an
   `async function` and run inside your plugin's own sandboxed worker. It
   receives the plugin context as `ctx`; there is no `document` or `window`
   in scope, so UI is described with `ctx.h(...)` instead of
   `document.createElement(...)`:

   ```javascript
   var el = ctx.h('span', {}, 'Hello!');
   await ctx.api.ui.inject('.header', el, 'append');
   ctx.api.ui.showToast('Hello plugin enabled', 'success');
   ```

5. Click **Save & Register**, grant the `ui-override` permission, and the
   badge appears in the header. Reload the page — it's still there. Suspend
   or remove it from the **Installed** tab; the badge disappears immediately
   (and its worker is terminated).

## Plugin Package Format

A plugin is a single JSON file:

```json
{
  "id": "my-plugin",
  "manifest": {
    "id": "my-plugin",
    "name": "My Plugin",
    "version": "1.0.0",
    "author": "Your Name",
    "description": "What it does",
    "layer": "feature",
    "permissions": ["ui-override"],
    "compatibility": ">=0.21.0",
    "config": { "workMinutes": 25 },
    "overrides": { "appName": "My App" },
    "dependencies": ["other-plugin-id"]
  },
  "css": "/* injected while enabled, removed when suspended */",
  "js": "/* SETUP BODY — runs as async function(ctx) { ...this string... } inside a dedicated worker, on every enable */",
  "teardownJs": "/* optional extra cleanup — same ctx object as setup, same worker */"
}
```

Field reference:

| Field | Required | Notes |
|---|---|---|
| `id` (top level) | recommended | Lowercase alphanumeric + hyphens. Normalized into `manifest.id` at install; if both are absent the id is derived by slugging `manifest.name`. |
| `manifest.name` | **yes** | Human-readable name (string). |
| `manifest.version` | **yes** | Semver string. |
| `manifest.layer` | **yes** | `theme`, `feature`, or `app`. |
| `manifest.author` | recommended | Shown in the Plugin Manager. |
| `manifest.description` | recommended | Shown in the Plugin Manager and gallery. |
| `manifest.permissions` | if JS uses gated APIs | See [Permissions](#permissions). |
| `manifest.config` | no | Key/value defaults; surfaced to code as `ctx.config` and to users as an auto-generated settings panel. Value types (boolean/number/string) drive the input type. Changes persist. |
| `manifest.overrides` | no | App-layer host overrides. Currently implemented: `appName` (renames the app brand button). Declaring any override forces HIGH risk. |
| `manifest.dependencies` | no | Array of plugin ids that must already be installed. |
| `manifest.compatibility` | no | Informational version range. |
| `css` | themes: yes | Max 100 KB. Sanitized: `@import`, `javascript:`, `expression()`, `behavior:`, `-moz-binding` are stripped. |
| `js` | features/apps: yes | Max 500 KB. **The body of your setup function**, compiled as an `async function(ctx)` and run inside a dedicated Worker — see below. `eval(` and bare `new Function(` are rejected by the validator. |
| `teardownJs` | no | Extra cleanup code (timers, subscriptions). Tracked resources are cleaned automatically without it. Runs in the same worker as `js`. |

`config` and `overrides` may also appear at the package top level (the
installer normalizes them into the manifest; explicit manifest values win).

### How `js` executes — inside a sandboxed worker

The `js` string is compiled once per **enable**, inside a brand-new, dedicated
Worker for that plugin instance:

```text
new AsyncFunction('ctx', '"use strict";\n' + js)
```

and invoked as `await setup(ctx)`. That worker has no DOM, no `window`, no
`localStorage`, and no raw `fetch`/`XMLHttpRequest`/`WebSocket`/`indexedDB`/
`caches` — those identifiers are stripped before your code ever runs. That
means:

- Write **statements**, not a wrapper: `await ctx.api.ui.showToast('hi')`,
  not `(function() { ... })()` around a registration call.
- **Use `await` freely.** The body compiles as an `AsyncFunction`, so
  top-level `await` works directly against the (now fully async) `ctx.api` —
  no need to wrap everything in an inner `async` IIFE.
- **Build UI with `ctx.h(tag, props, children)`, not `document.createElement`**
  — see [Building UI](#building-ui-ctxh-and-the-vnode-model) below.
  `document`/`window` simply don't exist inside the worker; referencing them
  throws `ReferenceError`.
- **Never call `window.CardSpoke.registerPlugin(...)` from `js`** — the
  package IS the plugin; installing it registers it. Self-registration
  throws a duplicate-id error. (It's also unreachable — there is no
  `window` inside the worker.)
- The code re-runs on every enable (including at boot after a reload), and
  everything it created via `ctx.api.*` is removed on every disable
  (including terminating the worker itself — any pending timers inside it
  die with it).
- State that `teardownJs` needs (interval ids, subscriptions) should be
  stashed on `ctx` (e.g. `ctx._myTimer = ...`) — teardown receives the same
  `ctx` object, in the same worker.
- A setup that never resolves (hangs, or spins in an infinite loop) is
  time-boxed; on timeout the worker is **terminated outright**, not just
  abandoned — a real capability the pre-sandbox architecture never had.

Plugins written as real modules (with `setup`/`teardown` **functions**, not
strings) can be registered programmatically — see
[Loading plugins](#loading-plugins-all-the-ways) — but only string-form
packages survive a reload (functions can't be persisted), and only
string-form packages are sandboxed. A function-form registration is
documented as session-only "host code" (it can only come from code the
embedding app itself calls, never from a downloaded/imported package) and
runs directly on the main thread with the pre-sandbox synchronous `ctx.api`
shape.

## Building UI: `ctx.h` and the vnode model

Because a plugin's worker has no DOM, `ctx.api.ui.inject`/`replace`/
`registerComponent` and vnode-returning `card.render` decorators all take a
**vnode** (a plain, serializable description of an element) instead of a real
`HTMLElement`. Build one with the `ctx.h` helper the runtime provides:

```javascript
ctx.h(tag, props, children)
```

- `tag`: an HTML tag name string (`'div'`, `'button'`, ...).
- `props`: a plain object — `className`, `style` (a CSS string or a
  `{prop: value}` object), `dataset` (a `{key: value}` object), any plain
  attribute (`href`, `title`, `aria-*`, ...), and `on<event>` handlers
  (`onclick`, `oninput`, `onchange`, `onkeydown`, ...) as plain functions.
- `children`: a string/number (text), a nested `ctx.h(...)` vnode, or an
  array of either, or omitted.

```javascript
var btn = ctx.h('button', {
  className: 'my-btn',
  onclick: function(event) {
    // event is a plain, safe descriptor — { type, key, code, clientX,
    // clientY, target: { value, checked, dataset } } — never a real DOM
    // Event object (Events aren't structured-clonable, and shouldn't be
    // exposed raw anyway). Return { preventDefault: true } and/or
    // { stopPropagation: true } if you need those.
    ctx.logger.info('clicked');
  }
}, 'Click me');

await ctx.api.ui.inject('.header', btn, 'append');
```

`ui.inject`/`ui.replace` return a handle instead of a bare undo function,
since a sandboxed plugin can't hold a live node reference to mutate later:

```javascript
var handle = await ctx.api.ui.inject('.header', vnode, 'append');
await handle.update(newVnode);   // replace this element's attrs/children in place
await handle.remove();           // undo the injection (also happens automatically on disable)
```

`ctx.api.ui.registerComponent('Card' | 'Header' | 'Sidebar' | 'SearchBar', { render, priority })`
works the same way, except `render(props)` now returns a vnode (it may be
`async`) instead of synchronously returning an `HTMLElement` — see
[Component overrides](#component-overrides).

## Lifecycle

```text
install(pkg) ──► validate ──► register ──► persist to store.plugins
                                   │
                     SAFE / LOW risk│ HIGH risk
                          auto─enable│ stays suspended
                                   ▼
        ┌───────────── enable(id) ◄────────── user clicks Enable
        │   permission consent → apply CSS → spin up worker → run setup(ctx)
        │   (failure: worker terminated, CSS + resources rolled back)
        ▼
     ENABLED ── disable(id) ──► teardown(ctx) → terminate worker → remove CSS
        ▲                        → cleanup resources → persist enabled=false
        └── enable(id) ◄──┘     ("suspend"; survives reload)

     unregister(id) = delete: disable + cleanup + revoke permissions
                      + remove from store.plugins (persisted)
```

Key guarantees (enforced by `tests/plugin-lifecycle.test.js`):

- **Add**: `install()` persists the package (source strings, not compiled
  functions) into the active dataset's `store.plugins` and saves.
  Reinstalling the same id **updates in place** — no `id-1` duplicates; the
  old instance is fully unregistered first.
- **Suspend**: `disable()` (the UI's *Suspend* button) runs teardown,
  terminates the plugin's worker, cleans up every tracked resource, and
  persists `enabled: false`. A suspended plugin stays suspended across
  reloads.
- **Delete**: `unregister()` also revokes the plugin's granted permissions
  and deletes the store entry.
- **Reload**: at boot (`systems.js`), after `load()` completes,
  `Plugin.syncFromStore()` re-registers every stored plugin from its
  persisted `js`/`teardownJs` strings and re-enables (spinning up a fresh
  worker for) the ones marked enabled. The sync is idempotent and re-runs
  automatically when an IndexedDB or local-file dataset finishes its async
  load.
- **Safe mode**: `index.html?safemode` registers everything but enables
  nothing — no workers are created.
- **Failure containment**: a package whose `js` fails to compile does not
  install (a cheap main-thread syntax pre-check catches this before any
  worker is ever created); a package whose setup throws, times out, or hangs
  stays installed but suspended (its worker terminated), with the error
  surfaced as a toast and in the console.

## The `ctx` API

Every sandboxed plugin gets its own worker-local context:

```text
ctx
├─ modId            plugin id (string)
├─ appVersion       e.g. '0.21.0'
├─ schemaVersion    e.g. 4
├─ config           manifest.config (live; settings panel writes propagate on next enable)
├─ h                ctx.h(tag, props, children) — build a vnode, see above
├─ logger           log / info / warn / error (prefixed console, relayed to the host)
├─ utils            async host helpers (same names as window.CardSpoke.utils)
└─ api
   ├─ ui            vnode injection + components + toasts   [ui-override]
   ├─ data          cards + tags + change events             [data-modify for writes]
   ├─ storage       namespaced key-value storage              [storage]
   ├─ events        global cross-plugin event bus
   ├─ middleware    core-operation interceptors + card.render decorators
   ├─ network       fetch                                     [network]
   └─ filesystem    Capacitor file access                     [filesystem]
```

Everything registered through `ctx.api.*` is tracked per plugin and removed
automatically on disable/unregister (including terminating the worker
itself). **Every method below is asynchronous** — always `await` it (or
handle the returned Promise) — even `ctx.api.data.getCard`, which used to be
synchronous before the sandbox.

### `ctx.api.ui` — permission: `ui-override`

| Method | Description |
|---|---|
| `inject(selector, vnode, position?)` | Build real DOM from `vnode` (see [Building UI](#building-ui-ctxh-and-the-vnode-model)) and insert it relative to the first match of `selector`. `position`: `'append'` (default), `'prepend'`, `'before'`, `'after'`. Returns `{ remove(), update(vnode) }`. Tracked. |
| `replace(selector, vnode)` | Replace the matched element; the original is restored on cleanup. Returns `{ remove(), update(vnode) }`. Tracked. |
| `registerComponent(name, { render, priority? })` | Register a UI component override (see [Component overrides](#component-overrides)). `render(props)` returns a vnode (may be `async`). Tracked. |
| `unregisterComponent(name)` | Remove a component registration. |
| `showToast(message, type?, duration?)` | Toast notification (`'info'`, `'success'`, `'error'`, `'warning'`). No permission required. |

### `ctx.api.data` — permission: `data-modify` for writes

| Method | Description |
|---|---|
| `getCard(id)` | Deep clone of one card, or `undefined`. No permission. |
| `listCards()` | Deep clones of all cards. No permission. |
| `createCard({ title, body, parentId, tags })` | Create a card (tags applied in the same call). Resolves to the new card id. |
| `updateCard(id, updates)` | Update fields; resolves to the updated clone. |
| `deleteCard(id)` | Delete a card (and its children). |
| `getTags(cardId)` / `getAllTags()` | Read tags. No permission. |
| `addTag(cardId, tag)` / `removeTag(cardId, tag)` / `setTags(cardId, tags)` | Mutate tags. |
| `onUpdate(callback)` | `callback` is invoked with `{ type: 'card.create' \| 'card.update' \| 'card.delete', cardId, card? }` after each data change (from any plugin). Returns an unsubscribe function. Tracked. |

### `ctx.api.storage` — permission: `storage`

Async key-value storage namespaced to `plugin_<id>_`. The namespace is now a
real boundary, not just a naming convention — a plugin has no way to reach
raw `localStorage`/`indexedDB` at all, so it cannot read or collide with
another plugin's stored values even by accident.

| Method | Description |
|---|---|
| `get(key)` | Returns the stored JSON value (parsed), or `null`. |
| `set(key, value)` | Stores `JSON.stringify(value)`. |
| `remove(key)` | Deletes the key. |
| `list(prefix?)` | Keys in the plugin's namespace (namespace stripped). |
| `getNamespace()` | The `plugin_<id>_` prefix. |

### `ctx.api.events` — no permission

A **global** bus shared by all plugins (cross-plugin communication works,
even across different workers — the host relays). `on(event, cb)` (tracked,
returns unsubscriber), `off(event, cb)`, `once(event, cb)`,
`emit(event, ...args)`. Handler errors are caught and logged, never
propagated to the emitter.

### `ctx.api.middleware` — no permission

Intercept core operations. Registrations are namespaced (`<pluginId>:<name>`)
and tracked.

```javascript
ctx.api.middleware.register({
  name: 'my-interceptor',        // required
  priority: 10,                  // higher runs first (default 0)
  operations: ['card.save'],     // default ['*']
  handler: async function(mw, next) {
    // mw.operation, mw.args, mw.preventDefault(), mw.stopPropagation()
    await next();                // ALWAYS call next() unless intercepting
  }
});
```

Operations fired by the host app:

| Operation | `mw.args` | `preventDefault()` effect |
|---|---|---|
| `card.create` | `[cardId, card]` | none (fired after creation) |
| `card.update` | `[cardId, card]` | none (fired after update) |
| `card.delete` | `[cardId]` | none (fired after delete) |
| `card.save` | `[store]` | **aborts the save** |

`card.create`/`update`/`delete`/`save` keep the full onion-model contract
above (`next()`, `stopPropagation()`, `preventDefault()`) — the handler runs
inside your worker, and the host round-trips `next()` back into the real
pipeline (including other plugins' middleware, possibly in other workers)
exactly as if it ran locally.

**`card.render` is different — see the next section.** It does not use the
`(mwCtx, next)` shape above at all.

### The `card.render` decorator contract

`card.render` fires once per card tile, in a hot render-batch loop (up to 60
tiles per batch, on every scroll/search/navigation) — too frequent for a
cross-thread `next()` round trip per decorator. It uses a different,
simpler handler shape, registered through the same `ctx.api.middleware.register`
call:

```javascript
ctx.api.middleware.register({
  name: 'my-decorator',
  operations: ['card.render'],
  // (card, tileSnapshot) => patch | Promise<patch> | null — NOT (mwCtx, next)
  handler: async function(card, tileSnapshot) {
    // tileSnapshot: { classList, hasBody, hasTags, tagTexts, isCompact } —
    // a serializable summary of the already-built default tile. There is
    // no live DOM node here (see PLUGIN_INVARIANTS.md §7 for why).
    if (!tileSnapshot.hasTags) return null;
    return {
      addClass: ['my-flag'],
      removeClass: [],
      setStyle: { '': { opacity: '0.8' } },                 // '' = the tile root
      setStyleByIndex: { '.card-tag': [{ color: 'red' }] }, // per-matched-element, by DOM order
      appendChildren: { '.card-content': [ctx.h('span', {}, 'note')] },
      prependChildren: {}
    };
  }
});
```

The host applies each registered decorator's patch to the real tile, in
registration order, after all decorators for that render batch resolve (or
after a short deadline — a slow/hung decorator just doesn't apply that pass;
it never blocks or stutters scrolling). There is no `next()`/
`stopPropagation()`/`preventDefault()` for this operation — every registered
decorator's patch is independent and additive by design. See
`sample-plugins/features/card-color-tags.json` and `card-reading-time.json`
for complete working examples.

A custom `registerComponent('Card', { render })` (full tile replacement) and
`card.render` decorators (partial patches to the default tile) share the same
underlying batched round trip — installing a `Card` component costs nothing
extra if no `card.render` decorator is also registered, and vice versa.
Newly enabling either kind of Card customization applies starting from the
next natural render pass (navigation, search keystroke, or scroll) — there is
no retroactive repaint of tiles already on screen at the moment of enable.

### `ctx.api.network` — permission: `network`

`fetch(url, options)` — a permission-gated wrapper that always performs the
real request on the **main thread** on the plugin's behalf (never inside the
worker, even once granted) and returns a serializable Response-shaped object
(`ok`, `status`, `statusText`, `url`, `headers.get(name)`,
`text()`/`json()`/`arrayBuffer()`). `xhr()` is not available in the sandboxed
runtime — `XMLHttpRequest`'s stateful, event-driven shape doesn't cross a
Worker boundary safely; use `fetch` instead.

### `ctx.api.filesystem` — permission: `filesystem`

`readFile(path, options)` / `writeFile(path, data, options)` via Capacitor
(mobile builds); throws on platforms without a filesystem. Like `network`,
the real Capacitor bridge call always happens on the main thread.

### `ctx.utils`

Async convenience helpers provided by the host app (also at
`window.CardSpoke.utils`): `createCard`, `updateCard`, `getCard`,
`searchCards`, tag helpers, `showToast`, `getDatasetMeta`, theme and
typography getters/setters, and accessibility queries. See
`www/src/storage.js` (the `CardSpoke.utils API` block) for the full list.

## Permissions

| Permission | Grants |
|---|---|
| `ui-override` | DOM injection/replacement, component registration |
| `data-modify` | Creating, updating, deleting cards and tags |
| `storage` | The plugin's namespaced key-value storage |
| `network` | `ctx.api.network.fetch` |
| `filesystem` | Capacitor file access (mobile) |
| `core-override` | Reserved for future core-function overrides |

Declare host capabilities in `manifest.permissions`. The runtime adds `plugin-code` for every package containing JavaScript, even when the manifest declares no permissions. Denial leaves the plugin disabled. Grants persist under `cardspoke_plugin_permissions` until revoked or the plugin is deleted. Legacy `cardspoke_plugin_trust` values are not imported into the new grant.

Calling a gated API without the permission throws
`Plugin does not have <permission> permission`.

## Component overrides

Register with priority; the highest-priority registration wins:

```javascript
ctx.api.ui.registerComponent('Card', {
  priority: 10,
  render: async function(props) {
    // props: { card, isSelected, opts }
    return ctx.h('button', {
      onclick: function() { /* selecting a card is handled by the host */ }
    }, '🃏 ' + (props.card.title || 'Untitled'));
  }
});
```

Component names the app queries:

| Name | Render props | When applied |
|---|---|---|
| `Card` | `{ card, isSelected, opts }` | Batched per render pass (scroll/search/navigation) — see [the card.render section](#the-cardrender-decorator-contract) |
| `Header` | `{ header }` | Once at boot (`applyRegistryComponents`) — takes effect on next reload |
| `Sidebar` | `{ panel }` | Once at boot — next reload |
| `SearchBar` | `{ wrapper }` | Once at boot — next reload |

If a custom component throws or its render doesn't resolve within a short
deadline, the app falls back to the default renderer for that render pass.
For live header/sidebar changes use `ctx.api.ui.inject`/`replace` instead —
those are tracked and reversible without a reload.

## Loading plugins (all the ways)

1. **Plugin Manager UI** (hamburger menu → Plugin Manager):
   - *Install* tab — upload a `.json` package or install from a URL.
   - *Gallery* tab — curated list from
     `sample-plugins/manifest.json` on GitHub, one-click install.
   - *Create* tab — write manifest/JS/CSS in the app; saved persistently.
   - *Installed* tab — Enable / Suspend / Remove, with risk and state badges.
2. **Programmatic install** (persistent, sandboxed — string-form `js`):

   ```javascript
   await window.CardSpoke.Plugin.install(pkg);   // or
   await window.CardSpoke.installPlugin(pkg);
   ```

3. **Session-only registration** (real functions, host code, **not
   sandboxed** — for development; not persisted, gone after reload):

   ```javascript
   await window.CardSpoke.registerPlugin('dev-plugin', {
     manifest: { name: 'Dev Plugin', version: '1.0.0', layer: 'feature' },
     setup: async (ctx) => { /* real function — session only, runs on the main thread */ },
     teardown: async (ctx) => { /* optional */ },
     css: ''
   }); // registers AND enables
   ```

4. **ES-module dev loader** — `www/src/examples/dynamic-plugin-loader.js`
   shows `import()`-based loading of module plugins from URLs/files. These
   register with real `setup`/`teardown` functions, so — like all
   function-form registrations — they run unsandboxed, on the main thread;
   only download/import code you already trust through this path.

## The `window.CardSpoke` surface

Assembled and frozen by `www/src/core/global-api.js` before any app code
runs. Members (shape is a stability contract — see
[`PLUGIN_INVARIANTS.md`](./PLUGIN_INVARIANTS.md)):

| Member | Purpose |
|---|---|
| `registerPlugin(id, definition)` | Register + enable (session-only, host code, unsandboxed). |
| `installPlugin(pkg)` | Persistent install (alias of `Plugin.install`; sandboxed if `pkg.js` is a string). |
| `requestPermissions(id, name, perms)` | Ask the user for permissions. |
| `Plugin` | Full manager: `install`, `register`, `enable`, `disable`, `unregister`, `get`, `list`/`listAll`, `assessModRisk`, `syncFromStore`, `notifyDataUpdate`, `buildSettingsPanel`, `getCardRenderPluginIds`, `renderBatch`. |
| `PluginSandbox(js)` | Syntax-check a setup-body string (throws on bad JS, otherwise returns `undefined`) — the runtime's single main-thread compile point. Does **not** execute the code; real execution always happens inside a plugin's own worker. |
| `Middleware` | The pipeline (host-fired operations; prefer `ctx.api.middleware`). |
| `ComponentRegistry` | Component registry (prefer `ctx.api.ui.registerComponent`). |
| `StorageDriverRegistry` | Registry for custom storage drivers (experimental; the host app does not yet consume it). |
| `PluginValidator` | `validate(pkg)`, `validateCSS(css)`, `validateJS(js)`. |
| `Permissions` | `hasPermission`, `grantPermissions`, `revokePermissions`, … |
| `utils` | Async host helpers (see `ctx.utils`). |

Prefer `ctx.api.*` inside plugin code — it is permission-checked, sandboxed,
and resource-tracked. The globals exist for the host app, for development,
and for advanced host-code integrations.

## Distributing plugins

- Publish the `.json` package anywhere; users install via URL.
- To appear in the in-app Gallery, add an entry to
  `sample-plugins/manifest.json` (`id`, `name`, `description`, `layer`,
  `url`) in a PR. `tests/sample-extensions.test.js` verifies gallery
  entries point at real packages.
- Start from [`sample-plugins/TEMPLATE.json`](../../sample-plugins/TEMPLATE.json).

## Testing your plugin

`tests/plugin-lifecycle.test.js` shows the harness pattern: a fake
`window`/`document`, a real Node `worker_threads`-backed `Worker` global
(`tests/helpers/fake-worker-global.js`, which runs the actual
`plugin-worker-bootstrap.js` source under test — real thread isolation, not a
mock), the real runtime imported from `www/src/core/plugin-api.js`,
permissions pre-granted with `Permissions.grantPermissions(id, perms)`, then:

```javascript
const id = await Plugin.install(myPkg);
await Plugin.disable(id);
// simulate reload:
const persisted = JSON.parse(JSON.stringify(window.store));
resetForTesting(); window.store = persisted;
await Plugin.syncFromStore(false);
```

Run everything with `npm test`. If you add a sample package, the
sample-extensions suite validates it automatically.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Plugin validation failed …" | Manifest missing `name`/`version`/`layer`, or JS contains `eval(`/`new Function(`, or size limits exceeded. |
| "Plugin … is already registered" | Your `js` calls `registerPlugin` — remove it; packages self-register via `install()`. |
| "Plugin does not have X permission" | Add the permission to `manifest.permissions` and re-enable (consent dialog appears). The host API enforces this grant; see the trust limitations above. |
| `ReferenceError: document is not defined` (or `window`) | Your `js` is using `document.createElement`/`window.*` directly — rewrite the UI with `ctx.h(...)` (see [Building UI](#building-ui-ctxh-and-the-vnode-model)); there is no DOM inside the sandbox. |
| `cardsPromise.filter is not a function` (or similar) | You called an async `ctx.api.data.*`/`ctx.api.storage.*`/etc. method without `await`. Every `ctx.api` method is async now. |
| Plugin installed but did nothing after reload | It was registered with `setup` as a function (session-only, host code). Ship `js` as a string so it persists and is sandboxed. |
| App broken by a plugin | Boot with `index.html?safemode`, then suspend or remove the plugin in the Plugin Manager. |
| Header/Sidebar/SearchBar override not applying | Those apply at boot — reload. Use `ctx.api.ui.replace` for live changes. |
| Plugin seems unresponsive / suspended itself | A hung worker (never-resolving setup, or a steady-state RPC call stuck too long) is auto-terminated and the plugin auto-suspended, with a toast. Check the plugin's own logic for a call that never resolves. |

## Architecture (for contributors)

```text
www/src/main.js                     Vite entry: global-api first, then app layer
www/src/core/global-api.js          window.CardSpoke assembly (frozen surface)
www/src/core/plugin-api.js          PluginManager, host-side ctx.api handlers, worker lifecycle
www/src/core/plugin-worker-manager.js  Per-plugin Worker creation/termination (host side)
www/src/core/plugin-worker-bootstrap.js  The sandbox itself — worker entry point, ctx construction
www/src/core/plugin-rpc.js          Shared request/response + function-handle protocol (both sides)
www/src/core/plugin-vnode.js        ctx.h() (worker) + vnode→DOM / patch application (host)
www/src/core/plugin-validator.js    Package validation and CSS/JS sanitizing
www/src/core/permissions.js         Consent dialogs + persisted grants
www/src/core/middleware.js          Priority pipeline for core operations
www/src/core/component-registry.js  Component overrides
www/src/core/storage-driver-registry.js  Custom storage drivers (experimental)
www/src/systems.js                  HOST BRIDGE globals + boot (syncFromStore)
www/src/rendering.js                Card render hot path + plugin decoration upgrade pass
www/src/data.js                     Plugin Manager UI + middleware/data hooks
scripts/build-plugin-worker.mjs     Bundles plugin-worker-bootstrap.js into www/plugin-worker-bootstrap.js
```

The invariants that keep all of this working — boot order, the host-bridge
globals, the persistence schema, validator limits, middleware operation
names, the sandbox execution model — are specified in
[`PLUGIN_INVARIANTS.md`](./PLUGIN_INVARIANTS.md). Change those only with a
migration plan.

## Changes in 0.21.1

Worker UI supports ordinary text, layout, form, image and table elements. Active elements such as script, iframe, object, embed, link, meta, SVG and custom elements are rejected. Event properties must be RPC callbacks. Relative links, HTTP/HTTPS/mailto links and base64 raster images are supported; arbitrary image URLs and executable URL schemes are rejected. Updating an injected element replaces its event listeners rather than accumulating them. Source of truth for the allowlists is `plugin-vnode.js`.

Common raw network/storage globals, nested Worker/SharedWorker constructors and importScripts are disabled. Dynamic import remains a trust limitation. The package API and persisted definition shape are unchanged, and schema version remains 4.
