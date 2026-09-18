# CardSpoke Capacitor Guide

This guide covers platform prerequisites and workflows for building and running CardSpoke with Capacitor. The web assets are already in `www/`, so the focus is on syncing and opening native shells.

## Prerequisites

- Node 20.19+ or 22.12+
- Capacitor CLI (`npx cap`, via the `@capacitor/cli` project dependency)
- Android: Android Studio, Android SDK + platform tools, Java 17+
- iOS: Xcode, CocoaPods, iOS device/simulator provisioning
- Optional: platform-specific signing assets for release builds (Android keystore + iOS signing certificate/profile).

## Typical Workflows

### 0) One-time setup: add the native platforms

The native projects (`android/`, `ios/`) are **generated, not committed**. On a
fresh checkout every sync/open command fails with
"*android platform has not been added yet*" until you create them:

```bash
npm run platform:android   # npx cap add android — generates android/
npm run platform:ios       # npx cap add ios — generates ios/ (macOS only)
```

Run this once per checkout (and again after deleting the generated folders).
The generated projects are local build artifacts; keep signing assets out of
the repository.

### 1) Sync web assets to native platforms

```bash
npm run sync          # Sync all configured platforms
npm run sync:android  # Sync Android only
npm run sync:ios      # Sync iOS only
```

### 2) Open platform workspaces

```bash
npm run open:android  # Launch Android Studio with the generated project
npm run open:ios      # Launch Xcode with the generated project
```

### 3) Build web assets (when changed)

Web files in `www/` are already bundled. If you modify them, run:

```bash
npm run build
npm run sync
```

When debugging platform-specific issues, you can temporarily point `server.url` in `capacitor.config.json` to a dev server and set `server.cleartext` to `true` for HTTP during local iteration. Reset these overrides before shipping so the bundle remains self-contained.

## Platform Notes

- **Android:** Ensure `ANDROID_HOME` is set and emulator/device is available. Use Android Studio’s Run/Debug to deploy. For release builds, configure a signing config in Android Studio (`Build > Generate Signed Bundle / APK`) and keep keystore files outside the repo. Confirm that `android/app/src/main/assets/public/` mirrors the current `www/` contents after `npx cap sync android`.
- **iOS:** Run `pod install` inside `ios/App` after syncing if pods change. Use Xcode’s scheme selector to choose device/simulator and run. Configure signing & provisioning profiles in Xcode (`Signing & Capabilities`) for distribution builds. Verify `ios/App/App/public/` contains the latest bundle after sync and that entitlements cover Filesystem usage if you enable exports.

## Plugins Used

- `@capacitor/android`, `@capacitor/ios` – native shells
- `@capacitor/app` – app lifecycle helpers
- `@capacitor/preferences` – key/value storage
- `@capacitor/filesystem` – file persistence

Document any additional plugins you add in this file, including platform-specific caveats, configuration steps, and testing expectations. When introducing new plugins, note whether the web bundle already guards their usage (e.g., capability checks before calling Filesystem) or if platform shims need to be added.

## Troubleshooting

- **Sync failures:** Delete `android/` or `ios/` builds and re-run `npm run sync`. Clear Gradle/DerivedData if platform caches corrupt.
- **Plugin issues:** Confirm plugin versions match Capacitor major version. Re-run `npx cap doctor` and align versions in `package.json` before re-syncing.
- **Platform-specific errors:** Capture logs from `adb logcat` (Android) or Xcode console (iOS) when filing issues.
