/**
 * Service-worker behavioral tests (CS-101).
 *
 * 0.18.1 shipped critical fixes but never advanced the service-worker cache
 * namespace, so returning users controlled by the 0.18.0 worker kept the old
 * cache-first app.js indefinitely. These tests execute the real worker script
 * against a mocked Cache Storage / fetch environment and prove:
 *
 *   1. the cache namespace embeds the package.json version (no drift);
 *   2. install pre-caches the app shell under the current namespace;
 *   3. activate (the N → N+1 upgrade path) deletes every older CardSpoke
 *      cache while leaving the current one and unrelated caches intact;
 *   4. shell assets are served stale-while-revalidate: cached bytes respond
 *      immediately but the cache is refreshed from the network;
 *   5. navigations fall back to the cached index.html when offline.
 */

import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://cardspoke.test';
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;
const WORKER_SOURCE = readFileSync(join(ROOT, 'www', 'service-worker.js'), 'utf-8');
const CURRENT_CACHE = `cardspoke-app-shell-v${PKG_VERSION}-public-1`;

function keyOf(req) {
  return typeof req === 'string' ? req : req.url;
}

/**
 * Run the worker script with a mocked self/caches/fetch and return handles
 * to its registered listeners and the mock state.
 *
 * @param {Object} [opts]
 * @param {Object<string, Object<string, any>>} [opts.cacheStores] initial
 *   Cache Storage state: cache name → (request key → response).
 * @param {Object<string, any>} [opts.network] request key → response body;
 *   keys absent from this map reject like a dead network.
 */
function bootWorker({ cacheStores = {}, network = {} } = {}) {
  const stores = new Map(
    Object.entries(cacheStores).map(([name, entries]) => [name, new Map(Object.entries(entries))])
  );
  const deletedCaches = [];
  const caches = {
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        addAll: async urls => {
          urls.forEach(u => store.set(u, { status: 200, type: 'basic', body: `precached:${u}` }));
        },
        put: async (req, resp) => { store.set(keyOf(req), resp); },
        match: async req => store.get(keyOf(req))
      };
    },
    keys: async () => [...stores.keys()],
    delete: async name => { deletedCaches.push(name); return stores.delete(name); },
    match: async req => {
      for (const store of stores.values()) {
        if (store.has(keyOf(req))) return store.get(keyOf(req));
      }
      return undefined;
    }
  };

  const fetchCalls = [];
  const fetch = async req => {
    const key = keyOf(req);
    fetchCalls.push(key);
    if (!(key in network)) throw new TypeError('network unavailable: ' + key);
    return { status: 200, type: 'basic', body: network[key], clone() { return this; } };
  };

  const listeners = {};
  const state = { skipWaited: false, claimed: false };
  const self = {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    skipWaiting: () => { state.skipWaited = true; },
    clients: { claim: () => { state.claimed = true; } },
    location: { origin: ORIGIN, href: ORIGIN + '/service-worker.js' }
  };

  new Function('self', 'caches', 'fetch', WORKER_SOURCE)(self, caches, fetch);
  return { listeners, stores, deletedCaches, fetchCalls, state };
}

function lifecycleEvent() {
  const ev = { done: Promise.resolve() };
  ev.waitUntil = p => { ev.done = Promise.resolve(p); };
  return ev;
}

function fetchEvent(request) {
  const waits = [];
  const ev = {
    request,
    response: undefined,
    waits,
    respondWith(p) { ev.response = Promise.resolve(p); },
    waitUntil(p) { waits.push(Promise.resolve(p).catch(() => undefined)); }
  };
  return ev;
}

const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0));

test('cache namespace embeds the package.json version', () => {
  const match = WORKER_SOURCE.match(/const CACHE_VERSION = '([^']+)';/);
  assert.ok(match, 'CACHE_VERSION declaration should exist');
  assert.is(match[1], CURRENT_CACHE,
    `service-worker cache version (${match[1]}) must advance with package.json (${PKG_VERSION})`);
});

