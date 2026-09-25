# Build a CardSpoke plugin: standalone guide for people and AI agents

Verified against CardSpoke **0.21.1, schema 4**, with the plugin-lab runtime fixes in this change. Written 2026-09-24. This document is designed to be handed to an author who has never opened CardSpoke. It contains the product model, package contract, worker API, complete starting packages, implementation patterns, and acceptance criteria. You do not need the application source to produce an installable package. You do need a running CardSpoke to verify its behavior.

## 1. The application you are extending

CardSpoke is a local-first browser application for hierarchical notes. A **card** has a title, body, tags, and child cards. Root cards appear on the home screen; opening a card shows its body and children. Users can edit cards, search, bookmark, export, and switch between local datasets. `[[Card Title]]` in a body links to another card by title. Duplicate titles can make those links ambiguous. Renaming a uniquely named card also updates incoming title links through the host's normal update operation.

There is no required account, server, or cloud sync. Plugins run on the user's device. The default app remains usable with every plugin suspended. A useful plugin enhances this app or supplies a domain workflow built from ordinary cards; it should not silently replace the user's dataset or assume every card belongs to it.

### Three levels

| Manifest layer | What to ship | Typical use | Install behavior |
| --- | --- | --- | --- |
| `theme` | CSS, no JavaScript | Appearance, light/dark palettes, typography, print styling | CSS-only themes automatically enable |
| `feature` | JavaScript; optional CSS | Add a control, analysis tool, decorator, or workflow | Auto-enable after required consent, unless overrides raise risk |
| `app` | JavaScript; optional CSS and overrides | A substantial planner, study workflow, or research workspace | Installs suspended; user explicitly enables it |

The layer is a product/risk classification. It does **not** confer additional APIs. Permissions still gate an app plugin's calls. Any declared override raises risk to HIGH. `manifest.overrides.appName` changes the existing brand button while enabled; suspension restores it. Do not invent overrides for routing, data schema, rendering, or storage providers.

## 2. Deliverable: one JSON file

Ship UTF-8 JSON, not an HTML page, executable, module, or directory. File extensions in the examples are conventions; Plugin Manager reads the package contents.

```json
{
  "id": "my-plugin",
  "manifest": {
    "id": "my-plugin",
    "name": "My Plugin",
    "version": "1.0.0",
    "author": "Your name",
    "description": "One sentence describing its behavior",
    "layer": "feature",
    "permissions": ["ui-override", "storage"],
    "compatibility": ">=0.21.1",
    "config": { "maxResults": 100 }
  },
  "css": ".my-plugin { padding: 12px; }",
  "js": "await ctx.api.ui.showToast('Plugin enabled', 'success');",
  "teardownJs": "ctx.logger.info('Plugin suspended');"
}
```

| Field | Rules |
| --- | --- |
| `id`, `manifest.id` | Supply both with the same stable lowercase letters/digits/hyphens value. Begin and end with a letter or digit. Changing the ID creates another plugin and storage namespace. Avoid generic IDs that collide with others. |
| `manifest.name`, `version`, `layer` | Required. Use a semantic version such as `1.0.0`; layer must be one of the three strings above. |
| `manifest.author`, `description` | Strongly recommended; explain who wrote it and what happens when enabled. |
| `manifest.permissions` | Array of the exact permission strings in section 5. Declare the minimum needed. |
| `manifest.compatibility` | Informational version range, **not an enforced compatibility solver**. State your actual tested baseline separately. |
| `manifest.dependencies` | Optional array of plugin IDs; they must already be installed. This does not ensure they are enabled, compatible, or ready to receive an event. Prefer self-contained packages. |
| `manifest.config` | Optional flat object of boolean, number, or string defaults. Plugin Manager generates settings inputs. Worker `ctx.config` reflects settings at enable time; suspend/re-enable to apply edits. Validate values in code. |
| `manifest.overrides` | Optional object; supported key `appName`. Declaring overrides makes the package HIGH risk. |
| `css` | CSS string, maximum 100,000 characters. Theme packages require CSS. |
| `js` | The **body of an async setup function** receiving `ctx`, maximum 500,000 characters. See section 3. |
| `teardownJs` | Optional async teardown body receiving the same `ctx` in the same worker. |

Top-level `config` and `overrides` are legacy conveniences normalized into the manifest; use the manifest form. A top-level ID fills a missing manifest ID. `javascript` is a legacy alias for `js`; use `js` in new packages. Keep JSON pure: no functions, comments, trailing commas, or unescaped multiline strings. Generate JSON with `JSON.stringify` rather than manually escaping long code.

