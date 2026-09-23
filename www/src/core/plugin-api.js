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


// Plugin API System
// Provides sandboxed contexts and resource management for plugins
// with isolated contexts and automatic cleanup support

import { PluginValidator } from './plugin-validator.js';
import { Permissions } from './permissions.js';
import { ComponentRegistry } from './component-registry.js';
import { Middleware } from './middleware.js';
import { createPluginWorker } from './plugin-worker-manager.js';
import { dispatch } from './plugin-rpc.js';
import { vnodeToDOM, updateElementFromVnode, applyPatch } from './plugin-vnode.js';

const plugins = new Map();
const pluginResources = new Map();
const dataUpdateListeners = new Map();
let nextDomHandleId = 1;

  // Task 1.5: Central global event bus for cross-plugin communication
  // Handlers stored as { pluginId, callback } entries per event name
  const globalEventBus = new Map();

  // Plugin ids that currently have a live Card render hook — either they own
  // the `Card` slot in ComponentRegistry, or they registered at least one
  // `card.render` decorator. rendering.js consults this to know which
  // plugin workers to fan a render batch out to; it is empty (and the whole
  // batch/RPC path is skipped entirely) for the common case of no such
  // plugins installed.
  const cardRenderPluginIds = new Set();
  // The two halves of that membership, tracked separately so renderBatch can
  // honour only what the host actually accepted: a replacement vnode only
  // from the plugin that owns the `Card` slot, a decorator patch only from
  // a plugin with an accepted card.render registration.
  const cardComponentPluginIds = new Set();
  const cardDecorators = new Map(); // pluginId -> Set<decorator name>

  function syncCardRenderMembership(pluginId) {
    const decorators = cardDecorators.get(pluginId);
    if (cardComponentPluginIds.has(pluginId) || (decorators && decorators.size > 0)) {
      cardRenderPluginIds.add(pluginId);
    } else {
      cardRenderPluginIds.delete(pluginId);
    }
  }

  function setCardComponentOwner(pluginId, owns) {
    if (owns) cardComponentPluginIds.add(pluginId);
    else cardComponentPluginIds.delete(pluginId);
    syncCardRenderMembership(pluginId);
  }

  function addCardDecorator(pluginId, name) {
    let names = cardDecorators.get(pluginId);
    if (!names) { names = new Set(); cardDecorators.set(pluginId, names); }
    names.add(name);
    syncCardRenderMembership(pluginId);
  }

  function removeCardDecorator(pluginId, name) {
    const names = cardDecorators.get(pluginId);
    if (names) {
      names.delete(name);
      if (names.size === 0) cardDecorators.delete(pluginId);
    }
    syncCardRenderMembership(pluginId);
  }

  function clearCardRender(pluginId) {
    cardComponentPluginIds.delete(pluginId);
    cardDecorators.delete(pluginId);
    cardRenderPluginIds.delete(pluginId);
  }

  // Stable internal references to core functions (Phase 1.3)
  // Captured at initialization time to prevent plugins from
  // breaking the app by overwriting window functions
  const InternalAPI = {
    data: {},
    ui: {},
    utils: {}
  };

  // Capture core function references once they become available
  // Only captures each reference once to avoid redundant work
  function captureInternalReferences() {
    // Data operations
    if (!InternalAPI.data.createCard && window.createCard) InternalAPI.data.createCard = window.createCard;
    if (!InternalAPI.data.updateCard && window.updateCard) InternalAPI.data.updateCard = window.updateCard;
    if (!InternalAPI.data.deleteCard && window.deleteCard) InternalAPI.data.deleteCard = window.deleteCard;
    if (!InternalAPI.utils.cloneCard && window.cloneCard) InternalAPI.utils.cloneCard = window.cloneCard;
    // Tag operations
    if (!InternalAPI.data.getTags && window.getTags) InternalAPI.data.getTags = window.getTags;
    if (!InternalAPI.data.addTag && window.addTag) InternalAPI.data.addTag = window.addTag;
    if (!InternalAPI.data.removeTag && window.removeTag) InternalAPI.data.removeTag = window.removeTag;
    if (!InternalAPI.data.setTags && window.setTags) InternalAPI.data.setTags = window.setTags;
    if (!InternalAPI.data.getAllTags && window.getAllTags) InternalAPI.data.getAllTags = window.getAllTags;
    // UI operations
    if (!InternalAPI.ui.showToast && window.showToast) InternalAPI.ui.showToast = window.showToast;
  }

  // Helper function to check permissions. The grant must be bound to the
  // registered build of this plugin (its fingerprint): a grant made for
  // different code under the same id never satisfies a runtime check.
  function hasPermission(pluginId, permission) {
    if (Permissions) {
      const instance = plugins.get(pluginId);
      const fingerprint = instance ? instance.fingerprint : undefined;
      return Permissions.hasPermission(pluginId, permission, fingerprint);
    }
    // Fallback - auto-grant if permissions system not available
    return true;
  }

  function trackResource(pluginId, resource) {
    const resources = pluginResources.get(pluginId) || new Set();
    resources.add(resource);
    return resource;
  }

  // ---------------------------------------------------------------------
  // ctx.api.data / ctx.api.storage / ctx.api.events / ctx.api.filesystem
  //
  // These four surfaces are plain data in, plain data (or an already-async
  // Promise) out — nothing DOM-shaped crosses through them. That means the
  // exact same implementation serves BOTH callers:
  //   - a plugin registered with a real function (`registerPlugin`, session-
  //     only "host code" per PLUGIN_INVARIANTS.md — never sandboxed, since
  //     functions can't come from a persisted/untrusted package) calls these
  //     directly as `ctx.api.data.getCard(...)`.
  //   - a sandboxed, worker-hosted plugin reaches them via the RPC
  //     dispatcher below, which calls the identical function with the
  //     identical arguments.
  // ---------------------------------------------------------------------

  function createDataApi(pluginId) {
    return {
      onUpdate: function(callback) {
        const listeners = dataUpdateListeners.get(pluginId) || [];
        listeners.push(callback);
        dataUpdateListeners.set(pluginId, listeners);

        const resource = trackResource(pluginId, { type: 'listener', callback: callback });

        return function() {
          const idx = listeners.indexOf(callback);
          if (idx !== -1) listeners.splice(idx, 1);
          const resources = pluginResources.get(pluginId);
          if (resources) resources.delete(resource);
        };
      },

      offUpdate: function(callback) {
        const listeners = dataUpdateListeners.get(pluginId);
        if (!listeners) return;
        const idx = listeners.indexOf(callback);
        if (idx !== -1) listeners.splice(idx, 1);
      },

      getCard: function(id) {
        if (window.store && window.store.cards && window.store.cards[id]) {
          var cloneFn = InternalAPI.utils.cloneCard || window.cloneCard;
          if (cloneFn) return cloneFn(window.store.cards[id]);
          if (typeof structuredClone === 'function') return structuredClone(window.store.cards[id]);
          return JSON.parse(JSON.stringify(window.store.cards[id]));
        }
        return undefined;
      },

      listCards: function() {
        if (window.store && window.store.cards) {
          var cloneFn = InternalAPI.utils.cloneCard || window.cloneCard;
          return Object.values(window.store.cards).map(function(card) {
            if (cloneFn) return cloneFn(card);
            if (typeof structuredClone === 'function') return structuredClone(card);
            return JSON.parse(JSON.stringify(card));
          });
        }
        return [];
      },

      createCard: function(data) {
        if (!hasPermission(pluginId, 'data-modify')) {
          throw new Error('Plugin does not have data-modify permission');
        }

        var fn = InternalAPI.data.createCard || window.createCard;
        if (fn) {
          // Apply tags in the same call so plugins don't need a second
          // permission-gated round-trip for a common creation pattern.
          // When tags are supplied, suppress the host's card.create hooks so
          // they fire ONCE below with the finished (tagged) card, not with an
          // intermediate untagged one that tag-aware listeners would misread.
          var hasTags = Array.isArray(data.tags) && data.tags.length > 0;
          var newId = fn(data.title || '', data.body || '', data.parentId || null, false, hasTags);
          if (hasTags && newId) {
            var setTagsFn = InternalAPI.data.setTags || window.setTags;
            if (setTagsFn) {
              setTagsFn(newId, data.tags);
            }
            var createdCard = (window.store && window.store.cards) ? window.store.cards[newId] : undefined;
            if (window.CardSpoke && window.CardSpoke.Middleware) {
              window.CardSpoke.Middleware.run('card.create', [newId, createdCard])
                .catch(function(err) { console.error('[Middleware] card.create error:', err); });
            }
            PluginManager.notifyDataUpdate({ type: 'card.create', cardId: newId, card: createdCard });
          }
          return newId;
        }
        throw new Error('createCard not available');
      },

      updateCard: function(id, updates) {
        if (!hasPermission(pluginId, 'data-modify')) {
          throw new Error('Plugin does not have data-modify permission');
        }

        var fn = InternalAPI.data.updateCard || window.updateCard;
        if (fn) {
          fn(id, updates, false, false);
          return this.getCard(id);
        }
        throw new Error('updateCard not available');
      },

      deleteCard: function(id) {
        if (!hasPermission(pluginId, 'data-modify')) {
          throw new Error('Plugin does not have data-modify permission');
        }

        var fn = InternalAPI.data.deleteCard || window.deleteCard;
        if (fn) {
          fn(id);
          return true;
        }
        return false;
      },

      getTags: function(cardId) {
        var fn = InternalAPI.data.getTags || window.getTags;
        if (fn) return fn(cardId);
        return [];
      },

      addTag: function(cardId, tag) {
        if (!hasPermission(pluginId, 'data-modify')) {
          throw new Error('Plugin does not have data-modify permission');
        }
        var fn = InternalAPI.data.addTag || window.addTag;
        if (fn) return fn(cardId, tag);
        return false;
      },

      removeTag: function(cardId, tag) {
        if (!hasPermission(pluginId, 'data-modify')) {
          throw new Error('Plugin does not have data-modify permission');
        }
        var fn = InternalAPI.data.removeTag || window.removeTag;
        if (fn) return fn(cardId, tag);
        return false;
      },

      setTags: function(cardId, tags) {
        if (!hasPermission(pluginId, 'data-modify')) {
          throw new Error('Plugin does not have data-modify permission');
        }
        var fn = InternalAPI.data.setTags || window.setTags;
        if (fn) return fn(cardId, tags);
        return false;
      },

      getAllTags: function() {
        var fn = InternalAPI.data.getAllTags || window.getAllTags;
        if (fn) return fn();
        return [];
      }
    };
  }

  function createStorageApi(pluginId) {
    const namespace = 'plugin_' + pluginId + '_';

    return {
      getNamespace: function() {
        return namespace;
      },

      get: async function(key) {
        if (!hasPermission(pluginId, 'storage')) {
          throw new Error('Plugin does not have storage permission');
        }
        const fullKey = namespace + key;
        if (window.storageDriver && window.storageDriver.get) {
          return await window.storageDriver.get(fullKey);
        }
        const raw = localStorage.getItem(fullKey);
        if (raw === null) return null;
        try { return JSON.parse(raw); } catch (e) { return raw; }
      },

      set: async function(key, value) {
        if (!hasPermission(pluginId, 'storage')) {
          throw new Error('Plugin does not have storage permission');
        }
        const fullKey = namespace + key;
        if (window.storageDriver && window.storageDriver.set) {
          return await window.storageDriver.set(fullKey, value);
        }
        localStorage.setItem(fullKey, JSON.stringify(value));
      },

      remove: async function(key) {
        if (!hasPermission(pluginId, 'storage')) {
          throw new Error('Plugin does not have storage permission');
        }
        const fullKey = namespace + key;
        if (window.storageDriver && window.storageDriver.remove) {
          return await window.storageDriver.remove(fullKey);
        }
        localStorage.removeItem(fullKey);
      },

      list: async function(prefix) {
        if (!hasPermission(pluginId, 'storage')) {
          throw new Error('Plugin does not have storage permission');
        }
        const fullPrefix = namespace + (prefix || '');
        if (window.storageDriver && window.storageDriver.list) {
          return await window.storageDriver.list(fullPrefix);
        }
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(fullPrefix)) {
            keys.push(key.substring(namespace.length));
          }
        }
        return keys;
      }
    };
  }

  function createEventApi(pluginId) {
    // Task 1.5: Use global event bus for cross-plugin communication while
    // preserving per-plugin ctx.api.events interface. `callback` here may be
    // a plain function (legacy host-code plugins) or an RPC remote-callback
    // stub (sandboxed plugins) — both are just "a function to call later" as
    // far as this bus is concerned.
    return {
      on: function(event, callback) {
        if (!globalEventBus.has(event)) globalEventBus.set(event, []);
        const handlers = globalEventBus.get(event);
        handlers.push({ pluginId: pluginId, callback: callback });

        const resource = trackResource(pluginId, { type: 'event', event: event, callback: callback });

        return function() {
          const list = globalEventBus.get(event);
          if (list) {
            const idx = list.findIndex(function(h) { return h.callback === callback && h.pluginId === pluginId; });
            if (idx !== -1) list.splice(idx, 1);
          }
          const resources = pluginResources.get(pluginId);
          if (resources) resources.delete(resource);
        };
      },

      emit: function(event, args) {
        const handlers = globalEventBus.get(event);
        if (handlers) {
          const callArgs = Array.isArray(args) ? args : Array.prototype.slice.call(arguments, 1);
          handlers.slice().forEach(function(entry) {
            try {
              const result = entry.callback.apply(null, callArgs);
              if (result && typeof result.catch === 'function') result.catch(err => console.error('[EventBus] Handler error in plugin ' + entry.pluginId + ':', err));
            } catch (err) {
              console.error('[EventBus] Handler error in plugin ' + entry.pluginId + ':', err);
            }
          });
        }
      },

      off: function(event, callback) {
        const list = globalEventBus.get(event);
        if (list) {
          const idx = list.findIndex(function(h) { return h.callback === callback && h.pluginId === pluginId; });
          if (idx !== -1) list.splice(idx, 1);
        }
      }
    };
  }

  function createFilesystemApi(pluginId) {
    return {
      readFile: async function(path, options) {
        if (!hasPermission(pluginId, 'filesystem')) {
          throw new Error('Plugin does not have filesystem permission');
        }
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
          return window.Capacitor.Plugins.Filesystem.readFile(Object.assign({}, options, { path: path }));
        }
        throw new Error('Filesystem not available on this platform');
      },
      writeFile: async function(path, data, options) {
        if (!hasPermission(pluginId, 'filesystem')) {
          throw new Error('Plugin does not have filesystem permission');
        }
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
          return window.Capacitor.Plugins.Filesystem.writeFile(Object.assign({}, options, { path: path, data: data }));
        }
        throw new Error('Filesystem not available on this platform');
      }
    };
  }

  // ---------------------------------------------------------------------
  // Legacy, host-code ctx (used ONLY for plugins registered with real
  // functions via registerPlugin/window.CardSpoke.registerPlugin — a
  // session-only, non-persisted path that PLUGIN_INVARIANTS.md documents as
  // "host code already," since a function value cannot come from a
  // persisted/untrusted package in the first place). This ctx runs directly
  // on the main thread with the pre-sandbox, synchronous DOM-capable UI API
  // — there is nothing to sandbox here because nothing here can be a
  // downloaded plugin package.
  // ---------------------------------------------------------------------

  function createLegacyUIApi(pluginId) {
    return {
      inject: function(selector, element, position) {
        if (!hasPermission(pluginId, 'ui-override')) {
          throw new Error('Plugin does not have ui-override permission');
        }
        position = position || 'append';
        const target = document.querySelector(selector);
        if (!target) return () => {};
        switch (position) {
          case 'before':
            if (!target.parentNode) return () => {};
            target.parentNode.insertBefore(element, target);
            break;
          case 'after':
            if (!target.parentNode) return () => {};
            target.parentNode.insertBefore(element, target.nextSibling);
            break;
          case 'prepend':
            target.insertBefore(element, target.firstChild);
            break;
          default:
            target.appendChild(element);
            break;
        }
        const resource = trackResource(pluginId, { type: 'dom', element: element });
        return function() {
          if (element.parentNode) element.parentNode.removeChild(element);
          const resources = pluginResources.get(pluginId);
          if (resources) resources.delete(resource);
        };
      },
      replace: function(selector, element) {
        if (!hasPermission(pluginId, 'ui-override')) {
          throw new Error('Plugin does not have ui-override permission');
        }
        const target = document.querySelector(selector);
        if (!target || !target.parentNode) return () => {};
        const original = target;
        target.parentNode.replaceChild(element, target);
        const resource = trackResource(pluginId, { type: 'dom', element: element, original: original });
        return function() {
          if (element.parentNode) element.parentNode.replaceChild(original, element);
          const resources = pluginResources.get(pluginId);
          if (resources) resources.delete(resource);
        };
      },
      registerComponent: function(name, component) {
        if (!hasPermission(pluginId, 'ui-override')) {
          throw new Error('Plugin does not have ui-override permission');
        }
        if (ComponentRegistry) {
          const won = ComponentRegistry.register(name, component, component.priority || 0);
          if (won) {
            if (name === 'Card') setCardComponentOwner(pluginId, true);
            trackResource(pluginId, { type: 'component', name: name, component: component });
          }
        }
      },
      unregisterComponent: function(name) {
        if (ComponentRegistry) ComponentRegistry.unregister(name);
        if (name === 'Card') setCardComponentOwner(pluginId, false);
      },
      showToast: function(message, type, duration) {
        var fn = InternalAPI.ui.showToast || window.showToast;
        if (fn) fn(message, type || 'info', duration);
      }
    };
  }

  function createLegacyMiddlewareApi(pluginId) {
    return {
      register: function(middleware) {
        if (!middleware || !middleware.name || typeof middleware.handler !== 'function') {
          throw new Error('Middleware must have a name and a handler function');
        }
        if (!Middleware) throw new Error('Middleware pipeline not available');
        const namespacedName = pluginId + ':' + middleware.name;
        Middleware.register({
          name: namespacedName,
          priority: middleware.priority || 0,
          operations: middleware.operations || ['*'],
          handler: middleware.handler
        });
        trackResource(pluginId, { type: 'middleware', name: namespacedName });
        return function() {
          Middleware.unregister(namespacedName);
        };
      },
      unregister: function(name) {
        if (Middleware) Middleware.unregister(pluginId + ':' + name);
      }
    };
  }

  function createLegacyNetworkApi(pluginId) {
    return {
      fetch: async function(url, options) {
        if (!hasPermission(pluginId, 'network')) {
          throw new Error('Plugin does not have network permission');
        }
        return window.fetch(url, options);
      },
      xhr: function() {
        if (!hasPermission(pluginId, 'network')) {
          throw new Error('Plugin does not have network permission');
        }
        return new XMLHttpRequest();
      }
    };
  }

  function createLogger(pluginId) {
    const prefix = '[Plugin:' + pluginId + ']';
    return {
      log: function() { console.log.apply(console, [prefix].concat(Array.from(arguments))); },
      info: function() { console.info.apply(console, [prefix].concat(Array.from(arguments))); },
      warn: function() { console.warn.apply(console, [prefix].concat(Array.from(arguments))); },
      error: function() { console.error.apply(console, [prefix].concat(Array.from(arguments))); }
    };
  }

  function createLegacyPluginContext(pluginId) {
    return {
      modId: pluginId,
      appVersion: window.APP_VERSION || '0.21.0',
      schemaVersion: window.SCHEMA_VERSION || 4,
      api: {
        ui: createLegacyUIApi(pluginId),
        data: createDataApi(pluginId),
        storage: createStorageApi(pluginId),
        events: createEventApi(pluginId),
        middleware: createLegacyMiddlewareApi(pluginId),
        network: createLegacyNetworkApi(pluginId),
        filesystem: createFilesystemApi(pluginId)
      },
      utils: window.CardSpoke && window.CardSpoke.utils ? window.CardSpoke.utils : {},
      logger: createLogger(pluginId)
    };
  }

  // ---------------------------------------------------------------------
  // Sandboxed (worker) host handlers — the RPC dispatch target for every
  // JS-bearing installed plugin package. Unlike the legacy ctx above, a
  // vnode (not a real element) crosses this boundary, component render
  // functions stay inside the worker and are invoked by RPC, and network
  // responses are converted to a serializable shim.
  // ---------------------------------------------------------------------

  function createWorkerUIHandlers(pluginId) {
    const domHandles = new Map(); // handleId -> { element, original? }
    const ownedComponents = new Map();

    function doInject(selector, vnode, position) {
      if (!hasPermission(pluginId, 'ui-override')) {
        throw new Error('Plugin does not have ui-override permission');
      }
      position = position || 'append';
      const target = document.querySelector(selector);
      if (!target) return null;
      const element = vnodeToDOM(vnode);
      switch (position) {
        case 'before':
          if (!target.parentNode) return null;
          target.parentNode.insertBefore(element, target);
          break;
        case 'after':
          if (!target.parentNode) return null;
          target.parentNode.insertBefore(element, target.nextSibling);
          break;
        case 'prepend':
          target.insertBefore(element, target.firstChild);
          break;
        default:
          target.appendChild(element);
          break;
      }
      const handleId = nextDomHandleId++;
      domHandles.set(handleId, { element: element });
      trackResource(pluginId, { type: 'dom', element: element });
      return handleId;
    }

    function doReplace(selector, vnode) {
      if (!hasPermission(pluginId, 'ui-override')) {
        throw new Error('Plugin does not have ui-override permission');
      }
      const target = document.querySelector(selector);
      if (!target || !target.parentNode) return null;
      const element = vnodeToDOM(vnode);
      const original = target;
      target.parentNode.replaceChild(element, target);
      const handleId = nextDomHandleId++;
      domHandles.set(handleId, { element: element, original: original });
      trackResource(pluginId, { type: 'dom', element: element, original: original });
      return handleId;
    }

    return {
      inject: function(selector, vnode, position) { return doInject(selector, vnode, position); },
      replace: function(selector, vnode) { return doReplace(selector, vnode); },
      removeInjected: function(handleId) {
        const entry = domHandles.get(handleId);
        if (!entry) return;
        if (entry.original && entry.element.parentNode) {
          entry.element.parentNode.replaceChild(entry.original, entry.element);
        } else if (entry.element.parentNode) {
          entry.element.parentNode.removeChild(entry.element);
        }
        domHandles.delete(handleId);
      },
      updateInjected: function(handleId, vnode) {
        const entry = domHandles.get(handleId);
        if (!entry) return;
        updateElementFromVnode(entry.element, vnode);
      },
      registerComponent: function(name, priority) {
        if (!hasPermission(pluginId, 'ui-override')) {
          throw new Error('Plugin does not have ui-override permission');
        }
        const instance = plugins.get(pluginId);
        const component = {
          priority: priority || 0,
          render: async function(props) {
            if (!instance || !instance.workerHandle) throw new Error('Plugin worker not available');
            const vnode = await instance.workerHandle.callWithDeadline(['ui', 'componentRender'], [name, props], BOOT_COMPONENT_TIMEOUT_MS);
            return vnodeToDOM(vnode);
          }
        };
        const won = ComponentRegistry.register(name, component, priority || 0);
        if (won) {
          ownedComponents.set(name, component);
          if (name === 'Card') {
            if (instance) instance.cardComponent = component;
            setCardComponentOwner(pluginId, true);
          }
          trackResource(pluginId, { type: 'component', name: name, component: component });
        }
        return won;
      },
      unregisterComponent: function(name) {
        const owned = ownedComponents.get(name);
        if (!owned) return;
        if (ComponentRegistry) ComponentRegistry.unregister(name, owned);
        ownedComponents.delete(name);
        if (name === 'Card') setCardComponentOwner(pluginId, false);
      },
      showToast: function(message, type, duration) {
        var fn = InternalAPI.ui.showToast || window.showToast;
        if (fn) fn(message, type || 'info', duration);
      }
    };
  }

  // Middleware operations that intercept (and can rewrite or cancel) card
  // writes. A sandboxed plugin may only hook these with `data-modify`.
  // '*' matches every operation, so it counts as a write hook too.
  const CARD_WRITE_OPERATIONS = ['card.create', 'card.update', 'card.delete'];

  function createWorkerMiddlewareHandlers(pluginId) {
    return {
      register: function(name, priority, operations) {
        if (typeof name !== 'string' || !name) {
          throw new Error('Middleware must have a name');
        }
        const ops = (Array.isArray(operations) && operations.length) ? operations.map(String) : ['*'];
        if (ops.indexOf('card.render') !== -1) {
          // card.render decorators (and the vnode/patch they return from
          // renderBatch) change what every card tile shows — the same power
          // as owning the Card component, so the same permission.
          if (!hasPermission(pluginId, 'ui-override')) {
            throw new Error('Plugin does not have ui-override permission (required for card.render middleware)');
          }
          addCardDecorator(pluginId, name);
          trackResource(pluginId, { type: 'card-decorator', name: name });
          return true;
        }

        const hooksWrites = ops.some(op => op === '*' || CARD_WRITE_OPERATIONS.indexOf(op) !== -1);
        if (hooksWrites && !hasPermission(pluginId, 'data-modify')) {
          throw new Error('Plugin does not have data-modify permission (required for middleware on ' +
            ops.join(', ') + ')');
        }

        const namespacedName = pluginId + ':' + name;
        const wrapper = async function(mwCtx, realNext) {
          const instance = plugins.get(pluginId);
          if (!instance || !instance.workerHandle) { await realNext(); return; }
          const nextProxy = async function() {
            await realNext();
            return { args: mwCtx.args, prevented: mwCtx.prevented, stopped: mwCtx.stopped };
          };
          const outcome = await instance.workerHandle.callWithDeadline(
            ['middleware', 'invoke'], [name, mwCtx.operation, mwCtx.args, nextProxy], MIDDLEWARE_TIMEOUT_MS
          );
          // Without data-modify a hook is observe-only (e.g. card.save for a
          // "Saved" indicator): it may not rewrite args, cancel the
          // operation, or stop later middleware.
          if (outcome && hasPermission(pluginId, 'data-modify')) {
            if (outcome.args !== undefined) mwCtx.args = outcome.args;
            if (outcome.prevented) mwCtx.preventDefault();
            if (outcome.stopped) mwCtx.stopPropagation();
          }
        };
        Middleware.register({ name: namespacedName, priority: priority || 0, operations: ops, handler: wrapper });
        trackResource(pluginId, { type: 'middleware', name: namespacedName });
        return true;
      },
      unregister: function(name) {
        removeCardDecorator(pluginId, name);
        Middleware.unregister(pluginId + ':' + name);
      }
    };
  }

  function createWorkerNetworkHandlers(pluginId) {
    return {
      fetch: async function(url, options) {
        if (!hasPermission(pluginId, 'network')) {
          throw new Error('Plugin does not have network permission');
        }
        const response = await window.fetch(url, options);
        const bodyBuffer = await response.arrayBuffer();
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          headers: Array.from(response.headers.entries()),
          bodyBuffer: bodyBuffer
        };
      }
    };
  }

  // CardSpoke.utils members a sandboxed plugin may call over RPC, and the
  // permission each needs (null = read-only / harmless, no permission).
  // Anything not listed here is NOT exposed to workers: a new utils helper
  // must be classified before plugins can reach it.
  const UTILS_PERMISSIONS = Object.freeze({
    // Reads
    getTags: null,
    getAllTags: null,
    getCard: null,
    searchCards: null,
    getDatasetMeta: null,
    getAccessibilitySettings: null,
    getTheme: null,
    getTypography: null,
    isHighContrast: null,
    prefersReducedMotion: null,
    getThemeVariables: null,
    showToast: null, // same as the ungated ctx.api.ui.showToast
    // Card/tag writes — same gate as ctx.api.data.*
    createCard: 'data-modify',
    updateCard: 'data-modify',
    addTag: 'data-modify',
    removeTag: 'data-modify',
    setTags: 'data-modify',
    // Global UI/appearance changes
    setTheme: 'ui-override',
    setTypography: 'ui-override',
    setHighContrast: 'ui-override'
  });

  function createUtilsHandlers(pluginId) {
    const utils = (window.CardSpoke && window.CardSpoke.utils) || {};
    const handlers = Object.create(null);
    Object.keys(utils).forEach(prop => {
      if (typeof utils[prop] !== 'function') return;
      if (!Object.prototype.hasOwnProperty.call(UTILS_PERMISSIONS, prop)) return;
      const required = UTILS_PERMISSIONS[prop];
      handlers[prop] = async function() {
        if (required && !hasPermission(pluginId, required)) {
          throw new Error('Plugin does not have ' + required + ' permission (required for utils.' + prop + ')');
        }
        return await utils[prop].apply(utils, arguments);
      };
    });
    return handlers;
  }

  function createLoggerHandlers() {
    return {
      log: function() { console.log.apply(console, arguments); },
      info: function() { console.info.apply(console, arguments); },
      warn: function() { console.warn.apply(console, arguments); },
      error: function() { console.error.apply(console, arguments); }
    };
  }

  /** Full onCall dispatch tree for a sandboxed plugin's worker channel. */
  function createHostHandlers(pluginId) {
    return {
      data: createDataApi(pluginId),
      storage: createStorageApi(pluginId),
      events: createEventApi(pluginId),
      filesystem: createFilesystemApi(pluginId),
      network: createWorkerNetworkHandlers(pluginId),
      ui: createWorkerUIHandlers(pluginId),
      middleware: createWorkerMiddlewareHandlers(pluginId),
      utils: createUtilsHandlers(pluginId),
      logger: createLoggerHandlers()
    };
  }

  // eslint-disable-next-line no-empty-function
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

  // Centralized syntax pre-check for all plugin JS. This never executes the
  // code — constructing a Function parses the body without invoking it — so
  // it is safe to run on the main thread purely to surface a bad package's
  // syntax error synchronously at install time, before the string is ever
  // sent to a worker to actually run. Real execution always happens inside
  // the plugin's dedicated worker (see plugin-worker-bootstrap.js). Compiled
  // as an AsyncFunction to match the worker's actual compile step exactly —
  // otherwise a plugin correctly using top-level `await` would pass this
  // check under a plain Function but be a real SyntaxError under the
  // worker's AsyncFunction compile (or vice versa).
  function _checkSyntax(code) {
    // eslint-disable-next-line no-new-func
    new AsyncFunction('ctx', '"use strict";\n' + code);
  }

  function _createSerializableDefinition(definition) {
    if (!definition) return null;
    return {
      manifest: definition.manifest,
      css: definition.css,
      js: (typeof definition.js === 'string' && definition.js) || null,
      teardownJs: (typeof definition.teardownJs === 'string' && definition.teardownJs) || null
    };
  }

  const ENABLE_TIMEOUT_MS = 5000;
  const TEARDOWN_TIMEOUT_MS = 5000;
  const MIDDLEWARE_TIMEOUT_MS = 5000;
  const BOOT_COMPONENT_TIMEOUT_MS = 3000;
  const CARD_RENDER_DEADLINE_MS = 80;
  const HANG_BACKSTOP_MS = 10000;
  let hangWatcherTimer = null;

  function hasSourceStrings(definition) {
    return !!((typeof definition.js === 'string' && definition.js) ||
      (typeof definition.teardownJs === 'string' && definition.teardownJs));
  }

  function hasHostFunctions(definition) {
    return typeof definition.setup === 'function' || typeof definition.teardown === 'function';
  }

  const PluginManager = {
    /**
     * Register a plugin definition. Definitions carrying `js`/`teardownJs`
     * source strings run sandboxed in a worker. A definition whose only code
     * is real `setup`/`teardown` FUNCTIONS would run unsandboxed on the main
     * thread, so it is rejected here — host code must opt in explicitly via
     * the host-only registerHostPlugin() (what CardSpoke.registerPlugin uses).
     */
    register: function(id, definition) {
      return this._registerInternal(id, definition, false);
    },

    _registerInternal: function(id, definition, allowHostCode) {
      if (!id || !definition) {
        throw new Error('Plugin ID and definition are required');
      }

      if (!definition.manifest) {
        throw new Error('Plugin manifest is required');
      }

      if (!allowHostCode && hasHostFunctions(definition) && !hasSourceStrings(definition)) {
        throw new Error(
          'Plugin "' + id + '" supplies setup/teardown functions, which would run unsandboxed on ' +
          'the main thread. Provide js/teardownJs source strings (sandboxed), or register trusted ' +
          'host code explicitly with CardSpoke.registerPlugin().'
        );
      }

      if (plugins.has(id)) {
        throw new Error(
          'Plugin "' + id + '" is already registered. ' +
          'Use install() to update an existing plugin, or unregister() it first.'
        );
      }

      // Validate plugin content if validator is available
      if (PluginValidator) {
        var validationResult = PluginValidator.validate({
          id: id,
          manifest: definition.manifest,
          css: definition.css,
          js: definition.js
        });

        if (validationResult.warnings.length > 0) {
          validationResult.warnings.forEach(function(w) {
            console.warn('[Plugin] Validation warning for ' + id + ':', w);
          });
        }

        if (!validationResult.valid) {
          throw new Error('Plugin validation failed: ' + validationResult.errors.join('; '));
        }
      }

      // Pre-initialize the shared resources Set so that all host handler
      // factories close over the correct Set instead of creating orphaned
      // Sets that _cleanupResources cannot reach.
      const resources = new Set();
      pluginResources.set(id, resources);

      // A definition carrying `js`/`teardownJs` strings (every
      // persisted/installed package) gets no ctx here at all — it is built
      // fresh inside a dedicated worker each time the plugin is enabled.
      // Everything else (registerPlugin's documented session-only "host
      // code" path, including a no-op registration with neither functions
      // nor strings) gets a conventional legacy same-thread ctx up front.
      const context = (!definition.js && !definition.teardownJs)
        ? createLegacyPluginContext(id)
        : null;

      const instance = {
        id: id,
        definition: definition,
        context: context,
        enabled: false,
        workerHandle: null,
        resources: resources,
        // Permission grants are bound to this (code + requested permissions)
        // fingerprint, so a same-id plugin with different code needs fresh
        // consent (see permissions.js).
        fingerprint: (Permissions && typeof Permissions.computeFingerprint === 'function')
          ? Permissions.computeFingerprint(definition)
          : undefined
      };

      plugins.set(id, instance);

      console.log('[Plugin] Registered:', id);
    },

    unregister: async function(id) {
      const instance = plugins.get(id);
      if (instance) {
        if (instance.enabled) {
          await this.disable(id);
        }
        this._cleanupResources(id);
        plugins.delete(id);
        pluginResources.delete(id);
        dataUpdateListeners.delete(id);
        clearCardRender(id);

        // Revoke any permissions the user granted this plugin so a future
        // reinstall must ask again.
        if (Permissions && Permissions.revokePermissions) {
          Permissions.revokePermissions(id);
        }

        // Sweep this plugin's namespaced ctx.storage entries so a reinstall
        // (or a different plugin that reuses the same id) cannot silently
        // inherit the previous installation's stored values. This honors the
        // documented invariant that everything created through ctx.api.* is
        // removed on delete.
        try {
          const prefix = 'plugin_' + id + '_';
          if (typeof localStorage !== 'undefined') {
            const toRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.indexOf(prefix) === 0) toRemove.push(k);
            }
            toRemove.forEach(k => localStorage.removeItem(k));
          }
          if (window.storageDriver && typeof window.storageDriver.list === 'function' &&
              typeof window.storageDriver.remove === 'function') {
            const keys = await window.storageDriver.list(prefix);
            if (Array.isArray(keys)) {
              for (const k of keys) {
                await window.storageDriver.remove(k.indexOf(prefix) === 0 ? k : prefix + k);
              }
            }
          }
        } catch (sweepErr) {
          console.warn('[Plugin] Storage sweep failed for', id, ':', sweepErr);
        }

        // Remove from store
        if (window.store && window.store.plugins) {
          delete window.store.plugins[id];
          if (window.save) {
            window.save();
          }
        }

        console.log('[Plugin] Unregistered:', id);
      }
    },

    get: function(id) {
      return plugins.get(id);
    },

    list: function() {
      return Array.from(plugins.values());
    },

    /**
     * Runtime-only teardown for a dataset switch. Disables the plugin (running
     * its teardown + resource cleanup so no CSS/DOM/listeners leak) and drops
     * the instance from the runtime so a subsequent syncFromStore() can cleanly
     * re-register it — but deliberately does NOT touch the persisted store or
     * the user's permission grants, which are keyed to the plugin id and
     * must survive switching away from and back to a dataset.
     *
     * Unlike unregister(), this never deletes store.plugins[id] or revokes
     * consent. syncFromStore skips ids already in the runtime Map, so without
     * this teardown a plugin carried over from the previous dataset would be
     * stuck in its old enabled/definition state after a switch.
     */
    teardownForReload: async function(id) {
      const instance = plugins.get(id);
      if (!instance) return;
      if (instance.enabled) {
        await this.disable(id);
      } else {
        this._removeCSS(id);
        this._cleanupResources(id);
      }
      plugins.delete(id);
      pluginResources.delete(id);
      dataUpdateListeners.delete(id);
      clearCardRender(id);
    },

    // Restore the brand button to its pre-override content (the logo <img>).
    // Safe to call unconditionally; a no-op when the plugin never overrode it.
    _restoreBrandOverride: function(instance) {
      if (instance && instance._savedBrandHTML != null) {
        const brandBtn = document.getElementById && document.getElementById('brandBtn');
        if (brandBtn) brandBtn.innerHTML = instance._savedBrandHTML;
        instance._savedBrandHTML = null;
      }
    },

    enable: async function(id) {
      const instance = plugins.get(id);
      if (!instance) {
        throw new Error('Plugin not found: ' + id);
      }

      if (instance.enabled) {
        return;
      }

      // Capture stable internal references before plugin runs
      captureInternalReferences();

      // Task 2.6: Pass config to plugin context (legacy host-code path only;
      // sandboxed plugins receive config in their worker's init payload).
      if (instance.context && instance.definition.manifest.config) {
        instance.context.config = instance.definition.manifest.config;
      }

      // Check permissions BEFORE applying any visible override, running CSS,
      // or starting the plugin — so a declined permission dialog (or any
      // later failure) can never leave the app's brand/DOM mutated with no
      // clean way back. This is now the ONLY consent step: sandboxed plugin
      // JS has no ambient access outside these permission-gated calls, so a
      // granted permission is an enforced capability grant, not a polite
      // request (CS-002, resolved).
      const requiredPermissions = this._requiredPermissions(instance);
      if (requiredPermissions.length) {
        const granted = await this._checkPermissions(id, requiredPermissions);
        if (!granted) {
          throw new Error('Permissions not granted for plugin: ' + id);
        }
      }

      // Task 2.6: Apply overrides from manifest. appName renames the brand
      // button; we snapshot its original content first so disable() (and the
      // setup-failure path below) can fully restore it — the button normally
      // holds the logo <img>, which setting textContent would otherwise
      // destroy with no way back.
      if (instance.definition.manifest.overrides) {
        const overrides = instance.definition.manifest.overrides;
        if (overrides.appName && typeof overrides.appName === 'string') {
          const brandBtn = document.getElementById && document.getElementById('brandBtn');
          if (brandBtn) {
            if (instance._savedBrandHTML == null) instance._savedBrandHTML = brandBtn.innerHTML;
            brandBtn.textContent = overrides.appName;
          }
        }
      }

      // Apply CSS
      if (instance.definition.css) {
        this._applyCSS(id, instance.definition.css);
      }

      try {
        if (instance.definition.js || instance.definition.teardownJs) {
          // Sandboxed path: every JS-bearing installed package. Build the
          // host-side RPC handler tree ONCE per worker (not per call!) — it
          // owns per-plugin state (domHandles for ui.inject/replace, etc.)
          // that must persist across the whole enabled lifetime, not reset
          // on every single RPC round trip.
          const hostHandlers = createHostHandlers(id);
          instance.workerHandle = await createPluginWorker(id, {
            js: instance.definition.js || '',
            teardownJs: instance.definition.teardownJs || '',
            permissions: instance.definition.manifest.permissions || [],
            config: instance.definition.manifest.config,
            appVersion: window.APP_VERSION || '0.21.0',
            schemaVersion: window.SCHEMA_VERSION || 4
          }, (path, args) => dispatch(hostHandlers, path, args));

          await instance.workerHandle.callWithDeadline(['lifecycle', 'runSetup'], [], ENABLE_TIMEOUT_MS);
          this._startHangWatcher();
        } else if (instance.definition.setup) {
          // Legacy host-code path: a real function, session-only, never
          // persisted, therefore never a downloaded/untrusted package.
          await instance.definition.setup(instance.context);
        }
      } catch (err) {
        console.error('[Plugin] Setup error for', id, ':', err);
        if (window.showToast) {
          window.showToast('Plugin "' + id + '" failed to start: ' + err.message, 'error');
        }

        if (instance.workerHandle) {
          instance.workerHandle.terminate();
          instance.workerHandle = null;
          this._stopHangWatcherIfIdle();
        }

        // Clean up partially applied resources, including any brand override
        // applied above, so a failed enable leaves no ghost UI behind.
        this._restoreBrandOverride(instance);
        this._removeCSS(id);
        this._cleanupResources(id);

        throw err;
      }

      instance.enabled = true;
      this._persistEnabledState(id, true);
      console.log('[Plugin] Enabled:', id);
    },

    disable: async function(id) {
      const instance = plugins.get(id);
      if (!instance) {
        throw new Error('Plugin not found: ' + id);
      }

      if (!instance.enabled) {
        return;
      }

      // Run teardown
      if (instance.workerHandle) {
        try {
          await instance.workerHandle.callWithDeadline(['lifecycle', 'runTeardown'], [], TEARDOWN_TIMEOUT_MS);
        } catch (err) {
          console.error('[Plugin] Teardown error for', id, ':', err);
          if (instance.context && instance.context.logger) {
            instance.context.logger.warn('Plugin cleanup had errors but continuing: ' + err.message);
          }
          // Continue anyway - don't let cleanup errors break app
        } finally {
          instance.workerHandle.terminate();
          instance.workerHandle = null;
          this._stopHangWatcherIfIdle();
        }
      } else if (instance.definition.teardown) {
        try {
          await instance.definition.teardown(instance.context);
        } catch (err) {
          console.error('[Plugin] Teardown error for', id, ':', err);
          if (instance.context && instance.context.logger) {
            instance.context.logger.warn('Plugin cleanup had errors but continuing: ' + err.message);
          }
        }
      }

      // Restore the brand button if this plugin overrode appName, so no
      // ghost UI (or a destroyed logo) is left behind on suspend/remove.
      this._restoreBrandOverride(instance);

      // Remove CSS
      this._removeCSS(id);

      // Cleanup resources
      this._cleanupResources(id);
      clearCardRender(id);

      instance.enabled = false;
      this._persistEnabledState(id, false);
      console.log('[Plugin] Disabled:', id);
    },

    /**
     * Keep the persisted enabled flag in sync with the runtime state so that
     * enabling/suspending a plugin survives a page reload. No-op for plugins
     * that were registered without install() (session-only plugins have no
     * store entry).
     */
    _persistEnabledState: function(id, enabled) {
      if (window.store && window.store.plugins && window.store.plugins[id] &&
          window.store.plugins[id].enabled !== enabled) {
        window.store.plugins[id].enabled = enabled;
        if (window.save) {
          window.save();
        }
      }
    },

    // Find a plugin's <style> element. The id is escaped for the quoted
    // attribute value so no id (legacy ids may contain quotes) can inject
    // into the selector.
    _findStyle: function(id) {
      const value = (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function')
        ? CSS.escape(id)
        : String(id).replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, ' ');
      return document.querySelector('style[data-plugin-id="' + value + '"]');
    },

    _applyCSS: function(id, css) {
      const existing = this._findStyle(id);
      if (existing) {
        existing.textContent = css;
      } else {
        const style = document.createElement('style');
        style.setAttribute('data-plugin-id', id);
        style.textContent = css;
        document.head.appendChild(style);
      }
    },

    _removeCSS: function(id) {
      const style = this._findStyle(id);
      if (style && style.parentNode) {
        style.parentNode.removeChild(style);
      }
    },

    _cleanupResources: function(id) {
      const resources = pluginResources.get(id);
      if (!resources || resources.size === 0) {
        return;
      }

      const cleanup = {
        domElements: 0,
        components: 0,
        listeners: 0,
        events: 0,
        errors: 0
      };

      resources.forEach(function(resource) {
        try {
          if (resource.type === 'dom') {
            if (resource.original) {
              if (resource.element && resource.element.parentNode) {
                resource.element.parentNode.replaceChild(resource.original, resource.element);
                cleanup.domElements++;
              }
            } else if (resource.element && resource.element.parentNode) {
              resource.element.parentNode.removeChild(resource.element);
              cleanup.domElements++;
            }
          } else if (resource.type === 'component') {
            if (ComponentRegistry) {
              if (ComponentRegistry.unregister(resource.name, resource.component)) {
                cleanup.components++;
              }
            }
          } else if (resource.type === 'middleware') {
            if (Middleware) {
              Middleware.unregister(resource.name);
              cleanup.listeners++;
            }
          } else if (resource.type === 'card-decorator') {
            cleanup.listeners++;
          } else if (resource.type === 'listener') {
            cleanup.listeners++;
          } else if (resource.type === 'event') {
            const list = globalEventBus.get(resource.event);
            if (list) {
              const idx = list.findIndex(function(h) { return h.callback === resource.callback && h.pluginId === id; });
              if (idx !== -1) list.splice(idx, 1);
            }
            cleanup.events++;
          }
        } catch (err) {
          cleanup.errors++;
          console.error('[Plugin] Resource cleanup error for', id, ':', err);
        }
      });

      resources.clear();

      const listeners = dataUpdateListeners.get(id);
      if (listeners && listeners.length > 0) {
        cleanup.listeners += listeners.length;
        dataUpdateListeners.delete(id);
      }

      console.log('[Plugin] Cleanup complete for', id, ':',
        cleanup.domElements, 'DOM elements,',
        cleanup.components, 'components,',
        cleanup.listeners, 'listeners,',
        cleanup.events, 'events',
        cleanup.errors > 0 ? '(' + cleanup.errors + ' errors)' : ''
      );
    },

    _checkPermissions: async function(id, permissions) {
      console.log('[Plugin] Permissions requested for', id, ':', permissions);

      if (!permissions || permissions.length === 0) {
        return true;
      }

      if (Permissions) {
        const instance = plugins.get(id);
        const pluginName = (instance && instance.definition.manifest && instance.definition.manifest.name) || id;
        return await Permissions.requestPermissions(id, pluginName, permissions,
          instance ? instance.fingerprint : undefined);
      }

      if (window.showPermissionDialog) {
        return await window.showPermissionDialog(id, permissions);
      }

      console.warn('[Plugin] No permission consent mechanism available; denying permissions for', id);
      return false;
    },

    notifyDataUpdate: function(event) {
      dataUpdateListeners.forEach(function(listeners) {
        listeners.forEach(function(callback) {
          try {
            // A sandboxed plugin's callback is an RPC remote-callback stub
            // that returns a Promise (the invoke round trip into its
            // worker); catch async rejections too, not just synchronous
            // throws, so one plugin's broken listener can't produce an
            // unhandled rejection.
            const result = callback(event);
            if (result && typeof result.catch === 'function') {
              result.catch(err => console.error('[Plugin] Data update callback error:', err));
            }
          } catch (err) {
            console.error('[Plugin] Data update callback error:', err);
          }
        });
      });
    },

    listAll: function() {
      return this.list();
    },

    /** Plugin ids with a live Card component or card.render decorator. Empty in the common case. */
    getCardRenderPluginIds: function() {
      return Array.from(cardRenderPluginIds);
    },

    /**
     * Ask one plugin's worker to render/decorate a batch of cards. Never
     * throws — a timeout, error, or missing worker all resolve to `null` so
     * rendering.js can treat "no upgrade this pass" uniformly and let the
     * already-rendered default tiles stand.
     */
    renderBatch: async function(id, cardsSnapshot, opts) {
      const instance = plugins.get(id);
      if (!instance || !instance.enabled || !instance.workerHandle) return null;
      // Only honour what the host actually accepted for this plugin: the
      // worker is untrusted and may return a vnode/patch for a Card
      // component or card.render decorator the host refused to register.
      const canOverride = hasPermission(id, 'ui-override');
      const mayReplace = canOverride && cardComponentPluginIds.has(id) &&
        !!instance.cardComponent && ComponentRegistry.get('Card') === instance.cardComponent;
      const decorators = cardDecorators.get(id);
      const mayDecorate = canOverride && !!(decorators && decorators.size > 0);
      if (!mayReplace && !mayDecorate) return null;
      let results;
      try {
        results = await instance.workerHandle.callWithDeadline(
          ['ui', 'renderBatch'], [cardsSnapshot, opts || {}], CARD_RENDER_DEADLINE_MS
        );
      } catch (err) {
        return null;
      }
      if (!Array.isArray(results)) return null;
      return results.map(r => ({
        cardId: r && r.cardId,
        vnode: (mayReplace && r && r.vnode) || null,
        patch: (mayDecorate && r && r.patch) || null
      }));
    },

    /** Backstop hang detector: terminates and suspends a worker whose oldest pending RPC call is stuck. */
    _startHangWatcher: function() {
      if (hangWatcherTimer) return;
      hangWatcherTimer = setInterval(() => {
        plugins.forEach((instance, id) => {
          if (instance.workerHandle && instance.workerHandle.isHung(HANG_BACKSTOP_MS)) {
            console.error('[Plugin] "' + id + '" stopped responding; suspending.');
            instance.workerHandle.terminate();
            instance.workerHandle = null;
            instance.enabled = false;
            this._removeCSS(id);
            this._cleanupResources(id);
            clearCardRender(id);
            this._persistEnabledState(id, false);
            if (window.showToast) {
              window.showToast('Plugin "' + id + '" stopped responding and was suspended.', 'error');
            }
          }
        });
        this._stopHangWatcherIfIdle();
      }, 2000);
    },

    /**
     * Stop the hang-watcher interval once no plugin has a live worker to
     * watch — otherwise this timer runs forever (a real, if minor, resource
     * leak in production once every JS-bearing plugin is disabled, and a
     * process-hang hazard in tests, where an un-cleared interval keeps
     * Node's event loop alive after the test file's assertions finish).
     */
    _stopHangWatcherIfIdle: function() {
      if (!hangWatcherTimer) return;
      let anyActive = false;
      plugins.forEach(instance => { if (instance.workerHandle) anyActive = true; });
      if (!anyActive) {
        clearInterval(hangWatcherTimer);
        hangWatcherTimer = null;
      }
    },

    install: async function(pkg) {
      if (!pkg || !pkg.manifest) {
        throw new Error('Invalid plugin package: manifest is required');
      }
      if (!pkg.manifest.name && !pkg.manifest.id && !pkg.id) {
        throw new Error('Invalid plugin package: manifest.name or an id is required');
      }

      // Normalize package-level fields into the manifest. Published plugin
      // packages (see sample-plugins/) may declare id/config/overrides at the
      // package top level; explicit manifest values win on conflict.
      if (pkg.id && !pkg.manifest.id) pkg.manifest.id = pkg.id;
      if (pkg.config && typeof pkg.config === 'object' && !pkg.manifest.config) {
        pkg.manifest.config = pkg.config;
      }
      if (pkg.overrides && typeof pkg.overrides === 'object' && !pkg.manifest.overrides) {
        pkg.manifest.overrides = pkg.overrides;
      }

      // Phase 3.3: Dependency Checking
      if (pkg.manifest.dependencies && Array.isArray(pkg.manifest.dependencies) && pkg.manifest.dependencies.length > 0) {
        const missing = pkg.manifest.dependencies.filter(function(dep) {
          return !plugins.has(dep);
        });
        if (missing.length > 0) {
          throw new Error('Missing dependencies: ' + missing.join(', ') + '. Install the required plugins first.');
        }
      }

      // The js/teardownJs source strings are the canonical executable form of
      // a plugin package: they are what gets persisted and reconstructed
      // after a reload, and what gets handed to a fresh worker on every
      // enable. Empty strings (common in CSS-only theme packages) count as
      // absent.
      const jsSource =
        (typeof pkg.js === 'string' && pkg.js.trim()) ? pkg.js :
        (typeof pkg.javascript === 'string' && pkg.javascript.trim()) ? pkg.javascript : null;
      const teardownSource =
        (typeof pkg.teardownJs === 'string' && pkg.teardownJs.trim()) ? pkg.teardownJs :
        (typeof pkg.teardown === 'string' && pkg.teardown.trim()) ? pkg.teardown : null;

      // install() only ever builds a sandboxed definition from the package's
      // manifest/css/js/teardownJs. Real setup/teardown FUNCTIONS would run
      // unsandboxed on the main thread (and could not be persisted anyway),
      // so they are dropped here; trusted session-only host code must use
      // CardSpoke.registerPlugin() instead.
      if (typeof pkg.setup === 'function' || typeof pkg.teardown === 'function') {
        console.warn('[Plugin] install() ignores setup/teardown functions; ' +
          'use js/teardownJs source strings (sandboxed) or CardSpoke.registerPlugin() for host code.');
      }

      // Syntax-check (never execute) source strings. A syntax error here
      // throws before anything is registered.
      if (jsSource) _checkSyntax(jsSource);
      if (teardownSource) _checkSyntax(teardownSource);

      // Generate base ID
      // An explicit id must already match the documented format (the
      // validator rejects anything else); a name-derived id is slugified to
      // that format.
      let id = pkg.manifest.id || String(pkg.manifest.name).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!id) {
        throw new Error('Invalid plugin package: could not derive a plugin id from manifest.name; set manifest.id');
      }
      // New installs get a strict id rule (letters, digits, '.', '_', '-').
      // Stored plugins from earlier releases are validated more leniently so
      // they keep loading (see plugin-validator.js).
      if (!/^[A-Za-z0-9._-]+$/.test(id) || id.length > 200) {
        throw new Error('Invalid plugin package: manifest.id may only contain letters, numbers, ' +
          '".", "_" and "-": ' + JSON.stringify(id));
      }

      // Task 2.4: If a plugin with this ID already exists, this install is an
      // update: fully unregister (disable + cleanup + store removal) first.
      if (plugins.has(id)) {
        await this.unregister(id);
      }

      const definition = {
        manifest: pkg.manifest,
        css: pkg.css,
        js: jsSource,
        teardownJs: teardownSource
      };

      this.register(id, definition);

      // Persist before enabling so _persistEnabledState keeps the stored
      // flag in sync with whatever enable() ends up doing.
      if (window.store) {
        if (!window.store.plugins) {
          window.store.plugins = {};
        }
        window.store.plugins[id] = {
          definition: _createSerializableDefinition(definition),
          enabled: false
        };
        if (window.save) {
          window.save();
        }
      }

      // Only CSS-only themes (SAFE) enable silently — they execute no
      // JavaScript. Anything carrying JS goes through enable(), which now
      // runs inside a dedicated sandboxed worker (CS-002, resolved) gated
      // only by the plugin's declared, user-granted permissions. App-layer
      // (HIGH) plugins always stay suspended until enabled explicitly.
      //
      // Time-boxed the same way boot's syncFromStore() is: a LOW-risk
      // plugin's `js` auto-enabling here is exactly as capable of hanging
      // (an infinite loop, a Promise that never resolves) as one restored
      // at boot, and install() is typically awaited directly from UI code —
      // an unbounded hang here would freeze the Plugin Manager, not just
      // fail to enable one plugin.
      const risk = this.assessModRisk(pkg);
      if (risk === 'SAFE' || risk === 'LOW') {
        try {
          await this._enableWithTimeout(id);
        } catch (err) {
          console.warn('[Plugin] Installed but not enabled', id, ':', err.message);
        }
      }

      console.log('[Plugin] Installed:', id);
      return id;
    },

    assessModRisk: function(pkg) {
      if (!pkg || !pkg.manifest) {
        return 'HIGH';
      }

      const manifest = pkg.manifest;
      const layer = manifest.layer || 'feature';
      const hasJS = !!pkg.setup || !!pkg.teardown || !!pkg.js || !!pkg.javascript;
      const hasCSS = !!pkg.css;
      const hasOverrides = !!pkg.overrides || !!(manifest.overrides);

      if (layer === 'theme' && !hasJS && hasCSS) {
        return 'SAFE';
      }
      if (layer === 'feature' && !hasOverrides) {
        return 'LOW';
      }
      if (layer === 'app' || hasOverrides) {
        return 'HIGH';
      }
      return 'MEDIUM';
    },

    syncFromStore: async function(safeMode) {
      if (typeof safeMode === 'undefined' && typeof window !== 'undefined' &&
          window.location && typeof window.location.search === 'string') {
        safeMode = new URLSearchParams(window.location.search).has('safemode');
      }

      if (!window.store || !window.store.plugins) {
        return;
      }

      const storedPlugins = window.store.plugins || {};
      const pluginIds = Object.keys(storedPlugins);

      if (pluginIds.length === 0) {
        return;
      }

      console.log('[Plugin] Syncing', pluginIds.length, 'plugins from store');

      for (const id of pluginIds) {
        const pluginData = storedPlugins[id];

        if (plugins.has(id)) {
          continue;
        }

        if (!pluginData || !pluginData.definition) {
          continue;
        }

        try {
          const stored = pluginData.definition;

          const def = {
            manifest: stored.manifest,
            css: stored.css,
            js: (typeof stored.js === 'string' && stored.js.trim()) ? stored.js : null,
            teardownJs: (typeof stored.teardownJs === 'string' && stored.teardownJs.trim()) ? stored.teardownJs : null
          };

          this.register(id, def);

          if (!safeMode && pluginData.enabled) {
            try {
              await this._enableWithTimeout(id);
            } catch (enableErr) {
              console.error('[Plugin] Boot re-enable failed; suspending', id, ':', enableErr);
              this._persistEnabledState(id, false);
            }
          }
        } catch (err) {
          console.error('[Plugin] Failed to sync plugin', id, ':', err);
        }
      }
    },

    // Time-box enable() so a single plugin with a never-resolving setup()
    // cannot block the sequential boot sync and leave the app on a blank
    // screen. For a sandboxed plugin this also forcibly terminates the
    // worker on timeout — a capability main-thread execution never had.
    _requiredPermissions: function(instance) {
      const required = [...(instance.definition.manifest.permissions || [])];
      // A same-origin worker is useful isolation, but dynamic imports and new
      // browser APIs mean it is not a complete hostile-code security boundary.
      if (instance.definition.js || instance.definition.teardownJs) required.push('plugin-code');
      return required;
    },

    _enableWithTimeout: async function(id, timeoutMs) {
      const limit = typeof timeoutMs === 'number' ? timeoutMs : ENABLE_TIMEOUT_MS;
      // Ask for consent BEFORE the clock starts: a user reading a permission
      // dialog (e.g. the one-time re-confirmation after upgrading) must not
      // race the hang timeout, which would otherwise dismiss their answer and
      // kill the freshly started worker. enable() re-checks and finds the
      // grant, so the user is not prompted twice.
      const pending = plugins.get(id);
      if (pending && !pending.enabled) {
        const required = this._requiredPermissions(pending);
        if (required.length && !(await this._checkPermissions(id, required))) {
          throw new Error('Permissions not granted for plugin: ' + id);
        }
      }
      let timer = null;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Plugin "' + id + '" enable() timed out after ' + limit + 'ms')),
          limit
        );
      });
      try {
        await Promise.race([this.enable(id), timeout]);
      } catch (err) {
        const instance = plugins.get(id);
        if (instance && instance.workerHandle) {
          instance.workerHandle.terminate();
          instance.workerHandle = null;
          this._stopHangWatcherIfIdle();
        }
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },

    /**
     * Phase 3.1: Auto-Generated Settings UI
     * Dynamically build a settings panel from the plugin's config object.
     * Each config key becomes a labelled form input whose type is inferred
     * from the value type (boolean → checkbox, number → number, else → text).
     * Changes made in the panel are written back to the plugin's live config
     * (and, for sandboxed plugins, the worker's `ctx.config` on next enable).
     *
     * @param {string} id - Plugin ID
     * @returns {HTMLElement|null} A <div class="plugin-settings-panel"> element,
     *   or null if the plugin has no config.
     */
    buildSettingsPanel: function(id) {
      const instance = plugins.get(id);
      if (!instance) return null;

      const config = instance.definition.manifest && instance.definition.manifest.config;
      if (!config || typeof config !== 'object') return null;

      const keys = Object.keys(config);
      if (keys.length === 0) return null;

      const panel = document.createElement('div');
      panel.className = 'plugin-settings-panel';
      panel.setAttribute('data-plugin-id', id);

      const title = document.createElement('h3');
      title.className = 'plugin-settings-title';
      title.textContent = (instance.definition.manifest.name || id) + ' Settings';
      panel.appendChild(title);

      keys.forEach(function(key) {
        const defaultValue = config[key];
        const valueType = typeof defaultValue;

        const row = document.createElement('div');
        row.className = 'plugin-settings-row';

        const label = document.createElement('label');
        label.textContent = key;
        label.setAttribute('for', 'plugin-setting-' + id + '-' + key);

        let input;
        if (valueType === 'boolean') {
          input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = defaultValue;
        } else if (valueType === 'number') {
          input = document.createElement('input');
          input.type = 'number';
          input.value = String(defaultValue);
        } else {
          input = document.createElement('input');
          input.type = 'text';
          input.value = defaultValue != null ? String(defaultValue) : '';
        }

        input.id = 'plugin-setting-' + id + '-' + key;
        input.setAttribute('data-config-key', key);
        input.setAttribute('data-plugin-id', id);

        input.onchange = function() {
          let newValue;
          if (valueType === 'boolean') {
            newValue = input.checked;
          } else if (valueType === 'number') {
            newValue = Number(input.value);
          } else {
            newValue = input.value;
          }
          config[key] = newValue;
          if (instance.context && instance.context.config) {
            instance.context.config[key] = newValue;
          }
          if (window.store && window.store.plugins && window.store.plugins[id]) {
            const storedDef = window.store.plugins[id].definition;
            if (storedDef && storedDef.manifest && storedDef.manifest.config) {
              storedDef.manifest.config[key] = newValue;
            }
            if (window.save) {
              window.save();
            }
          }
        };

        row.appendChild(label);
        row.appendChild(input);
        panel.appendChild(row);
      });

      return panel;
    }
  };

  // Host-only registration path for trusted, session-only plugins whose code
  // is real setup/teardown functions (run unsandboxed on the main thread).
  // Non-enumerable so it does not show up when the Plugin surface is
  // enumerated/serialized; CardSpoke.registerPlugin() is the public wrapper.
  Object.defineProperty(PluginManager, 'registerHostPlugin', {
    value: function(id, definition) {
      return PluginManager._registerInternal(id, definition, true);
    },
    enumerable: false,
    writable: false,
    configurable: false
  });

  console.log('[Plugin] API system initialized');

