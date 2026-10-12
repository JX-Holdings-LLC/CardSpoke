import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync, existsSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

test('web app declares an installable offline app shell', () => {
  const index = read('www/index.html');
  assert.ok(index.includes('rel="manifest" href="manifest.webmanifest"'));
  assert.ok(index.includes('offline-status.js'));
  assert.ok(index.includes('app-loader.js'));
});

test('web app declares square icons that exist', () => {
  const index = read('www/index.html');
  assert.ok(index.includes('rel="icon" href="favicon.svg"'));
  assert.ok(index.includes('rel="icon" href="favicon.ico"'));
  assert.ok(index.includes('rel="apple-touch-icon" href="apple-touch-icon.png"'));
  const manifest = JSON.parse(read('www/manifest.webmanifest'));
  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  // The wide wordmark must not be the install icon: launchers crop it to a square.
  assert.not.ok(manifest.icons.some((icon) => icon.src === 'CardSpoke.svg'));
  for (const icon of manifest.icons) {
    assert.ok(existsSync(new URL('../www/' + icon.src, import.meta.url)), icon.src);
    if (icon.type === 'image/png') {
      // PNG IHDR: width and height are big-endian at bytes 16 and 20.
      const data = readFileSync(new URL('../www/' + icon.src, import.meta.url));
      const [w, h] = icon.sizes.split('x').map(Number);
      assert.is(data.readUInt32BE(16), w, icon.src + ' width');
      assert.is(data.readUInt32BE(20), h, icon.src + ' height');
    }
  }
  for (const file of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) {
    assert.ok(existsSync(new URL('../www/' + file, import.meta.url)), file);
  }
});

test('service worker caches app shell assets', () => {
  const worker = read('www/service-worker.js');
  assert.ok(worker.includes('CACHE_VERSION'));
  assert.ok(worker.includes('./index.html'));
  assert.ok(worker.includes('./app.js'));
  assert.ok(worker.includes('./styles.css'));
  assert.ok(worker.includes('./offline-status.js'));
  assert.ok(worker.includes('./favicon.svg'));
  assert.ok(worker.includes('url.origin !== self.location.origin'));
  assert.ok(worker.includes('response.status === 200'));
  assert.ok(worker.includes("response.type === 'basic'"));
});

test('offline status reports explicit local save state', () => {
  const status = read('www/offline-status.js');
  assert.ok(status.includes('Saved locally'));
  assert.ok(status.includes('Saving locally'));
  assert.ok(status.includes('Local save failed'));
  assert.ok(status.includes("indicator.textContent !== text"));
});

test('public app carries no cloud storage drivers or hosted sync', () => {
  const storage = read('www/src/storage.js');
  assert.not.ok(storage.includes('GoogleDriveDriver'));
  assert.not.ok(storage.includes('OneDriveDriver'));
  assert.not.ok(storage.includes('WebDAVDriver'));
  assert.not.ok(storage.includes('syncToCloud'));
  const index = read('www/index.html');
  assert.not.ok(index.includes('accounts.google.com'));
  assert.not.ok(index.includes('msauth.net'));
});

test('storage policy requires offline-first behavior', () => {
  const policy = read('docs/policies/STORAGE_AND_PRIVACY.md');
  assert.ok(policy.includes('Offline use is a first-class experience'));
  assert.ok(policy.includes('Local saves are authoritative'));
  assert.ok(policy.includes('Remote sync may fail'));
});

test.run();