Installation with an existing ID replaces the old registration in place. It does not make a second suffixed copy. Changed code/permissions can require renewed consent. An update is not a transactional rollback system: keep the previous package file so users can reinstall it if the new setup fails.

## 3. Execution: your code is inside a worker

The runtime compiles the `js` string as an async function body and calls it with `ctx`. Setup runs again on every enable, including restoration after reload. Do not wrap it in `window.CardSpoke.registerPlugin`, add ESM `import`/`export`, or expect an automatic `setup()` export to be discovered. A package already *is* the registration.

```javascript
// This is valid package js. Top-level await works here.
const cards = await ctx.api.data.listCards();
await ctx.api.ui.showToast(cards.length + ' cards available');
```

No `window`, `document`, DOM elements, localStorage, or ordinary browser event objects are available. Raw network/storage APIs and nested workers are disabled. Use `ctx.api` for host access and `ctx.h` for UI. Avoid dynamic imports, remote dependencies, and eval; ship everything needed in the JSON. Workers reduce risk but are **not a complete hostile-code sandbox**. The host requires explicit `plugin-code` trust consent for executable packages, even read-only ones. Any trusted plugin can read unlocked cards.

Setup should finish promptly. Register handlers and return; never wait indefinitely for an interaction. Timers may run after setup, but clear them in teardown when possible; terminating the worker stops them as a backstop. A setup exception leaves the installed package suspended and rolls back tracked UI/CSS. Startup and host calls have deadlines. A hung plugin can be terminated.

```javascript
ctx._timer = setInterval(() => {
  ctx.logger.info('Tick');
}, 60000);
// teardownJs must be a separate string:
// clearInterval(ctx._timer);
```

Variables declared only in setup are not lexical variables of teardown. Put teardown state on `ctx`. Normal UI closures inside setup can share local variables without using `ctx`.

### Context and async rules

| Member | Meaning |
| --- | --- |
| `ctx.modId` | This plugin's ID. |
| `ctx.appVersion`, `ctx.schemaVersion` | Host version information; not a substitute for feature testing. |
| `ctx.config` | Settings snapshot. Use `ctx.config || {}` if none declared. |
| `ctx.h(tag, props, children)` | Synchronously creates a virtual element description. |
| `ctx.api` | UI, data, storage, events, middleware, network, filesystem APIs below. |
| `ctx.utils` | Allowlisted asynchronous helpers below. |
| `ctx.logger.log/info/warn/error(...)` | Sends prefixed diagnostics to the host console. |

Data reads/writes, storage, UI injection/update/removal, component registration, network, filesystem, and utils calls return promises. **Await them and handle errors.** There are important exceptions: `data.onUpdate` and `events.on/once` return synchronous unsubscribe functions; event sending does not provide an acknowledgment promise. Middleware registration returns a synchronous unregister function whose **`.ready` promise** reports registration success. `await register(...)` alone does not wait for that success.

```javascript
const unregister = ctx.api.middleware.register({
  name: 'my-decorator', operations: ['card.render'],
  handler: card => ({ addClass: ['my-decorated-card'] })
});
await unregister.ready;
```

## 4. Installation and development workflow

1. Save the package as `my-plugin.json`.
2. Open CardSpoke → menu → **Plugin Manager** → **Install** and choose the JSON file. URL installation is also available when reachable, but file installation is simplest for development.
3. Review consent. For an `app` plugin, use **Enable** in the Installed tab after installation. A suspended app package is normal, not evidence of setup failure.
4. Exercise its visible controls. Reload; verify the plugin returns exactly once. Suspend and verify its UI and CSS disappear. Re-enable and verify persistent state returns.
5. To update, install a regenerated package with the same ID. Approve changed permissions/code if prompted. Use a version bump for distributed changes.
6. If a plugin breaks startup, open the app with `?safemode` (append `&safemode` if a query already exists). This registers stored packages without enabling them. Remove or suspend the broken plugin.

The Create tab accepts a manifest, CSS, and setup body for quick experiments. Function-form `window.CardSpoke.registerPlugin(id, { setup(ctx) { ... } })` is a separate, trusted, session-only host-code API. It executes on the main thread and cannot survive reload as JSON. **Do not use it as the template for a distributed worker package.**

