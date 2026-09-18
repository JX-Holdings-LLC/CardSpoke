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

// Plugin worker bootstrap. Dedicated workers separate plugin computation
// from the UI. Common ambient capabilities are disabled below; host API calls
// use permission-checked RPC. This is defense in depth, not a complete
// hostile-code sandbox: dynamic import and evolving browser capabilities
// require explicit plugin-code trust consent (see SECURITY_AND_SAFETY.md).

import { createRpcChannel, dispatch } from './plugin-rpc.js';
import { h } from './plugin-vnode.js';

// Disable common capabilities before evaluating plugin code. Shadowing alone
// is insufficient because Web IDL methods can also live on prototypes.
const REMOVED_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'importScripts'];
function removeCapability(object, name) {
  // Shadow and remove prototype copies; deleting only an own property leaves
  // Web IDL methods reachable through WorkerGlobalScope.prototype.
  for (let current = object; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    if (current === object || Object.hasOwn(current, name)) {
      try { Object.defineProperty(current, name, { value: undefined, configurable: false, writable: false }); }
      catch (_error) { throw new Error('Cannot disable worker capability: ' + name); }
    }
  }
}
REMOVED_GLOBALS.forEach(name => removeCapability(self, name));
if (self.navigator) ['sendBeacon', 'storage', 'serviceWorker', 'locks'].forEach(name => removeCapability(self.navigator, name));

// --- Per-plugin runtime state ---
let pluginId = null;
let ctx = null;
let setupFn = null;
let teardownFn = null;
const componentRenderers = new Map(); // name -> render(props) => vnode|Promise<vnode>
const middlewareHandlers = new Map(); // name -> { operations, handler }  (card.create/update/delete/save — onion model)
const decoratorHandlers = new Map();  // name -> handler(cardSnapshot, tileSnapshot) => patch  (card.render only)

// eslint-disable-next-line no-empty-function
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

function compile(code) {
  // Same mechanism as the pre-sandbox runtime (a single Function-constructor
  // compile of the setup/teardown body), just relocated: this worker's
  // global scope has no DOM/window/localStorage/raw-network access, so
  // executing here can no longer reach anything outside the
  // permission-checked `ctx` it is handed. Compiled as an AsyncFunction
  // (rather than a plain Function) so plugin authors can use top-level
  // `await` directly against the now-async ctx.api — nearly every
  // meaningful ctx.api call is a Promise now, and forcing every plugin to
  // wrap its whole body in an async IIFE just to use `await` would be exactly
  // the kind of needless friction the "as open as possible" sandbox design
  // is meant to avoid.
  const compiled = new AsyncFunction('ctx', '"use strict";\n' + code);
  return function(pluginCtx) { return compiled(pluginCtx); };
}

// --- RPC channel over `self` ---
const channel = createRpcChannel({
  postMessage: function(msg) { self.postMessage(msg); },
  addListener: function(handler) {
    self.addEventListener('message', function(evt) { handler(evt.data); });
  },
  onCall: function(path, args) { return dispatch(workerHandlers, path, args); }
});

/** A Proxy that turns every property access into `channel.call([...prefix, prop], args)`. */
function makeApiProxy(prefix) {
  return new Proxy({}, {
    get: function(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      return function() {
        return channel.call(prefix.concat([prop]), Array.prototype.slice.call(arguments));
      };
    }
  });
}

function createUIApi() {
  return {
    inject: async function(selector, vnode, position) {
      const handleId = await channel.call(['ui', 'inject'], [selector, vnode, position]);
      return wrapDomHandle(handleId);
    },
    replace: async function(selector, vnode) {
      const handleId = await channel.call(['ui', 'replace'], [selector, vnode]);
      return wrapDomHandle(handleId);
    },
    registerComponent: async function(name, component) {
      if (!component || typeof component.render !== 'function') {
        throw new Error('registerComponent requires a { render } object');
      }
      componentRenderers.set(name, component.render);
      await channel.call(['ui', 'registerComponent'], [name, component.priority || 0]);
    },
    unregisterComponent: async function(name) {
      componentRenderers.delete(name);
      await channel.call(['ui', 'unregisterComponent'], [name]);
    },
    showToast: async function(message, type, duration) {
      await channel.call(['ui', 'showToast'], [message, type, duration]);
    }
  };
}

function wrapDomHandle(handleId) {
  if (handleId == null) {
    // Selector didn't match anything host-side; behave like a no-op undo.
    return { remove: async function() {}, update: async function() {} };
  }
  return {
    remove: async function() { await channel.call(['ui', 'removeInjected'], [handleId]); },
    update: async function(vnode) { await channel.call(['ui', 'updateInjected'], [handleId, vnode]); }
  };
}

