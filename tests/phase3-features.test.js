// Tests for Phase 3 Features
// Covers: Task 3.1 (auto-generated settings UI), 3.2 (conflict warnings),
//         3.3 (dependency checking), 3.4 (sandbox hardening)
import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { installFakeWorkerGlobal } from './helpers/fake-worker-global.js';
import { Plugin, PluginSandbox, resetForTesting } from '../www/src/core/plugin-api.js';
import { Middleware } from '../www/src/core/middleware.js';
import { ComponentRegistry } from '../www/src/core/component-registry.js';
import { Permissions } from '../www/src/core/permissions.js';

installFakeWorkerGlobal();

let PluginManager = null;

test.before(() => {
  resetForTesting();
  Middleware.clear();
  ComponentRegistry.clear();

  global.window = {
    CardSpoke: {
      Plugin,
      Middleware,
      ComponentRegistry,
      Permissions,
      PluginSandbox: { createFunction: PluginSandbox }
    },
    store: {
      cards: {},
      plugins: {}
    },
    createCard: () => 'new-id',
    updateCard: () => {},
    deleteCard: () => {},
    cloneCard: null,
    getTags: () => [],
    addTag: () => true,
    removeTag: () => true,
    setTags: () => true,
    getAllTags: () => [],
    showToast: () => {},
    APP_VERSION: '0.17.0',
    SCHEMA_VERSION: 4,
    save: () => {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    localStorage: {
      _data: {},
      getItem: function(key) { return this._data[key] !== undefined ? this._data[key] : null; },
      setItem: function(key, value) { this._data[key] = value; },
      removeItem: function(key) { delete this._data[key]; },
      get length() { return Object.keys(this._data).length; },
      key: function(i) { return Object.keys(this._data)[i]; }
    }
  };
  global.localStorage = global.window.localStorage;

  // Minimal document mock that supports createElement and attribute tracking
  global.document = {
    querySelector: () => null,
    getElementById: () => null,
    createElement: function(tag) {
      const el = {
        tag,
        type: '',
        id: '',
        checked: false,
        value: '',
        textContent: '',
        innerHTML: '',
        className: '',
        style: {},
        dataset: {},
        _attrs: {},
        _children: [],
        parentNode: null,
        setAttribute: function(k, v) { this._attrs[k] = v; },
        getAttribute: function(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
        appendChild: function(child) {
          if (child && typeof child === 'object') {
            child.parentNode = this;
            this._children.push(child);
          }
        },
        removeChild: function(child) {
          const idx = this._children.indexOf(child);
          if (idx !== -1) this._children.splice(idx, 1);
        },
        replaceChild: function(newChild, oldChild) {
          const idx = this._children.indexOf(oldChild);
          if (idx !== -1) this._children[idx] = newChild;
        },
        insertBefore: function(newChild, refChild) {
          const idx = this._children.indexOf(refChild);
          if (idx !== -1) this._children.splice(idx, 0, newChild);
          else this._children.push(newChild);
        }
      };
      return el;
    },
    createTextNode: function(text) {
      return { nodeType: 3, textContent: text, parentNode: null };
    },
    head: {
      _children: [],
      appendChild: function(child) { this._children.push(child); }
    },
    body: {
      _children: [],
      appendChild: function(child) {
        this._children.push(child);
        child.parentNode = this;
      },
      removeChild: function(child) {
        const idx = this._children.indexOf(child);
        if (idx !== -1) this._children.splice(idx, 1);
      }
    }
  };

  PluginManager = Plugin;
});

// ─── Task 3.2: Conflict Warning System ───────────────────────────────────────

test('Middleware: no warning when priorities differ', () => {
  window.CardSpoke.Middleware.clear();
  const warnings = [];
  const origWarn = console.warn;
  console.warn = function() { warnings.push(Array.from(arguments).join(' ')); };

  window.CardSpoke.Middleware.register({
    name: 'mw-a',
    priority: 10,
    operations: ['card.save'],
    handler: async (ctx, next) => next()
  });
  window.CardSpoke.Middleware.register({
    name: 'mw-b',
    priority: 20,
    operations: ['card.save'],
    handler: async (ctx, next) => next()
  });

  console.warn = origWarn;
  const conflictWarnings = warnings.filter(w => w.includes('Conflict'));
  assert.equal(conflictWarnings.length, 0, 'No conflict warning when priorities differ');
  window.CardSpoke.Middleware.clear();
});

test('Middleware: warns when two middlewares share same priority and operation', () => {
  window.CardSpoke.Middleware.clear();
  const warnings = [];
  const origWarn = console.warn;
  console.warn = function() { warnings.push(Array.from(arguments).join(' ')); };

  window.CardSpoke.Middleware.register({
    name: 'conflict-a',
    priority: 10,
    operations: ['card.save'],
    handler: async (ctx, next) => next()
  });
  window.CardSpoke.Middleware.register({
    name: 'conflict-b',
    priority: 10,
    operations: ['card.save'],
    handler: async (ctx, next) => next()
  });

  console.warn = origWarn;
  const conflictWarnings = warnings.filter(w => w.includes('Conflict'));
  assert.ok(conflictWarnings.length > 0, 'Conflict warning emitted');
  assert.ok(conflictWarnings[0].includes('conflict-b'), 'Warning names the new middleware');
  assert.ok(conflictWarnings[0].includes('conflict-a'), 'Warning names the conflicting middleware');
  window.CardSpoke.Middleware.clear();
});

test('Middleware: wildcard conflicts with named operation at same priority', () => {
  window.CardSpoke.Middleware.clear();
  const warnings = [];
  const origWarn = console.warn;
  console.warn = function() { warnings.push(Array.from(arguments).join(' ')); };

  window.CardSpoke.Middleware.register({
    name: 'wildcard-mw',
    priority: 5,
    operations: ['*'],
    handler: async (ctx, next) => next()
  });
  window.CardSpoke.Middleware.register({
    name: 'specific-mw',
    priority: 5,
    operations: ['card.save'],
    handler: async (ctx, next) => next()
  });

  console.warn = origWarn;
  const conflictWarnings = warnings.filter(w => w.includes('Conflict'));
  assert.ok(conflictWarnings.length > 0, 'Wildcard conflict warning emitted');
  window.CardSpoke.Middleware.clear();
});

test('ComponentRegistry: no warning when priorities differ', () => {
  window.CardSpoke.ComponentRegistry.clear();
  const warnings = [];
  const origWarn = console.warn;
  console.warn = function() { warnings.push(Array.from(arguments).join(' ')); };

  window.CardSpoke.ComponentRegistry.register('Card', { render: () => {} }, 5);
  window.CardSpoke.ComponentRegistry.register('Card', { render: () => {} }, 10);

  console.warn = origWarn;
  const conflictWarnings = warnings.filter(w => w.includes('Conflict'));
  assert.equal(conflictWarnings.length, 0, 'No conflict warning when second has higher priority');
  window.CardSpoke.ComponentRegistry.clear();
});

test('ComponentRegistry: warns when same component re-registered at same priority', () => {
  window.CardSpoke.ComponentRegistry.clear();
  const warnings = [];
  const origWarn = console.warn;
  console.warn = function() { warnings.push(Array.from(arguments).join(' ')); };

  window.CardSpoke.ComponentRegistry.register('Sidebar', { render: () => {} }, 10);
  window.CardSpoke.ComponentRegistry.register('Sidebar', { render: () => {} }, 10);

  console.warn = origWarn;
  const conflictWarnings = warnings.filter(w => w.includes('Conflict'));
  assert.ok(conflictWarnings.length > 0, 'Conflict warning emitted for same-priority re-registration');
  assert.ok(conflictWarnings[0].includes('Sidebar'), 'Warning names the component');
  window.CardSpoke.ComponentRegistry.clear();
});

// ─── Task 3.3: Dependency Checking ───────────────────────────────────────────

test('install() succeeds when all dependencies are present', async () => {
  // First install the dependency
  const depPkg = {
    manifest: { id: 'dep-plugin', name: 'Dep Plugin', version: '1.0.0', layer: 'feature' }
  };
  await PluginManager.install(depPkg);

  // Now install a plugin that depends on it
  const pkg = {
    manifest: {
      id: 'dependent-plugin',
      name: 'Dependent Plugin',
      version: '1.0.0',
      layer: 'feature',
      dependencies: ['dep-plugin']
    }
  };
  const id = await PluginManager.install(pkg);
  assert.equal(id, 'dependent-plugin', 'Plugin installed successfully with dependency met');
});

test('install() throws when a dependency is missing', async () => {
  const pkg = {
    manifest: {
      id: 'needs-missing',
      name: 'Needs Missing',
      version: '1.0.0',
      layer: 'feature',
      dependencies: ['non-existent-plugin']
    }
  };

  try {
    await PluginManager.install(pkg);
    assert.unreachable('Should have thrown for missing dependency');
  } catch (err) {
    assert.ok(err.message.includes('Missing dependencies'), 'Error mentions missing dependencies');
    assert.ok(err.message.includes('non-existent-plugin'), 'Error names the missing dependency');
  }
});

test('install() throws listing all missing dependencies', async () => {
  const pkg = {
    manifest: {
      id: 'needs-two',
      name: 'Needs Two',
      version: '1.0.0',
      layer: 'feature',
      dependencies: ['missing-a', 'missing-b']
    }
  };

  try {
    await PluginManager.install(pkg);
    assert.unreachable('Should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('missing-a'), 'First missing dep listed');
    assert.ok(err.message.includes('missing-b'), 'Second missing dep listed');
  }
});

test('install() succeeds when dependencies array is empty', async () => {
  const pkg = {
    manifest: {
      id: 'no-deps',
      name: 'No Deps',
      version: '1.0.0',
      layer: 'feature',
      dependencies: []
    }
  };
  const id = await PluginManager.install(pkg);
  assert.equal(id, 'no-deps', 'Plugin with empty dependencies array installs normally');
});

// ─── Task 3.1: Auto-Generated Settings UI ────────────────────────────────────

test('buildSettingsPanel returns null for unknown plugin', () => {
  const panel = PluginManager.buildSettingsPanel('does-not-exist');
  assert.equal(panel, null, 'Returns null for unknown plugin');
});

test('buildSettingsPanel returns null when plugin has no config', () => {
  PluginManager.register('no-config-plugin', {
    manifest: { name: 'No Config', version: '1.0.0', layer: 'feature' }
  });
  const panel = PluginManager.buildSettingsPanel('no-config-plugin');
  assert.equal(panel, null, 'Returns null for plugin with no config');
});

test('buildSettingsPanel returns null when plugin config is empty object', () => {
  PluginManager.register('empty-config-plugin', {
    manifest: { name: 'Empty Config', version: '1.0.0', layer: 'feature', config: {} }
  });
  const panel = PluginManager.buildSettingsPanel('empty-config-plugin');
  assert.equal(panel, null, 'Returns null for empty config object');
});

test('buildSettingsPanel generates a panel with correct structure', () => {
  PluginManager.register('settings-test', {
    manifest: {
      name: 'Settings Test',
      version: '1.0.0',
      layer: 'feature',
      config: { theme: 'dark', maxItems: 10, enabled: true }
    }
  });

  const panel = PluginManager.buildSettingsPanel('settings-test');
  assert.ok(panel, 'Panel returned');
  assert.equal(panel.className, 'plugin-settings-panel', 'Panel has correct class');
  assert.equal(panel.getAttribute('data-plugin-id'), 'settings-test', 'Panel has plugin ID attribute');
});

test('buildSettingsPanel creates title element', () => {
  PluginManager.register('title-test', {
    manifest: {
      name: 'Title Test Plugin',
      version: '1.0.0',
      layer: 'feature',
      config: { x: 1 }
    }
  });

  const panel = PluginManager.buildSettingsPanel('title-test');
  assert.ok(panel, 'Panel returned');
  const title = panel._children.find(c => c.tag === 'h3');
  assert.ok(title, 'Title element created');
  assert.ok(title.textContent.includes('Title Test Plugin'), 'Title contains plugin name');
});

test('buildSettingsPanel generates number input for numeric config values', () => {
  PluginManager.register('num-config', {
    manifest: {
      name: 'Num Config',
      version: '1.0.0',
      layer: 'feature',
      config: { maxItems: 42 }
    }
  });

  const panel = PluginManager.buildSettingsPanel('num-config');
  assert.ok(panel, 'Panel returned');
  const rows = panel._children.filter(c => c.className === 'plugin-settings-row');
  assert.ok(rows.length > 0, 'Rows created');
  const input = rows[0]._children.find(c => c.type === 'number');
  assert.ok(input, 'Number input created for numeric value');
  assert.equal(input.value, '42', 'Input value matches config value');
});

test('buildSettingsPanel generates checkbox for boolean config values', () => {
  PluginManager.register('bool-config', {
    manifest: {
      name: 'Bool Config',
      version: '1.0.0',
      layer: 'feature',
      config: { enabled: true }
    }
  });

  const panel = PluginManager.buildSettingsPanel('bool-config');
  assert.ok(panel, 'Panel returned');
  const rows = panel._children.filter(c => c.className === 'plugin-settings-row');
  const input = rows[0]._children.find(c => c.type === 'checkbox');
  assert.ok(input, 'Checkbox input created for boolean value');
  assert.equal(input.checked, true, 'Checkbox reflects config value');
});

test('buildSettingsPanel generates text input for string config values', () => {
  PluginManager.register('str-config', {
    manifest: {
      name: 'Str Config',
      version: '1.0.0',
      layer: 'feature',
      config: { theme: 'dark' }
    }
  });

  const panel = PluginManager.buildSettingsPanel('str-config');
  assert.ok(panel, 'Panel returned');
  const rows = panel._children.filter(c => c.className === 'plugin-settings-row');
  const input = rows[0]._children.find(c => c.type === 'text');
  assert.ok(input, 'Text input created for string value');
  assert.equal(input.value, 'dark', 'Input value matches config string');
});

test('buildSettingsPanel input onchange updates live config and context', async () => {
  window.CardSpoke.Permissions.grantPermissions('live-config', ['plugin-code', ]);
  PluginManager.register('live-config', {
    manifest: {
      name: 'Live Config',
      version: '1.0.0',
      layer: 'feature',
      config: { count: 5 }
    }
  });
  await PluginManager.enable('live-config');

  const panel = PluginManager.buildSettingsPanel('live-config');
  const rows = panel._children.filter(c => c.className === 'plugin-settings-row');
  const input = rows[0]._children.find(c => c.type === 'number');
  assert.ok(input, 'Number input found');

  // Simulate a change
  input.value = '99';
  input.onchange();

  const instance = PluginManager.get('live-config');
  assert.equal(instance.definition.manifest.config.count, 99, 'manifest.config updated after onchange');
  assert.equal(instance.context.config.count, 99, 'context.config updated after onchange');

  await PluginManager.disable('live-config');
});

// ─── Task 3.4: Sandbox Hardening (CS-002, resolved: real Worker isolation) ──
//
// Plugin JS is no longer compiled into a callable main-thread `setup`
// function at all — it runs inside a dedicated Worker sandbox instead. These
// two tests now prove the actual, stronger claim: the code really executes,
// and it executes with no ambient access outside its permission-gated
// ctx.api (observed here via a storage side-channel — ctx.api.ui.showToast
// resolves through an InternalAPI reference other tests in this file may
// have already captured, so it isn't a reliable "did it run" signal).

test('install() runs plugin JS inside a sandboxed worker, not a main-thread function', async () => {
  window.CardSpoke.Permissions.grantPermissions('sandbox-test', ['plugin-code', 'storage']);

  const pkg = {
    manifest: {
      id: 'sandbox-test',
      name: 'Sandbox Test',
      version: '1.0.0',
      layer: 'feature',
      permissions: ['storage']
    },
    js: "await ctx.api.storage.set('marker', 'ran');"
  };

  const id = await PluginManager.install(pkg);
  const instance = PluginManager.get(id);

  assert.not.ok(instance.definition.setup, 'No main-thread setup function is created for string-form js');
  assert.equal(window.localStorage.getItem('plugin_sandbox-test_marker'), '"ran"', 'The plugin JS actually executed, inside its sandboxed worker');
});

test('sandboxed plugin JS has no ambient access to document, window, or fetch', async () => {
  window.CardSpoke.Permissions.grantPermissions('sandbox-isolation-test', ['plugin-code', 'storage']);

  const pkg = {
    manifest: {
      id: 'sandbox-isolation-test',
      name: 'Sandbox Isolation Test',
      version: '1.0.0',
      layer: 'feature',
      permissions: ['storage']
    },
    js: "await ctx.api.storage.set('probe', { doc: typeof document, win: typeof window, fetch: typeof fetch });"
  };

  await PluginManager.install(pkg);

  const probe = JSON.parse(window.localStorage.getItem('plugin_sandbox-isolation-test_probe'));
  assert.equal(probe.doc, 'undefined', 'document is unreachable inside the worker');
  assert.equal(probe.win, 'undefined', 'window is unreachable inside the worker');
  assert.equal(probe.fetch, 'undefined', 'raw fetch is unreachable inside the worker (only ctx.api.network.fetch is)');
});

test('syncFromStore reconstructs a plugin from its persisted js string but no callable setup', async () => {
  window.CardSpoke.Permissions.grantPermissions('sandbox-sync-test', ['plugin-code', 'storage']);

  window.store.plugins['sandbox-sync-test'] = {
    definition: {
      manifest: { name: 'Sandbox Sync Test', version: '1.0.0', layer: 'feature', permissions: ['storage'] },
      setup: null,
      teardown: null,
      js: "await ctx.api.storage.set('marker', 'ran');"
    },
    enabled: false
  };

  PluginManager.unregister('sandbox-sync-test');
  await PluginManager.syncFromStore(true); // safeMode = true, only register, do not enable

  const instance = PluginManager.get('sandbox-sync-test');
  assert.ok(instance, 'Plugin re-registered');
  assert.not.ok(instance.definition.setup, 'No main-thread setup function is reconstructed from the js string');
  assert.not.ok(instance.enabled, 'safeMode leaves it suspended, so its worker never ran');
});

// Real, unterminated worker_threads.Worker instances keep the Node process
// alive after the test file's assertions finish — every enabled plugin here
// runs inside a genuine worker thread, so it must be disabled (which
// terminates its worker) before uvu is done, or the process hangs.
test.after(async () => {
  for (const instance of PluginManager.list()) {
    if (instance.enabled) await PluginManager.disable(instance.id);
  }
});

test.run();
