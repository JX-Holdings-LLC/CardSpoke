---
app: CardSpoke
qa_doc_version: 1
default_node_version: "20.19+ or 22.12+"
default_package_manager: npm
default_branch: main
app_type: "Local-first Node/Vite web app"
primary_focus:
  - local-first behavior
  - zero-dependency standalone browser use
  - LocalStorage persistence (default) with optional per-dataset IndexedDB/local-file drivers
  - LocalStorage preferences
  - graph/card CRUD
  - plugin architecture
  - offline resilience
  - XSS/security hardening
supported_qa_levels:
  - quick
  - core
  - plugin
  - release
---

# CardSpoke QA Instructions

## Overview

CardSpoke is a local-first card and graph application. QA should verify that the app builds, runs, persists data locally, supports standalone browser usage, and preserves strict separation between datasets and vaults.

CardSpoke should be tested as both:

1. A normal Node/Vite app.
2. A zero-dependency standalone app opened directly through `file://`.

The requested QA level will come from the central automation config.

Valid QA levels are:

- `quick`
- `core`
- `plugin`
- `release`

Each level includes the levels before it:

- `quick` = basic smoke testing
- `core` = `quick` + main app functionality and persistence
- `plugin` = `quick` + `core` + plugin architecture testing
- `release` = all previous levels + stress, security, offline, and mobile checks

---

# Universal Safety Rules

Do not use production credentials.

Do not connect to production APIs.

Do not send real emails.

Do not modify live user data.

Do not assume internet access is available unless the test explicitly requires dependency installation.

Do not silently sync data to external services.

Do not approve destructive operations without explicit human permission.

For browser or computer-control testing, use only local test data.

For plugin testing, prefer mock plugins and test fixtures.

For storage corruption testing, use a disposable browser profile or isolated test environment.

For stress testing, use generated test data only.

---

# Test Environment Expectations

## Required

- Node.js 20.19+ or 22.12+
- npm
- Git
- Modern Chromium-based browser

## Preferred

- Ability to open local files through `file://`
- Ability to inspect browser console
- Ability to inspect IndexedDB
- Ability to inspect LocalStorage
- Ability to run Vite dev and preview servers
- Ability to simulate offline mode
- Ability to run browser/computer-control QA when requested

## Optional / Conditional

- Android Studio for Android Capacitor testing
- Xcode for iOS Capacitor testing

Note: iOS native testing requires macOS with Xcode. If the QA environment is Windows, mark iOS native open/build tests as blocked by environment rather than failed.

---

# QA Level: quick

## Goal

Verify that CardSpoke installs, builds, runs basic tests, serves locally, and can function as a standalone zero-dependency web app.

This is the baseline smoke test level.

Use this for fast daily checks.

---

## quick.1 Dependency Resolution

Run:

~~~bash
npm install
~~~

Validate:

- Installation completes successfully.
- Node.js version is 18 or newer.
- No dependency resolution failures occur.
- No critical vulnerabilities are introduced.

Record:

- Node version
- npm version
- install exit code
- critical vulnerability count, if available

Recommended additional command:

~~~bash
npm audit --audit-level=high
~~~

A nonzero audit result should be reported as a security finding, but it should not automatically block all other QA unless the vulnerability directly prevents the app from running.

---

## quick.2 Unit and Integration Tests

Run:

~~~bash
npm test
~~~

Validate:

- The `uvu` test runner executes successfully.
- Foundational tests in the `tests/` directory run.
- All tests pass or failures are clearly reported.

Run watch-mode testing only with a timeout because watch commands may not terminate in unattended automation:

~~~bash
npm run test:watch
~~~

Validation for `test:watch`:

- The command starts successfully.
- The test runner detects and runs the expected tests.
- The process does not immediately crash.
- In automation, stop it after a short timeout and report whether it appeared healthy.

Do not let `npm run test:watch` block the entire QA run indefinitely.

---

## quick.3 Build Pipeline Validation

Run:

~~~bash
npm run build
~~~

Validate:

- Vite build completes successfully.
- No fatal bundling errors occur.
- Build output is generated as expected.

Check:

- `www/app.js` exists after `npm run build`.
- `www/app.js` appears non-empty.
- The public surface initializes: the bundle assigns `window.CardSpoke`
  (from `www/src/core/global-api.js`) before the app-layer boot IIFE.
- No ordering-related runtime error appears when loaded.

---

## quick.4 Local Dev Server

Run:

~~~bash
npm run dev
~~~

