/**
 * Mod System Review Tests
 *
 * Focused regression tests for bugs identified during the mod system review:
 *
 *  Bug 1 – permissions.js: PERMISSION_DESCRIPTIONS was missing 'data-modify'
 *  Bug 2 – plugin-api.js: createUIApi / createDataApi / createEventApi each
 *           captured `pluginResources.get(id) || new Set()` at context-creation
 *           time, before register() had inserted the shared Set, so resources
 *           were tracked in orphaned Sets that _cleanupResources() could not reach.
 *  Bug 3 – plugin-api.js: unregister() called `this.disable()` without `await`,
 *           so async teardown was not completed before resource cleanup ran.
 *  Bug 4 – permissions.js: loadPermissions() / savePermissions() accessed
 *           `localStorage` without a typeof guard, throwing in Node environments.
 *  Bug 5 – plugin-api.js: assessModRisk() checked only `pkg.setup` / `pkg.teardown`
 *           for hasJS, ignoring raw `pkg.js` / `pkg.javascript` strings, so
 *           theme packages with only a JS string could be mis-classified as SAFE.
 */

import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { Plugin, resetForTesting } from '../www/src/core/plugin-api.js';
import { Permissions } from '../www/src/core/permissions.js';
import { ComponentRegistry } from '../www/src/core/component-registry.js';

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

function makeWindow() {
  return {
    CardSpoke: { Plugin, Permissions },
    store: {
      cards: {
        'card-1': { id: 'card-1', title: 'Test Card', body: '', tags: [], children: [], parentId: null }
      },
      plugins: {}
    },
    createCard: (title, body, parentId) => 'new-id',
    updateCard: () => {},
    deleteCard: () => {},
    cloneCard: (card) => Object.assign({}, card),
    getTags: () => [],
    addTag: () => true,
    removeTag: () => true,
    setTags: () => true,
    getAllTags: () => [],
    showToast: () => {},
    APP_VERSION: '0.17.0',
    SCHEMA_VERSION: 4,
    save: () => {},
    localStorage: {
      _data: {},
      getItem(key) { return this._data[key] !== undefined ? this._data[key] : null; },
      setItem(key, value) { this._data[key] = value; },
      removeItem(key) { delete this._data[key]; },
      get length() { return Object.keys(this._data).length; },
      key(i) { return Object.keys(this._data)[i]; }
    }
  };
}

function makeDocument() {
  // Minimal DOM mock that supports the operations used by the plugin API.
  // querySelector always returns null so inject/replace short-circuits cleanly.
  return {
    querySelector: () => null,
    getElementById: () => null,
    createElement: (tag) => ({
      tag,
      style: {},
      textContent: '',
      innerHTML: '',
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild: () => {},
      parentNode: null,
      dataset: {}
    }),
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, removeChild: () => {} }
  };
}

// ===========================================================================
// Bug 1: PERMISSION_DESCRIPTIONS missing 'data-modify'
// ===========================================================================

test('Permissions.listAvailablePermissions includes data-modify', () => {
  const list = Permissions.listAvailablePermissions();
  const names = list.map(p => p.name);
  assert.ok(names.includes('data-modify'), 'data-modify is in the available permissions list');
});

test('Permissions.getPermissionDescription returns description for data-modify', () => {
  const desc = Permissions.getPermissionDescription('data-modify');
  assert.not.equal(desc, 'Unknown permission', 'data-modify has a real description, not "Unknown permission"');
  assert.ok(desc.length > 0, 'data-modify description is non-empty');
});

// ===========================================================================
// Bug 2: Resources tracked by API methods must be in the shared Set
//         so that _cleanupResources cleans them up on disable.
// ===========================================================================

test('component registered via ctx.api.ui is unregistered when plugin is disabled', async () => {
  resetForTesting();
  global.window = makeWindow();
  global.localStorage = global.window.localStorage;
  global.document = makeDocument();
  ComponentRegistry.clear();

  // Grant ui-override so registerComponent doesn't throw
  Permissions.grantPermissions('ui-component-cleanup-test', ['ui-override']);

  Plugin.registerHostPlugin('ui-component-cleanup-test', {
    manifest: {
      name: 'UI Component Cleanup Test',
      version: '1.0.0',
      layer: 'feature',
      permissions: ['ui-override']
    },
    setup: async function(ctx) {
      ctx.api.ui.registerComponent('ReviewTestCard', {
        render: function(props) { return document.createElement('div'); },
        priority: 5
      });
    }
  });

  await Plugin.enable('ui-component-cleanup-test');
  assert.ok(ComponentRegistry.has('ReviewTestCard'), 'Component is registered after plugin enable');

  await Plugin.disable('ui-component-cleanup-test');
  assert.not.ok(ComponentRegistry.has('ReviewTestCard'), 'Component is unregistered after plugin disable (orphaned Set bug fix)');

  Permissions.revokePermissions('ui-component-cleanup-test');
});

test('data onUpdate listener is cleaned up when plugin is disabled', async () => {
  resetForTesting();
  global.window = makeWindow();
  global.localStorage = global.window.localStorage;
  global.document = makeDocument();

  let callCount = 0;

  Plugin.registerHostPlugin('data-listener-cleanup-test', {
    manifest: { name: 'Data Listener Cleanup Test', version: '1.0.0', layer: 'feature' },
    setup: async function(ctx) {
      ctx.api.data.onUpdate(function() { callCount++; });
    }
  });

  await Plugin.enable('data-listener-cleanup-test');

  // Verify the listener is wired up
  Plugin.notifyDataUpdate({ type: 'card.save' });
  assert.equal(callCount, 1, 'Listener fires while plugin is enabled');

  await Plugin.disable('data-listener-cleanup-test');

  // After disable, notifyDataUpdate should NOT reach the listener
  Plugin.notifyDataUpdate({ type: 'card.save' });
  assert.equal(callCount, 1, 'Listener does not fire after plugin is disabled (cleanup fix)');
});

