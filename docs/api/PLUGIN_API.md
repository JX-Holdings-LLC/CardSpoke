# Plugin API Documentation

**Version:** 0.21.1

The Plugin API provides a permission-scoped, resource-managed surface for
plugin development. Plugin JS runs on the **main thread** (there is no iframe
or Worker sandbox), so enabling a JavaScript plugin requires the user to
accept an explicit full-trust consent dialog. The `ctx` permissions below
scope the *supported* API for well-behaved plugins — they are a
compatibility contract, not a security boundary. The validator screens
packages, and everything a plugin creates through `ctx.api.*` is tracked and
automatically removed when it is suspended.

This page is the per-method reference for the `ctx` API. For the narrative
guide, package format, and lifecycle walkthrough see
[`../architecture/PLUGIN_SYSTEM.md`](../architecture/PLUGIN_SYSTEM.md); for the stability contract see
[`../architecture/PLUGIN_INVARIANTS.md`](../architecture/PLUGIN_INVARIANTS.md). Working examples live in
[`../../sample-plugins/`](../../sample-plugins/) (nine packages, three per
layer, plus `TEMPLATE.json`).

## Overview

Key features:

- **Per-plugin context**: Each plugin gets its own `ctx` with a
  permission-checked API surface.
- **Resource Tracking**: Automatic tracking of DOM elements, listeners,
  components, and middleware.
- **Hot Unloading**: Clean removal without page refresh or ghost elements.
- **Namespaced Storage**: Plugin-specific storage namespace.
- **Permission System**: User consent for sensitive operations.

## Plugin Structure

A plugin is a **JSON package**. The `js` field is the *body of your setup
function* — it receives the plugin context as `ctx` and is compiled once per
enable as `new Function('ctx', '"use strict";\n' + js)` on the main thread
(see `_createSandboxedFunction` in `www/src/core/plugin-api.js`). Write
statements, not a wrapper, and never call `registerPlugin` from inside `js`
(the package IS the plugin; self-registration throws a duplicate-id error).

```json
{
  "id": "my-plugin",
  "manifest": {
    "id": "my-plugin",
    "name": "My Plugin",
    "version": "1.0.0",
    "author": "Author Name",
    "layer": "feature",
    "permissions": ["ui-override", "storage"]
  },
  "css": "/* Optional CSS, injected while enabled */",
  "js": "ctx.logger.info('enabled'); ctx.api.ui.showToast('Hello', 'success');",
  "teardownJs": "/* optional extra cleanup */"
}
```

Install a package **persistently** (validates, registers, persists to
`store.plugins`, and auto-enables SAFE/LOW-risk layers) via the Plugin
Manager UI or programmatically:

```javascript
await window.CardSpoke.Plugin.install(pkg);   // or window.CardSpoke.installPlugin(pkg)
```

Persisted string-form packages survive a reload: at boot,
`Plugin.syncFromStore()` (in `www/src/systems.js`) re-registers every stored
plugin from its persisted `js`/`teardownJs` strings and re-enables the ones
marked enabled.

For **development only**, you can register a module-form definition with real
`setup`/`teardown` **functions**. This registers *and* enables in one step
but is **session-only** — functions cannot be persisted, so it is gone after
a reload:

```javascript
window.CardSpoke.registerPlugin('my-plugin', {
  manifest: {
    name: 'My Plugin',
    version: '1.0.0',
    author: 'Author Name',
    layer: 'feature',
    permissions: ['ui-override', 'storage']
  },
  setup: async (ctx) => { /* real function — session only */ },
  teardown: async (ctx) => { /* optional */ },
  css: '/* Optional CSS */'
});
```

## Plugin Context

Every plugin receives a context object:

```javascript
{
  modId: string,              // Plugin ID
  appVersion: string,         // App version (0.21.1)
  schemaVersion: number,      // Schema version (4)
  api: {
    ui: UIApi,                 // UI manipulation
    data: DataApi,             // Data access
    storage: StorageApi,       // Persistent storage
    events: EventApi,          // Shared cross-plugin event bus
    middleware: MiddlewareApi, // Core-operation interceptors
    network: NetworkApi,       // Permission-gated network access
    filesystem: FilesystemApi  // Permission-gated Capacitor filesystem access
  },
  utils: object,              // Async host helpers (same object as window.CardSpoke.utils)
  config?: object,            // Plugin manifest config (when provided)
  logger: Logger              // Scoped logger
}
```

