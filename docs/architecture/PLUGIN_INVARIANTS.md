# Plugin System Invariants — What Cannot Change

This document is the **stability contract** for CardSpoke's plugin system.
Every item below is load-bearing: plugins in the wild, the Plugin Manager
UI, the boot sequence, and the persisted data of every user depend on them.

> Breaking any invariant here breaks installed plugins, silently or loudly.
> If you must change one, treat it like a schema migration: bump the app
> version, migrate persisted data, update `docs/architecture/PLUGIN_SYSTEM.md`, the
> samples, the tests, and this file — in the same change.

The regression suite that enforces most of these is
`tests/plugin-lifecycle.test.js` and `tests/sample-extensions.test.js`.
If a change makes those tests fail, the change is wrong (or it is a
deliberate contract change and everything listed above must move together).

## 1. The `window.CardSpoke` surface

`www/src/core/global-api.js` is the **only** place that assigns
`window.CardSpoke`, and the root object is frozen. These members must exist
with these semantics:

| Member | Contract |
|---|---|
| `registerPlugin(id, definition)` | Async; registers **and enables**; session-only (no persistence). |
| `installPlugin(pkg)` | Persistent install; equals `Plugin.install`. |
| `requestPermissions(pluginId, pluginName, permissions)` | Returns `Promise<boolean>`. |
| `Plugin` | The PluginManager with: `register`, `unregister`, `get`, `list`, `listAll`, `enable`, `disable`, `install`, `assessModRisk`, `syncFromStore`, `notifyDataUpdate`, `buildSettingsPanel`, `getCardRenderPluginIds`, `renderBatch`. |
| `PluginSandbox` | Object with `createFunction(code)` — the shape `{ createFunction }` is retained (nothing was found consuming its return value beyond this wiring). **Behavior changed** (v0.21.0, CS-002): pre-sandbox, `createFunction` returned a callable wrapper that, if invoked, actually ran the code on the main thread. It is now a syntax-check-only function — it throws on invalid JS and otherwise returns `undefined`; it never executes the code. Real execution always happens inside a plugin's own dedicated Worker (`plugin-worker-bootstrap.js`). |
| `Middleware` | `register`, `unregister`, `run`, `list`, `clear`. |
| `ComponentRegistry` | `register`, `unregister`, `get`, `list`. |
| `StorageDriverRegistry` | Present (experimental). |
| `PluginValidator` | `validate`, `validateCSS`, `validateJS`. |
| `Permissions` | `hasPermission`, `hasAllPermissions`, `grantPermissions`, `revokePermissions`, `getPermissions`, `requestPermissions`, `clearAll`. |
| `utils` | A **stable mutable object** populated in place by `storage.js` (`Object.assign`). Never reassign `window.CardSpoke` or `window.CardSpoke.utils` after global-api runs. |

Renaming, removing, or changing the call signature of any of these is a
breaking change for every published plugin.

## 2. Boot and module ordering

The order is: **core runtime → app layer → boot IIFE**. Concretely:

1. `www/src/main.js` imports `./core/global-api.js` **first**, and
   `flattenAppScope` in `vite.config.js` **prepends**
   `import '@core/global-api.js';` to the fused app-layer module. Both are
   required (Rollup hoists imports; the prepend guarantees the runtime
   initializes before any app-layer statement executes). Do not remove
   either.
2. The boot IIFE at the end of `www/src/systems.js` must:
   - run **after** the HOST BRIDGE block (same file, directly above it),
   - `await load()` **before** calling `Plugin.syncFromStore(safeMode)`,
   - call `syncFromStore` **before** the first `render()` and before
     `applyRegistryComponents()`.
3. `www/src/core/*` modules must **never import from the app layer**
   (`state.js`, `kernel.js`, `metadata.js`, `storage.js`, `data.js`,
   `rendering.js`, `systems.js`). An app-layer import creates circular
   init. Core reaches the app **only** via the host-bridge window globals
   below, read lazily at call time.
4. The app-layer files execute in one flat scope, fused in this order:
   `state, kernel, metadata, storage, data, rendering, systems`
   (`LAYER_RELATIVE` in `vite.config.js`). They may not use ESM imports of
   each other beyond `./state.js` / `./kernel.js` (which the build strips)
   and `@core/*` modules.
