# CardSpoke Architecture Diagram

## Modern Plugin Architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│                          CardSpoke App                              │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              Core Application Layer                         │   │
│  │  • Card CRUD • Rendering • Navigation • Search             │   │
│  └────────────────────────────────────────────────────────────┘   │
│                               ↓                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │            🔄 Middleware Pipeline                          │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │  Priority Queue (Higher → Lower)                   │   │   │
│  │  │  • Validator (100) → Interceptor (50) → Logger (-100)│  │   │
│  │  │  • Can modify, cancel, or pass-through            │   │   │
│  │  │  • Operations: card.save, card.delete, etc.       │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                               ↓                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │            🎨 Component Registry                           │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │  Component Map (Priority-based)                    │   │   │
│  │  │  • Card → CustomCard (priority: 50)               │   │   │
│  │  │  • SearchBar → EnhancedSearch (priority: 75)      │   │   │
│  │  │  • Sidebar → CustomSidebar (priority: 10)         │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                               ↓                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │            🔌 Plugin Manager                               │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │  Active Plugins (No Sandbox, Page Realm)          │   │   │
│  │  │  ┌──────────────┬──────────────┬──────────────┐  │   │   │
│  │  │  │   Plugin 1   │   Plugin 2   │   Plugin 3   │  │   │   │
│  │  │  │  page realm  │  page realm  │  page realm  │  │   │   │
│  │  │  └──────────────┴──────────────┴──────────────┘  │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                               ↓                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │            🔐 Permissions System                           │   │
│  │  • User consent dialogs                                    │   │
│  │  • Permission checking: ui-override, storage, network      │   │
│  │  • Revocable permissions                                   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                               ↓                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │            💾 Storage Driver Registry                      │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │  Available Drivers                                 │   │   │
│  │  │  • LocalStorage (default)                         │   │   │
│  │  │  • IndexedDB (opt-in, per dataset)                │   │   │
│  │  │  • Local File (File System Access API)            │   │   │
│  │  │  • Custom drivers: registry only, unused          │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │            🛠️  Plugin API (Full Trust)                     │   │
│  │  ┌──────────────────┬──────────────────┐                  │   │
│  │  │   ctx.api.ui     │   ctx.api.data   │                  │   │
│  │  │   • inject()     │   • getCard()    │                  │   │
│  │  │   • replace()    │   • listCards()  │                  │   │
│  │  │   • registerComponent() │ • onUpdate() │               │   │
│  │  │   • unregisterComponent()│           │                  │   │
│  │  └──────────────────┴──────────────────┘                  │   │
│  │  ┌──────────────────┬──────────────────┐                  │   │
│  │  │ ctx.api.storage  │  ctx.api.events  │                  │   │
│  │  │   • get()        │   • on()         │                  │   │
│  │  │   • set()        │   • emit()       │                  │   │
│  │  │   • remove()     │   • once()       │                  │   │
│  │  │   • list()       │                  │                  │   │
│  │  │   • getNamespace()│  (keys auto-namespaced per plugin, │   │
│  │  │                  │   prefixed plugin_<pluginId>_)      │   │
│  │  └──────────────────┴──────────────────┘                  │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                      │
└────────────────────────────────────────────────────────────────────┘
```

## Data Flow: Card Save Operation

### Card Save Operation Flow

```text
User clicks Save
    ↓
Middleware.run('card.save', [card])
    ↓
Validator Middleware (priority: 100)
    ├─ Validates card data
    ├─ Can prevent() if invalid
    └─ Calls next()
    ↓
Enrichment Middleware (priority: 50)
    ├─ Adds metadata
    ├─ Modifies card object
    └─ Calls next()
    ↓
createCard() / updateCard()
    ↓
Store updated
    ↓
Logger Middleware (priority: -100)
    ├─ Logs the operation
    └─ Calls next()
    ↓
Plugin.notifyDataUpdate({ type: 'card.create', cardId, card })
    ↓
Plugins receive update via ctx.api.data.onUpdate()
    ↓
Components re-render via Component Registry
```

## Plugin Lifecycle

```text
┌────────────────────────────────────────────────┐
│              Plugin Registration                │
│  CardSpoke.registerPlugin('my-plugin', def)    │
└────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────┐
│          Permission Check (if needed)           │
│  • User sees consent dialog                    │
│  • Approves permissions                        │
└────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────┐
│              Plugin Activation                  │
│  1. Create plugin context (ctx)                │
│  2. Apply CSS                                  │
│  3. Call setup(ctx)                            │
│  4. Track resources                            │
└────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────┐
│              Plugin Active                      │
│  • Responds to events                          │
│  • Modifies UI via ctx.api                     │
│  • Resources tracked                           │
└────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────┐
│           Plugin Deactivation                   │
│  1. Call teardown(ctx)                         │
│  2. Remove CSS                                 │
│  3. Clean up resources automatically           │
│  4. Remove DOM elements                        │
│  5. Unregister listeners                       │
│  6. Storage persists                           │
└────────────────────────────────────────────────┘
```

## Component Override Resolution

```text
Component Request: "Card"
         ↓
