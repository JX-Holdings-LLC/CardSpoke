# CardSpoke Multi-Persona App Review

**Date:** 2026-08-09
**Repository:** `jxburros/CardSpoke`
**Reviewed version:** 0.21.0 (package.json), built and exercised live via `npm run build` + `npm run preview`
**Method:** Ten independent reviews, each role-playing a distinct user persona with different priorities. Each review is grounded in the actual codebase (`www/src/`), tests (`tests/`), docs (`docs/`), and — where noted — hands-on interaction with the running app (desktop and mobile viewports) via headless Chromium.

## How to read this report

Each persona reviewed CardSpoke through the lens of what *they* need, not a generic checklist. Findings are graded **Critical / High / Medium / Low** for severity to that persona's use case specifically — the same fact (e.g. "no real-time sync") can be a non-issue for one persona and the deciding factor for another. Ratings are out of 10 and are **not comparable across personas** — an 8/10 for the privacy-conscious professional and a 2/10 for the team lead both describe the same app accurately.

## Summary scorecard

| # | Persona | Priorities | Rating |
|---|---|---|---:|
| 1 | Grad student / academic researcher | Structure, tagging, search, citation linking, export | 6/10 |
| 2 | Fiction novelist / worldbuilder | Nesting, linking, templating, manuscript export | 6.5/10 |
| 3 | Freelance investigative journalist | Fast search, source privacy, mobile capture, export | 7/10 |
| 4 | Plugin developer | API docs, samples, permission model, dev loop | 8/10 |
| 5 | Privacy-conscious professional (e.g. therapist) | On-device data, encryption, plugin transparency | 8/10 |
| 6 | Screen-reader / keyboard-only user | Keyboard operability, ARIA, contrast, focus management | 6.5/10 |
| 7 | Casual non-technical / older-adult user | Simplicity, no jargon, can't lose or break things | 8/10 |
| 8 | Mobile-first user (phone/tablet, Capacitor) | Touch targets, offline reliability, native feel | 6/10 |
| 9 | Small-team lead evaluating for team use | Multi-user collaboration, access control, sync | 2/10 |
| 10 | IT/security administrator | Data egress, dependency risk, plugin sandbox, CI gates | 7/10 |

**Average across personas: 6.6/10.** The spread (2/10 to 8/10) is the headline finding: CardSpoke is a strong, carefully engineered *single-user, local-first* card tool, and its rating tracks almost perfectly with how much a persona's workflow depends on multi-user collaboration versus solo depth and privacy.

---

## 1. Grad student / academic researcher — 6/10

**Persona:** A PhD candidate using CardSpoke for literature notes, reading summaries, and thesis outlines, tagged by theme/method and cross-linked to trace citation networks.

**Works well:**

- Hierarchical cards + breadcrumb nav suit an outline-then-drill-down thesis structure.
- Tag Manager supports global rename/merge/delete (`tests/tag-management.test.js`) — safe recategorization as themes evolve.
- Fuzzy, typo-tolerant search (`fuzzySearchCards`, `www/src/metadata.js`) with tiered exact/approximate scoring.
- Backlinks and tag-based related-cards (`getBacklinks`, `getRelatedCards`, `www/src/data.js`) surface citation webs automatically.
- Markdown/CSV/JSON/TXT export out of the box.

**Gaps:**

- **Critical** — `[[Card Title]]` links resolve by title text, not stable ID; no rename-propagation exists in `data.js`/`metadata.js`. Renaming a source card silently orphans every reference to it across the corpus.
- **High** — LocalStorage has a ~5MB practical ceiling (`www/src/data.js:1424`) with no proactive warning; a large literature review could approach it with no cloud safety net.
- **High** — CSV export is flat: no link graph, no ancestor/hierarchy path — weak for reference-manager round-tripping.
- **Medium** — `getRelatedCards` hard-caps at 10 matches with no UI control.
- **Medium** — No dedicated citation metadata fields (author/year/DOI); tags and links are overloaded to do citation-management's job.

**Recommendations:** Resolve `[[links]]` by stable ID with auto-update on rename; add a storage-usage indicator well before the LocalStorage ceiling, plus richer export that preserves link graphs and hierarchy.

---

## 2. Fiction novelist / worldbuilder — 6.5/10

**Persona:** Structures a manuscript as Book → Chapter → Scene, plus Character/Location/Plot-thread trees that constantly cross-reference each other.

**Works well:**

