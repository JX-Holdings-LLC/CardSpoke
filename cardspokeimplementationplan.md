# CardSpoke Remediation Plan — 5 Sessions / Workgroups

Scope: all 51 checked items from the shortcomings checklist. H15 (no multi-user system)
stayed unchecked and is treated as a roadmap decision, not work to schedule — it is not
in this plan. Where your notes changed the shape of the fix (H8, H13/H14, M20, L2, L14),
the workgroup brief below states the fix as you specified it, not as the original
one-line finding.

**Suggested model tiers**, mapped to what's available in this environment:

- **HIGH** — Opus 5 (or Sonnet 5 at high/xhigh effort). Reach for this where a wrong
  call risks data loss, a security regression, or a design decision that's expensive
  to unwind later.
- **MID** — Sonnet 5 at default effort. Solid engineering judgment needed, but the
  blast radius is contained and easy to review.
- **CHEAP** — Haiku 4.5. Mechanical, low-ambiguity, easy to verify by inspection —
  copy changes, CSS, isolated small fixes, doc updates.

**How to read a workgroup (WG):** Goal → the items it closes, each with your note
folded into the acceptance criteria → files it will likely touch → suggested tier →
what it depends on / conflicts with.

**Session ordering:** Sessions are written to run 1→2→3→4→5. Several later
workgroups edit the same files earlier workgroups touch (`data.js`, `rendering.js`,
`storage.js`) — running sessions out of order risks avoidable merge conflicts. The
one exception is called out at the bottom if you want to parallelize.

---

## Session 1 — Storage Integrity & Scale

The foundation session: the persistence layer, dataset identity/merge, and search
indexing. Everything else in later sessions reads or writes through this layer, so
it goes first and should be fully merged before Session 2 starts.

### WG 1.A — Persistence & Quota (HIGH tier)

**Closes:** H11, H12
**Goal:** Replace the blocking full-dataset `JSON.stringify` + single
`localStorage.setItem` on every save with incremental persistence (per-card writes
where the driver supports it — IndexedDB already can; for LocalStorage, at minimum
move the serialize+write off the debounce-triggered main-thread hot path). Replace
the hardcoded 5MB quota guess with an actual estimate (`navigator.storage.estimate()`
where available, graceful fallback where not), and surface a proactive warning as
usage climbs — not just after a save has already failed.
**Files:** `www/src/storage.js` (`persistStoreNow`, `IndexedDBDriver`, `isQuotaError`), `www/src/data.js` (quota display)
**Depends on:** nothing
**Watch for:** this is the highest data-loss-risk change in the whole plan. Whatever
persistence strategy you land on, it needs its own test pass beyond what's in the
existing suite — don't let this one ship on "looks right."

### WG 1.B — Dataset Identity & Import Merge (HIGH tier)

