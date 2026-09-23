/**
 * Sample Plugin Package Test Suite
 *
 * Validates every package in sample-plugins/ against the real
 * PluginValidator and the package-format conventions documented in
 * docs/architecture/PLUGIN_SYSTEM.md:
 *   - js is a SETUP BODY receiving `ctx` (never a self-registering script)
 *   - permissions used by the code are declared in the manifest
 *   - the gallery manifest lists every package with a matching id
 */

import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PluginValidator } from '../www/src/core/plugin-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(__dirname, '..', 'sample-plugins');

const VALID_LAYERS = ['theme', 'feature', 'app'];
const KNOWN_PERMISSIONS = ['ui-override', 'storage', 'network', 'filesystem', 'core-override', 'data-modify'];
// eslint-disable-next-line no-empty-function
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

function loadDir(subdir) {
  const dir = join(samplesDir, subdir);
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ filename: `${subdir}/${f}`, pkg: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}

const themes = loadDir('themes');
const features = loadDir('features');
const apps = loadDir('apps');
const allSamples = [...themes, ...features, ...apps];

test('there are exactly three samples per layer', () => {
  assert.is(themes.length, 3);
  assert.is(features.length, 3);
  assert.is(apps.length, 3);
});

test('every sample passes the real PluginValidator', () => {
  allSamples.forEach(({ filename, pkg }) => {
    const result = PluginValidator.validate({
      id: pkg.id,
      manifest: pkg.manifest,
      css: pkg.css,
      js: pkg.js
    });
    assert.ok(result.valid, `${filename}: ${(result.errors || []).join('; ')}`);
  });
});

test('every sample declares a well-formed manifest and matching ids', () => {
  allSamples.forEach(({ filename, pkg }) => {
    assert.ok(pkg.id && /^[a-z0-9-]+$/.test(pkg.id), `${filename}: top-level id`);
    assert.is(pkg.manifest.id, pkg.id, `${filename}: manifest.id must equal top-level id`);
    assert.ok(pkg.manifest.name, `${filename}: manifest.name`);
    assert.ok(/^\d+\.\d+\.\d+$/.test(pkg.manifest.version), `${filename}: semver version`);
    assert.ok(pkg.manifest.author, `${filename}: manifest.author`);
    assert.ok(VALID_LAYERS.includes(pkg.manifest.layer), `${filename}: valid layer`);
    assert.ok(Array.isArray(pkg.manifest.permissions), `${filename}: permissions array`);
    pkg.manifest.permissions.forEach(p => {
      assert.ok(KNOWN_PERMISSIONS.includes(p), `${filename}: unknown permission '${p}'`);
    });
  });
});

test('samples live in the directory matching their layer', () => {
  themes.forEach(({ filename, pkg }) => assert.is(pkg.manifest.layer, 'theme', filename));
  features.forEach(({ filename, pkg }) => assert.is(pkg.manifest.layer, 'feature', filename));
  apps.forEach(({ filename, pkg }) => assert.is(pkg.manifest.layer, 'app', filename));
});

test('all sample ids are unique', () => {
  const ids = allSamples.map(s => s.pkg.id);
  assert.is(new Set(ids).size, ids.length, 'duplicate ids: ' + ids.join(', '));
});

test('theme samples are CSS-only', () => {
  themes.forEach(({ filename, pkg }) => {
    assert.ok(pkg.css && pkg.css.trim().length > 0, `${filename}: theme needs CSS`);
    assert.ok(!pkg.js || pkg.js.trim() === '', `${filename}: theme must not have JS`);
  });
});

test('feature and app samples have compilable setup code', () => {
  [...features, ...apps].forEach(({ filename, pkg }) => {
    assert.ok(pkg.js && pkg.js.trim().length > 0, `${filename}: needs js`);
    // Must compile as a setup body receiving ctx — same compilation the
    // worker sandbox performs (see plugin-worker-bootstrap.js's `compile`
    // and plugin-api.js's `_checkSyntax`). Compiled as an AsyncFunction,
    // not a plain Function, since sample js now uses top-level `await`
    // against the now-async ctx.api.
    assert.not.throws(() => new AsyncFunction('ctx', '"use strict";\n' + pkg.js), `${filename}: js must compile`);
    if (pkg.teardownJs) {
      assert.not.throws(() => new AsyncFunction('ctx', '"use strict";\n' + pkg.teardownJs), `${filename}: teardownJs must compile`);
    }
  });
});

