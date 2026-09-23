/*
 * CardSpoke offline app shell.
 *
 * This cache is intentionally limited to local, versioned app-shell assets.
 * User data remains in CardSpoke's local storage drivers and is never copied
 * into Cache Storage by this worker.
 */
// The embedded version below is rewritten from package.json on every
// `npm run build` (see vite.config.js "sync-service-worker-version"), so the
// cache namespace — and the worker's own bytes — change on every release.
// A byte-identical worker is never re-installed by the browser, which is how
// 0.18.1 shipped while returning users stayed pinned to the 0.18.0 cache.
const CACHE_VERSION = 'cardspoke-app-shell-v0.21.1-public-1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app-loader.js',
  './offline-status.js',
  './app.js',
  // Plugin sandbox worker entry point (new Worker(...) is a runtime
  // construct the browser can't discover ahead of time, so it has to be
  // precached explicitly like any other app-shell asset).
  './plugin-worker-bootstrap.js',
  './CardSpoke.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('cardspoke-app-shell-') && key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  // Cache only the declared shell, never arbitrary same-origin content or
  // query-bearing requests from extensions.
  const shellUrls = APP_SHELL.map(path => new URL(path, self.location.href).href);
  if (request.mode !== 'navigate' && !shellUrls.includes(url.href)) return;

  if (request.mode === 'navigate') {
    // Only a navigation to the app itself (the scope root or index.html) may
    // refresh the cached shell. Any other same-origin page (a dev harness,
    // a 200 error page, an unrelated document) must never be stored as
    // ./index.html, or every later offline launch would serve it instead.
    const scopePath = new URL('./', self.location.href).pathname;
    const isAppShellNavigation =
      url.pathname === scopePath || url.pathname === scopePath + 'index.html';
    event.respondWith(
      fetch(request)
        .then(response => {
          if (isAppShellNavigation && response && response.status === 200 &&
              (!response.type || response.type === 'basic') && !response.redirected) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Stale-while-revalidate for shell assets: cached bytes are served
  // immediately for offline speed, but every online hit also refreshes the
  // cache in the background so a client can never stay pinned to an old
  // app.js for more than one load, even if a cache-version bump is missed.
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      if (cached) {
        // Kick off the refresh without blocking the cached response.
        event.waitUntil(network.then(() => undefined).catch(() => undefined));
        return cached;
      }
      return network;
    })
  );
});