5. There is exactly **one** build of the app: `npm run build` (Vite →
   `www/app.js`, loaded by `www/app-loader.js`). Do not reintroduce a
   second build path with its own copy of the runtime — a diverging
   duplicate runtime (the old `www/src/core.js`) is what originally broke
   the plugin system.
6. `npm run build` (and `npm run dev`) also run `scripts/build-plugin-worker.mjs`
   **first**, which bundles `www/src/core/plugin-worker-bootstrap.js` (plus
   its `plugin-rpc.js`/`plugin-vnode.js` imports) into a standalone ES
   module at `www/plugin-worker-bootstrap.js` via esbuild. This is a
   deliberate exception to "one build," not a violation of it: Rollup's
   `iife` output format (used for the main `app.js` bundle) only supports a
   single entry point, so the sandbox's worker script — loaded at runtime
   via `new Worker('./plugin-worker-bootstrap.js', { type: 'module' })`,
   which Vite's module graph cannot see ahead of time — has to be built as
   its own separate artifact. It must run *before* `vite build` so
   `vite.config.js`'s `copy-site-to-dist` plugin finds the file already
   present in `www/` when it copies the site into `dist/`.

## 3. Host-bridge window globals

The plugin runtime is deliberately decoupled from the app layer and reaches
it exclusively through these globals. All of them must exist before
`syncFromStore` runs:

| Global | Assigned by | Consumed for |
|---|---|---|
| `window.store` | `state.js` (initial + inside `setStore`) | Card reads, `store.plugins` persistence. Must always point at the **live** store object — every dataset switch/reload goes through `setStore`. |
| `window.save` | HOST BRIDGE block in `systems.js` | Persisting plugin installs/state changes. |
| `window.createCard(title, body, parentId, skipSave, skipHooks)` | HOST BRIDGE | `ctx.api.data.createCard` |
| `window.updateCard(id, updates, skipSave, skipHooks)` | HOST BRIDGE | `ctx.api.data.updateCard` |
| `window.deleteCard(id)` | HOST BRIDGE | `ctx.api.data.deleteCard` |
| `window.cloneCard(card)` | HOST BRIDGE | Safe card cloning for plugin reads |
| `window.getTags` / `addTag` / `removeTag` / `setTags` / `getAllTags` | HOST BRIDGE | `ctx.api.data` tag methods |
| `window.showToast(message, type, duration)` | HOST BRIDGE | `ctx.api.ui.showToast` |
| `window.APP_VERSION`, `window.SCHEMA_VERSION` | optional | `ctx.appVersion` / `ctx.schemaVersion` (fallback defaults exist) |

`plugin-api.js` snapshots these on first enable (`captureInternalReferences`)
so a plugin overwriting a window global cannot break other plugins.
Renaming a bridge global or changing its signature silently kills the
corresponding `ctx.api` methods.

## 4. Persistence schema

`store.plugins` (inside the dataset payload, serialized by
`JSON.stringify(store)`) has exactly this shape:

```json
{
  "<plugin-id>": {
    "definition": {
      "manifest": { },
      "css": "…",
      "js": "…",
      "teardownJs": "…"
    },
    "enabled": true
  }
}
```

- Entries must stay **pure JSON** — never store functions or class
  instances. `syncFromStore` builds fresh runtime definitions and must not
  mutate the stored entry.
- The persisted `js` / `teardownJs` **source strings are the canonical
  executable form**; compiled functions are session artifacts.
- `enabled` is the suspend/resume state and is kept in sync by
  `enable()` / `disable()` (`_persistEnabledState`). It must survive reload.
- Entries **without** a `definition` are legacy (pre-v2) plugins: they are
  never executed, and the Plugin Manager UI lists them read-only under
  "Legacy Plugins" for export/removal. Keep tolerating them.
- Other persisted keys: user permission grants live in localStorage under
  `cardspoke_plugin_permissions`; plugin key-value storage uses the
  `plugin_<id>_` prefix. Both key formats are frozen.
- **Unchanged by the v0.21.0 sandbox migration (CS-002).** Moving plugin JS
  execution into a dedicated Worker changed *how* `js`/`teardownJs` strings
  run and what `ctx.api` looks like while they run — it did not change what
  gets persisted. The `cardspoke_plugin_trust` localStorage key (full-trust
  consent) is gone and will not reappear; no migration reads it.

