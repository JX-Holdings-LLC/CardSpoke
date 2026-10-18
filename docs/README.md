# CardSpoke Documentation

CardSpoke is a private, local-first notebook where every note is a card. This documentation describes the public 0.21.1 preview, maintained by [Jeffrey Guntly](https://github.com/jxburros) and [JX Holdings, LLC](https://jxholdings.com).

## Choose a starting point

### For people using CardSpoke

| If you want to… | Start here |
| --- | --- |
| Try it for the first time | [Your first ten minutes](./guides/GETTING_STARTED.md) |
| See everything it can do | [Feature Guide](./guides/FEATURES.md) |
| Know where your cards live | [Storage & Privacy](./policies/STORAGE_AND_PRIVACY.md) |
| Use the desktop app | [Desktop guide](./guides/DESKTOP.md) |
| Script your cards from a terminal | [CLI guide](./guides/CLI.md) (experimental) |

### For plugin authors

| If you want to… | Start here |
| --- | --- |
| Build a plugin | [Plugin Authoring Guide](./guides/PLUGIN_AUTHORING_GUIDE.md), then the [sample plugins](../sample-plugins/advanced/README.md) |
| Look up the `ctx` API, permissions or lifecycle | [Plugin System](./architecture/PLUGIN_SYSTEM.md) and [Plugin API](./api/PLUGIN_API.md) |

### For contributors and maintainers

| If you want to… | Start here |
| --- | --- |
| Work on CardSpoke itself | [Developer Guide](./guides/DEVELOPER_GUIDE.md) |
| Understand how the source and plugin runtime fit together | [Code & Plugin System Handbook](./guides/CODE_AND_PLUGIN_SYSTEM_HANDBOOK.md) |
| Review a change, with or without an AI agent | [AI & Contributor Context](./AI_CONTEXT.md) |
| Prepare a release | [Release & Versioning](./policies/RELEASE_AND_VERSIONING.md) and [CHANGELOG](../CHANGELOG.md) |
| Build for phones (experimental, unpublished) | [Capacitor guide](./guides/README.CAPACITOR.md) |

## Documentation map

- [`architecture/`](./architecture/) — implementation boundaries, plugin design, and compatibility invariants.
- [`api/`](./api/) — public plugin, schema, middleware, component, and storage contracts.
- [`guides/`](./guides/) — getting started, features, plugins, development, testing, offline-first and deviation guides, plus the experimental Capacitor guide.
- [`policies/`](./policies/) — release, security, privacy, and community policies.
- [`specifications/`](./specifications/) — product scope and longer-term specification material.
- [`analysis/`](./analysis/) — functional reviews and analysis write-ups.
- [`reports/`](./reports/) — dated historical audits; these record past findings and are not current release documentation.
- [`../brand/`](../brand/README.md) — the logo, icons and brand guide, and the files the app uses.

## Documentation status and authority

The current product contract is owned by the source code, `package.json`, the app metadata in `www/src/state.js`, and the current policy/reference documents. Historical reports and changelog entries describe their release dates only. If documents disagree, follow the precedence in [AI & Contributor Context](./AI_CONTEXT.md) and correct the lower-authority document in the same change.

The project repository is [JX-Holdings-LLC/CardSpoke](https://github.com/JX-Holdings-LLC/CardSpoke).
