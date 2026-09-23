# CardSpoke Documentation

CardSpoke is a local-first, card-based knowledge app. This documentation describes the public 0.21.1 preview, maintained by [Jeffrey Guntly](https://github.com/jxburros) and [JX Holdings, LLC](https://jxholdings.com).

## Choose a starting point

| If you are… | Start here |
| --- | --- |
| Using CardSpoke | [Feature Catalog](./guides/FEATURES.md), then [Storage & Privacy](./policies/STORAGE_AND_PRIVACY.md) |
| Setting up a development environment | [Developer Guide](./guides/DEVELOPER_GUIDE.md) |
| Building a plugin | [Plugin System](./architecture/PLUGIN_SYSTEM.md), then the [API Reference](./api/API_REFERENCE.md) |
| Reviewing a change with an AI agent or as a maintainer | [AI & Contributor Context](./AI_CONTEXT.md) |
| Preparing a release | [Release & Versioning](./policies/RELEASE_AND_VERSIONING.md) and [CHANGELOG](../CHANGELOG.md) |

## Documentation map

- [`architecture/`](./architecture/) — implementation boundaries, plugin design, and compatibility invariants.
- [`api/`](./api/) — public plugin, schema, middleware, component, and storage contracts.
- [`guides/`](./guides/) — development, testing, Capacitor, offline-first, feature, and deviation guides.
- [`policies/`](./policies/) — release, security, privacy, and community policies.
- [`specifications/`](./specifications/) — product scope and longer-term specification material.
- [`analysis/`](./analysis/) — functional reviews and analysis write-ups.
- [`reports/`](./reports/) — dated historical audits; these record past findings and are not current release documentation.

## Documentation status and authority

The current product contract is owned by the source code, `package.json`, the app metadata in `www/src/state.js`, and the current policy/reference documents. Historical reports and changelog entries describe their release dates only. If documents disagree, follow the precedence in [AI & Contributor Context](./AI_CONTEXT.md) and correct the lower-authority document in the same change.

The project repository is [jxburros/CardSpoke](https://github.com/jxburros/CardSpoke).
