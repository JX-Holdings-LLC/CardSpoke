# CardSpoke Desktop App

The desktop app is an [Electron](https://www.electronjs.org/) shell around the
same web bundle that ships in `www/`. It lives in [`desktop/`](../../desktop/)
as a self-contained npm package, so the web app's own `npm ci` stays light and
Electron is only downloaded when you work on the desktop build.

| Platform | Installer                         | Architectures |
| -------- | --------------------------------- | ------------- |
| Windows  | NSIS setup wizard (`.exe`)        | x64, arm64    |
| macOS    | Disk image (`.dmg`) and `.zip`    | x64, arm64    |
| Linux    | `AppImage` and Debian `.deb`      | x64           |

## Quick start

```bash
npm ci                    # web app dependencies (repo root)
npm run desktop:install   # desktop dependencies (downloads Electron)
npm run desktop:start     # build the web bundle and launch the app
```

`npm run desktop:start` rebuilds the web bundle first. To launch against the
current `www/` without rebuilding, run `npm run start:dev` inside `desktop/`.

## Building installers

```bash
npm run desktop:dist            # installers for the current OS
cd desktop
npm run dist:win                # Windows NSIS installer
npm run dist:mac                # macOS dmg + zip (must run on macOS)
npm run dist:linux              # AppImage + deb
npm run pack                    # unpacked app only, no installer (fast)
```

Output goes to `desktop/release/`. Every build first runs
`desktop/scripts/prepare-web.mjs`, which:

1. runs the root `npm run build`;
2. copies the production site from `dist/` into `desktop/web/`, skipping
   source maps and the dev-only `test.html`/`diagnostic.html`;
3. sets `desktop/package.json` (and its lockfile) to the root app version, so
   installers are always labelled with the CardSpoke release version.

Cross-building is limited by electron-builder. macOS installers need a macOS
host, and Windows installers are best built on Windows. The
[Desktop app workflow](../../.github/workflows/desktop.yml) builds all three
platforms on the matching runners.

### Windows installer behaviour

The NSIS wizard is an assisted installer, not one-click:

- it installs per user by default, and can elevate to install for all users;
- the install directory can be changed;
- it creates Start-menu and desktop shortcuts;
- it shows the Apache 2.0 license page.

Uninstalling keeps the user's data (`deleteAppDataOnUninstall: false`), so
reinstalling or upgrading never loses cards.

## Architecture and security

`desktop/main.js` loads the app from a privileged custom scheme,
`cardspoke://app/`, instead of `file://`.

- **Stable origin.** `localStorage` and IndexedDB live under a dedicated
  origin in the Electron profile directory. Data survives restarts and
  upgrades and is isolated from any browser.
- **Same behaviour as the web build.** The page CSP (`'self'`), the plugin
  Worker sandbox and secure-context APIs work as they do on the web.
- **Path containment.** `desktop/lib/url-policy.js` maps request URLs to
  files inside the bundled web directory only. It refuses path traversal,
  missing files and the dev-only pages.

The renderer is locked down:

- `contextIsolation`, `sandbox` and no `nodeIntegration`. The preload script
  exposes a frozen `window.cardspokeDesktop` object with
  `{ isDesktop, platform, versions, storage }`. `storage` is the only bridge
  to the main process: a few `cardspoke-storage:*` IPC calls that read,
  write and remove dataset files by **dataset key**. The main process
  accepts only the app's own key shapes (`nested_cards_*`, `cards_*`,
  letters, digits, `_` and `-`), never a path. It answers only pages from
  `cardspoke://app` (`desktop/lib/data-folder.js`).
- Navigation away from `cardspoke://app` is blocked. `http(s)` and `mailto`
  links open in the system browser or mail client; every other scheme is
  dropped.
- `window.open`, `<webview>` and all permission requests are denied, except
  sanitized clipboard writes used by "Copy as Markdown/JSON".
- DevTools are available only in unpackaged development runs, or when
  `CARDSPOKE_DEVTOOLS=1` is set.
- On Linux, Chromium's automatic Hunspell dictionary download from Google is
  disabled, so the app makes no network requests on its own. macOS and
  Windows use the OS spellchecker.

Other desktop behaviour:

- **Single instance.** Launching again focuses the existing window, so two
  windows never race on the same storage.
- **Window state.** Size, position and maximized state are restored from
  `window-state.json` in the profile directory. Off-screen positions are
  discarded.
- **Unsaved changes.** If a save is still pending when you close the window,
  a native "Keep Editing / Close Anyway" prompt appears. Without it, Electron
  would silently block the close.
- **Renderer crash.** A dialog offers Reload or Quit.

### Where data lives

**Datasets live in the data folder.** Each dataset is a plain JSON file named
after its dataset key, e.g. `nested_cards_store.json` or
`cards_research_ab12.json`. The default folder is `Documents/CardSpoke`
(`~/CardSpoke` if there is no Documents folder).