## API Reference

### UI API

#### `ctx.api.ui.inject(selector, element, position)`

Inject an element into the DOM.

```javascript
const cleanup = ctx.api.ui.inject('#main', myElement, 'append');
// cleanup() removes the element
```

**Positions**: `'before'`, `'after'`, `'append'`, `'prepend'`

#### `ctx.api.ui.replace(selector, element)`

Replace an existing element.

```javascript
const restore = ctx.api.ui.replace('#card-title', newElement);
// restore() reverts to original
```

#### `ctx.api.ui.registerComponent(name, component)`

Register a UI component override. The host queries only `Card`, `Header`,
`Sidebar`, and `SearchBar`; `render()` must return an `HTMLElement` or the
default rendering is kept. See
[Component Registry](./COMPONENT_REGISTRY.md) for each component's props.

```javascript
// Card props: { card, isSelected, opts, onSelect }
ctx.api.ui.registerComponent('Card', {
  render: (props) => {
    const el = document.createElement('div');
    el.textContent = props.card.title;
    return el;
  },
  priority: 10
});
```

#### `ctx.api.ui.showToast(message, type, duration)`

Show a toast notification.

```javascript
ctx.api.ui.showToast('Saved!', 'success', 3000);
```

**Types**: `'success'`, `'error'`, `'info'`, `'warning'`

### Data API

The data API is backed by the **host-bridge globals**
(`window.createCard`, `window.updateCard`, `window.deleteCard`,
`window.getTags`, …) that `www/src/systems.js` assigns before the boot
sequence runs, plus `window.store` (kept in sync by `setStore` in
`www/src/state.js`). Reads (`getCard`, `listCards`, `getTags`, `getAllTags`,
`onUpdate`) are ungated; writes require the `data-modify` permission.

#### `ctx.api.data.onUpdate(callback)`

Listen for data changes.

```javascript
const unlisten = ctx.api.data.onUpdate((event) => {
  console.log(event.type, event.cardId, event.card);
});
```

**Event Types**: `'card.create'`, `'card.update'`, `'card.delete'`

#### `ctx.api.data.getCard(id)`

Get a card by ID. Returns a deep clone of the card, or `undefined` if it does
not exist. No permission required.

```javascript
const card = ctx.api.data.getCard('card-123');
```

#### `ctx.api.data.listCards()`

List all cards (deep clones). No permission required.

```javascript
const cards = ctx.api.data.listCards();
```

#### `ctx.api.data.createCard(data)`

Create a new card. Requires the `data-modify` permission. Tags in `data.tags`
are applied in the same call. Returns the new card id.

```javascript
const id = ctx.api.data.createCard({
  title: 'New Card',
  body: 'Content',
  tags: ['tag1', 'tag2']
});
```

#### `ctx.api.data.updateCard(id, updates)`

Update a card. Requires the `data-modify` permission. Returns the updated
clone.

```javascript
const updated = ctx.api.data.updateCard('card-123', {
  title: 'Updated Title'
});
```

#### `ctx.api.data.deleteCard(id)`

Delete a card (and its children). Requires the `data-modify` permission.
Returns `true` on success.

```javascript
ctx.api.data.deleteCard('card-123');
```

#### Tag Management

`addTag`, `removeTag`, and `setTags` require the `data-modify` permission;
`getTags` and `getAllTags` are read-only and ungated.

```javascript
// Get tags
const tags = ctx.api.data.getTags('card-123');

// Add tag
ctx.api.data.addTag('card-123', 'new-tag');

// Remove tag
ctx.api.data.removeTag('card-123', 'old-tag');

// Set all tags
ctx.api.data.setTags('card-123', ['tag1', 'tag2']);

// Get all unique tags
const allTags = ctx.api.data.getAllTags();
```

### Storage API

Plugin-specific namespaced storage.

#### `ctx.api.storage.get(key)`

Get a value from storage.

```javascript
const value = await ctx.api.storage.get('myKey');
```

#### `ctx.api.storage.set(key, value)`

Set a value in storage.

```javascript
await ctx.api.storage.set('myKey', { foo: 'bar' });
```

#### `ctx.api.storage.remove(key)`

Remove a value from storage.

```javascript
await ctx.api.storage.remove('myKey');
```

#### `ctx.api.storage.list(prefix)`

List keys with optional prefix.