test('install pre-caches the app shell (including app.js) under the current namespace', async () => {
  const w = bootWorker();
  const ev = lifecycleEvent();
  w.listeners.install(ev);
  await ev.done;

  const store = w.stores.get(CURRENT_CACHE);
  assert.ok(store, 'current cache namespace should be created on install');
  assert.ok(store.has('./app.js'), 'app.js should be pre-cached');
  assert.ok(store.has('./index.html'), 'index.html should be pre-cached');
  assert.ok(w.state.skipWaited, 'a new worker must activate immediately (skipWaiting)');
});

test('activate deletes older CardSpoke caches but not the current or unrelated ones (N → N+1)', async () => {
  const w = bootWorker({
    cacheStores: {
      'cardspoke-app-shell-v0.18.0-public-1': { './app.js': { body: 'old-release' } },
      'cardspoke-app-shell-v0.18.1-public-1': { './app.js': { body: 'previous-release' } },
      [CURRENT_CACHE]: { './app.js': { body: 'current-release' } },
      'someone-elses-cache': {}
    }
  });
  const ev = lifecycleEvent();
  w.listeners.activate(ev);
  await ev.done;

  assert.ok(w.deletedCaches.includes('cardspoke-app-shell-v0.18.0-public-1'));
  assert.ok(w.deletedCaches.includes('cardspoke-app-shell-v0.18.1-public-1'));
  assert.not.ok(w.deletedCaches.includes(CURRENT_CACHE), 'current cache must survive activation');
  assert.not.ok(w.deletedCaches.includes('someone-elses-cache'), 'unrelated caches must survive');
  assert.ok(w.state.claimed, 'the new worker must take control of open clients');
});

test('shell assets are stale-while-revalidate: cached bytes respond, cache refreshes from network', async () => {
  const url = ORIGIN + '/app.js';
  const w = bootWorker({
    cacheStores: { [CURRENT_CACHE]: { [url]: { status: 200, type: 'basic', body: 'stale-bytes' } } },
    network: { [url]: 'fresh-bytes' }
  });

  const ev = fetchEvent({ method: 'GET', mode: 'no-cors', url });
  w.listeners.fetch(ev);
  const response = await ev.response;
  assert.is(response.body, 'stale-bytes', 'cached response is served without waiting for the network');

  await Promise.all(ev.waits);
  await flushMicrotasks();
  assert.ok(w.fetchCalls.includes(url), 'a background revalidation request must be issued');
  assert.is(w.stores.get(CURRENT_CACHE).get(url).body, 'fresh-bytes',
    'the cache must hold the fresh network bytes after revalidation');
});

test('uncached shell assets fall through to the network and are cached', async () => {
  const url = ORIGIN + '/styles.css';
  const w = bootWorker({ network: { [url]: 'network-bytes' } });

  const ev = fetchEvent({ method: 'GET', mode: 'no-cors', url });
  w.listeners.fetch(ev);
  const response = await ev.response;
  assert.is(response.body, 'network-bytes');

  await flushMicrotasks();
  assert.is(w.stores.get(CURRENT_CACHE).get(url).body, 'network-bytes');
});

test('offline navigation falls back to the cached index.html', async () => {
  const w = bootWorker({
    cacheStores: { [CURRENT_CACHE]: { './index.html': { status: 200, body: 'cached-shell' } } },
    network: {} // dead network
  });

  const ev = fetchEvent({ method: 'GET', mode: 'navigate', url: ORIGIN + '/' });
  w.listeners.fetch(ev);
  const response = await ev.response;
  assert.is(response.body, 'cached-shell');
});

test('same-origin non-shell requests are not intercepted or cached', () => {
  const w = bootWorker();
  for (const path of ['/private.json', '/app.js?private=data']) {
    let intercepted = false;
    w.listeners.fetch({ request: { method: 'GET', url: ORIGIN + path, mode: 'cors' }, respondWith() { intercepted = true; }, waitUntil() {} });
    assert.not.ok(intercepted);
  }
});
test.run();