For repository development: Node 20.19+ or 22.12+, `npm ci`, then `npm run build`. `npm run dev` serves the already built app bundle; after changing `www/src`, rebuild. `npm run preview` serves the production build. The advanced examples use `npm run plugins:build` to package readable source files. The generated JSON files have no runtime dependency on those sources or the builder.

Serve JavaScript plugins over HTTP(S) or a supported application shell. Direct `file://` module-worker support is browser-dependent; Chromium restricts it. The host's static UI and CSS themes can still be used from local files. This collection's worker behavior is tested in Chromium over localhost; it does not establish Electron, Capacitor, or all-browser certification.

## 5. Permissions and trust

| Permission | Needed for |
| --- | --- |
| `ui-override` | Inject/replace UI, component registration, card decorators, appearance-changing utils. |
| `data-modify` | Create/update/delete cards; tag writes; middleware for card create/update/delete or `*`; intervention in save hooks. |
| `storage` | Plugin key/value storage. |
| `network` | `ctx.api.network.fetch`. Still subject to browser CORS/CSP and connectivity. |
| `filesystem` | Capacitor filesystem bridge where available. Not a portable web file picker. |
| `core-override` | Recognized high-risk capability name; does not grant arbitrary global access or a generic core-replacement API. Do not request without a concrete supported use. |

`plugin-code` is an additional runtime trust grant for executable code, requested automatically. It is not one of the six author-declared manifest permissions accepted by the package validator. User grants are bound to a code/permission fingerprint. Do not grant your own permissions, bypass prompts, or ship a test harness that auto-approves user installations.

Card reads, tag reads, toasts, and ordinary event bus operations do not require a separate manifest permission. Reads can include all unlocked cards, so describe that access honestly. No example in this collection requests network or filesystem access.

## 6. Building UI without a DOM

`ctx.h` creates a plain virtual node. Pass it to the UI API; the host validates it and builds actual DOM. Text children are rendered as text, so user content such as `<script>` stays inert. Never concatenate user content into HTML; there is no supported `innerHTML` prop.

```javascript
const h = ctx.h;
let value = '';
let handle;
function view() {
  return h('section', { className: 'my-plugin', 'aria-label': 'My tool' }, [
    h('label', {}, ['Title', h('input', {
      value, 'aria-label': 'Title',
      oninput: event => { value = event.target.value; }
    })]),
    h('button', { type: 'button', onclick: async () => {
      try { await ctx.api.ui.showToast(value || 'Enter a title'); }
      catch (error) { ctx.logger.error(error.message); }
    } }, 'Show title')
  ]);
}
handle = await ctx.api.ui.inject('.header', view(), 'after');
// Later: await handle.update(view()); or await handle.remove();
```

Children may be strings, numbers, vnodes, or an array of these. Flatten nested arrays yourself. Null/undefined/false children are omitted. Props include `className`, a CSS string or object for `style`, a plain object for `dataset`, ordinary allowed attributes, and callback-valued `onclick`, `oninput`, `onchange`, `onkeydown`, etc. Use an explicit `type: 'button'` for action buttons.

Supported tags are:

```text
a abbr b blockquote br button caption code col colgroup dd del details div dl dt
em fieldset figcaption figure h1 h2 h3 h4 h5 h6 hr i img input kbd label legend
li mark ol optgroup option p pre progress s samp section select small span
strong sub summary sup table tbody td textarea th thead time tr u ul
```

Supported plain attributes are:

```text
id title role tabindex type name placeholder value checked disabled readonly
multiple selected min max step rows cols maxlength minlength for colspan rowspan
scope open hidden alt width height href src target rel download loading autocomplete
```

Also allowed: `aria-*`, `data-*`, `class`/`className`, `style`, `dataset`, and callback event props. Unsupported tags include `form`, `dialog`, `script`, `iframe`, `svg`, and custom elements. Use a `section` with labeled controls rather than assuming arbitrary HTML is allowed. For select controls, mark the relevant **option** `selected: true`; children are created after the select's props. A textarea can use both a `value` prop and text child for clear initial content.

For `href`, HTTP(S), mailto, and safe relative paths are accepted. `src` permits safe relative paths and base64 PNG/JPEG/GIF/WebP data URLs; external absolute image URLs are rejected. Protocol-relative URLs, concealed schemes, and unsafe schemes are rejected. Validate user URLs before trying to render them; a plain text citation is often sufficient.

### Event descriptor

A callback receives a serializable object, approximately:

