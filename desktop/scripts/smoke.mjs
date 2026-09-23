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
 * checks boot, isolation, persistence, the plugin Worker, and the
 * navigation/protocol guards.
 *
 *   node scripts/smoke.mjs            # needs a display; on Linux CI use xvfb-run
 *   node scripts/smoke.mjs --packaged release/linux-unpacked/cardspoke
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootRequire = createRequire(path.join(desktopDir, '..', 'package.json'));
const { _electron: electron } = rootRequire('playwright');

const packagedIdx = process.argv.indexOf('--packaged');
const packagedExe = packagedIdx > -1 ? path.resolve(process.argv[packagedIdx + 1]) : null;
const electronPath = createRequire(path.join(desktopDir, 'package.json'))('electron');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardspoke-desktop-smoke-'));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? '\n       ' + detail : ''}`);
  if (!ok) failures++;
}

async function launch() {
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
  await page.waitForSelector('#main', { timeout: 20000 });
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
} catch (err) {
  check('smoke run completed without exception', false, err.stack || String(err));
} finally {
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} desktop smoke check(s) failed.` : '\nAll desktop smoke checks passed.');
process.exit(failures ? 1 : 0);
