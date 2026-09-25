# Plugin API reference

CardSpoke 0.21.1 / schema 4. Distributed JSON package JavaScript runs in a
dedicated worker with explicit `plugin-code` trust consent and host permission
checks. It has no DOM. Workers are not a complete hostile-code sandbox.

For a complete reference that can be given to an author without the app or
its source, use the [standalone plugin authoring guide](../guides/PLUGIN_AUTHORING_GUIDE.md).
The [Plugin System](../architecture/PLUGIN_SYSTEM.md) defines the lifecycle
and architecture; [Plugin Invariants](../architecture/PLUGIN_INVARIANTS.md)
defines compatibility boundaries. The [advanced collection](../../sample-plugins/advanced/README.md)
provides nine packaged implementations and browser acceptance tests.

This page replaces the obsolete main-thread examples previously listed here.
`CardSpoke.registerPlugin` is still available to trusted embedding host code,
but its function-form context is not the portable JSON package API.

## Worker API index

Every call below is prefixed by `ctx.api.` unless otherwise stated.

| Area | Methods | Permission |
| --- | --- | --- |
| UI | `ui.inject(selector, vnode, position?)`, `ui.replace(selector, vnode)`, `ui.registerComponent(name, {render, priority?})`, `ui.unregisterComponent(name)` | `ui-override` |
| Toast | `ui.showToast(message, type?, duration?)` | None |
| Card reads | `data.getCard(id)`, `data.listCards()`, `data.getTags(id)`, `data.getAllTags()` | None |
| Card writes | `data.createCard({title, body, parentId, tags})`, `data.updateCard(id, updates)`, `data.deleteCard(id)` | `data-modify` |
| Tag writes | `data.addTag(id, tag)`, `data.removeTag(id, tag)`, `data.setTags(id, tags)` | `data-modify` |
| Data events | `data.onUpdate(callback)` | None |
| Storage | `storage.get(key)`, `set(key, value)`, `remove(key)`, `list(prefix?)`, `getNamespace()` | `storage` |
| Event bus | `events.on(name, cb)`, `once(name, cb)`, `off(name, cb)`, `emit(name, ...args)` | None |
| Middleware | `middleware.register({name, priority?, operations?, handler})`, `unregister(name)` | Depends on operations; see below |
| Network | `network.fetch(url, options?)` | `network` |
| Native files | `filesystem.readFile(path, options?)`, `writeFile(path, data, options?)` | `filesystem`; requires Capacitor |

Await reads and writes, UI calls/handles, storage, network, filesystem and
`ctx.utils` helpers. **Exceptions:** data/event subscriptions synchronously
return unsubscribe functions; event emission is fire-and-forget. Middleware
registration synchronously returns an unregister function whose `.ready`
Promise reports registration acceptance. Await `.ready`, not the function.

## UI and middleware examples

```javascript
const handle = await ctx.api.ui.inject('.header',
  ctx.h('button', { type: 'button', onclick: async () => {
    const cards = await ctx.api.data.listCards();
    await ctx.api.ui.showToast(cards.length + ' cards');
  } }, 'Count cards'), 'append');
// await handle.update(newVnode); await handle.remove();

const unregister = ctx.api.middleware.register({
  name: 'body-badge', operations: ['card.render'],
  handler: card => ({ appendChildren: { '.card-content': [
    ctx.h('small', {}, String(card.body || '').length + ' characters')
  ] } })
});
await unregister.ready;
```

UI uses supported `ctx.h` vnodes, not live elements. Events contain serializable
`target.value`, `target.checked`, and `target.dataset`; they are not DOM events.
Updates replace child nodes and can lose focus. Missing selectors produce no-op
handles. Keep input drafts in worker state and refresh explicitly.

`card.render` requires `ui-override` and returns a patch from
`(card, tileSnapshot)`. Other middleware receives `(mw, next)`; call
`await next()` unless intentionally intervening. Write hooks
(`card.create`, `card.update`, `card.delete`, `*`) require `data-modify`.
`card.save` without `data-modify` is observe-only; argument edits and
cancellation flags are ignored. Save hooks do not prove durable persistence.

## Data and lifetime rules

- Reads return clones. `createCard` resolves to an ID, not a card.
- `updateCard` is shallow; preserve unrelated `modsData` and tags.
- Protected identity/hierarchy fields cannot be changed through `updateCard`.
  Create children through `parentId`; no worker reparent API exists.
- `deleteCard` deletes descendants too. Multi-step writes are not atomic.
- Use `card.modsData[ctx.modId]` for card-owned state with a local schema number.
- Default key/value storage uses `plugin_<id>_`, scoped to origin and plugin
  ID, not automatically to a dataset. Uninstall does not erase user cards or
  promise deletion/export of key/value preferences.
- `ctx.config` is read on worker enable; settings edits require re-enable.
- Suspend terminates the worker and cleans tracked UI/registrations. Already
  rendered card/component output may need navigation/reload to repaint.

`network.fetch` returns a buffered response-like object with `ok`, `status`,
`statusText`, `url`, `headers.get/entries`, and async `text/json/arrayBuffer`.
`network.xhr()` is **unsupported in workers**. `ctx.utils` is an allowlist,
not arbitrary access to host internals; the complete list and safe element
reference are in the standalone guide.
