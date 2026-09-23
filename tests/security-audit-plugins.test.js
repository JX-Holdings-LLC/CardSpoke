/**
 * Security-audit regression tests for the plugin runtime.
 *
 *  1. Permission grants are bound to a fingerprint of the plugin's code and
 *     requested permissions, so a same-id plugin with different code (e.g.
 *     one arriving in an imported dataset) needs fresh consent. Legacy grants
 *     with no fingerprint prompt once.
 *  2. card.render hooks and a `Card` component need `ui-override`. The worker
 *     keeps a renderer only after the host accepts it, and renderBatch returns
 *     only what the host accepted.
 *  3. ctx.utils over RPC is an allowlist: write helpers need data-modify or
 *     ui-override. Middleware on card writes needs data-modify. Without it,
 *     card.save middleware can only observe.
 *  4. (#370) register() rejects function-only definitions unless they come
 *     through the explicit host path. install() drops function fields.
 *  5. Plugin ids must match the documented pattern.
 *
 * Uses REAL worker threads running the production bootstrap (see
 * tests/helpers/fake-worker-global.js).
 */

import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { installFakeWorkerGlobal } from './helpers/fake-worker-global.js';
import { Plugin, resetForTesting } from '../www/src/core/plugin-api.js';
import { Permissions, computeFingerprint } from '../www/src/core/permissions.js';
import { Middleware } from '../www/src/core/middleware.js';
import { PluginValidator } from '../www/src/core/plugin-validator.js';

installFakeWorkerGlobal();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function makeEl(tag) {
  return {
    tag, attrs: {}, style: {}, children: [], dataset: {}, parentNode: null, className: '', textContent: '',
    setAttribute(n, v) { this.attrs[n] = v; },
    getAttribute(n) { return this.attrs[n]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); c.parentNode = null; return c; },
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, contains() { return false; } }
  };
}

function makeStorage() {
  return {
    _data: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    get length() { return Object.keys(this._data).length; },
    key(i) { return Object.keys(this._data)[i] || null; }
  };
}

let toasts = [];
let consentCalls = [];
let consentAnswer = false;
const realShowConsent = Permissions._showConsentDialog;

function fresh() {
  resetForTesting();
  Middleware.clear();
  toasts = [];
  consentCalls = [];
  consentAnswer = false;
  const head = makeEl('head');
  global.document = {
    head,
    body: makeEl('body'),
    createElement: makeEl,
    createTextNode: text => ({ text }),
    getElementById() { return null; },
    querySelector(sel) {
      const m = /^style\[data-plugin-id="(.+)"\]$/.exec(sel);
      if (m) return head.children.find(el => el.attrs['data-plugin-id'] === m[1]) || null;
      return null;
    },
    querySelectorAll() { return []; }
  };
  global.localStorage = makeStorage();
  global.window = {
    store: { rootOrder: [], cards: {}, plugins: {}, bookmarks: [], recentCards: [] },
    save() {},
    showToast(msg) { toasts.push(String(msg)); },
    APP_VERSION: '0.21.1',
    SCHEMA_VERSION: 4,
    localStorage: global.localStorage
  };
  Permissions.clearAll();
  Permissions._showConsentDialog = async function(id, name, perms, opts) {
    consentCalls.push({ id, perms: perms.slice(), changed: !!(opts && opts.changed) });
    return consentAnswer;
  };
}

function manifest(id, permissions) {
  return { id, name: id, version: '1.0.0', author: 't', layer: 'feature', permissions: permissions || [] };
}

test.after(() => {
  Permissions._showConsentDialog = realShowConsent;
  resetForTesting();
});

test('a slow permission answer does not race the enable timeout', async () => {
  fresh();
  const id = 'slow-consent';
  Plugin.register(id, { manifest: manifest(id, []), js: 'ctx.logger.info("hi");' });
  // The user takes longer than the (shortened) hang timeout to answer.
  Permissions._showConsentDialog = async () => {
    await new Promise(r => setTimeout(r, 1500));
    consentCalls.push({ id });
    return true;
  };
  try {
    await Plugin._enableWithTimeout(id, 1000);
    assert.ok(Plugin.get(id).enabled, 'plugin enabled after a slow Allow');
    assert.is(consentCalls.length, 1, 'user asked exactly once');
  } finally {
    await Plugin.disable(id).catch(() => {});
  }
});