```javascript
{
  type: 'input', key: undefined, code: undefined,
  clientX: undefined, clientY: undefined,
  target: { value: 'typed text', checked: false, dataset: {} }
}
```

It is not an Event or HTMLElement. No `target.closest`, `currentTarget`, focus method, modifier-key guarantee, or `event.preventDefault()` is available. Returning `{preventDefault:true, stopPropagation:true}` requests host action, but the worker round trip is asynchronous: **do not rely on it to cancel synchronous navigation, submission, or bubbling already performed**. Prefer buttons with no browser default navigation, independent non-modal panels, and straightforward labeled fields.

### UI methods

| Call | Result/behavior |
| --- | --- |
| `await ui.inject(selector, vnode, position)` | Positions: `append` (default), `prepend`, `before`, `after`. First selector match only. Returns a tracked handle. |
| `await ui.replace(selector, vnode)` | Replaces first match, retaining original for cleanup. Returns a tracked handle. Avoid replacing core controls unless you supply their full behavior. |
| `await handle.update(vnode)` | Replaces attributes and children of the existing root element. Root element identity/tag stays the same. Not a keyed diff; child focus and selection may be lost. |
| `await handle.remove()` | Removes injection/restores replacement. Safe to call again. Automatically performed on suspension too. |
| `await ui.showToast(message, type, duration)` | Types `info`, `success`, `error`, `warning`; duration in milliseconds. No UI permission required. |
| `await ui.registerComponent(name, {render, priority})` | Registers a vnode-returning renderer; see section 10. |
| `await ui.unregisterComponent(name)` | Removes this plugin's component registration. |

A missing injection selector returns a no-op handle; there is no `handle.element` or `handle.found`. Use known stable selectors and verify visible output. `.header` is a documented injection target. `#main` is the current app content container: inserting **before** it keeps an optional panel across navigation; inserting **inside** it can be erased by core rendering. This is a current-layout integration point, not a separate plugin slot service. Re-test it on host upgrades.

Do not redraw the whole panel on each keystroke or incoming card event. Keep draft values in worker state; redraw after explicit actions. Serialize mutations to avoid overlapping clicks. A reusable pattern is:

```javascript
let pending = Promise.resolve();
const action = work => (...args) => {
  pending = pending.then(() => work(...args)).catch(async error => {
    await ctx.api.ui.showToast(String(error.message || error), 'error');
  });
  return pending;
};
// onclick: action(async () => { ... awaited operations ... })
```

## 7. Cards, tags, and safe writes

A representative card returned by the API is:

```json
{
  "id": "host-generated-id",
  "title": "A note",
  "body": "Plain text or Markdown-style content; [[Other note]]",
  "parentId": null,
  "children": [],
  "tags": ["research"],
  "createdAt": 1780000000000,
  "updatedAt": 1780000000000,
  "modsData": {}
}
```

Treat missing optional fields defensively and preserve unknown fields. Reads are deep clones: changing them does not change the dataset. IDs belong to the host. Children contain IDs, not embedded cards. Timestamps are milliseconds since the Unix epoch. Tags are strings; use explicit normalized lowercase tags for predictable matching.

| `ctx.api.data` call | Result |
| --- | --- |
| `await getCard(id)` | Deep-cloned card or `undefined` when absent. |
| `await listCards()` | Array of deep-cloned cards in the active dataset. No ordering/pagination guarantee. |
| `await createCard({title, body, parentId, tags})` | New card ID. `parentId` defaults to null; validate an existing parent first. |
| `await updateCard(id, updates)` | Updated clone or absent if card is gone. Supports title/body/tags/JSON metadata. |
| `await deleteCard(id)` | Deletes the card **and descendants** through the host. Do not interpret its boolean as a detailed count. |
| `await getTags(id)` | Tag array. |
| `await getAllTags()` | Unique tags in active dataset. |
| `await addTag(id, tag)`, `removeTag(id, tag)`, `setTags(id, tags)` | Tag writers; inspect fresh data rather than assuming a changed-value return means persistence succeeded. |
| `data.onUpdate(callback)` | Synchronous unsubscribe function; callback gets `{type, cardId, card?}`. Types `card.create`, `card.update`, `card.delete`. |

`updateCard` is shallow at the top level. Protected fields include `id`, `parentId`, `children`, and `createdAt`; updates to them are ignored. There is **no general worker reparent method**. Create children with `createCard({parentId})`, or leave moving existing cards to the host UI. Do not delete/recreate cards merely to simulate reparenting: IDs and links matter.

