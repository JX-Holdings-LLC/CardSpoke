# Changelog

All notable changes to CardSpoke are documented in this file.

The format follows Keep a Changelog and the project uses semantic versioning where practical.

---

## [Unreleased]

### Added

- **Desktop app.** A locked-down Electron shell in `desktop/` with installers
  for Windows (NSIS, x64/arm64), macOS (dmg/zip, x64/arm64) and Linux
  (AppImage/deb). The app is served from a dedicated `cardspoke://app` origin,
  has a sandboxed renderer with no Node.js access, blocks navigation, pop-ups
  and permission requests, opens external links in the system browser,
  remembers window state and runs as a single instance. It makes no network
  requests on its own. Includes a Playwright-driven smoke test, a
  `Desktop app` CI workflow that publishes installers to a draft GitHub
  Release on `v*` tags, and a [Desktop guide](docs/guides/DESKTOP.md).

### Security

- Plugin permission grants are bound to a fingerprint of the plugin's code
  and requested permissions, so a same-id plugin with different code (for
  example from an imported dataset) needs fresh consent. Grants saved by
  earlier versions are confirmed once.
- `card.render` hooks now require `ui-override`. Card write middleware and
  the write helpers in `ctx.utils` now require `data-modify`, and theme
  setters require `ui-override`.
- Plugins are always imported suspended (`enabled: false`), including when
  restored from a local file with a changed definition.
