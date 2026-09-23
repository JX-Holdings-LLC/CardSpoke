// www/src/core/plugin-rpc.js
function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date || value instanceof Map || value instanceof Set) return false;
  if (typeof ArrayBuffer !== "undefined" && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) return false;
  return true;
}
function createRpcChannel(options) {
  const postMessage = options.postMessage;
  const addListener = options.addListener;
  const onCall = options.onCall || function() {
    throw new Error("No call handler registered for this RPC channel");
  };
  let nextId = 1;
  let nextHandle = 1;
  const pending = /* @__PURE__ */ new Map();
  const callbacks = /* @__PURE__ */ new Map();
  const functionToHandle = /* @__PURE__ */ new WeakMap();
  const handleToLocalStub = /* @__PURE__ */ new Map();
  function send(msg) {
    postMessage(msg);
  }
  function serialize(value) {
    if (typeof value === "function") {
      let handle = functionToHandle.get(value);
      if (handle === void 0) {
        handle = nextHandle++;
        functionToHandle.set(value, handle);
        callbacks.set(handle, value);
      }
      return { __rpcHandle: handle };
    }
    if (Array.isArray(value)) {
      return value.map(serialize);
    }
    if (isPlainObject(value)) {
      const out = {};
      for (const key of Object.keys(value)) Object.defineProperty(out, key, { value: serialize(value[key]), enumerable: true, writable: true, configurable: true });
      return out;
    }
    return value;
  }
  function deserialize(value) {
    if (value && typeof value === "object" && typeof value.__rpcHandle === "number") {
      const handle = value.__rpcHandle;
      let stub = handleToLocalStub.get(handle);
      if (!stub) {
        stub = function remoteCallback() {
          return invoke(handle, Array.prototype.slice.call(arguments));
        };
        handleToLocalStub.set(handle, stub);
      }
      return stub;
    }
    if (Array.isArray(value)) {
      return value.map(deserialize);
    }
    if (isPlainObject(value)) {
      const out = {};
      for (const key of Object.keys(value)) Object.defineProperty(out, key, { value: deserialize(value[key]), enumerable: true, writable: true, configurable: true });
      return out;
    }
    return value;
  }
  function call(path, args, opts) {
    const id = nextId++;
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, sentAt: Date.now() });
    });
    try {
      send({ id, kind: "call", path, args: serialize(args || []) });
    } catch (error) {
      pending.get(id).reject(error);
      pending.delete(id);
    }
    return withTimeout(id, promise, opts && opts.timeoutMs);
  }
  function invoke(handle, args, opts) {
    const id = nextId++;
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, sentAt: Date.now() });
    });
    try {
      send({ id, kind: "invoke", handle, args: serialize(args || []) });
    } catch (error) {
      pending.get(id).reject(error);
      pending.delete(id);
    }
    return withTimeout(id, promise, opts && opts.timeoutMs);
  }
  function withTimeout(id, promise, timeoutMs) {
    if (!timeoutMs) return promise;
    let timer = null;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        const entry = pending.get(id);
        if (entry) {
          pending.delete(id);
          reject(new Error("RPC call timed out after " + timeoutMs + "ms"));
        }
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
  async function handleMessage(msg) {
    if (!msg || typeof msg !== "object" || typeof msg.id !== "number" || typeof msg.kind !== "string") {
      return;
    }
    switch (msg.kind) {
      case "call": {
        try {
          const result = await onCall(msg.path, deserialize(msg.args));
          send({ id: msg.id, kind: "result", value: serialize(result) });
        } catch (err) {
          send({ id: msg.id, kind: "error", message: describeError(err) });
        }
        break;
      }
      case "invoke": {
        try {
          const fn = callbacks.get(msg.handle);
          if (!fn) throw new Error("Unknown callback handle: " + msg.handle);
          const result = await fn.apply(null, deserialize(msg.args));
          send({ id: msg.id, kind: "invoke-result", value: serialize(result) });
        } catch (err) {
          send({ id: msg.id, kind: "invoke-error", message: describeError(err) });
        }
        break;
      }
      case "result":
      case "invoke-result": {
        const entry = pending.get(msg.id);
        if (entry) {
          pending.delete(msg.id);
          entry.resolve(deserialize(msg.value));
        }
        break;
      }
      case "error":
      case "invoke-error": {
        const entry = pending.get(msg.id);
        if (entry) {
          pending.delete(msg.id);
          entry.reject(new Error(msg.message || "RPC call failed"));
        }
        break;
      }
      default:
        break;
    }
  }
  function describeError(err) {
    if (err && typeof err.message === "string") return err.message;
    return String(err);
  }
  addListener(handleMessage);
  return {
    call,
    invoke,
    releaseCallback(handle) {
      callbacks.delete(handle);
    },
    /** Reject every in-flight request (used when a worker is being terminated). */
    rejectAll(err) {
      pending.forEach((entry) => entry.reject(err));
      pending.clear();
    },
    /** Age in ms of the oldest still-pending request, or 0 if none. Used for hang detection. */
    oldestPendingAgeMs() {
      let oldest = 0;
      const now = Date.now();
      pending.forEach((entry) => {
        const age = now - entry.sentAt;
        if (age > oldest) oldest = age;
      });
      return oldest;
    },
    pendingCount() {
      return pending.size;
    }
  };
}
function dispatch(handlers, path, args) {
  if (!Array.isArray(path) || path.length === 0 || path.some((key) => typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) || args !== void 0 && !Array.isArray(args)) {
    throw new Error("Invalid RPC path");
  }
  let target = handlers;
  for (let i = 0; i < path.length - 1; i++) {
    target = target && typeof target === "object" && Object.hasOwn(target, path[i]) ? target[path[i]] : void 0;
    if (!target) throw new Error("Unknown RPC path: " + path.join("."));
  }
  const method = target && typeof target === "object" && Object.hasOwn(target, path[path.length - 1]) ? target[path[path.length - 1]] : void 0;
  if (typeof method !== "function") {
    throw new Error("Unknown RPC method: " + path.join("."));
  }
  return method.apply(target, args || []);
}