- **Choose the folder** in **Dataset Manager → Data Folder → Change Folder…**
  or **File → Change Data Folder…**. You can copy your datasets into the new
  folder, or use the folder as it is (for example, one synced from another
  computer). Nothing is deleted from the old folder.
- **Open the folder** with **Open Folder** or **File → Open Data Folder**.
- **File format.** Plaintext datasets are pretty-printed JSON in the same
  format the app stores. PIN-protected datasets stay encrypted envelopes.
- **Deleting a dataset** in the app moves its file to the folder's `.trash/`
  subfolder. Delete All Data does the same for every dataset file.
- **Changes from outside the app** are picked up while it runs. A file changed
  by the CLI, a text editor or a sync client is reloaded. If the open dataset
  has unsaved edits, the app asks whether to keep your version or load the
  file. If the open dataset's file is deleted, the app writes it again.
- **First launch** of this version copies existing datasets from the app's
  internal storage into the folder. If the folder already has a different
  dataset under the same key, the app's copy is kept beside it as
  `<key>_local_<id>.json`.
- **Folder unavailable** (an unplugged drive, for example): the app keeps
  working from its internal copy and warns you. Edits made in the meantime
  are written to the folder on the next launch where it is reachable, and
  they take priority over the older files.
- **`CARDSPOKE_DATA_DIR`** pins the folder (portable installs, testing). While
  it is set, the folder cannot be changed from the app.

The app still keeps a cache of every dataset in its `localStorage`, so the
storage limit for a single dataset (about 10 MB in Electron) is unchanged.

Plugin permission grants, appearance preferences and window state are not
part of a dataset. They stay in the Electron profile directory. A plugin that
arrives in a dataset file from another computer asks for consent again before
it runs.

The Electron profile directory holds the app's `localStorage` cache,
IndexedDB, `window-state.json`, and `storage.json`. `storage.json` records the
data folder and the dataset last open; the CLI reads it to find your data.

| OS      | Profile directory                         |
| ------- | ----------------------------------------- |
| Windows | `%APPDATA%\CardSpoke`                     |
| macOS   | `~/Library/Application Support/CardSpoke` |
| Linux   | `~/.config/CardSpoke`                     |

The web app's built-in backup/export features work unchanged. File downloads
open the native save dialog. To script or automate your datasets, use the
[CLI](./CLI.md), which edits the files in the data folder directly.

## Testing

```bash
cd desktop
npm test                                   # unit tests: URL/path policy, window state, data folder
xvfb-run -a npm run smoke                  # end-to-end smoke of the dev app (Linux CI)
npm run smoke                              # same, on a machine with a display
node scripts/smoke.mjs --packaged release/linux-unpacked/cardspoke   # packaged app
```

The smoke test uses the root devDependency Playwright to drive the real
Electron app with a throwaway profile. It checks:

- boot, renderer isolation and a secure context;
- that the bundle version matches the desktop version;
- the protocol traversal guard, and the popup and navigation blocking;
- creating a card through the UI;
- a sandboxed plugin Worker rendering through the vnode API;
- that cards and enabled plugins persist across a full app restart;
- that datasets are written as files in the data folder, that a CLI edit
  made while the app runs is reloaded, and that all cards come back from the
  folder after the app's internal storage is wiped.

The smoke test points the data folder at a temporary directory through
`storage.json`, so it never touches your real Documents folder.

## Code signing and releases

Builds are unsigned unless signing secrets are present. The workflow reads:

| Secret                                                   | Purpose                   |
| -------------------------------------------------------- | ------------------------- |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                   | Windows Authenticode cert |
| `CSC_LINK`, `CSC_KEY_PASSWORD`                           | macOS Developer ID cert   |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`  | macOS notarization        |

Without a macOS certificate, the app is ad-hoc signed so it still launches on
Apple silicon. Users confirm it once with right-click → **Open**. Unsigned
Windows installers show a SmartScreen prompt.

When the workflow runs for a pull request that touches `desktop/`, it builds
and smoke-tests Linux only. To publish installers, push a `v*` tag, or run the
workflow manually with **release** checked. It then builds all platforms and
uploads the installers and the `latest*.yml` update metadata to a **draft**
GitHub Release for review.

Auto-update is not wired in yet. The `latest*.yml` files that are already
published are what `electron-updater` would read if it is added later.

## Icons

`desktop/build/icon.svg` is the square app icon: the linked-cards glyph from
`CardSpoke.svg` on a rounded tile. `npm run icon` (in `desktop/`) renders it
to `build/icon.png` (1024 px, used for the `.ico`/`.icns`) and
`build/icons/<N>x<N>.png` (Linux sizes). It uses the pre-installed Chromium
through the root Playwright. The PNGs are committed, so only rerun it when the
logo changes.
