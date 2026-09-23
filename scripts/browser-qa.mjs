/*
 * Copyright 2026 Jeffrey Guntly (JX Holdings, LLC)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Browser-level release QA for CardSpoke.
 *
 * Drives the real built app (www/) in headless Chromium and verifies the
 * release-blocking flows end to end:
 *
 *   1. create/save/reload with an honest "Saved" status        (CS-003)
 *   2. encrypted dataset unlock — wrong PIN, right PIN, save   (CS-001)
 *   3. locked dataset: writes blocked, envelope untouched       (CS-001)
 *   4. corrupt storage: quarantine + recovery, no overwrite     (CS-004)
 *   5. instance import: cards/plugins/bookmarks/theme restore   (CS-005)
 *   6. plugin full-trust consent + enable/remove                (CS-002)
 *   7. dataset create (PIN) / list / switch / search-all        (NEW-2/3/4)
 *   8. dialog accessibility contract + Escape behavior          (CS-008/NEW-1)
 *   9. rich-text XSS payload stays inert
 *  10. 360px mobile layout has no horizontal overflow
 *  11. header/menu/upload-modal a11y: theme label, Option+T, focus return,
 *      tab semantics, keyboard + drag-and-drop upload, scroll unlock
 *
 * Requirements (CS-102 — reproducible from a clean checkout):
 *   npm ci                                   (playwright is a pinned devDependency)
 *   npx playwright install --with-deps chromium   (or reuse an existing binary
 *   via CHROMIUM_PATH / PLAYWRIGHT_BROWSERS_PATH)
 *
 * Usage: node scripts/browser-qa.mjs
 */

import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname, extname, join, normalize } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { chromium } from 'playwright-core';
import { encryptStorePayload, isEncryptedEnvelope, decryptStorePayload } from '../www/src/core/dataset-crypto.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = resolve(ROOT, 'www');
const ART_DIR = process.env.QA_ARTIFACT_DIR || resolve(ROOT, 'qa-artifacts');
// Explicit binary overrides first; otherwise leave undefined so playwright
// resolves the chromium it installed via `npx playwright install chromium`.
const EXECUTABLE = (() => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const candidate = join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium');
    if (existsSync(candidate)) return candidate;
  }
  if (existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  return undefined;
})();

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png'
};

function startServer() {
  return new Promise(res => {
    const server = createServer((req, resp) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = normalize(join(WWW, urlPath === '/' ? 'index.html' : urlPath));
      if (!file.startsWith(WWW) || !existsSync(file)) {
        resp.writeHead(404); resp.end('not found'); return;
      }
      resp.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      resp.end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => res(server));
  });
}

// ── tiny assertion/reporting harness ──────────────────────────────────────
const results = [];
let currentScenario = '';
let scenarioFailed = false;

function check(label, ok, detail = '') {
  const line = `${ok ? '  ok ' : ' FAIL'}  [${currentScenario}] ${label}${!ok && detail ? ' — ' + detail : ''}`;
  console.log(line);
  if (!ok) scenarioFailed = true;
  results.push({ scenario: currentScenario, label, ok, detail });
}

async function scenario(name, fn) {
  currentScenario = name;
  scenarioFailed = false;
  try {
    await fn();
  } catch (err) {
    check('scenario completed without exception', false, err.message + '\n' + (err.stack || ''));
  }
  console.log(scenarioFailed ? `>> ${name}: FAILED\n` : `>> ${name}: passed\n`);
}

// Console noise that is not an app defect (blocked externals in the QA env)
// plus the intentional diagnostic the recovery path logs by design.
const IGNORED_CONSOLE = [
  /favicon/i,
  /raw\.githubusercontent\.com/,
  /Failed to load resource.*(404|net::)/,
  /ERR_(TUNNEL|PROXY|NAME|INTERNET|CONNECTION)/,
  /Failed to parse stored data — entering recovery mode/
];

function watchConsole(page, sink) {
  page.on('console', msg => {
    if (msg.type() === 'error' && !IGNORED_CONSOLE.some(re => re.test(msg.text()))) {
      sink.push('console.error: ' + msg.text());
    }
  });
  page.on('pageerror', err => sink.push('pageerror: ' + err.message));
}

// offline-status.js rewrites the indicator to "Saved locally" — accept both.
const waitSaved = page => page.waitForFunction(
  () => /^Saved( locally)?$/.test(document.getElementById('saveStatus')?.textContent || ''),
  null, { timeout: 8000 });

// The save-status text next to the header buttons reflows as it cycles
// Saving→Saved→'', which can keep #menuBtn just-barely-in-motion and trip
// Playwright's stability gate. The button itself is fine, so open the menu
// with force after clearing the status.
async function openMenu(page) {
  await page.evaluate(() => { const s = document.getElementById('saveStatus'); if (s) s.textContent = ''; });
  await page.click('#menuBtn', { force: true });
  await page.waitForSelector('#menuOverlay.show', { timeout: 8000 });
}

async function createCardViaUI(page, title, body = '') {
  // Reset the save indicator first so waitSaved() observes THIS save, not a
  // stale "Saved locally" left over from a previous write (the offline
  // helper leaves the text set for ~1s).
  await openMenu(page);
  await page.click('#menuNewCard');
  await page.waitForSelector('#cardTitle');
  await page.fill('#cardTitle', title);
  if (body) await page.fill('#cardBody', body);
  await page.click('form button[type=submit]');
  // The card exists in the store synchronously; then wait for it to persist.
  await page.waitForFunction(
    t => Object.values(window.store.cards).some(c => c.title === t),
    title, { timeout: 8000 });
  await waitSaved(page);
}

// Card creation navigates to the read view; the list page (where the search
// bar and card tiles live) is reached via the Home button. The save-status
// text next to the header buttons resizes as it cycles Saving→Saved→'',
// nudging #homeBtn enough to fail Playwright's stability gate — so clear it
// and use force to skip the stability wait.
async function goHome(page) {
  await page.evaluate(() => { const s = document.getElementById('saveStatus'); if (s) s.textContent = ''; });
  await page.click('#homeBtn', { force: true });
  await page.waitForSelector('#searchInput', { state: 'visible', timeout: 8000 });
  await page.waitForSelector('#main .card-tile, #main .empty', { timeout: 8000 }).catch(() => {});
}