function createEventsApi() {
  return {
    on: function(event, cb) {
      channel.call(['events', 'on'], [event, cb]);
      return function() { channel.call(['events', 'off'], [event, cb]); };
    },
    off: function(event, cb) {
      channel.call(['events', 'off'], [event, cb]);
    },
    once: function(event, cb) {
      const api = this;
      const wrapper = function() {
        api.off(event, wrapper);
        cb.apply(null, arguments);
      };
      return api.on(event, wrapper);
    },
    emit: function(event) {
      const args = Array.prototype.slice.call(arguments, 1);
      channel.call(['events', 'emit'], [event, args]);
    }
  };
}

function createMiddlewareApi() {
  return {
    register: function(middleware) {
      if (!middleware || !middleware.name || typeof middleware.handler !== 'function') {
        throw new Error('Middleware must have a name and a handler function');
      }
      const operations = middleware.operations || ['*'];
      if (operations.indexOf('card.render') !== -1) {
        // card.render is a batched, patch-returning decorator — no live DOM
        // node, no next()/stopPropagation (see docs/architecture/PLUGIN_SYSTEM.md
        // "The card.render decorator contract"). Handler signature is
        // (cardSnapshot, tileSnapshot) => patch, NOT (mwCtx, next) => {}.
        decoratorHandlers.set(middleware.name, middleware.handler);
      } else {
        middlewareHandlers.set(middleware.name, { operations: operations, handler: middleware.handler });
      }
      channel.call(['middleware', 'register'], [middleware.name, middleware.priority || 0, operations]);
      return function() {
        decoratorHandlers.delete(middleware.name);
        middlewareHandlers.delete(middleware.name);
        channel.call(['middleware', 'unregister'], [middleware.name]);
      };
    },
    unregister: function(name) {
      decoratorHandlers.delete(name);
      middlewareHandlers.delete(name);
      channel.call(['middleware', 'unregister'], [name]);
    }
  };
}

function createDataApi() {
  const proxy = makeApiProxy(['data']);
  return {
    getCard: proxy.getCard,
    listCards: proxy.listCards,
    createCard: proxy.createCard,
    updateCard: proxy.updateCard,
    deleteCard: proxy.deleteCard,
    getTags: proxy.getTags,
    addTag: proxy.addTag,
    removeTag: proxy.removeTag,
    setTags: proxy.setTags,
    getAllTags: proxy.getAllTags,
    onUpdate: function(callback) {
      // `callback` crosses as a handle (see plugin-rpc.js); the host invokes
      // it directly via that handle from Plugin.notifyDataUpdate(), so no
      // local bookkeeping is needed here beyond the handle round trip.
      channel.call(['data', 'onUpdate'], [callback]);
      return function() { channel.call(['data', 'offUpdate'], [callback]); };
    }
  };
}

function createNetworkApi() {
  return {
    fetch: async function(url, options) {
      const shim = await channel.call(['network', 'fetch'], [url, options]);
      return wrapFetchResponse(shim);
    },
    xhr: function() {
      throw new Error(
        'ctx.api.network.xhr() is not available in the sandboxed runtime — ' +
        'XMLHttpRequest\'s stateful/event-driven shape does not cross a Worker ' +
        'boundary safely. Use ctx.api.network.fetch(url, options) instead.'
      );
    }
  };
}

function wrapFetchResponse(shim) {
  const bytes = shim.bodyBuffer ? new Uint8Array(shim.bodyBuffer) : new Uint8Array(0);
  return {
    ok: shim.ok,
    status: shim.status,
    statusText: shim.statusText,
    url: shim.url,
    headers: {
      get: function(name) {
        const lower = String(name).toLowerCase();
        const found = (shim.headers || []).find(pair => pair[0].toLowerCase() === lower);
        return found ? found[1] : null;
      },
      entries: function() { return (shim.headers || [])[Symbol.iterator](); }
    },
    arrayBuffer: async function() { return bytes.buffer; },
    text: async function() { return new TextDecoder().decode(bytes); },
    json: async function() { return JSON.parse(new TextDecoder().decode(bytes)); }
  };
}

