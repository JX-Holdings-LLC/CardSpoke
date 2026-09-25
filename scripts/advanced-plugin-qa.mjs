// Real browser/worker acceptance tests for the nine distributable JSON files.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const www = resolve(root, 'www');
const base = resolve(root, 'sample-plugins/advanced');
const catalog = JSON.parse(readFileSync(resolve(base, 'manifest.json'))).plugins;
const packages = catalog.map(entry => JSON.parse(readFileSync(resolve(base, entry.file))));
const artifactDir = resolve(root, 'qa-artifacts/advanced-plugins');
mkdirSync(artifactDir, { recursive: true });
const server = createServer((req, res) => {
  const path = resolve(www, '.' + new URL(req.url, 'http://local').pathname);
  if (!path.startsWith(www + sep) || !existsSync(path)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
  res.end(readFileSync(path));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const results = [];
async function scenario(name, run) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('cardspoke_hasSeenGettingStarted', 'true'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  page.setDefaultTimeout(6000);
  try {
    await page.goto(url); await page.waitForFunction(() => !!window.CardSpoke && !!window.store);
    await run(page, errors);
    assert.deepEqual(errors, [], 'Unexpected browser/worker errors');
    results.push({ name, passed: true }); console.log('PASS ' + name);
  } catch (error) {
    results.push({ name, passed: false, error: error.stack, console: errors }); console.error('FAIL ' + name + ': ' + error.message);
    await page.screenshot({ path: resolve(artifactDir, name.replace(/[^a-z0-9-]/gi, '-') + '.png'), fullPage: true }).catch(() => {});
  } finally { await context.close(); }
}
async function install(page, pkg) {
  // Begin without awaiting consent, then approve through the actual dialog.
  await page.evaluate(pkg => {
    window.__installDone = false; window.__installError = '';
    window.CardSpoke.Plugin.install(pkg).then(() => { window.__installDone = true; }).catch(e => { window.__installError = e.message; });
  }, pkg);
  if (pkg.manifest.layer === 'feature') await page.locator('.permission-modal .btn-primary').click();
  await page.waitForFunction(() => window.__installDone || window.__installError);
  assert.equal(await page.evaluate(() => window.__installError), '');
  if (pkg.manifest.layer === 'app') {
    assert.equal(await page.evaluate(id => window.CardSpoke.Plugin.get(id).enabled, pkg.id), false, 'App must install suspended');
    await page.evaluate(id => { window.__enable = window.CardSpoke.Plugin.enable(id); }, pkg.id);
    await page.locator('.permission-modal .btn-primary').click();
    await page.evaluate(() => window.__enable);
  }
  assert.equal(await page.evaluate(id => window.CardSpoke.Plugin.get(id).enabled, pkg.id), true, 'Plugin must enable');
}
async function seed(page, cards) {
  return page.evaluate(cards => cards.map(card => {
    const id = window.createCard(card.title, card.body || '', card.parentId || null);
    if (card.tags) window.setTags(id, card.tags);
    return id;
  }), cards);
}
const pkg = short => packages.find(item => item.id === 'lab-' + short);
const panel = (page, short) => page.locator('#lab-' + short + '-panel');
async function open(page, short) {
  const launcher = page.getByRole('button', { name: pkg(short).manifest.name, exact: true });
  await launcher.focus(); await launcher.press('Enter');
  await panel(page, short).waitFor(); return panel(page, short);
}
async function expectText(locator, expected) { await locator.page().waitForFunction(({ selector, expected }) => document.querySelector(selector)?.textContent.includes(expected), { selector: '#' + await locator.getAttribute('id'), expected }); }
async function persisted(page) { await page.waitForFunction(() => JSON.parse(localStorage.getItem('nested_cards_store') || '{}').plugins && Object.keys(JSON.parse(localStorage.getItem('nested_cards_store')).plugins).length); }

try {
  for (const entry of packages) await scenario(entry.id + '-lifecycle', async page => {
    await seed(page, [{ title: 'Theme sample', body: 'A readable note with [[Missing]] reference.', tags: ['sample'] }]);
    const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg'));
    await install(page, entry);
    await page.locator('#homeBtn').click({ force: true });
    await persisted(page);
    if (entry.manifest.layer === 'theme') {
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg')), before);
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      const dark = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg'));
      await page.screenshot({ path: resolve(artifactDir, entry.id + '-dark.png'), fullPage: true });
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      assert.notEqual(dark, await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg')));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 360, height: 800 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Theme mobile horizontal overflow');
      await page.screenshot({ path: resolve(artifactDir, entry.id + '-mobile.png'), fullPage: true });
    } else {
      await open(page, entry.id.slice(4));
      await panel(page, entry.id.slice(4)).getByRole('button', { name: 'Refresh', exact: true }).focus();
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement);
        return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
      }), 'Plugin controls show keyboard focus');
      await page.setViewportSize({ width: 360, height: 800 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile horizontal overflow');
      await page.screenshot({ path: resolve(artifactDir, entry.id + '-mobile.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: resolve(artifactDir, entry.id + '.png'), fullPage: true });
    await page.reload(); await page.waitForFunction(id => window.CardSpoke?.Plugin.get(id)?.enabled, entry.id);
    assert.equal(await page.locator('style[data-plugin-id="' + entry.id + '"]').count(), 1);
    if (entry.js) {
      assert.equal(await page.getByRole('button', { name: entry.manifest.name, exact: true }).count(), 1);
      const view = await open(page, entry.id.slice(4));
      const resources = await page.evaluate(id => window.CardSpoke.Plugin.get(id).resources.size, entry.id);
      await view.getByRole('button', { name: 'Close', exact: true }).click(); await view.waitFor({ state: 'detached' });
      await open(page, entry.id.slice(4));
      assert.equal(await page.evaluate(id => window.CardSpoke.Plugin.get(id).resources.size, entry.id), resources, 'Closing panels releases tracked DOM resources');
    }
    await page.evaluate(id => window.CardSpoke.Plugin.disable(id), entry.id);
    assert.equal(await page.locator('style[data-plugin-id="' + entry.id + '"]').count(), 0);
    if (entry.js) assert.equal(await page.locator('#' + entry.id + '-panel').count(), 0);
    await page.waitForFunction(id => JSON.parse(localStorage.getItem('nested_cards_store')).plugins[id].enabled === false, entry.id);
    await page.reload(); await page.waitForFunction(id => !!window.CardSpoke?.Plugin.get(id), entry.id);
    assert.equal(await page.evaluate(id => window.CardSpoke.Plugin.get(id).enabled, entry.id), false);
    await page.evaluate(id => window.CardSpoke.Plugin.enable(id), entry.id);
    await page.goto(url + '?safemode'); await page.waitForFunction(id => !!window.CardSpoke?.Plugin.get(id), entry.id);
    assert.equal(await page.evaluate(id => window.CardSpoke.Plugin.get(id).enabled, entry.id), false);
    await page.evaluate(id => window.CardSpoke.Plugin.unregister(id), entry.id);
    assert.equal(await page.evaluate(id => !!window.store.plugins[id], entry.id), false);
    assert.deepEqual(await page.evaluate(id => window.CardSpoke.Permissions.getPermissions(id), entry.id), []);
  });

  await scenario('knowledge-audit-behavior', async page => {
    await seed(page, [{ title: 'Duplicate', body: '' }, { title: 'Duplicate', body: 'text' }, { title: 'Links', body: '[[Missing]] [[Duplicate]]' }]);
    await install(page, pkg('knowledge-audit'));
    const view = await open(page, 'knowledge-audit');
    await expectText(view, 'Duplicate title'); await expectText(view, 'Missing link: Missing'); await expectText(view, 'Ambiguous link: Duplicate');
    await page.locator('#homeBtn').click({ force: true });
    await page.locator('.lab-audit-badge').first().waitFor();
    // Another card can change the audit of this otherwise unchanged card.
    await seed(page, [{ title: 'Missing', body: 'Now resolved' }]);
    await view.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expectText(view, '4 cards');
    await page.locator('#homeBtn').click({ force: true });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.lab-audit-badge')).some(el => el.title === 'Ambiguous link: Duplicate'));
  });
  await scenario('smart-collections-behavior', async page => {
    await seed(page, [{ title: 'Alpha research', body: 'test', tags: ['research'] }, { title: 'Beta', body: 'other' }]);
    await install(page, pkg('smart-collections')); let view = await open(page, 'smart-collections');
    await view.getByLabel('Collection name').fill('Research'); await view.getByLabel('Contains text').fill('Alpha');
    await view.getByLabel('Required tag').fill('research'); await view.getByRole('button', { name: 'Save collection', exact: true }).click();
    await expectText(view, '1 matching cards');
    await persisted(page);
    await page.reload(); view = await open(page, 'smart-collections');
    await view.getByLabel('Saved collection').selectOption('Research'); await view.getByRole('button', { name: 'Load collection', exact: true }).click();
    await expectText(view, '1 matching cards');
  });
  await scenario('batch-workbench-conflicts-and-undo', async page => {
    const ids = await seed(page, [{ title: 'Batch A', tags: ['keep'] }, { title: 'Batch B' }]);
    await install(page, pkg('batch-workbench')); const view = await open(page, 'batch-workbench');
    await view.getByLabel('Title contains').fill('Batch'); await view.getByLabel('Add tag').fill('review'); await view.getByLabel('Title prefix').fill('Done: ');
    await view.getByRole('button', { name: 'Preview changes', exact: true }).click(); await expectText(view, '2 changes ready');
    await page.evaluate(id => window.updateCard(id, { body: 'Concurrent edit' }), ids[1]);
    await view.getByRole('button', { name: 'Apply preview', exact: true }).click(); await expectText(view, '1 updated; 1 changed cards skipped.');
    assert.deepEqual(await page.evaluate(id => window.store.cards[id].tags, ids[0]), ['keep', 'review']);
    await view.getByRole('button', { name: 'Undo last batch', exact: true }).click(); await expectText(view, '1 restored');
    assert.equal(await page.evaluate(id => window.store.cards[id].title, ids[0]), 'Batch A');
    assert.deepEqual(await page.evaluate(id => window.store.cards[id].tags, ids[0]), ['keep']);
  });
  await scenario('project-planner-dependencies', async (page, errors) => {
    await install(page, pkg('project-planner')); let view = await open(page, 'project-planner');
    await view.getByLabel('New project').fill('Launch'); await view.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.waitForFunction(() => Object.values(window.store.cards).some(card => card.title === 'Launch'));
    await view.getByLabel('Task title').fill('Draft'); await view.getByRole('button', { name: 'Add task', exact: true }).click(); await expectText(view, '0/1 tasks');
    const id = await page.evaluate(() => Object.values(window.store.cards).find(card => card.title === 'Draft').id);
    await view.getByLabel('Task title').fill('Publish'); await view.getByLabel('Depends on').selectOption(id);
    await view.getByLabel('Due date').fill('2020-01-01'); await view.getByRole('button', { name: 'Add task', exact: true }).click(); await expectText(view, 'Blocked by Draft');
    const publish = view.locator('.lab-box').filter({ has: page.locator('strong', { hasText: /^Publish$/ }) }).last();
    await publish.getByRole('button', { name: 'Move to done', exact: true }).click();
    await page.getByText('Complete the dependency first.', { exact: true }).first().waitFor();
    const draft = view.locator('.lab-box').filter({ has: page.locator('strong', { hasText: /^Draft$/ }) }).last();
    await draft.getByRole('button', { name: 'Move to done', exact: true }).click(); await expectText(view, '1/2 tasks complete');
    await publish.getByRole('button', { name: 'Move to done', exact: true }).click(); await expectText(view, '2/2 tasks complete');
    await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('nested_cards_store') || '{}').cards || {}).filter(card => card.modsData?.['lab-project-planner']?.status === 'done').length === 2);
    await page.reload(); view = await open(page, 'project-planner'); await expectText(view, '2/2 tasks complete');
  });
  await scenario('study-studio-scheduling', async page => {
    await install(page, pkg('study-studio')); let view = await open(page, 'study-studio');
    await view.getByLabel('Question').fill('Capital of France?'); await view.getByLabel('Answer', { exact: true }).fill('Paris');
    await view.getByRole('button', { name: 'Create study card', exact: true }).click(); await expectText(view, '1 due');
    assert.equal(await view.getByRole('button', { name: 'Good', exact: true }).isDisabled(), true);
    await view.getByRole('button', { name: 'Reveal answer', exact: true }).click(); await view.locator('.lab-answer').waitFor();
    assert.equal(await view.locator('.lab-answer').textContent(), 'Paris');
    await view.getByRole('button', { name: 'Good', exact: true }).click(); await expectText(view, '0 due · 1 reviews');
    await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('nested_cards_store') || '{}').cards || {}).some(card => card.modsData?.['lab-study-studio']?.reviews === 1));
    await page.reload(); view = await open(page, 'study-studio'); await expectText(view, '0 due · 1 reviews');
    await view.getByRole('button', { name: 'Reset schedule', exact: true }).click(); await expectText(view, '1 due · 0 reviews');
  });
  await scenario('research-desk-synthesis', async page => {
    await install(page, pkg('research-desk')); const view = await open(page, 'research-desk');
    await view.getByLabel('Source title').fill('Reference'); await view.getByLabel('Source URL').fill('https://example.com/research');
    await view.getByRole('button', { name: 'Add source', exact: true }).click(); await expectText(view, 'https://example.com/research');
    await view.getByLabel('Excerpt', { exact: true }).fill('<script>literal excerpt</script>'); await view.getByLabel('Your note').fill('Important evidence');
    await view.getByRole('button', { name: 'Save excerpt', exact: true }).click(); await expectText(view, '1 excerpts');
    assert.equal(await view.locator('script').count(), 0);
    await view.getByRole('button', { name: 'Build synthesis card', exact: true }).click(); await expectText(view, 'Synthesis saved');
    await view.getByRole('button', { name: 'Build synthesis card', exact: true }).click();
    await page.waitForFunction(() => Object.values(window.store.cards).filter(card => card.tags.includes('lab-synthesis')).length === 1);
    assert.ok(await page.evaluate(() => Object.values(window.store.cards).find(card => card.tags.includes('lab-synthesis')).body.includes('Important evidence')));
  });
  await scenario('all-six-javascript-plugins-together', async page => {
    for (const entry of packages.filter(entry => entry.js)) await install(page, entry);
    for (const entry of packages.filter(entry => entry.js)) await open(page, entry.id.slice(4));
    assert.equal(await page.locator('.cs-lab').count(), 6);
    await page.setViewportSize({ width: 360, height: 800 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Combined mobile overflow');
    await page.screenshot({ path: resolve(artifactDir, 'combined-mobile.png'), fullPage: true });
    for (const entry of packages.filter(entry => entry.js)) await page.evaluate(id => window.CardSpoke.Plugin.unregister(id), entry.id);
    assert.equal(await page.locator('.cs-lab').count(), 0);
  });
  // Exercise literal JSON copied from the standalone guide, without relying
  // on the advanced sample builder or a mock ctx.
  const guide = readFileSync(resolve(root, 'docs/guides/PLUGIN_AUTHORING_GUIDE.md'), 'utf8');
  const starters = [...guide.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
    .map(match => JSON.parse(match[1])).filter(item => item.id?.startsWith('starter-'));
  assert.equal(starters.length, 3);
  for (const starter of starters) await scenario(starter.id + '-from-guide', async page => {
    await install(page, starter);
    if (starter.id === 'starter-counter') {
      await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
      await page.getByRole('button', { name: 'Count: 1', exact: true }).waitFor();
    }
    if (starter.id === 'starter-project') {
      await page.getByRole('button', { name: 'Create project', exact: true }).click();
      await page.waitForFunction(() => Object.values(window.store.cards).some(card => card.title === 'First task'));
      assert.ok(await page.evaluate(() => {
        const child = Object.values(window.store.cards).find(card => card.title === 'First task');
        return window.store.cards[child.parentId].children.includes(child.id);
      }));
    }
  });
  await scenario('install-json-file-through-manager', async page => {
    await page.locator('#menuBtn').click({ force: true });
    await page.locator('#menuPluginManager').click();
    await page.getByRole('tab', { name: 'Install', exact: true }).click();
    await page.locator('.modal-overlay.show input[type=file]').setInputFiles(resolve(base, 'features/smart-collections.json'));
    await page.getByRole('button', { name: 'Install from File', exact: true }).click();
    await page.locator('.permission-modal .btn-primary').click();
    await page.waitForFunction(() => window.CardSpoke.Plugin.get('lab-smart-collections')?.enabled);
  });
  await scenario('decorator-large-list-and-child-view', async page => {
    const ids = await seed(page, Array.from({ length: 120 }, (_, i) => ({ title: 'Card ' + String(i).padStart(3, '0'), body: '' })));
    await seed(page, [{ title: 'Child card', body: '', parentId: ids[0] }]);
    await install(page, pkg('knowledge-audit'));
    await page.locator('#homeBtn').click({ force: true });
    await page.waitForFunction(() => document.querySelectorAll('.lab-audit-badge').length >= 60);
    assert.ok(await page.evaluate(() => window.CardSpoke.Plugin.get('lab-knowledge-audit').enabled));
    await page.locator('.card-tile').filter({ hasText: 'Card 000' }).first().click();
    await page.waitForFunction(() => !!document.querySelector('.children-section .lab-audit-badge'));
  });
} finally {
  writeFileSync(resolve(artifactDir, 'results.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
  await browser.close(); await new Promise(done => server.close(done));
}
console.log(`${results.filter(result => result.passed).length}/${results.length} scenarios passed`);
if (results.some(result => !result.passed)) process.exitCode = 1;