All writes need `data-modify`. Read the latest card before editing. Preserve other authors' tags and metadata. For your card-specific state, use a namespaced entry in `modsData`:

```javascript
const card = await ctx.api.data.getCard(cardId);
if (!card) throw new Error('Card was deleted. Refresh.');
const previous = card.modsData?.[ctx.modId] || {};
const updated = await ctx.api.data.updateCard(cardId, {
  modsData: {
    ...(card.modsData || {}),
    [ctx.modId]: { ...previous, schema: 1, status: 'done' }
  }
});
if (!updated) throw new Error('The update did not complete.');
```

This metadata travels with cards in dataset JSON, survives reload, and naturally follows dataset boundaries. It is an extension convention, not a new core schema or typed-card platform. Keep your own metadata schema version and migrate only your entry.

The APIs do not offer transactions, compare-and-swap, batch rollback, or a durable-save acknowledgment per card. The host schedules persistence. Preview large changes and re-check each card before writing; report skips and partial completion. Do not claim atomicity. A rename can update link text in other cards, so document that side effect for batch title tools. Undo should avoid overwriting unrelated edits. The Batch Workbench keeps conflict-checked history for the current enabled session only.

Do not write to a card again unconditionally from its own update callback: that creates a loop. `onUpdate` is a change notification, not proof a durable save succeeded; not every host field/tag path should be assumed to emit identical events. An explicit Refresh button provides a reliable fallback.

## 8. Plugin storage, configuration, and recovery

All of these require `storage`:

```javascript
await ctx.api.storage.set('settings', { schema: 1, value: { sort: 'title' } });
const saved = await ctx.api.storage.get('settings'); // missing -> null
const keys = await ctx.api.storage.list('setting');
await ctx.api.storage.remove('settings');
const namespace = await ctx.api.storage.getNamespace(); // plugin_<id>_
```

Store JSON-compatible values. Never store functions, DOM references, promises, cyclic objects, or secrets. The default localStorage namespace is scoped to plugin ID and origin, **not automatically to the current dataset**. Use it for preferences and saved filters that can intentionally apply across datasets. Use card `modsData` for per-card project/review state. If you need dataset-specific storage keys, derive them from `await ctx.utils.getDatasetMeta()` and define rename/import behavior explicitly. Do not assume the storage namespace is included in the host's dataset export or automatically erased on plugin removal.

Removing the plugin removes installed code/UI and revokes permissions. Cards and plugin-created metadata remain ordinary user data. Local plugin preferences can also remain. Offer a specific reset control for owned settings when appropriate, and explain how users can remove created cards through the normal UI. Suspension is not a data rollback.

Clamp numeric config and validate user input before using it:

```javascript
const raw = Number((ctx.config || {}).maxResults);
const limit = Number.isFinite(raw) ? Math.max(1, Math.min(500, raw)) : 100;
```

## 9. Themes: current CSS integration surface

Use CSS-only `theme` packages. Main variables are `--bg`, `--surface`, `--border`, `--text`, `--text-medium`, `--text-muted`, `--text-ghost`, `--accent-strong`, `--font`, `--font-brand`, `--radius`, `--line-height`, `--text-*`, and `--space-*`. Dark mode is **`:root.dark`**, not `body.dark`. High contrast uses `.high-contrast` and dedicated `--hc-*` variables. Preserve high contrast, focus indication, and typography preferences.

Documented selectors: `.header`, `.card-tile`, `.card-content`, `.card-tags`, `.card-tag`, `.menu-panel`, `.search-input-wrapper`, and `#brandBtn`. Theme styles are global while enabled. Multiple themes compete by normal CSS cascade; recommend one theme at a time. Scope a feature/app's CSS to a unique prefix so it can coexist with any theme.

Include light/dark palettes, narrow-screen rules, visible keyboard focus, reduced-motion rules for any animation, forced-colors behavior, and a print mode where useful. Use system fonts and local styles rather than external font requests. CSS sanitation strips `@import`, `javascript:`, `expression()`, `behavior:`, and `-moz-binding`; do not treat sanitation as an invitation to load resources through other CSS forms.

## 10. Decorators, components, and middleware

### Decorate existing cards

The `card.render` hook is special. It receives `(card, tileSnapshot)` and returns a patch. It does **not** receive a middleware context or `next`. Register it separately from other operations, and await `.ready`.