test('samples never reference document/window (unreachable inside the sandbox)', () => {
  [...features, ...apps].forEach(({ filename, pkg }) => {
    assert.not.ok(/\bdocument\./.test(pkg.js), `${filename}: js references document, which does not exist in the plugin's worker`);
    assert.not.ok(/\bwindow\./.test(pkg.js), `${filename}: js references window, which does not exist in the plugin's worker`);
    if (pkg.teardownJs) {
      assert.not.ok(/\bdocument\./.test(pkg.teardownJs), `${filename}: teardownJs references document`);
      assert.not.ok(/\bwindow\./.test(pkg.teardownJs), `${filename}: teardownJs references window`);
    }
  });
});

test('sample js is a setup body, not a self-registering script', () => {
  [...features, ...apps].forEach(({ filename, pkg }) => {
    assert.not.ok(
      pkg.js.includes('registerPlugin(') || pkg.js.includes('Plugin.register('),
      `${filename}: js must not self-register — install() already registers the package`
    );
    assert.ok(pkg.js.includes('ctx.'), `${filename}: setup body should use the ctx API`);
  });
});

test('permissions used by sample code are declared in the manifest', () => {
  const needs = [
    { pattern: /ctx\.api\.ui\.(inject|replace|registerComponent)/, permission: 'ui-override' },
    { pattern: /ctx\.api\.data\.(createCard|updateCard|deleteCard|addTag|removeTag|setTags)/, permission: 'data-modify' },
    { pattern: /ctx\.api\.storage\./, permission: 'storage' },
    { pattern: /ctx\.api\.network\./, permission: 'network' },
    { pattern: /ctx\.api\.filesystem\./, permission: 'filesystem' },
    // Host-enforced hook gates (plugin-api.js createWorkerMiddlewareHandlers)
    { pattern: /operations:\s*\[[^\]]*['"]card\.render['"]/, permission: 'ui-override' },
    { pattern: /operations:\s*\[[^\]]*['"](card\.create|card\.update|card\.delete|\*)['"]/, permission: 'data-modify' },
    { pattern: /ctx\.utils\.(createCard|updateCard|addTag|removeTag|setTags)\b/, permission: 'data-modify' },
    { pattern: /ctx\.utils\.(setTheme|setTypography|setHighContrast)\b/, permission: 'ui-override' }
  ];
  [...features, ...apps].forEach(({ filename, pkg }) => {
    needs.forEach(({ pattern, permission }) => {
      if (pattern.test(pkg.js)) {
        assert.ok(
          pkg.manifest.permissions.includes(permission),
          `${filename}: uses ${permission}-gated API but does not declare '${permission}'`
        );
      }
    });
  });
});

test('app samples with overrides only use implemented override keys', () => {
  const IMPLEMENTED_OVERRIDES = ['appName'];
  apps.forEach(({ filename, pkg }) => {
    const overrides = pkg.manifest.overrides || pkg.overrides || {};
    Object.keys(overrides).forEach(key => {
      assert.ok(
        IMPLEMENTED_OVERRIDES.includes(key),
        `${filename}: override '${key}' is not implemented by the runtime`
      );
    });
  });
});

test('gallery manifest.json lists every sample exactly once with correct urls', () => {
  const gallery = JSON.parse(readFileSync(join(samplesDir, 'manifest.json'), 'utf8'));
  assert.ok(Array.isArray(gallery.plugins), 'manifest.plugins array');
  assert.is(gallery.plugins.length, allSamples.length, 'gallery lists all samples');

  const sampleIds = new Set(allSamples.map(s => s.pkg.id));
  gallery.plugins.forEach(entry => {
    assert.ok(sampleIds.has(entry.id), `gallery id '${entry.id}' matches a sample package`);
    assert.ok(entry.name && entry.description, `gallery entry ${entry.id} has name/description`);
    assert.ok(entry.url && entry.url.endsWith('.json'), `gallery entry ${entry.id} has a package url`);
    // The url path must point at a file that actually exists in this repo
    const rel = entry.url.split('/sample-plugins/')[1];
    assert.ok(rel && existsSync(join(samplesDir, rel)), `gallery url for ${entry.id} points at ${rel}`);
  });
});

test('TEMPLATE.json follows the package conventions it teaches', () => {
  const pkg = JSON.parse(readFileSync(join(samplesDir, 'TEMPLATE.json'), 'utf8'));
  assert.is(pkg.manifest.id, pkg.id);
  assert.ok(VALID_LAYERS.includes(pkg.manifest.layer));
  assert.not.ok(pkg.js.includes('registerPlugin('), 'template js must not self-register');
  assert.not.throws(() => new AsyncFunction('ctx', '"use strict";\n' + pkg.js), 'template js compiles');
  const result = PluginValidator.validate({ id: pkg.id, manifest: pkg.manifest, css: pkg.css, js: pkg.js });
  assert.ok(result.valid, (result.errors || []).join('; '));
});

test.run();
