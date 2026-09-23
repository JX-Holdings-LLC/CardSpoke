'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveAssetPath, isAppUrl, isExternalUrl, APP_ORIGIN } = require('../lib/url-policy');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cardspoke-web-'));
fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
fs.writeFileSync(path.join(root, 'app.js'), '');
fs.writeFileSync(path.join(root, 'test.html'), '');
fs.mkdirSync(path.join(root, 'sub'));
fs.writeFileSync(path.join(path.dirname(root), 'secret.txt'), 'nope');

test('app origin is recognised, others are not', () => {
  assert.equal(isAppUrl(APP_ORIGIN + '/index.html'), true);
  assert.equal(isAppUrl('cardspoke://evil/index.html'), false);
  assert.equal(isAppUrl('file:///etc/passwd'), false);
  assert.equal(isAppUrl('https://app/index.html'), false);
  assert.equal(isAppUrl('not a url'), false);
});

test('only http(s) and mailto links are handed to the OS', () => {
  assert.equal(isExternalUrl('https://github.com/jxburros'), true);
  assert.equal(isExternalUrl('http://example.com'), true);
  assert.equal(isExternalUrl('mailto:a@b.c'), true);
  assert.equal(isExternalUrl('javascript:alert(1)'), false);
  assert.equal(isExternalUrl('file:///C:/Windows/system32/calc.exe'), false);
  assert.equal(isExternalUrl('smb://host/share'), false);
});

test('resolves files inside the web root', () => {
  assert.equal(resolveAssetPath(root, APP_ORIGIN + '/index.html'), path.join(root, 'index.html'));
  assert.equal(resolveAssetPath(root, APP_ORIGIN + '/'), path.join(root, 'index.html'));
  assert.equal(resolveAssetPath(root, APP_ORIGIN + '/app.js?v=1#x'), path.join(root, 'app.js'));
});

test('refuses traversal, blocked, missing and non-file paths', () => {
  assert.equal(resolveAssetPath(root, APP_ORIGIN + '/../secret.txt'), null);
  assert.equal(resolveAssetPath(root, APP_ORIGIN + '/%2e%2e/secret.txt'), null);
  assert.equal(resolveAssetPath(root, APP_ORIGIN + '/..%2fsecret.txt'), null);
  assert.equal(resolveAssetPath(root, APP_ORIGIN + '/%00index.html'), null);
  assert.equal(resolveAssetPath(root, APP_ORIGIN + '/test.html'), null);
  assert.equal(resolveAssetPath(root, APP_ORIGIN + '/missing.js'), null);
  assert.equal(resolveAssetPath(root, APP_ORIGIN + '/sub'), null);
  assert.equal(resolveAssetPath(root, APP_ORIGIN + '/%E0%A4%A'), null);
  assert.equal(resolveAssetPath(root, 'cardspoke://other/index.html'), null);
});
