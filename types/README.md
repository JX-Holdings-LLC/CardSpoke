# @cardspoke/core

TypeScript type definitions for CardSpoke plugin development.

## Installation

**Note:** This package is not currently published to npm. For now, use the type definitions directly from the repository.

### For Local Development

Reference the types directly from the repository:

```typescript
/// <reference path="path/to/CardSpoke/types/index.d.ts" />

const plugin: CardSpoke.PluginDefinition = {
  manifest: {
    name: "My Plugin",
    version: "1.0.0",
    author: "Author",
    layer: "feature",
    permissions: ["ui-override"]
  },
  
  setup: async (ctx: CardSpoke.PluginContext) => {
    // TypeScript provides full type checking
    const cards = ctx.api.data.listCards();
    ctx.api.ui.showToast('Loaded!', 'success');
  }
};

export default plugin;
```

### JavaScript (with JSDoc)

```javascript
/**
 * @type {CardSpoke.PluginDefinition}
 */
const plugin = {
  manifest: {
    name: "My Plugin",
    version: "1.0.0",
    author: "Author",
    layer: "feature"
  },
  
  setup: async (ctx) => {
    // ctx has type hints in VS Code if you include a reference to types/index.d.ts
    const cards = ctx.api.data.listCards();
  }
};

export default plugin;
```

## Available Types

### Core Types

- `Card` - Card data structure
- `Store` - Application store
- `ModManifest` - Plugin manifest
- `PermissionType` - Available permissions

### Plugin Types

- `PluginDefinition` - Plugin definition
- `PluginContext` - Plugin execution context
- `PluginAPI` - Sandboxed API object
- `PluginInstance` - Running plugin instance

### API Types

- `UIApi` - UI manipulation API
- `DataApi` - Data access API
- `StorageApi` - Persistent storage API
- `EventApi` - Event system API

### Middleware Types

- `Middleware` - Middleware definition
- `MiddlewareContext` - Middleware execution context
- `MiddlewareFunction` - Middleware handler function

### Component Types

- `Component` - UI component definition
- `ComponentRegistryClass` - Component registry manager

### Storage Types

- `StorageDriver` - Storage driver interface
- `StorageDriverRegistryClass` - Driver registry manager

### Utility Types

- `Logger` - Scoped logger
- `PluginUtils` - Utility functions
- `NavigationState` - Navigation state

## Documentation

See the [CardSpoke documentation](https://github.com/JX-Holdings-LLC/CardSpoke/blob/main/docs/) for:

- [Plugin API Guide](https://github.com/JX-Holdings-LLC/CardSpoke/blob/main/docs/api/PLUGIN_API.md)
- [Middleware Pipeline](https://github.com/JX-Holdings-LLC/CardSpoke/blob/main/docs/api/MIDDLEWARE_PIPELINE.md)
- [Component Registry](https://github.com/JX-Holdings-LLC/CardSpoke/blob/main/docs/api/COMPONENT_REGISTRY.md)
- [API Reference](https://github.com/JX-Holdings-LLC/CardSpoke/blob/main/docs/api/API_REFERENCE.md)
- [Plugin System](https://github.com/JX-Holdings-LLC/CardSpoke/blob/main/docs/architecture/PLUGIN_SYSTEM.md)

## License

ISC
