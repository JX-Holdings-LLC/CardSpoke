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

/**
 * Public plugin API surface — `window.CardSpoke`.
 *
 * This module is the ONE place where the plugin runtime is attached to the
 * global scope. It must be imported before any app-layer code runs (the
 * build guarantees this: vite.config.js prepends it to the fused app-layer
 * module, and main.js imports it first), so that:
 *
 *   - the app boot sequence in systems.js can call
 *     `window.CardSpoke.Plugin.syncFromStore()` to restore installed plugins,
 *   - the Plugin Manager UI in data.js can drive the full lifecycle
 *     (install / enable / disable / unregister / listAll / assessModRisk),
 *   - middleware and component-registry hooks in data.js / storage.js /
 *     rendering.js find their extension points, and
 *   - plugin packages and dev-mode module plugins can self-register.
 *
 * The shape of this object is a STABILITY CONTRACT. Plugins and the app
 * layer both program against it. Do not remove or rename members — see
 * docs/architecture/PLUGIN_INVARIANTS.md before changing anything here.
 */

import { Middleware } from './middleware.js';
import { ComponentRegistry } from './component-registry.js';
import { PluginValidator } from './plugin-validator.js';
import { Permissions } from './permissions.js';
import { StorageDriverRegistry } from './storage-driver-registry.js';
import { Plugin, PluginSandbox } from './plugin-api.js';

/**
 * `utils` is intentionally a mutable inner object: the root surface is
 * frozen, but the host app layer (storage.js) populates utils with
 * card/tag/toast helpers once those functions exist. Plugins must treat it
 * as read-only.
 */
const utils = {};

const CardSpokeAPI = Object.freeze({
  /**
   * Register AND enable a plugin in one step (session-only: not persisted
   * across reloads — use `Plugin.install()` / the Plugin Manager UI for
   * persistent installation).
   *
   * @param {string} id - Unique plugin identifier (lowercase, hyphenated)
   * @param {Object} definition - { manifest, setup, teardown, css, js }
   * @returns {Promise<string>} The plugin id once enabled
   */
  registerPlugin: async function(id, definition) {
    // Explicit host-code path: function-form setup/teardown run unsandboxed
    // on the main thread, which Plugin.register() refuses (see #370).
    Plugin.registerHostPlugin(id, definition);
    await Plugin.enable(id);
    return id;
  },

  /**
   * Install a plugin package persistently (validates, registers, persists
   * to the active dataset, and auto-enables SAFE/LOW-risk layers).
   *
   * @param {Object} pkg - Plugin package ({ id?, manifest, css?, js?, teardownJs? })
   * @returns {Promise<string>} The installed plugin id
   */
  installPlugin: function(pkg) {
    return Plugin.install(pkg);
  },

  /**
   * Request user consent for a set of permissions on behalf of a plugin.
   *
   * @param {string} pluginId - Plugin identifier
   * @param {string} pluginName - Human-readable plugin name
   * @param {string[]} permissions - Array of permission names
   * @returns {Promise<boolean>} Whether permissions were granted
   */
  requestPermissions: function(pluginId, pluginName, permissions) {
    return Permissions.requestPermissions(pluginId, pluginName, permissions);
  },

  // ── Full runtime subsystems ────────────────────────────────────────────
  // Used by the app layer and by app-layer plugins. See
  // docs/architecture/PLUGIN_SYSTEM.md for which parts are supported plugin API.
  Plugin: Plugin,
  PluginSandbox: Object.freeze({ createFunction: PluginSandbox }),
  Middleware: Middleware,
  ComponentRegistry: ComponentRegistry,
  StorageDriverRegistry: StorageDriverRegistry,
  PluginValidator: PluginValidator,
  Permissions: Permissions,

  // Populated by the host app layer with async card/tag/toast helpers.
  utils: utils
});

if (typeof window !== 'undefined') {
  window.CardSpoke = CardSpokeAPI;
}

export { CardSpokeAPI };