**Closes:** H13, H14
**Goal (as you specified it):** Give each dataset its own ID and a last-saved
timestamp. When an import encounters a dataset ID that already exists locally but
with different data, don't silently overwrite or duplicate — prompt the user with a
clear choice: keep the existing local copy, take the imported copy, or attempt a
merge that preserves data from both sides where it doesn't conflict. This is also
the fix for H14 (no conflict surfacing on the only sync path that exists) and gives
M23 (no conflict-resolution primitives) its first real primitive, at the
single-device manual-sync level.
**Files:** `www/src/data.js` (`importJSON`, dataset metadata shape), `www/src/storage.js` (dataset id/timestamp on write), new conflict-resolution UI (`www/app.js` modal)
**Depends on:** should land after WG 1.A settles the persistence shape it writes through, so run 1.A → 1.B in sequence, not in parallel (both touch `storage.js`'s store shape).
**Note:** decide and document what "merge" means precisely before writing code —
e.g. card-level merge by ID (union of cards, newer `modified` timestamp wins per
card) is a reasonable default, but write it down as a spec first so the conflict
dialog's three choices map to something deterministic.

### WG 1.C — Search Indexing (MID tier)

**Closes:** M18
**Goal:** Replace the unindexed linear Levenshtein scan with a real index (inverted
index or trie) built incrementally as cards change, so fuzzy search stops being
O(N) per keystroke. Also stop synchronously `JSON.parse`-ing every other dataset's
full payload on a cross-dataset search — index each dataset's searchable fields
once, not per query.
**Files:** `www/src/metadata.js` (`fuzzySearchCards`)
**Depends on:** nothing; can run in parallel with 1.A/1.B (different file).

### WG 1.D — Scale Tests & Documented Limits (CHEAP–MID tier)

**Closes:** L12, L13
**Goal:** Add tests that exercise a realistically large/deep card tree (not the
4-card mock currently in `multi-dataset-search.test.js`) against the cycle guard and
whatever WG 1.A/1.C land on. Then document real numbers — max practical cards,
nesting depth, and quota behavior — in `docs/api/STORAGE_DRIVER_INTERFACE.md` and
`docs/guides/FEATURES.md`.
**Files:** `tests/`, `www/src/kernel.js` (read-only reference), `docs/`
**Depends on:** run this **last** within Session 1, after 1.A/1.B/1.C land, so the
numbers you document are the real post-fix numbers, not the old ones.

---

## Session 2 — Import/Export Overhaul & the CardSpoke Outline Language

The content-fidelity session. This is where the biggest net-new design happens.

### WG 2.A — CardSpoke Outline Language: spec + parser/serializer (HIGH tier)

**Closes:** M20
**Goal (as you specified it):** Design a lightweight plain-text markup language that
represents nested cards — children, sub-children, and so on — so a user can fast-type
a template (or a whole outline) as plain text and have it become a real card tree on
import. It should be the shared format for TXT and MD import, and usable
*optionally* as a more human-readable TXT/MD export format too (not a replacement
for the existing flat exports — an additional, structured option). Write the spec
first (grammar, nesting convention — e.g. indentation or a heading-level convention,
how tags/links embed if at all) as its own artifact before writing the parser, since
WG 2.B and the export half of WG 2.D both build directly on it.
**Files:** new module, e.g. `www/src/core/outline-language.js` (or alongside `data.js`)
**Depends on:** nothing; this is the first thing Session 2 should produce.

### WG 2.B — Markdown-aware Import (HIGH–MID tier)

**Closes:** H5
**Goal:** Replace `importTXT`'s line-splitter default with an importer that
understands the outline language from 2.A, and falls back sensibly for genuinely
unstructured text/markdown that doesn't use it (e.g. a real paragraph-and-heading
markdown file should become one card with formatted body content, not one empty
card per line).
**Files:** `www/src/data.js` (`importTXT`), `www/app.js` (file-picker wiring)
**Depends on:** WG 2.A must be merged first.

### WG 2.C — Wikilinks & Link Resolution Rewrite (HIGH tier)

**Closes:** H6, M11
**Goal:** Make `[[Card Title]]` links render live in Rich Text mode (currently only
the plain-text renderer does this). Replace the exact-title linear-scan resolver
with an indexed lookup; make card renames propagate to other cards' references
instead of silently breaking them; add support for `[[Page|Alias]]` and
`[[Page#Heading]]` syntax.
**Files:** `www/app.js` (`renderRichTextBody`, `findCardByName`, `getBacklinks`)
**Depends on:** nothing in this session; can run in parallel with 2.A/2.B (different
functions/files). **Conflict warning:** Session 3's WG 3.E (escape-order hardening)
touches the same rich-text rendering function — Session 3 should run after this one
lands.

### WG 2.D — Export Completeness (MID tier, with a CHEAP sub-task)

