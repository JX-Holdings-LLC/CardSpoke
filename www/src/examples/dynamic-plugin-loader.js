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


// Remote Plugin Package Loader (example)
//
// Fetches plugin *packages* (plain JSON: { id, manifest, css?, js?,
// teardownJs? }) and installs them with CardSpoke.Plugin.install(). Package
// `js`/`teardownJs` are source strings, so the plugin runs inside its own
// sandboxed Worker and is gated by user-granted permissions.
//
// This example deliberately does NOT import() plugin code as ES modules:
// module code (and any setup/teardown functions it exports) would run
// unsandboxed on the main thread with full access to the app. install()
// drops function-form setup/teardown for the same reason; trusted,
// session-only host code has to opt in explicitly via
// CardSpoke.registerPlugin(). See docs/architecture/PLUGIN_INVARIANTS.md.
//
// This module is not part of the app bundle and attaches nothing to
// window.CardSpoke (which is frozen); import its functions directly.

function getPluginRuntime() {
  if (typeof window === 'undefined' || !window.CardSpoke || !window.CardSpoke.Plugin) {
    throw new Error('Plugin system not available');
  }
  return window.CardSpoke.Plugin;
}

/**
 * Fetch a plugin package JSON from a URL.
 * @param {string} url - URL of a plugin package (.json)
 * @returns {Promise<Object>} The parsed package
 */
export async function loadPluginPackageFromURL(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch plugin package ' + url + ': HTTP ' + response.status);
  }
  const pkg = await response.json();
  if (!pkg || typeof pkg !== 'object' || !pkg.manifest) {
    throw new Error('Not a plugin package (missing manifest): ' + url);
  }
  return pkg;
}

/**
 * Install a plugin package. Only data crosses into the runtime: manifest,
 * css and js/teardownJs source strings. Any function-valued fields are
 * stripped here as well as by install() itself.
 * @param {Object} pkg - Plugin package
 * @returns {Promise<string>} The installed plugin id
 */
export async function installPluginPackage(pkg) {
  const Plugin = getPluginRuntime();
  const clean = {
    id: pkg.id,
    manifest: pkg.manifest,
    css: typeof pkg.css === 'string' ? pkg.css : undefined,
    js: typeof pkg.js === 'string' ? pkg.js : undefined,
    teardownJs: typeof pkg.teardownJs === 'string' ? pkg.teardownJs : undefined,
    config: pkg.config,
    overrides: pkg.overrides
  };
  const id = await Plugin.install(clean);
  console.log('[PluginLoader] Installed:', id);
  return id;
}

/**
 * Load and install every package listed in a gallery manifest, e.g.
 * sample-plugins/manifest.json:
 * { "plugins": [ { "id": "my-plugin", "url": "https://.../my-plugin.json" } ] }
 * @param {string} manifestUrl - URL of the gallery manifest
 * @returns {Promise<Array<{id: string, success: boolean, error?: string}>>}
 */
export async function loadPluginsFromManifest(manifestUrl) {
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error('Failed to fetch plugin manifest ' + manifestUrl + ': HTTP ' + response.status);
  }
  const manifest = await response.json();

  const results = [];
  for (const entry of (manifest && manifest.plugins) || []) {
    try {
      const pkg = await loadPluginPackageFromURL(entry.url);
      const id = await installPluginPackage(pkg);
      results.push({ id: id, success: true });
    } catch (err) {
      console.error('[PluginLoader] Failed to load plugin:', entry.id, err);
      results.push({ id: entry.id, success: false, error: err.message });
    }
  }
  return results;
}
