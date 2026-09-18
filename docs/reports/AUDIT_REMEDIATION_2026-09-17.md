# CardSpoke audit and remediation record

Date: 2026-09-17 (America/Chicago)
Baseline: abc9bd1e57493017a922caef789e596d11e43ab4, version 0.21.0, schema 4
Proposed version: 0.21.1, schema 4

## Outcome

The review found significant data-integrity and plugin-boundary defects that were not detected by the baseline unit suite. This branch fixes verified defects, adds targeted regression coverage, corrects the plugin trust promise, updates dependencies, and aligns the public documentation with the implementation. It is a reviewable patch, not a deployment or an independent security certification.

## Changes

| Area | Result |
|---|---|
| Card state ownership | Refresh the kernel before shell mutations and tag reads so reload/import/undo changes survive later operations. |
| Save ordering | Serialize snapshots and encryption; cancel obsolete writes; block switching on a failed flush. |
| Save acknowledgement | Await selected secondary storage and IndexedDB transaction commit; retain pending changes after failure. |
| Restore precedence | Preserve a valid LocalStorage primary instead of replacing it with a potentially stale IndexedDB mirror. Await local-file loading. |
| RPC dispatch | Limit dispatch to explicitly exported own methods and preserve prototype-shaped input as inert data. |
| Plugin UI | Reject active elements, unsafe URLs and string event handlers; replace event listeners on update. |
| Worker lifecycle | Terminate initialization failures and deadline failures; disable common ambient capabilities on prototypes too. |
| Trust controls | Require plugin-code consent for package JavaScript and document the limits of same-origin worker isolation. |
| Plugin ownership | Prevent one worker plugin from unregistering another plugin's component; catch async event rejections. |
| Kernel integrity | Deep-copy nested metadata, prevent unknown-parent operations and bound cyclic deletion/duplication. |
| CSV export | Quote all fields, preserve multiline body text and guard formula-like text. |
| Offline cache | Restrict non-navigation caching to declared app-shell URLs. |
| Mobile navigation | Open a newly navigated card at the top rather than retaining the editor's scroll offset. |
| Dependencies | Update five vulnerable transitive packages; npm audit reports zero findings. |
| Release guidance | Declare Node 20.19+ or 22.12+, align version metadata, replace obsolete browser plugin fixtures, expand tests. |

## Verification

Environment: Windows, Node 24.14.1, npm 11.11.0, Playwright Chromium.

- Baseline unit suite: 407/407 passing.
- Baseline browser release checks: 68/70 passing; two obsolete plugin scenarios failed.
- Final unit suite: 423/423 passing across 35 test files.
- Final browser suite: 95/95 passing across 20 scenarios.
- Production build and static release smoke checks: passing.
- Dependency audit: five high-severity package entries before; zero afterward. This is package-advisory status, not proof of browser exploitability or absence of vulnerabilities.
- Android platform generation and sync: passing. No emulator, device, APK, or signed release test was performed.
- Standalone file URL: core create/save/reload passed. HTTP worker-based JavaScript plugins are not certified for file URL use.
- Offline HTTP reload: app shell and local cards available after service-worker installation.
- Viewports: 360, 768 and 1440 pixels; no horizontal overflow in the exercised card view. The final screenshots were reviewed.
- A 1000-card synthetic search found its target. A single local run measured 52 ms from Enter to the result grid; this is a smoke observation, not a benchmark or latency guarantee.

## Compatibility and remaining limits

Schema 4 and package formats are retained. Existing JavaScript plugins prompt for the new plugin-code trust grant at next enable. CSS-only themes are unaffected. Plugins that attempt active HTML elements or unsafe vnode attributes now fail validation. CSV cells resembling formulas receive a leading apostrophe; use JSON for lossless backup.

A same-origin worker is not a complete hostile-code sandbox. Dynamic import remains available, and an HTTP worker does not inherit the page's meta CSP. Trust consent is the mitigation in this patch; separate-origin execution and a worker response CSP remain future architecture work. Card reads and middleware are available to trusted plugins. Do not advertise untrusted plugin execution as safe.

LocalStorage remains the primary store and therefore remains a quota bottleneck. Whole-store serialization and kernel snapshots have scaling costs. The 1000-card smoke does not establish large-vault or low-end-device capacity. Native Android execution, iOS, Firefox, Safari, screen-reader use, exhaustive contrast verification, encrypted export, concurrent-tab merge and deployment infrastructure were not certified. Existing product scope excludes hosted collaboration and cloud sync.

## Follow-up priorities

1. Use a single authoritative card-state owner and incremental persistence; preserve the regression suite during that refactor.
2. Design separate-origin plugin execution and worker response policies before making a stronger sandbox claim.
3. Add repeated device/browser performance and assistive-technology testing, including large and deep datasets.
4. Add a trusted pull-request validation workflow before merging; the current Pages QA runs on main pushes and manual dispatch using self-hosted runners. Do not expose those runners to arbitrary public pull-request code.
5. Improve mobile information density and distinguish Edit from secondary actions. Validate these design changes with users rather than silently redesigning this audit patch.

References: [worker CSP behavior](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy), [Vite 7 Node support](https://vite.dev/blog/announcing-vite7). Runtime source and the current test scripts remain authoritative.
