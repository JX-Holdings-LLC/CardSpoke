# Storage & Privacy Notes

CardSpoke is local-first. Users own their data, and the app does not silently sync or host information. Offline use is a first-class experience, not a fallback mode.

## Storage Model

- **LocalStorage:** Lightweight configuration, session data, and feature toggles. Also the default driver for structured card content, relationships, histories, and plugin registries — datasets are namespaced and tracked with metadata (name, card counts, recent/bookmark counts, schema/app version) so multiple vaults can coexist.
- **IndexedDB:** An optional, per-dataset storage driver users can select instead of LocalStorage for card content and relationships. Also used internally for Local File System handle persistence, unrelated to card storage.
- **Local File (File System Access API):** An optional, per-dataset driver that writes the dataset to a file the user picks on their own disk. The file handle is persisted in IndexedDB so the app can reopen it; the file itself is never uploaded anywhere.
- **Filesystem (via Capacitor Filesystem):** Optional for attachments or exports; only used when explicitly enabled.
- **Off-device storage:** Not part of the public app. Google Drive, OneDrive, WebDAV, and other cloud targets are deferred to a possible future version; the shipped app contains no cloud storage drivers and never sends card data off the device. If cloud storage returns in the future, it must never be required for normal card creation, editing, reading, navigation, import, export, or local dataset switching.

## Dataset Encryption at Rest

Datasets can be PIN-protected. When a PIN is set, the dataset is persisted as an
encrypted JSON envelope rather than plaintext:

- **Cipher:** AES-GCM, with a key derived from the PIN via PBKDF2 (250,000
  iterations) and a per-dataset random salt.
- **The PIN is never stored** in any form — not in metadata, not alongside the
  envelope. Unlocking re-derives the key from the PIN the user types, so a
  forgotten PIN means the dataset cannot be recovered.
- **Applies across backends:** switching a PIN-protected dataset to the
  IndexedDB or Local File driver re-encrypts on the way out, so plaintext is
  never written to the target backend.
- **Not covered:** user-initiated exports are written in plaintext (see Backup &
  Export Guidance below), and a PIN protects data at rest — it is not a
  guarantee against someone with access to the unlocked, running app.

Implementation: `www/src/core/dataset-crypto.js`.

## Default Behavior

- No automatic cloud sync or telemetry.
- No analytics or tracking beacons are built into the core.
- **The one outbound connection.** Opening the Gallery tab in the Plugin Manager
  fetches `https://raw.githubusercontent.com/jxburros/CardSpoke/main/sample-plugins/manifest.json`
  to list curated sample plugins, and installing from that gallery downloads the
  chosen package. Nothing is sent but the request itself — no card data, no
  identifiers — but like any web request it does reveal the user's IP address and
  approximate time of use to GitHub. Nothing fetches it unless the user opens
  that tab; the rest of the app never reaches the network. This is the only host
  permitted by the app's `connect-src` CSP directive.
- Plugins must not transmit data off-device without explicit, informed consent.
- Preferences stored under `cardspoke_*` keys (rich text, grid view, typography, high contrast, dev mode, active theme) stay on-device and are restored at startup.
- Local saves are authoritative while the user edits. Remote sync may fail, be unavailable, or be pending without invalidating the local save. (The current public app has no remote sync at all; this rule binds any future off-device integration.)

## Offline-First UX Rules

- The app shell should load offline after it has been installed or visited in a service-worker-capable browser.
- Offline status should only affect explicitly online features such as off-site storage, remote sync, remote plugin galleries, hosted sharing, or external API features.
- Save messaging must distinguish local save failure from remote sync failure. If a local save succeeds and remote sync fails, the user should see that their local copy is safe.
- Remote sync conflicts must be surfaced for review instead of silently overwriting local data.
- Plugins that require network access should declare that need and degrade gracefully when offline.

## User Controls

- Provide clear settings to opt into any off-device storage/integration.
- Offer data export/import paths (JSON or other agreed formats) to preserve portability. The UI exports datasets as JSON, CSV, Markdown, or TXT under `cardspoke-*` filenames (JSON as `cardspoke-<type>-<timestamp>.json`, e.g. `cardspoke-instance-1719936000000.json`; CSV/Markdown/TXT as `cardspoke-<YYYY-MM-DD>.<ext>`), and maintains timestamped backups for rollback.
- Surface active plugins and their data-touching permissions.

## Security Considerations

- Validate file types and sizes before writing to disk.
- Avoid storing secrets in LocalStorage; prefer secure platform stores where available (Capacitor Preferences for non-sensitive app prefs, and OS-level secure stores/Keychain/Keystore for credentials when added).
- Document any encryption used for local caches or exports (see Dataset Encryption at Rest above).
- Do not cache user datasets in service-worker Cache Storage. Cache Storage should only hold app-shell assets such as HTML, CSS, JS, icons, and the manifest.

## Incident Response

- If a plugin or Deviation corrupts data, guide users to restore from backups or exports.
- Provide steps for clearing caches (LocalStorage/IndexedDB) without losing user backups.

## Backup & Export Guidance

- Recommended backup cadence: before major edits/imports/plugin installs, and at regular intervals for active datasets.
- Supported backup/export formats in current app flows: JSON, CSV, Markdown, TXT.
- Encryption-at-export is not built in yet. Note that this is separate from dataset encryption at rest: exporting a PIN-protected dataset writes plaintext. Users handling sensitive data should encrypt exported files using trusted external tools before sharing or cloud sync.

## Plugin trust and secondary storage

The core app network behavior described above excludes user-installed plugin code. JavaScript packages require explicit plugin-code trust consent, can read unlocked cards, and may load modules outside the host network API. See the Security and Safety policy. LocalStorage remains primary even when an IndexedDB mirror is selected; a valid primary copy is not replaced by an older mirror during startup. Selected secondary writes must complete before Saved is displayed.
