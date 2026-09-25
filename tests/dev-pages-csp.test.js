/**
 * Dev-only harness pages (www/diagnostic.html, www/test.html) and the
 * index.html CSP comment.
 *
 *  - Each harness has a restrictive CSP like index.html. Its one inline
 *    script is allowed by sha256 hash, so editing the script without
 *    updating the hash fails here instead of silently breaking the page.
 *  - diagnostic.html never writes attacker-influenced strings (localStorage
 *    key names, error messages) with innerHTML.
 *  - Neither page is copied into the built site (vite.config.js SITE_FILES).
 *  - The index.html CSP comment names the real reason for 'unsafe-eval'.
 */

import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

function cspOf(html) {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function directive(csp, name) {
  const part = csp.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' '));
  return part ? part.slice(name.length).trim().split(/\s+/) : null;
}

for (const page of ['www/diagnostic.html', 'www/test.html']) {
  test(`${page} has a restrictive CSP that allows its inline script only by hash`, () => {
    const html = read(page);
    const csp = cspOf(html);
    assert.ok(csp, 'CSP meta present');
    assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'CSP precedes any script');
    assert.equal(directive(csp, 'default-src'), ["'self'"]);
    assert.equal(directive(csp, 'object-src'), ["'none'"]);
    assert.equal(directive(csp, 'frame-src'), ["'none'"]);
    assert.equal(directive(csp, 'base-uri'), ["'self'"]);
    const scriptSrc = directive(csp, 'script-src');
    assert.not.ok(scriptSrc.includes("'unsafe-inline'"), "no 'unsafe-inline' scripts");
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(inline.length > 0);
    inline.forEach(body => {
      // HTML parsing normalizes CRLF/CR to LF before CSP hashes the script.
      // Match that behavior on Windows checkouts without changing the policy.
      const hash = "'sha256-" + createHash('sha256').update(body.replace(/\r\n?/g, '\n'), 'utf8').digest('base64') + "'";
      assert.ok(scriptSrc.includes(hash), `inline script hash ${hash} must be listed in script-src`);
    });
  });
}

test('diagnostic.html writes results with DOM APIs, never innerHTML', () => {
  const html = read('www/diagnostic.html');
  assert.not.ok(/\.innerHTML\s*=/.test(html), 'no innerHTML assignments');
  assert.not.ok(/insertAdjacentHTML|outerHTML\s*=|document\.write/.test(html));
  assert.ok(/textContent/.test(html));
});

test('dev-only pages are not copied into the built site', () => {
  const vite = read('vite.config.js');
  const list = vite.match(/const SITE_FILES = \[([\s\S]*?)\];/);
  assert.ok(list, 'SITE_FILES list found');
  const code = list[1].replace(/\/\/.*$/gm, '');
  assert.not.ok(/diagnostic\.html/.test(code), 'diagnostic.html not in SITE_FILES');
  assert.not.ok(/test\.html/.test(code), 'test.html not in SITE_FILES');
});

test("index.html CSP comment attributes 'unsafe-eval' to the install-time syntax check", () => {
  const html = read('www/index.html');
  const comment = html.match(/<!-- Content Security Policy\.([\s\S]*?)-->/);
  assert.ok(comment);
  assert.ok(/_checkSyntax/.test(comment[1]), 'names _checkSyntax');
  assert.not.ok(/compiles JSON\s+plugin setup/.test(comment[1]), 'stale explanation removed');
  assert.ok(directive(cspOf(html), 'script-src').includes("'unsafe-eval'"), 'policy itself unchanged');
});

test.run();