- Reparent guards against dropping a card into its own subtree (`www/src/kernel.js:370-374`).
- `[[Card Title]]` linking is simple, case/whitespace-normalized (`tests/card-links.test.js`) — fast to type mid-draft.
- Real "duplicate with children" (`duplicateHierarchy`, `www/src/data.js:336`) and `duplicateCardAsChild` — exactly what a character-sheet template needs.
- Duplicate of a whole subtree is one atomic, one-undo operation (`www/src/data.js:342-353`).
- Markdown mode, formatting toolbar, undo/redo, trash recovery cover the basic drafting loop.

**Gaps:**

- **High** — Markdown/TXT export flattens every card to the same heading level regardless of nesting (`www/src/systems.js:822-841`) — a Book→Chapter→Scene tree exports as a wall of same-level blocks, losing manuscript structure.
- **Medium** — `[[links]]` are exact-name matching only; no alias support, no picker for not-yet-existing names, and renaming a character silently breaks every existing reference in prose.
- **Medium** — No batch reorder beyond drag-and-drop reparent; could get tedious for a 30-chapter novel.
- **Low** — Plugin trust model ("no sandbox, full access" per README) means any installed writing-UI plugin can read all manuscript text.

**Recommendations:** Make export depth-aware (heading level or indentation by nesting depth); add link-integrity handling (broken-link warnings, rename-aware updates).

---

## 3. Freelance investigative journalist — 7/10

**Persona:** Tracks sources, interview notes, and leads on deadline, often on a phone in the field; needs source confidentiality guaranteed by architecture, not policy.

**Works well:**

- Fuzzy + exact search with tag/body/title scoring (`fuzzySearchCards`, `metadata.js:897`) surfaces misspelled names fast.
- Cross-dataset search (`fuzzySearchMultiDataset`) lets separate per-story vaults be searched individually or together, capped at 100 results for speed.
- Genuinely local-first: no telemetry, one documented (opt-in, gated) outbound call (`docs/policies/STORAGE_AND_PRIVACY.md`, `tests/offline-first.test.js`).
- PIN-protected datasets with AES-GCM + PBKDF2 (250k iterations); PIN itself is never stored (`www/src/core/dataset-crypto.js`).
- Phone-tuned CSS breakpoints (390px) and 44px touch targets — evidence of real mobile testing.

**Gaps:**

- **High** — Exports are always plaintext, even from a PIN-protected dataset. Filing a story by exporting/emailing a JSON/MD file defeats the at-rest encryption entirely.
- **Medium** — Once a plugin is granted `network` permission, the sandbox no longer prevents exfiltration of card content — easy to fumble on a rushed day.
- **Medium** — README explicitly lists "production-ready mobile security hardening" as out of scope; the Capacitor security checklist (biometric auth, ProGuard, Keystore) is an unchecked TODO, not implemented state.
- **Low** — Search scoring thresholds are undocumented/opaque to the user; no "did you mean" indicator.

**Recommendations:** Add encrypted export (reuse the existing AES-GCM envelope); finish the Capacitor mobile hardening checklist (biometric unlock, `allowBackup=false`) before trusting the mobile app for field capture.

---

## 4. Plugin developer — 8/10

**Persona:** Wants to build a private theme/feature/app-layer plugin for their team, cares about API clarity, permission model, and dev-loop speed.

**Works well:**

- `docs/architecture/PLUGIN_SYSTEM.md` is genuinely strong: 5-minute quickstart, full manifest reference, lifecycle diagram, real troubleshooting table mapped to actual error strings.
- `sample-plugins/apps/kanban-board.json` is a solid non-trivial worked example.
- Permission model is isolation-based, not cooperative: `plugin-worker-bootstrap.js` strips `window`/`document`/`fetch`/`localStorage` before compiling plugin JS — a denied permission is unreachable, not just undocumented.
- Lifecycle is heavily tested — 407/407 tests pass across 7 plugin-related suites, using real `worker_threads`-backed Worker semantics.
- `card.render` middleware has an explicit ~80ms per-batch deadline so a buggy plugin can't stutter scrolling (`PLUGIN_INVARIANTS.md` §7).

**Gaps:**

- **Medium** — No hot-reload dev loop for sandboxed JS plugins; iterating means re-upload via Plugin Manager each time.
- **Medium** — Header/Sidebar/SearchBar component overrides only apply at boot — testing one requires a full reload each iteration.
- **Low** — `PluginSandbox`/`createFunction` naming is a documented-but-still-confusing leftover from the pre-sandbox architecture.
- **Low** — Worker-context debugging has no standard breakpoint/devtools-attach path, only `ctx.logger`.

