import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PluginValidator } from '../www/src/core/plugin-validator.js';
const base = new URL('../sample-plugins/advanced/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('manifest.json', base))).plugins;
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
test('advanced collection contains three real packages for each level', () => {
  for (const layer of ['theme', 'feature', 'app']) assert.is(catalog.filter(item => item.layer === layer).length, 3);
  assert.is(new Set(catalog.map(item => item.id)).size, 9);
});
for (const entry of catalog) test(entry.id + ' validates and compiles as a standalone package', () => {
  const pkg = JSON.parse(readFileSync(new URL(entry.file, base)));
  const originalCSS = pkg.css;
  const result = PluginValidator.validate(pkg);
  assert.ok(result.valid, result.errors.join('; '));
  assert.is(pkg.css, originalCSS, 'Published CSS should need no sanitizer repairs');
  assert.is(pkg.id, pkg.manifest.id);
  assert.is(pkg.manifest.layer, entry.layer);
  assert.ok(pkg.css.length > 1000);
  if (entry.layer === 'theme') {
    assert.not.ok(pkg.js);
    assert.ok(pkg.css.includes(':root.dark'));
    assert.ok(pkg.css.includes('prefers-reduced-motion'));
    assert.ok(pkg.css.includes('@media print'));
  } else {
    assert.not.throws(() => new AsyncFunction('ctx', pkg.js));
    assert.not.ok(/\b(document|window|localStorage)\./.test(pkg.js));
    assert.not.ok(/\b(import|export)\s/.test(pkg.js));
  }
});
test('theme light/dark body and muted text meet 4.5:1 palette contrast', () => {
  const luminance = hex => {
    const channels = hex.replace('#', '').match(/../g).map(part => parseInt(part, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const entry of catalog.filter(item => item.layer === 'theme')) {
    const pkg = JSON.parse(readFileSync(new URL(entry.file, base)));
    for (const match of pkg.css.matchAll(/:root(?:\.dark)?\s*\{([^}]+)\}/g)) {
      if (!match[1].includes('--text-ghost:')) continue; // print palette is separate
      const values = Object.fromEntries([...match[1].matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]));
      for (const foreground of ['--text', '--text-medium', '--text-muted', '--text-ghost', '--accent-strong']) {
        for (const background of ['--bg', '--surface']) {
          const a = luminance(values[foreground]), b = luminance(values[background]);
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          assert.ok(ratio >= 4.5, entry.id + ' ' + foreground + '/' + background + ': ' + ratio);
        }
      }
    }
  }
});
test('shipped JSON packages match readable source files', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-advanced-plugins.mjs', import.meta.url)), '--check']);
});
test.run();