- Removed the unsandboxed function-plugin path from `install()`/`register()`
  (#370). Trusted host code uses `registerHostPlugin()`.
- Plugin ids containing unsafe characters are rejected.
- The service worker only refreshes the cached app shell from app-root
  navigations. `diagnostic.html`/`test.html` carry a CSP, no longer use
  `innerHTML`, and are no longer copied into `dist/`.

### Fixed

- Renaming a card rewrites `[[Old Title]]` links in other cards, as one undo
  step (#375).
- Exporting a PIN-protected dataset offers an encrypted JSON backup or asks
  for explicit confirmation before writing plaintext. Encrypted backups can be
  re-imported with the PIN (#372).
- Creating a dataset no longer carries the previous dataset's undo, redo or
  trash into it.
- JSON import is a single undoable step. Undoing an edit restores content
  fields only.
- Tags are normalized, and Tag Manager handles mixed-case tags.
- Restoring a trashed child whose parent is still in the trash moves it to
  the root instead of hiding it. Permanently deleted cards can no longer be
  resurrected with Undo.
- `updateCard` ignores structural fields. Moving a card through the edit
  form is undoable, and plugin `card.update`/`card.create` hooks now fire for
  edits made in the UI.
- Clear All Data and dataset deletion also remove the IndexedDB copies.
- A stale local file no longer overwrites newer local data on boot.
- Upload modal: scroll is unlocked after a successful import, drop zones are
  keyboard accessible and drag-and-drop actually works, focus is trapped and
  restored, and tab ARIA state stays in sync.
- Theme toggle labels describe the action and the icons are hidden from
  screen readers (#371). Alt/Option+T works on macOS. The menu button exposes
  `aria-expanded` and gets focus back when the menu closes.
- A missing or crashing `app.js` shows a readable boot-error message instead
  of a doomed ESM fallback.
- Documentation and type package versions now match the release (#362), and
  the README's preview/QA instructions are fixed.

---

## [0.21.1] - 2026-09-17

### Fixed

- Escape every CSV field, preserve multiline bodies, and neutralize spreadsheet formula-like text. Open newly navigated cards at the top on mobile.
- Preserve loaded, imported, reparented and undo-restored cards when using kernel-backed operations. Deep-clone metadata and guard cyclic delete/duplicate and missing parents.
- Serialize encrypted saves, await selected secondary storage, reject failed switch flushes, cancel obsolete writes, and wait for IndexedDB transaction commit. Do not overwrite primary data with a stale mirror.
- Restrict plugin RPC dispatch, vnode elements/attributes/URLs, and component unregistration; replace UI listeners on update and catch async event-handler errors.
- Terminate failed worker initialization and timed calls; disable common ambient worker capabilities on prototypes as well as the global.
- Require an explicit plugin-code trust grant and document worker isolation limits. Existing JS packages prompt once; CSS-only themes are unchanged.
- Refresh five vulnerable transitive dependencies, align browser QA with worker plugins, expand regression coverage, restrict offline caching to shell assets, and document supported Node versions.

### Compatibility

- Schema remains 4. JS plugin packages retain their format and now require a new trust grant. Active HTML elements and unsafe vnode attributes are rejected.

---

## [0.21.0] – 2026-07-28

**CS-002 resolved: plugin JavaScript now runs in a real sandbox, not a
consent dialog.** Every JS-bearing plugin executes inside its own dedicated
Web Worker with no `window`, `document`, `localStorage`, or raw `fetch`/
`XMLHttpRequest`/`WebSocket`/`indexedDB`/`caches` — the only way out is a
permission-gated `ctx.api` RPC into the host, and a denied permission is now
genuinely unreachable, not just discouraged. This is a breaking change to the
plugin contract (not to persisted data — `store.plugins`'s schema is
unchanged): every `ctx.api` method is now asynchronous, UI is built with a
new `ctx.h(...)` vnode helper instead of `document.createElement`, and the
`card.render` hook was redesigned as a patch-returning decorator instead of
handing plugins a live DOM node. There is no compatibility shim or toggle —
every plugin that ships JavaScript needs the mechanical rewrite the six
updated `sample-plugins/` packages demonstrate.

### Security

- **Plugin JavaScript is sandboxed (CS-002).** Replaces the "full-trust
  consent" dialog (which honestly told users a plugin could reach anything,
  because it could) with real Worker isolation. Permissions
  (`ui-override`, `data-modify`, `storage`, `network`, `filesystem`) are now
  an enforced capability grant, not a description of intent.
- **A hung or malicious plugin can be killed outright.** A `setup()` that
  never resolves — or spins in a genuine infinite loop — is time-boxed and
  its worker is forcibly terminated. Previously, an infinite loop on the
  main thread had no recovery path short of force-closing the app.
- **Cross-plugin storage isolation is now real.** A plugin can no longer
  read or collide with another plugin's `plugin_<id>_` namespaced storage
  keys even by accident — `localStorage`/`indexedDB` aren't reachable from
  inside the sandbox at all, only the namespaced `ctx.api.storage`.

### Changed — breaking plugin API changes

- Every `ctx.api.data.*`, `ctx.api.ui.*`, `ctx.api.middleware.register`, and
  `ctx.api.events.*` method is now asynchronous — `await` it.
- `ctx.api.ui.inject`/`replace` take a vnode (`ctx.h(tag, props, children)`)
  instead of a real `HTMLElement`, since a sandboxed worker has no DOM to
  build one with. They return `{ remove(), update(vnode) }` instead of a
  bare undo function.
- `ctx.api.ui.registerComponent`'s `render(props)` returns a vnode (may be
  `async`) instead of synchronously returning an `HTMLElement`.
- The `card.render` hook is no longer a `(mwCtx, next)` middleware fired
  with a live `[card, cardTileElement]` — it's a batched decorator,
  `(card, tileSnapshot) => patch`, with no live DOM access and no
  `next()`/`stopPropagation()` (every registered decorator is independent
  and additive). `card.create`/`update`/`delete`/`save` keep full
  onion-model semantics.
- `ctx.api.network.xhr()` is removed — `XMLHttpRequest`'s stateful,
  event-driven shape doesn't cross a Worker boundary safely. Use
  `ctx.api.network.fetch(url, options)`, which now returns a serializable
  Response-shaped object instead of a real `Response`.
- The full-trust consent dialog and its API (`Permissions.requestFullTrust`/
  `hasFullTrust`/`grantFullTrust`/`revokeFullTrust`, the
  `cardspoke_plugin_trust` localStorage key) are removed outright, with no
  replacement — the per-permission consent dialogs are now the whole story.
- All six JS-bearing sample plugins (`daily-journal`, `kanban-board`,
  `pomodoro-desk`, `auto-save-indicator`, `card-color-tags`,
  `card-reading-time`) and `TEMPLATE.json` are rewritten against the new API
  — use them as the migration reference for any existing plugin.

### Added

- `www/src/core/plugin-worker-bootstrap.js`, `plugin-worker-manager.js`,
  `plugin-rpc.js`, and `plugin-vnode.js` — the sandbox itself: the worker
  entry point, per-plugin Worker lifecycle, the request/response +
  function-handle RPC protocol shared by both sides, and the `ctx.h`/vnode
  building blocks.
- `scripts/build-plugin-worker.mjs` — bundles the worker entry point into a
  standalone `www/plugin-worker-bootstrap.js`, run before `vite build`/`vite`
  (Rollup's single-entry `iife` output can't also emit this as a second
  chunk in the same build).
- `tests/helpers/fake-worker-global.js` / `worker-thread-adapter.mjs` — a
  test-only `Worker` global backed by a real Node `worker_threads` thread
  running the actual production worker-bootstrap source, so plugin tests
  exercise genuine thread isolation rather than a same-process mock.

### Documentation (changed)

- Documented dataset encryption at rest (AES-GCM with a PBKDF2-derived key from the optional dataset PIN) in the storage/privacy and security policies, where the shipped feature had gone unmentioned.
- Documented the Plugin Manager gallery request to `raw.githubusercontent.com` as the app's only outbound connection, including what it does and does not reveal.
- Rewrote the architecture overview to match the implementation: no plugin sandbox or isolated contexts, the real storage-driver set with LocalStorage as the default, real bundle sizes, and honest priority tie-breaking rules.
- Pointed security disclosures at private GitHub vulnerability reporting instead of public issues.
- Added the `npm run smoke` and `npm run qa:browser` deployment gates to the test guide, developer guide, release checklist, and QA profile, which previously named only a subset of the checks CI enforces.
- Annotated the 2026-07-10 audit report with the five findings resolved in v0.18.2 and the two still open.

### Documentation (fixed)

- Corrected the component registry documentation: the host queries only `Card`, `Header`, `Sidebar`, and `SearchBar`, and three of the four documented prop shapes were wrong. Examples and the TypeScript snippet now match `www/src/rendering.js`.
- Corrected `PluginUtils` in `types/index.d.ts`, which declared six helpers that are not reachable from `ctx.utils` while omitting the twenty async helpers that are. Added the Header/Sidebar/SearchBar prop types and fixed registry return types.
- Aligned `types/package.json` version and license with the root package (0.20.0, Apache-2.0).
- Fixed plugin documentation paths in the agent skill files, which pointed at `docs/PLUGIN_SYSTEM.md` and `docs/PLUGIN_INVARIANTS.md` instead of their real `docs/architecture/` locations.
- Corrected stale counts, dates, and claims: test suite baseline (33 files, 403 tests), Code of Conduct date, Capacitor CLI dependency location, export filename patterns, the nonexistent plugin dev-tools surface, and a "legacy concatenation build" that no longer exists.
- Added the missing `analysis/` entry to the documentation index.
- Removed the nonexistent Node package entry point from this browser-only package.
- Moved dependency-audit summary generation into a checked-in Node script so the GitHub Pages workflow passes shell validation without changing the release gate.
- Corrected the remaining markdownlint findings in the QA profile, plugin review skill, and historical audit report.

---

## [0.20.0] – 2026-07-20

### Changed

- Reorganized documentation around a role-based documentation home, dedicated architecture and historical-report sections, and an AI/contributor context guide that records document precedence and current public scope.
- Updated public app and package metadata to identify CardSpoke as created by Jeffrey Guntly and maintained by JX Holdings, LLC.
- Updated the in-app footer with links to the [CardSpoke repository](https://github.com/jxburros/CardSpoke), [Jeffrey Guntly's GitHub profile](https://github.com/jxburros), and [JX Holdings, LLC](https://jxholdings.com).
- Advanced all release metadata and public documentation references to version 0.20.0. Schema version remains 4; this release does not change persisted data or the plugin API contract.

---

## [0.19.0] – 2026-07-16

Security, data-integrity, and plugin-runtime hardening from the 2026-07-16
pre-release audit. This release fixes a card-content exfiltration channel,
several data-loss paths, and an app-freeze bug, and closes gaps in the plugin
lifecycle.

### Security

- **Card content could be exfiltrated by a CSS-only "theme" plugin.** Card
  titles (and tags) were reflected into DOM `value="…"` attributes, which a
  plugin's CSS attribute selectors could read character-by-character and beacon
  out via `background: url(https://…)`. Two fixes: the DOM helper now sets form
  values as a live property, never as a CSS-selectable attribute; and the CSP
  `img-src` no longer allows arbitrary `https:` images (same-origin plus
  `data:`/`blob:` only), which removes the network leg of the leak. Both are
  guarded by new smoke/browser-QA regressions.

### Fixed — data integrity

- **Migrating a PIN-protected dataset wrote it in plaintext.** Storage-settings
  migration to IndexedDB or a local file serialized the store without
  encryption before the deferred encrypted save; the plaintext copy could be
  what durably remained. Migration now encrypts with the active session PIN
  exactly like the normal save path.
- **Switching datasets mid-save could destroy an encrypted dataset.** A queued
  debounced save read the *current* dataset key at fire time, so a timer
  scheduled for dataset A could fire after a switch and write A's (unencrypted)
  data into dataset B's key. Every switch now flushes the pending save to its
  own key first (and cancels it when the active dataset is being deleted).
- **Editing a card's parent to one of its own descendants froze the app.** The
  resulting parent cycle spun breadcrumb rendering forever. The parent picker
  now excludes the card's descendants, breadcrumb/ancestor/descendant walks are
  cycle-guarded, and imports repair cyclic/dangling parents before persisting.
- Undo/redo history and the trash bin are now cleared on dataset load, so one
  dataset's undo entries can no longer be replayed against — or inject a foreign
  card into — another dataset.
- Restoring a trashed card whose parent no longer exists now keeps it reachable
  at the root instead of leaving it an invisible orphan.
- `QuotaExceededError` detection now recognizes the differently-named variants
  used by some engines, so a full-storage save is reported rather than swallowed.

### Fixed — plugin runtime

- **Boot no longer deadlocks on a hung plugin.** A plugin whose `setup()` never
  resolved blocked the sequential boot sync and left a blank page; boot re-enable
  is now time-boxed, and a plugin that fails or hangs on boot is suspended so it
  cannot re-break every subsequent load.
- **Suspending a plugin can no longer remove another plugin's component
  override.** The component registry now tracks ownership: a plugin only tracks
  a slot it actually won, and cleanup only unregisters a slot it still owns.
- **A failed enable no longer leaves the app's brand permanently renamed.** The
  `appName` override is applied only after the permission check, and is restored
  on any setup failure (previously, declining a shipped sample's permission left
  the logo replaced with no way back).
- Deleting a plugin now sweeps its namespaced `ctx.storage` keys, honoring the
  documented "everything created through `ctx.api.*` is removed on delete"
  invariant (a reinstall can no longer inherit stale values).
- One plugin's throwing middleware no longer starves other plugins' hooks or
  silently prevents the core operation — each middleware runs fault-isolated.

### Fixed — editing & search

- Duplicating a card, and adding/removing tags, are now undoable; deleting a
  card with children is grouped so a single Undo restores the whole subtree.
- Advanced Search with filters but no query text now matches all cards before
  applying the tag/bookmark/date filters, instead of searching for a literal
  `*`.
- Search-results keyboard navigation is clamped to the results actually
  rendered, so arrowing past the last rendered result no longer loses the
  highlight.

### Changed

- Native `sync` scripts now build first, so `npx cap sync` can no longer package
  a stale committed bundle into the mobile shells.
- The dev-only `test.html`/`diagnostic.html` harnesses are trimmed from the
  GitHub Pages deploy (they remain in the repo for local use).
- `www/capabilities.json` advertises the current version and is covered by the
  version-consistency smoke check.

---

## [0.18.2] – 2026-07-10

Release-hardening fixes from the 2026-07-10 audit / QA / stress-test report.

### Fixed

- **Stale offline updates (CS-101):** the service-worker cache namespace was
  still `v0.18.0`, so returning users controlled by the old worker kept
  receiving the previous release's cache-first `app.js` indefinitely — 0.18.1
  shipped critical data-safety fixes those users never got. The cache version
  is now rewritten from `package.json` on every build (it cannot drift), shell
  assets are served stale-while-revalidate so a stale cache self-heals on the
  next online load, and both the static smoke gate and a new behavioral test
  suite (`tests/service-worker.test.js`) verify install pre-caching, the
  N → N+1 activate cleanup, revalidation, and the offline navigation fallback.
- **Dataset PIN field accessibility (CS-105):** the dataset-creation labels
  (name, storage type, PIN) are now programmatically associated with their
  controls via `for=`, and the PIN inputs reference the help text through
  `aria-describedby`.
- **PIN normalization and typo protection (CS-106):** the PIN is no longer
  silently trimmed at creation (unlock always used the exact typed value, so a
  PIN created with surrounding spaces could never unlock). PINs that start or
  end with a space, or consist only of spaces, are rejected with a clear
  message, a confirmation field with mismatch validation prevents a one-typo
  unrecoverable dataset, and the help text states the exactly-as-typed rule
  and the limits of short PINs.

### Changed

- **Browser QA is now a required deployment gate (CS-102):** `playwright` is a
  pinned devDependency, so `npm ci && npx playwright install chromium && npm
  run qa:browser` works from a clean checkout, and the GitHub Pages workflow
  runs the full browser suite (encrypted unlock, locked-write protection,
  corrupt-store quarantine, backup round trip, plugin consent, dataset
  switching, XSS, dialogs, mobile overflow) after the build — a red browser QA
  job now blocks deployment. Results and screenshots are uploaded as workflow
  artifacts on both pass and failure.
- **Dependency-audit visibility (CS-107):** the deploy workflow keeps blocking
  on high/critical advisories, but now also stores the full `npm audit --json`
  report as a workflow artifact and summarizes all severity counts in the run
  summary so accepted moderate advisories stay visible.
- Browser QA gained coverage for the new dataset-form label wiring and PIN
  confirmation flow.

---

## [0.18.1] – 2026-07-10

Release-blocking fixes from the 2026-07-09 comprehensive audit, plus additional
defects found during a full review and browser-level QA pass.

### Fixed

- **Data loss on encrypted datasets (CS-001):** a PIN-protected dataset was
  parsed as an empty store on reload and then overwritten, destroying the
  encrypted data with no way to recover. Encrypted datasets are now detected
  before any parse, prompt for their PIN, and are never written over while
  locked. The PIN is no longer persisted anywhere — it lives only in the
  session and is re-entered after a reload. A lock screen offers unlock,
  encrypted-backup download, or dataset switch.
- **Every save reported as failed (CS-003):** `saveNow()` called a removed
  `scheduleCloudSync()` function, so each successful local write surfaced a
  "Local save failed" error. The obsolete call is gone; saves report success.
- **Corrupt storage overwritten (CS-004):** unreadable stored data was
  immediately replaced with an empty store. It is now quarantined under a
  timestamped recovery key, the active key is left untouched, and a recovery
  screen offers download / retry / start-fresh — nothing is overwritten
  without explicit confirmation.
- **Broken backup/restore (CS-005):** instance export now includes every
  user-owned field (bookmarks, recent cards, view mode, theme, dataset
  metadata, schema version) and restores plugins in the executable
  `{definition, enabled}` shape, so an export → import round-trip actually
  restores plugins and settings.
- **All confirm/prompt dialogs threw at runtime (NEW-1):** the shared dialog
  primitives had been nested inside a `showToast` closure, so every
  delete/clear/import confirmation raised a `ReferenceError`. They are now
  module-level.
- **Created datasets were invisible / unusable (NEW-2, NEW-4):** the Dataset
  Manager only listed one key shape, and the "Open" button referenced an
  out-of-scope variable and threw. Dataset enumeration is unified, switching
  awaits the load and reconciles plugins, and the selector refreshes.
- **"All datasets" search only searched the current one (NEW-3):**
  multi-dataset search now enumerates on-device datasets, skips locked
  encrypted ones, labels results by dataset, and switches datasets when you
  open a result from another dataset.
- **Escape under a dialog also navigated the app (NEW-5):** pressing Escape in
  a confirm/prompt dialog both closed it and triggered the global "go back"
  handler. The global handler now yields to open dialogs.
- **`npm run preview` served a 404 (CS-006):** the build now emits a complete
  site into `dist/`, so preview (and any static host of `dist/`) serves the app.

### Changed

- **Plugin trust model (CS-002):** JavaScript plugins run unsandboxed in the
  page realm, so declared permissions are not a security boundary. Any plugin
  that ships JavaScript now requires explicit full-trust consent before it is
  enabled (at install, re-import, and first enable); only CSS-only themes
  auto-enable. Documentation and Plugin Manager language were corrected to
  describe this honestly.
- **Modal accessibility (CS-008):** a shared observer applies the dialog
  contract (`role="dialog"`, `aria-modal`, labelled title, focus trap,
  Escape, focus restoration) to all dynamically created overlays, and the
  plugin permission dialog was rebuilt to the same contract.
- **CI now gates deployment on QA (CS-009):** the Pages workflow runs the unit
  suite, `npm audit`, the production build, and static smoke checks before the
  deploy artifact is produced.
- **Native platform setup documented (CS-007):** `npm run platform:android` /
  `platform:ios` scripts and docs explain that `android/`/`ios/` are generated,
  not committed.
- Dataset encryption was extracted to `www/src/core/dataset-crypto.js` with
  real behavior tests, and the fragile post-build function-body restoration now
  fails loudly instead of silently shipping a stale body (CS-011, first step).
- Documentation/version drift corrected (CS-010): removed stale test counts and
  the IndexedDB-as-primary wording; storage default is LocalStorage.

### Testing

- Added `tests/audit-regressions.test.js` (envelope encryption, load-path
  invariants, backup shape, full-trust consent).
- Added `scripts/static-smoke.mjs` (`npm run smoke`) and
  `scripts/browser-qa.mjs` (`npm run qa:browser`, 11 headless-Chromium
  scenarios covering the flows above).

---

## [0.18.0] – 2026-07-09

First public release of the main CardSpoke web app.

### Public Scope

- Main CardSpoke web app.
- Local-first card knowledge workflow.
- Desktop packaging as the next packaging target.
- Mobile packaging after desktop, with mobile security hardening tracked separately.

### Added

- Public app scope document: `docs/specifications/FIRST_PUBLIC_SCOPE.md`.
- Clear first-public-version positioning for the main CardSpoke web app.
- Regression tests for new-card tag persistence, search keyboard navigation, form labels, dialog semantics, focus-trap cleanup, tab contrast tokens, CSP hardening, and balanced HTML.

### Fixed

- Tags entered while creating a new card are now persisted on the first save (previously they were silently dropped; QA FUNC-1).
- Search-results keyboard navigation now works as the on-screen hint promises: the search bar stays visible on the results page and Arrow/Enter are handled even after focus leaves the input (QA UX-1).
- Card edit form controls (`Title`, `Parent Card`, child title inputs) now have programmatic labels for screen readers (QA A11Y-2).
- The menu overlay and Plugin Manager are exposed as modal dialogs (`role="dialog"`, `aria-modal`, labelled titles) and all glyph-only close buttons have accessible names (QA A11Y-3).
- Closing the menu with Escape (or any other path) now always releases the focus-trap listener, so repeated open/close cycles no longer accumulate keydown handlers (QA A11Y-4).
- Header, search, and density controls meet the 44px touch-target goal on mobile widths (QA A11Y-1).
- Active Plugin Manager tab text uses a theme-aware accent token with WCAG AA (≥ 4.5:1) contrast in light and dark themes (QA A11Y-5).
- Removed a stray closing `</div>` from `index.html` (QA HTML-1).

### Security

- Content Security Policy hardened (QA SEC-1/SEC-2): `connect-src` no longer contains a wildcard and is limited to same-origin plus the curated plugin gallery (`raw.githubusercontent.com`); Google/Microsoft script, connect, and frame sources are gone; `frame-src` is now `'none'`. `'unsafe-eval'` remains only for the plugin runtime and is documented in `docs/policies/SECURITY_AND_SAFETY.md`.
- Third-party auth libraries (Google Identity Services, MSAL) no longer load at startup — the app makes no third-party contact by default (QA PRIV/PERF-1).
- Resolved all `npm audit` advisories in the build toolchain (Vite, esbuild, tar, brace-expansion) — 0 known vulnerabilities (QA DEP-1).

### Changed

- Refocused README, feature catalog, developer guide, test guide, and storage docs around the main CardSpoke app.
- Package description now describes CardSpoke as a local-first card-based knowledge app.
- Removed `build:core` from public package scripts.
- Public product priority is now web app first, desktop packaging second, mobile packaging third.
- Cloud/off-device storage is deferred to a future version instead of presented as a current public feature.
- The save-status indicator reports plain local-save state; there is no remote sync state in the public app.
- Schema/docs updated: `www/src/core/migrations.js` now provides baseline structural repair (`migrateCard`/`migrateStore`) only.

### Removed

- Cloud storage drivers (Google Drive, OneDrive, WebDAV) and the cloud sync scheduler — out of scope for the public app. Legacy dataset metadata referencing cloud drivers falls back safely to LocalStorage. No schema change: `schemaVersion` remains 4.
- Committed OAuth client IDs for Google/Microsoft integrations.
- Typed-card platform layer, conversions, action registry, runtime profiles, kind-filterable export, and the core-only entry point (`www/src/core/index.js`) — all "OS preparation" code outside the public scope.
- Stale core-only build artifacts (`dist/cardspoke-core.*`) and the unused legacy ES module mirror (`www/modules/`).
- OS-light roadmap and OS preparation directive from the public app repo.
- Runtime profile, app-mode, typed-card, conversion, action-registry, and core/shell split architecture docs from current public scope.
- App-mode boot wiring from the main app entry point.
- Core-only build config.
- Tests for extracted/deferred platform systems: app modes, runtime profiles, typed cards, typed queries, typed migrations, conversions, action registry, and core-only entry behavior.

### Explicitly Deferred

- OS-specific shells.
- Spin-off apps or app suites built on CardSpoke.
- Typed-card domain systems.
- Runtime profiles.
- Core-only builds.
- Google Drive, OneDrive, WebDAV, and other cloud storage drivers.
- Hosted sync or real-time collaboration.

---

## [0.17.0] – 2026-02-17

### Added

- Backlinks panel: the Read view shows all cards that link to the current card via `[[Title]]` references.
- Related-cards panel: the Read view shows cards sharing tags with the current card, ranked by match score.
- `CHANGELOG.md` created.

### Fixed

- Vite build no longer emits an `outDir`-overlaps-`root` warning.
- `npm run build` produces an unminified, readable IIFE bundle.
- Removed duplicate `build:vite` script from `package.json`.

### Changed

- README build-step description updated to reflect the Vite bundler.
- README quick example updated to use the correct public API.
- README duplicate support section removed.

---

## [0.16.x and earlier]

Earlier releases predated this changelog file. See the Git log for historical changes.
