# Offline-First CardSpoke Guide

CardSpoke should feel the same online and offline except for features that explicitly require a remote service. The app is a local knowledge tool first; remote storage, sharing, and external integrations are add-ons.

## Product Rule

> Local card work must not depend on the network.

Users must be able to create, edit, read, search, import, export, and navigate local datasets without an internet connection.

## User Experience Contract

| Situation | Expected behavior |
| --- | --- |
| Device is offline | Core app continues working normally. |
| User edits a card offline | Change saves locally. |
| Dataset has remote sync configured | UI shows local save succeeded and remote sync is pending. |
| Remote sync fails | UI must not imply that the local save failed. |
| Remote copy changed elsewhere | CardSpoke should ask the user to resolve the conflict. |
| Remote-only feature is selected offline | Feature explains that it needs network access. |

## Local Save vs Remote Sync

Use separate mental models and UI language:

- **Local save:** The user's working copy on this device.
- **Remote sync:** A future-version concept. The public app has no cloud storage drivers or hosted sync; if off-device targets return, they are sync/export destinations, never live dependencies.

The local save is authoritative while the user is editing. Remote targets should be treated as sync/export destinations rather than live dependencies for normal card operations.

## Preferred Dataset Shape

Future storage metadata should prefer local storage plus optional sync targets:

```json
{
  "storageType": "indexeddb",
  "syncTargets": [
    {
      "kind": "googledrive",
      "status": "pending",
      "lastSyncedAt": null,
      "lastError": null
    }
  ]
}
```

Avoid modeling a normal editable dataset as if it lives only in a cloud driver. If a future version reintroduces off-device targets, CardSpoke must still maintain a local working copy.

## App Shell Caching

The browser build includes a service worker for local app-shell assets. It should cache only files needed to load the app UI:

- `index.html`
- `styles.css`
- `app-loader.js`
- `offline-status.js`
- `app.js`
- `CardSpoke.svg`
- `favicon.svg`
- `icon-192.png`
- `manifest.webmanifest`

Do not place user datasets, exports, plugin secrets, credentials, or cloud payloads in service-worker Cache Storage.

## Native Builds

Capacitor builds already package the web bundle into the native shell. Offline-first behavior still depends on the same rule: local storage and local files are available without network, while off-device storage waits until connectivity returns.

## Plugin Rules

Plugins should declare when they need network access. Offline-safe plugins should continue running without internet. Online plugins should fail gracefully with clear language, not break the app shell or local dataset.

Recommended permission names for future plugin manifests:

- `network`
- `remote-storage`
- `external-api`
- `ai-service`

## Testing Expectations

Offline-first changes should include at least static or automated checks for:

1. A web manifest is linked from `www/index.html`.
2. A service worker is registered from the app shell.
3. The service worker caches only app-shell assets.
4. Remote scripts are documented as optional online integrations.
5. Save status language distinguishes local saves from remote sync.

For browser QA, manually test:

1. Load the app once online.
2. Disable network.
3. Reload the app.
4. Create/edit/delete cards.
5. Reload again and confirm local persistence.
6. Re-enable network and confirm remote sync can resume if configured.
