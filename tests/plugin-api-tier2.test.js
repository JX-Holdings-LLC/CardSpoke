// Tests for Plugin API - InternalAPI abstraction and validation integration
import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { Plugin, PluginSandbox, resetForTesting } from '../www/src/core/plugin-api.js';
import { PluginValidator } from '../www/src/core/plugin-validator.js';

let PluginManager = null;
let Validator = null;

// Set up fresh window/document and load modules before tests run.
test.before(() => {
  resetForTesting();

  global.window = {
    CardSpoke: {
      Plugin,
      PluginValidator,
      PluginSandbox: { createFunction: PluginSandbox }
    },
    store: {
      cards: {
        'card-1': { id: 'card-1', title: 'Test Card', body: 'Test body', tags: [], children: [], parentId: null }
      }
    },
    createCard: (title, body, parentId) => 'new-card-id',
    updateCard: (id, updates) => {},
    deleteCard: (id) => {},
    cloneCard: (card) => Object.assign({}, card),
    getTags: (cardId) => [],
    addTag: (cardId, tag) => true,
    removeTag: (cardId, tag) => true,
    setTags: (cardId, tags) => true,
    getAllTags: () => [],
    showToast: (msg, type) => {},
    APP_VERSION: '0.17.0',
    SCHEMA_VERSION: 4,
    localStorage: {
      _data: {},
      getItem: function(key) { return this._data[key] || null; },
      setItem: function(key, value) { this._data[key] = value; },
      removeItem: function(key) { delete this._data[key]; },
      get length() { return Object.keys(this._data).length; },
      key: function(i) { return Object.keys(this._data)[i]; }
    }
  };
  global.localStorage = global.window.localStorage;

  global.document = {
    querySelector: (sel) => null,
    createElement: (tag) => ({
      tag,
      style: {},
      textContent: '',
      setAttribute: () => {},
      appendChild: () => {},
      parentNode: null,
      dataset: {}
    }),
    head: { appendChild: () => {} }
  };

  PluginManager = Plugin;
  Validator = PluginValidator;
});

test('Plugin API initializes with InternalAPI support', () => {
  assert.ok(PluginManager, 'Plugin manager exists');
  assert.type(PluginManager.register, 'function');
  assert.type(PluginManager.enable, 'function');
  assert.type(PluginManager.disable, 'function');
});

test('Plugin registration validates content when validator available', () => {
  // Register a valid plugin
  PluginManager.register('valid-plugin', {
    manifest: {
      name: 'Valid Plugin',
      version: '1.0.0',
      layer: 'feature',
      author: 'Test'
    }
  });

  const instance = PluginManager.get('valid-plugin');
  assert.ok(instance, 'Valid plugin registered');
});

test('Plugin with invalid manifest is rejected', () => {
  try {
    PluginManager.register('invalid-plugin', {
      manifest: {
        name: 'Bad Plugin',
        version: '1.0.0',
        layer: 'invalid-layer'
      }
    });
    assert.unreachable('Should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('validation failed'), 'Validation error thrown');
  }
});

test('Plugin with eval() in JS is rejected', () => {
  try {
    PluginManager.register('eval-plugin', {
      manifest: {
        name: 'Eval Plugin',
        version: '1.0.0',
        layer: 'feature'
      },
      js: 'var x = eval("1+1");'
    });
    assert.unreachable('Should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('eval()'), 'eval() rejected');
  }
});

test('Plugin CSS with dangerous patterns is sanitized during validation', () => {
  // CSS sanitization happens via the validator
  const result = Validator.validateCSS('@import url("evil.css"); .safe { color: blue; }');
  assert.not.ok(result.sanitized.includes('@import'), '@import removed from CSS');
  assert.ok(result.sanitized.includes('.safe'), 'Safe CSS preserved');
});

test('Plugin data API uses stable internal references', async () => {
  // Ensure store has our test card
  window.store = window.store || {};
  window.store.cards = window.store.cards || {};
  window.store.cards['card-1'] = { id: 'card-1', title: 'Test Card', body: 'Test body', tags: [], children: [], parentId: null };

  // Register and enable a plugin without permissions to skip dialog
  const origCreateCard = window.createCard;
  
  PluginManager.registerHostPlugin('api-test-plugin', {
    manifest: {
      name: 'API Test',
      version: '1.0.0',
      layer: 'feature'
    },
    setup: async function(ctx) {}
  });

  await PluginManager.enable('api-test-plugin');
  
  const instance = PluginManager.get('api-test-plugin');
  assert.ok(instance.enabled, 'Plugin enabled');
  
  // Now overwrite window.cloneCard
  const origCloneCard = window.cloneCard;
  window.cloneCard = null;
  
  // The data API should still work because InternalAPI captured the reference
  const ctx = instance.context;
  const card = ctx.api.data.getCard('card-1');
  assert.ok(card, 'getCard works via InternalAPI after window override');
  assert.equal(card.title, 'Test Card', 'Card data correct');
  
  // Restore
  window.cloneCard = origCloneCard;
  window.createCard = origCreateCard;
  
  // Cleanup
  await PluginManager.disable('api-test-plugin');
});

test('Plugin context has correct structure', () => {
  PluginManager.register('context-test', {
    manifest: {
      name: 'Context Test',
      version: '1.0.0',
      layer: 'feature'
    }
  });

  const instance = PluginManager.get('context-test');
  const ctx = instance.context;

  assert.equal(ctx.modId, 'context-test', 'Plugin ID set');
  assert.ok(ctx.api, 'API exists');
  assert.ok(ctx.api.ui, 'UI API exists');
  assert.ok(ctx.api.data, 'Data API exists');
  assert.ok(ctx.api.storage, 'Storage API exists');
  assert.ok(ctx.api.events, 'Events API exists');
  assert.ok(ctx.logger, 'Logger exists');
});

test.run();
