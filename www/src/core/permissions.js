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

const STORAGE_KEY = 'cardspoke_plugin_permissions';
const grantedPermissions = new Map();

  // Load saved permissions from localStorage.
  function loadPermissions() {
    if (typeof localStorage === 'undefined') return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.keys(parsed).forEach(pluginId => {
          grantedPermissions.set(pluginId, new Set(parsed[pluginId]));
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
      grantedPermissions.forEach((perms, pluginId) => {
        data[pluginId] = Array.from(perms);
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('[Permissions] Failed to save permissions:', err);
    }
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
    hasPermission: function(pluginId, permission) {
      const perms = grantedPermissions.get(pluginId);
      return perms && perms.has(permission);
    },

    /**
     * Check if a plugin has all required permissions
     */
    hasAllPermissions: function(pluginId, permissions) {
      if (!permissions || permissions.length === 0) {
        return true;
      }
      const perms = grantedPermissions.get(pluginId);
      if (!perms) {
        return false;
      }
      return permissions.every(p => perms.has(p));
    },

    /**
     * Grant permissions to a plugin
     */
    grantPermissions: function(pluginId, permissions) {
      if (!permissions || permissions.length === 0) {
        return;
      }

      let perms = grantedPermissions.get(pluginId);
      if (!perms) {
        perms = new Set();
        grantedPermissions.set(pluginId, perms);
      }

      permissions.forEach(p => perms.add(p));
      savePermissions();

      console.log('[Permissions] Granted to', pluginId, ':', permissions);
    },

    /**
     * Revoke permissions from a plugin
     */
    revokePermissions: function(pluginId, permissions) {
      const perms = grantedPermissions.get(pluginId);
      if (!perms) {
        return;
      }

      if (!permissions) {
        grantedPermissions.delete(pluginId);
      } else {
        permissions.forEach(p => perms.delete(p));
        if (perms.size === 0) {
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
      const perms = grantedPermissions.get(pluginId);
      return perms ? Array.from(perms) : [];
    },

    /**
     * Request permissions with user consent
     */
    requestPermissions: async function(pluginId, pluginName, permissions) {
      if (!permissions || permissions.length === 0) {
        return true;
      }

      // Check if already granted
      if (this.hasAllPermissions(pluginId, permissions)) {
        return true;
      }

      // Show consent dialog
      const granted = await this._showConsentDialog(pluginId, pluginName, permissions);
      if (granted) {
        this.grantPermissions(pluginId, permissions);
      }

      return granted;
    },

    /**
     * Show permission consent dialog. Plugin JavaScript now runs inside a
     * dedicated Worker sandbox with no DOM/window/storage/network access of
     * its own (CS-002, resolved) — granting one of these permissions is a
     * real, enforced capability grant, not a description of intent.
     */
    _showConsentDialog: async function(pluginId, pluginName, permissions) {
      return this._showDecisionDialog({
        titleText: 'Permission Request',
        introText: '"' + pluginName + '" requests the permissions below. ' +
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
