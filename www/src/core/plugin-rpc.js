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

// Plugin RPC engine
//
// A symmetric, transport-agnostic request/response protocol used by both the
// host (main thread) and the plugin worker bootstrap to talk to each other
// over postMessage. Both sides run the exact same code from this module —
// only the `transport` (how to send/receive messages) and the `handlers`
// (what a `call` for a given path actually does) differ per side.
//
// Wire envelope (always a plain, structured-clone-safe object):
//   { id, kind: 'call',          path: string[], args: any[] }
//   { id, kind: 'result',        value: any }
//   { id, kind: 'error',         message: string }
//   { id, kind: 'invoke',        handle: number, args: any[] }
//   { id, kind: 'invoke-result', value: any }
//   { id, kind: 'invoke-error',  message: string }
//
// Functions cannot cross postMessage's structured clone. Any function found
// while serializing an outgoing payload is replaced with an opaque
// `{ __rpcHandle }` descriptor and stashed in a local callback table; the
// receiving side's deserializer turns that descriptor back into a callable
// stub that, when invoked, sends an `invoke` message back to whichever side
// minted the handle. This is what lets a plugin hand the host an event
// listener, a middleware handler, or a vnode's `onclick` without ever
// exposing a real function reference (or the closure it carries) across the
// isolation boundary.

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date || value instanceof Map || value instanceof Set) return false;
  if (typeof ArrayBuffer !== 'undefined' && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) return false;
  return true;
}

export function createRpcChannel(options) {
  const postMessage = options.postMessage;
  const addListener = options.addListener;
  // onCall(path, args) -> value | Promise<value>. Thrown/rejected errors are
  // reported back to the caller as an `error`/`invoke-error` message.
  const onCall = options.onCall || function() {
    throw new Error('No call handler registered for this RPC channel');
  };

  let nextId = 1;
  let nextHandle = 1;
  const pending = new Map(); // id -> { resolve, reject, sentAt }
  const callbacks = new Map(); // handle -> function
  // Reused so the SAME source function always serializes to the SAME handle
  // (needed for identity-based unsubscription, e.g. ctx.api.events.off(event,
  // cb) must recognize the `cb` it was given in an earlier on(event, cb)).
  const functionToHandle = new WeakMap();
  // Mirror cache on the receiving side: the SAME inbound handle always
  // deserializes to the SAME local stub function, so a caller that stores a
  // deserialized callback (e.g. the host's global event bus) can later
  // compare it by reference against a stub produced from a later message
  // carrying the same handle.
  const handleToLocalStub = new Map();

  function send(msg) {
    postMessage(msg);
  }

  function serialize(value) {
    if (typeof value === 'function') {
      let handle = functionToHandle.get(value);
      if (handle === undefined) {
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
    // Primitives, Date/Map/Set/typed arrays: handed to postMessage as-is and
    // left to the platform's structured clone algorithm.
    return value;
  }

  function deserialize(value) {
    if (value && typeof value === 'object' && typeof value.__rpcHandle === 'number') {
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
    try { send({ id, kind: 'call', path, args: serialize(args || []) }); }
    catch (error) { pending.get(id).reject(error); pending.delete(id); }
    return withTimeout(id, promise, opts && opts.timeoutMs);
  }

  function invoke(handle, args, opts) {
    const id = nextId++;
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, sentAt: Date.now() });
    });
    try { send({ id, kind: 'invoke', handle, args: serialize(args || []) }); }
    catch (error) { pending.get(id).reject(error); pending.delete(id); }
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
          reject(new Error('RPC call timed out after ' + timeoutMs + 'ms'));
        }
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  async function handleMessage(msg) {
    // Defensive: never trust the shape of an inbound message. A malformed or
    // spoofed envelope (a plugin can technically reach `self.postMessage`
    // directly, since `new Function` closes over the real worker global
    // scope) can at worst corrupt that plugin's own RPC state, never another
    // plugin's — each plugin has its own dedicated channel/worker.
    if (!msg || typeof msg !== 'object' || typeof msg.id !== 'number' || typeof msg.kind !== 'string') {
      return;
    }

    switch (msg.kind) {
      case 'call': {
        try {
          const result = await onCall(msg.path, deserialize(msg.args));
          send({ id: msg.id, kind: 'result', value: serialize(result) });
        } catch (err) {
          send({ id: msg.id, kind: 'error', message: describeError(err) });
        }
        break;
      }
      case 'invoke': {
        try {
          const fn = callbacks.get(msg.handle);
          if (!fn) throw new Error('Unknown callback handle: ' + msg.handle);
          const result = await fn.apply(null, deserialize(msg.args));
          send({ id: msg.id, kind: 'invoke-result', value: serialize(result) });
        } catch (err) {
          send({ id: msg.id, kind: 'invoke-error', message: describeError(err) });
        }
        break;
      }
      case 'result':
      case 'invoke-result': {
        const entry = pending.get(msg.id);
        if (entry) {
          pending.delete(msg.id);
          entry.resolve(deserialize(msg.value));
        }
        break;
      }
      case 'error':
      case 'invoke-error': {
        const entry = pending.get(msg.id);
        if (entry) {
          pending.delete(msg.id);
          entry.reject(new Error(msg.message || 'RPC call failed'));
        }
        break;
      }
      default:
        break;
    }
  }

  function describeError(err) {
    if (err && typeof err.message === 'string') return err.message;
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
      pending.forEach(entry => entry.reject(err));
      pending.clear();
    },
    /** Age in ms of the oldest still-pending request, or 0 if none. Used for hang detection. */
    oldestPendingAgeMs() {
      let oldest = 0;
      const now = Date.now();
      pending.forEach(entry => {
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

/**
 * Walks a nested handler object using a path array, e.g. dispatch(handlers,
 * ['data', 'listCards'], args) calls handlers.data.listCards(...args).
 * Throws a clear error for an unknown/malformed path instead of a raw
 * "cannot read property of undefined".
 */
export function dispatch(handlers, path, args) {
  if (!Array.isArray(path) || path.length === 0 || path.some(key =>
    typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) ||
    (args !== undefined && !Array.isArray(args))) {
    throw new Error('Invalid RPC path');
  }
  let target = handlers;
  for (let i = 0; i < path.length - 1; i++) {
    // Only traverse explicitly exported namespaces, never function objects or
    // inherited properties such as Function.prototype.constructor.
    target = target && typeof target === 'object' && Object.hasOwn(target, path[i]) ? target[path[i]] : undefined;
    if (!target) throw new Error('Unknown RPC path: ' + path.join('.'));
  }
  const method = target && typeof target === 'object' && Object.hasOwn(target, path[path.length - 1])
    ? target[path[path.length - 1]] : undefined;
  if (typeof method !== 'function') {
    throw new Error('Unknown RPC method: ' + path.join('.'));
  }
  return method.apply(target, args || []);
}
