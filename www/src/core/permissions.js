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


// Permissions System
// Manages plugin permissions and user consent
// Provides security layer for plugin capabilities
//
// Grants are bound to a plugin *fingerprint* (see computeFingerprint), not
// only to its id. A plugin id is chosen by the package author, so a
// different package reusing an id (for example one arriving in an imported
// dataset) must never silently inherit an earlier package's consent. Any
// change to the plugin's code or requested permissions changes the
// fingerprint and requires fresh consent.
//
// Storage layout (both keys hold JSON objects keyed by plugin id):
//   cardspoke_plugin_permissions         { [id]: string[] }  (format unchanged)
//   cardspoke_plugin_permission_bindings { [id]: fingerprint }
// A persisted grant with no binding predates fingerprinting ("legacy"): it
// stays readable but never satisfies a fingerprinted check, so the user is
// asked once more and the fresh grant is saved bound to the current code.

const STORAGE_KEY = 'cardspoke_plugin_permissions';
const BINDINGS_KEY = 'cardspoke_plugin_permission_bindings';
// pluginId -> { perms: Set<string>, fingerprint: string|null, legacy: boolean }
//   fingerprint null, legacy false: granted programmatically this session
//     without a fingerprint (host code / tests); bound on first enable.
//   legacy true: loaded from storage without a binding.
const grantedPermissions = new Map();

  /**
   * Stable, synchronous change-detection hash (FNV-1a, 32-bit) over what
   * consent covers: the plugin's setup/teardown source and its sorted
   * requested permissions. Not a cryptographic commitment — it only has to
   * notice that a same-id plugin's code or permissions changed.
   *
   * @param {{manifest?: {permissions?: string[]}, js?: string|null, teardownJs?: string|null}} definition
   * @returns {string} e.g. "fnv1a-1a2b3c4d-2s"
   */
  function computeFingerprint(definition) {
    const def = definition || {};
    const manifest = def.manifest || {};
    const perms = Array.isArray(manifest.permissions)
      ? manifest.permissions.map(String).slice().sort()
      : [];
    const js = typeof def.js === 'string' ? def.js : '';
    const teardownJs = typeof def.teardownJs === 'string' ? def.teardownJs : '';
    // Length-prefix each field so content can't be shifted between fields.
    const input = 'js:' + js.length + ':' + js +
      '|teardown:' + teardownJs.length + ':' + teardownJs +
      '|perms:' + JSON.stringify(perms);
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return 'fnv1a-' + hash.toString(16).padStart(8, '0') + '-' + input.length.toString(36);
  }

  // Load saved permissions from localStorage.
  function loadPermissions() {
    if (typeof localStorage === 'undefined') return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        let bindings = {};
        try {
          bindings = JSON.parse(localStorage.getItem(BINDINGS_KEY) || '{}') || {};
        } catch (_bindErr) {
          bindings = {};
        }
        Object.keys(parsed).forEach(pluginId => {
          if (!Array.isArray(parsed[pluginId])) return;
          const fp = typeof bindings[pluginId] === 'string' ? bindings[pluginId] : null;
          grantedPermissions.set(pluginId, {
            perms: new Set(parsed[pluginId]),
            fingerprint: fp,
            legacy: !fp
          });
        });
      }
    } catch (err) {
      console.error('[Permissions] Failed to load saved permissions:', err);
    }
  }

  // Save permissions to localStorage
  function savePermissions() {
    try {
      if (typeof localStorage === 'undefined') return;
      const data = {};
      const bindings = {};
      grantedPermissions.forEach((entry, pluginId) => {
        data[pluginId] = Array.from(entry.perms);
        if (entry.fingerprint) bindings[pluginId] = entry.fingerprint;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.setItem(BINDINGS_KEY, JSON.stringify(bindings));
    } catch (err) {
      console.error('[Permissions] Failed to save permissions:', err);
    }
  }

  /**
   * May this stored grant be used for a plugin whose current fingerprint is
   * `fingerprint`? An omitted fingerprint (undefined/null) means the caller
   * is not asking about a specific plugin build, so any entry counts.
   */
  function entryMatches(entry, fingerprint) {
    if (!entry) return false;
    if (fingerprint === undefined || fingerprint === null) return true;
    if (entry.legacy) return false;
    return entry.fingerprint === null || entry.fingerprint === fingerprint;
  }

  const PERMISSION_DESCRIPTIONS = {
    'plugin-code': 'Run JavaScript from this author. Workers isolate the interface but are not a complete security sandbox. Plugins can read unlocked cards and may load code over the network. Only allow code you trust.',
    'ui-override': 'Modify the user interface and inject custom elements',
    'storage': 'Access and modify local storage',
    'network': 'Make network requests to external services',
    'filesystem': 'Access the file system (mobile platforms)',
    'core-override': 'Override core application functions (high risk)',
    'data-modify': 'Create, update, and delete cards'
  };

  const PermissionsManager = {
    /**
     * Check if a plugin has a specific permission
     */
    hasPermission: function(pluginId, permission, fingerprint) {
      const entry = grantedPermissions.get(pluginId);
      return !!(entry && entryMatches(entry, fingerprint) && entry.perms.has(permission));
    },

    /**
     * Check if a plugin has all required permissions. When `fingerprint` is
     * given, the grant must also be bound to that exact plugin build (or be
     * an unbound grant made programmatically this session).
     */
    hasAllPermissions: function(pluginId, permissions, fingerprint) {
      if (!permissions || permissions.length === 0) {
        return true;
      }
      const entry = grantedPermissions.get(pluginId);
      if (!entry || !entryMatches(entry, fingerprint)) {
        return false;
      }
      return permissions.every(p => entry.perms.has(p));
    },

    /**
     * Grant permissions to a plugin. Passing a `fingerprint` binds the grant
     * to that plugin build; if the existing grant was for a different build
     * (or is a legacy, unbound grant) its old permissions are discarded
     * rather than merged, so stale consent never widens a new build.
     */
    grantPermissions: function(pluginId, permissions, fingerprint) {
      if (!permissions || permissions.length === 0) {
        return;
      }

      let entry = grantedPermissions.get(pluginId);
      const hasFp = typeof fingerprint === 'string' && fingerprint.length > 0;
      if (entry && hasFp && (entry.legacy || (entry.fingerprint && entry.fingerprint !== fingerprint))) {
        entry = null;
      }
      if (!entry) {
        entry = { perms: new Set(), fingerprint: null, legacy: false };
        grantedPermissions.set(pluginId, entry);
      }
      if (hasFp) entry.fingerprint = fingerprint;
      entry.legacy = false;

      permissions.forEach(p => entry.perms.add(p));
      savePermissions();

      console.log('[Permissions] Granted to', pluginId, ':', permissions);
    },

    /**
     * Revoke permissions from a plugin
     */
    revokePermissions: function(pluginId, permissions) {
      const entry = grantedPermissions.get(pluginId);
      if (!entry) {
        return;
      }

      if (!permissions) {
        grantedPermissions.delete(pluginId);
      } else {
        permissions.forEach(p => entry.perms.delete(p));
        if (entry.perms.size === 0) {
          grantedPermissions.delete(pluginId);
        }
      }

      savePermissions();
      console.log('[Permissions] Revoked from', pluginId, ':', permissions || 'all');
    },

    /**
     * Get all permissions for a plugin
     */
    getPermissions: function(pluginId) {
      const entry = grantedPermissions.get(pluginId);
      return entry ? Array.from(entry.perms) : [];
    },

    /** The fingerprint a plugin's grant is bound to, or null (unbound/legacy/none). */
    getFingerprint: function(pluginId) {
      const entry = grantedPermissions.get(pluginId);
      return entry ? entry.fingerprint : null;
    },

    /** See computeFingerprint() above. */
    computeFingerprint: computeFingerprint,

    /**
     * Request permissions with user consent. `fingerprint` (optional) is the
     * current plugin build's computeFingerprint(); a grant bound to another
     * build, or a legacy grant with no binding, does not count and the user
     * is asked again.
     */
    requestPermissions: async function(pluginId, pluginName, permissions, fingerprint) {
      if (!permissions || permissions.length === 0) {
        return true;
      }

      const hasFp = typeof fingerprint === 'string' && fingerprint.length > 0;

      // Check if already granted (for this exact build when fingerprinted).
      if (this.hasAllPermissions(pluginId, permissions, hasFp ? fingerprint : undefined)) {
        const entry = grantedPermissions.get(pluginId);
        if (hasFp && entry && !entry.fingerprint) {
          // Unbound in-session grant: bind it to the build it was used for.
          entry.fingerprint = fingerprint;
          savePermissions();
        }
        return true;
      }

      const existing = grantedPermissions.get(pluginId);
      const hadGrant = !!(hasFp && existing && existing.perms.size > 0);
      const changed = hadGrant && !existing.legacy &&
        !!existing.fingerprint && existing.fingerprint !== fingerprint;
      const reconfirm = hadGrant && existing.legacy;

      // Show consent dialog
      const granted = await this._showConsentDialog(pluginId, pluginName, permissions,
        { changed: changed, reconfirm: reconfirm });
      if (granted) {
        this.grantPermissions(pluginId, permissions, hasFp ? fingerprint : undefined);
      }

      return granted;
    },

    /**
     * Show permission consent dialog. Plugin JavaScript now runs inside a
     * dedicated Worker sandbox with no DOM/window/storage/network access of
     * its own (CS-002, resolved) — granting one of these permissions is a
     * real, enforced capability grant, not a description of intent.
     */
    _showConsentDialog: async function(pluginId, pluginName, permissions, opts) {
      const changed = !!(opts && opts.changed);
      const reconfirm = !!(opts && opts.reconfirm);
      return this._showDecisionDialog({
        titleText: 'Permission Request',
        introText: '"' + pluginName + '" requests the permissions below. ' +
          (changed ? 'Its code or requested permissions changed since you last allowed it, so it needs your approval again. ' : '') +
          (reconfirm ? 'CardSpoke now ties permissions to the exact plugin code, so please confirm them once more. ' : '') +
          'Worker isolation reduces risk but does not make untrusted code safe:',
        bulletItems: permissions.map(function(perm) {
          return perm + ': ' + (PERMISSION_DESCRIPTIONS[perm] || 'Unknown permission');
        }),
        denyLabel: 'Deny',
        allowLabel: 'Allow'
      });
    },

    /**
     * Shared accessible consent dialog (CS-008): role="dialog", aria-modal,
     * labelled title, focus trap, Escape-to-deny, and focus restoration.
     */
    _showDecisionDialog: function(opts) {
      return new Promise((resolve) => {
        const previousActive = document.activeElement;

        const modal = document.createElement('div');
        modal.className = 'modal-overlay show permission-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';

        const content = document.createElement('div');
        content.setAttribute('role', 'dialog');
        content.setAttribute('aria-modal', 'true');
        const titleId = 'permission-dialog-title-' + Date.now().toString(36);
        content.setAttribute('aria-labelledby', titleId);
        content.style.cssText = 'background:var(--bg-primary,#fff);padding:2rem;border-radius:8px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.2);';

        const title = document.createElement('h2');
        title.id = titleId;
        title.textContent = opts.titleText;
        title.style.cssText = 'margin:0 0 1rem;font-size:1.5rem;color:var(--text-primary,#000);';

        const desc = document.createElement('p');
        desc.textContent = opts.introText;
        desc.style.cssText = 'margin:0 0 1rem;color:var(--text-secondary,#666);';

        const list = document.createElement('ul');
        list.style.cssText = 'margin:0 0 1.5rem;padding-left:1.5rem;';
        (opts.bulletItems || []).forEach(text => {
          const item = document.createElement('li');
          item.style.cssText = 'margin:0.5rem 0;color:var(--text-primary,#000);';
          item.textContent = text;
          list.appendChild(item);
        });

        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          document.removeEventListener('keydown', onKeyDown, true);
          if (modal.parentNode) modal.parentNode.removeChild(modal);
          if (previousActive && typeof previousActive.focus === 'function') {
            previousActive.focus();
          }
          resolve(value);
        };

        const onKeyDown = (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          } else if (e.key === 'Tab') {
            // Two-button focus trap: keep focus on the two dialog buttons in
            // BOTH directions. With only two focusable elements, every Tab /
            // Shift+Tab simply toggles to the other one, so focus can never
            // escape to a background control.
            e.preventDefault();
            const other = document.activeElement === denyBtn ? allowBtn : denyBtn;
            other.focus();
          }
        };

        const buttons = document.createElement('div');
        buttons.style.cssText = 'display:flex;gap:1rem;justify-content:flex-end;';

        const denyBtn = document.createElement('button');
        denyBtn.textContent = opts.denyLabel;
        denyBtn.className = 'btn btn-secondary';
        denyBtn.style.cssText = 'padding:0.5rem 1.5rem;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;';
        denyBtn.onclick = function() { finish(false); };

        const allowBtn = document.createElement('button');
        allowBtn.textContent = opts.allowLabel;
        allowBtn.className = 'btn btn-primary';
        allowBtn.style.cssText = 'padding:0.5rem 1.5rem;border:none;background:var(--accent,#007bff);color:#fff;border-radius:4px;cursor:pointer;';
        allowBtn.onclick = function() { finish(true); };

        buttons.appendChild(denyBtn);
        buttons.appendChild(allowBtn);

        content.appendChild(title);
        content.appendChild(desc);
        content.appendChild(list);
        content.appendChild(buttons);
        modal.appendChild(content);

        document.addEventListener('keydown', onKeyDown, true);
        document.body.appendChild(modal);
        if (typeof denyBtn.focus === 'function') {
          denyBtn.focus();
        }
      });
    },

    /**
     * Get permission description
     */
    getPermissionDescription: function(permission) {
      return PERMISSION_DESCRIPTIONS[permission] || 'Unknown permission';
    },

    /**
     * List all available permissions
     */
    listAvailablePermissions: function() {
      return Object.keys(PERMISSION_DESCRIPTIONS).map(perm => ({
        name: perm,
        description: PERMISSION_DESCRIPTIONS[perm]
      }));
    },

    /**
     * Clear all permissions (for testing)
     */
    clearAll: function() {
      grantedPermissions.clear();
      savePermissions();
    }
  };

  // Initialize
  loadPermissions();

  console.log('[Permissions] System initialized');

export { PermissionsManager as Permissions };

export function showPermissionDialog(pluginId, permissions) {
  const pluginName = pluginId; // Fallback to ID if name not available
  return PermissionsManager.requestPermissions(pluginId, pluginName, permissions);
}

export { computeFingerprint };