Validate:

- Vite development server starts.
- The local URL opens in browser.
- The app shell loads.
- Browser console has no fatal errors.

Then run:

~~~bash
npm run preview
~~~

Validate:

- Preview server starts.
- Built app can be served locally.
- Browser console has no fatal errors.

For unattended automation, start each server, perform a basic page load, capture logs, then stop the server.

---

## quick.5 Zero-Dependency Protocol

Open:

~~~text
www/index.html
~~~

directly in a browser using the `file://` protocol.

Validate:

- App loads without a web server.
- Core UI appears.
- Basic card creation works.
- Basic card editing works.
- Basic card persistence works if supported under `file://`.
- Browser console has no fatal errors.
- App does not require a Vite server for normal standalone usage.

Important claim to verify:

> CardSpoke functions completely standalone without a web server.

---

## quick Pass Criteria

`quick` passes if:

- `npm install` completes.
- `npm test` passes or failures are clearly limited and documented.
- `npm run build` (Vite, the single canonical build) succeeds.
- Dev and preview servers start.
- `www/index.html` opens through `file://`.
- No fatal console errors prevent basic app usage.

---

# QA Level: core

## Goal

Validate the normal happy-path user experience and confirm the local-first storage model.

This level includes everything in `quick`.

Use this after meaningful app changes.

---

## core.1 Card Operations: CRUD

Test the core graph/card workflow.

Validate that a user can:

1. Create a card.
2. Read/view the card.
3. Edit the card.
4. Delete the card.
5. Confirm the deleted card no longer appears.
6. Refresh the app and confirm expected persistence behavior.

Check for:

- UI errors
- console errors
- broken graph rendering
- stale deleted cards
- duplicate cards
- lost edits
- incorrect card relationships

---

## core.2 Storage Persistence Validation

Use browser dev tools or automation-accessible storage inspection.

Validate:

- Card graphs save to the dataset's active driver — LocalStorage by default; check IndexedDB or the chosen local file only if the dataset's storage driver has been switched.
- Relational/linked data saves to that same driver.
- Data remains after page refresh.
- Data remains after closing and reopening the app.
- Deleted data is actually removed or correctly tombstoned, depending on app design.

Check:

- Database exists.
- Expected object stores exist.
- Created cards appear in storage.
- Updated cards reflect latest state.
- Deleted cards no longer behave as active records.

---

## core.3 LocalStorage Preferences

Verify that preference toggles update keys prefixed with:

~~~text
cardspoke_
~~~

Test these preferences:

- Rich text
- Grid view
- Typography
- High-contrast mode
- Dev mode

For each preference:

1. Toggle the setting in the UI.
2. Confirm the UI changes as expected.
3. Inspect LocalStorage.
4. Confirm a `cardspoke_*` key changed.
5. Refresh the app.
6. Confirm the preference persists.

Report any preference that:

- Does not save
- Saves under a wrong key
- Does not reload correctly
- Changes visually but does not persist
- Persists but does not affect UI on reload

---

## core.4 Namespaced Datasets / Vaults

Create multiple vaults or datasets.

Validate:

- Dataset A data does not appear in Dataset B.
- Dataset B data does not appear in Dataset A.
- Switching datasets updates the visible graph correctly.
- LocalStorage and IndexedDB storage remain namespaced.
- Exporting from one vault does not include another vault’s data.

Suggested test:

1. Create Vault A.
2. Add cards unique to Vault A.
3. Create Vault B.
4. Add cards unique to Vault B.
5. Switch between vaults.
6. Confirm strict separation.
7. Refresh app and repeat checks.

Failure condition:

- Any data bleed between vaults/datasets is High or Critical severity.

---

## core.5 Export and Backup Utilities

Run all available export functions.

Validate supported formats:

- JSON
- CSV
- Markdown
- TXT

For each export:

1. Create representative test data.
2. Include multiple cards.
3. Include relationships if supported.
4. Include rich text content if supported.
5. Export file.
6. Inspect file integrity.
7. Confirm content is readable and complete.
8. Confirm format matches expectation.

Report:

- Missing cards
- Broken encoding
- Missing relationships
- Invalid JSON
- Malformed CSV
- Markdown formatting issues
- TXT export missing important fields

---

## core Pass Criteria

`core` passes if:

- All required `quick` checks pass or are clearly documented.
- Card CRUD works.
- IndexedDB persistence works.
- LocalStorage preferences persist.
- Vault/dataset namespaces remain strictly isolated.
- Exports are complete and valid in all supported formats.
- No happy-path user flow causes a fatal error or white screen.