**Closes:** M12, L6, L7
**Goal:** Stop TXT/MD/CSV exports from silently dropping tags, the rich-text flag,
and plugin data — either carry them through where the format allows, or show an
explicit "this format can't preserve X" notice at export time instead of doing it
quietly. Once WG 2.A lands, wire the outline-language export as the optional
human-readable TXT/MD format it was designed for. Fold in the two small bugs while
you're in this file: CSV flattening multi-paragraph bodies without proper escaping
and unescaped semicolon-joined tags (L6), and text import's "append" mode silently
no-op'ing at the root location instead of erroring (L7).
**Files:** `www/src/data.js` (`exportTXT`, `exportMarkdown`, `exportCSV`, `importTXT` append path)
**Depends on:** the outline-export half depends on WG 2.A; L6/L7 don't and can be
done first as a quick, independent, cheap-tier warm-up if you want to split this WG
in two for cost reasons.

---

## Session 3 — Plugin Trust, Safety & Security

### WG 3.A — Plugin Trust UX (MID–HIGH tier)

**Closes:** H7, H8, H9, M15, L10
**Goal:** Fix the stale risk-badge tooltip so it describes the real Worker sandbox
instead of the pre-sandbox model. Add a confirmation dialog **before** any plugin
install completes, showing the plugin's name and developer (from its manifest's
`author`/similar field) with a plain Yes/No choice — per your note, this replaces
today's "install happens immediately on click" flow. Give Safe Mode a real in-app
entry point (menu item or settings toggle) instead of requiring a hand-typed
`?safemode` URL. Make the consent dialog trigger on risk tier, not merely on whether
`permissions` is declared, so an `overrides`-only high-risk plugin can't skip it.
Make the SAFE/LOW/MEDIUM/HIGH risk meaning visible as a persistent label, not only a
hover tooltip.
**Files:** `www/app.js` (install flow, consent modal, risk badges), `www/src/core/permissions.js`
**Depends on:** nothing from Session 1/2 directly, but should run after Session 2
lands since it touches some of the same plugin-adjacent UI surface as later
sessions touch elsewhere — low actual risk of conflict, sequencing is precautionary.

### WG 3.B — Plugin Validator Hardening (MID tier)

**Closes:** M13, L8, L9
**Goal:** Make `validateManifest` actually check the fields it currently silently
skips — `overrides`, `dependencies`, `config`, `compatibility`. Promote malformed
permission strings and plugin IDs from silent warnings to real errors that block
install (or at minimum a loud, unmissable warning — your call on strictness). Add a
dev-mode diagnostic for the "forgotten `await` on `ctx.api.*`" failure mode the docs
already admit is confusing, so it surfaces as a plugin-specific hint instead of a
generic error.
**Files:** `www/src/core/plugin-validator.js`, `www/src/core/plugin-api.js`
**Depends on:** nothing; can run in parallel with 3.A (different files), though both
land in the plugin system so a quick integration check after both merge is worth
the five minutes.

### WG 3.C — Example Loader Cleanup (CHEAP tier)

**Closes:** M14
**Goal:** Fix or annotate `dynamic-plugin-loader.js` so it stops contradicting the
security invariants doc — either remove the `window.CardSpoke` reassignment
entirely (this path is dead code in real boot order) or add a clear comment marking
it unsandboxed/example-only and matching `PLUGIN_INVARIANTS.md`'s frozen-root rule.
**Files:** `www/src/examples/dynamic-plugin-loader.js`
**Depends on:** nothing; fully independent, good filler task for whichever model has
spare capacity.

### WG 3.D — Encrypted Export & Legacy PIN Advisory (HIGH tier)

**Closes:** H10, L11
**Goal:** Extend the existing AES-GCM-256/PBKDF2 dataset encryption so a
PIN-protected dataset's export can also be encrypted (today every export format is
plaintext regardless of PIN status) — at minimum, offer an encrypted JSON export
option for PIN-protected datasets. Separately, surface a one-time advisory to any
user whose dataset still carries traces of the legacy plaintext-PIN bug, telling
them to rotate their PIN.
**Files:** `www/src/core/dataset-crypto.js`, `www/src/data.js` (export), `www/src/storage.js` (legacy detection already exists — hang the advisory off it)
**Depends on:** nothing; this is self-contained crypto work. Keep it isolated from
3.A/3.B — don't let UI work and crypto work land in the same review pass.