**Recommendations:** Add a dev-mode CLI/flag that loads a plugin package with file-watch reload into a running sandboxed instance; let component overrides hot-apply instead of requiring a full page reload.

---

## 5. Privacy-conscious professional (e.g. therapist) — 8/10

**Persona:** Keeps confidential client notes on a personal laptop; needs data to never leave the device without an explicit, informed action, and full transparency on plugin access.

**Works well:**

- Real encryption at rest: PIN-protected datasets use AES-GCM with 250,000-iteration PBKDF2; PIN never stored (`www/src/core/dataset-crypto.js`).
- Plugin sandbox is enforced by construction — a dedicated Web Worker with no `window`/`localStorage`/`fetch`/`indexedDB`, every capability gated behind explicit per-permission consent (`www/src/core/permissions.js`).
- Only one outbound network destination in the entire app (the opt-in plugin gallery), locked down by CSP; exports are local Blob downloads, never uploaded.
- High-risk plugins install suspended and require manual enable; Safe Mode boots with zero plugin code running.

**Gaps:**

- **High** — Exports are always plaintext even for a PIN-protected dataset — a backup/export of client notes sits unencrypted on disk with no built-in protection option.
- **Medium** — A PIN protects data at rest but not an unlocked, unattended session — no session lock/timeout, no biometric gate for the web app.
- **Medium** — Sandboxing limits what a plugin's code can *reach*, not what it can *do* with a granted capability — `data-modify` can still delete every card, `network` can send data anywhere once approved.
- **Low/Medium** — Encryption is opt-in; without setting a PIN, card content sits in plaintext LocalStorage/IndexedDB by default.

**Recommendations:** Add password-protected export reusing the existing envelope format; add idle/session lock that re-prompts for PIN after inactivity.

---

## 6. Screen-reader / keyboard-only user — 6.5/10

**Persona:** Never uses a mouse; needs every control keyboard-reachable, every state change announced, every modal to trap and correctly return focus.

**Works well:**

- Real focus-trap utility (`trapFocus`, `metadata.js:174`) and a shared `enhanceModalA11y` enhancer applied to the menu, Plugin Manager, and other overlays — adds `role="dialog"`, `aria-modal`, `aria-labelledby`, trapping, and focus restoration.
- `tests/ui-regressions.test.js` actually asserts dialog semantics ship in markup and that every menu-close path funnels through one function so the trap can't be left dangling.
- Form labels are programmatically associated (`<label for>`, explicit `aria-label`s); a previously-unlabeled PIN input was fixed in v0.18.2.
- `prefers-reduced-motion: reduce` is honored globally (`www/styles.css:2426`).
- Native `confirm()`/`prompt()` are banned by test — all confirmations go through in-app, presumably screen-reader-friendlier dialogs.

**Gaps:**

- **High** — No skip link anywhere in `www/index.html` — every page load requires tabbing through the full header/toolbar to reach card content.
- **High** — Accessibility verification is entirely static/textual. The project's own audit (`docs/reports/AUDIT_QA_2026-07-10.md`) states full automated accessibility testing and assistive-tech validation (axe-core, NVDA/VoiceOver) is absent.
- **Medium** — ARIA usage is uneven: `kernel.js`, `main.js`, `state.js` have zero `aria-*` usage; storage/PIN dialogs — arguably the highest-stakes flows — are comparatively under-annotated.
- **Medium** — No `aria-live` region found for save-status/toast changes — a screen-reader user may not hear "Saved" or error toasts fire.
- **Low** — Contrast is asserted for exactly one token pair, not swept across disabled/hover/active states or the high-contrast mode.

**Recommendations:** Add a "Skip to content" link as the first focusable element; run axe-core in CI plus one real NVDA/VoiceOver pass through create/edit/search/PIN-unlock, per the project's own audit recommendation.

---

## 7. Casual non-technical / older-adult user — 8/10

**Persona:** Wants a simple digital notebook for personal notes/recipes/reminders; doesn't want to configure anything or read a manual, and is anxious about "breaking" something or losing notes.

**Works well:**

- The "Getting Started" panel walks through what "Cards" are in plain words with a clear "Create Your First Card" button.
- Typing a title and text and clicking "Save" is simple, with an immediate "SAVED LOCALLY" confirmation badge.
- Searching by partial title found the note instantly.
- Deleting a card asks "Delete this card and all of its children? Cancel / Delete" — can't happen by accident.
- Undo actually works and is visible: deleting a card produced an Undo button that restored it with a status message.