---

# QA Level: plugin

## Goal

Validate CardSpoke’s 3-layer plugin system, including API boundaries, middleware, registries, and permission enforcement.

This level includes everything in `quick` and `core`.

Use this after changes to plugins, APIs, storage, middleware, permissions, or extension boundaries.

---

## Plugin System Layers

CardSpoke plugin layers:

1. Theme Layer Plugins — Low Risk
2. Feature Layer Plugins — Medium Risk
3. App Layer Plugins — High Risk

The QA agent should distinguish findings by plugin layer.

---

## plugin.1 Theme Layer Plugins: Low Risk

Inject or load a custom CSS theme.

Validate:

- Theme changes cosmetic appearance.
- Theme does not modify core app logic.
- Theme does not access card data.
- Theme does not break layout.
- Theme does not create unreadable contrast.
- Theme can be disabled or removed cleanly.

Check:

- Normal mode
- High-contrast mode
- Mobile layout
- Grid view
- Rich text editor areas

Failure condition:

- A theme plugin accessing data or changing logic is a security/design boundary issue.

---

## plugin.2 Feature Layer Plugins: Medium Risk

Load a feature plugin and test interaction with sandboxed APIs:

~~~text
api.ui
api.data
api.storage
api.events
~~~

Validate:

- Plugin can access only permitted APIs.
- Plugin can interact with allowed UI extension points.
- Plugin can read/write data only through approved interfaces.
- Plugin events fire correctly.
- Plugin errors do not crash the host app.

Specific test:

- Trigger the UI to show a toast message via plugin.
- Confirm the toast appears.
- Confirm no unrelated UI state is corrupted.

Report:

- Missing API methods
- API methods that throw unexpectedly
- Permission leaks
- Plugin crashes that bring down the app
- UI extension points that fail silently

---

## plugin.3 App Layer Plugins: High Risk

Test advanced app-level extension points.

### Component Registry

Override a core UI component using the Component Registry.

Validate:

- Override is accepted only through intended mechanism.
- Replacement component renders.
- App remains usable.
- Removing the plugin restores default component behavior.
- Component override cannot access forbidden data without permission.

### Storage Driver Registry

Inject a mock custom storage driver, such as one simulating cloud sync or git sync.

Validate:

- App routes data operations to the custom storage driver instead of IndexedDB when configured.
- The mock driver receives expected read/write/delete calls.
- IndexedDB is not unintentionally modified when the custom driver is active.
- Fallback to IndexedDB works when custom driver is removed or fails.
- Storage driver errors are handled gracefully.

Report as High severity if data routes to the wrong backend.

---

## plugin.4 Middleware Pipeline

Write or load a test plugin that intercepts a core operation, such as:

- Card save
- Card delete
- Dataset switch
- Export

Validate priority-weighted interceptors:

- Interceptors run in expected order.
- Higher-priority middleware can modify an operation.
- Middleware can block an operation when allowed.
- Blocked operations produce clear UI feedback.
- Middleware failure does not corrupt app state.

Suggested test:

1. Create a middleware plugin that intercepts card save.
2. Modify the card title or metadata before save.
3. Confirm the modified data persists.
4. Create another middleware plugin that blocks delete.
5. Attempt to delete a card.
6. Confirm deletion is blocked and user receives feedback.

---

## plugin.5 Permission System Boundary

Attempt to execute sensitive operations from a plugin that lacks explicit user consent or permissions.

Sensitive operations may include:

- Reading all cards
- Exporting vault data
- Deleting cards
- Changing storage driver
- Accessing another dataset namespace
- Triggering sync-like behavior
- Accessing file system or network features, if available

Validate:

- Unauthorized plugin action is blocked.
- User receives clear permission or denial feedback.
- No data is leaked.
- No operation partially succeeds.
- Permission grants are explicit and auditable.

Failure condition:

- Any unauthorized plugin access to private user data is Critical severity.

---

## plugin Pass Criteria

`plugin` passes if:

- All required `quick` and `core` checks pass or are clearly documented.
- Theme plugins remain cosmetic.
- Feature plugins operate only within sandboxed APIs.
- App-layer plugins can extend intended registries without corrupting core behavior.
- Middleware works in priority order.
- Unauthorized plugin actions are blocked.
- Plugin failures do not white-screen or corrupt app state.

---

# QA Level: release

## Goal

