# Advanced CardSpoke plugin collection

Nine independently installable JSON packages: three per layer. Version 1.0.0; host baseline CardSpoke 0.21.1/schema 4 with the rendering fixes accompanying this collection. The original nine introductory samples remain available separately.

Open CardSpoke → Plugin Manager → Install → select a JSON below. Themes enable immediately. Features ask for consent. App packages install suspended: explicitly enable them. Use one theme at a time; all six JavaScript packages can coexist. The packages are local-only and request no network/filesystem access.

| Package | Level | Capabilities |
| --- | --- | --- |
| [Paper Atlas](themes/paper-atlas.json) | Theme | Editorial palette, reading rhythm, card lift, pill tags, light/dark, mobile, reduced motion, forced colors, print. |
| [Nocturne Console](themes/nocturne-console.json) | Theme | Analytical cards, code styling, strong focus, grid accents, light/dark, mobile, print. |
| [Clear Harbor](themes/clear-harbor.json) | Theme | Calm palettes, large interaction targets, coarse-pointer rules, responsive cards, focus and print. |
| [Knowledge Audit](features/knowledge-audit.json) | Feature | Duplicate titles, empty bodies, missing/ambiguous links, issue/all filters, tile badges. |
| [Smart Collections](features/smart-collections.json) | Feature | Compound text/tag filters, title/recent sorting, saved collections, configurable result cap. |
| [Batch Workbench](features/batch-workbench.json) | Feature | Preview up to 100 title/tag edits, fresh-card conflict checks, partial-result reporting, undo that skips changed cards. |
| [Project Planner](apps/project-planner.json) | App | Multiple project trees, child tasks, three status lanes, dependency checks, deadlines, overdue flags and progress. |
| [Study Studio](apps/study-studio.json) | App | Create flashcards, reveal answers, due queue, Again/Good scheduling, review/lapse counts, schedule reset. |
| [Research Desk](apps/research-desk.json) | App | Validate/deduplicate source URLs, child excerpts with notes, source links, repeatable synthesis into a single child card. |

JavaScript plugins add a named header button. Click it to open an inline panel. Refresh reads current cards without automatically replacing a form while you type; Close removes the panel. Actions show errors as toasts. There are no implicit card writes on install or enable. Project, study, and research controls write only after explicit user actions.

## Data and permissions

All JavaScript packages request `ui-override`. Knowledge Audit and Smart Collections also request `storage`; they store settings/collections under their own plugin namespaces. These preferences are shared across datasets on the same origin. They are not promised to travel in dataset exports or be erased on removal.

Batch Workbench and the three apps request `data-modify`. Project/review/source metadata lives in `card.modsData['lab-<name>']` with `schema: 1`, so it follows dataset JSON exports. Project cards use `lab-project` and `lab-task`; study uses `lab-study`; research uses `lab-source`, `lab-excerpt`, `lab-synthesis`. Other tags/metadata are preserved when editing.

Batch undo is session-local and disappears on suspension/reload. It restores only cards matching the post-edit content signature; it is not an atomic transaction across multiple tabs. Title changes use the core rename operation and may also rewrite incoming `[[Title]]` links. Back up important data before large edits. A failed sequence can leave earlier successful changes; inspect the result rather than assuming rollback.

Study intervals are intentionally simple: Good starts at one day and doubles up to 365 days; Again schedules a retry after one minute. Reset clears that card's schedule/review counters. This is an example algorithm, not a claim of validated learning efficacy.

Research Desk records URLs as text and never fetches a page. Synthesis compiles the user's excerpts and notes; it does not call an AI model or invent a summary. Rebuilding replaces the plugin's synthesis body, so keep manually edited synthesis prose in a separate card.

## Suspend, remove, rollback

Suspend removes styles/controls and terminates workers. Removing additionally deletes the installed package and revokes its grants. Created cards, card metadata, and stored preferences remain. Delete unwanted cards through the host UI, reset study schedules through Study Studio, and delete saved filters through Smart Collections. To roll back a package, reinstall a saved earlier JSON with the same ID. For a broken startup use `?safemode`.

## Development and verification

Edit readable files in [src](src), then run:

```sh
npm run plugins:build
npm run plugins:check
npm run build
npm test
npm run smoke
npm run qa:plugins
npm run qa:browser
```

The builder includes `shared.js` and `shared.css` in every relevant JSON. They are build inputs, not dependencies users must install. The collection's separate `manifest.json` is a local index; packages are not advertised in the hosted gallery before their branch is published/merged.

Browser tests drive real consent dialogs, actual workers, persisted packages, user controls, narrow layouts, and cleanup. See the [verification report](../../docs/reports/ADVANCED_PLUGIN_VERIFICATION.md). For a guide that can be handed to someone without this repository, use the [standalone authoring guide](../../docs/guides/PLUGIN_AUTHORING_GUIDE.md).

## Known bounds

Panels display bounded lists; Knowledge Audit scans all cards but displays at most 200 results. Smart Collections supports at most 50 saved definitions and a configurable 1–500 result cap. Batch Workbench rejects more than 100 matches. Study/research lists display at most 100 entries; aggregate calculations still use the full matching set. Task dependencies are chosen from existing tasks in the same project; there is no dependency graph editor or drag-and-drop interface. Mutations are serialized within each worker, not across tabs. JavaScript worker execution was tested over localhost in Chromium, not every browser/native shell or direct file URLs.