// ── 1. Fingerprint-bound grants ───────────────────────────────────────────

test('computeFingerprint changes with code/permissions and ignores permission order', () => {
  const base = { manifest: { permissions: ['storage', 'ui-override'] }, js: 'a()', teardownJs: 'b()' };
  const fp = computeFingerprint(base);
  assert.type(fp, 'string');
  assert.is(computeFingerprint({ manifest: { permissions: ['ui-override', 'storage'] }, js: 'a()', teardownJs: 'b()' }), fp);
  assert.is.not(computeFingerprint(Object.assign({}, base, { js: 'a();evil()' })), fp);
  assert.is.not(computeFingerprint(Object.assign({}, base, { teardownJs: 'c()' })), fp);
  assert.is.not(computeFingerprint({ manifest: { permissions: ['storage'] }, js: 'a()', teardownJs: 'b()' }), fp);
  // Content can't be shifted between fields to collide.
  assert.is.not(computeFingerprint({ js: 'ab', teardownJs: '' }), computeFingerprint({ js: 'a', teardownJs: 'b' }));
});

test('a grant bound to one build does not satisfy a different build of the same id', async () => {
  fresh();
  const fpA = computeFingerprint({ manifest: manifest('p', ['storage']), js: 'A' });
  const fpB = computeFingerprint({ manifest: manifest('p', ['storage']), js: 'B' });
  Permissions.grantPermissions('p', ['plugin-code', 'storage'], fpA);
  assert.ok(Permissions.hasAllPermissions('p', ['plugin-code', 'storage'], fpA));
  assert.not.ok(Permissions.hasAllPermissions('p', ['plugin-code', 'storage'], fpB));
  assert.not.ok(Permissions.hasPermission('p', 'storage', fpB), 'runtime checks are fingerprint-bound too');

  consentAnswer = false;
  const ok = await Permissions.requestPermissions('p', 'P', ['plugin-code', 'storage'], fpB);
  assert.is(ok, false);
  assert.is(consentCalls.length, 1, 'changed code prompts again');
  assert.ok(consentCalls[0].changed, 'dialog is told the code/permissions changed');
  assert.is(Permissions.getFingerprint('p'), fpA, 'declining leaves the old binding untouched');
});

test('re-consent for a new build replaces (does not merge) the old grant', async () => {
  fresh();
  const fpA = computeFingerprint({ manifest: manifest('p', ['network', 'storage']), js: 'A' });
  const fpB = computeFingerprint({ manifest: manifest('p', ['storage']), js: 'B' });
  Permissions.grantPermissions('p', ['plugin-code', 'network', 'storage'], fpA);
  consentAnswer = true;
  assert.ok(await Permissions.requestPermissions('p', 'P', ['plugin-code', 'storage'], fpB));
  assert.is(Permissions.getFingerprint('p'), fpB);
  assert.not.ok(Permissions.getPermissions('p').includes('network'), 'stale broader grant not carried over');
  const saved = JSON.parse(localStorage.getItem('cardspoke_plugin_permission_bindings'));
  assert.is(saved.p, fpB, 'binding persisted');
});