test('event bus handler is removed when plugin is disabled', async () => {
  resetForTesting();
  global.window = makeWindow();
  global.localStorage = global.window.localStorage;
  global.document = makeDocument();

  let received = 0;

  Plugin.registerHostPlugin('event-cleanup-test', {
    manifest: { name: 'Event Cleanup Test', version: '1.0.0', layer: 'feature' },
    setup: async function(ctx) {
      ctx.api.events.on('test:ping', function() { received++; });
    }
  });

  await Plugin.enable('event-cleanup-test');

  // Find a sibling plugin context to fire events via the same bus
  const instance = Plugin.get('event-cleanup-test');
  instance.context.api.events.emit('test:ping');
  assert.equal(received, 1, 'Event handler fires while plugin is enabled');

  await Plugin.disable('event-cleanup-test');

  instance.context.api.events.emit('test:ping');
  assert.equal(received, 1, 'Event handler does not fire after plugin is disabled (event cleanup fix)');
});

// ===========================================================================
// Bug 3: unregister() must await disable() so teardown completes before cleanup
// ===========================================================================

test('unregister awaits teardown before completing', async () => {
  resetForTesting();
  global.window = makeWindow();
  global.localStorage = global.window.localStorage;
  global.document = makeDocument();
  ComponentRegistry.clear();

  const log = [];

  Permissions.grantPermissions('unregister-async-test', ['ui-override']);

  Plugin.registerHostPlugin('unregister-async-test', {
    manifest: {
      name: 'Unregister Async Test',
      version: '1.0.0',
      layer: 'feature',
      permissions: ['ui-override']
    },
    setup: async function(ctx) {
      ctx.api.ui.registerComponent('UnregisterTestComp', {
        render: () => document.createElement('div'),
        priority: 1
      });
      log.push('setup');
    },
    teardown: async function(ctx) {
      // Async teardown: resolve on next microtask
      await new Promise(resolve => setTimeout(resolve, 0));
      log.push('teardown');
    }
  });

  await Plugin.enable('unregister-async-test');
  assert.ok(ComponentRegistry.has('UnregisterTestComp'), 'Component registered after enable');

  await Plugin.unregister('unregister-async-test');

  // teardown must have been awaited before unregister resolves
  assert.ok(log.includes('teardown'), 'Teardown was called during unregister');
  // Component should be cleaned up (disable happens before cleanup)
  assert.not.ok(ComponentRegistry.has('UnregisterTestComp'), 'Component unregistered after unregister()');

  Permissions.revokePermissions('unregister-async-test');
});

// ===========================================================================
// Bug 4: loadPermissions / savePermissions must guard typeof localStorage
//         (validated implicitly — test suite runs in Node where localStorage is
//         not a global; previous code threw instead of no-op)
// ===========================================================================

test('Permissions module loads without error in environments without localStorage', () => {
  // If this test file was imported without error and Permissions is defined,
  // the localStorage guard is working (the module-level loadPermissions() call
  // in permissions.js would have thrown before the fix).
  assert.ok(Permissions, 'Permissions module loaded successfully');
  assert.type(Permissions.hasPermission, 'function');
  assert.type(Permissions.grantPermissions, 'function');
});

// ===========================================================================
// Bug 5: assessModRisk must treat pkg.js / pkg.javascript strings as JS
//         so theme packages with only a JS string are not mis-classified SAFE.
// ===========================================================================

test('assessModRisk classifies theme package with pkg.js string as not SAFE', () => {
  const pkg = {
    manifest: { layer: 'theme' },
    css: ':root { --bg: white; }',
    js: 'console.log("sneaky");',
    // no setup / teardown functions
  };
  const risk = Plugin.assessModRisk(pkg);
  assert.not.equal(risk, 'SAFE', 'Theme plugin with JS string is not SAFE (assessModRisk fix)');
});

test('assessModRisk classifies pure CSS theme package as SAFE', () => {
  const pkg = {
    manifest: { layer: 'theme' },
    css: ':root { --bg: white; }',
    js: '',
  };
  const risk = Plugin.assessModRisk(pkg);
  assert.equal(risk, 'SAFE', 'Pure CSS theme plugin is SAFE');
});

test('assessModRisk classifies feature plugin with pkg.js string as LOW', () => {
  // The feature layer is the JS-carrying tier; enabling it always goes through
  // the full-trust consent dialog, so LOW means "auto-enables after consent",
  // not "runs ungated".
  const pkg = {
    manifest: { layer: 'feature' },
    js: '(function(){ console.log("feature"); })();',
    // no setup function yet (raw JSON before install())
  };
  const risk = Plugin.assessModRisk(pkg);
  assert.equal(risk, 'LOW', 'Feature plugin with raw JS string is LOW risk');
});

test('assessModRisk classifies feature plugin with pkg.javascript string as LOW', () => {
  const pkg = {
    manifest: { layer: 'feature' },
    javascript: '(function(){ console.log("feature"); })();',
  };
  const risk = Plugin.assessModRisk(pkg);
  assert.equal(risk, 'LOW', 'Feature plugin with raw javascript string is LOW risk');
});

test.run();