**Gaps:**

- **Medium** — The word "children" for sub-cards is momentarily alarming out of context, before the user re-parses it as "smaller notes inside a bigger one."
- **Medium** — The hamburger menu (☰) is small and unlabeled until clicked — easy to miss despite being called out in onboarding text.
- **Low** — Technical vocabulary ("local-first," "schema," "plugin," "middleware") appears in the README a curious user might read, even though none of it is needed to make a note.
- **Low** — The undo toast reads "Undo: deleteCard" — a programmer-facing string rather than a plain-language one.

**Recommendations:** Rephrase "children" and "Undo: deleteCard" into everyday language ("sub-notes," "Card deleted — Undo"); label the menu button "Menu," not just an icon.

---

## 8. Mobile-first user (phone/tablet, Capacitor) — 6/10

**Persona:** Rarely at a desktop; wants CardSpoke, wrapped via Capacitor, to feel like a real native Android/iOS app — fast, reliable offline, comfortable to use with touch.

**Works well:**

- Primary toolbar buttons measured exactly 44×44px at both 390×844 and 768×1024 viewports — meets the standard mobile touch-target minimum.
- Card action buttons (Edit/Bookmark/Duplicate/Share/Add Child/Delete) are full-width, easily tappable rows.
- Offline is engineered, not just claimed: `tests/service-worker.test.js` verifies cache-namespace versioning tied to `package.json`, stale-while-revalidate for shell assets, and offline navigation fallback; `tests/offline-first.test.js` enforces "local saves are authoritative" with an explicit save-status indicator.
- `www/src/storage.js` explicitly branches on `Capacitor.isNativePlatform()` to use the native Filesystem API rather than a lazy web wrapper.

**Gaps:**

- **High** — README states outright: "Mobile builds should be treated as experimental until platform-specific security hardening is completed" — a direct warning against daily reliance with real data.
- **Medium** — `www/capacitor.js` only logs platform detection; no visible UI fallback if a native plugin (Filesystem, Preferences) is unavailable on a given device — could fail silently with no desktop devtools to debug it.
- **Medium** — Tablet layout (768px) is the phone layout stretched wide: large unused whitespace, single-column full-width slide-out menu — not a tablet-native layout.
- **Low** — Some formatting-toolbar buttons (e.g. "I" for italic) are only ~24px wide despite being 44px tall — tight for a thumb.

**Recommendations:** Close out the mobile security hardening checklist so "experimental" can be dropped; give 768px+ widths a real two-pane or wider layout instead of reusing the phone shell.

---

## 9. Small-team lead evaluating for team use — 2/10

**Persona:** Leads a 5-10 person team and is evaluating CardSpoke as a shared knowledge base — wants multiple people to read/contribute with at least basic access control.

**Works well (for a single contributor on the team):**

- Card hierarchy, links, backlinks, and tags give a genuinely good single-writer knowledge structure.
- Export options are broad and portable (JSON full-fidelity, Markdown readable, CSV, TXT).
- The plugin system could let the team customize workflows later without forking the app.
- Local-first storage with no telemetry is good for sensitive internal notes.

**Gaps:**

- **Critical** — No multi-user collaboration at all. The README's "What Is Not In This Public Version" and `docs/specifications/FIRST_PUBLIC_SCOPE.md` explicitly list real-time collaboration, hosted sync, and cloud storage drivers as out of scope, with no timeline.
- **Critical** — No accounts, no roles, no permissions for *people* — the only permission system in the app governs plugins, not team members.
- **High** — The "Share" button (`showShareCard`, `www/src/systems.js`) exports a card as text to copy elsewhere — it is not live sharing or collaboration.
- **High** — The header "Sync" icon is actually the dark/light theme toggle, confirmed in `www/src/rendering.js`'s own code comment — worth flagging loudly so no one on the team expects real sync from it.
- **Medium** — Export/import as a de facto sharing mechanism has no merge/conflict resolution — two people editing and re-importing the same dataset means last import silently wins.

**Recommendations:** Do not adopt CardSpoke as a team's live shared knowledge base today; treat it as one person's capture tool that periodically exports snapshots into a system built for team collaboration. Revisit if/when cloud storage drivers or hosted sync land, since the card/link/tag model would translate well to a synced version.

---

## 10. IT/security administrator — 7/10

