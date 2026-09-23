# Schema & Migration Docs

CardSpoke uses a schema version (`schemaVersion`) to track data model changes across the local-first storage stack (LocalStorage/IndexedDB). Use this document to plan migrations and communicate compatibility.

## Current Schema Overview

- **Schema version:** 4 (sourced from runtime constant `SCHEMA_VERSION`)
- **Data domains:**
  - Cards and hierarchical relationships
  - User preferences (theme, layout, toggles)
  - Plugin registry/manifest cache
  - Local file references (if enabled via Filesystem)
- **Default store shape:** `rootOrder` (top-level card ordering), `cards` (id → card), `plugins` (plugin state), `bookmarks`, `recentCards`, `viewMode`, `activeTheme`, `richTextEnabled`.
- **Storage layers:**
  - LocalStorage for lightweight config
  - IndexedDB for structured card data and histories
  - Optional filesystem assets via Capacitor Filesystem (documented per plugin)

## Versioning Rules

- Increment `schemaVersion` on any backward-incompatible change.
- Provide migration steps and fallback behavior for every version bump.
- Keep migrations idempotent and safe to re-run.
- Log or surface errors when migrations fail; never silently drop user data.

## Current Migration Implementation

**Note:** The current implementation (v0.21.1, schema v4) ships a baseline structural repair layer, implemented in `www/src/core/migrations.js`:

- **`migrateCard(card)`**: Ensures baseline fields exist (`children` array, `tags` array, `modsData` object) without removing any existing fields. Returns `{ card, changed, warnings }`.
- **`migrateStore(store)`**: Iterates every card in `store.cards` and runs `migrateCard` on each, catching per-card errors as warnings rather than dropping data. Returns `{ store, changed, migratedCount, warnings }`.

Additionally:

- **Root-order rebuild logic:** During IndexedDB initialization, the system detects missing root cards and reconstructs the `rootOrder` array. This ensures data integrity when cards are orphaned.
- **Fallback behavior:** If migration fails, the app attempts to fall back to read-only mode.

**Nuance:** There is no migration table that maps the overall store `schemaVersion` (e.g. 3 → 4) to a transformation function. Future work could add a store-level schemaVersion migration table if a change requires it, along with version compatibility checks before loading data and more comprehensive migration test coverage. (The per-typed-card-kind migration system from earlier internal builds was removed along with the typed-card platform layer, which is outside the public app scope.)

## Migration Template

For each future schema change, record:

- **From → To:** schemaVersion numbers
- **Change summary:** What changed and why
- **Migration steps:** Ordered operations, including data transformations
- **Fallback behavior:** How the app handles migration failure
- **Plugin impact:** Which plugins depend on the change

Example:

```md
### schemaVersion 3 → 4
- **Change:** Added per-card tags collection; normalized card links.
- **Migration:**
  1. Create `tags` store in IndexedDB.
  2. Migrate legacy tag arrays on cards to references.
  3. Validate referential integrity; log any skipped records.
- **Fallback:** If migration fails, keep database at v3, disable tag-dependent features, prompt user to retry.
- **Plugins:** Tagging plugin v2.0+ requires schemaVersion >= 4.
```

## Fallback & Compatibility

- On incompatible schema, block plugins and prompt users with remediation steps.
- Provide read-only access if feasible when migrations cannot complete.
- Plugins must declare `compatibility` in their manifest and refuse to run on older schemas. Include the expected `cardspoke_*` preference keys any plugin consumes so mismatched schemas do not wipe toggles.

## Testing Migrations

- Add uvu tests for each migration path (happy path + failure cases).
- Include sample data fixtures for old versions.
- Exercise downgrade/remove scenarios when possible.

## Documentation Updates

- Update this file for every schemaVersion change.
- Reference schema changes in release notes and relevant plugin documentation.