// ── main ──────────────────────────────────────────────────────────────────
const server = await startServer();
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
mkdirSync(ART_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: EXECUTABLE });

async function freshPage(errors, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } });
  // Suppress the first-run "Welcome to CardSpoke!" onboarding modal, which
  // otherwise pops 500ms after boot and intercepts clicks mid-scenario. It is
  // covered by its own scenario; every other flow starts past onboarding.
  // addInitScript runs before page scripts on every load/reload.
  if (!opts.keepOnboarding) {
    await context.addInitScript(() => {
      try { localStorage.setItem('cardspoke_hasSeenGettingStarted', 'true'); } catch (e) {}
    });
  }
  const page = await context.newPage();
  watchConsole(page, errors);
  return { context, page };
}

// 1 ─ Core save/reload with honest status (CS-003) ─────────────────────────
await scenario('core-save-reload (CS-003)', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  await page.goto(BASE);
  await page.waitForSelector('#main');

  await createCardViaUI(page, 'QA Card One', 'first body');
  check('save status reads "Saved" (not "Save failed")', true);
  const errToast = await page.$('.toast.error');
  check('no error toast after save', !errToast);

  await page.reload();
  await page.waitForSelector('#main');
  const persisted = await page.evaluate(() =>
    Object.values(window.store.cards).some(c => c.title === 'QA Card One'));
  check('card persists across reload', persisted);
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 2 ─ Encrypted dataset unlock (CS-001) ────────────────────────────────────
const PIN = '2468';
const pinKey = 'cards_qa_pin_1';
const encryptedFixture = await encryptStorePayload(JSON.stringify({
  rootOrder: ['enc1'],
  cards: { enc1: { id: 'enc1', title: 'Encrypted Card', body: 'secret body', parentId: null, children: [], tags: [], kind: 'note', modsData: {} } },
  plugins: {}, bookmarks: [], recentCards: [], viewMode: 'normal', activeTheme: 'light',
  metadata: { name: 'QA PIN Vault', storageType: 'localstorage', storageConfig: {}, createdAt: 1 }
}), PIN);

await scenario('encrypted-dataset-unlock (CS-001)', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  await page.goto(BASE);
  await page.waitForSelector('#main');
  await page.evaluate(([key, envelope]) => {
    localStorage.setItem('activeInstance', key);
    localStorage.setItem(key, envelope);
  }, [pinKey, encryptedFixture]);

  await page.reload();
  const pinInput = await page.waitForSelector('.modal input[type=password]', { timeout: 8000 });
  check('unlock dialog appears before any store parse', !!pinInput);

  // Wrong PIN: dialog persists, envelope untouched
  await pinInput.fill('9999');
  await page.click('.modal-actions button.btn-primary');
  const retryInput = await page.waitForSelector('.modal input[type=password]', { timeout: 8000 });
  check('wrong PIN re-prompts instead of proceeding', !!retryInput);
  let stored = await page.evaluate(k => localStorage.getItem(k), pinKey);
  check('envelope unchanged after wrong PIN', stored === encryptedFixture);

  // Correct PIN: data restored
  await retryInput.fill(PIN);
  await page.click('.modal-actions button.btn-primary');
  await page.waitForFunction(() =>
    window.store && Object.values(window.store.cards).some(c => c.title === 'Encrypted Card'),
    null, { timeout: 8000 });
  check('correct PIN restores the encrypted cards', true);

  // A save through the session PIN must stay encrypted and keep the data.
  await createCardViaUI(page, 'Added After Unlock');
  // Poll the persisted envelope until it reflects the new card (the encrypted
  // write goes through requestIdleCallback, so give it a beat to land).
  let titles = [];
  let parsedStored = null;
  for (let i = 0; i < 20; i++) {
    stored = await page.evaluate(k => localStorage.getItem(k), pinKey);
    parsedStored = JSON.parse(stored);
    if (isEncryptedEnvelope(parsedStored)) {
      titles = Object.values(JSON.parse(await decryptStorePayload(stored, PIN)).cards).map(c => c.title);
      if (titles.includes('Added After Unlock')) break;
    }
    await page.waitForTimeout(150);
  }
  check('dataset stays encrypted after new save', isEncryptedEnvelope(parsedStored));
  check('re-encrypted payload contains old + new cards',
    titles.includes('Encrypted Card') && titles.includes('Added After Unlock'), titles.join(','));
  check('PIN never appears in persisted payload', !stored.includes(PIN));
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 3 ─ Declining unlock locks writes (CS-001) ───────────────────────────────
await scenario('locked-dataset-blocks-writes (CS-001)', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  await page.goto(BASE);
  await page.waitForSelector('#main');
  await page.evaluate(([key, envelope]) => {
    localStorage.setItem('activeInstance', key);
    localStorage.setItem(key, envelope);
  }, [pinKey, encryptedFixture]);

  await page.reload();
  await page.waitForSelector('.modal input[type=password]');
  // "Not now" is the non-primary action in the prompt dialog
  await page.click('.modal-actions button.btn:not(.btn-primary)');
  await page.waitForSelector('#datasetLockScreen', { timeout: 8000 });
  check('lock screen shown after declining unlock', true);

  // Attempt a write through the public API — must not touch the envelope
  await page.evaluate(() => window.CardSpoke.utils.createCard({ title: 'should-not-persist' }));
  await page.waitForTimeout(1200); // longer than the save debounce
  const stored = await page.evaluate(k => localStorage.getItem(k), pinKey);
  check('envelope byte-identical while locked', stored === encryptedFixture);
  const status = await page.evaluate(() => document.getElementById('saveStatus').textContent);
  check('save status reports the locked state', /locked/i.test(status), status);

  // Escape must NOT dismiss the lock screen
  await page.keyboard.press('Escape');
  check('lock screen not dismissable via Escape', !!(await page.$('#datasetLockScreen')));

  // Unlock from the lock screen works
  await page.click('#datasetLockScreen button.btn-primary');
  const pinInput = await page.waitForSelector('.modal input[type=password]');
  await pinInput.fill(PIN);
  await page.click('.modal-actions button.btn-primary');
  await page.waitForFunction(() =>
    Object.values(window.store.cards).some(c => c.title === 'Encrypted Card'), null, { timeout: 8000 });
  check('unlock from lock screen restores data', true);
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 4 ─ Corrupt storage quarantine + recovery (CS-004) ───────────────────────
await scenario('corrupt-storage-recovery (CS-004)', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  const corruptKey = 'cards_qa_corrupt';
  const corruptPayload = '{"cards": {"a": TRUNCATED';
  await page.goto(BASE);
  await page.waitForSelector('#main');
  await page.evaluate(([key, payload]) => {
    localStorage.setItem('activeInstance', key);
    localStorage.setItem(key, payload);
  }, [corruptKey, corruptPayload]);

  await page.reload();
  await page.waitForSelector('#corruptRecoveryScreen', { timeout: 8000 });
  check('recovery screen shown for unreadable data', true);

  const state = await page.evaluate(k => ({
    original: localStorage.getItem(k),
    quarantine: Object.keys(localStorage).filter(x => x.startsWith(k + '.corrupt.'))
  }), corruptKey);
  check('original payload untouched', state.original === corruptPayload);
  check('quarantine copy created', state.quarantine.length === 1, state.quarantine.join(','));

  // Explicit "Start fresh" is the only way to overwrite
  await page.click('#corruptRecoveryScreen button.btn-danger');
  await page.waitForSelector('.modal-actions');
  await page.click('.modal-actions button.btn-danger');
  await page.waitForFunction(() => !document.getElementById('corruptRecoveryScreen'), null, { timeout: 8000 });
  await waitSaved(page);
  const after = await page.evaluate(([k]) => ({
    active: localStorage.getItem(k),
    quarantine: Object.keys(localStorage).filter(x => x.startsWith(k + '.corrupt.'))
  }), [corruptKey]);
  check('start-fresh writes a valid store', (() => { try { return !!JSON.parse(after.active).cards; } catch { return false; } })());
  check('quarantine copy survives the reset', after.quarantine.length === 1);
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 5 ─ Instance import restores everything (CS-005) ─────────────────────────
await scenario('instance-import-round-trip (CS-005)', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  await page.goto(BASE);
  await page.waitForSelector('#main');

  const fixture = {
    exportType: 'instance', formatVersion: 2, appVersion: '0.18.0', schemaVersion: 4, timestamp: 1,
    cards: {
      p1: { id: 'p1', title: 'Imported Parent', body: 'see [[Imported Child]]', parentId: null, children: ['c1'], tags: ['imported'], kind: 'note', modsData: {} },
      c1: { id: 'c1', title: 'Imported Child', body: 'child body', parentId: 'p1', children: [], tags: [], kind: 'note', modsData: {} }
    },
    rootIds: ['p1'],
    plugins: {
      'qa-badge': {
        definition: {
          manifest: { id: 'qa-badge', name: 'QA Badge', version: '1.0.0', author: 'QA', layer: 'feature', permissions: [] },
          css: null, js: "ctx.logger.info('qa badge ready');", teardownJs: null
        },
        enabled: false
      }
    },
    bookmarks: ['c1'], recentCards: ['p1'], viewMode: 'compact', activeTheme: 'dark',
    metadata: { name: 'QA Import Fixture' }
  };

  await openMenu(page);
  await page.click('#menuUpload');
  await page.waitForSelector('#uploadModal.show, .modal-overlay.show #fileInputJSON, #fileInputJSON', { timeout: 8000 });
  await page.setInputFiles('#fileInputJSON', {
    name: 'qa-instance.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture))
  });

  // Plugin security confirm (real dialog — NEW-1 in action)
  const importBtn = await page.waitForSelector('.modal-actions button.btn-danger', { timeout: 8000 });
  check('plugin import warning dialog appears', !!importBtn);
  await importBtn.click();
  await waitSaved(page);

  const snap = await page.evaluate(() => {
    const cards = Object.values(window.store.cards);
    const byTitle = t => cards.find(c => c.title === t);
    const parent = byTitle('Imported Parent');
    const child = byTitle('Imported Child');
    return {
      parentOk: !!parent, childOk: !!child,
      hierarchyOk: !!(parent && child && child.parentId === parent.id && parent.children.includes(child.id)),
      bookmarkOk: !!(child && window.store.bookmarks.includes(child.id)),
      recentOk: !!(parent && window.store.recentCards.includes(parent.id)),
      pluginShapeOk: !!(window.store.plugins['qa-badge'] && window.store.plugins['qa-badge'].definition &&
        typeof window.store.plugins['qa-badge'].definition.js === 'string'),
      pluginRegistered: !!(window.CardSpoke.Plugin.get('qa-badge')),
      viewMode: window.store.viewMode,
      theme: window.store.activeTheme,
      darkApplied: document.documentElement.classList.contains('dark')
    };
  });
  check('cards + hierarchy imported', snap.parentOk && snap.childOk && snap.hierarchyOk);
  check('bookmarks remapped to new IDs', snap.bookmarkOk);
  check('recent cards remapped', snap.recentOk);
  check('plugin restored in runnable {definition} shape', snap.pluginShapeOk);
  check('plugin registered with runtime after import', snap.pluginRegistered);
  check('view mode restored', snap.viewMode === 'compact', snap.viewMode);
  check('theme restored and applied', snap.theme === 'dark' && snap.darkApplied);
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 6 - Plugin trust and worker UI lifecycle
await scenario('plugin-worker-consent', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  await page.goto(BASE);
  await page.waitForSelector('#main');
  await page.evaluate(async () => {
    window.store.plugins['qa-badge'] = {
      definition: {
        manifest: { id: 'qa-badge', name: 'QA Badge', version: '1.0.0', author: 'QA', layer: 'feature', permissions: ['ui-override'] },
        js: "await ctx.api.ui.inject('.header', ctx.h('span', { id: '__qaBadge' }, 'QA active'));"
      }, enabled: false
    };
    window.save(true);
    await window.CardSpoke.Plugin.syncFromStore();
  });
  await openMenu(page);
  await page.click('#menuPluginManager');
  await page.click('.modal-overlay.show .btn:has-text("Enable")');
  const dialog = await page.waitForSelector('.permission-modal [role=dialog]');
  check('consent explains worker isolation limitations', /not a complete security sandbox/.test(await dialog.textContent()));
  await page.click('.permission-modal button.btn-secondary');
  await page.waitForTimeout(150);
  check('declining consent leaves plugin disabled and UI untouched', await page.evaluate(() => !window.CardSpoke.Plugin.get('qa-badge').enabled && !document.getElementById('__qaBadge')));
  // Denied permission is an expected diagnostic, not a runtime failure.
  errors.length = 0;
  await page.click('.modal-overlay.show .btn:has-text("Enable")');
  await page.waitForSelector('.permission-modal [role=dialog]');
  await page.click('.permission-modal button.btn-primary');
  await page.waitForFunction(() => window.CardSpoke.Plugin.get('qa-badge').enabled && document.getElementById('__qaBadge'));
  check('accepted worker plugin renders through vnode API', true);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('nested_cards_store')).plugins['qa-badge'].enabled);
  await page.reload();
  await page.waitForSelector('#__qaBadge');
  check('reload restores exactly one plugin element', await page.locator('#__qaBadge').count() === 1);
  await page.evaluate(() => window.CardSpoke.Plugin.disable('qa-badge'));
  check('suspend removes plugin UI', await page.locator('#__qaBadge').count() === 0);
  check('no unexpected console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 6b ─ Plugin survives a dataset round-trip (reconcile teardown) ────────────
await scenario('plugin-dataset-round-trip (NEW-4/reconcile)', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  await page.goto(BASE);
  await page.waitForSelector('#main');

  // Seed: default dataset has a trusted, enabled JS plugin that appends a
  // header marker; a second empty dataset has no plugins. Trust is pre-granted
  // so enabling never prompts.
  await page.evaluate(() => {
    localStorage.setItem('cardspoke_plugin_permissions', JSON.stringify({ 'ds-marker': ['plugin-code', 'ui-override'] }));
    const pluginEntry = {
      definition: {
        manifest: { id: 'ds-marker', name: 'DS Marker', version: '1.0.0', author: 'QA', layer: 'feature', permissions: ['ui-override'] },
        css: null,
        js: "await ctx.api.ui.inject('.header', ctx.h('span', { id: '__ds_marker' }, 'Dataset marker'));",
        teardownJs: null
      },
      enabled: true
    };
    // Default dataset store + a sibling empty dataset.
    const def = JSON.parse(localStorage.getItem('nested_cards_store') || '{}');
    def.cards = def.cards || {}; def.rootOrder = def.rootOrder || [];
    def.plugins = { 'ds-marker': pluginEntry };
    localStorage.setItem('nested_cards_store', JSON.stringify(def));
    localStorage.setItem('cards_empty_vault_1', JSON.stringify({
      rootOrder: [], cards: {}, plugins: {}, bookmarks: [], recentCards: [],
      viewMode: 'normal', activeTheme: 'light', metadata: { name: 'Empty Vault' }
    }));
    localStorage.setItem('activeInstance', 'nested_cards_store');
  });

  await page.reload();
  await page.waitForSelector('#main');
  await page.waitForFunction(() => {
    const p = window.CardSpoke.Plugin.get('ds-marker');
    return p && p.enabled === true && !!document.getElementById('__ds_marker');
  }, null, { timeout: 8000 });
  check('plugin enabled and its effect present in default dataset', true);

  // Switch to the empty dataset via the Dataset Manager (invokes reconcile).
  await openMenu(page);
  await page.click('#menuDataHub');
  await page.waitForSelector('.modal-overlay.show .btn:has-text("Switch Dataset")');
  await page.click('.modal-overlay.show .btn:has-text("Switch Dataset")');
  await page.waitForSelector('#newDatasetName');
  await page.click('.modal-overlay.show .btn-primary:has-text("Open")'); // Open the empty vault
  await page.waitForFunction(() =>
    localStorage.getItem('activeInstance') === 'cards_empty_vault_1', null, { timeout: 8000 });
  await page.waitForFunction(() => !window.CardSpoke.Plugin.get('ds-marker') && !document.getElementById('__ds_marker'));
  const afterSwitch = await page.evaluate(() => ({
    inRuntime: !!window.CardSpoke.Plugin.get('ds-marker'),
    markerPresent: !!document.getElementById('__ds_marker')
  }));
  check('plugin torn down from runtime on switch to a dataset without it', !afterSwitch.inRuntime);
  check('plugin DOM effect cleaned up on switch', !afterSwitch.markerPresent);

  // Switch back to default — the plugin must re-register AND re-enable (this is
  // the exact case the disable()-only reconcile got stuck on), no re-prompt.
  await openMenu(page);
  await page.click('#menuDataHub');
  await page.waitForSelector('.modal-overlay.show .btn:has-text("Switch Dataset")');
  await page.click('.modal-overlay.show .btn:has-text("Switch Dataset")');
  await page.waitForSelector('#newDatasetName');
  await page.click('.modal-overlay.show .btn-primary:has-text("Open")'); // Open default again
  await page.waitForFunction(() =>
    localStorage.getItem('activeInstance') === 'nested_cards_store', null, { timeout: 8000 });
  await page.waitForFunction(() => {
    const p = window.CardSpoke.Plugin.get('ds-marker');
    return p && p.enabled === true && !!document.getElementById('__ds_marker');
  }, null, { timeout: 8000 }).catch(() => {});
  const afterReturn = await page.evaluate(() => ({
    enabled: !!(window.CardSpoke.Plugin.get('ds-marker') && window.CardSpoke.Plugin.get('ds-marker').enabled),
    markerPresent: !!document.getElementById('__ds_marker'),
    markerCount: document.querySelectorAll('#__ds_marker').length,
    dialog: !!document.querySelector('.permission-modal')
  }));
  check('plugin re-enabled after switching back (reconcile fix)', afterReturn.enabled);
  check('plugin effect restored exactly once (no leak/dup)', afterReturn.markerPresent && afterReturn.markerCount === 1);
  check('no re-prompt for the already-trusted plugin', !afterReturn.dialog);
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 7 ─ Dataset create/list/switch/search-all (NEW-2/3/4) ────────────────────
await scenario('dataset-manager-and-multisearch (NEW-2/3/4)', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  await page.goto(BASE);
  await page.waitForSelector('#main');
  await createCardViaUI(page, 'Alpha Base Card', 'lives in default dataset');

  // Open Dataset Manager: menu → Data & Export → Switch Dataset
  await openMenu(page);
  await page.click('#menuDataHub');
  await page.waitForSelector('.modal-overlay.show .btn:has-text("Switch Dataset")');
  await page.click('.modal-overlay.show .btn:has-text("Switch Dataset")');
  await page.waitForSelector('#newDatasetName');

  // CS-105: form labels are programmatically associated with their controls
  const labelWiring = await page.evaluate(() => {
    const wired = id => {
      const label = document.querySelector(`label[for="${id}"]`);
      return !!(label && label.control && label.control.id === id);
    };
    return {
      name: wired('newDatasetName'),
      storage: wired('newDatasetStorage'),
      pin: wired('newDatasetPin'),
      pinConfirm: wired('newDatasetPinConfirm'),
      pinDescribed: (document.getElementById('newDatasetPin') || {})
        .getAttribute?.('aria-describedby') === 'newDatasetPinHelp'
    };
  });
  check('dataset name label wired to its input (CS-105)', labelWiring.name);
  check('storage label wired to its select (CS-105)', labelWiring.storage);
  check('PIN label wired to its input (CS-105)', labelWiring.pin);
  check('PIN confirm label wired to its input (CS-105)', labelWiring.pinConfirm);
  check('PIN input described by its help text (CS-105)', labelWiring.pinDescribed);

  // CS-106: a mismatched PIN confirmation must block creation
  await page.fill('#newDatasetName', 'Mismatch Vault');
  await page.fill('#newDatasetPin', '1234');
  await page.fill('#newDatasetPinConfirm', '4321');
  await page.click('.modal-overlay.show .btn:has-text("+ Create Dataset")');
  await page.waitForTimeout(500);
  const afterMismatch = await page.evaluate(() => ({
    active: localStorage.getItem('activeInstance') || '',
    formStillOpen: !!document.getElementById('newDatasetName')
  }));
  check('mismatched PIN confirmation blocks dataset creation (CS-106)',
    !afterMismatch.active.startsWith('cards_mismatch_vault'));
  check('creation form stays open after PIN mismatch (CS-106)', afterMismatch.formStillOpen);
  await page.fill('#newDatasetPin', '');
  await page.fill('#newDatasetPinConfirm', '');

  // Create an unencrypted second dataset
  await page.fill('#newDatasetName', 'Plain Vault');
  await page.click('.modal-overlay.show .btn:has-text("+ Create Dataset")');
  await page.waitForFunction(() =>
    (localStorage.getItem('activeInstance') || '').startsWith('cards_plain_vault'), null, { timeout: 8000 });
  check('created dataset became active', true);
  // The switch renders the old card's read view (now missing); return to a
  // known list page before the next UI interaction.
  await goHome(page);
  await createCardViaUI(page, 'Beta Vault Card', 'lives in plain vault');

  // NEW-2: both datasets listed in the manager
  await openMenu(page);
  await page.click('#menuDataHub');
  await page.waitForSelector('.modal-overlay.show .btn:has-text("Switch Dataset")');
  await page.click('.modal-overlay.show .btn:has-text("Switch Dataset")');
  await page.waitForSelector('#newDatasetName');
  const listed = await page.evaluate(() => {
    const overlays = document.querySelectorAll('.modal-overlay.show');
    return overlays[overlays.length - 1].textContent;
  });
  check('manager lists the default dataset', listed.includes('nested_cards_store'));
  check('manager lists the created cards_* dataset (NEW-2)', listed.includes('cards_plain_vault'));

  // NEW-4: switch back via Open — must not throw and must reconcile
  await page.click('.modal-overlay.show .btn-primary:has-text("Open")');
  await page.waitForFunction(() =>
    localStorage.getItem('activeInstance') === 'nested_cards_store' &&
    Object.values(window.store.cards).some(c => c.title === 'Alpha Base Card'), null, { timeout: 8000 });
  check('Open switches back to the default dataset (NEW-4)', true);

  // NEW-3: search across all datasets from the default one. The dataset
  // selector lives in the search bar, which is only visible on the list page.
  await goHome(page);
  const options = await page.evaluate(() =>
    Array.from(document.getElementById('datasetSelector').options).map(o => o.value));
  check('dataset selector offers "all" scope', options.includes('all'), options.join(','));
  await page.selectOption('#datasetSelector', 'all');
  await page.fill('#searchInput', 'Vault Card');
  await page.press('#searchInput', 'Enter');
  await page.waitForSelector('.search-result', { timeout: 8000 });
  const resultsText = await page.evaluate(() => document.getElementById('main').textContent);
  check('search-all finds the other dataset\'s card (NEW-3)', resultsText.includes('Beta Vault Card'));

  // Clicking a cross-dataset result switches and opens it
  await page.click('.search-result');
  await page.waitForFunction(() =>
    (localStorage.getItem('activeInstance') || '').startsWith('cards_plain_vault'), null, { timeout: 8000 });
  check('cross-dataset result click switches dataset and opens the card', true);
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 8 ─ Dialog accessibility + Escape stack (CS-008 / NEW-1) ─────────────────
await scenario('dialog-a11y-contract (CS-008/NEW-1)', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  await page.goto(BASE);
  await page.waitForSelector('#main');
  await createCardViaUI(page, 'Delete Me Card');

  // Plugin Manager gets the full dialog contract via the observer
  await openMenu(page);
  await page.click('#menuPluginManager');
  await page.waitForSelector('.modal-overlay.show .modal');
  const a11y = await page.evaluate(() => {
    const modal = document.querySelector('.modal-overlay.show .modal');
    const labelId = modal.getAttribute('aria-labelledby');
    return {
      role: modal.getAttribute('role'),
      ariaModal: modal.getAttribute('aria-modal'),
      labelResolves: !!(labelId && document.getElementById(labelId)?.textContent)
    };
  });
  check('generated modal has role=dialog', a11y.role === 'dialog');
  check('generated modal has aria-modal', a11y.ariaModal === 'true');
  check('aria-labelledby resolves to the visible title', a11y.labelResolves);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.modal-overlay.show'), null, { timeout: 4000 });
  check('Escape closes the generated modal', true);

  // Card delete uses the shared confirm dialog (NEW-1 end-to-end).
  // Card tiles are on the list page — navigate home first.
  await goHome(page);
  await page.click('.card-tile');
  await page.waitForSelector('.btn:has-text("Delete")');
  await page.click('.btn:has-text("Delete")');
  const confirmDialog = await page.waitForSelector('.modal-overlay.show [role=dialog]', { timeout: 8000 });
  check('delete confirm dialog opens (NEW-1: no ReferenceError)', !!confirmDialog);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.modal-overlay.show'), null, { timeout: 4000 });
  const stillThere = await page.evaluate(() =>
    Object.values(window.store.cards).some(c => c.title === 'Delete Me Card'));
  check('Escape cancels the delete', stillThere);

  await page.click('.btn:has-text("Delete")');
  await page.waitForSelector('.modal-overlay.show [role=dialog]');
  await page.click('.modal-actions .btn-danger');
  await page.waitForFunction(() =>
    !Object.values(window.store.cards).some(c => c.title === 'Delete Me Card'), null, { timeout: 8000 });
  check('confirming actually deletes the card', true);
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 8b ─ Header, menu and upload modal accessibility ─────────────────────────
await scenario('header-menu-upload-a11y', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  await page.goto(BASE);
  await page.waitForSelector('#main');

  // Theme toggle: the label names the action, the icon is decorative (#371).
  const themeBefore = await page.evaluate(() => {
    const b = document.getElementById('themeToggle');
    return { label: b.getAttribute('aria-label'), title: b.getAttribute('title'),
      svgHidden: b.querySelector('svg')?.getAttribute('aria-hidden'),
      dark: document.documentElement.classList.contains('dark') };
  });
  check('theme toggle label names the next mode (light)',
    !themeBefore.dark && themeBefore.label === 'Switch to dark mode', JSON.stringify(themeBefore));
  check('theme toggle title carries the Alt+T hint', /\(Alt\+T\)$/.test(themeBefore.title || ''), themeBefore.title);
  check('theme toggle SVG is aria-hidden', themeBefore.svgHidden === 'true');
  await page.click('#themeToggle', { force: true });
  const themeAfter = await page.evaluate(() => {
    const b = document.getElementById('themeToggle');
    return { label: b.getAttribute('aria-label'), svgHidden: b.querySelector('svg')?.getAttribute('aria-hidden'),
      dark: document.documentElement.classList.contains('dark') };
  });
  check('theme toggle label flips after switching to dark',
    themeAfter.dark && themeAfter.label === 'Switch to light mode', JSON.stringify(themeAfter));
  check('injected sun SVG is aria-hidden', themeAfter.svgHidden === 'true');

  // macOS Option+T reports e.key '†'; the shortcut must still fire via e.code.
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown',
    { key: '†', code: 'KeyT', altKey: true, bubbles: true, cancelable: true })));
  const darkAfterOption = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  check('Option+T (key "†", code KeyT) toggles the theme', darkAfterOption === false);

  // Menu: aria-expanded tracks state, Escape returns focus to the opener.
  check('menu button starts collapsed', await page.getAttribute('#menuBtn', 'aria-expanded') === 'false');
  check('menu button controls the menu overlay', await page.getAttribute('#menuBtn', 'aria-controls') === 'menuOverlay');
  await openMenu(page);
  check('menu button aria-expanded=true while open', await page.getAttribute('#menuBtn', 'aria-expanded') === 'true');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#menuOverlay.show'), null, { timeout: 4000 });
  const menuClosed = await page.evaluate(() => ({
    expanded: document.getElementById('menuBtn').getAttribute('aria-expanded'),
    focusOnBtn: document.activeElement === document.getElementById('menuBtn')
  }));
  check('menu button aria-expanded=false after close', menuClosed.expanded === 'false');
  check('closing the menu returns focus to #menuBtn', menuClosed.focusOnBtn);

  // Upload modal: focus moves in, tabs expose selection state.
  await openMenu(page);
  await page.click('#menuUpload');
  await page.waitForSelector('#uploadModal.show');
  const opened = await page.evaluate(() => {
    const modal = document.querySelector('#uploadModal .modal');
    const tabs = [...document.querySelectorAll('#uploadModal [role=tab]')];
    const panels = [...document.querySelectorAll('#uploadModal [role=tabpanel]')];
    return {
      focusInside: modal.contains(document.activeElement),
      scrollLocked: document.body.classList.contains('scroll-locked'),
      panelLabelsResolve: panels.every(p => {
        const lbl = document.getElementById(p.getAttribute('aria-labelledby'));
        return lbl && lbl.getAttribute('role') === 'tab' && lbl.getAttribute('aria-controls') === p.id;
      }),
      selected: tabs.filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.dataset.tab),
      locationLabels: !!document.querySelector('label[for="importLocationSelectJSON"]') &&
        !!document.querySelector('label[for="importLocationSelectTXT"]'),
      modeLegend: document.querySelector('#tab-txt fieldset > legend')?.textContent.trim()
    };
  });
  check('upload modal moves focus inside the dialog', opened.focusInside);
  check('upload modal locks body scroll while open', opened.scrollLocked);
  check('tab panels are labelled by their tab buttons', opened.panelLabelsResolve);
  check('exactly one tab is aria-selected', opened.selected.length === 1, opened.selected.join(','));
  check('import location selects have associated labels', opened.locationLabels);
  check('import mode radios are grouped by fieldset/legend', opened.modeLegend === 'Import Mode', opened.modeLegend);

  await page.focus('#tab-btn-json');
  await page.keyboard.press('ArrowRight');
  const afterArrow = await page.evaluate(() => ({
    txtSelected: document.getElementById('tab-btn-txt').getAttribute('aria-selected'),
    jsonSelected: document.getElementById('tab-btn-json').getAttribute('aria-selected'),
    txtPanelVisible: document.getElementById('tab-txt').classList.contains('active'),
    focusOnTxt: document.activeElement?.id === 'tab-btn-txt'
  }));
  check('ArrowRight switches to the TXT tab and updates aria-selected',
    afterArrow.txtSelected === 'true' && afterArrow.jsonSelected === 'false' && afterArrow.txtPanelVisible && afterArrow.focusOnTxt,
    JSON.stringify(afterArrow));

  // The drop zone is keyboard operable: Enter and Space open the file
  // picker. Headless Chromium's native chooser interception is racy for
  // keyboard-initiated pickers, so record the input.click() the handler makes
  // (stubbed so no native dialog is left open) and feed the file directly.
  await page.evaluate(() => {
    const input = document.getElementById('fileInputTXT');
    window.__qaPickerOpens = 0;
    input.click = () => { window.__qaPickerOpens++; };
  });
  await page.focus('#fileUploadAreaTXT');
  await page.keyboard.press('Enter');
  check('Enter on the upload area opens the file picker',
    await page.evaluate(() => window.__qaPickerOpens) === 1);
  await page.keyboard.press('Space');
  check('Space on the upload area opens the file picker',
    await page.evaluate(() => window.__qaPickerOpens) === 2);
  await page.evaluate(() => { delete document.getElementById('fileInputTXT').click; });
  await page.setInputFiles('#fileInputTXT', { name: 'qa-outline.txt', mimeType: 'text/plain', buffer: Buffer.from('QA Picked Outline\n  QA Picked Child\n') });
  await page.waitForFunction(() => !document.querySelector('#uploadModal.show'), null, { timeout: 8000 });
  const afterPick = await page.evaluate(() => ({
    imported: Object.values(window.store.cards).some(c => c.title === 'QA Picked Child'),
    scrollLocked: document.body.classList.contains('scroll-locked'),
    inputCleared: document.getElementById('fileInputTXT').value === '',
    focusOnMenuBtn: document.activeElement === document.getElementById('menuBtn')
  }));
  check('picked TXT file is imported', afterPick.imported);
  check('body scroll is unlocked after a successful upload', !afterPick.scrollLocked);
  check('file input is reset so the same file can be re-picked', afterPick.inputCleared);
  check('closing the upload modal restores focus to the opener', afterPick.focusOnMenuBtn);

  // Real drag-and-drop feeds the same import path.
  await openMenu(page);
  await page.click('#menuUpload');
  await page.waitForSelector('#uploadModal.show #fileUploadAreaTXT', { state: 'visible' });
  const dragState = await page.evaluate(() => {
    const area = document.getElementById('fileUploadAreaTXT');
    const dt = new DataTransfer();
    dt.items.add(new File(['QA Dropped Outline\n'], 'qa-drop.txt', { type: 'text/plain' }));
    area.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const highlighted = area.classList.contains('drag-over');
    area.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return { highlighted, clearedOnDrop: !area.classList.contains('drag-over') };
  });
  check('upload area shows a drag-over state', dragState.highlighted);
  check('drag-over state clears on drop', dragState.clearedOnDrop);
  await page.waitForFunction(() => !document.querySelector('#uploadModal.show'), null, { timeout: 8000 });
  const afterDrop = await page.evaluate(() => ({
    imported: Object.values(window.store.cards).some(c => c.title === 'QA Dropped Outline'),
    scrollLocked: document.body.classList.contains('scroll-locked')
  }));
  check('dropped TXT file is imported', afterDrop.imported);
  check('body scroll is unlocked after a dropped upload', !afterDrop.scrollLocked);

  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 9 ─ XSS payload stays inert ──────────────────────────────────────────────
await scenario('xss-inert', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  await page.goto(BASE);
  await page.waitForSelector('#main');
  await createCardViaUI(page, 'XSS Probe',
    '<img src=x onerror="window.__xss1=1"><script>window.__xss2=1<' + '/script>[[link]]');
  const flags = await page.evaluate(() => [window.__xss1, window.__xss2]);
  check('inline handlers/scripts in card body do not execute', !flags[0] && !flags[1]);
  await page.reload();
  await page.waitForSelector('#main');
  const flagsAfter = await page.evaluate(() => [window.__xss1, window.__xss2]);
  check('payload still inert after reload', !flagsAfter[0] && !flagsAfter[1]);
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 9b ─ First-run onboarding modal actually appears ─────────────────────────
await scenario('first-run-onboarding', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors, { keepOnboarding: true });
  await page.goto(BASE);
  await page.waitForSelector('#main');
  // The onboarding modal is shown 500ms after boot on a first run with no cards.
  const modal = await page.waitForSelector('#gettingStartedModal.show', { timeout: 8000 }).catch(() => null);
  check('getting-started modal appears on first run', !!modal);
  if (modal) {
    const a11y = await page.evaluate(() => {
      const m = document.querySelector('#gettingStartedModal .menu-panel, #gettingStartedModal .modal');
      return m ? { role: m.getAttribute('role'), ariaModal: m.getAttribute('aria-modal') } : null;
    });
    check('onboarding modal carries dialog semantics', !!a11y && a11y.role === 'dialog' && a11y.ariaModal === 'true');
    // The primary "seen" path is the CTA, which marks it seen and opens the editor.
    await page.click('#gettingStartedModal .btn-primary:has-text("Create Your First Card")');
    await page.waitForSelector('#cardTitle', { timeout: 8000 });
    const seen = await page.evaluate(() => localStorage.getItem('cardspoke_hasSeenGettingStarted'));
    check('CTA marks onboarding seen and opens the editor', seen === 'true');
  }
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 10 ─ Mobile viewport overflow + screenshots ──────────────────────────────
await scenario('responsive-360', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors, { viewport: { width: 360, height: 740 } });
  await page.goto(BASE);
  await page.waitForSelector('#main');
  await createCardViaUI(page, 'Mobile Layout Card', 'body text for the mobile smoke');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('card navigation starts at the heading', await page.evaluate(() => scrollY === 0));
  check('no horizontal overflow at 360px', overflow <= 1, `overflow=${overflow}px`);
  await page.screenshot({ path: join(ART_DIR, 'mobile-360.png'), fullPage: false });
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

// 13 ─ Card content not reflected into a CSS-selectable value attribute (SEC-1)
await scenario('card-title-not-css-selectable (SEC-1)', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  await page.goto(BASE);
  await page.waitForSelector('#main');

  await createCardViaUI(page, 'Attr Probe Card');
  // Creation lands on the read view; open the editor, where the title input is
  // pre-filled via the h({ value }) helper.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.waitForSelector('#cardTitle');

  const probe = await page.evaluate(() => {
    const el = document.getElementById('cardTitle');
    return { attr: el.getAttribute('value'), prop: el.value };
  });
  check('editor title is pre-filled with the card title', probe.prop === 'Attr Probe Card',
    `value property=${JSON.stringify(probe.prop)}`);
  // The whole point of SEC-1: user content must live only as the input's value
  // PROPERTY, never as a [value="…"] attribute a plugin CSS attribute-selector
  // could read and exfiltrate.
  check('title is NOT exposed as a CSS-selectable value attribute (SEC-1)', probe.attr === null,
    `getAttribute('value')=${JSON.stringify(probe.attr)}`);
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

await scenario('loaded-data-survives-mutations', async () => {
  const errors = [];
  const { context, page } = await freshPage(errors);
  await page.goto(BASE);
  await page.waitForSelector('#main');
  await createCardViaUI(page, 'Original preserved card', 'Original body');
  await page.reload();
  await page.waitForSelector('#main');
  await createCardViaUI(page, 'Second after reload', 'New body');
  check('creating after reload preserves original cards', await page.evaluate(() => Object.values(window.store.cards).some(c => c.title === 'Original preserved card')));
  check('both cards are persisted', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('nested_cards_store')).cards).length === 2));
  const result = await page.evaluate(() => {
    // Import/undo/reparent currently mutate the shell store directly.
    window.store.cards.imported = { id: 'imported', title: 'Imported', body: '', children: [], tags: ['restored'], parentId: null };
    window.store.rootOrder.push('imported');
    window.updateCard('imported', { title: 'Imported edited' });
    const afterEdit = window.store.cards.imported?.title;
    window.createCard('After import', '');
    return { afterEdit, count: Object.keys(window.store.cards).length, tags: window.getTags('imported') };
  });
  check('edit accepts a card restored outside the kernel', result.afterEdit === 'Imported edited');
  check('later create preserves imported cards and tags', result.count === 4 && result.tags.includes('restored'));
  check('no console/page errors', errors.length === 0, errors.join(' | '));
  await context.close();
});

await scenario('worker-security-boundaries', async () => {
  const { context, page } = await freshPage([]);
  await page.goto(BASE);
  await page.waitForSelector('#main');
  const probe = await page.evaluate(async () => {
    const { createPluginWorker } = await import('/src/core/plugin-worker-manager.js');
    let result;
    const worker = await createPluginWorker('ambient-probe', { js: `await ctx.api.storage.set('probe', {
      fetch: typeof fetch, nested: typeof Worker, shared: typeof SharedWorker,
      storage: typeof navigator.storage,
      prototypeFetch: typeof Object.getPrototypeOf(self).fetch
    });` }, (_path, args) => { result = args[1]; });
    try { await worker.callWithDeadline(['lifecycle', 'runSetup'], [], 2000); } finally { worker.terminate(); }
    return result;
  });
  check('raw and prototype worker capabilities are disabled', Object.values(probe).every(value => value === 'undefined'), JSON.stringify(probe));
  const safe = await page.evaluate(async () => {
    const { vnodeToDOM, h } = await import('/src/core/plugin-vnode.js');
    const attacks = [h('script', { src: './app.js' }), h('iframe', { srcdoc: 'bad' }), h('a', { href: 'javascript:alert(1)' }), h('button', { onclick: 'alert(1)' })];
    return attacks.every(node => { try { vnodeToDOM(node); return false; } catch { return true; } });
  });
  check('browser DOM rejects executable vnode descriptions', safe);
  await context.close();
});

for (const width of [768, 1440]) {
  await scenario('responsive-' + width, async () => {
    const { context, page } = await freshPage([], { viewport: { width, height: 900 } });
    await page.goto(BASE);
    await page.waitForSelector('#main');
    await createCardViaUI(page, 'Research project', 'A place for sources, notes, and linked ideas.');
    check('no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(ART_DIR, 'review-' + width + '.png') });
    await context.close();
  });
}

await scenario('standalone-file', async () => {
  const { context, page } = await freshPage([]);
  await page.goto(pathToFileURL(join(WWW, 'index.html')).href);
  await page.waitForSelector('#main');
  await createCardViaUI(page, 'Standalone card', 'Works without a server');
  await page.reload();
  await page.waitForSelector('#main');
  check('core file URL app persists cards through reload', await page.evaluate(() => Object.values(window.store.cards).some(c => c.title === 'Standalone card')));
  await context.close();
});

await scenario('offline-reload', async () => {
  const { context, page } = await freshPage([]);
  await page.goto(BASE);
  await page.waitForSelector('#main');
  await createCardViaUI(page, 'Offline card', 'Local data');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#main');
  check('cached app opens offline with local cards', await page.evaluate(() => Object.values(window.store.cards).some(c => c.title === 'Offline card')));
  await context.close();
});

await scenario('thousand-card-search', async () => {
  const { context, page } = await freshPage([]);
  await page.goto(BASE);
  await page.waitForSelector('#main');
  await waitSaved(page);
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('nested_cards_store'));
    data.cards = {}; data.rootOrder = [];
    for (let i=0; i<1000; i++) { const id = 'scale-' + i; data.cards[id] = { id, title: 'Research topic ' + i, body: 'Reference notes for a sample project', children: [], tags: [], parentId: null }; data.rootOrder.push(id); }
    localStorage.setItem('nested_cards_store', JSON.stringify(data));
  });
  const start = Date.now();
  await page.reload();
  await page.waitForSelector('#main .card-tile');
  check('1000-card fixture loads', await page.evaluate(() => Object.keys(window.store.cards).length === 1000), 'Load time ' + (Date.now()-start) + ' ms');
  await goHome(page);
  await page.fill('#searchInput', 'Research topic 999');
  const searchStart = Date.now();
  await page.press('#searchInput', 'Enter');
  await page.waitForSelector('#searchResultGrid');
  check('search returns target card', await page.locator('#searchResultGrid').innerText().then(text => text.includes('Research topic 999')), 'Search time ' + (Date.now()-searchStart) + ' ms');
  writeFileSync(join(ART_DIR, 'scale-timing.json'), JSON.stringify({ loadAndSearchTotalMs: Date.now()-start, searchMs: Date.now()-searchStart, cards: 1000 }));
  await context.close();
});

await browser.close();
server.close();

// ── summary ───────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
writeFileSync(join(ART_DIR, 'browser-qa-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed.`);
if (failed.length) {
  console.error(`${failed.length} FAILED:`);
  failed.forEach(f => console.error(`  - [${f.scenario}] ${f.label}${f.detail ? ' — ' + f.detail.split('\n')[0] : ''}`));
  process.exit(1);
}