**Persona:** Evaluating whether CardSpoke can be approved for org-wide employee use — data egress, dependency risk, plugin trust boundary, and whether CI actually gates releases on security checks.

**Works well:**

- Local-first, no telemetry: the only outbound call is an opt-in fetch to the plugin gallery, gated behind the user opening that tab.
- Real plugin sandboxing (v0.21.0): JS plugins run in a dedicated Web Worker with `window`/`document`/`localStorage`/`fetch`/`indexedDB` all stripped; the only egress is a permission-checked RPC channel.
- Enforced CSP with a real gate: `www/index.html` ships a restrictive CSP, and `npm run smoke` asserts its presence; CI fails the deploy if it doesn't pass.
- Small, mostly first-party dependency tree (7 runtime deps, all `@capacitor/*`); `npm audit --audit-level=high` runs in CI.
- Encryption at rest available (AES-GCM + PBKDF2, 250k iterations, PIN never persisted).

**Gaps:**

- **Medium** — `README.md` (as of this review) still describes the *old* plugin trust model ("no sandbox... declared permissions scope the API rather than enforce a boundary") and an older version number, while `SECURITY_AND_SAFETY.md` and the actual code describe a resolved, real worker-based sandbox. A security-relevant doc contradicting shipped code is a trust problem on its own.
- **Medium** — A legacy unsandboxed plugin-registration path still exists in `www/src/core/plugin-api.js` (`createLegacyPluginContext`) for programmatically-registered plugins, bypassing the worker sandbox — needs a documented answer on who can use this path.
- **Medium** — `npm audit` currently surfaces high-severity transitive advisories in dev/build tooling; whether CI's `--audit-level=high` gate is currently green or these are excluded as dev-only is undocumented.
- **Low-Medium** — Sandboxing constrains code reach, not granted capability — a plugin approved for `data-modify` can still delete every card, one approved for `network` can send data anywhere.

**Recommendations:** Sync `README.md` to the current version and sandbox model immediately — a stale security-relevant doc blocks approval on its own. Restrict plugin installation to an IT-curated allowlist until there's a formal review process for third-party permission grants.

---

## Cross-cutting themes

1. **The core single-user experience is unusually well engineered for its size.** Six of ten personas rated it 6.5+/10, and the strongest reviews (plugin developer, privacy-conscious professional) cite real, tested engineering — sandboxed plugin runtime, encryption at rest, dialog-focused accessibility work, offline architecture — not just marketing claims.
2. **Team/collaboration use is the sharpest, most consistent gap.** The team-lead persona's 2/10 isn't a matter of taste — it's a direct, repo-acknowledged scope decision (no accounts, no sync, no roles). Two personas independently flagged UI elements that could mislead users into expecting collaboration that doesn't exist ("Share" is export-as-text; the header "Sync" icon is the theme toggle).
3. **Encryption exists but export is the leak.** Three personas (journalist, privacy-conscious professional, and implicitly the security admin) independently converged on the same finding: PIN-protected datasets are genuinely encrypted at rest, but every export path (JSON/MD/CSV/TXT) produces plaintext, silently undoing that protection the moment a user backs up or shares a file.
4. **Documentation occasionally lags shipped security posture.** The security admin found `README.md`'s plugin trust-model description stale relative to the real, more protective sandboxed implementation — a rare case where the app is *better* than its own docs claim, but that mismatch is itself a red flag for an admin auditing trust.
5. **Link integrity is a recurring content-authoring gap.** Both the researcher and novelist personas — independently, from different code paths — found that `[[Card Title]]` links resolve by title text with no rename-propagation, so renaming any linked card silently orphans references to it elsewhere.
6. **Accessibility and mobile both show "real intent, unverified execution."** Deliberate engineering exists in both areas (focus traps, dialog semantics, tuned touch targets, service-worker offline logic), but both personas found the project's own audit or docs admitting the harder verification step (assistive-tech testing; mobile security hardening) hasn't happened yet.

## Suggested priority order for fixes

1. Encrypted/protected export option (closes the sharpest, most-repeated privacy gap).
2. Stable-ID card links with rename propagation (protects researcher and novelist content integrity).
3. Skip link + axe-core/assistive-tech verification pass (accessibility gap has a real user and a repo-endorsed remediation plan already).
4. Clarify or relabel "Share" and the header "Sync" icon so neither implies collaboration that doesn't exist.
5. Sync `README.md` to the current (already more secure) plugin trust model and version number.
