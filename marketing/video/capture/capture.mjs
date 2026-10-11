/*
 * Captures the real CardSpoke app (www/) with the demo dataset for the marketing video.
 *
 *   node marketing/video/capture/capture.mjs        -> marketing/video/shots/*.png
 *
 * Desktop shots are a 1280x720 viewport at 1.5x (1920x1080 PNG); phone shots are 390x844 at 3x.
 * The plugin gallery's GitHub manifest is served from sample-plugins/ so capture works offline.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname, normalize, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { store } from './dataset.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const WWW = join(ROOT, 'www');
const OUT = resolve(HERE, '../shots');
const EXECUTABLE = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(WWW, path === '/' ? 'index.html' : path));
  if (!file.startsWith(WWW) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXECUTABLE });

async function session({ width = 1280, height = 720, scale = 1.5, mobile = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale,
    isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(data => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem('cardspoke_hasSeenGettingStarted', 'true');
    localStorage.setItem('nested_cards_store', data);
    sessionStorage.setItem('seeded', '1');
  }, JSON.stringify(store));
  await context.route('https://raw.githubusercontent.com/jxburros/CardSpoke/main/sample-plugins/**', route => {
    const rel = new URL(route.request().url()).pathname.split('/sample-plugins/')[1];
    route.fulfill({ path: join(ROOT, 'sample-plugins', rel), contentType: 'application/json' });
  });
  const page = await context.newPage();
  page.on('pageerror', e => console.warn('pageerror:', e.message));
  await page.goto(URL_);
  await page.waitForSelector('#main .card-tile');
  // The "Saved locally" pill is shown in the hero shot only; elsewhere it would flicker between shots.
  return { context, page };
}

const boxes = {};
// Element boxes in screenshot pixels, so the video can point the cursor and highlights at real UI.
async function mark(page, shotName, key, selector, scale = 1.5) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  (boxes[shotName] ||= {})[key] = [b.x, b.y, b.width, b.height].map(v => Math.round(v * scale));
}
const settle = page => page.waitForTimeout(450);
async function shot(page, name) {
  await settle(page);
  await page.mouse.move(-10, -10);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('shot', name);
}
const clearStatus = page => page.evaluate(() => { const s = document.getElementById('saveStatus'); if (s) s.textContent = ''; });
const open = (page, title) => page.click(`[aria-label="Open card: ${title}"]`);
async function home(page) { await page.click('#homeBtn', { force: true }); await page.waitForSelector('#searchInput'); }
async function menu(page, id) {
  await clearStatus(page);
  await page.click('#menuBtn', { force: true });
  await page.waitForSelector('#menuOverlay.show');
  await page.click(`#${id}`);
}

// Desktop, light
{
  const { context, page } = await session();
  await page.click('text=GRID');
  await page.waitForTimeout(1200);
  await shot(page, 'home-grid');
  await mark(page, 'home-grid', 'novel', '[aria-label="Open card: Novel: The Lighthouse Keeper"]');
  await mark(page, 'home-grid', 'search', '#searchInput');
  await mark(page, 'home-grid', 'theme', '#themeToggle');
  await mark(page, 'home-grid', 'menu', '#menuBtn');
  await clearStatus(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await open(page, 'Novel: The Lighthouse Keeper'); await shot(page, 'novel');
  await mark(page, 'novel', 'characters', '[aria-label="Open card: Characters"]');
  await mark(page, 'novel', 'breadcrumbs', '#breadcrumbs');
  await mark(page, 'novel', 'links', '.card-detail-body .card-link >> nth=0');
  await open(page, 'Characters'); await shot(page, 'characters');
  await mark(page, 'characters', 'mara', '[aria-label="Open card: Mara Quinn"]');
  await mark(page, 'characters', 'breadcrumbs', '#breadcrumbs');
  await open(page, 'Mara Quinn'); await shot(page, 'mara');
  await mark(page, 'mara', 'breadcrumbs', '#breadcrumbs');
  await mark(page, 'mara', 'link1', '.card-detail-body .card-link >> nth=0');
  await mark(page, 'mara', 'link2', '.card-detail-body .card-link >> nth=1');
  await mark(page, 'mara', 'related', '.related-section');
  await mark(page, 'mara', 'title', '.card-detail-title');

  await home(page);
  for (const prefix of ['t', 'ti', 'tid', 'tide']) {
    await page.fill('#searchInput', prefix);
    await shot(page, `search-${prefix.length}`);
  }
  await page.press('#searchInput', 'Enter'); await shot(page, 'search-results');
  await mark(page, 'search-results', 'grid', '#main .card-grid');
  await page.fill('#searchInput', ''); await home(page);

  await menu(page, 'menuNewCard');
  await page.waitForSelector('#cardTitle');
  await shot(page, 'new-card-0');
  await mark(page, 'new-card', 'title', '#cardTitle');
  await mark(page, 'new-card', 'body', '#cardBody');
  await page.fill('#cardTitle', 'Act IV');
  await shot(page, 'new-card-1');
  await page.fill('#cardBody', 'The lighthouse goes dark. Mara keeps writing anyway.');
  await shot(page, 'new-card-2');
  await page.keyboard.press('Escape');
  await page.reload(); await page.waitForSelector('#main .card-tile');

  await menu(page, 'menuTagManager'); await shot(page, 'tags');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await menu(page, 'menuDataHub'); await shot(page, 'datahub');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await menu(page, 'menuAppearance'); await shot(page, 'appearance');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await menu(page, 'menuPluginManager');
  await page.click('[role=tab]:has-text("Gallery"), button:has-text("Gallery")');
  await page.waitForSelector('text=Forest');
  await shot(page, 'plugin-gallery');
  const items = await page.evaluate(names => names.map(n => {
    const title = [...document.querySelectorAll('.modal div')].find(d => d.textContent === n && !d.children.length);
    const r = title.parentElement.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  }), ['Forest', 'Cyberpunk', 'Monochrome']);
  boxes['plugin-gallery'] = Object.fromEntries(items.map((b, i) => [`item${i}`, b.map(v => Math.round(v * 1.5))]));
  await context.close();
}

// Desktop: dark mode and theme plugins
{
  const { context, page } = await session();
  await page.click('text=GRID');
  await clearStatus(page);
  await page.click('#themeToggle', { force: true });
  await clearStatus(page);
  await shot(page, 'home-grid-dark');
  await open(page, 'Novel: The Lighthouse Keeper'); await clearStatus(page); await shot(page, 'novel-dark');
  await page.click('#themeToggle', { force: true });
  await home(page);
  for (const theme of ['forest', 'cyberpunk']) {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'sample-plugins/themes', `${theme}.json`), 'utf8'));
    const id = await page.evaluate(p => window.CardSpoke.Plugin.install(p), pkg);
    await page.evaluate(i => window.CardSpoke.Plugin.enable && window.CardSpoke.Plugin.enable(i), id);
    await page.waitForTimeout(400);
    await clearStatus(page);
    await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    await shot(page, `theme-${theme}`);
    await page.evaluate(i => window.CardSpoke.Plugin.disable ? window.CardSpoke.Plugin.disable(i) : window.CardSpoke.Plugin.remove(i), id);
  }
  await context.close();
}

// The logo in white on transparency, cropped to the artwork (SVG units 140..1375 x 575..840, at 2 px per unit).
{
  const page = await browser.newPage({ viewport: { width: 2470, height: 530 } });
  const svg = readFileSync(join(ROOT, 'CardSpoke.svg'), 'utf8')
    .replace(/<rect x="-150"[^>]*\/>/g, '')
    .replace(/#000000/g, '#ffffff')
    .replace(/width="2000"/, 'width="3000"').replace(/height="2000"/, 'height="3000"');
  await page.setContent(`<html><body style="margin:0;background:transparent">
    <div style="position:absolute;left:-280px;top:-1150px">${svg}</div></body></html>`);
  await page.screenshot({ path: join(OUT, 'logo-white.png'), omitBackground: true });
  console.log('shot logo-white');
  await page.close();
}

// Phone
{
  const { context, page } = await session({ width: 390, height: 844, scale: 3, mobile: true });
  await clearStatus(page);
  await shot(page, 'phone-home');
  await open(page, 'Kyoto Trip'); await clearStatus(page); await shot(page, 'phone-kyoto');
  await context.close();
}

writeFileSync(join(OUT, 'boxes.json'), JSON.stringify(boxes, null, 2) + '\n');
await browser.close();
server.close();