### WG 3.E — CSP & Rendering Hardening Review (MID–HIGH tier)

**Closes:** M16, M17
**Goal:** Review whether `unsafe-eval` in `script-src` can be narrowed further now
that plugin compilation runs in a stripped Worker (it may simply be an accepted,
documented trade-off — write down the decision either way). Harden the rich-text
escape-before-markdown pattern so it's structurally safe against a future feature
being added in the wrong order, rather than safe only by current convention — and
make `escapeHtml` escape quotes too, since it's already being reused adjacent to
attribute contexts.
**Files:** `www/index.html` (CSP), `www/src/rendering.js` / `www/app.js` (rich-text render), `www/src/data.js` / `www/src/metadata.js` (`escapeHtml`)
**Depends on:** run this **after** Session 2's WG 2.C, since both touch the
rich-text rendering function — 2.C changes it for wikilinks, this WG changes it for
escape-order safety. Doing them in the other order (or in parallel) risks one
undoing the other's fix.

---

## Session 4 — Accessibility, Keyboard & UI Clarity

### WG 4.A — Keyboard Shortcuts (MID tier)

**Closes:** H3, H4, M6, M7, M8, L4
**Goal:** Add a sibling-navigation shortcut (next/previous sibling card — the gap
next to the existing parent/first-child bindings). Remap or reassign the bindings
that collide with browser-reserved shortcuts (Ctrl+N/T/W/etc.) so they behave
consistently in both the browser build and the native shell. Add a save shortcut to
the card editor. Decide, deliberately, which shortcuts should still fire while focus
is inside an input/textarea (undo/redo arguably should; hierarchy navigation
probably shouldn't) instead of blanket-disabling all of them — and give the user a
visual cue when a shortcut is suppressed. Add real behavioral tests (simulated
keypresses with assertions, not string-search-the-source) for the whole shortcut
map. Bring the in-app help overlay up to date with every binding, including the
Alt-prefixed ones it currently omits.
**Files:** `www/src/systems.js` (shortcut table, focus-guard), `www/src/rendering.js` (help overlay), `tests/`
**Depends on:** nothing from earlier sessions; run 4.A before 4.B (below) since 4.B
labels the final shortcut set this WG produces.

### WG 4.B — Screen-Reader ARIA & Real Accessibility Tests (MID–HIGH tier)

**Closes:** H1, M3, L3
**Goal:** Add `aria-keyshortcuts` to every control that has a keyboard binding
(reference the finalized set from 4.A). Put the search result count in an
`aria-live` region so it's actually announced. Rewrite the accessibility test suite
so it exercises real behavior — simulated focus trapping, live-region
announcements, keyboard operability — instead of asserting that CSS variables and
method names exist as strings.
**Files:** `www/index.html`, `www/app.js` (search result rendering), `tests/accessibility-api.test.js`
**Depends on:** WG 4.A (needs the final shortcut list to label correctly).

### WG 4.C — UI Copy & Affordances (CHEAP tier)

**Closes:** M1, M2, M21, L1
**Goal:** Keep an add-card affordance visible even once a list has cards (not just
in the empty state). Replace "dataset"-flavored internal vocabulary in
user-facing copy ("Select dataset(s)," raw storage keys, "Storage: LocalStorage")
with plain language, and while you're touching that copy, adjust the
multi-dataset/vault language so it can't be mistaken for a team-workspace feature
(it isn't one). Add a visible Redo button next to the existing Undo button.
**Files:** `www/src/rendering.js`, `www/index.html`, `www/src/data.js` (labels only — don't rename internal keys/APIs)
**Depends on:** nothing; good cheap-tier task, fully independent of 4.A/4.B.

### WG 4.D — Storage-Driver Registry Decision (MID–HIGH tier)

**Closes:** M22
**Goal:** This one's a judgment call, not a mechanical fix: either wire the host
app's actual storage construction in `storage.js` through the existing
`StorageDriverRegistry` (so it stops being a documented-but-unused extension
point), or — if that's more refactor than the payoff justifies right now — leave it
unwired but stop calling it "experimental" and instead document plainly what it
would take for a plugin author to actually use it. Either answer is fine; what
shouldn't stand is the current state where the docs and the code disagree about
whether it's live.
**Files:** `www/src/storage.js`, `www/src/core/storage-driver-registry.js`, `docs/`
**Depends on:** nothing; independent of the other three WGs in this session.

---

## Session 5 — Mobile, Visual Accessibility & Help

This session closes last because WG 5.C documents the end state of everything
built in Sessions 1–4 — it needs the finished feature set as its input.

### WG 5.A — Typography & Visual Accessibility (CHEAP tier)

**Closes:** H2, M4, M5
**Goal:** Bundle an actual OpenDyslexic (or similarly credible open dyslexia-friendly
typeface) font file via `@font-face` so the "dyslexia-friendly" preset delivers what
it claims, instead of silently falling back to a generic sans-serif on most
platforms. Replace the 4 fixed typography presets with continuous font-size
scaling. Fix the `--text-ghost` contrast value so card-count text clears WCAG AA.
**Files:** `www/styles.css`, `www/src/data.js` (typography settings)
**Depends on:** nothing at all, in any session — this is the one workgroup in the
whole plan with zero file overlap anywhere else. If you want to parallelize instead
of running sessions strictly in order, this is the safe one to peel off and run
anytime.

### WG 5.B — Mobile Storage & True Offline-First (MID tier)

**Closes:** M9, M10, L5, L14
**Goal:** Validate (or add a safe fallback for) the native Filesystem driver's
`Directory.Documents` assumption against Android scoped-storage rules. Since the
Android/iOS platform folders aren't committed to the repo, capture whatever
manifest permissions the Filesystem plugin needs somewhere durable (a checked-in
config snippet or a documented post-`cap add` step) so they can't silently regress
on a fresh platform generation. Fix the import-dialog copy that assumes a mouse
("drag & drop") on touch builds. Per your note — **this app should always be usable
offline, first launch, second launch, last launch** — audit the offline path end to
end: for the packaged Capacitor app, assets are bundled locally and should need zero
network ever; for the browser/PWA install path, make sure the service worker
precaches the full shell on the very first page load rather than requiring a prior
successful online visit, and add a cold-start-offline test for both.
**Files:** `www/src/storage.js` (`LocalFileDriver`), `docs/guides/README.CAPACITOR.md`, `www/index.html`, `www/service-worker.js`, `www/offline-status.js`
**Depends on:** nothing from earlier sessions; independent of 5.A.

### WG 5.C — Onboarding & Help Overhaul (CHEAP–MID tier)

**Closes:** L2
**Goal (as you specified it):** Bring all in-app material up to date and make it
extensive: the first-run onboarding flow, an optional walkthrough dataset a new
user can explore (sample cards demonstrating nesting, links, tags), a complete
keyboard-shortcuts reference (pulling from whatever WG 4.A finalized), and a help
tab that goes in depth on every feature — including the new import/export outline
language from Session 2 and the plugin trust flow from Session 3.
**Files:** `www/src/systems.js` (onboarding modal), `www/src/rendering.js` (help tab), new sample-dataset content
**Depends on:** run this **last, after everything else in the plan is merged** — it
is the only workgroup in this plan whose correctness depends on the final state of
every other session (accurate shortcut list, accurate description of the import
language, accurate description of the plugin install flow).

---

## If you want to parallelize instead of running 1→5 in strict order

Only two things in this plan have zero file overlap with anything else and are safe
to hand to an agent at any point, independently of session order:

- **WG 5.A** (typography/CSS) — touches only `styles.css` and typography settings.
- **WG 3.C** (example loader cleanup) — touches only the one example file.

Everything else has at least one real sequencing dependency noted above (mostly:
don't let two workgroups edit `storage.js`, `data.js`, or the rich-text renderer at
the same time without one clearly landing first).