```javascript
const remove = ctx.api.middleware.register({
  name: 'reading-time', operations: ['card.render'],
  handler: (card, tileSnapshot) => {
    const words = String(card.body || '').split(/\s+/).filter(Boolean).length;
    if (words < 30) return null;
    return {
      addClass: ['my-reading-card'],
      appendChildren: { '.card-content': [ctx.h('small', {}, Math.ceil(words / 200) + ' min read')] }
    };
  }
});
await remove.ready;
```

Patch keys: `addClass`/`removeClass` arrays; `setStyle` maps selectors to style objects; `setStyleByIndex` maps selectors to arrays of style objects; `appendChildren`/`prependChildren` map selectors to vnode arrays. Selectors are relative to one card tile. Empty selector `''` targets the tile root for `setStyle`, `appendChildren`, and `prependChildren`. Missing targets are skipped. `tileSnapshot` has `classList`, `hasBody`, `hasTags`, `tagTexts`, `isCompact`.

Compute expensive indexes ahead of rendering, not by making host calls per card. The host batches up to 60 tiles and uses a short (~80 ms) deadline; late output falls back to the core tile. A decorator's state may depend on other cards. After the plugin-lab fixes, each rendering pass requests fresh output and waits until tiles are attached; output is not cached just by the decorated card's timestamp. A manual page refresh/navigation may be needed to redraw already visible decorations.

### Replace a component

```javascript
const accepted = await ctx.api.ui.registerComponent('Card', {
  priority: 10,
  render: ({card, isSelected, opts}) => ctx.h('div', {
    className: 'card-tile my-card', 'aria-label': card.title || 'Untitled'
  }, [ctx.h('strong', {}, card.title || 'Untitled'), ctx.h('p', {}, card.body || '')])
});
```

Names queried by the host: `Card`, `Header`, `Sidebar`, `SearchBar`. Higher priority wins; test competing plugins. A replacement `Card` supplies its own interaction and accessibility, and does not automatically inherit core navigation/edit handlers. There is no supported generic worker `navigate` helper. Prefer additive decorators or an independent panel when keeping core navigation matters. `Header`/`Sidebar`/`SearchBar` are boot-time lookups; do not promise immediate hot replacement without testing the relevant host path. Suspending a registry registration does not necessarily repaint an already rendered replacement; navigate/reload to verify restoration.

### Observe/intercept operations

```javascript
const remove = ctx.api.middleware.register({
  name: 'save-observer', priority: 0, operations: ['card.save'],
  handler: async (mw, next) => {
    await next();
    // This hook alone does not prove durable disk persistence.
    ctx.logger.info('Save pipeline observed');
  }
});
await remove.ready;
```

| Operation | Arguments | Meaning |
| --- | --- | --- |
| `card.create` | `[cardId, card]` | Notification after creation; cancellation cannot undo it. Requires `data-modify`. |
| `card.update` | `[cardId, card]` | Notification after update. Requires `data-modify`. |
| `card.delete` | `[cardId]` | Notification after deletion. Requires `data-modify`. |
| `card.save` | `[storeSnapshot]` | Save pipeline. An authorized `preventDefault()` can abort saving. |

`mw` includes `operation`, `args`, `preventDefault()`, `stopPropagation()`, and flag getters. Call `await next()` unless deliberately intercepting. Registration names are automatically prefixed with plugin ID. `*` requires `data-modify`. Without that permission, a save hook is observe-only: returned argument edits/cancellation flags are ignored. Arguments cross the worker boundary as copies; do not assume mutating `mw.args` changes host data. Use the explicit data API for card edits. Middleware failures are contained, not a transactional validator guarantee. Never perform an unconditional data write from a save hook, or it can trigger another save.

## 11. Other APIs and their limits

**Events:** `events.on(name, callback)`, `once`, `off(name, callback)`, `emit(name, ...args)`. This is a global bus shared by enabled plugins, with no durable queue. Prefix names (`my-plugin:selection`) and send versioned plain objects. Keep a reference to the same callback when calling `off`. `on`/`once` return unsubscribe functions; registrations clean up on suspend. Emitting is fire-and-forget: build a separate response event and timeout if you need a request/reply protocol. Validate all messages from other plugins.

**Network:** `const response = await ctx.api.network.fetch(url, options)`. With permission, returns a response-like object: `ok`, `status`, `statusText`, `url`, `headers.get/entries`, async `text/json/arrayBuffer`. It is buffered, not a native streaming Response. `network.xhr()` throws in worker packages. No raw fetch, socket, stream, or AbortSignal interoperability should be assumed. Handle offline operation and never transmit cards without an explicit user-driven feature and clear disclosure.

