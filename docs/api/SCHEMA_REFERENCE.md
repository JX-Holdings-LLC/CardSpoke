# Schema Reference

This file summarizes the persisted data model and schema versioning rules used by CardSpoke.

**Current App Version:** 0.21.1 | **Schema Version:** 4 | **Release Date:** 2026-09-17

## Versioning

- **Current schema version:** 4.
- Runtime constant `SCHEMA_VERSION` is defined in `www/src/state.js` (bundled into `www/app.js`) and surfaced to plugins via the plugin context (`ctx.schemaVersion`).
- Bump the schema version on any backward-incompatible change and ship an accompanying migration plan.

## Core domains

- **Cards:** `cards` map keyed by id, with `rootOrder` tracking top-level ordering and `children` arrays on each card for hierarchy.
- **Plugins:** `plugins` registry stores plugin metadata, `enabled` flag, and bundled JS/CSS for replay at startup.
- **User preferences:** `viewMode`, `activeTheme`, typography preset (`cardspoke_typography`), high contrast (`cardspoke_highcontrast`), grid view (`cardspoke_gridView`), and rich text flags (`cardspoke_richtext`).
- **Navigation & history:** `navState` plus `recentCards` and `bookmarks` collections for quick recall.
- **Trash/undo:** Undo/redo stacks (up to 50 entries) and `trashBin` entries (up to 100) keep recovery history.

## Card shape

Each card in the `cards` map has the following structure:

```javascript
{
  id: string,           // Unique identifier (timestamp + random)
  title: string,        // Card title
  body: string,         // Card content/body text
  parentId: string|null,// Parent card ID (null for root cards)
  children: string[],   // Array of child card IDs
  tags: string[],       // Array of tag strings
  createdAt: number,    // Creation timestamp (ms)
  updatedAt: number,    // Last update timestamp (ms)
  isRichText?: boolean, // Per-card rich text (Markdown) flag
  modsData?: object     // Optional plugin-specific data
}
```

## Default store shape

A new dataset starts with:

```javascript
{
  rootOrder: [],        // Ordered array of root card IDs
  cards: {},            // Map of card ID to card object
  plugins: {},             // Map of plugin ID to plugin state
  bookmarks: [],        // Array of bookmarked card IDs
  recentCards: [],      // Array of recently accessed card IDs
  viewMode: 'normal',   // 'normal' or 'compact'
  activeTheme: 'light', // 'light' or 'dark'
  richTextEnabled: false
}
```

## LocalStorage keys

Preferences are stored under `cardspoke_*` keys in LocalStorage:

- `cardspoke_richtext` - Rich text mode enabled (boolean as string)
- `cardspoke_gridView` - Grid view enabled (boolean as string)
- `cardspoke_highcontrast` - High contrast mode (boolean as string)
- `cardspoke_typography` - Typography preset (default/comfortable/compact/dyslexia)
- `cardspoke_devmode` - Developer mode enabled (boolean as string)
- `cardspoke_theme` - Current theme (light/dark)
- `cardspoke_activeThemeMod` - ID of active theme plugin
- `cardspoke_hasSeenGettingStarted` - First-run guide shown (boolean as string)
- `cardspoke_dataset_metadata` - Dataset manager metadata (JSON)
- `activeInstance` - Current active dataset/instance key

## Storage layers

- **LocalStorage**: lightweight config (preferences, dev mode, active dataset id, typography/high-contrast flags).
- **IndexedDB**: structured datasets via the `datasets` object store in `CardSpokeDB`.
- **Optional local file driver**: saves the dataset to a user-chosen file via the File System Access API. Cloud drivers (Google Drive, OneDrive, WebDAV) are not part of the public app and are deferred to a future version (see [Storage Driver Interface](./STORAGE_DRIVER_INTERFACE.md)).

## Migration expectations

- Keep migrations idempotent and provide fallbacks if a migration fails (e.g., block plugins, fall back to read-only view).
- Document every migration with from-to versions, change summary, steps, fallback behavior, and plugin impact.