```javascript
const keys = await ctx.api.storage.list('settings_');
```

#### `ctx.api.storage.getNamespace()`

Get the plugin's storage namespace.

```javascript
const ns = ctx.api.storage.getNamespace();
// Returns: 'plugin_my-plugin_'
```

### Events API

Plugin-specific event system.

#### `ctx.api.events.on(event, callback)`

Listen for an event.

```javascript
const unlisten = ctx.api.events.on('custom-event', (data) => {
  console.log('Event:', data);
});
```

#### `ctx.api.events.emit(event, ...args)`

Emit an event.

```javascript
ctx.api.events.emit('custom-event', { data: 'value' });
```

#### `ctx.api.events.once(event, callback)`

Listen for an event once.

```javascript
ctx.api.events.once('init-complete', () => {
  console.log('Initialized');
});
```

### Middleware API

Intercept core operations. Registrations are namespaced `<pluginId>:<name>`
and tracked (automatically removed on disable/unregister). No permission
required.

#### `ctx.api.middleware.register({ name, priority?, operations?, handler })`

```javascript
const unregister = ctx.api.middleware.register({
  name: 'my-interceptor',       // required
  priority: 10,                 // higher runs first (default 0)
  operations: ['card.save'],    // default ['*']
  handler: async (mw, next) => {
    // mw.operation, mw.args, mw.preventDefault(), mw.stopPropagation()
    await next();               // ALWAYS call next() unless intercepting
  }
});
```

Operations fired by the host app:

| Operation | `mw.args` | `preventDefault()` |
|---|---|---|
| `card.create` | `[cardId, card]` | no effect (fires after creation) |
| `card.update` | `[cardId, card]` | no effect (fires after update) |
| `card.delete` | `[cardId]` | no effect (fires after delete) |
| `card.save` | `[store]` | **aborts the save** |
| `card.render` | `[card, cardTileElement]` | no effect (post-processing) |

Required permissions:

- A `card.render` decorator needs `ui-override`.
- Middleware on `card.create`, `card.update`, `card.delete` or `'*'` needs
  `data-modify`.
- Other hooks, such as `card.save`, need no extra permission. Without
  `data-modify` they can only observe: their changes to `mw.args`,
  `preventDefault()` and `stopPropagation()` are ignored.

#### `ctx.api.middleware.unregister(name)`

Remove one of this plugin's middlewares (the `<pluginId>:` prefix is added
automatically).

### Logger

Scoped logging with plugin prefix.

```javascript
ctx.logger.log('Info message');
ctx.logger.info('Info message');
ctx.logger.warn('Warning message');
ctx.logger.error('Error message');
```

Output: `[Plugin:my-plugin] Info message`

### Utils

`ctx.utils` is the same object as `window.CardSpoke.utils`. The root
`window.CardSpoke` object is frozen, but `utils` is an intentionally mutable
inner object that the host app layer (`www/src/storage.js`) populates **in
place** with async helpers once those functions exist — so plugin code
reaches them through `ctx.utils`. Treat it as read-only.

From a plugin Worker, only an allowlist of helpers is reachable, and helpers
that change data or appearance are permission-gated:

- Card and tag writers (`createCard`, `updateCard`, `addTag`, `setTags`,
  `removeTag`, ...) require `data-modify`.
- `setTheme`, `setTypography` and `setHighContrast` require `ui-override`.
- Read-only helpers need no extra permission.

```javascript
// Async host helpers (see the CardSpoke.utils block in www/src/storage.js
// and the API_REFERENCE Utilities section for the full list).
await ctx.utils.createCard({ title: 'Note', body: '...' });
await ctx.utils.showToast('Done', 'success');
const meta = await ctx.utils.getDatasetMeta();
```

## Permission System

Plugins must declare required permissions in their manifest:

```javascript
manifest: {
  permissions: [
    'ui-override',     // Modify UI and inject elements
    'storage',         // Access local storage
    'network',         // Make network requests
    'filesystem',      // Access filesystem (mobile)
    'core-override',   // Override core functions (high risk)
    'data-modify'      // Perform mutating ctx.api.data calls (createCard, updateCard, deleteCard, addTag, removeTag, setTags)
  ]
}
```

Users are prompted to approve permissions on first install.

## Complete Example

Shown here in the **session-only** module form (real `setup`/`teardown`
functions) for quick development. To ship it, move the `setup` body into a
package `js` string and install it with `window.CardSpoke.Plugin.install(pkg)`
so it persists across reloads.

