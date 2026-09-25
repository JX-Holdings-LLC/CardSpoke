# Advanced plugin verification — 2026-09-24

Baseline: CardSpoke 0.21.1, schema 4, commit `471f366`. Changes are unreleased
and do not alter the persisted core schema or public method signatures.

Environment: Windows, Node 24.14.1, Playwright 1.61.1, Chromium 149.0.7827.55.
Tests use disposable browser contexts and local datasets. No user data was
used, and no hosted sync/network service is required by the plugins.

## Results

| Command | Result |
| --- | --- |
| `npm ci` | Installed successfully; dependency audit reported zero vulnerabilities. |
| `npm run plugins:build` | Nine independently installable JSON files generated. |
| `npm run plugins:check` | Generated files match readable sources. |
| `npm test` | **507/507 passed**, including 12 advanced-package checks. |
| `npm run build` | Production bundle and worker build succeeded. |
| `npm run smoke` | All static release checks passed. |
| `npm run qa:browser` | **127/127 checks passed**, including core local-file persistence. |
| `npm run qa:plugins` | **21/21 scenarios passed** in real browser workers. |

The baseline test run was 493/495: two existing CSP hash checks failed on
Windows CRLF checkouts. The tests now normalize line endings the same way
HTML parsing does before hashing script text. No CSP directives or hashes
were weakened or removed.

## What the plugin scenarios establish

The first nine scenarios install each shipped JSON package. Each checks
layer-specific activation (apps remain suspended until explicitly enabled),
real permission consent, runtime activation, persistent reload, single-instance
UI/style restoration, suspend/reload/re-enable, Safe Mode, removal, and grant
revocation. UI handle counts stay stable across panel open/close. Themes are
checked for light/dark differences and 360px layout. All six JavaScript panel
launchers are activated with the keyboard and panel focus outlines checked.
Screenshots cover desktop, mobile, and dark themes.

Six functional scenarios exercise the following outcomes:

| Plugin | Verified behavior |
| --- | --- |
| Knowledge Audit | Duplicate titles, missing/ambiguous links, first-render badges, and changed cross-card findings on a later rendering pass. |
| Smart Collections | Combined text/tag filtering, saving, and restoring the definition after reload. |
| Batch Workbench | Two-card preview, concurrent edit detection, partial application, tag preservation, and conflict-aware undo. |
| Project Planner | Create project and child tasks, reject completion while a dependency is unfinished, advance lanes, restore completion after reload. |
| Study Studio | Answer remains hidden until Reveal, grading disabled until reveal, Good scheduling and review count survive reload, schedule reset. |
| Research Desk | Source and excerpt creation, literal HTML-like text stays inert, synthesis contains notes, repeated synthesis updates one card. |

The remaining six scenarios verify:

1. All six JavaScript plugins enabled/open together, with no horizontal overflow
   at 360px and no panels left after removal.
2. The literal theme package copied from the standalone guide installs.
3. The literal feature package from the guide handles a real counter click.
4. The literal app package from the guide creates a consistent parent/child tree.
5. A generated JSON file installs through the Plugin Manager's actual file-upload
   controls and consent dialog.
6. A 120-card dataset decorates its initial 60-card batch, and a child card's
   decoration appears in the parent's detail view.

Unexpected browser/worker errors fail each scenario. Artifacts are written to
`qa-artifacts/advanced-plugins/results.json` and screenshots beside it; general
browser checks write `qa-artifacts/browser-qa-results.json`. These generated
artifacts are ignored by Git. The repeatable commands and assertions are checked in.

The package suite validates/compiles all nine JSON files, checks their source
parity, and measures primary/secondary/muted/ghost/accent text against background
and surface colors in both palettes at a minimum 4.5:1 ratio. This palette check
is not a claim that every host control/state has undergone a full WCAG audit.

## Runtime defects found and fixed

**First render skipped decorators.** The host called its upgrade pass while
the newly built grid/detail subtree was still detached. The connected-element
filter dropped those tiles, so plugins could register successfully and never
decorate the visible first batch. A microtask deferral lets synchronous
attachment finish before the filter runs. Real-browser list and child-view
tests cover the fix.

**Timestamp-only caching returned stale plugin output.** A card's timestamp
does not capture cross-card indexes, settings, selection, or a replacement
worker's callback handles. Rendering now requests fresh batches, preserving
the existing deadline and connected-element guard. The audit test resolves a
link by adding another card, refreshes the analysis, and verifies the old
card's badge changes without editing that old card.

**Closed worker panels remained tracked.** Explicit handle removal deleted
the DOM handle but retained the detached element in the resource set until
suspension. It now releases the tracked resource immediately. Browser tests
compare resource counts over open/close/reopen cycles for all six plugins.

## Boundaries and remaining limitations

- Worker packages were verified in Chromium over localhost. This is not a
  Firefox/Safari/Electron/Capacitor certification. Direct `file://` module
  workers are subject to browser restrictions; the existing core file-mode
  persistence check passed separately.
- No manual screen-reader, forced-colors device, or native touch-device audit
  was performed. Reduced-motion/forced-colors/print CSS is supplied, but those
  modes are not fully certified by palette and viewport checks.
- Card/component decorations already painted by the host may remain until
  navigation/reload after unregistering the renderer. Tracked injected panels,
  controls, styles and registrations clean up immediately. This host repaint
  distinction is explicitly documented for plugin authors.
- Worker event callbacks cannot reliably cancel a synchronous browser default
  action after a cross-thread round trip. The examples use button-driven,
  non-modal panels and do not depend on that behavior.
- API writes are not multi-card transactions and do not acknowledge durable
  persistence per call. Batch conflict checks reduce accidental overwrites;
  they are not compare-and-swap across independent tabs.
- Plugin preferences in default key/value storage are not automatically
  dataset-scoped, exported, or erased on uninstall. Per-card app state is kept
  in namespaced `modsData` instead. Created cards intentionally remain.
- Refresh is explicit, avoiding focus loss from rebuilding active forms.
  Large result lists are bounded as documented in the collection README.
- Runtime fixes are backward-compatible; release version selection/tagging
  remains a separate release-management action. The draft PR does not deploy
  or merge these changes.

## Reproduction

```sh
npm ci
npx playwright install chromium
npm run plugins:check
npm test
npm run build
npm run smoke
npm run qa:browser
npm run qa:plugins
```

Set `CHROMIUM_PATH` to use an existing supported Chromium binary. Inspect
`sample-plugins/advanced/README.md` for installation, owned data, limits,
uninstall behavior, and rollback instructions. The standalone guide is
`docs/guides/PLUGIN_AUTHORING_GUIDE.md`.