## 5. Plugin package format and execution model

- The package fields `id`, `manifest` (`name`, `version`, `layer` required),
  `css`, `js`, `teardownJs`, `config`, `overrides` mean what
  `docs/architecture/PLUGIN_SYSTEM.md` says. `javascript` is accepted as a legacy alias
  of `js`. Top-level `id`/`config`/`overrides` are normalized into the
  manifest at install.
- **`js` is a setup-function BODY receiving `ctx`, executed inside a
  dedicated Worker (v0.21.0, CS-002 — was: the main thread).** It is
  compiled once per `enable()`, inside that worker, as
  `new AsyncFunction('ctx', '"use strict";\n' + code)` by
  `plugin-worker-bootstrap.js`. A separate, main-thread-only
  `_checkSyntax`/`PluginSandbox` call (same `AsyncFunction` construction,
  never invoked) exists purely to surface a bad package's syntax error
  synchronously at install time, before any worker is created — this is a
  deliberate two-compile design, not a duplicate one. **All real execution
  must go through the worker; do not add a second path that runs `js` on
  the main thread.** Packages must never self-register.
- The worker has no `window`, `document`, `localStorage`, or raw
  `fetch`/`XMLHttpRequest`/`WebSocket`/`indexedDB`/`caches`/`BroadcastChannel`
  — these are stripped in `plugin-worker-bootstrap.js` before the plugin's
  `js` is compiled. This list may grow (new browser capabilities added to
  the strip list) but must never shrink without a security review — it is
  the actual enforcement mechanism behind every `ctx.api` permission.
- A definition carrying `js`/`teardownJs` strings never gets a host-side
  `ctx` object (`instance.context` is `null`) — its `ctx` is built fresh
  inside the worker on every enable. A definition registered with real
  `setup`/`teardown` **functions** (the `registerPlugin` session-only path,
  documented as host code because a function value cannot come from a
  persisted/downloaded package) gets a conventional host-side `ctx` and
  runs unsandboxed on the main thread, exactly as before v0.21.0 — that
  path was never the security boundary, so it did not need to change.
- The three layer names `theme` / `feature` / `app` and the risk mapping
  are frozen: theme+CSS-only → `SAFE`; feature without overrides → `LOW`;
  app layer or any overrides → `HIGH`; anything else → `MEDIUM`. Only
  `SAFE`/`LOW` auto-enable on install; `HIGH` requires an explicit user
  enable. This is the safety boundary users rely on. `install()`'s
  auto-enable is time-boxed via `_enableWithTimeout` (same as boot's
  `syncFromStore`) — a hanging `SAFE`/`LOW` plugin's worker is terminated
  rather than leaving `install()` awaited forever.
- `register()` throws on a duplicate id; `install()` on an existing id is
  an in-place update (full unregister first, same id, no suffixes).
- Validator limits and blocked patterns (100 KB CSS / 500 KB JS; `eval(`,
  `new Function(` in plugin JS; CSS `@import`, `javascript:`,
  `expression()`, `behavior:`, `-moz-binding`) may get stricter, never
  looser, without a major version bump.

## 6. Permission names

`ui-override`, `storage`, `network`, `filesystem`, `core-override`,
`data-modify` — these six strings are persisted in user grants and written
in plugin manifests. Add new permissions if needed; never rename or reuse
the existing ones. Deleting a plugin (`unregister`) must keep revoking its
grants. Host API checks are
enforced by RPC handlers. Worker isolation is not a complete browser capability boundary.

## 7. Middleware operations

Operation names and argument tuples fired by the host:

| Operation | Args | Fired from |
|---|---|---|
| `card.create` | `[cardId, card]` | `data.js createCard` |
| `card.update` | `[cardId, card]` | `data.js updateCard` |
| `card.delete` | `[cardId]` | `data.js deleteCard` |
| `card.save` | `[store]` | `storage.js saveNow` — `preventDefault()` aborts the save |