Push CardSpoke to extreme conditions, malformed data, mobile packaging, offline operation, and security attack patterns.

This level includes everything in `quick`, `core`, and `plugin`.

Use this before major releases or after storage, security, mobile, offline, or performance-sensitive changes.

---

## release.1 Capacitor Mobile Compilation

Run:

~~~bash
npm run sync:android
~~~

Validate:

- Capacitor sync completes.
- Web assets are copied to the Android shell.
- No missing asset errors occur.
- Native project remains openable.

Run:

~~~bash
npm run open:android
~~~

Validate:

- Android Studio opens the project.
- No immediate build configuration failure appears.

Run, if environment supports macOS and Xcode:

~~~bash
npm run sync:ios
~~~

Validate:

- Capacitor sync completes.
- Web assets are copied to the iOS shell.
- No missing asset errors occur.

Run, if environment supports macOS and Xcode:

~~~bash
npm run open:ios
~~~

Validate:

- Xcode opens the project.
- No immediate build configuration failure appears.

If running on Windows, mark iOS tests as:

~~~text
Blocked: iOS native testing requires macOS and Xcode.
~~~

Do not mark iOS tests as failed solely because Windows cannot run Xcode.

---

## release.2 Storage Quotas and Stress Testing

Generate a large dataset.

Minimum stress target:

~~~text
10,000+ cards/nodes
~~~

Validate:

- Cards can be created in large volume.
- IndexedDB write performance remains acceptable.
- IndexedDB read performance remains acceptable.
- Graph rendering remains usable or degrades gracefully.
- UI does not lock indefinitely.
- Virtualization or rendering limits are handled.
- Search/filter/navigation remain functional if supported.
- App does not white-screen.

Capture:

- Approximate generation time
- Approximate load time
- Browser memory behavior if available
- Console errors
- UI lag observations
- Rendering failures

Report performance issues with evidence and rough thresholds.

---

## release.3 Data Corruption Recovery

Use an isolated test profile or disposable environment.

Manually inject malformed data into:

~~~text
LocalStorage cardspoke_* keys
IndexedDB datastore
~~~

Examples:

- Invalid JSON
- Missing required fields
- Wrong data types
- Corrupt relationship references
- Extremely large string values
- Null or undefined-like values where objects are expected

Validate:

- App does not white-screen.
- App fails gracefully.
- User receives understandable recovery feedback.
- App can restore from backup if available.
- Corrupt data does not permanently lock the user out.
- App does not silently delete valid unrelated data.

Failure condition:

- White-screen on corrupt local data is High severity.
- Permanent data loss without warning is Critical severity.

---

## release.4 XSS and Security Validation

Input malicious JavaScript payloads into rich text fields and any other user-controlled text fields.

Use safe test payloads only.

Examples:

~~~html
<script>alert("xss-test")</script>
<img src=x onerror="alert('xss-test')">
<svg onload="alert('xss-test')"></svg>
<a href="javascript:alert('xss-test')">click</a>
~~~

Validate:

- Scripts do not execute.
- Dangerous attributes are sanitized.
- Dangerous URLs are blocked or neutralized.
- Rich text renderer preserves safe formatting only.
- Payload remains inert after save, reload, export, and import if applicable.
- No console evidence of executed payload appears.

Failure condition:

- Any executable script injection is Critical severity.

---

## release.5 Offline Integrity

Disconnect the device from the internet or simulate offline mode.

Validate the strict local-first claim:

- App opens while offline.
- Existing cards load while offline.
- New cards can be created offline.
- Existing cards can be edited offline.
- Cards can be deleted offline.
- Preferences can be changed offline.
- Dataset switching works offline.
- Export works offline.
- No feature silently depends on network access.
- App does not attempt unexpected syncs.
- Offline failures, if any, are clearly explained.

Test aggressively:

1. Start offline.
2. Open app.
3. Create data.
4. Edit data.
5. Refresh.
6. Close and reopen.
7. Export data.
8. Reconnect internet.
9. Confirm no unexpected silent sync occurs.

Failure condition:

- Any core feature breaking due to lack of internet contradicts the local-first claim and should be reported.

---

## release Pass Criteria

`release` passes if:

- All required `quick`, `core`, and `plugin` checks pass or are clearly documented.
- `npm run smoke` (`scripts/static-smoke.mjs`) passes — required deployment gate.
- `npm run qa:browser` (`scripts/browser-qa.mjs`) passes — required deployment gate.
- Android Capacitor sync/open works in supported environment.
- iOS Capacitor sync/open works in supported macOS environment or is correctly marked blocked on Windows.
- 10,000+ card stress test does not catastrophically fail.
- Corrupt storage data does not white-screen the app.
- XSS payloads do not execute.
- Offline operation preserves core app behavior.
- No silent network sync behavior is observed.

---

# QA Level Selection Guidance

## quick

Use this for fast daily checks.

Includes:

- Dependency install
- Test runner
- Vite build
- Dev server startup
- Preview startup
- `file://` standalone open test

This is the default smoke test level.

---

## core

Use this after meaningful app changes.

Includes everything in `quick`, plus:

- Card CRUD
- IndexedDB validation
- LocalStorage preference validation
- Dataset/vault namespace testing
- Export testing for JSON, CSV, Markdown, and TXT

This verifies the normal user experience and local-first data model.

---

## plugin

Use this after changes to plugins, APIs, storage, middleware, permissions, or extension boundaries.

Includes everything in `quick` and `core`, plus:

- Theme plugins
- Feature plugins
- App-layer plugins
- Component Registry
- Storage Driver Registry
- Middleware interceptors
- Permission boundaries

This verifies CardSpoke’s plugin and extensibility architecture.

---

## release

Use this before major releases or after storage, security, mobile, offline, or performance-sensitive changes.

Includes everything in `quick`, `core`, and `plugin`, plus:

- Capacitor Android sync/open
- Capacitor iOS sync/open when environment supports it
- 10,000+ card stress test
- Corrupt data recovery
- XSS validation
- Offline integrity testing

This is the deepest QA level.

---

# Recommended Report Format

The QA agent should produce a report using this structure:

## Summary

- App:
- Repo:
- Branch:
- QA level requested:
- QA level completed:
- Environment:
- Overall result: Pass / Pass with warnings / Fail / Blocked
- Top risks:

## Commands Run

For each command:

- Command:
- Exit code:
- Result:
- Important output:
- Related finding ID, if any:

## Findings

For each finding:

- ID:
- Title:
- Level:
- Severity:
- Confidence:
- Category:
- Steps to reproduce:
- Expected:
- Actual:
- Evidence:
- Suggested fix:
- Recommended owner:
- Recommended agent for implementation:

## Blocked Items

List any checks that could not be completed because of:

- Missing environment
- Missing credentials
- OS limitations
- Missing tools
- Unclear app behavior
- Safety restrictions

Do not mark environment-blocked checks as application failures.

## Suggested Follow-Up

List:

- Suggested next QA level
- Code review areas
- Implementation plan candidates
- Tests that should be automated
- Questions for the human reviewer

---

# Finding Severity Guide

## Critical

Use for:

- Data loss
- XSS execution
- Unauthorized plugin data access
- App cannot load at all
- Cross-vault data leakage
- Silent sync or production data exposure
- Permanent corruption without recovery path

## High

Use for:

- White-screen under common conditions
- Build failures
- Test suite failures that block confidence
- Broken CRUD functionality
- IndexedDB persistence failure
- Storage driver routing to wrong backend
- Corrupt local data causing lockout

## Medium

Use for:

- Broken preferences
- Export formatting problems
- Plugin API defects
- Noticeable UI lag
- Non-critical console errors
- Incomplete but usable workflows

## Low

Use for:

- Minor UX issues
- Cosmetic layout bugs
- Unclear messaging
- Small documentation gaps

## Informational

Use for:

- Suggestions
- Observations
- Blocked checks
- Improvement ideas
- Non-actionable notes

---

# Agent Instructions

When performing QA:

1. Read this file first.
2. Determine requested QA level from the central automation config.
3. Run all checks for that level and all lower levels unless explicitly instructed otherwise.
4. Capture command output and browser console evidence where possible.
5. Do not treat environment-blocked checks as application failures.
6. Do not fabricate results for checks that were not run.
7. Separate confirmed bugs from suggestions.
8. Prefer reproducible findings over vague commentary.
9. Preserve local test data only when it helps debugging.
10. Produce a final Markdown QA report.
11. Never claim a level passed unless its required checks were actually completed.
12. Mark partially completed levels as “Pass with warnings,” “Fail,” or “Blocked,” as appropriate.

---

# Normal Usage Recommendation

Use this pattern:

- `quick` for daily checks.
- `core` after meaningful feature work.
- `plugin` after extension, plugin, middleware, storage, or permission changes.
- `release` before major releases, demos, or handoff.