```javascript
window.CardSpoke.registerPlugin('note-counter', {
  manifest: {
    name: 'Note Counter',
    version: '1.0.0',
    author: 'Example',
    layer: 'feature',
    permissions: ['ui-override', 'storage']
  },
  
  setup: async (ctx) => {
    ctx.logger.info('Initializing');
    
    // Load saved count
    const count = await ctx.api.storage.get('count') || 0;
    
    // Create counter UI
    const counter = document.createElement('div');
    counter.id = 'note-counter';
    counter.textContent = `Total notes: ${count}`;
    
    // Inject into sidebar
    ctx.api.ui.inject('#sidebar', counter, 'prepend');
    
    // Listen for data changes
    ctx.api.data.onUpdate(async (event) => {
      if (event.type === 'card.create') {
        const newCount = count + 1;
        await ctx.api.storage.set('count', newCount);
        counter.textContent = `Total notes: ${newCount}`;
      }
    });
    
    ctx.logger.info('Initialized');
  },
  
  teardown: async (ctx) => {
    ctx.logger.info('Cleaning up');
    // Resources automatically cleaned up
  },
  
  css: `
    #note-counter {
      padding: 1rem;
      font-weight: bold;
      color: var(--accent);
    }
  `
});
```

## Plugin Lifecycle

1. **Install** (`Plugin.install(pkg)`): validate → register → persist the
   package (source strings, not compiled functions) into `store.plugins` →
   auto-enable SAFE/LOW-risk layers (HIGH-risk `app` plugins install
   suspended). Reinstalling the same id updates it in place.
2. **Register**: Plugin definition registered with the runtime (`register`
   throws on a duplicate id).
3. **Enable**:
   - Permissions checked (consent dialog on first enable)
   - CSS applied
   - `setup(ctx)` called (the compiled `js` body)
   - Resources tracked
   - `enabled: true` persisted
4. **Active**: Plugin responds to events, modifies UI.
5. **Disable** ("suspend"):
   - `teardown(ctx)` called
   - CSS removed
   - Tracked resources cleaned up
   - `enabled: false` persisted (survives reload)
6. **Unregister** (delete): disable + cleanup + **revoke granted
   permissions** + remove the `store.plugins` entry.
7. **Reload**: at boot, `Plugin.syncFromStore()` re-registers every stored
   plugin from its persisted `js`/`teardownJs` strings and re-enables the
   ones marked enabled. Idempotent; `?safemode` registers everything but
   enables nothing.

## Resource Management

All resources created via the Plugin API are automatically tracked:

- DOM elements (from `inject()`, `replace()`)
- Event listeners (from `events.on()`)
- Data listeners (from `data.onUpdate()`)
- Registered components

When a plugin is disabled, all resources are automatically cleaned up.

## Best Practices

1. **Use namespaced storage**: Don't pollute global storage
2. **Clean up in teardown**: Even though automatic cleanup exists
3. **Handle errors**: Wrap async operations in try/catch
4. **Request minimal permissions**: Only what you need
5. **Test hot-unload**: Ensure your plugin unloads cleanly
6. **Use logger**: For debugging and user feedback

## See Also

- [Plugin System Documentation](../architecture/PLUGIN_SYSTEM.md) - Complete plugin system guide including permissions
- [API Reference](./API_REFERENCE.md) - Consolidated runtime contracts
- [Plugin Invariants](../architecture/PLUGIN_INVARIANTS.md) - The stability contract
- [`sample-plugins/`](../../sample-plugins/) - Nine working packages + `TEMPLATE.json`
- [Middleware Pipeline](./MIDDLEWARE_PIPELINE.md) - Intercept operations
- [Component Registry](./COMPONENT_REGISTRY.md) - UI components

### Network API

- `ctx.api.network.fetch(url, options)` wraps `window.fetch` and requires the `network` permission.
- `ctx.api.network.xhr()` creates an `XMLHttpRequest` and requires the `network` permission.

### Filesystem API

- `ctx.api.filesystem.readFile(path, options)` reads files through Capacitor Filesystem when available.
- `ctx.api.filesystem.writeFile(path, data, options)` writes files through Capacitor Filesystem when available.
- Both filesystem calls require the `filesystem` permission and throw if Filesystem is unavailable on the current platform.