test('legacy grants (no fingerprint) stay readable but require consent once', async () => {
  fresh();
  localStorage.setItem('cardspoke_plugin_permissions', JSON.stringify({ old: ['plugin-code', 'ui-override'] }));
  // Fresh module instance so loadPermissions() reads the seeded legacy data.
  const { Permissions: P2 } = await import('../www/src/core/permissions.js?legacy-migration');
  assert.equal(P2.getPermissions('old').sort(), ['plugin-code', 'ui-override'], 'legacy grant is readable');
  const fp = computeFingerprint({ manifest: manifest('old', ['ui-override']), js: 'x' });
  assert.not.ok(P2.hasAllPermissions('old', ['plugin-code', 'ui-override'], fp), 'but does not satisfy a bound check');

  const calls = [];
  P2._showConsentDialog = async (id, name, perms, opts) => { calls.push(opts); return true; };
  assert.ok(await P2.requestPermissions('old', 'Old', ['plugin-code', 'ui-override'], fp));
  assert.is(calls.length, 1, 'prompted once');
  assert.ok(calls[0].reconfirm && !calls[0].changed, 'legacy re-consent is not described as a code change');
  assert.ok(await P2.requestPermissions('old', 'Old', ['plugin-code', 'ui-override'], fp));
  assert.is(calls.length, 1, 'not prompted again once re-bound');
  assert.is(JSON.parse(localStorage.getItem('cardspoke_plugin_permission_bindings')).old, fp);
});

test('a same-id plugin with different code needs fresh consent to enable (dataset import case)', async () => {
  fresh();
  const id = 'same-id';
  const defA = { manifest: manifest(id, []), js: 'ctx.logger.info("A");' };
  Plugin.register(id, defA);
  consentAnswer = true;
  await Plugin.enable(id);
  assert.is(consentCalls.length, 1, 'first enable prompts');
  assert.ok(Plugin.get(id).enabled);

  // Runtime drop that keeps grants (what a dataset switch/import does).
  await Plugin.teardownForReload(id);
  Plugin.register(id, { manifest: manifest(id, []), js: 'ctx.logger.info("B, different code");' });
  consentAnswer = false;
  let threw = false;
  try { await Plugin.enable(id); } catch (_e) { threw = true; }
  assert.ok(threw, 'different code under the same id is not silently enabled');
  assert.is(consentCalls.length, 2, 'user was asked again');
  assert.is(Plugin.get(id).enabled, false);

  // The original build still enables without a prompt.
  await Plugin.teardownForReload(id);
  Plugin.register(id, defA);
  await Plugin.enable(id);
  assert.is(consentCalls.length, 2, 'unchanged build is not re-prompted');
  await Plugin.disable(id);
});

// ── 2. card.render / Card component need ui-override ──────────────────────

const RENDER_JS = `
  const reg = ctx.api.middleware.register({
    name: 'deco', operations: ['card.render'],
    handler: () => ({ addClass: ['evil'], appendChildren: { '.card-title': [ctx.h('span', {}, 'x')] } })
  });
  await reg.ready.catch(() => {});
  try { await ctx.api.ui.registerComponent('Card', { render: () => ctx.h('div', {}, 'replaced') }); } catch (_e) {}
`;

async function enableWithGrants(id, def, grants) {
  Plugin.register(id, def);
  Permissions.grantPermissions(id, ['plugin-code'].concat(grants || []));
  await Plugin.enable(id);
  return Plugin.get(id);
}

test('card.render middleware and Card component are refused without ui-override', async () => {
  fresh();
  const id = 'no-ui';
  const inst = await enableWithGrants(id, { manifest: manifest(id, []), js: RENDER_JS });
  assert.not.ok(Plugin.getCardRenderPluginIds().includes(id), 'no card render hook registered');
  const batch = [{ card: { id: 'c1', title: 't' }, isSelected: false, tileSnapshot: {} }];
  assert.is(await Plugin.renderBatch(id, batch, {}), null, 'host returns nothing to apply');
  // The worker itself must not have kept the refused renderer/decorator.
  const raw = await inst.workerHandle.callWithDeadline(['ui', 'renderBatch'], [batch, {}], 2000);
  assert.is(raw[0].vnode, null, 'worker did not store the refused Card renderer');
  assert.is(raw[0].patch, null, 'worker did not store the refused decorator');
  await Plugin.disable(id);
});