**Filesystem:** `await ctx.api.filesystem.readFile(path, options)` and `writeFile(path, data, options)`. They use Capacitor Filesystem and throw when unavailable. Require `filesystem`; design a web fallback.

**Utils:** only these host helpers are allowlisted for workers:

```text
Read: getTags, getAllTags, getCard, searchCards, getDatasetMeta,
      getAccessibilitySettings, getTheme, getTypography, isHighContrast,
      prefersReducedMotion, getThemeVariables
Write (data-modify): createCard, updateCard, addTag, removeTag, setTags
Appearance (ui-override): setTheme, setTypography, setHighContrast
Ungated: showToast
```

Prefer `ctx.api.data` over duplicate data utilities. `getDatasetMeta()` returns `{name, cardCount, rootCardCount, bookmarkCount, recentCount, modCount, schemaVersion, appVersion}`. Do not infer additional callable methods merely because a Proxy accepts a property access: an unknown host RPC method rejects. If you need functionality absent from this guide, describe the missing capability and build a framework around supported operations; do not invent APIs.

## 12. Three complete starting packages

These are intentionally small, complete, valid packages. Larger implementations should keep setup in a readable file and generate its JSON string (section 13).

### Theme

Save as `starter-theme.json`:

```json
{
  "id": "starter-theme",
  "manifest": { "id": "starter-theme", "name": "Starter Theme", "version": "1.0.0", "author": "Your name", "layer": "theme", "permissions": [], "compatibility": ">=0.21.1" },
  "css": ":root { --bg: #f2f5fa; --surface: #fff; --text: #182b43; --border: #a9b9cc; --text-muted: #405875; --accent-strong: #234e91; } :root.dark { --bg: #102030; --surface: #1a3045; --text: #f0f7ff; --border: #809bb8; --text-muted: #c3d7eb; --accent-strong: #add0ff; } .card-tile { border: 1px solid var(--border); border-radius: 8px; } :focus-visible { outline: 3px solid var(--accent-strong); outline-offset: 3px; } @media (prefers-reduced-motion: reduce) { .card-tile { transition: none; } }"
}
```

### Feature with persistent state and error handling

Save as `starter-counter.json`. It stores a preference-like counter independently from cards; reload retains it, suspend removes its button.

```json
{
  "id": "starter-counter",
  "manifest": { "id": "starter-counter", "name": "Starter Counter", "version": "1.0.0", "author": "Your name", "layer": "feature", "permissions": ["ui-override", "storage"], "compatibility": ">=0.21.1" },
  "js": "let count = Number(await ctx.api.storage.get('count')) || 0; let busy = false; let handle; function view() { return ctx.h('button', {type:'button', onclick:async () => { if (busy) return; busy = true; try { await ctx.api.storage.set('count', count + 1); count++; await handle.update(view()); } catch (error) { await ctx.api.ui.showToast(error.message, 'error'); } finally { busy = false; } }}, 'Count: ' + count); } handle = await ctx.api.ui.inject('.header', view());"
}
```

### App that creates a card tree

Save as `starter-project.json`. It installs suspended and asks for write/UI consent when enabled. Each explicit click creates a new project; it does not create cards at boot.

```json
{
  "id": "starter-project",
  "manifest": { "id": "starter-project", "name": "Starter Project", "version": "1.0.0", "author": "Your name", "layer": "app", "permissions": ["ui-override", "data-modify"], "compatibility": ">=0.21.1" },
  "js": "let busy = false; await ctx.api.ui.inject('.header', ctx.h('button', {type:'button', onclick:async () => { if (busy) return; busy = true; try { const parentId = await ctx.api.data.createCard({title:'New project', body:'Project notes', tags:['starter-project']}); await ctx.api.data.createCard({title:'First task', body:'Describe the next step', parentId, tags:['starter-task']}); await ctx.api.ui.showToast('Project created. Open Home to see it.', 'success'); } catch (error) { await ctx.api.ui.showToast(error.message, 'error'); } finally { busy = false; } }}, 'Create project'));"
}
```

## 13. Package readable source without the CardSpoke repository

Use Node's standard library. Create `manifest.json` containing the manifest object (not the outer package), `setup.js` containing setup statements with `ctx`, optional `style.css` and `teardown.js`, and this `package.mjs`:

```javascript
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
const read = path => existsSync(path) ? readFileSync(path, 'utf8') : '';
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const js = read('setup.js');
const teardownJs = read('teardown.js');
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
if (js) new AsyncFunction('ctx', js); // syntax check only; does not run
if (teardownJs) new AsyncFunction('ctx', teardownJs);
const pkg = { id: manifest.id, manifest, css: read('style.css') };
if (js) pkg.js = js;
if (teardownJs) pkg.teardownJs = teardownJs;
writeFileSync(manifest.id + '.json', JSON.stringify(pkg, null, 2) + '\n');
```

Run `node package.mjs`. This does not validate permissions, semantics, CSS safety, or browser support; installation and acceptance tests still matter. For themes omit `setup.js`. Never execute setup on the packaging machine just to validate it.

## 14. Acceptance checklist and troubleshooting

Test on a disposable dataset with a backup. A passing syntax check is insufficient.

| Test | Required observation |
| --- | --- |
| Fresh install | Package validates; expected consent; app layer remains suspended until enabled. |
| Permission denied | No feature writes/UI; installed state recoverable. |
| Main workflow | Real controls produce expected card/data results, including empty inputs and deleted cards. |
| Reload | Code and enabled state restore once; persistent state correct; no duplicate controls/listeners. |
| Suspend/re-enable | Tracked UI/CSS/listeners go away; worker stops; re-enable reconstructs correctly. |
| Removal | Registry/store entry and grants removed; surviving user cards explained. |
| Safe Mode | No package executes. User can remove the faulty package. |
| Update same ID | Replaces in place; changed code consent works; old UI removed. |
| Dataset switch | No stale references used to overwrite another dataset; card state stays with its dataset. |
| Concurrency | Rapid clicks do not duplicate unintended operations; conflicting edits are skipped or explained. |
| Accessibility | Labels, visible focus, keyboard actions, light/dark, reduced motion, 360px layout. |
| Coexistence | At least one theme plus other feature/app plugins; names/CSS do not collide. |
| Failure | Setup exceptions clean up; action errors are visible; no unhandled worker errors. |

For repository contributors run `npm test`, `npm run build`, `npm run smoke`, `npm run qa:browser`, and `npm run qa:plugins`. The latter drives real JSON installations and real browser workers; artifacts and machine-readable results go under `qa-artifacts/advanced-plugins/`. `npm run plugins:check` ensures packages match readable sources.

| Symptom | Likely cause / action |
| --- | --- |
| `document is not defined` | Main-thread example copied into a worker. Use `ctx.h` and UI handles. |
| `... is not a function` or unknown RPC method | Invented API or treating a Promise as data. Use this reference and await calls. |
| Plugin installed but nothing appears | App suspended, denied consent, missing selector, setup error, or stale bundle. Check Installed state and console. |
| Hook seems registered but never runs | Await unregister `.ready`; check permission and operation; card.render uses different arguments. |
| Card decorators absent on old 0.21.1 build | Install host fixes from this change; earlier first-batch attachment bug skips them. |
| Control loses focus while typing | Full vnode update rebuilt the input. Preserve draft state and avoid redraw on input. |
| State disappears on reload | Session-only registration, unawaited storage, or reload before host save completed. |
| Delete plugin did not delete created cards | Expected. Uninstall cleans runtime resources, not user content. |
| Save observer says “saved” but disk write fails | Middleware is not a durable-write acknowledgment. Do not label it that way. |
| Works on localhost but not local file/mobile | Worker origin or platform API restrictions. Document supported environments. |

## 15. Instructions to give an AI plugin author

Use this document as the supported contract. First specify the layer, user-visible workflow, minimum permissions, owned data, and cleanup behavior. Output a stable-ID JSON package plus readable setup/CSS sources and packaging instructions. Put no network dependency or undocumented API in the plugin. Use async worker calls, safe vnodes, namespaced CSS, and `modsData[ctx.modId]` for card-owned state. Explain partial failure and recovery. Give a concrete acceptance checklist and distinguish tests actually run from tests still needed. If an essential capability is absent, build the supported framework and identify the missing host API precisely instead of pretending it exists.

For richer examples, the advanced collection implements nine separate packages. Its source is readable under `sample-plugins/advanced/src`, while each `themes`, `features`, or `apps` JSON is independently installable. The [collection README](../../sample-plugins/advanced/README.md) maps behavior to APIs and records cleanup/data conventions. The [verification report](../reports/ADVANCED_PLUGIN_VERIFICATION.md) states exactly what was tested and remaining limitations.