┌─────────────────────────────┐
│   Component Registry        │
│                             │
│   Registered Components:    │
│   • DefaultCard (p: 0)     │
│   • ThemeCard (p: 50)      │
│   • FeatureCard (p: 75)    │
│   • AppCard (p: 100)   ← Selected (highest)
└─────────────────────────────┘
         ↓
   AppCard.render(props)
         ↓
   Returns HTMLElement
```

## Key Architectural Principles

### 1. Separation of Concerns

- **Core**: Business logic and data management
- **Middleware**: Operation interception and modification
- **Components**: UI rendering and presentation
- **Plugins**: Extensions and customization
- **Storage**: Data persistence abstraction

### 2. Priority-Based Resolution

- **Middleware**: Higher priority runs first. On a priority tie the sort is
  stable, so the *first* registered runs first; a conflict warning is logged
- **Components**: Higher priority overrides lower. On a priority tie the *last*
  registered wins (the earlier registration is replaced) and a conflict warning
  is logged. A lower-priority registration is rejected outright

### 3. Resource Management

- **Automatic Tracking**: DOM nodes, listeners, styles, component overrides, and
  middleware registered through `ctx` are recorded per plugin
- **Clean Unload**: Tracked resources are removed on plugin disable/suspend
- **Best-effort, not enforced**: cleanup covers what a plugin does *through the
  `ctx` API*. A plugin that touches `document` directly is responsible for its
  own teardown, and anything it leaves behind survives suspend

### 4. Security Layers

JavaScript packages execute inside dedicated workers with an explicit plugin-code trust grant, permission-checked host APIs, restricted vnode rendering and termination deadlines. CSS-only themes remain separate. Workers reduce risk but do not make hostile code safe; dynamic imports and browser capabilities require additional origin/CSP isolation. See [Plugin System](./PLUGIN_SYSTEM.md) and [Security and Safety](../policies/SECURITY_AND_SAFETY.md).

### 5. Compatibility

- **Schema gating**: plugins declare schema compatibility and are blocked on
  incompatible schema versions
- **Legacy-format tolerance**: plugin entries without a modern definition are
  recognized and reported rather than crashing the registry
- **Gradual Migration**: no forced upgrades within a schema version

## Technology Stack

```text
┌─────────────────────────────────────────┐
│          Development Layer              │
│  • TypeScript definitions (types/)      │
│  • Vite build system                    │
│  • ES modules in www/src/               │
│  • uvu test suite                       │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│          Application Layer              │
│  • Middleware Pipeline (ES2020)        │
│  • Component Registry (ES2020)         │
│  • Plugin Manager (ES2020)             │
│  • Storage Abstraction (ES2020)        │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│          Runtime Layer                  │
│  • Modern JavaScript (ES2020+)         │
│  • IndexedDB / LocalStorage            │
│  • DOM API                             │
│  • Capacitor (mobile)                  │
└─────────────────────────────────────────┘
```

## Performance Characteristics

| System | Lookup | Registration | Execution |
|--------|--------|--------------|-----------|
| Middleware | O(1) cached | O(n log n) sort | O(n) pipeline |
| Components | O(1) Map | O(1) | O(1) |
| Plugin API | O(1) Map | O(1) | O(1) |
| Storage | O(1) Map | O(1) | Depends on driver |

## Size Impact

Everything under `www/src/` is fused by Vite into the single `www/app.js` the app
ships, so per-module *minified* sizes are not separable after the build. The
figures below are source sizes of the plugin-runtime modules, measured at 0.20.0:

| Module (`www/src/core/`) | Source size |
|--------------------------|-------------|
| `plugin-api.js` | ~52 KB |
| `permissions.js` | ~14 KB |
| `plugin-validator.js` | ~8 KB |
| `middleware.js` | ~6 KB |
| `global-api.js` | ~4.4 KB |
| `dataset-crypto.js` | ~4.1 KB |
| `component-registry.js` | ~4.1 KB |
| `storage-driver-registry.js` | ~3.4 KB |
| `migrations.js` | ~2.6 KB |
| **Total plugin runtime (source)** | **~98 KB** |

Shipped bundle: `www/app.js` is ~391 KB raw, ~79 KB gzipped. Re-measure with
`ls -l www/app.js` and `gzip -c www/app.js | wc -c` rather than trusting these
numbers after significant changes.

## Summary

What this architecture provides:

- A documented plugin API with middleware hooks and component overrides
- Consent, risk labeling, and Safe Mode around full-trust plugin code
- TypeScript definitions under `types/` for plugin authors
- Pluggable storage drivers (LocalStorage, IndexedDB, Local File)
- A local-first data model with no accounts, hosted sync, or telemetry
- A single-bundle app that loads without a build step at runtime

What it explicitly does **not** provide:

- A complete hostile-code sandbox
- A security boundary from the `permissions` array
- Cloud storage drivers or remote sync
- Guaranteed cleanup of plugin side effects made outside the `ctx` API

The bundled `www/app.js` path also works from `file://`; the service worker,
offline caching, and the plugin gallery fetch require an HTTP origin.