test('card.render middleware and Card component work with ui-override', async () => {
  fresh();
  const id = 'with-ui';
  await enableWithGrants(id, { manifest: manifest(id, ['ui-override']), js: RENDER_JS }, ['ui-override']);
  assert.ok(Plugin.getCardRenderPluginIds().includes(id));
  // renderBatch races a short (~80ms) deadline and resolves null on a miss;
  // retry a few times so a slow first worker round trip can't flake this.
  let out = null;
  for (let i = 0; i < 10 && !out; i++) {
    out = await Plugin.renderBatch(id, [{ card: { id: 'c1', title: 't' }, isSelected: false, tileSnapshot: {} }], {});
  }
  assert.ok(out, 'renderBatch produced a result');
  assert.ok(out[0].vnode, 'owned Card component vnode is honoured');
  assert.ok(out[0].patch && out[0].patch.addClass.includes('evil'), 'accepted decorator patch is honoured');
  await Plugin.disable(id);
  assert.not.ok(Plugin.getCardRenderPluginIds().includes(id), 'cleared on disable');
});

// ── 3. Middleware on card writes / utils gating ───────────────────────────

const MW_JS = `
  const results = {};
  for (const op of ['card.update', 'card.create', 'card.delete', '*', 'card.save']) {
    const reg = ctx.api.middleware.register({
      name: 'mw-' + op.replace(/[^a-z]/g, ''), operations: [op],
      handler: async (mw, next) => { mw.preventDefault(); mw.args = ['rewritten']; await next(); }
    });
    try { await reg.ready; results[op] = 'ok'; } catch (e) { results[op] = 'denied'; }
  }
  await ctx.api.ui.showToast(JSON.stringify(results));
`;

test('middleware on card writes requires data-modify; card.save is observe-only without it', async () => {
  fresh();
  const id = 'mw-no-data';
  await enableWithGrants(id, { manifest: manifest(id, []), js: MW_JS });
  const results = JSON.parse(toasts[toasts.length - 1]);
  assert.is(results['card.update'], 'denied');
  assert.is(results['card.create'], 'denied');
  assert.is(results['card.delete'], 'denied');
  assert.is(results['*'], 'denied', "'*' covers card writes");
  assert.is(results['card.save'], 'ok', 'card.save may still be observed');
  const names = Middleware.list().map(m => m.name || m);
  assert.not.ok(names.some(n => String(n).includes('mw-cardupdate')), 'no write hook in the pipeline');

  const run = await Middleware.run('card.save', [{ cards: {} }]);
  assert.is(run.prevented, false, 'observe-only hook cannot cancel a save');
  assert.is.not(run.context.args[0], 'rewritten', 'observe-only hook cannot rewrite args');
  await Plugin.disable(id);
});

test('middleware on card writes is allowed (and effective) with data-modify', async () => {
  fresh();
  const id = 'mw-data';
  await enableWithGrants(id, { manifest: manifest(id, ['data-modify']), js: MW_JS }, ['data-modify']);
  const results = JSON.parse(toasts[toasts.length - 1]);
  ['card.update', 'card.create', 'card.delete', '*', 'card.save'].forEach(op => assert.is(results[op], 'ok', op));
  const run = await Middleware.run('card.save', [{ cards: {} }]);
  assert.is(run.prevented, true, 'data-modify hook may cancel');
  await Plugin.disable(id);
});

const UTILS_JS = `
  const out = {};
  const calls = [['createCard', [{ title: 'x' }]], ['setTags', ['c1', ['a']]], ['setTheme', ['dark']],
    ['setHighContrast', [true]], ['getTheme', []], ['secretHelper', []]];
  for (const [name, args] of calls) {
    try { out[name] = { ok: true, v: await ctx.utils[name](...args) }; }
    catch (e) { out[name] = { ok: false, e: String(e && e.message) }; }
  }
  await ctx.api.ui.showToast(JSON.stringify(out));
`;

