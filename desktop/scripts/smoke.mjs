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
 * End-to-end smoke test of the desktop shell: launches the real Electron app
 * (via the root devDependency Playwright) against a throwaway profile and
 * checks boot, isolation, persistence, the plugin Worker, the
 * navigation/protocol guards, and the data folder (files on disk, outside
 * edits through the CLI, recovery from the folder alone).
 *
 *   node scripts/smoke.mjs            # needs a display; on Linux CI use xvfb-run
 *   node scripts/smoke.mjs --packaged release/linux-unpacked/cardspoke
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootRequire = createRequire(path.join(desktopDir, '..', 'package.json'));
const { _electron: electron } = rootRequire('playwright');

const packagedIdx = process.argv.indexOf('--packaged');
const packagedExe = packagedIdx > -1 ? path.resolve(process.argv[packagedIdx + 1]) : null;
const electronPath = createRequire(path.join(desktopDir, 'package.json'))('electron');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardspoke-desktop-smoke-'));
// Point the data folder at a throwaway directory through the same settings
// file a user's choice is stored in (never the real Documents folder).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardspoke-desktop-data-'));
fs.writeFileSync(path.join(userDataDir, 'storage.json'), JSON.stringify({ dataFolder: dataDir }));
const cliPath = path.join(desktopDir, '..', 'cli', 'cardspoke.js');
const cli = (...args) => JSON.parse(execFileSync(process.execPath, [cliPath, ...args, '--json'], {
  env: { ...process.env, CARDSPOKE_DESKTOP_CONFIG_DIR: userDataDir, CARDSPOKE_DATA_DIR: '', CARDSPOKE_FILE: '', CARDSPOKE_DATASET: '' },
  encoding: 'utf8'
}));
const datasetFile = path.join(dataDir, 'nested_cards_store.json');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? '\n       ' + detail : ''}`);
  if (!ok) failures++;
}

async function launch({ waitForMain = true } = {}) {
  const args = [`--user-data-dir=${userDataDir}`];
  if (process.env.CI || process.getuid?.() === 0) args.push('--no-sandbox');
  const app = packagedExe
    ? await electron.launch({ executablePath: packagedExe, args })
    : await electron.launch({ executablePath: electronPath, args: [desktopDir, ...args] });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/raw\.githubusercontent\.com|ERR_(TUNNEL|PROXY|NAME|INTERNET|CONNECTION|CERT_[A-Z_]+)/.test(msg.text())) {
      errors.push('console.error: ' + msg.text());
    }
  });
  if (waitForMain) await page.waitForSelector('#main', { timeout: 20000 });
  return { app, page, errors };
}

const waitSaved = (page) => page.waitForFunction(
  () => /^Saved( locally)?$/.test(document.getElementById('saveStatus')?.textContent || ''),
  null, { timeout: 8000 });

async function openMenu(page) {
  await page.evaluate(() => { const s = document.getElementById('saveStatus'); if (s) s.textContent = ''; });
  await page.click('#menuBtn', { force: true });
  await page.waitForSelector('#menuOverlay.show', { timeout: 8000 });
}

try {
  // ── First launch ────────────────────────────────────────────────────────
  let { app, page, errors } = await launch();
  await page.evaluate(() => localStorage.setItem('cardspoke_hasSeenGettingStarted', 'true'));

  check('loads from the cardspoke://app origin', page.url() === 'cardspoke://app/index.html', page.url());
  check('window title is CardSpoke', /CardSpoke/.test(await page.title()));
  const env = await page.evaluate(() => ({
    desktop: window.cardspokeDesktop && window.cardspokeDesktop.isDesktop === true,
    noRequire: typeof window.require === 'undefined',
    noProcess: typeof window.process === 'undefined',
    secure: window.isSecureContext,
    version: document.querySelector('meta[name="app:version"]')?.content
  }));
  check('preload exposes the desktop marker', env.desktop);
  check('renderer has no Node.js require/process', env.noRequire && env.noProcess);
  check('app runs in a secure context', env.secure);
  const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
  check('bundled web version matches desktop version', env.version === pkg.version, `${env.version} vs ${pkg.version}`);

  const blocked = await page.evaluate(async () => {
    const status = async (u) => { try { return (await fetch(u)).status; } catch { return 'error'; } };
    return {
      traversal: await status('cardspoke://app/..%2f..%2fpackage.json'),
      testPage: await status('/test.html'),
      appJs: await status('/app.js')
    };
  });
  check('protocol serves app assets', blocked.appJs === 200, String(blocked.appJs));
  check('protocol refuses path traversal', blocked.traversal !== 200, String(blocked.traversal));
  check('protocol does not serve dev-only pages', blocked.testPage !== 200, String(blocked.testPage));

  const clipboard = await page.evaluate(() =>
    navigator.clipboard.writeText('CardSpoke').then(() => true, (e) => String(e)));
  check('clipboard writes are allowed (copy as Markdown/JSON)', clipboard === true, String(clipboard));
  const camera = await page.evaluate(() =>
    navigator.mediaDevices?.getUserMedia({ video: true }).then(() => 'granted', () => 'denied') ?? 'denied');
  check('other permissions (camera) are denied', camera === 'denied', camera);

  const popup = await page.evaluate(() => window.open('https://example.com') === null);
  check('window.open is denied', popup);
  await page.evaluate(() => { location.href = 'file:///etc/hostname'; });
  await page.waitForTimeout(300);
  check('navigation away from the app is blocked', page.url().startsWith('cardspoke://app/'), page.url());
  // The probes above log expected 404 / blocked-resource errors.
  errors.length = 0;

  // Create a card through the UI.
  await openMenu(page);
  await page.click('#menuNewCard');
  await page.waitForSelector('#cardTitle');
  await page.fill('#cardTitle', 'Desktop Card');
  await page.fill('#cardBody', 'Saved by the desktop smoke test');
  await page.click('form button[type=submit]');
  await page.waitForFunction(() => Object.values(window.store.cards).some((c) => c.title === 'Desktop Card'));
  await waitSaved(page);
  check('card created through the UI', true);

  // Plugin Worker sandbox (module Worker served from the custom scheme).
  await page.evaluate(async () => {
    window.store.plugins['desktop-badge'] = {
      definition: {
        manifest: { id: 'desktop-badge', name: 'Desktop Badge', version: '1.0.0', author: 'QA', layer: 'feature', permissions: ['ui-override'] },
        js: "await ctx.api.ui.inject('.header', ctx.h('span', { id: '__desktopBadge' }, 'desktop'));"
      },
      enabled: false
    };
    window.save(true);
    await window.CardSpoke.Plugin.syncFromStore();
  });
  await openMenu(page);
  await page.click('#menuPluginManager');
  await page.click('.modal-overlay.show .btn:has-text("Enable")');
  await page.waitForSelector('.permission-modal [role=dialog]');
  await page.click('.permission-modal button.btn-primary');
  await page.waitForSelector('#__desktopBadge', { timeout: 10000 });
  check('plugin Worker runs and renders through the vnode API', true);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('nested_cards_store')).plugins['desktop-badge'].enabled);

  // ── Data folder ───────────────────────────────────────────────────────
  const onDisk = fs.existsSync(datasetFile) ? fs.readFileSync(datasetFile, 'utf8') : '';
  check('dataset is saved as a file in the data folder', onDisk.includes('Desktop Card'), datasetFile);
  check('dataset file is readable, pretty-printed JSON', onDisk.startsWith('{\n  "'));
  const settings = JSON.parse(fs.readFileSync(path.join(userDataDir, 'storage.json'), 'utf8'));
  check('settings record the open dataset for the CLI', settings.activeDataset === 'nested_cards_store', JSON.stringify(settings));

  const created = cli('create', 'From the CLI', '--body', 'Written while the app is open');
  check('CLI edits the open dataset by default', created.ok && created.dataset === 'nested_cards_store', JSON.stringify(created));
  const reloaded = await page.waitForFunction(
    () => Object.values(window.store.cards).some((c) => c.title === 'From the CLI'), null, { timeout: 10000 }
  ).then(() => true, () => false);
  check('app reloads a dataset changed outside it', reloaded);
  check('both cards are in the app after the reload',
    await page.evaluate(() => ['Desktop Card', 'From the CLI'].every((t) => Object.values(window.store.cards).some((c) => c.title === t))));

  check('no console/page errors on first launch', errors.length === 0, errors.join(' | '));
  await app.close();

  // ── Second launch: data must survive a full app restart ────────────────
  ({ app, page, errors } = await launch());
  check('card persists across app restart',
    await page.evaluate(() => Object.values(window.store.cards).some((c) => c.title === 'Desktop Card')));
  await page.waitForSelector('#__desktopBadge', { timeout: 10000 }).catch(() => {});
  check('enabled plugin is restored after restart', await page.locator('#__desktopBadge').count() === 1);
  check('window state file written', fs.existsSync(path.join(userDataDir, 'window-state.json')));
  check('no console/page errors on second launch', errors.length === 0, errors.join(' | '));
  await app.close();

  // ── Third launch: the data folder alone is enough ──────────────────────
  // Drop the renderer's storage (the LocalStorage cache) entirely; every
  // card must come back from the dataset files.
  fs.rmSync(path.join(userDataDir, 'Local Storage'), { recursive: true, force: true });
  ({ app, page, errors } = await launch({ waitForMain: false }));
  // Plugin grants live in the app profile, not the data folder, so the
  // enabled plugin must ask for consent again before it may run.
  const asked = await page.waitForSelector('.permission-modal [role=dialog]', { timeout: 20000 }).then(() => true, () => false);
  check('a plugin from the data folder needs consent on a fresh profile', asked);
  if (asked) await page.click('.permission-modal button.btn-primary');
  await page.waitForSelector('#main', { timeout: 20000 });
  check('cards are restored from the data folder after the app cache is lost',
    await page.evaluate(() => ['Desktop Card', 'From the CLI'].every((t) => Object.values(window.store.cards).some((c) => c.title === t))));
  check('CLI sees the same cards', cli('search', 'CLI').data.results.length === 1);
  check('no console/page errors on third launch', errors.length === 0, errors.join(' | '));
  await app.close();
} catch (err) {
  check('smoke run completed without exception', false, err.stack || String(err));
} finally {
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} desktop smoke check(s) failed.` : '\nAll desktop smoke checks passed.');
process.exit(failures ? 1 : 0);