function createLogger() {
  const prefix = '[Plugin:' + pluginId + ']';
  return {
    log: function() { channel.call(['logger', 'log'], [prefix].concat(Array.from(arguments))); },
    info: function() { channel.call(['logger', 'info'], [prefix].concat(Array.from(arguments))); },
    warn: function() { channel.call(['logger', 'warn'], [prefix].concat(Array.from(arguments))); },
    error: function() { channel.call(['logger', 'error'], [prefix].concat(Array.from(arguments))); }
  };
}

function createContext(init) {
  return {
    modId: init.id,
    appVersion: init.appVersion || '0.21.0',
    schemaVersion: init.schemaVersion || 4,
    config: init.config,
    h: h,
    api: {
      ui: createUIApi(),
      data: createDataApi(),
      storage: makeApiProxy(['storage']),
      events: createEventsApi(),
      middleware: createMiddlewareApi(),
      network: createNetworkApi(),
      filesystem: makeApiProxy(['filesystem'])
    },
    utils: makeApiProxy(['utils']),
    logger: createLogger()
  };
}

const workerHandlers = {
  lifecycle: {
    init: async function(init) {
      pluginId = init.id;
      ctx = createContext(init);
      if (init.js) setupFn = compile(init.js);
      if (init.teardownJs) teardownFn = compile(init.teardownJs);
      return true;
    },
    runSetup: async function() {
      if (!setupFn) return undefined;
      return await setupFn(ctx);
    },
    runTeardown: async function() {
      if (!teardownFn) return undefined;
      return await teardownFn(ctx);
    }
  },

  ui: {
    // One-shot boot-time components: Header / Sidebar / SearchBar.
    componentRender: async function(name, props) {
      const render = componentRenderers.get(name);
      if (!render) throw new Error('No component registered: ' + name);
      return await render(props);
    },
    // Hot path: one call per render batch per plugin. Returns, for every
    // card in the snapshot, an optional replacement vnode (from a
    // registered 'Card' component) and/or an optional decorator patch
    // (merged from every card.render decorator this plugin registered).
    renderBatch: async function(cardsSnapshot, opts) {
      const cardComponent = componentRenderers.get('Card');
      const decorators = Array.from(decoratorHandlers.values());
      const out = [];
      for (const entry of cardsSnapshot) {
        const result = { cardId: entry.card.id, vnode: null, patch: null };
        if (cardComponent) {
          try {
            result.vnode = await cardComponent({
              card: entry.card,
              isSelected: entry.isSelected,
              opts: opts || {}
            });
          } catch (err) {
            channel.call(['logger', 'error'], ['[Plugin] Card render failed:', String(err)]);
          }
        }
        if (decorators.length) {
          const merged = { addClass: [], removeClass: [], setStyle: {}, setStyleByIndex: {}, appendChildren: {}, prependChildren: {} };
          for (const decorate of decorators) {
            try {
              const patch = await decorate(entry.card, entry.tileSnapshot);
              mergePatch(merged, patch);
            } catch (err) {
              channel.call(['logger', 'error'], ['[Plugin] card.render decorator failed:', String(err)]);
            }
          }
          result.patch = merged;
        }
        out.push(result);
      }
      return out;
    }
  },

  middleware: {
    // card.create / card.update / card.delete / card.save — full onion-model
    // semantics preserved via `next` as a round trip back into the host's
    // real pipeline.
    invoke: async function(name, operation, args, next) {
      const entry = middlewareHandlers.get(name);
      if (!entry) throw new Error('No middleware registered: ' + name);
      let prevented = false;
      let stopped = false;
      const mwCtx = {
        operation: operation,
        args: args,
        preventDefault: function() { prevented = true; },
        stopPropagation: function() { stopped = true; },
        get prevented() { return prevented; },
        get stopped() { return stopped; }
      };
      await entry.handler(mwCtx, next || (async function() {}));
      return { prevented: prevented, stopped: stopped, args: mwCtx.args };
    }
  }
};

function mergePatch(target, patch) {
  if (!patch) return;
  (patch.addClass || []).forEach(c => target.addClass.push(c));
  (patch.removeClass || []).forEach(c => target.removeClass.push(c));
  Object.assign(target.setStyle, patch.setStyle || {});
  Object.assign(target.setStyleByIndex, patch.setStyleByIndex || {});
  Object.keys(patch.appendChildren || {}).forEach(sel => {
    target.appendChildren[sel] = (target.appendChildren[sel] || []).concat(patch.appendChildren[sel]);
  });
  Object.keys(patch.prependChildren || {}).forEach(sel => {
    target.prependChildren[sel] = (target.prependChildren[sel] || []).concat(patch.prependChildren[sel]);
  });
}

self.postMessage({ id: 0, kind: 'ready' });