function installUtils(calls) {
  global.window.CardSpoke = {
    utils: {
      createCard: async () => { calls.push('createCard'); return { id: 'n1' }; },
      setTags: async () => { calls.push('setTags'); return true; },
      setTheme: async () => { calls.push('setTheme'); return true; },
      setHighContrast: async () => { calls.push('setHighContrast'); return true; },
      getTheme: async () => 'light',
      secretHelper: async () => { calls.push('secretHelper'); return 'secret'; }
    }
  };
}

test('ctx.utils write helpers are permission-gated and unknown helpers are not exposed', async () => {
  fresh();
  const calls = [];
  installUtils(calls);
  const id = 'utils-none';
  await enableWithGrants(id, { manifest: manifest(id, []), js: UTILS_JS });
  const out = JSON.parse(toasts[toasts.length - 1]);
  assert.is(out.createCard.ok, false); assert.match(out.createCard.e, /data-modify/);
  assert.is(out.setTags.ok, false); assert.match(out.setTags.e, /data-modify/);
  assert.is(out.setTheme.ok, false); assert.match(out.setTheme.e, /ui-override/);
  assert.is(out.setHighContrast.ok, false); assert.match(out.setHighContrast.e, /ui-override/);
  assert.is(out.getTheme.ok, true, 'read helpers stay open');
  assert.is(out.secretHelper.ok, false, 'unclassified helpers are not reachable');
  assert.equal(calls, [], 'no host write helper ran');
  await Plugin.disable(id);
});

test('ctx.utils write helpers work with the matching permissions', async () => {
  fresh();
  const calls = [];
  installUtils(calls);
  const id = 'utils-all';
  await enableWithGrants(id, { manifest: manifest(id, ['data-modify', 'ui-override']), js: UTILS_JS },
    ['data-modify', 'ui-override']);
  const out = JSON.parse(toasts[toasts.length - 1]);
  assert.ok(out.createCard.ok && out.setTags.ok && out.setTheme.ok && out.setHighContrast.ok);
  assert.is(out.secretHelper.ok, false);
  assert.equal(calls, ['createCard', 'setTags', 'setTheme', 'setHighContrast']);
  await Plugin.disable(id);
});

// ── 4. #370: no unsandboxed function path outside explicit host code ──────

test('register() rejects function-only setup/teardown; registerHostPlugin accepts it', async () => {
  fresh();
  let ran = false;
  const def = { manifest: manifest('fn-plugin'), setup: async () => { ran = true; } };
  assert.throws(() => Plugin.register('fn-plugin', def), /unsandboxed/);
  assert.throws(() => Plugin.register('fn-plugin2', { manifest: manifest('fn-plugin2'), teardown: () => {} }), /unsandboxed/);
  assert.not.ok(Plugin.get('fn-plugin'));
  assert.not.ok(Object.keys(Plugin).includes('registerHostPlugin'), 'host path is non-enumerable');
  Plugin.registerHostPlugin('fn-plugin', def);
  await Plugin.enable('fn-plugin');
  assert.ok(ran, 'explicit host registration still runs host code');
  await Plugin.disable('fn-plugin');
});

test('CardSpoke.registerPlugin() remains the public host-code path', async () => {
  fresh();
  const { CardSpokeAPI } = await import('../www/src/core/global-api.js');
  let ran = false;
  await CardSpokeAPI.registerPlugin('host-fn', { manifest: manifest('host-fn'), setup: () => { ran = true; } });
  assert.ok(ran);
  assert.ok(Plugin.get('host-fn').enabled);
  await Plugin.disable('host-fn');
});

test('install() drops setup/teardown functions and builds a sandboxed definition', async () => {
  fresh();
  let ran = false;
  const id = await Plugin.install({
    manifest: Object.assign(manifest('fn-install'), { layer: 'app' }),
    setup: () => { ran = true; },
    teardown: () => { ran = true; },
    js: 'ctx.logger.info("sandboxed");'
  });
  const inst = Plugin.get(id);
  assert.is(inst.definition.setup, undefined);
  assert.is(inst.definition.teardown, undefined);
  assert.is(inst.definition.js, 'ctx.logger.info("sandboxed");');
  assert.is(inst.context, null, 'no main-thread ctx');
  assert.not.ok(ran);
  const stored = window.store.plugins[id].definition;
  assert.not.ok('setup' in stored);
});