`card.create`/`update`/`delete`/`save` keep the full onion-model contract:
a plugin's `handler(mwCtx, next)` runs inside its own worker, and the host
proxies `next()` as a round trip back into the real pipeline (so a plugin
can still gate whether/when downstream middleware — including other
plugins', possibly in other workers — runs). `data.js` must also keep
calling `Plugin.notifyDataUpdate({type, cardId, card?})` for
create/update/delete — that is what feeds `ctx.api.data.onUpdate`. Plugin
middleware names are namespaced `<pluginId>:<name>` by `ctx.api.middleware`;
cleanup on disable depends on that prefix.

**`card.render` is a deliberate, permanent exception (v0.21.0, CS-002).**
It no longer fires through the onion-model pipeline above and no longer
carries a live `cardTileElement` — cross-thread `next()` interleaving per
tile, at up to 60 tiles/batch, would be prohibitively slow, and a live DOM
node cannot cross the Worker boundary at all. Instead:

- Fired from `rendering.js`'s render-batch upgrade pass (`scheduleCardRenderUpgrade`),
  batched (one RPC call per plugin per render batch, not per tile), racing
  a short (~80ms) deadline — a slow/hung decorator never blocks rendering.
- Handler shape is `(card, tileSnapshot) => patch | Promise<patch> | null`
  — **not** `(mwCtx, next) => {}`. `tileSnapshot` is a serializable summary
  (`classList`, `hasBody`, `hasTags`, `tagTexts`, `isCompact`) of the
  already-built default tile.
- The handler's return value (a patch: `addClass`/`removeClass`/`setStyle`/
  `setStyleByIndex`/`appendChildren`/`prependChildren`) is what the host
  applies to the real tile — see `docs/architecture/PLUGIN_SYSTEM.md`
  "The card.render decorator contract" for the full shape.
- There is no `next()`/`stopPropagation()`/`preventDefault()` for this
  operation. Every plugin's registered `card.render` decorator is
  independent and additive, applied in registration order after all
  decorators for that batch resolve (or time out). Do not reintroduce
  onion-model semantics here without re-solving the per-tile latency
  problem first.
- Registering `operations: ['card.render']` (even mixed with other
  operation names in one call) routes that registration to this path
  instead of the general pipeline — `www/src/core/plugin-worker-bootstrap.js`'s
  `createMiddlewareApi().register` and `plugin-api.js`'s
  `createWorkerMiddlewareHandlers` both special-case it. Keep them in sync.

## 8. Component registry names

Render upgrade attachment checks run after the synchronous host render has
attached its new subtree. Each rendering pass uses fresh worker results;
card timestamps alone cannot identify state-dependent plugin output or
callbacks from a particular worker instance. Keep the batched deadline and
connected-element checks when changing this behavior.