export { PluginManager as Plugin };
// PLUGIN_INVARIANTS.md §1: window.CardSpoke.PluginSandbox must keep the
// shape { createFunction }. Pre-sandbox, createFunction(code) returned a
// callable wrapper that actually ran the code on the main thread; nothing in
// this codebase or the Plugin Manager UI was found to consume that return
// value, so it is repurposed here as a syntax-check-only function (throws on
// bad JS, otherwise returns undefined) — the single compilation point is
// retained, but "compilation" no longer implies "capable of unsandboxed
// execution." Real execution always happens inside a plugin's own worker.
export { _checkSyntax as PluginSandbox };

// Reset internal state (used in tests for isolation)
export function resetForTesting() {
  // Terminate any still-live sandboxed workers before dropping their
  // instances — otherwise a test that installs/enables a JS-bearing plugin
  // and never explicitly disables it before the next resetForTesting() call
  // leaks a real, un-terminated worker thread for the rest of the process.
  plugins.forEach(instance => {
    if (instance.workerHandle) {
      try { instance.workerHandle.terminate(); } catch (_e) { /* ignore */ }
    }
  });
  plugins.clear();
  pluginResources.clear();
  dataUpdateListeners.clear();
  globalEventBus.clear();
  cardRenderPluginIds.clear();
  cardComponentPluginIds.clear();
  cardDecorators.clear();
  if (hangWatcherTimer) { clearInterval(hangWatcherTimer); hangWatcherTimer = null; }
  // Drop captured host references so each test re-captures from its own
  // window/document mock instead of a stale one from a previous file.
  InternalAPI.data = {};
  InternalAPI.ui = {};
  InternalAPI.utils = {};
}