test('dynamic-plugin-loader example installs JSON packages, never import()s code', async () => {
  const src = readFileSync(join(ROOT, 'www/src/examples/dynamic-plugin-loader.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // code only
  assert.not.ok(/\bimport\s*\(/.test(src), 'no dynamic import of plugin modules');
  assert.not.ok(/\.register\(/.test(src), 'does not call Plugin.register');
  fresh();
  global.window.CardSpoke = { Plugin };
  const { installPluginPackage } = await import('../www/src/examples/dynamic-plugin-loader.js');
  let ran = false;
  const id = await installPluginPackage({
    manifest: Object.assign(manifest('remote-pkg'), { layer: 'app' }),
    setup: () => { ran = true; },
    js: 'ctx.logger.info("remote");'
  });
  assert.is(id, 'remote-pkg');
  assert.is(Plugin.get(id).definition.setup, undefined);
  assert.not.ok(ran);
});

// ── 5. Plugin id validation ───────────────────────────────────────────────

test('stored plugin ids: control characters are errors, legacy ids stay loadable', () => {
  const bad = ['a\u0000b', 'line\nbreak', 'x'.repeat(201), ''];
  bad.forEach(id => {
    const r = PluginValidator.validate({ id, manifest: { name: 'n', version: '1.0.0', layer: 'feature' } });
    assert.is(r.valid, false, JSON.stringify(id) + ' must be rejected');
  });
  // Ids earlier releases produced (name-derived or explicit) keep loading
  // after an upgrade, with a warning.
  ['Upper', '-lead', 'trail-', 'a_b', 'focus-mode-(beta)', 'theme-v1.2', "bob's-theme", 'com.acme.focus'].forEach(id => {
    const r = PluginValidator.validate({ id, manifest: { name: 'n', version: '1.0.0', layer: 'feature' } });
    assert.is(r.valid, true, JSON.stringify(id) + ' must stay loadable');
    assert.ok(r.warnings.some(w => /should use lowercase/.test(w)), JSON.stringify(id) + ' must warn');
  });
  ['a', 'good-id', 'a1-b2', 'card-color-tags'].forEach(id => {
    const r = PluginValidator.validate({ id, manifest: { name: 'n', version: '1.0.0', layer: 'feature' } });
    assert.is(r.valid, true, id + ' must be accepted');
    assert.is(r.warnings.filter(w => /Plugin id/.test(w)).length, 0, id + ' must not warn');
  });
});

test('plugin CSS lookup escapes the id inside the selector', () => {
  fresh();
  const seen = [];
  const realQS = document.querySelector;
  document.querySelector = sel => { seen.push(sel); return null; };
  Plugin._findStyle('x"] , style, [data-y="');
  document.querySelector = realQS;
  assert.is(seen.length, 1);
  // The only unescaped quotes are the two delimiting the attribute value.
  assert.is((seen[0].match(/(^|[^\\])"/g) || []).length, 2, seen[0]);
});

test('install() rejects a quoted explicit id and slugifies a name-derived one', async () => {
  fresh();
  let threw = null;
  try {
    await Plugin.install({ manifest: { id: 'bad"]id', name: 'x', version: '1.0.0', layer: 'theme' }, css: '.a{}' });
  } catch (e) { threw = e; }
  assert.ok(threw && /manifest\.id may only contain/.test(threw.message));
  const dotted = await Plugin.install({ manifest: { id: 'com.acme.focus', name: 'x', version: '1.0.0', layer: 'theme' }, css: '.a{}' });
  assert.is(dotted, 'com.acme.focus', 'reverse-DNS ids can be installed');
  const id = await Plugin.install({ manifest: { name: 'My Cool Plugin!', version: '1.0.0', layer: 'theme' }, css: '.a{}' });
  assert.is(id, 'my-cool-plugin');
});

test.run();