The host queries exactly these component names: `Card` (per render-batch,
via the same batched worker round trip as `card.render` decorators — see
§7), and `Header`, `Sidebar`, `SearchBar` (once at boot via
`applyRegistryComponents()`). A custom component's `render(props)` returns
a vnode (`ctx.h(...)`, see `docs/architecture/PLUGIN_SYSTEM.md`), **not** an
`HTMLElement` directly (v0.21.0, CS-002 — was: must return an `HTMLElement`
synchronously) — the host's `ComponentRegistry`-stored wrapper converts the
returned vnode to real DOM (`plugin-vnode.js`'s `vnodeToDOM`) after the RPC
round trip resolves. `render()` may be `async`; `Header`/`Sidebar`/
`SearchBar`'s boot-time caller (`applyRegistryComponents`) awaits it, and
`Card`'s hot-path caller races it against a deadline and falls back to the
default tile on timeout/exception. Removing one of these lookups breaks
published plugins that register the corresponding component.

## 9. DOM and CSS contract

- A worker UI handle's explicit `remove()` releases its tracked DOM resource
  immediately, so repeated open/close cycles do not retain detached panels
  until suspension. Remaining handles still clean up on suspend/delete.

- Plugin CSS is injected as `<style data-plugin-id="<id>">` in `<head>`;
  suspend/delete removes it. Nothing else may use that attribute.
- Selectors plugins are told to target (documented in samples and docs):
  `.header`, `.card-tile`, `.card-tag`, `.card-tags`, `.card-content`,
  `.menu-panel`, `.search-input-wrapper`, and the `#brandBtn` element used
  by `overrides.appName`. Renaming these breaks themes and feature plugins
  — treat them like public API.
- The CSS custom properties in `www/styles.css` (`--bg`, `--surface`,
  `--border`, `--text`, `--text-medium`, `--text-muted`, `--text-ghost`,
  spacing/typography/accessibility variables listed by
  `utils.getThemeVariables()`) are the supported theming surface, along
  with the `:root.dark` dark-mode class.

## 10. URL parameters and UI entry points

- `?safemode` must keep booting with all plugins registered but disabled —
  it is the documented recovery path from a broken plugin.
- The Plugin Manager (Installed / Install / Gallery / Create) must keep
  offering: enable, suspend (disable), remove (unregister), install from
  file, install from URL, and create-in-app. The Gallery reads
  `sample-plugins/manifest.json` from the `main` branch of this repo.

## 11. Event bus semantics

`ctx.api.events` is a **global** bus: events emitted by one plugin are
received by all plugins subscribed to that event name — including plugins
running in a *different* worker than the emitter (the bus itself lives on
the host, in `plugin-api.js`, and relays into/out of each subscriber's
worker over RPC). Handlers are removed automatically when their plugin is
disabled. Do not scope it per plugin — cross-plugin communication is a
documented feature.

## Change checklist

Changing anything above? Then in the same PR:

1. Migrate persisted data if the schema moved (a `syncFromStore`-level
   migration for `store.plugins`).
2. Update `docs/architecture/PLUGIN_SYSTEM.md`, this file, `sample-plugins/` (all nine
   packages + TEMPLATE), and `types/index.d.ts`.
3. Update `tests/plugin-lifecycle.test.js` / `tests/sample-extensions.test.js`
   and make `npm test` pass.
4. Add a CHANGELOG entry and consider the version bump (contract changes
   are at least a minor bump; persisted-schema changes are major).

## 0.21.1 trust migration and UI validation

Every JS-bearing package now requires the persisted `plugin-code` grant in addition to manifest permissions. Existing packages prompt once at their next enable. No schema migration is needed (schema 4); the old trust key does not grant this permission. CSS-only themes are unaffected. Worker UI permits a safe element/attribute set; code that attempted active elements must use supported vnode UI. RPC paths cannot traverse inherited properties. See the canonical Plugin System trust model for limitations; do not describe workers as a complete hostile-code sandbox.

## Security-audit hardening (post-0.21.1)

- **Grants are bound to a fingerprint, not just an id.** `Permissions` stores
  `cardspoke_plugin_permission_bindings` (`{ [id]: fingerprint }`) next to the
  unchanged `cardspoke_plugin_permissions` key. The fingerprint
  (`Permissions.computeFingerprint`, FNV-1a over `js` + `teardownJs` + sorted
  `manifest.permissions`) is change detection, not crypto. A same-id plugin
  whose code or permissions differ gets a fresh consent prompt, and runtime
  permission checks fail for it until then. Grants saved before this change
  have no binding and prompt once more.
- **Function-form code is host-only (#370).** `Plugin.register()` rejects a
  definition whose only code is `setup`/`teardown` functions; trusted
  session-only host code must use `CardSpoke.registerPlugin()` (which calls
  the non-enumerable `Plugin.registerHostPlugin()`). `install()` always
  builds a sandboxed definition from `manifest`/`css`/`js`/`teardownJs` and
  drops function fields. `www/src/examples/dynamic-plugin-loader.js` installs
  JSON packages; it does not `import()` plugin modules.
- **Worker hooks are permission-gated host-side.** `card.render`
  middleware requires `ui-override`, as the `Card` component does. Middleware on
  `card.create`/`card.update`/`card.delete` (or `'*'`) requires
  `data-modify`. Without `data-modify`, other hooks such as `card.save` can
  only observe. They cannot rewrite args, `preventDefault()` or
  `stopPropagation()`. `Plugin.renderBatch()` drops a vnode or patch
  unless the host accepted the matching registration. The worker stores a
  renderer or decorator only after the host accepts it.
- **`ctx.utils` over RPC is an allowlist.** Read helpers are ungated. Card/tag
  writers need `data-modify`, and `setTheme`/`setTypography`/`setHighContrast`
  need `ui-override`. A new `CardSpoke.utils` helper stays unreachable from
  workers until it is classified in `UTILS_PERMISSIONS` (`plugin-api.js`).
- **Plugin ids are validated strictly.** An id that does not match
  `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` is a validation error, not a warning.
  Name-derived ids are slugified to that form.
