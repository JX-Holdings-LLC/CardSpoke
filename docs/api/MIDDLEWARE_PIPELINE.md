# Middleware Pipeline API

**Version:** 0.21.1

The Middleware Pipeline provides a priority-weighted, interceptor-style architecture that allows plugins to wrap core operations, modify data, or cancel operations before they complete.

**How plugins use it:** register middleware from your setup body via
`ctx.api.middleware.register({ name, priority, operations, handler })` — the
registration is namespaced (`<pluginId>:<name>`) and removed automatically
when the plugin is suspended or deleted. The pipeline is also reachable
directly as `window.CardSpoke.Middleware` for the host app and advanced
app-layer plugins, but `ctx.api.middleware` is the preferred surface because
it is tracked and cleaned up for you.

## Overview

The middleware pipeline provides:

- **Interception**: Wrap and modify core operations before/after execution
- **Priority Ordering**: Deterministic execution order based on priority weights
- **Operation Control**: Prevent or modify operations mid-pipeline
- **Error Handling**: Graceful error handling with fallback support

## Core Concepts

### Middleware Context

Every middleware receives a context object:

```javascript
{
  operation: string,      // Operation name (e.g., 'card.save')
  args: any[],           // Operation arguments
  result: any,           // Operation result (set by handler)
  error: Error,          // Error if operation failed
  stopPropagation(),     // Stop further middleware execution
  preventDefault()       // Prevent the operation from completing
}
```

### Middleware Definition

```javascript
{
  name: string,          // Unique middleware name
  priority: number,      // Higher priority runs first (default: 0)
  operations: string[],  // Operations to intercept (* for all)
  handler: async (ctx, next) => Promise<void>
}
```

## API Reference

The methods below are available on `window.CardSpoke.Middleware`. From plugin
code, prefer `ctx.api.middleware.register(...)`, which wraps `register` with
per-plugin namespacing and automatic cleanup.

### `register(middleware)`

Register a new middleware.

```javascript
// From plugin code, prefer: ctx.api.middleware.register({ ... })
window.CardSpoke.Middleware.register({
  name: 'my-interceptor',
  priority: 10,
  operations: ['card.save', 'card.delete'],
  handler: async (ctx, next) => {
    console.log('Before:', ctx.operation, ctx.args);
    await next(); // Call next middleware
    console.log('After:', ctx.operation);
  }
});
```

**Conflict warning:** If two middlewares are registered with the same `priority` and overlapping `operations`, the pipeline logs a console warning about the conflicting registration (execution order between them is otherwise determined by registration order).

### `unregister(name)`

Unregister a middleware by name.

### `run(operation, args)`

Execute the middleware pipeline for an operation.

```javascript
const result = await Middleware.run('card.save', [card]);
if (result.prevented) {
  console.log('Operation was prevented');
}
```

### `list()`

List all registered middlewares.

```javascript
const middlewares = Middleware.list();
// Returns: [{ name, priority, operations }, ...]
```

## Standard Operations

The following operations are available for interception:

| Operation | Description | Arguments |
|-----------|-------------|-----------|
| `card.create` | Card creation flow | `[id, card]` |
| `card.update` | Card update flow | `[id, card]` |
| `card.delete` | Card deletion flow | `[id]` |
| `card.save` | Store persistence checkpoint | `[store]` |
| `card.render` | Card rendering | `[card, element]` |

## Examples

These examples are written as they would appear inside a plugin's setup body
(they use `ctx.api.middleware`). `mw` is the middleware context;
`ctx` is the plugin context.

### Validation Middleware

Note: `card.create`/`card.update` fire *after* the change, so
`preventDefault()` on them is a no-op — use them to react, not to block. To
veto a write, intercept `card.save`.

```javascript
ctx.api.middleware.register({
  name: 'card-logger',
  priority: 100, // Run first
  operations: ['card.create', 'card.update'],
  handler: async (mw, next) => {
    const card = mw.args[1];
    if (card && (!card.title || card.title.length < 3)) {
      ctx.api.ui.showToast('Heads up: a card has a very short title', 'warning');
    }
    await next();
  }
});
```

### Logging Middleware

```javascript
ctx.api.middleware.register({
  name: 'audit-logger',
  priority: -100, // Run last
  operations: ['*'],
  handler: async (mw, next) => {
    await next();
    ctx.logger.info('Operation:', mw.operation);
  }
});
```

### Data Enrichment

```javascript
ctx.api.middleware.register({
  name: 'auto-tagger',
  priority: 50,
  operations: ['card.create'],
  handler: async (mw, next) => {
    await next();
    const cardId = mw.args[0];
    const card = mw.args[1];
    // Add an automatic tag based on content
    if (card && card.body && card.body.includes('TODO')) {
      const tags = ctx.api.data.getTags(cardId) || [];
      if (!tags.includes('todo')) ctx.api.data.setTags(cardId, tags.concat('todo'));
    }
  }
});
```

## Best Practices

1. **Use meaningful names**: Name your middleware descriptively
2. **Set appropriate priority**: Higher priority (100+) for validators, lower (-100) for loggers
3. **Always call next()**: Unless intentionally stopping the pipeline
4. **Handle errors**: Wrap async operations in try/catch
5. **Keep it fast**: Middleware executes sequentially and awaits each handler
6. **Document operations**: Specify which operations your middleware handles

## Performance

- Middleware is cached by operation for fast lookup
- Priority-sorted execution ensures deterministic order
- Error isolation prevents one middleware from breaking others

## See Also

- [Plugin API](./PLUGIN_API.md) - Full plugin development guide
- [Component Registry](./COMPONENT_REGISTRY.md) - UI component system
- [Storage Drivers](./STORAGE_DRIVER_INTERFACE.md) - Pluggable storage