// www/src/core/plugin-vnode.js
var SAFE_TAGS = new Set("a abbr b blockquote br button caption code col colgroup dd del details div dl dt em fieldset figcaption figure h1 h2 h3 h4 h5 h6 hr i img input kbd label legend li mark ol optgroup option p pre progress s samp section select small span strong sub summary sup table tbody td textarea th thead time tr u ul".split(" "));
var SAFE_ATTRIBUTES = new Set("id title role tabindex type name placeholder value checked disabled readonly multiple selected min max step rows cols maxlength minlength for colspan rowspan scope open hidden alt width height href src target rel download loading autocomplete".split(" "));
function h(tag, props, children) {
  if (typeof tag !== "string" || !tag) {
    throw new Error("ctx.h: tag must be a non-empty string");
  }
  return {
    __vnode: true,
    tag,
    props: props || {},
    children: normalizeChildren(children)
  };
}
function normalizeChildren(children) {
  if (children == null) return [];
  const flat = Array.isArray(children) ? children : [children];
  return flat.filter((c) => c !== null && c !== void 0 && c !== false);
}

// www/src/core/plugin-worker-bootstrap.js
var REMOVED_GLOBALS = ["fetch", "XMLHttpRequest", "WebSocket", "WebTransport", "EventSource", "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker", "importScripts"];
function removeCapability(object, name) {
  for (let current = object; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    if (current === object || Object.hasOwn(current, name)) {
      try {
        Object.defineProperty(current, name, { value: void 0, configurable: false, writable: false });
      } catch (_error) {
        throw new Error("Cannot disable worker capability: " + name);
      }
    }
  }
}
REMOVED_GLOBALS.forEach((name) => removeCapability(self, name));
if (self.navigator) ["sendBeacon", "storage", "serviceWorker", "locks"].forEach((name) => removeCapability(self.navigator, name));
var pluginId = null;
var ctx = null;
var setupFn = null;
var teardownFn = null;
var componentRenderers = /* @__PURE__ */ new Map();
var middlewareHandlers = /* @__PURE__ */ new Map();
var decoratorHandlers = /* @__PURE__ */ new Map();
var AsyncFunction = Object.getPrototypeOf(async function() {
}).constructor;
function compile(code) {
  const compiled = new AsyncFunction("ctx", '"use strict";\n' + code);
  return function(pluginCtx) {
    return compiled(pluginCtx);
  };
}
var channel = createRpcChannel({
  postMessage: function(msg) {
    self.postMessage(msg);
  },
  addListener: function(handler) {
    self.addEventListener("message", function(evt) {
      handler(evt.data);
    });
  },
  onCall: function(path, args) {
    return dispatch(workerHandlers, path, args);
  }
});
function makeApiProxy(prefix) {
  return new Proxy({}, {
    get: function(_target, prop) {
      if (typeof prop !== "string") return void 0;
      return function() {
        return channel.call(prefix.concat([prop]), Array.prototype.slice.call(arguments));
      };
    }
  });
}
function createUIApi() {
  return {
    inject: async function(selector, vnode, position) {
      const handleId = await channel.call(["ui", "inject"], [selector, vnode, position]);
      return wrapDomHandle(handleId);
    },
    replace: async function(selector, vnode) {
      const handleId = await channel.call(["ui", "replace"], [selector, vnode]);
      return wrapDomHandle(handleId);
    },
    registerComponent: async function(name, component) {
      if (!component || typeof component.render !== "function") {
        throw new Error("registerComponent requires a { render } object");
      }
      const won = await channel.call(["ui", "registerComponent"], [name, component.priority || 0]);
      if (won !== false) componentRenderers.set(name, component.render);
      return won;
    },
    unregisterComponent: async function(name) {
      componentRenderers.delete(name);
      await channel.call(["ui", "unregisterComponent"], [name]);
    },
    showToast: async function(message, type, duration) {
      await channel.call(["ui", "showToast"], [message, type, duration]);
    }
  };
}
function wrapDomHandle(handleId) {
  if (handleId == null) {
    return { remove: async function() {
    }, update: async function() {
    } };
  }
  return {
    remove: async function() {
      await channel.call(["ui", "removeInjected"], [handleId]);
    },
    update: async function(vnode) {
      await channel.call(["ui", "updateInjected"], [handleId, vnode]);
    }
  };
}
function createEventsApi() {
  return {
    on: function(event, cb) {
      channel.call(["events", "on"], [event, cb]);
      return function() {
        channel.call(["events", "off"], [event, cb]);
      };
    },
    off: function(event, cb) {
      channel.call(["events", "off"], [event, cb]);
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
      channel.call(["events", "emit"], [event, args]);
    }
  };
}
function createMiddlewareApi() {
  return {
    register: function(middleware) {
      if (!middleware || !middleware.name || typeof middleware.handler !== "function") {
        throw new Error("Middleware must have a name and a handler function");
      }
      const operations = middleware.operations || ["*"];
      const isDecorator = operations.indexOf("card.render") !== -1;
      let cancelled = false;
      const ready = channel.call(["middleware", "register"], [middleware.name, middleware.priority || 0, operations]).then(function() {
        if (cancelled) return;
        if (isDecorator) {
          decoratorHandlers.set(middleware.name, middleware.handler);
        } else {
          middlewareHandlers.set(middleware.name, { operations, handler: middleware.handler });
        }
      }, function(err) {
        channel.call(["logger", "error"], ["[Plugin:" + pluginId + '] middleware "' + middleware.name + '" was not registered: ' + String(err && err.message || err)]);
        throw err;
      });
      ready.catch(function() {
      });
      const unregister = function() {
        cancelled = true;
        decoratorHandlers.delete(middleware.name);
        middlewareHandlers.delete(middleware.name);
        channel.call(["middleware", "unregister"], [middleware.name]);
      };
      unregister.ready = ready;
      return unregister;
    },
    unregister: function(name) {
      decoratorHandlers.delete(name);
      middlewareHandlers.delete(name);
      channel.call(["middleware", "unregister"], [name]);
    }
  };
}
function createDataApi() {
  const proxy = makeApiProxy(["data"]);
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
      channel.call(["data", "onUpdate"], [callback]);
      return function() {
        channel.call(["data", "offUpdate"], [callback]);
      };
    }
  };
}
function createNetworkApi() {
  return {
    fetch: async function(url, options) {
      const shim = await channel.call(["network", "fetch"], [url, options]);
      return wrapFetchResponse(shim);
    },
    xhr: function() {
      throw new Error(
        "ctx.api.network.xhr() is not available in the sandboxed runtime \u2014 XMLHttpRequest's stateful/event-driven shape does not cross a Worker boundary safely. Use ctx.api.network.fetch(url, options) instead."
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
        const found = (shim.headers || []).find((pair) => pair[0].toLowerCase() === lower);
        return found ? found[1] : null;
      },
      entries: function() {
        return (shim.headers || [])[Symbol.iterator]();
      }
    },
    arrayBuffer: async function() {
      return bytes.buffer;
    },
    text: async function() {
      return new TextDecoder().decode(bytes);
    },
    json: async function() {
      return JSON.parse(new TextDecoder().decode(bytes));
    }
  };
}
function createLogger() {
  const prefix = "[Plugin:" + pluginId + "]";
  return {
    log: function() {
      channel.call(["logger", "log"], [prefix].concat(Array.from(arguments)));
    },
    info: function() {
      channel.call(["logger", "info"], [prefix].concat(Array.from(arguments)));
    },
    warn: function() {
      channel.call(["logger", "warn"], [prefix].concat(Array.from(arguments)));
    },
    error: function() {
      channel.call(["logger", "error"], [prefix].concat(Array.from(arguments)));
    }
  };
}
function createContext(init) {
  return {
    modId: init.id,
    appVersion: init.appVersion || "0.21.0",
    schemaVersion: init.schemaVersion || 4,
    config: init.config,
    h,
    api: {
      ui: createUIApi(),
      data: createDataApi(),
      storage: makeApiProxy(["storage"]),
      events: createEventsApi(),
      middleware: createMiddlewareApi(),
      network: createNetworkApi(),
      filesystem: makeApiProxy(["filesystem"])
    },
    utils: makeApiProxy(["utils"]),
    logger: createLogger()
  };
}
var workerHandlers = {
  lifecycle: {
    init: async function(init) {
      pluginId = init.id;
      ctx = createContext(init);
      if (init.js) setupFn = compile(init.js);
      if (init.teardownJs) teardownFn = compile(init.teardownJs);
      return true;
    },
    runSetup: async function() {
      if (!setupFn) return void 0;
      return await setupFn(ctx);
    },
    runTeardown: async function() {
      if (!teardownFn) return void 0;
      return await teardownFn(ctx);
    }
  },
  ui: {
    // One-shot boot-time components: Header / Sidebar / SearchBar.
    componentRender: async function(name, props) {
      const render = componentRenderers.get(name);
      if (!render) throw new Error("No component registered: " + name);
      return await render(props);
    },
    // Hot path: one call per render batch per plugin. Returns, for every
    // card in the snapshot, an optional replacement vnode (from a
    // registered 'Card' component) and/or an optional decorator patch
    // (merged from every card.render decorator this plugin registered).
    renderBatch: async function(cardsSnapshot, opts) {
      const cardComponent = componentRenderers.get("Card");
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
            channel.call(["logger", "error"], ["[Plugin] Card render failed:", String(err)]);
          }
        }
        if (decorators.length) {
          const merged = { addClass: [], removeClass: [], setStyle: {}, setStyleByIndex: {}, appendChildren: {}, prependChildren: {} };
          for (const decorate of decorators) {
            try {
              const patch = await decorate(entry.card, entry.tileSnapshot);
              mergePatch(merged, patch);
            } catch (err) {
              channel.call(["logger", "error"], ["[Plugin] card.render decorator failed:", String(err)]);
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
      if (!entry) throw new Error("No middleware registered: " + name);
      let prevented = false;
      let stopped = false;
      const mwCtx = {
        operation,
        args,
        preventDefault: function() {
          prevented = true;
        },
        stopPropagation: function() {
          stopped = true;
        },
        get prevented() {
          return prevented;
        },
        get stopped() {
          return stopped;
        }
      };
      await entry.handler(mwCtx, next || (async function() {
      }));
      return { prevented, stopped, args: mwCtx.args };
    }
  }
};
function mergePatch(target, patch) {
  if (!patch) return;
  (patch.addClass || []).forEach((c) => target.addClass.push(c));
  (patch.removeClass || []).forEach((c) => target.removeClass.push(c));
  Object.assign(target.setStyle, patch.setStyle || {});
  Object.assign(target.setStyleByIndex, patch.setStyleByIndex || {});
  Object.keys(patch.appendChildren || {}).forEach((sel) => {
    target.appendChildren[sel] = (target.appendChildren[sel] || []).concat(patch.appendChildren[sel]);
  });
  Object.keys(patch.prependChildren || {}).forEach((sel) => {
    target.prependChildren[sel] = (target.prependChildren[sel] || []).concat(patch.prependChildren[sel]);
  });
}
self.postMessage({ id: 0, kind: "ready" });
//# sourceMappingURL=plugin-worker-bootstrap.js.map
