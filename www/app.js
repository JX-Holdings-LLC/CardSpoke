// Version: 0.21.1
(function() {
  "use strict";
  const middlewares = [];
  const middlewaresByOperation = /* @__PURE__ */ new Map();
  class MiddlewareContextImpl {
    constructor(operation, args) {
      this.operation = operation;
      this.args = args;
      this.result = void 0;
      this.error = void 0;
      this._stopped = false;
      this._prevented = false;
    }
    stopPropagation() {
      this._stopped = true;
    }
    preventDefault() {
      this._prevented = true;
    }
    get stopped() {
      return this._stopped;
    }
    get prevented() {
      return this._prevented;
    }
  }
  const MiddlewareManager = {
    /**
     * Register a new middleware
     * @param {Object} middleware - { name, priority, operations, handler }
     */
    register: function(middleware) {
      if (!middleware.name || !middleware.handler) {
        throw new Error("Middleware must have name and handler");
      }
      middleware.priority = middleware.priority || 0;
      middleware.operations = middleware.operations || ["*"];
      const existing = middlewares.findIndex((m) => m.name === middleware.name);
      if (existing !== -1) {
        middlewares[existing] = middleware;
      } else {
        middlewares.push(middleware);
      }
      middlewares.sort((a, b) => b.priority - a.priority);
      middlewaresByOperation.clear();
      const conflicts = middlewares.filter(function(m) {
        if (m.name === middleware.name) return false;
        if (m.priority !== middleware.priority) return false;
        return m.operations.some(function(op) {
          return op === "*" || middleware.operations.includes("*") || middleware.operations.includes(op);
        });
      });
      if (conflicts.length > 0) {
        console.warn('[Middleware] Conflict: "' + middleware.name + '" registered at priority ' + middleware.priority + " conflicts with: " + conflicts.map(function(m) {
          return m.name;
        }).join(", ") + ". Consider using different priority levels to ensure deterministic execution order.");
      }
      console.log("[Middleware] Registered:", middleware.name, "priority:", middleware.priority);
    },
    /**
     * Unregister a middleware by name
     */
    unregister: function(name) {
      const index = middlewares.findIndex((m) => m.name === name);
      if (index !== -1) {
        middlewares.splice(index, 1);
        middlewaresByOperation.clear();
        console.log("[Middleware] Unregistered:", name);
      }
    },
    /**
     * Get middlewares for a specific operation
     */
    _getMiddlewaresForOperation: function(operation) {
      if (middlewaresByOperation.has(operation)) {
        return middlewaresByOperation.get(operation);
      }
      const matching = middlewares.filter(
        (m) => m.operations.includes("*") || m.operations.includes(operation)
      );
      middlewaresByOperation.set(operation, matching);
      return matching;
    },
    /**
     * Run middleware pipeline for an operation
     * @param {string} operation - Operation name (e.g., 'card.save', 'card.delete')
     * @param {Array} args - Arguments for the operation
     * @returns {Promise<any>} Result of the operation
     */
    run: async function(operation, args) {
      const ctx = new MiddlewareContextImpl(operation, args);
      const matching = this._getMiddlewaresForOperation(operation);
      if (matching.length === 0) {
        return { context: ctx, prevented: false };
      }
      let index = 0;
      const next = async () => {
        if (ctx.stopped || index >= matching.length) {
          return;
        }
        const middleware = matching[index++];
        try {
          await middleware.handler(ctx, next);
        } catch (err) {
          ctx.error = err;
          console.error("[Middleware] Error in", middleware.name, "(isolated, pipeline continues):", err);
          await next();
        }
      };
      try {
        await next();
      } catch (err) {
        console.error("[Middleware] Pipeline error for", operation, ":", err);
      }
      return { context: ctx, prevented: ctx.prevented };
    },
    /**
     * List all registered middlewares
     */
    list: function() {
      return middlewares.map((m) => ({
        name: m.name,
        priority: m.priority,
        operations: m.operations
      }));
    },
    /**
     * Clear all middlewares
     */
    clear: function() {
      middlewares.length = 0;
      middlewaresByOperation.clear();
    }
  };
  console.log("[Middleware] Pipeline system initialized");
  const components = /* @__PURE__ */ new Map();
  const componentPriorities = /* @__PURE__ */ new Map();
  const ComponentRegistry = {
    /**
     * Register a component
     * @param {string} name - Component name (e.g., 'Card', 'Sidebar', 'SearchBar')
     * @param {Object} component - { render, priority? }
     * @param {number} priority - Priority (higher wins, default 0)
     */
    register: function(name, component, priority) {
      if (!name || !component) {
        throw new Error("Component name and definition are required");
      }
      priority = priority !== void 0 ? priority : component.priority || 0;
      const existing = components.get(name);
      if (existing && componentPriorities.get(name) > priority) {
        console.warn("[ComponentRegistry] Component", name, "not overridden (lower priority)");
        return false;
      }
      if (existing && componentPriorities.get(name) === priority) {
        console.warn('[ComponentRegistry] Conflict: Component "' + name + '" is already registered at priority ' + priority + ". The previous registration will be overridden. Consider using different priority levels to avoid ambiguous overrides.");
      }
      components.set(name, component);
      componentPriorities.set(name, priority);
      console.log("[ComponentRegistry] Registered:", name, "priority:", priority);
      return true;
    },
    /**
     * Unregister a component.
     * @param {string} name
     * @param {Object} [expected] - If provided, only unregister when this exact
     *   component still owns the slot. Prevents one plugin's cleanup from
     *   yanking a different plugin's live registration of the same name.
     * @returns {boolean} whether a registration was removed
     */
    unregister: function(name, expected) {
      if (!components.has(name)) return false;
      if (expected !== void 0 && components.get(name) !== expected) {
        return false;
      }
      components.delete(name);
      componentPriorities.delete(name);
      console.log("[ComponentRegistry] Unregistered:", name);
      return true;
    },
    /**
     * Get a component by name
     */
    get: function(name) {
      return components.get(name);
    },
    /**
     * Resolve a component (same as get, but for API compatibility)
     */
    resolve: function(name) {
      return this.get(name);
    },
    /**
     * Check if a component is registered
     */
    has: function(name) {
      return components.has(name);
    },
    /**
     * List all registered components
     */
    list: function() {
      const result = [];
      components.forEach((component, name) => {
        result.push({
          name,
          priority: componentPriorities.get(name)
        });
      });
      return result;
    },
    /**
     * Clear all components
     */
    clear: function() {
      components.clear();
      componentPriorities.clear();
    }
  };
  console.log("[ComponentRegistry] System initialized");
  var VALID_LAYERS = ["theme", "feature", "app"];
  var VALID_PERMISSIONS = ["ui-override", "storage", "network", "filesystem", "core-override", "data-modify"];
  var MAX_CSS_LENGTH = 1e5;
  var MAX_JS_LENGTH = 5e5;
  var PLUGIN_ID_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  var DANGEROUS_CSS_PATTERNS = [
    { pattern: /@import/gi, name: "@import (external resource loading)" },
    { pattern: /javascript:/gi, name: "javascript: protocol" },
    { pattern: /behavior:/gi, name: "behavior: (IE behavior)" },
    { pattern: /-moz-binding/gi, name: "-moz-binding (Mozilla binding)" },
    { pattern: /expression\s*\(/gi, name: "expression() (IE expressions)" }
  ];
  var DANGEROUS_JS_PATTERNS = [
    { pattern: /\beval\s*\(/g, name: "eval()" },
    { pattern: /\bnew\s+Function\s*\(\s*(?!['"]ctx['"])/g, name: "new Function()" }
  ];
  var PluginValidator = {
    /**
     * Validate a complete plugin package
     * @param {Object} plugin - Plugin object to validate
     * @returns {Object} { valid: boolean, errors: string[], warnings: string[], sanitized: Object }
     */
    validate: function(plugin) {
      var errors = [];
      var warnings = [];
      if (!plugin) {
        return { valid: false, errors: ["Plugin object is required"], warnings: [], sanitized: null };
      }
      if (!plugin.id || typeof plugin.id !== "string") {
        errors.push("Plugin must have a string id");
      } else if (!PLUGIN_ID_PATTERN.test(plugin.id)) {
        errors.push("Plugin id must use lowercase letters, numbers, and hyphens only (no leading/trailing hyphen): " + JSON.stringify(plugin.id));
      }
      var manifestResult = this.validateManifest(plugin.manifest);
      errors = errors.concat(manifestResult.errors);
      warnings = warnings.concat(manifestResult.warnings);
      if (plugin.css) {
        var cssResult = this.validateCSS(plugin.css);
        errors = errors.concat(cssResult.errors);
        warnings = warnings.concat(cssResult.warnings);
        if (cssResult.sanitized !== plugin.css) {
          plugin.css = cssResult.sanitized;
        }
      }
      if (plugin.js) {
        var jsResult = this.validateJS(plugin.js);
        errors = errors.concat(jsResult.errors);
        warnings = warnings.concat(jsResult.warnings);
      }
      return {
        valid: errors.length === 0,
        errors,
        warnings,
        sanitized: errors.length === 0 ? plugin : null
      };
    },
    /**
     * Validate plugin manifest structure
     * @param {Object} manifest - Plugin manifest
     * @returns {Object} { errors: string[], warnings: string[] }
     */
    validateManifest: function(manifest) {
      var errors = [];
      var warnings = [];
      if (!manifest || typeof manifest !== "object") {
        errors.push("Plugin manifest is required and must be an object");
        return { errors, warnings };
      }
      if (!manifest.name || typeof manifest.name !== "string") {
        errors.push("manifest.name is required and must be a string");
      } else if (manifest.name.length > 100) {
        errors.push("manifest.name must be 100 characters or less");
      }
      if (!manifest.version || typeof manifest.version !== "string") {
        errors.push("manifest.version is required and must be a string");
      } else if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
        warnings.push("manifest.version should follow semver format (e.g., 1.0.0)");
      }
      if (!manifest.layer || typeof manifest.layer !== "string") {
        errors.push("manifest.layer is required and must be a string");
      } else if (VALID_LAYERS.indexOf(manifest.layer) === -1) {
        errors.push("manifest.layer must be one of: " + VALID_LAYERS.join(", "));
      }
      if (manifest.author && typeof manifest.author !== "string") {
        warnings.push("manifest.author should be a string");
      } else if (manifest.author && manifest.author.length > 200) {
        warnings.push("manifest.author should be 200 characters or less");
      }
      if (manifest.description && typeof manifest.description !== "string") {
        warnings.push("manifest.description should be a string");
      } else if (manifest.description && manifest.description.length > 500) {
        warnings.push("manifest.description should be 500 characters or less");
      }
      if (manifest.permissions) {
        if (!Array.isArray(manifest.permissions)) {
          errors.push("manifest.permissions must be an array");
        } else {
          manifest.permissions.forEach(function(perm) {
            if (VALID_PERMISSIONS.indexOf(perm) === -1) {
              warnings.push("Unknown permission: " + perm);
            }
          });
        }
      }
      return { errors, warnings };
    },
    /**
     * Validate and sanitize CSS content
     * @param {string} css - CSS string to validate
     * @returns {Object} { errors: string[], warnings: string[], sanitized: string }
     */
    validateCSS: function(css) {
      var errors = [];
      var warnings = [];
      var sanitized = css;
      if (typeof css !== "string") {
        return { errors: ["CSS must be a string"], warnings: [], sanitized: "" };
      }
      if (css.length > MAX_CSS_LENGTH) {
        errors.push("CSS exceeds maximum size of " + MAX_CSS_LENGTH + " characters");
        return { errors, warnings, sanitized: css };
      }
      DANGEROUS_CSS_PATTERNS.forEach(function(entry) {
        if (entry.pattern.test(sanitized)) {
          warnings.push("Removed dangerous CSS pattern: " + entry.name);
          sanitized = sanitized.replace(entry.pattern, "/* removed */");
        }
        entry.pattern.lastIndex = 0;
      });
      return { errors, warnings, sanitized };
    },
    /**
     * Validate JS content for dangerous patterns
     * @param {string} js - JS string to validate
     * @returns {Object} { errors: string[], warnings: string[] }
     */
    validateJS: function(js) {
      var errors = [];
      var warnings = [];
      if (typeof js !== "string") {
        return { errors: ["JS must be a string"], warnings: [] };
      }
      if (js.length > MAX_JS_LENGTH) {
        errors.push("JS exceeds maximum size of " + MAX_JS_LENGTH + " characters");
        return { errors, warnings };
      }
      DANGEROUS_JS_PATTERNS.forEach(function(entry) {
        if (entry.pattern.test(js)) {
          errors.push("Plugin contains " + entry.name + " - not allowed");
        }
        entry.pattern.lastIndex = 0;
      });
      return { errors, warnings };
    }
  };
  console.log("[PluginValidator] Validation system initialized");
  const STORAGE_KEY = "cardspoke_plugin_permissions";
  const BINDINGS_KEY = "cardspoke_plugin_permission_bindings";
  const grantedPermissions = /* @__PURE__ */ new Map();
  function computeFingerprint(definition) {
    const def = definition || {};
    const manifest = def.manifest || {};
    const perms = Array.isArray(manifest.permissions) ? manifest.permissions.map(String).slice().sort() : [];
    const js = typeof def.js === "string" ? def.js : "";
    const teardownJs = typeof def.teardownJs === "string" ? def.teardownJs : "";
    const input = "js:" + js.length + ":" + js + "|teardown:" + teardownJs.length + ":" + teardownJs + "|perms:" + JSON.stringify(perms);
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return "fnv1a-" + hash.toString(16).padStart(8, "0") + "-" + input.length.toString(36);
  }
  function loadPermissions() {
    if (typeof localStorage === "undefined") return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        let bindings = {};
        try {
          bindings = JSON.parse(localStorage.getItem(BINDINGS_KEY) || "{}") || {};
        } catch (_bindErr) {
          bindings = {};
        }
        Object.keys(parsed).forEach((pluginId) => {
          if (!Array.isArray(parsed[pluginId])) return;
          const fp = typeof bindings[pluginId] === "string" ? bindings[pluginId] : null;
          grantedPermissions.set(pluginId, {
            perms: new Set(parsed[pluginId]),
            fingerprint: fp,
            legacy: !fp
          });
        });
      }
    } catch (err) {
      console.error("[Permissions] Failed to load saved permissions:", err);
    }
  }
  function savePermissions() {
    try {
      if (typeof localStorage === "undefined") return;
      const data = {};
      const bindings = {};
      grantedPermissions.forEach((entry, pluginId) => {
        data[pluginId] = Array.from(entry.perms);
        if (entry.fingerprint) bindings[pluginId] = entry.fingerprint;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.setItem(BINDINGS_KEY, JSON.stringify(bindings));
    } catch (err) {
      console.error("[Permissions] Failed to save permissions:", err);
    }
  }
  function entryMatches(entry, fingerprint) {
    if (!entry) return false;
    if (fingerprint === void 0 || fingerprint === null) return true;
    if (entry.legacy) return false;
    return entry.fingerprint === null || entry.fingerprint === fingerprint;
  }
  const PERMISSION_DESCRIPTIONS = {
    "plugin-code": "Run JavaScript from this author. Workers isolate the interface but are not a complete security sandbox. Plugins can read unlocked cards and may load code over the network. Only allow code you trust.",
    "ui-override": "Modify the user interface and inject custom elements",
    "storage": "Access and modify local storage",
    "network": "Make network requests to external services",
    "filesystem": "Access the file system (mobile platforms)",
    "core-override": "Override core application functions (high risk)",
    "data-modify": "Create, update, and delete cards"
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
      return permissions.every((p) => entry.perms.has(p));
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
      const hasFp = typeof fingerprint === "string" && fingerprint.length > 0;
      if (entry && hasFp && (entry.legacy || entry.fingerprint && entry.fingerprint !== fingerprint)) {
        entry = null;
      }
      if (!entry) {
        entry = { perms: /* @__PURE__ */ new Set(), fingerprint: null, legacy: false };
        grantedPermissions.set(pluginId, entry);
      }
      if (hasFp) entry.fingerprint = fingerprint;
      entry.legacy = false;
      permissions.forEach((p) => entry.perms.add(p));
      savePermissions();
      console.log("[Permissions] Granted to", pluginId, ":", permissions);
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
        permissions.forEach((p) => entry.perms.delete(p));
        if (entry.perms.size === 0) {
          grantedPermissions.delete(pluginId);
        }
      }
      savePermissions();
      console.log("[Permissions] Revoked from", pluginId, ":", permissions || "all");
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
    computeFingerprint,
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
      const hasFp = typeof fingerprint === "string" && fingerprint.length > 0;
      if (this.hasAllPermissions(pluginId, permissions, hasFp ? fingerprint : void 0)) {
        const entry = grantedPermissions.get(pluginId);
        if (hasFp && entry && !entry.fingerprint) {
          entry.fingerprint = fingerprint;
          savePermissions();
        }
        return true;
      }
      const existing = grantedPermissions.get(pluginId);
      const changed = !!(hasFp && existing && existing.perms.size > 0 && (existing.legacy || existing.fingerprint && existing.fingerprint !== fingerprint));
      const granted = await this._showConsentDialog(pluginId, pluginName, permissions, { changed });
      if (granted) {
        this.grantPermissions(pluginId, permissions, hasFp ? fingerprint : void 0);
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
      return this._showDecisionDialog({
        titleText: "Permission Request",
        introText: '"' + pluginName + '" requests the permissions below. ' + (changed ? "Its code or requested permissions changed since you last allowed it, so it needs your approval again. " : "") + "Worker isolation reduces risk but does not make untrusted code safe:",
        bulletItems: permissions.map(function(perm) {
          return perm + ": " + (PERMISSION_DESCRIPTIONS[perm] || "Unknown permission");
        }),
        denyLabel: "Deny",
        allowLabel: "Allow"
      });
    },
    /**
     * Shared accessible consent dialog (CS-008): role="dialog", aria-modal,
     * labelled title, focus trap, Escape-to-deny, and focus restoration.
     */
    _showDecisionDialog: function(opts) {
      return new Promise((resolve) => {
        const previousActive = document.activeElement;
        const modal = document.createElement("div");
        modal.className = "modal-overlay show permission-modal";
        modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
        const content = document.createElement("div");
        content.setAttribute("role", "dialog");
        content.setAttribute("aria-modal", "true");
        const titleId = "permission-dialog-title-" + Date.now().toString(36);
        content.setAttribute("aria-labelledby", titleId);
        content.style.cssText = "background:var(--bg-primary,#fff);padding:2rem;border-radius:8px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.2);";
        const title = document.createElement("h2");
        title.id = titleId;
        title.textContent = opts.titleText;
        title.style.cssText = "margin:0 0 1rem;font-size:1.5rem;color:var(--text-primary,#000);";
        const desc = document.createElement("p");
        desc.textContent = opts.introText;
        desc.style.cssText = "margin:0 0 1rem;color:var(--text-secondary,#666);";
        const list = document.createElement("ul");
        list.style.cssText = "margin:0 0 1.5rem;padding-left:1.5rem;";
        (opts.bulletItems || []).forEach((text) => {
          const item = document.createElement("li");
          item.style.cssText = "margin:0.5rem 0;color:var(--text-primary,#000);";
          item.textContent = text;
          list.appendChild(item);
        });
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          document.removeEventListener("keydown", onKeyDown, true);
          if (modal.parentNode) modal.parentNode.removeChild(modal);
          if (previousActive && typeof previousActive.focus === "function") {
            previousActive.focus();
          }
          resolve(value);
        };
        const onKeyDown = (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          } else if (e.key === "Tab") {
            e.preventDefault();
            const other = document.activeElement === denyBtn ? allowBtn : denyBtn;
            other.focus();
          }
        };
        const buttons = document.createElement("div");
        buttons.style.cssText = "display:flex;gap:1rem;justify-content:flex-end;";
        const denyBtn = document.createElement("button");
        denyBtn.textContent = opts.denyLabel;
        denyBtn.className = "btn btn-secondary";
        denyBtn.style.cssText = "padding:0.5rem 1.5rem;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;";
        denyBtn.onclick = function() {
          finish(false);
        };
        const allowBtn = document.createElement("button");
        allowBtn.textContent = opts.allowLabel;
        allowBtn.className = "btn btn-primary";
        allowBtn.style.cssText = "padding:0.5rem 1.5rem;border:none;background:var(--accent,#007bff);color:#fff;border-radius:4px;cursor:pointer;";
        allowBtn.onclick = function() {
          finish(true);
        };
        buttons.appendChild(denyBtn);
        buttons.appendChild(allowBtn);
        content.appendChild(title);
        content.appendChild(desc);
        content.appendChild(list);
        content.appendChild(buttons);
        modal.appendChild(content);
        document.addEventListener("keydown", onKeyDown, true);
        document.body.appendChild(modal);
        if (typeof denyBtn.focus === "function") {
          denyBtn.focus();
        }
      });
    },
    /**
     * Get permission description
     */
    getPermissionDescription: function(permission) {
      return PERMISSION_DESCRIPTIONS[permission] || "Unknown permission";
    },
    /**
     * List all available permissions
     */
    listAvailablePermissions: function() {
      return Object.keys(PERMISSION_DESCRIPTIONS).map((perm) => ({
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
  loadPermissions();
  console.log("[Permissions] System initialized");
  function showPermissionDialog(pluginId, permissions) {
    const pluginName = pluginId;
    return PermissionsManager.requestPermissions(pluginId, pluginName, permissions);
  }
  const drivers = /* @__PURE__ */ new Map();
  let activeDriver = null;
  const StorageDriverRegistry = {
    /**
     * Register a storage driver
     * @param {string} name - Driver name (e.g., 'indexeddb', 'cloud', 'git')
     * @param {Object} driver - Driver instance implementing StorageDriver interface
     */
    register: function(name, driver) {
      if (!name || !driver) {
        throw new Error("Driver name and instance are required");
      }
      const required = ["init", "get", "set", "remove", "list", "getSize", "getKind"];
      for (const method of required) {
        if (typeof driver[method] !== "function") {
          throw new Error("Driver missing required method: " + method);
        }
      }
      drivers.set(name, driver);
      console.log("[StorageDriverRegistry] Registered:", name);
    },
    /**
     * Unregister a storage driver
     */
    unregister: function(name) {
      if (drivers.has(name)) {
        if (activeDriver && activeDriver.getKind() === name) {
          console.warn("[StorageDriverRegistry] Cannot unregister active driver:", name);
          return false;
        }
        drivers.delete(name);
        console.log("[StorageDriverRegistry] Unregistered:", name);
        return true;
      }
      return false;
    },
    /**
     * Get a driver by name
     */
    get: function(name) {
      return drivers.get(name);
    },
    /**
     * Set the active storage driver
     */
    setActive: async function(name) {
      const driver = drivers.get(name);
      if (!driver) {
        throw new Error("Storage driver not found: " + name);
      }
      if (!driver._initialized) {
        await driver.init();
        driver._initialized = true;
      }
      activeDriver = driver;
      console.log("[StorageDriverRegistry] Active driver set to:", name);
    },
    /**
     * Get the active storage driver
     */
    getActive: function() {
      return activeDriver;
    },
    /**
     * List all registered drivers
     */
    list: function() {
      const result = [];
      drivers.forEach((driver, name) => {
        result.push({
          name,
          kind: driver.getKind(),
          active: activeDriver === driver
        });
      });
      return result;
    },
    /**
     * Clear all drivers (except active)
     */
    clear: function() {
      const activeKind = activeDriver ? activeDriver.getKind() : null;
      drivers.forEach((driver, name) => {
        if (activeKind !== name) {
          drivers.delete(name);
        }
      });
    }
  };
  console.log("[StorageDriverRegistry] System initialized");
  function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    if (value instanceof Date || value instanceof Map || value instanceof Set) return false;
    if (typeof ArrayBuffer !== "undefined" && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) return false;
    return true;
  }
  function createRpcChannel(options) {
    const postMessage = options.postMessage;
    const addListener = options.addListener;
    const onCall = options.onCall || function() {
      throw new Error("No call handler registered for this RPC channel");
    };
    let nextId = 1;
    let nextHandle = 1;
    const pending = /* @__PURE__ */ new Map();
    const callbacks = /* @__PURE__ */ new Map();
    const functionToHandle = /* @__PURE__ */ new WeakMap();
    const handleToLocalStub = /* @__PURE__ */ new Map();
    function send(msg) {
      postMessage(msg);
    }
    function serialize(value) {
      if (typeof value === "function") {
        let handle = functionToHandle.get(value);
        if (handle === void 0) {
          handle = nextHandle++;
          functionToHandle.set(value, handle);
          callbacks.set(handle, value);
        }
        return { __rpcHandle: handle };
      }
      if (Array.isArray(value)) {
        return value.map(serialize);
      }
      if (isPlainObject(value)) {
        const out = {};
        for (const key of Object.keys(value)) Object.defineProperty(out, key, { value: serialize(value[key]), enumerable: true, writable: true, configurable: true });
        return out;
      }
      return value;
    }
    function deserialize(value) {
      if (value && typeof value === "object" && typeof value.__rpcHandle === "number") {
        const handle = value.__rpcHandle;
        let stub = handleToLocalStub.get(handle);
        if (!stub) {
          stub = function remoteCallback() {
            return invoke(handle, Array.prototype.slice.call(arguments));
          };
          handleToLocalStub.set(handle, stub);
        }
        return stub;
      }
      if (Array.isArray(value)) {
        return value.map(deserialize);
      }
      if (isPlainObject(value)) {
        const out = {};
        for (const key of Object.keys(value)) Object.defineProperty(out, key, { value: deserialize(value[key]), enumerable: true, writable: true, configurable: true });
        return out;
      }
      return value;
    }
    function call(path, args, opts) {
      const id = nextId++;
      const promise = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, sentAt: Date.now() });
      });
      try {
        send({ id, kind: "call", path, args: serialize(args || []) });
      } catch (error) {
        pending.get(id).reject(error);
        pending.delete(id);
      }
      return withTimeout(id, promise, opts && opts.timeoutMs);
    }
    function invoke(handle, args, opts) {
      const id = nextId++;
      const promise = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, sentAt: Date.now() });
      });
      try {
        send({ id, kind: "invoke", handle, args: serialize(args || []) });
      } catch (error) {
        pending.get(id).reject(error);
        pending.delete(id);
      }
      return withTimeout(id, promise, opts && opts.timeoutMs);
    }
    function withTimeout(id, promise, timeoutMs) {
      if (!timeoutMs) return promise;
      let timer = null;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          const entry = pending.get(id);
          if (entry) {
            pending.delete(id);
            reject(new Error("RPC call timed out after " + timeoutMs + "ms"));
          }
        }, timeoutMs);
      });
      return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    }
    async function handleMessage(msg) {
      if (!msg || typeof msg !== "object" || typeof msg.id !== "number" || typeof msg.kind !== "string") {
        return;
      }
      switch (msg.kind) {
        case "call": {
          try {
            const result = await onCall(msg.path, deserialize(msg.args));
            send({ id: msg.id, kind: "result", value: serialize(result) });
          } catch (err) {
            send({ id: msg.id, kind: "error", message: describeError(err) });
          }
          break;
        }
        case "invoke": {
          try {
            const fn = callbacks.get(msg.handle);
            if (!fn) throw new Error("Unknown callback handle: " + msg.handle);
            const result = await fn.apply(null, deserialize(msg.args));
            send({ id: msg.id, kind: "invoke-result", value: serialize(result) });
          } catch (err) {
            send({ id: msg.id, kind: "invoke-error", message: describeError(err) });
          }
          break;
        }
        case "result":
        case "invoke-result": {
          const entry = pending.get(msg.id);
          if (entry) {
            pending.delete(msg.id);
            entry.resolve(deserialize(msg.value));
          }
          break;
        }
        case "error":
        case "invoke-error": {
          const entry = pending.get(msg.id);
          if (entry) {
            pending.delete(msg.id);
            entry.reject(new Error(msg.message || "RPC call failed"));
          }
          break;
        }
        default:
          break;
      }
    }
    function describeError(err) {
      if (err && typeof err.message === "string") return err.message;
      return String(err);
    }
    addListener(handleMessage);
    return {
      call,
      invoke,
      releaseCallback(handle) {
        callbacks.delete(handle);
      },
      /** Reject every in-flight request (used when a worker is being terminated). */
      rejectAll(err) {
        pending.forEach((entry) => entry.reject(err));
        pending.clear();
      },
      /** Age in ms of the oldest still-pending request, or 0 if none. Used for hang detection. */
      oldestPendingAgeMs() {
        let oldest = 0;
        const now = Date.now();
        pending.forEach((entry) => {
          const age = now - entry.sentAt;
          if (age > oldest) oldest = age;
        });
        return oldest;
      },
      pendingCount() {
        return pending.size;
      }
    };
  }
  function dispatch(handlers, path, args) {
    if (!Array.isArray(path) || path.length === 0 || path.some((key) => typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) || args !== void 0 && !Array.isArray(args)) {
      throw new Error("Invalid RPC path");
    }
    let target = handlers;
    for (let i = 0; i < path.length - 1; i++) {
      target = target && typeof target === "object" && Object.hasOwn(target, path[i]) ? target[path[i]] : void 0;
      if (!target) throw new Error("Unknown RPC path: " + path.join("."));
    }
    const method = target && typeof target === "object" && Object.hasOwn(target, path[path.length - 1]) ? target[path[path.length - 1]] : void 0;
    if (typeof method !== "function") {
      throw new Error("Unknown RPC method: " + path.join("."));
    }
    return method.apply(target, args || []);
  }
  const WORKER_SCRIPT_URL = "./plugin-worker-bootstrap.js";
  const READY_TIMEOUT_MS = 5e3;
  async function createPluginWorker(pluginId, initPayload, onCall) {
    const worker = new Worker(WORKER_SCRIPT_URL, { type: "module" });
    let terminated = false;
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const readyTimer = setTimeout(() => readyReject(new Error('Plugin worker for "' + pluginId + '" failed to start')), READY_TIMEOUT_MS);
    const channel = createRpcChannel({
      postMessage: (msg) => {
        if (terminated) throw new Error("Plugin worker was terminated");
        worker.postMessage(msg);
      },
      addListener: (handler) => {
        worker.addEventListener("message", (evt) => {
          const data = evt.data;
          if (data && data.kind === "ready") {
            clearTimeout(readyTimer);
            readyResolve();
            return;
          }
          handler(data);
        });
      },
      onCall
    });
    let onError = () => {
    };
    worker.addEventListener("error", (evt) => {
      readyReject(new Error("Plugin worker failed to start: " + (evt.message || "unknown error")));
      channel.rejectAll(new Error("Plugin worker error: " + (evt.message || "unknown error")));
      onError(evt);
    });
    worker.addEventListener("messageerror", () => {
      channel.rejectAll(new Error("Plugin worker sent an unclonable message"));
    });
    try {
      await ready;
      await channel.call(["lifecycle", "init"], [Object.assign({ id: pluginId }, initPayload)], { timeoutMs: READY_TIMEOUT_MS });
    } catch (error) {
      terminate();
      throw error;
    }
    function terminate() {
      if (terminated) return;
      terminated = true;
      clearTimeout(readyTimer);
      channel.rejectAll(new Error('Plugin "' + pluginId + '" worker was terminated'));
      worker.terminate();
    }
    return {
      channel,
      terminate,
      onError: (fn) => {
        onError = fn;
      },
      /**
       * Race a call against a deadline; on timeout, forcibly terminate the
       * worker (a capability main-thread plugin execution never had — a hung
       * `while(true){}` in a worker can be killed outright instead of freezing
       * the whole app).
       */
      async callWithDeadline(path, args, timeoutMs) {
        let timer = null;
        const timeout = new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Plugin "' + pluginId + '" timed out after ' + timeoutMs + "ms")), timeoutMs);
        });
        try {
          return await Promise.race([channel.call(path, args), timeout]);
        } catch (error) {
          terminate();
          throw error;
        } finally {
          clearTimeout(timer);
        }
      },
      isHung(hangThresholdMs) {
        return terminated || channel.oldestPendingAgeMs() > hangThresholdMs;
      }
    };
  }
  const EVENT_PROP_PATTERN = /^on([a-z]+)$/i;
  const SAFE_TAGS = new Set("a abbr b blockquote br button caption code col colgroup dd del details div dl dt em fieldset figcaption figure h1 h2 h3 h4 h5 h6 hr i img input kbd label legend li mark ol optgroup option p pre progress s samp section select small span strong sub summary sup table tbody td textarea th thead time tr u ul".split(" "));
  const SAFE_ATTRIBUTES = new Set("id title role tabindex type name placeholder value checked disabled readonly multiple selected min max step rows cols maxlength minlength for colspan rowspan scope open hidden alt width height href src target rel download loading autocomplete".split(" "));
  const elementListeners = /* @__PURE__ */ new WeakMap();
  function validateTag(tag) {
    if (typeof tag !== "string" || !SAFE_TAGS.has(tag.toLowerCase())) throw new Error("Unsupported plugin element: " + tag);
  }
  function validateUrl(key, value) {
    const text = String(value).trim();
    if (/^[\u0000-\u0020]*[a-z][a-z0-9+.-]*:/i.test(text)) {
      const scheme = text.slice(0, text.indexOf(":")).toLowerCase();
      if (key === "href" && ["https", "http", "mailto"].includes(scheme)) return;
      if (key === "src" && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(text)) return;
      throw new Error("Unsupported plugin URL");
    }
    if (/[\u0000-\u0020]/.test(text) || text.startsWith("//") || text.includes(":")) throw new Error("Unsupported plugin URL");
  }
  function h$1(tag, props, children) {
    if (typeof tag !== "string" || !tag) {
      throw new Error("ctx.h: tag must be a non-empty string");
    }
    return {
      __vnode: true,
      tag,
      props: props || {},
      children: normalizeChildren(children)
    };
  }
  function normalizeChildren(children) {
    if (children == null) return [];
    const flat = Array.isArray(children) ? children : [children];
    return flat.filter((c) => c !== null && c !== void 0 && c !== false);
  }
  function isVnode(value) {
    return !!(value && typeof value === "object" && value.__vnode);
  }
  function applyProps(el, props) {
    Object.keys(props || {}).forEach((key) => {
      const value = props[key];
      if (value === null || value === void 0) return;
      if (key === "style") {
        if (typeof value === "string") {
          el.style.cssText = value;
        } else if (typeof value === "object") {
          Object.keys(value).forEach((prop) => {
            el.style[prop] = value[prop];
          });
        }
        return;
      }
      if (key === "dataset") {
        Object.keys(value).forEach((dk) => {
          el.dataset[dk] = value[dk];
        });
        return;
      }
      if (key === "className" || key === "class") {
        el.className = value;
        return;
      }
      const eventMatch = key.match(EVENT_PROP_PATTERN);
      if (eventMatch) {
        if (typeof value !== "function") throw new Error("Plugin event handlers must be callbacks");
        const eventType = eventMatch[1].toLowerCase();
        const listener = makeDomListener(value);
        el.addEventListener(eventType, listener);
        const listeners = elementListeners.get(el) || [];
        listeners.push([eventType, listener]);
        elementListeners.set(el, listeners);
        return;
      }
      const attribute = key.toLowerCase();
      if (!SAFE_ATTRIBUTES.has(attribute) && !/^(aria|data)-[a-z0-9_-]+$/.test(attribute)) throw new Error("Unsupported plugin attribute: " + key);
      if (attribute === "href" || attribute === "src") validateUrl(attribute, value);
      if (typeof value === "boolean") {
        if (value) el.setAttribute(key, "");
        else el.removeAttribute(key);
        if (key in el) {
          try {
            el[key] = value;
          } catch (_e) {
          }
        }
      } else {
        el.setAttribute(key, String(value));
        if (key === "value" && "value" in el) el.value = value;
      }
    });
  }
  function makeDomListener(remoteHandler) {
    return function domListener(event) {
      const descriptor = {
        type: event.type,
        key: event.key,
        code: event.code,
        clientX: event.clientX,
        clientY: event.clientY,
        target: {
          value: event.target && "value" in event.target ? event.target.value : void 0,
          checked: event.target && "checked" in event.target ? event.target.checked : void 0,
          dataset: event.target && event.target.dataset ? Object.assign({}, event.target.dataset) : void 0
        }
      };
      return Promise.resolve(remoteHandler(descriptor)).then((result) => {
        if (result && result.preventDefault) event.preventDefault();
        if (result && result.stopPropagation) event.stopPropagation();
      }).catch((err) => {
        console.error("[Plugin] Event handler error:", err);
      });
    };
  }
  function vnodeToDOM(vnode) {
    if (vnode === null || vnode === void 0) return document.createTextNode("");
    if (typeof vnode === "string" || typeof vnode === "number") {
      return document.createTextNode(String(vnode));
    }
    if (!isVnode(vnode)) {
      throw new Error("Invalid vnode: expected the result of ctx.h(...)");
    }
    validateTag(vnode.tag);
    const el = document.createElement(vnode.tag);
    applyProps(el, vnode.props);
    vnode.children.forEach((child) => {
      el.appendChild(vnodeToDOM(child));
    });
    return el;
  }
  function updateElementFromVnode(el, vnode) {
    if (!isVnode(vnode)) {
      throw new Error("Invalid vnode: expected the result of ctx.h(...)");
    }
    validateTag(vnode.tag);
    (elementListeners.get(el) || []).forEach(([type, listener]) => el.removeEventListener(type, listener));
    elementListeners.delete(el);
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.indexOf("data-plugin") !== 0) el.removeAttribute(attr.name);
    });
    while (el.firstChild) el.removeChild(el.firstChild);
    applyProps(el, vnode.props);
    vnode.children.forEach((child) => {
      el.appendChild(vnodeToDOM(child));
    });
  }
  function applyPatch(rootEl, patch) {
    if (!patch || typeof patch !== "object") return;
    (patch.addClass || []).forEach((cls) => rootEl.classList.add(cls));
    (patch.removeClass || []).forEach((cls) => rootEl.classList.remove(cls));
    Object.keys(patch.setStyle || {}).forEach((selector) => {
      const target = selector === "" ? rootEl : rootEl.querySelector(selector);
      if (!target) return;
      const styles = patch.setStyle[selector];
      Object.keys(styles).forEach((prop) => {
        target.style[prop] = styles[prop];
      });
    });
    Object.keys(patch.setStyleByIndex || {}).forEach((selector) => {
      const targets = rootEl.querySelectorAll(selector);
      const stylesList = patch.setStyleByIndex[selector];
      targets.forEach((target, i) => {
        const styles = stylesList[i];
        if (!styles) return;
        Object.keys(styles).forEach((prop) => {
          target.style[prop] = styles[prop];
        });
      });
    });
    Object.keys(patch.appendChildren || {}).forEach((selector) => {
      const target = selector === "" ? rootEl : rootEl.querySelector(selector);
      if (!target) return;
      (patch.appendChildren[selector] || []).forEach((vnode) => {
        target.appendChild(vnodeToDOM(vnode));
      });
    });
    Object.keys(patch.prependChildren || {}).forEach((selector) => {
      const target = selector === "" ? rootEl : rootEl.querySelector(selector);
      if (!target) return;
      (patch.prependChildren[selector] || []).slice().reverse().forEach((vnode) => {
        target.insertBefore(vnodeToDOM(vnode), target.firstChild);
      });
    });
  }
  const plugins = /* @__PURE__ */ new Map();
  const pluginResources = /* @__PURE__ */ new Map();
  const dataUpdateListeners = /* @__PURE__ */ new Map();
  let nextDomHandleId = 1;
  const globalEventBus = /* @__PURE__ */ new Map();
  const cardRenderPluginIds = /* @__PURE__ */ new Set();
  const cardComponentPluginIds = /* @__PURE__ */ new Set();
  const cardDecorators = /* @__PURE__ */ new Map();
  function syncCardRenderMembership(pluginId) {
    const decorators = cardDecorators.get(pluginId);
    if (cardComponentPluginIds.has(pluginId) || decorators && decorators.size > 0) {
      cardRenderPluginIds.add(pluginId);
    } else {
      cardRenderPluginIds.delete(pluginId);
    }
  }
  function setCardComponentOwner(pluginId, owns) {
    if (owns) cardComponentPluginIds.add(pluginId);
    else cardComponentPluginIds.delete(pluginId);
    syncCardRenderMembership(pluginId);
  }
  function addCardDecorator(pluginId, name) {
    let names = cardDecorators.get(pluginId);
    if (!names) {
      names = /* @__PURE__ */ new Set();
      cardDecorators.set(pluginId, names);
    }
    names.add(name);
    syncCardRenderMembership(pluginId);
  }
  function removeCardDecorator(pluginId, name) {
    const names = cardDecorators.get(pluginId);
    if (names) {
      names.delete(name);
      if (names.size === 0) cardDecorators.delete(pluginId);
    }
    syncCardRenderMembership(pluginId);
  }
  function clearCardRender(pluginId) {
    cardComponentPluginIds.delete(pluginId);
    cardDecorators.delete(pluginId);
    cardRenderPluginIds.delete(pluginId);
  }
  const InternalAPI = {
    data: {},
    ui: {},
    utils: {}
  };
  function captureInternalReferences() {
    if (!InternalAPI.data.createCard && window.createCard) InternalAPI.data.createCard = window.createCard;
    if (!InternalAPI.data.updateCard && window.updateCard) InternalAPI.data.updateCard = window.updateCard;
    if (!InternalAPI.data.deleteCard && window.deleteCard) InternalAPI.data.deleteCard = window.deleteCard;
    if (!InternalAPI.utils.cloneCard && window.cloneCard) InternalAPI.utils.cloneCard = window.cloneCard;
    if (!InternalAPI.data.getTags && window.getTags) InternalAPI.data.getTags = window.getTags;
    if (!InternalAPI.data.addTag && window.addTag) InternalAPI.data.addTag = window.addTag;
    if (!InternalAPI.data.removeTag && window.removeTag) InternalAPI.data.removeTag = window.removeTag;
    if (!InternalAPI.data.setTags && window.setTags) InternalAPI.data.setTags = window.setTags;
    if (!InternalAPI.data.getAllTags && window.getAllTags) InternalAPI.data.getAllTags = window.getAllTags;
    if (!InternalAPI.ui.showToast && window.showToast) InternalAPI.ui.showToast = window.showToast;
  }
  function hasPermission(pluginId, permission) {
    if (PermissionsManager) {
      const instance = plugins.get(pluginId);
      const fingerprint = instance ? instance.fingerprint : void 0;
      return PermissionsManager.hasPermission(pluginId, permission, fingerprint);
    }
    return true;
  }
  function trackResource(pluginId, resource) {
    const resources = pluginResources.get(pluginId) || /* @__PURE__ */ new Set();
    resources.add(resource);
    return resource;
  }
  function createDataApi(pluginId) {
    return {
      onUpdate: function(callback) {
        const listeners = dataUpdateListeners.get(pluginId) || [];
        listeners.push(callback);
        dataUpdateListeners.set(pluginId, listeners);
        const resource = trackResource(pluginId, { type: "listener", callback });
        return function() {
          const idx = listeners.indexOf(callback);
          if (idx !== -1) listeners.splice(idx, 1);
          const resources = pluginResources.get(pluginId);
          if (resources) resources.delete(resource);
        };
      },
      offUpdate: function(callback) {
        const listeners = dataUpdateListeners.get(pluginId);
        if (!listeners) return;
        const idx = listeners.indexOf(callback);
        if (idx !== -1) listeners.splice(idx, 1);
      },
      getCard: function(id) {
        if (window.store && window.store.cards && window.store.cards[id]) {
          var cloneFn = InternalAPI.utils.cloneCard || window.cloneCard;
          if (cloneFn) return cloneFn(window.store.cards[id]);
          if (typeof structuredClone === "function") return structuredClone(window.store.cards[id]);
          return JSON.parse(JSON.stringify(window.store.cards[id]));
        }
        return void 0;
      },
      listCards: function() {
        if (window.store && window.store.cards) {
          var cloneFn = InternalAPI.utils.cloneCard || window.cloneCard;
          return Object.values(window.store.cards).map(function(card) {
            if (cloneFn) return cloneFn(card);
            if (typeof structuredClone === "function") return structuredClone(card);
            return JSON.parse(JSON.stringify(card));
          });
        }
        return [];
      },
      createCard: function(data) {
        if (!hasPermission(pluginId, "data-modify")) {
          throw new Error("Plugin does not have data-modify permission");
        }
        var fn = InternalAPI.data.createCard || window.createCard;
        if (fn) {
          var hasTags = Array.isArray(data.tags) && data.tags.length > 0;
          var newId = fn(data.title || "", data.body || "", data.parentId || null, false, hasTags);
          if (hasTags && newId) {
            var setTagsFn = InternalAPI.data.setTags || window.setTags;
            if (setTagsFn) {
              setTagsFn(newId, data.tags);
            }
            var createdCard = window.store && window.store.cards ? window.store.cards[newId] : void 0;
            if (window.CardSpoke && window.CardSpoke.Middleware) {
              window.CardSpoke.Middleware.run("card.create", [newId, createdCard]).catch(function(err) {
                console.error("[Middleware] card.create error:", err);
              });
            }
            PluginManager.notifyDataUpdate({ type: "card.create", cardId: newId, card: createdCard });
          }
          return newId;
        }
        throw new Error("createCard not available");
      },
      updateCard: function(id, updates) {
        if (!hasPermission(pluginId, "data-modify")) {
          throw new Error("Plugin does not have data-modify permission");
        }
        var fn = InternalAPI.data.updateCard || window.updateCard;
        if (fn) {
          fn(id, updates, false, false);
          return this.getCard(id);
        }
        throw new Error("updateCard not available");
      },
      deleteCard: function(id) {
        if (!hasPermission(pluginId, "data-modify")) {
          throw new Error("Plugin does not have data-modify permission");
        }
        var fn = InternalAPI.data.deleteCard || window.deleteCard;
        if (fn) {
          fn(id);
          return true;
        }
        return false;
      },
      getTags: function(cardId) {
        var fn = InternalAPI.data.getTags || window.getTags;
        if (fn) return fn(cardId);
        return [];
      },
      addTag: function(cardId, tag) {
        if (!hasPermission(pluginId, "data-modify")) {
          throw new Error("Plugin does not have data-modify permission");
        }
        var fn = InternalAPI.data.addTag || window.addTag;
        if (fn) return fn(cardId, tag);
        return false;
      },
      removeTag: function(cardId, tag) {
        if (!hasPermission(pluginId, "data-modify")) {
          throw new Error("Plugin does not have data-modify permission");
        }
        var fn = InternalAPI.data.removeTag || window.removeTag;
        if (fn) return fn(cardId, tag);
        return false;
      },
      setTags: function(cardId, tags) {
        if (!hasPermission(pluginId, "data-modify")) {
          throw new Error("Plugin does not have data-modify permission");
        }
        var fn = InternalAPI.data.setTags || window.setTags;
        if (fn) return fn(cardId, tags);
        return false;
      },
      getAllTags: function() {
        var fn = InternalAPI.data.getAllTags || window.getAllTags;
        if (fn) return fn();
        return [];
      }
    };
  }
  function createStorageApi(pluginId) {
    const namespace = "plugin_" + pluginId + "_";
    return {
      getNamespace: function() {
        return namespace;
      },
      get: async function(key) {
        if (!hasPermission(pluginId, "storage")) {
          throw new Error("Plugin does not have storage permission");
        }
        const fullKey = namespace + key;
        if (window.storageDriver && window.storageDriver.get) {
          return await window.storageDriver.get(fullKey);
        }
        const raw = localStorage.getItem(fullKey);
        if (raw === null) return null;
        try {
          return JSON.parse(raw);
        } catch (e) {
          return raw;
        }
      },
      set: async function(key, value) {
        if (!hasPermission(pluginId, "storage")) {
          throw new Error("Plugin does not have storage permission");
        }
        const fullKey = namespace + key;
        if (window.storageDriver && window.storageDriver.set) {
          return await window.storageDriver.set(fullKey, value);
        }
        localStorage.setItem(fullKey, JSON.stringify(value));
      },
      remove: async function(key) {
        if (!hasPermission(pluginId, "storage")) {
          throw new Error("Plugin does not have storage permission");
        }
        const fullKey = namespace + key;
        if (window.storageDriver && window.storageDriver.remove) {
          return await window.storageDriver.remove(fullKey);
        }
        localStorage.removeItem(fullKey);
      },
      list: async function(prefix) {
        if (!hasPermission(pluginId, "storage")) {
          throw new Error("Plugin does not have storage permission");
        }
        const fullPrefix = namespace + (prefix || "");
        if (window.storageDriver && window.storageDriver.list) {
          return await window.storageDriver.list(fullPrefix);
        }
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(fullPrefix)) {
            keys.push(key.substring(namespace.length));
          }
        }
        return keys;
      }
    };
  }
  function createEventApi(pluginId) {
    return {
      on: function(event, callback) {
        if (!globalEventBus.has(event)) globalEventBus.set(event, []);
        const handlers = globalEventBus.get(event);
        handlers.push({ pluginId, callback });
        const resource = trackResource(pluginId, { type: "event", event, callback });
        return function() {
          const list = globalEventBus.get(event);
          if (list) {
            const idx = list.findIndex(function(h2) {
              return h2.callback === callback && h2.pluginId === pluginId;
            });
            if (idx !== -1) list.splice(idx, 1);
          }
          const resources = pluginResources.get(pluginId);
          if (resources) resources.delete(resource);
        };
      },
      emit: function(event, args) {
        const handlers = globalEventBus.get(event);
        if (handlers) {
          const callArgs = Array.isArray(args) ? args : Array.prototype.slice.call(arguments, 1);
          handlers.slice().forEach(function(entry) {
            try {
              const result = entry.callback.apply(null, callArgs);
              if (result && typeof result.catch === "function") result.catch((err) => console.error("[EventBus] Handler error in plugin " + entry.pluginId + ":", err));
            } catch (err) {
              console.error("[EventBus] Handler error in plugin " + entry.pluginId + ":", err);
            }
          });
        }
      },
      off: function(event, callback) {
        const list = globalEventBus.get(event);
        if (list) {
          const idx = list.findIndex(function(h2) {
            return h2.callback === callback && h2.pluginId === pluginId;
          });
          if (idx !== -1) list.splice(idx, 1);
        }
      }
    };
  }
  function createFilesystemApi(pluginId) {
    return {
      readFile: async function(path, options) {
        if (!hasPermission(pluginId, "filesystem")) {
          throw new Error("Plugin does not have filesystem permission");
        }
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
          return window.Capacitor.Plugins.Filesystem.readFile(Object.assign({}, options, { path }));
        }
        throw new Error("Filesystem not available on this platform");
      },
      writeFile: async function(path, data, options) {
        if (!hasPermission(pluginId, "filesystem")) {
          throw new Error("Plugin does not have filesystem permission");
        }
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
          return window.Capacitor.Plugins.Filesystem.writeFile(Object.assign({}, options, { path, data }));
        }
        throw new Error("Filesystem not available on this platform");
      }
    };
  }
  function createLegacyUIApi(pluginId) {
    return {
      inject: function(selector, element, position) {
        if (!hasPermission(pluginId, "ui-override")) {
          throw new Error("Plugin does not have ui-override permission");
        }
        position = position || "append";
        const target = document.querySelector(selector);
        if (!target) return () => {
        };
        switch (position) {
          case "before":
            if (!target.parentNode) return () => {
            };
            target.parentNode.insertBefore(element, target);
            break;
          case "after":
            if (!target.parentNode) return () => {
            };
            target.parentNode.insertBefore(element, target.nextSibling);
            break;
          case "prepend":
            target.insertBefore(element, target.firstChild);
            break;
          default:
            target.appendChild(element);
            break;
        }
        const resource = trackResource(pluginId, { type: "dom", element });
        return function() {
          if (element.parentNode) element.parentNode.removeChild(element);
          const resources = pluginResources.get(pluginId);
          if (resources) resources.delete(resource);
        };
      },
      replace: function(selector, element) {
        if (!hasPermission(pluginId, "ui-override")) {
          throw new Error("Plugin does not have ui-override permission");
        }
        const target = document.querySelector(selector);
        if (!target || !target.parentNode) return () => {
        };
        const original = target;
        target.parentNode.replaceChild(element, target);
        const resource = trackResource(pluginId, { type: "dom", element, original });
        return function() {
          if (element.parentNode) element.parentNode.replaceChild(original, element);
          const resources = pluginResources.get(pluginId);
          if (resources) resources.delete(resource);
        };
      },
      registerComponent: function(name, component) {
        if (!hasPermission(pluginId, "ui-override")) {
          throw new Error("Plugin does not have ui-override permission");
        }
        if (ComponentRegistry) {
          const won = ComponentRegistry.register(name, component, component.priority || 0);
          if (won) {
            if (name === "Card") setCardComponentOwner(pluginId, true);
            trackResource(pluginId, { type: "component", name, component });
          }
        }
      },
      unregisterComponent: function(name) {
        if (ComponentRegistry) ComponentRegistry.unregister(name);
        if (name === "Card") setCardComponentOwner(pluginId, false);
      },
      showToast: function(message, type, duration) {
        var fn = InternalAPI.ui.showToast || window.showToast;
        if (fn) fn(message, type || "info", duration);
      }
    };
  }
  function createLegacyMiddlewareApi(pluginId) {
    return {
      register: function(middleware) {
        if (!middleware || !middleware.name || typeof middleware.handler !== "function") {
          throw new Error("Middleware must have a name and a handler function");
        }
        if (!MiddlewareManager) throw new Error("Middleware pipeline not available");
        const namespacedName = pluginId + ":" + middleware.name;
        MiddlewareManager.register({
          name: namespacedName,
          priority: middleware.priority || 0,
          operations: middleware.operations || ["*"],
          handler: middleware.handler
        });
        trackResource(pluginId, { type: "middleware", name: namespacedName });
        return function() {
          MiddlewareManager.unregister(namespacedName);
        };
      },
      unregister: function(name) {
        if (MiddlewareManager) MiddlewareManager.unregister(pluginId + ":" + name);
      }
    };
  }
  function createLegacyNetworkApi(pluginId) {
    return {
      fetch: async function(url, options) {
        if (!hasPermission(pluginId, "network")) {
          throw new Error("Plugin does not have network permission");
        }
        return window.fetch(url, options);
      },
      xhr: function() {
        if (!hasPermission(pluginId, "network")) {
          throw new Error("Plugin does not have network permission");
        }
        return new XMLHttpRequest();
      }
    };
  }
  function createLogger(pluginId) {
    const prefix = "[Plugin:" + pluginId + "]";
    return {
      log: function() {
        console.log.apply(console, [prefix].concat(Array.from(arguments)));
      },
      info: function() {
        console.info.apply(console, [prefix].concat(Array.from(arguments)));
      },
      warn: function() {
        console.warn.apply(console, [prefix].concat(Array.from(arguments)));
      },
      error: function() {
        console.error.apply(console, [prefix].concat(Array.from(arguments)));
      }
    };
  }
  function createLegacyPluginContext(pluginId) {
    return {
      modId: pluginId,
      appVersion: window.APP_VERSION || "0.21.0",
      schemaVersion: window.SCHEMA_VERSION || 4,
      api: {
        ui: createLegacyUIApi(pluginId),
        data: createDataApi(pluginId),
        storage: createStorageApi(pluginId),
        events: createEventApi(pluginId),
        middleware: createLegacyMiddlewareApi(pluginId),
        network: createLegacyNetworkApi(pluginId),
        filesystem: createFilesystemApi(pluginId)
      },
      utils: window.CardSpoke && window.CardSpoke.utils ? window.CardSpoke.utils : {},
      logger: createLogger(pluginId)
    };
  }
  function createWorkerUIHandlers(pluginId) {
    const domHandles = /* @__PURE__ */ new Map();
    const ownedComponents = /* @__PURE__ */ new Map();
    function doInject(selector, vnode, position) {
      if (!hasPermission(pluginId, "ui-override")) {
        throw new Error("Plugin does not have ui-override permission");
      }
      position = position || "append";
      const target = document.querySelector(selector);
      if (!target) return null;
      const element = vnodeToDOM(vnode);
      switch (position) {
        case "before":
          if (!target.parentNode) return null;
          target.parentNode.insertBefore(element, target);
          break;
        case "after":
          if (!target.parentNode) return null;
          target.parentNode.insertBefore(element, target.nextSibling);
          break;
        case "prepend":
          target.insertBefore(element, target.firstChild);
          break;
        default:
          target.appendChild(element);
          break;
      }
      const handleId = nextDomHandleId++;
      domHandles.set(handleId, { element });
      trackResource(pluginId, { type: "dom", element });
      return handleId;
    }
    function doReplace(selector, vnode) {
      if (!hasPermission(pluginId, "ui-override")) {
        throw new Error("Plugin does not have ui-override permission");
      }
      const target = document.querySelector(selector);
      if (!target || !target.parentNode) return null;
      const element = vnodeToDOM(vnode);
      const original = target;
      target.parentNode.replaceChild(element, target);
      const handleId = nextDomHandleId++;
      domHandles.set(handleId, { element, original });
      trackResource(pluginId, { type: "dom", element, original });
      return handleId;
    }
    return {
      inject: function(selector, vnode, position) {
        return doInject(selector, vnode, position);
      },
      replace: function(selector, vnode) {
        return doReplace(selector, vnode);
      },
      removeInjected: function(handleId) {
        const entry = domHandles.get(handleId);
        if (!entry) return;
        if (entry.original && entry.element.parentNode) {
          entry.element.parentNode.replaceChild(entry.original, entry.element);
        } else if (entry.element.parentNode) {
          entry.element.parentNode.removeChild(entry.element);
        }
        domHandles.delete(handleId);
      },
      updateInjected: function(handleId, vnode) {
        const entry = domHandles.get(handleId);
        if (!entry) return;
        updateElementFromVnode(entry.element, vnode);
      },
      registerComponent: function(name, priority) {
        if (!hasPermission(pluginId, "ui-override")) {
          throw new Error("Plugin does not have ui-override permission");
        }
        const instance = plugins.get(pluginId);
        const component = {
          priority: priority || 0,
          render: async function(props) {
            if (!instance || !instance.workerHandle) throw new Error("Plugin worker not available");
            const vnode = await instance.workerHandle.callWithDeadline(["ui", "componentRender"], [name, props], BOOT_COMPONENT_TIMEOUT_MS);
            return vnodeToDOM(vnode);
          }
        };
        const won = ComponentRegistry.register(name, component, priority || 0);
        if (won) {
          ownedComponents.set(name, component);
          if (name === "Card") {
            if (instance) instance.cardComponent = component;
            setCardComponentOwner(pluginId, true);
          }
          trackResource(pluginId, { type: "component", name, component });
        }
        return won;
      },
      unregisterComponent: function(name) {
        const owned = ownedComponents.get(name);
        if (!owned) return;
        if (ComponentRegistry) ComponentRegistry.unregister(name, owned);
        ownedComponents.delete(name);
        if (name === "Card") setCardComponentOwner(pluginId, false);
      },
      showToast: function(message, type, duration) {
        var fn = InternalAPI.ui.showToast || window.showToast;
        if (fn) fn(message, type || "info", duration);
      }
    };
  }
  const CARD_WRITE_OPERATIONS = ["card.create", "card.update", "card.delete"];
  function createWorkerMiddlewareHandlers(pluginId) {
    return {
      register: function(name, priority, operations) {
        if (typeof name !== "string" || !name) {
          throw new Error("Middleware must have a name");
        }
        const ops = Array.isArray(operations) && operations.length ? operations.map(String) : ["*"];
        if (ops.indexOf("card.render") !== -1) {
          if (!hasPermission(pluginId, "ui-override")) {
            throw new Error("Plugin does not have ui-override permission (required for card.render middleware)");
          }
          addCardDecorator(pluginId, name);
          trackResource(pluginId, { type: "card-decorator", name });
          return true;
        }
        const hooksWrites = ops.some((op) => op === "*" || CARD_WRITE_OPERATIONS.indexOf(op) !== -1);
        if (hooksWrites && !hasPermission(pluginId, "data-modify")) {
          throw new Error("Plugin does not have data-modify permission (required for middleware on " + ops.join(", ") + ")");
        }
        const namespacedName = pluginId + ":" + name;
        const wrapper = async function(mwCtx, realNext) {
          const instance = plugins.get(pluginId);
          if (!instance || !instance.workerHandle) {
            await realNext();
            return;
          }
          const nextProxy = async function() {
            await realNext();
            return { args: mwCtx.args, prevented: mwCtx.prevented, stopped: mwCtx.stopped };
          };
          const outcome = await instance.workerHandle.callWithDeadline(
            ["middleware", "invoke"],
            [name, mwCtx.operation, mwCtx.args, nextProxy],
            MIDDLEWARE_TIMEOUT_MS
          );
          if (outcome && hasPermission(pluginId, "data-modify")) {
            if (outcome.args !== void 0) mwCtx.args = outcome.args;
            if (outcome.prevented) mwCtx.preventDefault();
            if (outcome.stopped) mwCtx.stopPropagation();
          }
        };
        MiddlewareManager.register({ name: namespacedName, priority: priority || 0, operations: ops, handler: wrapper });
        trackResource(pluginId, { type: "middleware", name: namespacedName });
        return true;
      },
      unregister: function(name) {
        removeCardDecorator(pluginId, name);
        MiddlewareManager.unregister(pluginId + ":" + name);
      }
    };
  }
  function createWorkerNetworkHandlers(pluginId) {
    return {
      fetch: async function(url, options) {
        if (!hasPermission(pluginId, "network")) {
          throw new Error("Plugin does not have network permission");
        }
        const response = await window.fetch(url, options);
        const bodyBuffer = await response.arrayBuffer();
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          headers: Array.from(response.headers.entries()),
          bodyBuffer
        };
      }
    };
  }
  const UTILS_PERMISSIONS = Object.freeze({
    // Reads
    getTags: null,
    getAllTags: null,
    getCard: null,
    searchCards: null,
    getDatasetMeta: null,
    getAccessibilitySettings: null,
    getTheme: null,
    getTypography: null,
    isHighContrast: null,
    prefersReducedMotion: null,
    getThemeVariables: null,
    showToast: null,
    // same as the ungated ctx.api.ui.showToast
    // Card/tag writes — same gate as ctx.api.data.*
    createCard: "data-modify",
    updateCard: "data-modify",
    addTag: "data-modify",
    removeTag: "data-modify",
    setTags: "data-modify",
    // Global UI/appearance changes
    setTheme: "ui-override",
    setTypography: "ui-override",
    setHighContrast: "ui-override"
  });
  function createUtilsHandlers(pluginId) {
    const utils2 = window.CardSpoke && window.CardSpoke.utils || {};
    const handlers = /* @__PURE__ */ Object.create(null);
    Object.keys(utils2).forEach((prop) => {
      if (typeof utils2[prop] !== "function") return;
      if (!Object.prototype.hasOwnProperty.call(UTILS_PERMISSIONS, prop)) return;
      const required = UTILS_PERMISSIONS[prop];
      handlers[prop] = async function() {
        if (required && !hasPermission(pluginId, required)) {
          throw new Error("Plugin does not have " + required + " permission (required for utils." + prop + ")");
        }
        return await utils2[prop].apply(utils2, arguments);
      };
    });
    return handlers;
  }
  function createLoggerHandlers() {
    return {
      log: function() {
        console.log.apply(console, arguments);
      },
      info: function() {
        console.info.apply(console, arguments);
      },
      warn: function() {
        console.warn.apply(console, arguments);
      },
      error: function() {
        console.error.apply(console, arguments);
      }
    };
  }
  function createHostHandlers(pluginId) {
    return {
      data: createDataApi(pluginId),
      storage: createStorageApi(pluginId),
      events: createEventApi(pluginId),
      filesystem: createFilesystemApi(pluginId),
      network: createWorkerNetworkHandlers(pluginId),
      ui: createWorkerUIHandlers(pluginId),
      middleware: createWorkerMiddlewareHandlers(pluginId),
      utils: createUtilsHandlers(pluginId),
      logger: createLoggerHandlers()
    };
  }
  const AsyncFunction = Object.getPrototypeOf(async function() {
  }).constructor;
  function _checkSyntax(code) {
    new AsyncFunction("ctx", '"use strict";\n' + code);
  }
  function _createSerializableDefinition(definition) {
    if (!definition) return null;
    return {
      manifest: definition.manifest,
      css: definition.css,
      js: typeof definition.js === "string" && definition.js || null,
      teardownJs: typeof definition.teardownJs === "string" && definition.teardownJs || null
    };
  }
  const ENABLE_TIMEOUT_MS = 5e3;
  const TEARDOWN_TIMEOUT_MS = 5e3;
  const MIDDLEWARE_TIMEOUT_MS = 5e3;
  const BOOT_COMPONENT_TIMEOUT_MS = 3e3;
  const CARD_RENDER_DEADLINE_MS = 80;
  const HANG_BACKSTOP_MS = 1e4;
  let hangWatcherTimer = null;
  function hasSourceStrings(definition) {
    return !!(typeof definition.js === "string" && definition.js || typeof definition.teardownJs === "string" && definition.teardownJs);
  }
  function hasHostFunctions(definition) {
    return typeof definition.setup === "function" || typeof definition.teardown === "function";
  }
  const PluginManager = {
    /**
     * Register a plugin definition. Definitions carrying `js`/`teardownJs`
     * source strings run sandboxed in a worker. A definition whose only code
     * is real `setup`/`teardown` FUNCTIONS would run unsandboxed on the main
     * thread, so it is rejected here — host code must opt in explicitly via
     * the host-only registerHostPlugin() (what CardSpoke.registerPlugin uses).
     */
    register: function(id, definition) {
      return this._registerInternal(id, definition, false);
    },
    _registerInternal: function(id, definition, allowHostCode) {
      if (!id || !definition) {
        throw new Error("Plugin ID and definition are required");
      }
      if (!definition.manifest) {
        throw new Error("Plugin manifest is required");
      }
      if (!allowHostCode && hasHostFunctions(definition) && !hasSourceStrings(definition)) {
        throw new Error(
          'Plugin "' + id + '" supplies setup/teardown functions, which would run unsandboxed on the main thread. Provide js/teardownJs source strings (sandboxed), or register trusted host code explicitly with CardSpoke.registerPlugin().'
        );
      }
      if (plugins.has(id)) {
        throw new Error(
          'Plugin "' + id + '" is already registered. Use install() to update an existing plugin, or unregister() it first.'
        );
      }
      if (PluginValidator) {
        var validationResult = PluginValidator.validate({
          id,
          manifest: definition.manifest,
          css: definition.css,
          js: definition.js
        });
        if (validationResult.warnings.length > 0) {
          validationResult.warnings.forEach(function(w) {
            console.warn("[Plugin] Validation warning for " + id + ":", w);
          });
        }
        if (!validationResult.valid) {
          throw new Error("Plugin validation failed: " + validationResult.errors.join("; "));
        }
      }
      const resources = /* @__PURE__ */ new Set();
      pluginResources.set(id, resources);
      const context = !definition.js && !definition.teardownJs ? createLegacyPluginContext(id) : null;
      const instance = {
        id,
        definition,
        context,
        enabled: false,
        workerHandle: null,
        resources,
        // Permission grants are bound to this (code + requested permissions)
        // fingerprint, so a same-id plugin with different code needs fresh
        // consent (see permissions.js).
        fingerprint: PermissionsManager && typeof PermissionsManager.computeFingerprint === "function" ? PermissionsManager.computeFingerprint(definition) : void 0
      };
      plugins.set(id, instance);
      console.log("[Plugin] Registered:", id);
    },
    unregister: async function(id) {
      const instance = plugins.get(id);
      if (instance) {
        if (instance.enabled) {
          await this.disable(id);
        }
        this._cleanupResources(id);
        plugins.delete(id);
        pluginResources.delete(id);
        dataUpdateListeners.delete(id);
        clearCardRender(id);
        if (PermissionsManager && PermissionsManager.revokePermissions) {
          PermissionsManager.revokePermissions(id);
        }
        try {
          const prefix = "plugin_" + id + "_";
          if (typeof localStorage !== "undefined") {
            const toRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.indexOf(prefix) === 0) toRemove.push(k);
            }
            toRemove.forEach((k) => localStorage.removeItem(k));
          }
          if (window.storageDriver && typeof window.storageDriver.list === "function" && typeof window.storageDriver.remove === "function") {
            const keys = await window.storageDriver.list(prefix);
            if (Array.isArray(keys)) {
              for (const k of keys) {
                await window.storageDriver.remove(k.indexOf(prefix) === 0 ? k : prefix + k);
              }
            }
          }
        } catch (sweepErr) {
          console.warn("[Plugin] Storage sweep failed for", id, ":", sweepErr);
        }
        if (window.store && window.store.plugins) {
          delete window.store.plugins[id];
          if (window.save) {
            window.save();
          }
        }
        console.log("[Plugin] Unregistered:", id);
      }
    },
    get: function(id) {
      return plugins.get(id);
    },
    list: function() {
      return Array.from(plugins.values());
    },
    /**
     * Runtime-only teardown for a dataset switch. Disables the plugin (running
     * its teardown + resource cleanup so no CSS/DOM/listeners leak) and drops
     * the instance from the runtime so a subsequent syncFromStore() can cleanly
     * re-register it — but deliberately does NOT touch the persisted store or
     * the user's permission grants, which are keyed to the plugin id and
     * must survive switching away from and back to a dataset.
     *
     * Unlike unregister(), this never deletes store.plugins[id] or revokes
     * consent. syncFromStore skips ids already in the runtime Map, so without
     * this teardown a plugin carried over from the previous dataset would be
     * stuck in its old enabled/definition state after a switch.
     */
    teardownForReload: async function(id) {
      const instance = plugins.get(id);
      if (!instance) return;
      if (instance.enabled) {
        await this.disable(id);
      } else {
        this._removeCSS(id);
        this._cleanupResources(id);
      }
      plugins.delete(id);
      pluginResources.delete(id);
      dataUpdateListeners.delete(id);
      clearCardRender(id);
    },
    // Restore the brand button to its pre-override content (the logo <img>).
    // Safe to call unconditionally; a no-op when the plugin never overrode it.
    _restoreBrandOverride: function(instance) {
      if (instance && instance._savedBrandHTML != null) {
        const brandBtn = document.getElementById && document.getElementById("brandBtn");
        if (brandBtn) brandBtn.innerHTML = instance._savedBrandHTML;
        instance._savedBrandHTML = null;
      }
    },
    enable: async function(id) {
      const instance = plugins.get(id);
      if (!instance) {
        throw new Error("Plugin not found: " + id);
      }
      if (instance.enabled) {
        return;
      }
      captureInternalReferences();
      if (instance.context && instance.definition.manifest.config) {
        instance.context.config = instance.definition.manifest.config;
      }
      const requiredPermissions = [...instance.definition.manifest.permissions || []];
      if (instance.definition.js || instance.definition.teardownJs) requiredPermissions.push("plugin-code");
      if (requiredPermissions.length) {
        const granted = await this._checkPermissions(id, requiredPermissions);
        if (!granted) {
          throw new Error("Permissions not granted for plugin: " + id);
        }
      }
      if (instance.definition.manifest.overrides) {
        const overrides = instance.definition.manifest.overrides;
        if (overrides.appName && typeof overrides.appName === "string") {
          const brandBtn = document.getElementById && document.getElementById("brandBtn");
          if (brandBtn) {
            if (instance._savedBrandHTML == null) instance._savedBrandHTML = brandBtn.innerHTML;
            brandBtn.textContent = overrides.appName;
          }
        }
      }
      if (instance.definition.css) {
        this._applyCSS(id, instance.definition.css);
      }
      try {
        if (instance.definition.js || instance.definition.teardownJs) {
          const hostHandlers = createHostHandlers(id);
          instance.workerHandle = await createPluginWorker(id, {
            js: instance.definition.js || "",
            teardownJs: instance.definition.teardownJs || "",
            permissions: instance.definition.manifest.permissions || [],
            config: instance.definition.manifest.config,
            appVersion: window.APP_VERSION || "0.21.0",
            schemaVersion: window.SCHEMA_VERSION || 4
          }, (path, args) => dispatch(hostHandlers, path, args));
          await instance.workerHandle.callWithDeadline(["lifecycle", "runSetup"], [], ENABLE_TIMEOUT_MS);
          this._startHangWatcher();
        } else if (instance.definition.setup) {
          await instance.definition.setup(instance.context);
        }
      } catch (err) {
        console.error("[Plugin] Setup error for", id, ":", err);
        if (window.showToast) {
          window.showToast('Plugin "' + id + '" failed to start: ' + err.message, "error");
        }
        if (instance.workerHandle) {
          instance.workerHandle.terminate();
          instance.workerHandle = null;
          this._stopHangWatcherIfIdle();
        }
        this._restoreBrandOverride(instance);
        this._removeCSS(id);
        this._cleanupResources(id);
        throw err;
      }
      instance.enabled = true;
      this._persistEnabledState(id, true);
      console.log("[Plugin] Enabled:", id);
    },
    disable: async function(id) {
      const instance = plugins.get(id);
      if (!instance) {
        throw new Error("Plugin not found: " + id);
      }
      if (!instance.enabled) {
        return;
      }
      if (instance.workerHandle) {
        try {
          await instance.workerHandle.callWithDeadline(["lifecycle", "runTeardown"], [], TEARDOWN_TIMEOUT_MS);
        } catch (err) {
          console.error("[Plugin] Teardown error for", id, ":", err);
          if (instance.context && instance.context.logger) {
            instance.context.logger.warn("Plugin cleanup had errors but continuing: " + err.message);
          }
        } finally {
          instance.workerHandle.terminate();
          instance.workerHandle = null;
          this._stopHangWatcherIfIdle();
        }
      } else if (instance.definition.teardown) {
        try {
          await instance.definition.teardown(instance.context);
        } catch (err) {
          console.error("[Plugin] Teardown error for", id, ":", err);
          if (instance.context && instance.context.logger) {
            instance.context.logger.warn("Plugin cleanup had errors but continuing: " + err.message);
          }
        }
      }
      this._restoreBrandOverride(instance);
      this._removeCSS(id);
      this._cleanupResources(id);
      clearCardRender(id);
      instance.enabled = false;
      this._persistEnabledState(id, false);
      console.log("[Plugin] Disabled:", id);
    },
    /**
     * Keep the persisted enabled flag in sync with the runtime state so that
     * enabling/suspending a plugin survives a page reload. No-op for plugins
     * that were registered without install() (session-only plugins have no
     * store entry).
     */
    _persistEnabledState: function(id, enabled) {
      if (window.store && window.store.plugins && window.store.plugins[id] && window.store.plugins[id].enabled !== enabled) {
        window.store.plugins[id].enabled = enabled;
        if (window.save) {
          window.save();
        }
      }
    },
    _applyCSS: function(id, css) {
      const existing = document.querySelector('style[data-plugin-id="' + id + '"]');
      if (existing) {
        existing.textContent = css;
      } else {
        const style = document.createElement("style");
        style.setAttribute("data-plugin-id", id);
        style.textContent = css;
        document.head.appendChild(style);
      }
    },
    _removeCSS: function(id) {
      const style = document.querySelector('style[data-plugin-id="' + id + '"]');
      if (style && style.parentNode) {
        style.parentNode.removeChild(style);
      }
    },
    _cleanupResources: function(id) {
      const resources = pluginResources.get(id);
      if (!resources || resources.size === 0) {
        return;
      }
      const cleanup = {
        domElements: 0,
        components: 0,
        listeners: 0,
        events: 0,
        errors: 0
      };
      resources.forEach(function(resource) {
        try {
          if (resource.type === "dom") {
            if (resource.original) {
              if (resource.element && resource.element.parentNode) {
                resource.element.parentNode.replaceChild(resource.original, resource.element);
                cleanup.domElements++;
              }
            } else if (resource.element && resource.element.parentNode) {
              resource.element.parentNode.removeChild(resource.element);
              cleanup.domElements++;
            }
          } else if (resource.type === "component") {
            if (ComponentRegistry) {
              if (ComponentRegistry.unregister(resource.name, resource.component)) {
                cleanup.components++;
              }
            }
          } else if (resource.type === "middleware") {
            if (MiddlewareManager) {
              MiddlewareManager.unregister(resource.name);
              cleanup.listeners++;
            }
          } else if (resource.type === "card-decorator") {
            cleanup.listeners++;
          } else if (resource.type === "listener") {
            cleanup.listeners++;
          } else if (resource.type === "event") {
            const list = globalEventBus.get(resource.event);
            if (list) {
              const idx = list.findIndex(function(h2) {
                return h2.callback === resource.callback && h2.pluginId === id;
              });
              if (idx !== -1) list.splice(idx, 1);
            }
            cleanup.events++;
          }
        } catch (err) {
          cleanup.errors++;
          console.error("[Plugin] Resource cleanup error for", id, ":", err);
        }
      });
      resources.clear();
      const listeners = dataUpdateListeners.get(id);
      if (listeners && listeners.length > 0) {
        cleanup.listeners += listeners.length;
        dataUpdateListeners.delete(id);
      }
      console.log(
        "[Plugin] Cleanup complete for",
        id,
        ":",
        cleanup.domElements,
        "DOM elements,",
        cleanup.components,
        "components,",
        cleanup.listeners,
        "listeners,",
        cleanup.events,
        "events",
        cleanup.errors > 0 ? "(" + cleanup.errors + " errors)" : ""
      );
    },
    _checkPermissions: async function(id, permissions) {
      console.log("[Plugin] Permissions requested for", id, ":", permissions);
      if (!permissions || permissions.length === 0) {
        return true;
      }
      if (PermissionsManager) {
        const instance = plugins.get(id);
        const pluginName = instance && instance.definition.manifest && instance.definition.manifest.name || id;
        return await PermissionsManager.requestPermissions(
          id,
          pluginName,
          permissions,
          instance ? instance.fingerprint : void 0
        );
      }
      if (window.showPermissionDialog) {
        return await window.showPermissionDialog(id, permissions);
      }
      console.warn("[Plugin] No permission consent mechanism available; denying permissions for", id);
      return false;
    },
    notifyDataUpdate: function(event) {
      dataUpdateListeners.forEach(function(listeners) {
        listeners.forEach(function(callback) {
          try {
            const result = callback(event);
            if (result && typeof result.catch === "function") {
              result.catch((err) => console.error("[Plugin] Data update callback error:", err));
            }
          } catch (err) {
            console.error("[Plugin] Data update callback error:", err);
          }
        });
      });
    },
    listAll: function() {
      return this.list();
    },
    /** Plugin ids with a live Card component or card.render decorator. Empty in the common case. */
    getCardRenderPluginIds: function() {
      return Array.from(cardRenderPluginIds);
    },
    /**
     * Ask one plugin's worker to render/decorate a batch of cards. Never
     * throws — a timeout, error, or missing worker all resolve to `null` so
     * rendering.js can treat "no upgrade this pass" uniformly and let the
     * already-rendered default tiles stand.
     */
    renderBatch: async function(id, cardsSnapshot, opts) {
      const instance = plugins.get(id);
      if (!instance || !instance.enabled || !instance.workerHandle) return null;
      const canOverride = hasPermission(id, "ui-override");
      const mayReplace = canOverride && cardComponentPluginIds.has(id) && !!instance.cardComponent && ComponentRegistry.get("Card") === instance.cardComponent;
      const decorators = cardDecorators.get(id);
      const mayDecorate = canOverride && !!(decorators && decorators.size > 0);
      if (!mayReplace && !mayDecorate) return null;
      let results;
      try {
        results = await instance.workerHandle.callWithDeadline(
          ["ui", "renderBatch"],
          [cardsSnapshot, opts || {}],
          CARD_RENDER_DEADLINE_MS
        );
      } catch (err) {
        return null;
      }
      if (!Array.isArray(results)) return null;
      return results.map((r) => ({
        cardId: r && r.cardId,
        vnode: mayReplace && r && r.vnode || null,
        patch: mayDecorate && r && r.patch || null
      }));
    },
    /** Backstop hang detector: terminates and suspends a worker whose oldest pending RPC call is stuck. */
    _startHangWatcher: function() {
      if (hangWatcherTimer) return;
      hangWatcherTimer = setInterval(() => {
        plugins.forEach((instance, id) => {
          if (instance.workerHandle && instance.workerHandle.isHung(HANG_BACKSTOP_MS)) {
            console.error('[Plugin] "' + id + '" stopped responding; suspending.');
            instance.workerHandle.terminate();
            instance.workerHandle = null;
            instance.enabled = false;
            this._removeCSS(id);
            this._cleanupResources(id);
            clearCardRender(id);
            this._persistEnabledState(id, false);
            if (window.showToast) {
              window.showToast('Plugin "' + id + '" stopped responding and was suspended.', "error");
            }
          }
        });
        this._stopHangWatcherIfIdle();
      }, 2e3);
    },
    /**
     * Stop the hang-watcher interval once no plugin has a live worker to
     * watch — otherwise this timer runs forever (a real, if minor, resource
     * leak in production once every JS-bearing plugin is disabled, and a
     * process-hang hazard in tests, where an un-cleared interval keeps
     * Node's event loop alive after the test file's assertions finish).
     */
    _stopHangWatcherIfIdle: function() {
      if (!hangWatcherTimer) return;
      let anyActive = false;
      plugins.forEach((instance) => {
        if (instance.workerHandle) anyActive = true;
      });
      if (!anyActive) {
        clearInterval(hangWatcherTimer);
        hangWatcherTimer = null;
      }
    },
    install: async function(pkg) {
      if (!pkg || !pkg.manifest) {
        throw new Error("Invalid plugin package: manifest is required");
      }
      if (!pkg.manifest.name && !pkg.manifest.id && !pkg.id) {
        throw new Error("Invalid plugin package: manifest.name or an id is required");
      }
      if (pkg.id && !pkg.manifest.id) pkg.manifest.id = pkg.id;
      if (pkg.config && typeof pkg.config === "object" && !pkg.manifest.config) {
        pkg.manifest.config = pkg.config;
      }
      if (pkg.overrides && typeof pkg.overrides === "object" && !pkg.manifest.overrides) {
        pkg.manifest.overrides = pkg.overrides;
      }
      if (pkg.manifest.dependencies && Array.isArray(pkg.manifest.dependencies) && pkg.manifest.dependencies.length > 0) {
        const missing = pkg.manifest.dependencies.filter(function(dep) {
          return !plugins.has(dep);
        });
        if (missing.length > 0) {
          throw new Error("Missing dependencies: " + missing.join(", ") + ". Install the required plugins first.");
        }
      }
      const jsSource = typeof pkg.js === "string" && pkg.js.trim() ? pkg.js : typeof pkg.javascript === "string" && pkg.javascript.trim() ? pkg.javascript : null;
      const teardownSource = typeof pkg.teardownJs === "string" && pkg.teardownJs.trim() ? pkg.teardownJs : typeof pkg.teardown === "string" && pkg.teardown.trim() ? pkg.teardown : null;
      if (typeof pkg.setup === "function" || typeof pkg.teardown === "function") {
        console.warn("[Plugin] install() ignores setup/teardown functions; use js/teardownJs source strings (sandboxed) or CardSpoke.registerPlugin() for host code.");
      }
      if (jsSource) _checkSyntax(jsSource);
      if (teardownSource) _checkSyntax(teardownSource);
      let id = pkg.manifest.id || String(pkg.manifest.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!id) {
        throw new Error("Invalid plugin package: could not derive a plugin id from manifest.name; set manifest.id");
      }
      if (plugins.has(id)) {
        await this.unregister(id);
      }
      const definition = {
        manifest: pkg.manifest,
        css: pkg.css,
        js: jsSource,
        teardownJs: teardownSource
      };
      this.register(id, definition);
      if (window.store) {
        if (!window.store.plugins) {
          window.store.plugins = {};
        }
        window.store.plugins[id] = {
          definition: _createSerializableDefinition(definition),
          enabled: false
        };
        if (window.save) {
          window.save();
        }
      }
      const risk = this.assessModRisk(pkg);
      if (risk === 'SAFE' || risk === 'LOW') {
        try {
          await this._enableWithTimeout(id);
        } catch (err) {
          console.warn("[Plugin] Installed but not enabled", id, ":", err.message);
        }
      }
      console.log("[Plugin] Installed:", id);
      return id;
    },
    assessModRisk: function(pkg) {
      if (!pkg || !pkg.manifest) {
        return 'HIGH';
      }
      const manifest = pkg.manifest;
      const layer = manifest.layer || "feature";
      const hasJS = !!pkg.setup || !!pkg.teardown || !!pkg.js || !!pkg.javascript;
      const hasCSS = !!pkg.css;
      const hasOverrides = !!pkg.overrides || !!manifest.overrides;
      if (layer === "theme" && !hasJS && hasCSS) {
        return 'SAFE';
      }
      if (layer === "feature" && !hasOverrides) {
        return 'LOW';
      }
      if (layer === "app" || hasOverrides) {
        return 'HIGH';
      }
      return 'MEDIUM';
    },
    syncFromStore: async function(safeMode) {
      if (typeof safeMode === "undefined" && typeof window !== "undefined" && window.location && typeof window.location.search === "string") {
        safeMode = new URLSearchParams(window.location.search).has("safemode");
      }
      if (!window.store || !window.store.plugins) {
        return;
      }
      const storedPlugins = window.store.plugins || {};
      const pluginIds = Object.keys(storedPlugins);
      if (pluginIds.length === 0) {
        return;
      }
      console.log("[Plugin] Syncing", pluginIds.length, "plugins from store");
      for (const id of pluginIds) {
        const pluginData = storedPlugins[id];
        if (plugins.has(id)) {
          continue;
        }
        if (!pluginData || !pluginData.definition) {
          continue;
        }
        try {
          const stored = pluginData.definition;
          const def = {
            manifest: stored.manifest,
            css: stored.css,
            js: typeof stored.js === "string" && stored.js.trim() ? stored.js : null,
            teardownJs: typeof stored.teardownJs === "string" && stored.teardownJs.trim() ? stored.teardownJs : null
          };
          this.register(id, def);
          if (!safeMode && pluginData.enabled) {
            try {
              await this._enableWithTimeout(id);
            } catch (enableErr) {
              console.error("[Plugin] Boot re-enable failed; suspending", id, ":", enableErr);
              this._persistEnabledState(id, false);
            }
          }
        } catch (err) {
          console.error("[Plugin] Failed to sync plugin", id, ":", err);
        }
      }
    },
    // Time-box enable() so a single plugin with a never-resolving setup()
    // cannot block the sequential boot sync and leave the app on a blank
    // screen. For a sandboxed plugin this also forcibly terminates the
    // worker on timeout — a capability main-thread execution never had.
    _enableWithTimeout: async function(id, timeoutMs) {
      const limit = typeof timeoutMs === "number" ? timeoutMs : ENABLE_TIMEOUT_MS;
      let timer = null;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Plugin "' + id + '" enable() timed out after ' + limit + "ms")),
          limit
        );
      });
      try {
        await Promise.race([this.enable(id), timeout]);
      } catch (err) {
        const instance = plugins.get(id);
        if (instance && instance.workerHandle) {
          instance.workerHandle.terminate();
          instance.workerHandle = null;
          this._stopHangWatcherIfIdle();
        }
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    /**
     * Phase 3.1: Auto-Generated Settings UI
     * Dynamically build a settings panel from the plugin's config object.
     * Each config key becomes a labelled form input whose type is inferred
     * from the value type (boolean → checkbox, number → number, else → text).
     * Changes made in the panel are written back to the plugin's live config
     * (and, for sandboxed plugins, the worker's `ctx.config` on next enable).
     *
     * @param {string} id - Plugin ID
     * @returns {HTMLElement|null} A <div class="plugin-settings-panel"> element,
     *   or null if the plugin has no config.
     */
    buildSettingsPanel: function(id) {
      const instance = plugins.get(id);
      if (!instance) return null;
      const config = instance.definition.manifest && instance.definition.manifest.config;
      if (!config || typeof config !== "object") return null;
      const keys = Object.keys(config);
      if (keys.length === 0) return null;
      const panel = document.createElement("div");
      panel.className = "plugin-settings-panel";
      panel.setAttribute("data-plugin-id", id);
      const title = document.createElement("h3");
      title.className = "plugin-settings-title";
      title.textContent = (instance.definition.manifest.name || id) + " Settings";
      panel.appendChild(title);
      keys.forEach(function(key) {
        const defaultValue = config[key];
        const valueType = typeof defaultValue;
        const row = document.createElement("div");
        row.className = "plugin-settings-row";
        const label = document.createElement("label");
        label.textContent = key;
        label.setAttribute("for", "plugin-setting-" + id + "-" + key);
        let input;
        if (valueType === "boolean") {
          input = document.createElement("input");
          input.type = "checkbox";
          input.checked = defaultValue;
        } else if (valueType === "number") {
          input = document.createElement("input");
          input.type = "number";
          input.value = String(defaultValue);
        } else {
          input = document.createElement("input");
          input.type = "text";
          input.value = defaultValue != null ? String(defaultValue) : "";
        }
        input.id = "plugin-setting-" + id + "-" + key;
        input.setAttribute("data-config-key", key);
        input.setAttribute("data-plugin-id", id);
        input.onchange = function() {
          let newValue;
          if (valueType === "boolean") {
            newValue = input.checked;
          } else if (valueType === "number") {
            newValue = Number(input.value);
          } else {
            newValue = input.value;
          }
          config[key] = newValue;
          if (instance.context && instance.context.config) {
            instance.context.config[key] = newValue;
          }
          if (window.store && window.store.plugins && window.store.plugins[id]) {
            const storedDef = window.store.plugins[id].definition;
            if (storedDef && storedDef.manifest && storedDef.manifest.config) {
              storedDef.manifest.config[key] = newValue;
            }
            if (window.save) {
              window.save();
            }
          }
        };
        row.appendChild(label);
        row.appendChild(input);
        panel.appendChild(row);
      });
      return panel;
    }
  };
  Object.defineProperty(PluginManager, "registerHostPlugin", {
    value: function(id, definition) {
      return PluginManager._registerInternal(id, definition, true);
    },
    enumerable: false,
    writable: false,
    configurable: false
  });
  console.log("[Plugin] API system initialized");
  function resetForTesting() {
    plugins.forEach((instance) => {
      if (instance.workerHandle) {
        try {
          instance.workerHandle.terminate();
        } catch (_e) {
        }
      }
    });
    plugins.clear();
    pluginResources.clear();
    dataUpdateListeners.clear();
    globalEventBus.clear();
    cardRenderPluginIds.clear();
    cardComponentPluginIds.clear();
    cardDecorators.clear();
    if (hangWatcherTimer) {
      clearInterval(hangWatcherTimer);
      hangWatcherTimer = null;
    }
    InternalAPI.data = {};
    InternalAPI.ui = {};
    InternalAPI.utils = {};
  }
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
      PluginManager.registerHostPlugin(id, definition);
      await PluginManager.enable(id);
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
      return PluginManager.install(pkg);
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
      return PermissionsManager.requestPermissions(pluginId, pluginName, permissions);
    },
    // ── Full runtime subsystems ────────────────────────────────────────────
    // Used by the app layer and by app-layer plugins. See
    // docs/architecture/PLUGIN_SYSTEM.md for which parts are supported plugin API.
    Plugin: PluginManager,
    PluginSandbox: Object.freeze({ createFunction: _checkSyntax }),
    Middleware: MiddlewareManager,
    ComponentRegistry,
    StorageDriverRegistry,
    PluginValidator,
    Permissions: PermissionsManager,
    // Populated by the host app layer with async card/tag/toast helpers.
    utils
  });
  if (typeof window !== "undefined") {
    window.CardSpoke = CardSpokeAPI;
  }
  function migrateCard(card) {
    if (!card || typeof card !== "object") return { card, changed: false, warnings: [] };
    let changed = false;
    if (!Array.isArray(card.children)) {
      card.children = [];
      changed = true;
    }
    if (!Array.isArray(card.tags)) {
      card.tags = [];
      changed = true;
    }
    if (card.modsData == null || typeof card.modsData !== "object") {
      card.modsData = {};
      changed = true;
    }
    return { card, changed, warnings: [] };
  }
  function migrateStore(store2) {
    const warnings = [];
    let changed = false;
    let migratedCount = 0;
    if (!store2 || !store2.cards || typeof store2.cards !== "object") {
      return { store: store2, changed, migratedCount, warnings };
    }
    for (const [id, card] of Object.entries(store2.cards)) {
      try {
        const result = migrateCard(card);
        if (result.changed) {
          changed = true;
          migratedCount++;
        }
        for (const w of result.warnings) warnings.push(`[${id}] ${w}`);
      } catch (err) {
        warnings.push(`[${id}] Migration failed: ${err && err.message}`);
      }
    }
    return { store: store2, changed, migratedCount, warnings };
  }
  const PBKDF2_ITERATIONS = 25e4;
  function getCrypto() {
    const c = typeof globalThis !== "undefined" ? globalThis.crypto : void 0;
    if (!c || !c.subtle) throw new Error("Web Crypto API unavailable");
    return c;
  }
  function toBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  function fromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  async function derivePinKey(pin, saltBytes) {
    const cryptoApi = getCrypto();
    const encoder = new TextEncoder();
    const baseKey = await cryptoApi.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveKey"]);
    return cryptoApi.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  async function encryptStorePayload(payload, pin) {
    const cryptoApi = getCrypto();
    const salt = cryptoApi.getRandomValues(new Uint8Array(16));
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const key = await derivePinKey(pin, salt);
    const data = new TextEncoder().encode(payload);
    const encrypted = await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    return JSON.stringify({
      encrypted: true,
      version: 1,
      kdf: "PBKDF2",
      cipher: "AES-GCM",
      iterations: PBKDF2_ITERATIONS,
      salt: toBase64(salt),
      iv: toBase64(iv),
      payload: toBase64(new Uint8Array(encrypted))
    });
  }
  async function decryptStorePayload(encryptedPayload, pin) {
    const envelope = typeof encryptedPayload === "string" ? JSON.parse(encryptedPayload) : encryptedPayload;
    if (!envelope || !envelope.encrypted) return encryptedPayload;
    const cryptoApi = getCrypto();
    const salt = fromBase64(envelope.salt);
    const iv = fromBase64(envelope.iv);
    const ciphertext = fromBase64(envelope.payload);
    const key = await derivePinKey(pin, salt);
    const decrypted = await cryptoApi.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  }
  function isEncryptedEnvelope(value) {
    return !!(value && typeof value === "object" && value.encrypted === true && typeof value.payload === "string" && typeof value.salt === "string" && typeof value.iv === "string");
  }
  "use strict";
  const APP_CREATOR = "Jeffrey Guntly";
  const APP_VERSION = '0.21.1';
  const APP_RELEASE_DATE = "2026-09-17";
  const APP_UPDATER = "JX Holdings, LLC";
  const SCHEMA_VERSION = 4;
  const MAX_UNDO_STACK = 50;
  const MAX_TRASH_SIZE = 100;
  function createDefaultStore() {
    return {
      rootOrder: [],
      cards: {},
      plugins: {},
      bookmarks: [],
      recentCards: [],
      viewMode: "normal",
      activeTheme: "light",
      richTextEnabled: false
    };
  }
  let store = createDefaultStore();
  function setStore(s) {
    store = s;
    if (typeof window !== "undefined") {
      window.store = s;
    }
  }
  if (typeof window !== "undefined") {
    window.store = store;
  }
  let navState = {
    mode: "cardspoke",
    page: "list",
    cardId: null,
    parentId: null,
    searchQuery: ""
  };
  function setNavState(s) {
    navState = s;
  }
  let navHistory = [];
  function setNavHistory(h2) {
    navHistory = h2;
  }
  let instanceKey = (typeof localStorage !== "undefined" ? localStorage.getItem("activeInstance") : null) || "nested_cards_store";
  function setInstanceKey(k) {
    instanceKey = k;
  }
  let dirty = false;
  function setDirty(d) {
    dirty = d;
  }
  let searchResultsState = {
    items: [],
    elements: [],
    selectedIndex: 0
  };
  function setSearchResultsState(s) {
    searchResultsState = s;
  }
  let draggedCardId = null;
  function setDraggedCardId(id) {
    draggedCardId = id;
  }
  let dragOverCardId = null;
  function setDragOverCardId(id) {
    dragOverCardId = id;
  }
  const undoStack = [];
  const redoStack = [];
  const trashBin = [];
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }
  function cloneCard(card) {
    if (!card) return null;
    card = typeof structuredClone === "function" ? structuredClone(card) : JSON.parse(JSON.stringify(card));
    let modsData = {};
    if (card.modsData) {
      try {
        modsData = JSON.parse(JSON.stringify(card.modsData));
      } catch (_err) {
        modsData = { ...card.modsData };
      }
    }
    return {
      ...card,
      children: Array.isArray(card.children) ? card.children.slice() : [],
      tags: Array.isArray(card.tags) ? card.tags.slice() : [],
      modsData
    };
  }
  function normalizeCardName(name) {
    if (!name) return "";
    return name.toLowerCase().trim().replace(/\s+/g, " ");
  }
  function parseCardLinks(text) {
    if (!text) return [];
    const regex = /\[\[([^\]]+)\]\]/g;
    const matches = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      matches.push({
        match: m[0],
        cardName: m[1].trim(),
        startIndex: m.index,
        endIndex: m.index + m[0].length
      });
    }
    return matches;
  }
  function hasCardLink(text, cardName) {
    if (!text || !cardName) return false;
    const links = parseCardLinks(text);
    const normalized = normalizeCardName(cardName);
    return links.some((link) => normalizeCardName(link.cardName) === normalized);
  }
  function extractTags(body) {
    if (!body) return [];
    const matches = body.match(/#\w+/g);
    return matches ? matches.slice(0, 5) : [];
  }
  class Kernel {
    /**
     * Create a new Kernel instance with its own isolated data store.
     * @param {Object} [initialData] - Optional seed data { cards, rootOrder }
     */
    constructor(initialData) {
      this.cards = {};
      this.rootOrder = [];
      if (initialData) {
        if (initialData.cards && typeof initialData.cards === "object") {
          for (const [id, card] of Object.entries(initialData.cards)) {
            this.cards[id] = cloneCard(card);
          }
        }
        if (Array.isArray(initialData.rootOrder)) {
          this.rootOrder = initialData.rootOrder.slice();
        }
      }
    }
    // ── Snapshot / hydration ──────────────────────────────────────────────────
    /**
     * Return a deep-cloned snapshot of the full data store.
     * Safe to serialize or hand to another layer.
     * @returns {{ cards: Object, rootOrder: string[] }}
     */
    snapshot() {
      const cards = {};
      for (const [id, card] of Object.entries(this.cards)) {
        cards[id] = cloneCard(card);
      }
      return { cards, rootOrder: this.rootOrder.slice() };
    }
    /**
     * Replace the entire internal store (e.g. after loading from storage).
     * Deep-clones incoming data.
     * @param {{ cards: Object, rootOrder: string[] }} data
     */
    hydrate(data) {
      this.cards = {};
      this.rootOrder = [];
      if (data.cards && typeof data.cards === "object") {
        for (const [id, card] of Object.entries(data.cards)) {
          this.cards[id] = cloneCard(card);
        }
      }
      if (Array.isArray(data.rootOrder)) {
        this.rootOrder = data.rootOrder.slice();
      }
    }
    // ── Card CRUD ─────────────────────────────────────────────────────────────
    /**
     * Create a new card.
     * @param {string} title
     * @param {string} body
     * @param {string|null} [parentId=null]
     * @returns {{ id: string, card: Object }} The new card (cloned).
     */
    createCard(title, body, parentId = null) {
      if (parentId && !Object.hasOwn(this.cards, parentId)) throw new Error("Parent card not found");
      const id = uid();
      const now = Date.now();
      const card = {
        id,
        title: title || "",
        body: body || "",
        parentId: parentId || null,
        children: [],
        createdAt: now,
        updatedAt: now,
        modsData: {},
        tags: [],
        isRichText: false
      };
      this.cards[id] = card;
      if (!parentId) {
        this.rootOrder.push(id);
      } else {
        const parent = this.cards[parentId];
        if (parent && !parent.children.includes(id)) {
          parent.children.push(id);
        }
      }
      return { id, card: cloneCard(card) };
    }
    /**
     * Update fields on an existing card.
     * @param {string} id
     * @param {Object} updates - Fields to merge onto the card.
     * @returns {{ previousState: Object|null, card: Object|null }} Cloned before/after.
     */
    updateCard(id, updates) {
      const card = this.cards[id];
      if (!card) return { previousState: null, card: null };
      const previousState = cloneCard(card);
      const updateTimestamp = Date.now();
      Object.assign(card, updates, { updatedAt: updateTimestamp });
      return { previousState, card: cloneCard(card) };
    }
    /**
     * Delete a card and all its descendants recursively.
     * @param {string} id
     * @returns {{ deleted: Object[], affectedChildIds: string[] }}
     *   deleted: array of cloned card snapshots (root first, then descendants).
     *   affectedChildIds: flat list of every removed ID (including root).
     */
    deleteCard(id) {
      const deleted = [];
      const affectedChildIds = [];
      const visited = /* @__PURE__ */ new Set();
      const remove = (cardId) => {
        if (visited.has(cardId)) return;
        visited.add(cardId);
        const card = this.cards[cardId];
        if (!card) return;
        deleted.push(cloneCard(card));
        affectedChildIds.push(cardId);
        const children = (card.children || []).slice();
        children.forEach((cid) => remove(cid));
        if (card.parentId) {
          const parent = this.cards[card.parentId];
          if (parent) {
            parent.children = parent.children.filter((c) => c !== cardId);
          }
        } else {
          this.rootOrder = this.rootOrder.filter((c) => c !== cardId);
        }
        delete this.cards[cardId];
      };
      remove(id);
      return { deleted, affectedChildIds };
    }
    /**
     * Retrieve a single card by ID.
     * @param {string} id
     * @returns {Object|null} Cloned card or null.
     */
    getCard(id) {
      return cloneCard(this.cards[id] || null);
    }
    /**
     * Check whether a card exists.
     * @param {string} id
     * @returns {boolean}
     */
    hasCard(id) {
      return id in this.cards;
    }
    /**
     * Return cloned direct children of a card (or root cards if id is null).
     * @param {string|null} parentId
     * @returns {Object[]}
     */
    getChildren(parentId) {
      if (!parentId) {
        return this.rootOrder.map((id) => cloneCard(this.cards[id])).filter(Boolean);
      }
      const parent = this.cards[parentId];
      if (!parent) return [];
      return (parent.children || []).map((id) => cloneCard(this.cards[id])).filter(Boolean);
    }
    /**
     * Return the ancestor chain from a card up to the root (inclusive).
     * @param {string} id
     * @returns {Object[]} Array of cloned cards, nearest parent first.
     */
    getAncestors(id) {
      const ancestors = [];
      let current = this.cards[id];
      const seen = /* @__PURE__ */ new Set();
      while (current && current.parentId) {
        if (seen.has(current.id)) break;
        seen.add(current.id);
        const parent = this.cards[current.parentId];
        if (!parent) break;
        ancestors.push(cloneCard(parent));
        current = parent;
      }
      return ancestors;
    }
    /**
     * Count all cards in the store.
     * @returns {number}
     */
    cardCount() {
      return Object.keys(this.cards).length;
    }
    /**
     * Collect every descendant ID under a card (not including the card itself).
     * @param {string} id
     * @returns {string[]}
     */
    getDescendantIds(id) {
      const ids = [];
      const seen = /* @__PURE__ */ new Set();
      const walk = (cardId) => {
        if (seen.has(cardId)) return;
        seen.add(cardId);
        const card = this.cards[cardId];
        if (!card) return;
        for (const childId of card.children || []) {
          ids.push(childId);
          walk(childId);
        }
      };
      walk(id);
      return ids;
    }
    // ── Hierarchy operations ──────────────────────────────────────────────────
    /**
     * Move a card to a new parent (or to root if newParentId is null).
     * Prevents moving a card into its own subtree.
     * @param {string} id
     * @param {string|null} newParentId
     * @returns {{ success: boolean, previousParentId: string|null }}
     */
    reparent(id, newParentId) {
      const card = this.cards[id];
      if (!card) return { success: false, previousParentId: null };
      if (newParentId && !Object.hasOwn(this.cards, newParentId)) return { success: false, previousParentId: card.parentId };
      if (newParentId) {
        const descendantIds = this.getDescendantIds(id);
        if (descendantIds.includes(newParentId) || newParentId === id) {
          return { success: false, previousParentId: card.parentId };
        }
      }
      const previousParentId = card.parentId;
      if (card.parentId) {
        const oldParent = this.cards[card.parentId];
        if (oldParent) {
          oldParent.children = oldParent.children.filter((c) => c !== id);
        }
      } else {
        this.rootOrder = this.rootOrder.filter((c) => c !== id);
      }
      card.parentId = newParentId || null;
      if (newParentId) {
        const newParent = this.cards[newParentId];
        if (newParent && !newParent.children.includes(id)) {
          newParent.children.push(id);
        }
      } else {
        if (!this.rootOrder.includes(id)) {
          this.rootOrder.push(id);
        }
      }
      card.updatedAt = Date.now();
      return { success: true, previousParentId };
    }
    /**
     * Reorder a card within its sibling list.
     * @param {string} id
     * @param {number} newIndex - Target index in the sibling array.
     * @returns {{ success: boolean, previousIndex: number }}
     */
    reorder(id, newIndex) {
      const card = this.cards[id];
      if (!card) return { success: false, previousIndex: -1 };
      const list = card.parentId ? this.cards[card.parentId] ? this.cards[card.parentId].children : null : this.rootOrder;
      if (!list) return { success: false, previousIndex: -1 };
      const previousIndex = list.indexOf(id);
      if (previousIndex === -1) return { success: false, previousIndex: -1 };
      list.splice(previousIndex, 1);
      const clamped = Math.max(0, Math.min(newIndex, list.length));
      list.splice(clamped, 0, id);
      return { success: true, previousIndex };
    }
    /**
     * Duplicate a card (and optionally its entire subtree).
     * @param {string} id
     * @param {boolean} [withChildren=false]
     * @returns {{ newId: string|null, allNewIds: string[] }} IDs of created cards.
     */
    duplicateHierarchy(id, withChildren = false) {
      const original = this.cards[id];
      if (!original) return { newId: null, allNewIds: [] };
      const allNewIds = [];
      const visited = /* @__PURE__ */ new Set();
      const dup = (sourceId, targetParentId) => {
        if (visited.has(sourceId)) return null;
        visited.add(sourceId);
        const src = this.cards[sourceId];
        if (!src) return null;
        const newId2 = uid();
        const now = Date.now();
        this.cards[newId2] = {
          ...cloneCard(src),
          id: newId2,
          parentId: targetParentId,
          children: [],
          title: targetParentId === (original.parentId || null) && sourceId === id ? (src.title || "Untitled") + " (Copy)" : src.title || "",
          createdAt: now,
          updatedAt: now
        };
        allNewIds.push(newId2);
        if (targetParentId) {
          const parent = this.cards[targetParentId];
          if (parent && !parent.children.includes(newId2)) {
            parent.children.push(newId2);
          }
        } else {
          this.rootOrder.push(newId2);
        }
        if (withChildren) {
          for (const childId of src.children || []) {
            dup(childId, newId2);
          }
        }
        return newId2;
      };
      const newId = dup(id, original.parentId || null);
      return { newId, allNewIds };
    }
    // ── Tag operations ────────────────────────────────────────────────────────
    /**
     * Get all tags for a card.
     * @param {string} cardId
     * @returns {string[]}
     */
    getTags(cardId) {
      const card = this.cards[cardId];
      if (!card) return [];
      return (card.tags || []).slice();
    }
    /**
     * Add a tag to a card.
     * @param {string} cardId
     * @param {string} tag
     * @returns {boolean} True if the tag was added.
     */
    addTag(cardId, tag) {
      const card = this.cards[cardId];
      if (!card) return false;
      const normalized = tag.replace(/^#/, "").toLowerCase().trim();
      if (!normalized) return false;
      if (!card.tags) card.tags = [];
      if (card.tags.some((t) => t.toLowerCase() === normalized)) return false;
      card.tags.push(normalized);
      card.updatedAt = Date.now();
      return true;
    }
    /**
     * Remove a tag from a card.
     * @param {string} cardId
     * @param {string} tag
     * @returns {boolean} True if the tag was removed.
     */
    removeTag(cardId, tag) {
      const card = this.cards[cardId];
      if (!card || !card.tags) return false;
      const normalized = tag.replace(/^#/, "").toLowerCase().trim();
      const before = card.tags.length;
      card.tags = card.tags.filter((t) => t.toLowerCase() !== normalized);
      if (card.tags.length === before) return false;
      card.updatedAt = Date.now();
      return true;
    }
    /**
     * Replace all tags on a card.
     * @param {string} cardId
     * @param {string[]} tags
     * @returns {boolean}
     */
    setTags(cardId, tags) {
      const card = this.cards[cardId];
      if (!card) return false;
      const normalized = tags.map((t) => t.replace(/^#/, "").toLowerCase().trim()).filter(Boolean);
      card.tags = [...new Set(normalized)];
      card.updatedAt = Date.now();
      return true;
    }
    /**
     * Collect every unique tag across all cards.
     * @returns {string[]}
     */
    getAllTags() {
      const all = /* @__PURE__ */ new Set();
      for (const card of Object.values(this.cards)) {
        if (card.tags) card.tags.forEach((t) => all.add(t));
      }
      return Array.from(all).sort();
    }
    // ── Query helpers ─────────────────────────────────────────────────────────
    /**
     * Find a card by its title (case-insensitive, whitespace-normalized).
     * @param {string} cardName
     * @returns {string|null} Card ID or null.
     */
    findCardByName(cardName) {
      if (!cardName) return null;
      const normalized = normalizeCardName(cardName);
      for (const [id, card] of Object.entries(this.cards)) {
        if (normalizeCardName(card.title) === normalized) return id;
      }
      return null;
    }
    /**
     * Find all cards matching a name (exact or partial).
     * @param {string} cardName
     * @param {boolean} [exactMatch=true]
     * @returns {Array<{id: string, title: string, similarity: number}>}
     */
    findCardsByName(cardName, exactMatch = true) {
      if (!cardName) return [];
      const normalized = normalizeCardName(cardName);
      const results = [];
      for (const [id, card] of Object.entries(this.cards)) {
        const nt = normalizeCardName(card.title);
        if (exactMatch) {
          if (nt === normalized) {
            results.push({ id, title: card.title, similarity: 1 });
          }
        } else if (nt.includes(normalized)) {
          const similarity = Math.min(normalized.length, nt.length) / Math.max(normalized.length, nt.length);
          results.push({ id, title: card.title, similarity });
        }
      }
      results.sort((a, b) => b.similarity - a.similarity);
      return results;
    }
    /**
     * Resolve all [[Card Name]] links in text to card IDs.
     * @param {string} text
     * @returns {Array<{link: Object, cardId: string|null}>}
     */
    resolveCardLinks(text) {
      const links = parseCardLinks(text);
      return links.map((link) => ({
        link,
        cardId: this.findCardByName(link.cardName)
      }));
    }
    /**
     * Get all cards that link to a given card via [[Title]] references.
     * @param {string} cardId
     * @returns {Array<{id: string, title: string}>}
     */
    getBacklinks(cardId) {
      const card = this.cards[cardId];
      if (!card || !card.title) return [];
      const backlinks = [];
      for (const [id, other] of Object.entries(this.cards)) {
        if (id === cardId) continue;
        if (other.body && hasCardLink(other.body, card.title)) {
          backlinks.push({ id: other.id, title: other.title || "(Untitled)" });
        }
      }
      return backlinks;
    }
    /**
     * Get related cards based on shared tags.
     * @param {string} cardId
     * @param {number} [limit=10]
     * @returns {Array<{id: string, title: string, matchScore: number, matchedTags: string[]}>}
     */
    getRelatedCards(cardId, limit = 10) {
      const card = this.cards[cardId];
      if (!card) return [];
      const cardTags = this.getTags(cardId);
      if (cardTags.length === 0) return [];
      const related = [];
      for (const [id, other] of Object.entries(this.cards)) {
        if (id === cardId) continue;
        const otherTags = this.getTags(id);
        const matchedTags = cardTags.filter((t) => otherTags.includes(t));
        if (matchedTags.length > 0) {
          related.push({
            id: other.id,
            title: other.title || "(Untitled)",
            matchScore: matchedTags.length / Math.max(cardTags.length, otherTags.length),
            matchedTags
          });
        }
      }
      related.sort((a, b) => b.matchScore - a.matchScore);
      return related.slice(0, limit);
    }
  }
  "use strict";
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "className") el.className = v;
      else if (k === "onclick") el.onclick = v;
      else if (k === "onsubmit") el.onsubmit = v;
      else if (k === "style") el.style.cssText = v;
      else if (k === "oninput") el.oninput = v;
      else if (k === "onchange") el.onchange = v;
      else if (k === "selected" || k === "disabled" || k === "checked" || k === "readonly") {
        if (v) el.setAttribute(k, "");
      } else if (k === "value" && (tag === "input" || tag === "textarea")) {
        el.value = v == null ? "" : v;
      } else if (v !== false && v !== null && v !== void 0) el.setAttribute(k, v);
    });
    children.flat().forEach((ch) => {
      if (typeof ch === "string") el.appendChild(document.createTextNode(ch));
      else if (ch instanceof Node) el.appendChild(ch);
      else if (typeof ch === "number" || typeof ch === "boolean" || typeof ch === "bigint") {
        el.appendChild(document.createTextNode(String(ch)));
      }
    });
    return el;
  }
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  function normalizeTagInput(raw) {
    if (!raw) return [];
    return raw.split(/[\s,]+/).map((tag) => tag.replace(/^#/, "").toLowerCase().trim()).filter(Boolean);
  }
  function escapeHtml(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function highlightText(text, query) {
    if (!query || !text) return document.createTextNode(text || "");
    const terms = query.split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
    if (!terms.length) return document.createTextNode(text);
    let html = escapeHtml(text);
    terms.forEach((term) => {
      const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(new RegExp(safeTerm, "gi"), (match) => `<mark>${match}</mark>`);
    });
    const span = document.createElement("span");
    span.innerHTML = html;
    return span;
  }
  function trapFocus(modal) {
    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusableElements.length) {
      return () => {
      };
    }
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];
    const handleKeyDown = (e) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    };
    modal.addEventListener("keydown", handleKeyDown);
    if (firstFocusable) {
      firstFocusable.focus();
    }
    return () => {
      modal.removeEventListener("keydown", handleKeyDown);
    };
  }
  function enhanceModalA11y(overlay) {
    if (!overlay || !overlay.dataset || overlay.dataset.a11yEnhanced === "true") return;
    const modal = overlay.querySelector(".modal, .menu-panel");
    if (!modal) return;
    overlay.dataset.a11yEnhanced = "true";
    const titleEl = modal.querySelector(".modal-title, .menu-title");
    if (titleEl) {
      if (!titleEl.id) titleEl.id = "dialog-title-" + uid();
      modal.setAttribute("aria-labelledby", titleEl.id);
    }
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const previousActive = document.activeElement;
    const releaseFocus = trapFocus(modal);
    const isTopmostOverlay = () => {
      const overlays = document.querySelectorAll(".modal-overlay.show, .menu-overlay.show");
      return overlays.length > 0 && overlays[overlays.length - 1] === overlay;
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape" && isTopmostOverlay()) {
        e.preventDefault();
        e.stopPropagation();
        overlay.remove();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    const originalRemove = overlay.remove.bind(overlay);
    overlay.remove = function() {
      document.removeEventListener("keydown", onKeyDown, true);
      if (typeof releaseFocus === "function") releaseFocus();
      originalRemove();
      if (previousActive && typeof previousActive.focus === "function" && document.contains(previousActive)) {
        previousActive.focus();
      }
    };
  }
  function initModalA11yObserver() {
    if (typeof MutationObserver === "undefined" || !document.body) return;
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!node || node.nodeType !== 1 || !node.classList) return;
          const isOverlay = node.classList.contains("show") && (node.classList.contains("modal-overlay") || node.classList.contains("menu-overlay"));
          if (!isOverlay) return;
          if (node.dataset.a11yManaged === "true" || node.classList.contains("permission-modal")) return;
          enhanceModalA11y(node);
        });
      });
    });
    observer.observe(document.body, { childList: true });
  }
  function formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  }
  function isRichTextEnabled() {
    return localStorage.getItem("cardspoke_richtext") === "true";
  }
  function setRichTextEnabled(enabled) {
    localStorage.setItem("cardspoke_richtext", enabled ? "true" : "false");
  }
  function getActiveThemeMod() {
    return localStorage.getItem("cardspoke_activeThemeMod") || localStorage.getItem("cardspoke_activeThemeExtension") || null;
  }
  function setActiveThemeMod(modId) {
    if (modId) {
      localStorage.setItem("cardspoke_activeThemeMod", modId);
    } else {
      localStorage.removeItem("cardspoke_activeThemeMod");
    }
    localStorage.removeItem("cardspoke_activeThemeExtension");
  }
  function isDeveloperMode() {
    return localStorage.getItem("cardspoke_devmode") === "true";
  }
  let toastContainer = null;
  function initToast() {
    toastContainer = document.getElementById("toastContainer");
  }
  function showToast(message, type = "success", duration = 3e3) {
    if (!toastContainer) {
      toastContainer = document.getElementById("toastContainer");
    }
    if (!toastContainer) {
      console.warn("[Toast] Container not found");
      return;
    }
    const toast = h("div", {
      className: `toast ${type}`,
      role: "alert",
      "aria-live": type === "error" ? "assertive" : "polite",
      "aria-atomic": "true",
      tabindex: "0"
    }, message);
    toastContainer.appendChild(toast);
    let timeoutId = null;
    let isPaused = false;
    let remainingTime = duration;
    let startTime = Date.now();
    const scheduleRemoval = () => {
      startTime = Date.now();
      timeoutId = setTimeout(() => {
        if (!isPaused) {
          toast.style.opacity = "0";
          setTimeout(() => toast.remove(), 300);
        }
      }, remainingTime);
    };
    const pauseTimer = () => {
      if (!isPaused && timeoutId) {
        clearTimeout(timeoutId);
        remainingTime -= Date.now() - startTime;
        isPaused = true;
      }
    };
    const resumeTimer = () => {
      if (isPaused) {
        isPaused = false;
        scheduleRemoval();
      }
    };
    toast.addEventListener("mouseenter", pauseTimer);
    toast.addEventListener("mouseleave", resumeTimer);
    toast.style.cursor = "pointer";
    const dismissToast = () => {
      clearTimeout(timeoutId);
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    };
    toast.addEventListener("click", dismissToast);
    toast.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        dismissToast();
      }
    });
    scheduleRemoval();
  }
  function showModalDialog(options = {}) {
    const {
      title = "Dialog",
      message = "",
      content = null,
      actions = [],
      dismissValue = null,
      width = "520px",
      ariaLabelledBy = "",
      onOpen = null
    } = options;
    return new Promise((resolve) => {
      const previousActive = document.activeElement;
      const overlay = h("div", { className: "modal-overlay show", "data-a11y-managed": "true" });
      const modal = h("div", {
        className: "modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": ariaLabelledBy || `dialog-title-${uid()}`,
        style: `max-width: ${width};`
      });
      const modalHeader = h("div", { className: "modal-header" });
      const titleEl = h("div", {
        className: "modal-title",
        id: modal.getAttribute("aria-labelledby")
      }, title);
      modalHeader.appendChild(titleEl);
      const closeBtn = h("button", {
        className: "modal-close",
        type: "button",
        "aria-label": "Close dialog"
      }, "×");
      modalHeader.appendChild(closeBtn);
      modal.appendChild(modalHeader);
      const modalBody = h("div", { className: "modal-body" });
      if (message) {
        modalBody.appendChild(h("div", { className: "modal-message" }, message));
      }
      if (content) {
        modalBody.appendChild(content);
      }
      const modalActions = h("div", { className: "modal-actions" });
      modalBody.appendChild(modalActions);
      modal.appendChild(modalBody);
      overlay.appendChild(modal);
      let releasedFocus = null;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKeyDown);
        if (releasedFocus) releasedFocus();
        overlay.remove();
        if (previousActive && typeof previousActive.focus === "function") {
          previousActive.focus();
        }
        resolve(value);
      };
      const onKeyDown = (e) => {
        if (e.key === "Escape") {
          const overlays = document.querySelectorAll(".modal-overlay.show, .menu-overlay.show");
          if (overlays.length && overlays[overlays.length - 1] !== overlay) return;
          e.preventDefault();
          finish(dismissValue);
        }
      };
      document.addEventListener("keydown", onKeyDown);
      closeBtn.onclick = () => finish(dismissValue);
      overlay.onclick = (e) => {
        if (e.target === overlay) finish(dismissValue);
      };
      actions.forEach((action) => {
        const btn = h("button", {
          type: "button",
          className: action.className || "btn",
          onclick: () => finish(typeof action.getValue === "function" ? action.getValue() : action.value)
        }, action.label);
        if (typeof action.onCreate === "function") {
          action.onCreate(btn);
        }
        if (action.autoFocus) {
          btn.dataset.autofocus = "true";
        }
        modalActions.appendChild(btn);
      });
      document.body.appendChild(overlay);
      releasedFocus = trapFocus(modal);
      requestAnimationFrame(() => {
        if (typeof onOpen === "function") {
          onOpen({ overlay, modal, modalBody, finish });
        }
        const preferred = modal.querySelector('[data-autofocus="true"]');
        if (preferred && typeof preferred.focus === "function") {
          preferred.focus();
        }
      });
    });
  }
  function showConfirmDialog(message, options = {}) {
    return showModalDialog({
      title: options.title || "Confirm Action",
      message,
      width: options.width || "520px",
      dismissValue: false,
      actions: [
        {
          label: options.cancelLabel || "Cancel",
          value: false,
          className: "btn",
          autoFocus: !options.confirmFirst
        },
        {
          label: options.confirmLabel || "Confirm",
          value: true,
          className: options.confirmClassName || "btn btn-primary",
          autoFocus: !!options.confirmFirst
        }
      ]
    });
  }
  function showChoiceDialog(message, options = {}) {
    return showModalDialog({
      title: options.title || "Choose Action",
      message,
      width: options.width || "520px",
      dismissValue: options.dismissValue ?? null,
      actions: options.actions || []
    });
  }
  function showPromptDialog(options = {}) {
    const fieldId = `dialog-input-${uid()}`;
    const inputWrap = h("div", { className: "form-group dialog-field" });
    if (options.label) {
      inputWrap.appendChild(h("label", { className: "form-label", for: fieldId }, options.label));
    }
    const input = h("input", {
      id: fieldId,
      type: options.type || "text",
      className: "form-input",
      value: options.defaultValue || "",
      placeholder: options.placeholder || "",
      autocomplete: "off"
    });
    input.dataset.autofocus = "true";
    if (Array.isArray(options.suggestions) && options.suggestions.length > 0) {
      const datalistId = `dialog-datalist-${uid()}`;
      input.setAttribute("list", datalistId);
      const datalist = h("datalist", { id: datalistId });
      options.suggestions.forEach((suggestion) => {
        datalist.appendChild(h("option", { value: suggestion }));
      });
      inputWrap.appendChild(input);
      inputWrap.appendChild(datalist);
    } else {
      inputWrap.appendChild(input);
    }
    let submitBtn = null;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && submitBtn) {
        e.preventDefault();
        submitBtn.click();
      }
    });
    return showModalDialog({
      title: options.title || "Enter Value",
      message: options.message || "",
      content: inputWrap,
      width: options.width || "520px",
      dismissValue: null,
      actions: [
        {
          label: options.cancelLabel || "Cancel",
          value: null,
          className: "btn"
        },
        {
          label: options.confirmLabel || "Save",
          className: options.confirmClassName || "btn btn-primary",
          getValue: () => input.value,
          onCreate: (btn) => {
            submitBtn = btn;
          }
        }
      ],
      onOpen: () => {
        input.focus();
        input.select();
      }
    }).then((value) => {
      submitBtn = null;
      return value;
    });
  }
  let renderCleanupCallbacks = [];
  function registerRenderCleanup(fn) {
    if (typeof fn === "function") renderCleanupCallbacks.push(fn);
  }
  function runRenderCleanup() {
    if (!renderCleanupCallbacks.length) return;
    renderCleanupCallbacks.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error("[Render Cleanup] Failed:", err);
      }
    });
    renderCleanupCallbacks = [];
  }
  const header = {
    homeBtn: document.getElementById("homeBtn"),
    themeToggle: document.getElementById("themeToggle"),
    menuBtn: document.getElementById("menuBtn"),
    brandBtn: document.getElementById("brandBtn"),
    undoBtn: document.getElementById("undoBtn")
  };
  const menu = {
    overlay: document.getElementById("menuOverlay"),
    closeBtn: document.getElementById("menuClose"),
    newCard: document.getElementById("menuNewCard"),
    upload: document.getElementById("menuUpload"),
    pluginManager: document.getElementById("menuPluginManager"),
    appearance: document.getElementById("menuAppearance"),
    tagManager: document.getElementById("menuTagManager"),
    advancedSearch: document.getElementById("menuAdvancedSearch"),
    trashBin: document.getElementById("menuTrashBin"),
    bookmarks: document.getElementById("menuBookmarks"),
    typography: document.getElementById("menuTypography"),
    recentCards: document.getElementById("menuRecentCards"),
    dataHub: document.getElementById("menuDataHub"),
    clearAll: document.getElementById("menuClearAll"),
    gettingStarted: document.getElementById("menuGettingStarted"),
    help: document.getElementById("menuHelp"),
    keyboardShortcuts: document.getElementById("menuKeyboardShortcuts"),
    developerSection: document.getElementById("menuDeveloperSection"),
    developerConsole: document.getElementById("menuDeveloperConsole")
  };
  const searchContainer = document.getElementById("searchContainer");
  const searchInput = document.getElementById("searchInput");
  const searchClear = document.getElementById("searchClear");
  const datasetSelector = document.getElementById("datasetSelector");
  const breadcrumbs = document.getElementById("breadcrumbs");
  const main = document.getElementById("main");
  let previewObserver = null;
  const uploadModal = {
    overlay: document.getElementById("uploadModal"),
    closeBtn: document.getElementById("closeUploadModal"),
    tabs: document.querySelectorAll(".modal-tab"),
    tabContents: document.querySelectorAll(".tab-content"),
    fileUploadAreaJSON: document.getElementById("fileUploadAreaJSON"),
    fileInputJSON: document.getElementById("fileInputJSON"),
    importLocationSelectJSON: document.getElementById("importLocationSelectJSON"),
    fileUploadAreaTXT: document.getElementById("fileUploadAreaTXT"),
    fileInputTXT: document.getElementById("fileInputTXT"),
    importLocationSelectTXT: document.getElementById("importLocationSelectTXT"),
    fileUploadAreaMods: document.getElementById("fileUploadAreaMods"),
    fileInputMods: document.getElementById("fileInputMods"),
    // Plugin install fields
    manualModName: document.getElementById("manualModName"),
    manualModCreator: document.getElementById("manualModCreator"),
    manualModVersion: document.getElementById("manualModVersion"),
    manualModReleaseDate: document.getElementById("manualModReleaseDate"),
    manualModJS: document.getElementById("manualModJS"),
    manualModCSS: document.getElementById("manualModCSS"),
    installManualMod: document.getElementById("installManualMod")
  };
  function bootError(msg) {
    main.innerHTML = "";
    main.appendChild(h("div", { className: "empty" }, "Error: " + msg));
  }
  function levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            // substitution
            matrix[i][j - 1] + 1,
            // insertion
            matrix[i - 1][j] + 1
            // deletion
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }
  function fuzzyMatchScore(query, text) {
    const FUZZY_PREFIX_PADDING = 10;
    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();
    if (!queryLower || !textLower) return 0;
    const queryTerms = queryLower.split(/\s+/).filter(Boolean);
    if (queryTerms.length > 1 && !queryTerms.some((term) => textLower.includes(term))) {
      return 0;
    }
    if (textLower.includes(queryLower)) {
      const position = textLower.indexOf(queryLower);
      return 100 - position * 0.5;
    }
    const candidates = /* @__PURE__ */ new Set();
    candidates.add(textLower.substring(0, query.length + FUZZY_PREFIX_PADDING));
    const words = textLower.split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      const windowSize = Math.min(words.length, Math.max(1, queryTerms.length));
      for (let i = 0; i <= words.length - windowSize; i++) {
        candidates.add(words.slice(i, i + windowSize).join(" "));
      }
    }
    let bestScore = 0;
    candidates.forEach((candidate) => {
      if (!candidate) return;
      const distance = levenshteinDistance(queryLower, candidate);
      const maxLen = Math.max(queryLower.length, candidate.length);
      const similarity = 1 - distance / maxLen;
      bestScore = Math.max(bestScore, Math.max(0, similarity * 70));
    });
    return bestScore;
  }
  function fuzzySearchCards(store2, query) {
    const EXACT_MATCH_THRESHOLD = 30;
    const MULTI_TERM_APPROX_THRESHOLD = 62;
    const SINGLE_TERM_APPROX_THRESHOLD = 48;
    if (!query || query.trim() === "") {
      return [];
    }
    if (query.trim() === "*") {
      return Object.values(store2.cards).map((card) => ({
        card,
        score: 100,
        approximate: false,
        titleMatch: false,
        bodyMatch: false
      }));
    }
    const results = [];
    const queryLower = query.toLowerCase().trim();
    const queryTerms = queryLower.split(/\s+/).filter(Boolean);
    Object.values(store2.cards).forEach((card) => {
      const titleText = (card.title || "").toLowerCase();
      const bodyText = (card.body || "").toLowerCase();
      const tags = Array.isArray(card.tags) ? card.tags : [];
      const exactTitleMatch = titleText.includes(queryLower);
      const exactBodyMatch = bodyText.includes(queryLower);
      const exactTagMatch = tags.some((tag) => tag.toLowerCase().includes(queryLower));
      const titleScore = fuzzyMatchScore(queryLower, card.title || "");
      const bodyScore = fuzzyMatchScore(queryLower, card.body || "") * 0.55;
      const tagScore = tags.length ? Math.max(...tags.map((tag) => fuzzyMatchScore(queryLower, tag) * 0.9), 0) : 0;
      const totalScore = Math.max(titleScore, bodyScore, tagScore);
      const hasDirectMatch = exactTitleMatch || exactBodyMatch || exactTagMatch;
      const threshold = hasDirectMatch ? EXACT_MATCH_THRESHOLD : queryTerms.length > 1 ? MULTI_TERM_APPROX_THRESHOLD : SINGLE_TERM_APPROX_THRESHOLD;
      if (totalScore >= threshold) {
        results.push({
          card,
          score: totalScore,
          approximate: !hasDirectMatch,
          titleMatch: exactTitleMatch || titleScore >= 70,
          bodyMatch: exactBodyMatch || bodyScore >= 50
        });
      }
    });
    results.sort((a, b) => b.score - a.score);
    return results;
  }
  async function fuzzySearchMultiDataset(query, scope = "current") {
    if (!query || query.trim() === "") {
      return [];
    }
    const currentKey = typeof instanceKey !== "undefined" && instanceKey || "nested_cards_store";
    const currentName = store && store.metadata && store.metadata.name || currentKey;
    const MAX_RESULTS = 100;
    const searchableKeys = scope === "all" && typeof getAllDatasetKeys === "function" ? getAllDatasetKeys() : scope !== "current" && scope !== "all" ? [scope] : [currentKey];
    const allResults = [];
    for (const key of searchableKeys) {
      try {
        let datasetStore;
        let datasetName;
        if (key === currentKey) {
          datasetStore = store;
          datasetName = currentName;
        } else {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object") continue;
          if (parsed.encrypted === true && typeof parsed.payload === "string") {
            continue;
          }
          if (!parsed.cards || typeof parsed.cards !== "object") continue;
          datasetStore = { cards: parsed.cards };
          datasetName = parsed.metadata && parsed.metadata.name || key;
        }
        const results = fuzzySearchCards(datasetStore, query);
        results.forEach((result) => {
          allResults.push({
            ...result,
            datasetId: key,
            datasetName
          });
        });
      } catch (err) {
        console.warn(`Failed to search dataset ${key}:`, err);
      }
    }
    allResults.sort((a, b) => b.score - a.score);
    return allResults.slice(0, MAX_RESULTS);
  }
  class StorageDriver {
    constructor() {
      if (new.target === StorageDriver) {
        throw new Error("StorageDriver is an abstract class");
      }
    }
    async init(config) {
      throw new Error("init() must be implemented");
    }
    async get(key) {
      throw new Error("get() must be implemented");
    }
    async set(key, value) {
      throw new Error("set() must be implemented");
    }
    async remove(key) {
      throw new Error("remove() must be implemented");
    }
    async list(prefix) {
      throw new Error("list() must be implemented");
    }
    async getSize() {
      throw new Error("getSize() must be implemented");
    }
    getKind() {
      throw new Error("getKind() must be implemented");
    }
  }
  class IndexedDBDriver extends StorageDriver {
    constructor() {
      super();
      this.dbName = "CardSpokeDB";
      this.storeName = "datasets";
      this.db = null;
    }
    async init(config = {}) {
      this.dbName = config.dbName || "CardSpokeDB";
      this.storeName = config.storeName || "datasets";
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          this.db = request.result;
          resolve();
        };
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };
      });
    }
    async get(key) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], "readonly");
        const store2 = transaction.objectStore(this.storeName);
        const request = store2.get(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    }
    async set(key, value) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], "readwrite");
        const store2 = transaction.objectStore(this.storeName);
        const request = store2.put(value, key);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
        transaction.onerror = () => reject(transaction.error);
      });
    }
    async remove(key) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], "readwrite");
        const store2 = transaction.objectStore(this.storeName);
        const request = store2.delete(key);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
        transaction.onerror = () => reject(transaction.error);
      });
    }
    async list(prefix = "") {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], "readonly");
        const store2 = transaction.objectStore(this.storeName);
        const request = store2.getAllKeys();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const keys = request.result;
          const filtered = prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
          resolve(filtered);
        };
      });
    }
    async getSize() {
      const keys = await this.list();
      let totalSize = 0;
      for (const key of keys) {
        const value = await this.get(key);
        if (value) {
          totalSize += JSON.stringify(value).length;
        }
      }
      return totalSize;
    }
    getKind() {
      return "indexeddb";
    }
  }
  class LocalStorageDriver extends StorageDriver {
    constructor() {
      super();
      this.prefix = "cardspoke_";
    }
    async init(config = {}) {
      this.prefix = config.prefix || "cardspoke_";
      return Promise.resolve();
    }
    async get(key) {
      const fullKey = this.prefix + key;
      const value = localStorage.getItem(fullKey);
      return value ? JSON.parse(value) : null;
    }
    async set(key, value) {
      const fullKey = this.prefix + key;
      localStorage.setItem(fullKey, JSON.stringify(value));
      return Promise.resolve();
    }
    async remove(key) {
      const fullKey = this.prefix + key;
      localStorage.removeItem(fullKey);
      return Promise.resolve();
    }
    async list(prefix = "") {
      const keys = [];
      const searchPrefix = this.prefix + prefix;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(searchPrefix)) {
          keys.push(key.substring(this.prefix.length));
        }
      }
      return keys;
    }
    async getSize() {
      const keys = await this.list();
      let totalSize = 0;
      for (const key of keys) {
        const fullKey = this.prefix + key;
        const value = localStorage.getItem(fullKey);
        if (value) {
          totalSize += value.length;
        }
      }
      return totalSize;
    }
    getKind() {
      return "localstorage";
    }
  }
  class LocalFileDriver extends StorageDriver {
    constructor() {
      super();
      this.fileHandle = null;
      this.fileName = "cardspoke.json";
      this.handleKey = "cardspoke_localfile_handle";
      this.isNative = false;
      this.nativeFilePath = null;
    }
    async init(config = {}) {
      this.fileName = config.fileName || "cardspoke.json";
      this.handleKey = config.handleKey || "cardspoke_localfile_handle";
      this.isNative = typeof window.Capacitor !== "undefined" && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform();
      if (this.isNative) {
        const { Filesystem } = window.Capacitor.Plugins;
        if (!Filesystem) {
          throw new Error("Capacitor Filesystem plugin not available");
        }
        this.nativeFilePath = this.fileName;
      } else {
        await this.restoreHandle();
      }
      return Promise.resolve();
    }
    async restoreHandle() {
      try {
        const db = await this.openHandleDB();
        const handle = await this.getHandleFromDB(db);
        if (handle) {
          const permission = await handle.queryPermission({ mode: "readwrite" });
          if (permission === "granted") {
            this.fileHandle = handle;
          }
        }
      } catch (error) {
        console.warn("Could not restore file handle:", error);
      }
    }
    async openHandleDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open("CardSpokeFileHandles", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains("handles")) {
            db.createObjectStore("handles");
          }
        };
      });
    }
    async getHandleFromDB(db) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["handles"], "readonly");
        const store2 = transaction.objectStore("handles");
        const request = store2.get(this.handleKey);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    }
    async saveHandleToDB(handle) {
      const db = await this.openHandleDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["handles"], "readwrite");
        const store2 = transaction.objectStore("handles");
        const request = store2.put(handle, this.handleKey);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }
    async ensureHandle() {
      if (this.isNative) {
        return;
      }
      if (!this.fileHandle) {
        if (!("showSaveFilePicker" in window)) {
          throw new Error("File System Access API not supported in this browser. Please use Chrome, Edge, or another compatible browser.");
        }
        try {
          this.fileHandle = await window.showSaveFilePicker({
            suggestedName: this.fileName,
            types: [{
              description: "CardSpoke Data File",
              accept: { "application/json": [".json"] }
            }]
          });
          await this.saveHandleToDB(this.fileHandle);
        } catch (error) {
          if (error.name === "AbortError") {
            throw new Error("File selection cancelled by user");
          }
          throw error;
        }
      }
    }
    async readFile() {
      if (this.isNative) {
        const { Filesystem, Directory } = window.Capacitor.Plugins;
        try {
          const result = await Filesystem.readFile({
            path: this.nativeFilePath,
            directory: Directory.Documents,
            encoding: "utf8"
          });
          const text = result.data || "";
          if (!text.trim()) {
            return {};
          }
          try {
            return JSON.parse(text);
          } catch (parseError) {
            console.error("Failed to parse file content:", parseError);
            throw new Error("Invalid JSON in file");
          }
        } catch (error) {
          if (error.code === "NOT_FOUND" || error.message && error.message.toLowerCase().includes("not exist")) {
            return {};
          }
          throw error;
        }
      } else {
        await this.ensureHandle();
        const file = await this.fileHandle.getFile();
        const text = await file.text();
        if (!text.trim()) {
          return {};
        }
        try {
          return JSON.parse(text);
        } catch (parseError) {
          console.error("Failed to parse file content:", parseError);
          throw new Error("Invalid JSON in file");
        }
      }
    }
    async writeFile(data) {
      if (this.isNative) {
        const { Filesystem, Directory } = window.Capacitor.Plugins;
        await Filesystem.writeFile({
          path: this.nativeFilePath,
          data: JSON.stringify(data, null, 2),
          directory: Directory.Documents,
          encoding: "utf8"
        });
      } else {
        await this.ensureHandle();
        const writable = await this.fileHandle.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
      }
    }
    async get(key) {
      try {
        const data = await this.readFile();
        return data[key] || null;
      } catch (error) {
        console.error("LocalFile get error:", error);
        showToast("Failed to read from local file: " + error.message, "error");
        return null;
      }
    }
    async set(key, value) {
      try {
        const data = await this.readFile();
        data[key] = value;
        await this.writeFile(data);
      } catch (error) {
        console.error("LocalFile set error:", error);
        showToast("Failed to save to local file: " + error.message, "error");
        throw error;
      }
    }
    async remove(key) {
      try {
        const data = await this.readFile();
        delete data[key];
        await this.writeFile(data);
      } catch (error) {
        console.error("LocalFile remove error:", error);
        showToast("Failed to remove from local file: " + error.message, "error");
        throw error;
      }
    }
    async list(prefix = "") {
      try {
        const data = await this.readFile();
        const keys = Object.keys(data);
        return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
      } catch (error) {
        console.error("LocalFile list error:", error);
        return [];
      }
    }
    async getSize() {
      try {
        if (this.isNative) {
          const { Filesystem, Directory } = window.Capacitor.Plugins;
          const stat = await Filesystem.stat({
            path: this.nativeFilePath,
            directory: Directory.Documents
          });
          return stat.size;
        } else {
          await this.ensureHandle();
          const file = await this.fileHandle.getFile();
          return file.size;
        }
      } catch (error) {
        console.error("LocalFile getSize error:", error);
        return 0;
      }
    }
    getKind() {
      return "localfile";
    }
  }
  class DatasetManager {
    constructor() {
      this.datasets = /* @__PURE__ */ new Map();
      this.activeDatasetId = null;
      this.metadataKey = "cardspoke_dataset_metadata";
    }
    async init() {
      const metadataJson = localStorage.getItem(this.metadataKey);
      if (metadataJson) {
        const metadata = JSON.parse(metadataJson);
        this.activeDatasetId = metadata.activeDatasetId;
        for (const [id, meta] of Object.entries(metadata.datasets || {})) {
          const driver = await this.createDriver(meta.storage.driver, meta.storage.config);
          this.datasets.set(id, {
            id,
            name: meta.name,
            driver,
            pin: null,
            hasPin: !!(meta.hasPin || meta.pin),
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt
          });
        }
      }
      if (this.datasets.size === 0) {
        await this.createDataset("Default", "localstorage");
      }
    }
    async createDriver(kind, config = {}) {
      let driver;
      switch (kind) {
        case "indexeddb":
          driver = new IndexedDBDriver();
          break;
        case "localfile":
          driver = new LocalFileDriver();
          break;
        case "localstorage":
        default:
          driver = new LocalStorageDriver();
          break;
      }
      await driver.init(config);
      return driver;
    }
    async createDataset(name, storageKind = "localstorage", pin = null) {
      const id = "dataset_" + Date.now();
      const driver = await this.createDriver(storageKind, {
        dbName: `CardSpokeDB_${id}`,
        prefix: `cardspoke_${id}_`
      });
      const dataset = {
        id,
        name,
        driver,
        pin,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.datasets.set(id, dataset);
      if (!this.activeDatasetId) {
        this.activeDatasetId = id;
      }
      await this.saveMetadata();
      return dataset;
    }
    async saveMetadata() {
      const metadata = {
        activeDatasetId: this.activeDatasetId,
        datasets: {}
      };
      for (const [id, dataset] of this.datasets) {
        metadata.datasets[id] = {
          name: dataset.name,
          storage: {
            driver: dataset.driver.getKind(),
            config: {}
          },
          // Never persist the PIN itself — only whether one exists.
          hasPin: !!(dataset.pin || dataset.hasPin),
          createdAt: dataset.createdAt,
          updatedAt: dataset.updatedAt
        };
      }
      localStorage.setItem(this.metadataKey, JSON.stringify(metadata));
    }
    getActiveDataset() {
      return this.datasets.get(this.activeDatasetId);
    }
    async switchDataset(datasetId, pin = null) {
      const dataset = this.datasets.get(datasetId);
      if (!dataset) {
        throw new Error("Dataset not found");
      }
      if (dataset.pin && dataset.pin !== pin) {
        throw new Error("Invalid PIN");
      }
      this.activeDatasetId = datasetId;
      await this.saveMetadata();
      return dataset;
    }
    async deleteDataset(datasetId) {
      if (this.datasets.size <= 1) {
        throw new Error("Cannot delete the last dataset");
      }
      const dataset = this.datasets.get(datasetId);
      if (!dataset) {
        throw new Error("Dataset not found");
      }
      const keys = await dataset.driver.list();
      for (const key of keys) {
        await dataset.driver.remove(key);
      }
      this.datasets.delete(datasetId);
      if (this.activeDatasetId === datasetId) {
        this.activeDatasetId = this.datasets.keys().next().value;
      }
      await this.saveMetadata();
    }
    async getDatasetInfo(datasetId) {
      const dataset = this.datasets.get(datasetId || this.activeDatasetId);
      if (!dataset) {
        throw new Error("Dataset not found");
      }
      const size = await dataset.driver.getSize();
      const keys = await dataset.driver.list();
      return {
        id: dataset.id,
        name: dataset.name,
        storageKind: dataset.driver.getKind(),
        hasPIN: !!(dataset.pin || dataset.hasPin),
        size,
        sizeFormatted: this.formatBytes(size),
        itemCount: keys.length,
        createdAt: new Date(dataset.createdAt).toLocaleString(),
        updatedAt: new Date(dataset.updatedAt).toLocaleString()
      };
    }
    formatBytes(bytes) {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
    }
    listDatasets() {
      return Array.from(this.datasets.values()).map((d) => ({
        id: d.id,
        name: d.name,
        storageKind: d.driver.getKind(),
        hasPIN: !!(d.pin || d.hasPin),
        isActive: d.id === this.activeDatasetId
      }));
    }
  }
  let datasetManager = null;
  let saveTimeout = null;
  let savePending = false;
  let saveRevision = 0;
  let saveEpoch = 0;
  let saveWriteQueue = Promise.resolve();
  let lastSaveTime = 0;
  const SAVE_DEBOUNCE_MS = 500;
  const MIN_SAVE_INTERVAL_MS = 100;
  let indexedDbMirrorDriver = null;
  async function getIndexedDbMirrorDriver() {
    if (indexedDbMirrorDriver) return indexedDbMirrorDriver;
    const driver = new IndexedDBDriver();
    await driver.init({ dbName: "CardSpokeDB", storeName: "datasets" });
    indexedDbMirrorDriver = driver;
    return indexedDbMirrorDriver;
  }
  function isIndexedDbDataset() {
    return !!(store && store.metadata && store.metadata.storageType === "indexeddb");
  }
  function getStorageType() {
    return store && store.metadata && store.metadata.storageType || "localstorage";
  }
  function supportsFileSystemAccess() {
    return typeof window.showSaveFilePicker === "function";
  }
  function getDatasetFileHandleKey() {
    const key = instanceKey || "nested_cards_store";
    return store.metadata && store.metadata.storageConfig && store.metadata.storageConfig.handleKey || `cardspoke_file_handle_${key}`;
  }
  async function openFileHandleDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("CardSpokeFileHandles", 1);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles");
      };
      req.onsuccess = () => resolve(req.result);
    });
  }
  async function saveDatasetFileHandle(handleKey, handle) {
    const db = await openFileHandleDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["handles"], "readwrite");
      tx.objectStore("handles").put(handle, handleKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function loadDatasetFileHandle(handleKey) {
    const db = await openFileHandleDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["handles"], "readonly");
      const req = tx.objectStore("handles").get(handleKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function ensureLocalFileHandle() {
    if (!supportsFileSystemAccess()) {
      throw new Error("File System Access API is not supported in this browser/runtime");
    }
    const handleKey = getDatasetFileHandleKey();
    let handle = await loadDatasetFileHandle(handleKey);
    if (!handle) {
      const suggestedName = (store.metadata && store.metadata.name || "cardspoke-dataset").replace(/\s+/g, "-").toLowerCase() + ".json";
      handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "JSON Dataset", accept: { "application/json": [".json"] } }]
      });
      await saveDatasetFileHandle(handleKey, handle);
    }
    if (store.metadata && store.metadata.storageConfig) {
      store.metadata.storageConfig.handleKey = handleKey;
      store.metadata.storageConfig.fileName = handle.name || "dataset.json";
    }
    return handle;
  }
  async function writeDatasetToLocalFile(payload) {
    if (getStorageType() !== "localfile") return;
    const handle = await ensureLocalFileHandle();
    const writable = await handle.createWritable();
    await writable.write(payload);
    await writable.close();
  }
  async function readDatasetFromLocalFile() {
    if (getStorageType() !== "localfile") return null;
    const handle = await ensureLocalFileHandle();
    const file = await handle.getFile();
    const text = await file.text();
    return text || null;
  }
  let activeSessionPin = null;
  let storageWriteLock = false;
  function setSessionPin(pin) {
    activeSessionPin = pin || null;
  }
  function getSessionPin() {
    return activeSessionPin;
  }
  function isStorageWriteLocked() {
    return storageWriteLock;
  }
  function hashPayload(str) {
    let h2 = 0;
    for (let i = 0; i < str.length; i++) {
      h2 = Math.imul(31, h2) + str.charCodeAt(i) | 0;
    }
    return (h2 >>> 0).toString(36);
  }
  function stripLegacyPinMetadata() {
    if (store && store.metadata && store.metadata.pin) {
      if (!activeSessionPin) activeSessionPin = store.metadata.pin;
      delete store.metadata.pin;
      return true;
    }
    return false;
  }
  function validateStoreConsistency() {
    if (!store || !store.cards || typeof store.cards !== "object") return false;
    let changed = false;
    const cards = store.cards;
    const ids = new Set(Object.keys(cards));
    Object.values(cards).forEach((card) => {
      if (!Array.isArray(card.children)) {
        card.children = [];
        changed = true;
      }
      card.children = card.children.filter((cid) => ids.has(cid));
    });
    Object.values(cards).forEach((card) => {
      if (card.parentId && !cards[card.parentId]) {
        card.parentId = null;
        changed = true;
      }
    });
    const visiting = /* @__PURE__ */ new Set();
    const visited = /* @__PURE__ */ new Set();
    const breakCycle = (id) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        cards[id].parentId = null;
        changed = true;
        return;
      }
      visiting.add(id);
      const parentId = cards[id] && cards[id].parentId;
      if (parentId && cards[parentId]) breakCycle(parentId);
      visiting.delete(id);
      visited.add(id);
    };
    Object.keys(cards).forEach(breakCycle);
    Object.values(cards).forEach((card) => {
      if (card.parentId && cards[card.parentId] && !cards[card.parentId].children.includes(card.id)) {
        cards[card.parentId].children.push(card.id);
        changed = true;
      }
    });
    const computedRoots = Object.values(cards).filter((card) => !card.parentId).map((card) => card.id);
    const existingRootOrder = Array.isArray(store.rootOrder) ? store.rootOrder : [];
    const cleanedRootOrder = existingRootOrder.filter((id) => cards[id] && !cards[id].parentId);
    computedRoots.forEach((id) => {
      if (!cleanedRootOrder.includes(id)) {
        cleanedRootOrder.push(id);
        changed = true;
      }
    });
    if (cleanedRootOrder.length !== existingRootOrder.length || !cleanedRootOrder.every((id, i) => id === existingRootOrder[i])) {
      store.rootOrder = cleanedRootOrder;
      changed = true;
    }
    return changed;
  }
  function migrateTypedCards() {
    try {
      const result = migrateStore(store);
      result.warnings.forEach((w) => console.warn("[TypedCards]", w));
      return result.changed;
    } catch (err) {
      console.error("[TypedCards] Migration failed (data left untouched):", err);
      return false;
    }
  }
  async function saveNow() {
    const savingStore = store;
    const savingKey = instanceKey;
    try {
      if (storageWriteLock) {
        savePending = false;
        updateSaveStatus("locked");
        return;
      }
      if (window.CardSpoke && window.CardSpoke.Middleware) {
        try {
          const result = await window.CardSpoke.Middleware.run("card.save", [store]);
          if (result && result.prevented) {
            savePending = true;
            return;
          }
        } catch (err) {
          console.error("[Middleware] card.save pipeline error:", err);
        }
      }
      if (store !== savingStore || instanceKey !== savingKey || storageWriteLock) return;
      const key = instanceKey || "nested_cards_store";
      const startTime = performance.now();
      if (!store.metadata) store.metadata = {};
      store.metadata.navState = { ...navState };
      store.metadata.navHistory = Array.isArray(navHistory) ? navHistory.slice(-100) : [];
      const doSave = async () => {
        try {
          await persistStoreNow(key);
          const duration = performance.now() - startTime;
          if (!savePending && store === savingStore) {
            updateSaveStatus("saved");
            setTimeout(() => {
              if (!savePending && store === savingStore) updateSaveStatus("idle");
            }, 1e3);
          }
          console.log(`Saved in ${duration.toFixed(2)}ms`);
        } catch (e) {
          savePending = true;
          if (isQuotaError(e)) {
            showToast("Storage quota exceeded! Please clear old data or export your cards.", "error");
          } else {
            showToast("Failed to save: " + e.message, "error");
          }
          updateSaveStatus("error");
        }
      };
      await doSave();
    } catch (e) {
      showToast("Failed to save: " + e.message, "error");
      savePending = true;
      updateSaveStatus("error");
    }
  }
  async function persistStoreNow(key) {
    stripLegacyPinMetadata();
    const payload = JSON.stringify(store);
    const activePin = activeSessionPin;
    const revision = saveRevision;
    const epoch = saveEpoch;
    const storageType = getStorageType();
    const fileHandle = storageType === "localfile" ? ensureLocalFileHandle() : null;
    if (fileHandle) fileHandle.catch(() => {
    });
    const write = async () => {
      const finalPayload = activePin ? await encryptStorePayload(payload, activePin) : payload;
      if (epoch !== saveEpoch) return;
      localStorage.setItem(key, finalPayload);
      if (storageType === "indexeddb") {
        const driver = await getIndexedDbMirrorDriver();
        await driver.set(key, finalPayload);
      }
      if (fileHandle) {
        const handle = await fileHandle;
        if (epoch !== saveEpoch) return;
        const writable = await handle.createWritable();
        await writable.write(finalPayload);
        await writable.close();
      }
      lastSaveTime = Date.now();
      if (revision === saveRevision && epoch === saveEpoch) {
        savePending = false;
        if (typeof setDirty === "function") setDirty(false);
      }
    };
    const result = saveWriteQueue.then(write);
    saveWriteQueue = result.catch(() => {
    });
    return result;
  }
  function isQuotaError(e) {
    return !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
  }
  async function flushPendingSave() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    await saveWriteQueue;
    if (!savePending) return;
    if (storageWriteLock) {
      savePending = false;
      return;
    }
    const key = instanceKey || "nested_cards_store";
    if (!store.metadata) store.metadata = {};
    store.metadata.navState = { ...navState };
    store.metadata.navHistory = Array.isArray(navHistory) ? navHistory.slice(-100) : [];
    try {
      await persistStoreNow(key);
    } catch (e) {
      console.error("[Storage] Flush-before-switch save failed:", e);
      if (isQuotaError(e)) {
        showToast("Storage quota exceeded! Please clear old data or export your cards.", "error");
      } else {
        showToast("Failed to save: " + e.message, "error");
      }
      updateSaveStatus("error");
      throw e;
    }
  }
  function cancelPendingSave() {
    saveEpoch++;
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    savePending = false;
  }
  function save(immediate = false) {
    saveRevision++;
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    if (storageWriteLock) {
      savePending = false;
      updateSaveStatus("locked");
      return;
    }
    if (immediate) {
      savePending = true;
      saveNow();
      return;
    }
    const timeSinceLastSave = Date.now() - lastSaveTime;
    if (timeSinceLastSave < MIN_SAVE_INTERVAL_MS) {
      savePending = true;
      updateSaveStatus("pending");
      saveTimeout = setTimeout(saveNow, Math.max(SAVE_DEBOUNCE_MS, MIN_SAVE_INTERVAL_MS - timeSinceLastSave));
      return;
    }
    savePending = true;
    updateSaveStatus("pending");
    saveTimeout = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }
  function updateSaveStatus(status) {
    const indicator = document.getElementById("saveStatus");
    if (!indicator) return;
    indicator.className = "save-status " + status;
    const now = /* @__PURE__ */ new Date();
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    switch (status) {
      case "pending":
        indicator.textContent = "Saving…";
        indicator.title = `Saving… (${timeStr})`;
        break;
      case "saved":
        indicator.textContent = "Saved";
        indicator.title = `Last saved at ${timeStr}`;
        break;
      case "error":
        indicator.textContent = "Save failed";
        indicator.title = `Save failed at ${timeStr}`;
        break;
      case "locked":
        indicator.textContent = "Not saved — dataset locked";
        indicator.title = "Changes are not being saved while the dataset is locked";
        break;
      default:
        indicator.textContent = "";
        indicator.title = "";
    }
  }
  async function clearAllData() {
    if (!await showConfirmDialog("WARNING: This will DELETE ALL instances and data from localStorage.\n\nThis action CANNOT be undone!\n\nAre you absolutely sure?", {
      title: "Delete All Data",
      confirmLabel: "Continue",
      cancelLabel: "Cancel",
      confirmClassName: "btn btn-danger"
    })) {
      return;
    }
    if (!await showConfirmDialog("This is your FINAL warning.\n\nAll card data, all instances, and all settings will be permanently deleted.\n\nContinue?", {
      title: "Final Warning",
      confirmLabel: "Delete Everything",
      cancelLabel: "Cancel",
      confirmClassName: "btn btn-danger"
    })) {
      return;
    }
    try {
      const allKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        allKeys.push(key);
      }
      localStorage.clear();
      showToast(`Cleared ${allKeys.length} items from localStorage`, "success");
      setTimeout(() => {
        location.reload();
      }, 1e3);
    } catch (e) {
      showToast("Failed to clear data: " + e.message, "error");
    }
  }
  async function unlockEncryptedDataset(rawEnvelope) {
    if (activeSessionPin) {
      try {
        return await decryptStorePayload(rawEnvelope, activeSessionPin);
      } catch (_err) {
        activeSessionPin = null;
      }
    }
    if (typeof showPromptDialog !== "function" || typeof document === "undefined" || !document.body) {
      return null;
    }
    let attempt = 0;
    for (; ; ) {
      const pin = await showPromptDialog({
        title: "Unlock Encrypted Dataset",
        message: attempt === 0 ? "This dataset is protected with a PIN. Enter it to unlock your cards. Your data stays untouched until the correct PIN is entered." : "Incorrect PIN. Please try again.",
        label: "PIN",
        type: "password",
        confirmLabel: "Unlock",
        cancelLabel: "Not now"
      });
      if (pin === null || pin === void 0) return null;
      if (!pin.trim()) {
        attempt++;
        continue;
      }
      try {
        const decrypted = await decryptStorePayload(rawEnvelope, pin);
        activeSessionPin = pin;
        return decrypted;
      } catch (err) {
        console.warn("[Dataset] Unlock attempt failed");
        attempt++;
      }
    }
  }
  function showDatasetLockScreen(key) {
    if (typeof document === "undefined" || !document.body) return;
    const existing = document.getElementById("datasetLockScreen");
    if (existing) existing.remove();
    const overlay = h("div", { id: "datasetLockScreen", className: "modal-overlay show", "data-a11y-managed": "true" });
    const modal = h("div", {
      className: "modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "datasetLockTitle",
      style: "max-width: 480px;"
    });
    const header2 = h("div", { className: "modal-header" });
    header2.appendChild(h("div", { className: "modal-title", id: "datasetLockTitle" }, "Dataset Locked"));
    modal.appendChild(header2);
    const body = h("div", { className: "modal-body" });
    body.appendChild(h(
      "p",
      { style: "margin-bottom: var(--space-lg);" },
      "This dataset is encrypted and has not been unlocked. Your data is safe: nothing will be saved over it while it stays locked."
    ));
    const actions = h("div", { style: "display: flex; gap: var(--space-sm); flex-wrap: wrap;" });
    actions.appendChild(h("button", {
      className: "btn btn-primary",
      onclick: async () => {
        overlay.remove();
        await load();
        render();
      }
    }, "Unlock"));
    actions.appendChild(h("button", {
      className: "btn",
      onclick: () => {
        const payload = localStorage.getItem(key);
        if (payload && typeof downloadWithFeedback === "function") {
          downloadWithFeedback(payload, key + "-encrypted-backup.json", "application/json");
        }
      }
    }, "Download encrypted backup"));
    actions.appendChild(h("button", {
      className: "btn",
      onclick: () => {
        if (typeof showDatasetManager === "function") showDatasetManager();
      }
    }, "Switch dataset"));
    body.appendChild(actions);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    if (typeof trapFocus === "function") trapFocus(modal);
  }
  function showCorruptDataRecovery(key, raw, quarantineKey) {
    if (typeof document === "undefined" || !document.body) return;
    const existing = document.getElementById("corruptRecoveryScreen");
    if (existing) existing.remove();
    const overlay = h("div", { id: "corruptRecoveryScreen", className: "modal-overlay show", "data-a11y-managed": "true" });
    const modal = h("div", {
      className: "modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "corruptRecoveryTitle",
      style: "max-width: 560px;"
    });
    const header2 = h("div", { className: "modal-header" });
    header2.appendChild(h("div", { className: "modal-title", id: "corruptRecoveryTitle" }, "Stored Data Could Not Be Read"));
    modal.appendChild(header2);
    const body = h("div", { className: "modal-body" });
    body.appendChild(h(
      "p",
      { style: "margin-bottom: var(--space-md);" },
      "The saved data for this dataset could not be parsed. The original data has NOT been changed or deleted."
    ));
    if (quarantineKey) {
      body.appendChild(h(
        "p",
        { style: "margin-bottom: var(--space-md); color: var(--text-muted); font-size: var(--text-sm);" },
        'A recovery copy was also stored under the key "' + quarantineKey + '".'
      ));
    }
    body.appendChild(h(
      "p",
      { style: "margin-bottom: var(--space-lg);" },
      'Download a copy of the raw data before deciding how to continue. Nothing will be overwritten until you explicitly choose "Start fresh".'
    ));
    const actions = h("div", { style: "display: flex; gap: var(--space-sm); flex-wrap: wrap;" });
    actions.appendChild(h("button", {
      className: "btn btn-primary",
      onclick: () => {
        if (typeof downloadWithFeedback === "function") {
          const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
          downloadWithFeedback(raw, key + "-recovered-" + stamp + ".json", "application/json");
        }
      }
    }, "Download raw data"));
    actions.appendChild(h("button", {
      className: "btn",
      onclick: () => location.reload()
    }, "Try again"));
    actions.appendChild(h("button", {
      className: "btn btn-danger",
      onclick: async () => {
        const confirmed = typeof showConfirmDialog === "function" ? await showConfirmDialog(
          "Replace the unreadable data with a new empty dataset?\n\n" + (quarantineKey ? 'The quarantined recovery copy will be kept under "' + quarantineKey + '".' : "Download the raw data first if you have not already — this overwrites the active key."),
          {
            title: "Start Fresh",
            confirmLabel: "Start Fresh",
            cancelLabel: "Cancel",
            confirmClassName: "btn btn-danger"
          }
        ) : false;
        if (!confirmed) return;
        storageWriteLock = false;
        setStore(createDefaultStore());
        overlay.remove();
        save(true);
        render();
        showToast("Started a fresh dataset. The previous data remains quarantined.", "info", 6e3);
      }
    }, "Start fresh"));
    body.appendChild(actions);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    if (typeof trapFocus === "function") trapFocus(modal);
  }
  async function load() {
    const key = instanceKey || "nested_cards_store";
    let raw = localStorage.getItem(key);
    storageWriteLock = false;
    if (Array.isArray(undoStack)) undoStack.length = 0;
    if (Array.isArray(redoStack)) redoStack.length = 0;
    if (Array.isArray(trashBin)) trashBin.length = 0;
    if (typeof document !== "undefined") {
      const staleLock = document.getElementById("datasetLockScreen");
      if (staleLock) staleLock.remove();
      const staleRecovery = document.getElementById("corruptRecoveryScreen");
      if (staleRecovery) staleRecovery.remove();
    }
    if (!raw) {
      activeSessionPin = null;
      setStore(createDefaultStore());
      save();
      return;
    }
    let envelope = null;
    try {
      const probe = JSON.parse(raw);
      if (isEncryptedEnvelope(probe)) envelope = probe;
    } catch (_probeErr) {
    }
    if (envelope) {
      const decrypted = await unlockEncryptedDataset(raw);
      if (decrypted === null) {
        storageWriteLock = true;
        setStore(createDefaultStore());
        updateSaveStatus("locked");
        showDatasetLockScreen(key);
        return;
      }
      raw = decrypted;
    } else if (activeSessionPin) {
      activeSessionPin = null;
    }
    try {
      const parsed = JSON.parse(raw);
      setStore({
        rootOrder: parsed.rootOrder || [],
        cards: parsed.cards || {},
        plugins: parsed.plugins || {},
        bookmarks: parsed.bookmarks || [],
        recentCards: parsed.recentCards || [],
        viewMode: parsed.viewMode || "normal",
        activeTheme: parsed.activeTheme || "light",
        metadata: parsed.metadata || {}
      });
      if (store.metadata && store.metadata.navState) {
        setNavState({ ...navState, ...store.metadata.navState });
      }
      if (store.metadata && Array.isArray(store.metadata.navHistory)) {
        setNavHistory(store.metadata.navHistory.slice(-100));
      }
      const pinMigrated = stripLegacyPinMetadata();
      const repaired = validateStoreConsistency();
      const typedChanged = migrateTypedCards();
      if (repaired || typedChanged || pinMigrated) {
        save();
        if (repaired) showToast("Data integrity check repaired structural metadata", "info");
      }
      const storageType = getStorageType();
      if (storageType === "localfile") {
        await readDatasetFromLocalFile().then(async (payload) => {
          if (!payload) return;
          let parsedFile = JSON.parse(payload);
          if (isEncryptedEnvelope(parsedFile)) {
            if (!activeSessionPin) return;
            try {
              parsedFile = JSON.parse(await decryptStorePayload(parsedFile, activeSessionPin));
            } catch (_fileErr) {
              console.warn("[Local File] Payload could not be decrypted; skipping");
              return;
            }
          }
          if (!parsedFile || typeof parsedFile !== "object") return;
          setStore({
            rootOrder: parsedFile.rootOrder || [],
            cards: parsedFile.cards || {},
            plugins: parsedFile.plugins || {},
            bookmarks: parsedFile.bookmarks || [],
            recentCards: parsedFile.recentCards || [],
            viewMode: parsedFile.viewMode || "normal",
            activeTheme: parsedFile.activeTheme || "light",
            metadata: parsedFile.metadata || store.metadata
          });
          if (store.metadata && store.metadata.navState) setNavState({ ...navState, ...store.metadata.navState });
          if (store.metadata && Array.isArray(store.metadata.navHistory)) setNavHistory(store.metadata.navHistory.slice(-100));
          const filePinMigrated = stripLegacyPinMetadata();
          const fileRepaired = validateStoreConsistency();
          const fileTypedChanged = migrateTypedCards();
          if (fileRepaired || fileTypedChanged || filePinMigrated) save();
          if (window.CardSpoke && window.CardSpoke.Plugin && window.CardSpoke.Plugin.syncFromStore) {
            window.CardSpoke.Plugin.syncFromStore().catch((err) => console.error("[Plugin] Re-sync after local-file load failed:", err));
          }
          render();
        }).catch((err) => {
          console.error("[Local File] Load failed, using LocalStorage fallback:", err);
        });
      }
    } catch (e) {
      console.error("[CardSpoke] Failed to parse stored data — entering recovery mode:", e);
      let quarantineKey = null;
      try {
        quarantineKey = key + ".corrupt." + hashPayload(raw);
        localStorage.setItem(quarantineKey, raw);
      } catch (quarantineErr) {
        quarantineKey = null;
        console.error("[CardSpoke] Could not quarantine corrupt payload:", quarantineErr);
      }
      storageWriteLock = true;
      setStore(createDefaultStore());
      updateSaveStatus("locked");
      showCorruptDataRecovery(key, raw, quarantineKey);
      if (typeof showToast === "function") {
        showToast("Stored data could not be read. Recovery options are shown — nothing has been overwritten.", "warning", 8e3);
      }
    }
  }
  function goTo(page, opts = {}) {
    navHistory.push({ ...navState });
    setNavState({
      // Mode-aware routing: missing mode defaults to the full CardSpoke
      // experience so existing pages/routes stay backward compatible.
      mode: opts.mode ?? navState.mode ?? "cardspoke",
      page,
      cardId: opts.cardId ?? null,
      parentId: opts.parentId ?? null,
      searchQuery: opts.searchQuery ?? ""
    });
    if (page === "read" && opts.cardId) {
      addToRecentCards(opts.cardId);
    }
    render();
    if (typeof window.scrollTo === "function") window.scrollTo(0, 0);
  }
  function goBack() {
    if (navHistory.length) {
      setNavState(navHistory.pop());
      render();
    }
  }
  Object.assign(window.CardSpoke && window.CardSpoke.utils || {}, {
    createCard: async function(data) {
      data = data || {};
      var title = data.title || "";
      var body = data.body || "";
      var parentId = data.parentId || null;
      var tags = data.tags || [];
      var cardId = createCard(title, body, parentId, false, false);
      if (tags.length > 0) tags.forEach(function(tag) {
        addTag(cardId, tag, true);
      });
      save();
      render();
      return { id: cardId, card: cloneCard(store.cards[cardId]) };
    },
    updateCard: async function(cardId, changes) {
      changes = changes || {};
      if (!cardId) throw new Error("cardId is required");
      if (!store.cards[cardId]) throw new Error("Card " + cardId + " not found");
      var tags = changes.tags;
      var otherChanges = Object.assign({}, changes);
      delete otherChanges.tags;
      if (Object.keys(otherChanges).length > 0) updateCard(cardId, otherChanges, false, false);
      if (tags !== void 0) setTags(cardId, tags, false);
      return true;
    },
    getTags: async function(cardId) {
      return getTags(cardId);
    },
    addTag: async function(cardId, tag) {
      return addTag(cardId, tag, false);
    },
    removeTag: async function(cardId, tag) {
      return removeTag(cardId, tag, false);
    },
    setTags: async function(cardId, tags) {
      return setTags(cardId, tags, false);
    },
    getAllTags: async function() {
      return getAllTags();
    },
    showToast: async function(message, type, duration) {
      showToast(message, type || "info", duration || 3e3);
    },
    getDatasetMeta: async function() {
      return {
        name: instanceKey,
        cardCount: Object.keys(store.cards).length,
        rootCardCount: store.rootOrder.length,
        bookmarkCount: (store.bookmarks || []).length,
        recentCount: (store.recentCards || []).length,
        modCount: Object.keys(store.plugins || {}).length,
        schemaVersion: SCHEMA_VERSION,
        appVersion: APP_VERSION
      };
    },
    getCard: async function(cardId) {
      if (!cardId) return null;
      var card = store.cards[cardId];
      return card ? cloneCard(card) : null;
    },
    searchCards: async function(query) {
      if (!query) return [];
      var lowerQuery = query.toLowerCase();
      var results = [];
      for (var id in store.cards) {
        var card = store.cards[id];
        if (card.title.toLowerCase().includes(lowerQuery) || card.body.toLowerCase().includes(lowerQuery) || card.tags && card.tags.some(function(tag) {
          return tag.toLowerCase().includes(lowerQuery);
        })) {
          results.push(cloneCard(card));
        }
      }
      return results;
    },
    getAccessibilitySettings: async function() {
      return {
        theme: store.activeTheme || "light",
        typography: localStorage.getItem("cardspoke_typography") || "default",
        highContrast: document.documentElement.classList.contains("high-contrast"),
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      };
    },
    setTheme: async function(theme) {
      if (theme !== "light" && theme !== "dark") throw new Error('Theme must be "light" or "dark"');
      applyTheme(theme);
      return true;
    },
    getTheme: async function() {
      return store.activeTheme || "light";
    },
    setTypography: async function(preset) {
      var valid = ["default", "comfortable", "compact", "dyslexia"];
      if (!valid.includes(preset)) throw new Error("Preset must be one of: " + valid.join(", "));
      localStorage.setItem("cardspoke_typography", preset);
      document.documentElement.setAttribute("data-typography", preset);
      return true;
    },
    getTypography: async function() {
      return localStorage.getItem("cardspoke_typography") || "default";
    },
    setHighContrast: async function(enabled) {
      if (enabled) document.documentElement.classList.add("high-contrast");
      else document.documentElement.classList.remove("high-contrast");
      localStorage.setItem("cardspoke_highcontrast", enabled.toString());
      return true;
    },
    isHighContrast: async function() {
      return document.documentElement.classList.contains("high-contrast");
    },
    prefersReducedMotion: async function() {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    },
    getThemeVariables: async function() {
      return {
        colors: ["--bg", "--surface", "--border", "--text", "--text-medium", "--text-muted", "--text-ghost"],
        typography: ["--font", "--font-brand", "--text-xs", "--text-sm", "--text-base", "--text-lg", "--text-xl", "--text-2xl", "--text-3xl"],
        spacing: ["--space-xs", "--space-sm", "--space-md", "--space-lg", "--space-xl", "--space-2xl", "--space-3xl", "--space-4xl", "--radius"],
        accessibility: {
          highContrast: ["--hc-bg", "--hc-text", "--hc-border", "--hc-accent"],
          focus: ["--focus-outline-color", "--focus-outline-width"]
        }
      };
    }
  });
  if (isDeveloperMode()) {
    console.log("[CardSpoke.utils] API initialized and available at window.CardSpoke.utils");
  }
  const kernelCloneCard = cloneCard;
  const kernelParseCardLinks = parseCardLinks;
  const kernelNormalizeCardName = normalizeCardName;
  const kernelHasCardLink = hasCardLink;
  const kernelExtractTags = extractTags;
  const _kernel = new Kernel({ cards: store.cards, rootOrder: store.rootOrder });
  function _syncKernelToStore() {
    const snap = _kernel.snapshot();
    store.cards = snap.cards;
    store.rootOrder = snap.rootOrder;
  }
  function _syncStoreToKernel() {
    _kernel.hydrate({ cards: store.cards, rootOrder: store.rootOrder });
  }
  function createCard(title, body, parentId = null, skipSave = false, skipHooks = false) {
    _syncStoreToKernel();
    const result = _kernel.createCard(title, body, parentId);
    _syncKernelToStore();
    pushUndo("createCard", { cardId: result.id, card: result.card });
    if (!skipSave) save();
    if (!skipHooks && window.CardSpoke && window.CardSpoke.Middleware) {
      window.CardSpoke.Middleware.run("card.create", [result.id, store.cards[result.id]]).catch((err) => console.error("[Middleware] card.create error:", err));
    }
    if (!skipHooks && window.CardSpoke && window.CardSpoke.Plugin && window.CardSpoke.Plugin.notifyDataUpdate) {
      window.CardSpoke.Plugin.notifyDataUpdate({ type: "card.create", cardId: result.id, card: store.cards[result.id] });
    }
    return result.id;
  }
  function updateCard(id, updates, skipSave = false, skipHooks = false) {
    _syncStoreToKernel();
    const result = _kernel.updateCard(id, updates);
    if (!result.previousState) return;
    _syncKernelToStore();
    pushUndo("updateCard", {
      cardId: id,
      previousState: result.previousState,
      newState: result.card
    });
    if (!skipSave) save();
    if (!skipHooks && window.CardSpoke && window.CardSpoke.Middleware) {
      window.CardSpoke.Middleware.run("card.update", [id, store.cards[id]]).catch((err) => console.error("[Middleware] card.update error:", err));
    }
    if (!skipHooks && window.CardSpoke && window.CardSpoke.Plugin && window.CardSpoke.Plugin.notifyDataUpdate) {
      window.CardSpoke.Plugin.notifyDataUpdate({ type: "card.update", cardId: id, card: store.cards[id] });
    }
  }
  function deleteCard(id, opts = {}) {
    _syncStoreToKernel();
    const { skipSave = false, skipHooks = false } = opts;
    const result = _kernel.deleteCard(id);
    _syncKernelToStore();
    const groupedDelete = window.startUndoGroup && window.startUndoGroup("deleteCard");
    for (let i = result.deleted.length - 1; i >= 0; i--) {
      pushUndo("deleteCard", { card: result.deleted[i] });
    }
    if (groupedDelete && window.endUndoGroup) window.endUndoGroup();
    for (const deleted of result.deleted) {
      trashBin.unshift({ card: deleted, deletedAt: Date.now() });
      if (trashBin.length > MAX_TRASH_SIZE) trashBin.pop();
    }
    if (!skipSave) save();
    if (!skipHooks && window.CardSpoke && window.CardSpoke.Middleware) {
      window.CardSpoke.Middleware.run("card.delete", [id]).catch((err) => console.error("[Middleware] card.delete error:", err));
    }
    if (!skipHooks && window.CardSpoke && window.CardSpoke.Plugin && window.CardSpoke.Plugin.notifyDataUpdate) {
      window.CardSpoke.Plugin.notifyDataUpdate({ type: "card.delete", cardId: id });
    }
  }
  function getStorageTypeLabel(storageType) {
    switch (storageType) {
      case "indexeddb":
        return "IndexedDB";
      case "localfile":
        return "Local File (chosen location)";
      default:
        return "LocalStorage";
    }
  }
  function getAllDatasetKeys() {
    return Object.keys(localStorage).filter(
      (k) => (k === "nested_cards_store" || k.startsWith("nested_cards_") || k.startsWith("cards_")) && !k.includes(".corrupt.")
    );
  }
  function isSafeModeActive() {
    return typeof window !== "undefined" && window.location && new URLSearchParams(window.location.search).has("safemode");
  }
  async function reconcilePluginsAfterDatasetSwitch() {
    if (!(window.CardSpoke && window.CardSpoke.Plugin)) return;
    const Plugin = window.CardSpoke.Plugin;
    if (Plugin.teardownForReload) {
      for (const instance of Plugin.listAll()) {
        try {
          await Plugin.teardownForReload(instance.id);
        } catch (err) {
          console.warn("[Dataset] Plugin teardown on switch failed:", instance.id, err);
        }
      }
    }
    if (!isSafeModeActive() && Plugin.syncFromStore) {
      try {
        await Plugin.syncFromStore();
      } catch (err) {
        console.error("[Dataset] Plugin re-sync after switch failed:", err);
      }
    }
  }
  async function migrateCurrentDatasetStorage(targetStorage) {
    const currentStorage = store.metadata && store.metadata.storageType || "localstorage";
    if (targetStorage === currentStorage) {
      showToast("Dataset is already using " + getStorageTypeLabel(targetStorage), "info");
      return;
    }
    if (!store.metadata) store.metadata = {};
    if (!store.metadata.storageConfig) store.metadata.storageConfig = {};
    if (targetStorage === "indexeddb") {
      const driver = new IndexedDBDriver();
      await driver.init({ dbName: "CardSpokeDB", storeName: "datasets" });
      store.metadata.storageType = "indexeddb";
      store.metadata.storageConfig = { dbName: "CardSpokeDB", storeName: "datasets" };
      const encPayload = activeSessionPin ? await encryptStorePayload(JSON.stringify(store), activeSessionPin) : JSON.stringify(store);
      await driver.set(instanceKey, encPayload);
    } else if (targetStorage === "localfile") {
      if (typeof window.showSaveFilePicker !== "function") {
        throw new Error("Local file location selection is not supported in this environment");
      }
      store.metadata.storageType = "localfile";
      if (!store.metadata.storageConfig) store.metadata.storageConfig = {};
      const encPayload = activeSessionPin ? await encryptStorePayload(JSON.stringify(store), activeSessionPin) : JSON.stringify(store);
      await writeDatasetToLocalFile(encPayload);
    } else {
      store.metadata.storageType = "localstorage";
      store.metadata.storageConfig = {};
    }
    store.metadata.migratedAt = Date.now();
    save(true);
    showToast("Dataset storage updated to " + getStorageTypeLabel(targetStorage), "success");
  }
  function showDatasetStorageSettings() {
    const overlay = h("div", { className: "modal-overlay show" });
    const modal = h("div", { className: "modal", style: "max-width: 560px;" });
    const header2 = h("div", { className: "modal-header" });
    header2.appendChild(h("div", { className: "modal-title" }, "Dataset Storage Settings"));
    header2.appendChild(h("button", { className: "modal-close", "aria-label": "Close dialog", onclick: () => overlay.remove() }, "✕"));
    modal.appendChild(header2);
    const body = h("div", { className: "modal-body" });
    const currentStorage = store.metadata && store.metadata.storageType || "localstorage";
    body.appendChild(h(
      "p",
      { style: "margin-bottom: var(--space-md); color: var(--text-secondary);" },
      "New datasets default to LocalStorage. You can migrate this dataset to another on-device storage backend after creation."
    ));
    body.appendChild(h(
      "p",
      { style: "margin-bottom: var(--space-lg);" },
      "Current storage: " + getStorageTypeLabel(currentStorage)
    ));
    const select = h("select", {
      style: "width: 100%; padding: var(--space-md); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: var(--space-md);"
    });
    const localOpt = h("option", { value: "localstorage" }, "LocalStorage (default)");
    const idbOpt = h("option", { value: "indexeddb" }, "IndexedDB (on-device database)");
    const fileOpt = h("option", { value: "localfile" }, "Local File (choose location on device)");
    if (currentStorage === "localstorage") localOpt.selected = true;
    if (currentStorage === "indexeddb") idbOpt.selected = true;
    if (currentStorage === "localfile") fileOpt.selected = true;
    select.appendChild(localOpt);
    select.appendChild(idbOpt);
    select.appendChild(fileOpt);
    body.appendChild(select);
    body.appendChild(h(
      "div",
      { style: "font-size: 0.875rem; color: var(--text-secondary); margin-bottom: var(--space-lg);" },
      "Migration copies data to the selected storage target and keeps a local fallback copy in LocalStorage."
    ));
    const migrateBtn = h("button", {
      className: "btn btn-primary",
      style: "width: 100%;",
      onclick: async () => {
        migrateBtn.disabled = true;
        const target = select.value;
        try {
          await migrateCurrentDatasetStorage(target);
          overlay.remove();
        } catch (err) {
          showToast("Migration failed: " + err.message, "error");
          migrateBtn.disabled = false;
        }
      }
    }, "Migrate Storage");
    body.appendChild(migrateBtn);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
  }
  function duplicateCard(id, withChildren = false) {
    _syncStoreToKernel();
    if (!_kernel.hasCard(id)) return null;
    const result = _kernel.duplicateHierarchy(id, withChildren);
    _syncKernelToStore();
    const ids = result.allNewIds && result.allNewIds.length ? result.allNewIds : result.newId ? [result.newId] : [];
    const groupedUndo = ids.length > 1 && window.startUndoGroup && window.startUndoGroup("duplicateCard");
    for (const newId of ids) {
      pushUndo("createCard", { cardId: newId, card: store.cards[newId] });
    }
    if (groupedUndo && window.endUndoGroup) window.endUndoGroup();
    save();
    return result.newId;
  }
  function duplicateCardAsChild(id, newParentId, withChildren = false) {
    _syncStoreToKernel();
    if (!_kernel.hasCard(id)) return null;
    const result = _kernel.duplicateHierarchy(id, withChildren);
    if (!result.newId) return null;
    _kernel.reparent(result.newId, newParentId);
    _syncKernelToStore();
    const ids = result.allNewIds && result.allNewIds.length ? result.allNewIds : [result.newId];
    const groupedUndo = ids.length > 1 && window.startUndoGroup && window.startUndoGroup("duplicateCard");
    for (const newId of ids) {
      if (store.cards[newId]) pushUndo("createCard", { cardId: newId, card: store.cards[newId] });
    }
    if (groupedUndo && window.endUndoGroup) window.endUndoGroup();
    return result.newId;
  }
  function toggleBookmark(cardId) {
    if (!store.bookmarks) store.bookmarks = [];
    const idx = store.bookmarks.indexOf(cardId);
    if (idx >= 0) {
      store.bookmarks.splice(idx, 1);
      showToast("Bookmark removed", "info");
    } else {
      store.bookmarks.push(cardId);
      showToast("Card bookmarked", "success");
    }
    save();
    render();
  }
  function isBookmarked(cardId) {
    if (!store.bookmarks) store.bookmarks = [];
    return store.bookmarks.includes(cardId);
  }
  function addToRecentCards(cardId) {
    if (!store.recentCards) store.recentCards = [];
    store.recentCards = store.recentCards.filter((id) => id !== cardId);
    store.recentCards.unshift(cardId);
    if (store.recentCards.length > 10) {
      store.recentCards = store.recentCards.slice(0, 10);
    }
    save(true);
  }
  function toggleViewMode() {
    if (!store.viewMode) store.viewMode = "normal";
    store.viewMode = store.viewMode === "normal" ? "compact" : "normal";
    save();
    render();
    showToast(`View mode: ${store.viewMode}`, "info");
  }
  function buildInstanceExport() {
    const metadata = { ...store.metadata || {} };
    delete metadata.pin;
    delete metadata.storageConfig;
    delete metadata.navState;
    delete metadata.navHistory;
    return {
      exportType: "instance",
      formatVersion: 2,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      timestamp: Date.now(),
      cards: store.cards,
      rootIds: store.rootOrder,
      plugins: store.plugins,
      bookmarks: store.bookmarks || [],
      recentCards: store.recentCards || [],
      viewMode: store.viewMode || "normal",
      activeTheme: store.activeTheme || "light",
      metadata
    };
  }
  function exportJSON(type = "instance") {
    let data;
    if (type === "instance") {
      data = buildInstanceExport();
    } else if (type === "plugins") {
      data = {
        exportType: "plugins",
        formatVersion: 2,
        appVersion: APP_VERSION,
        schemaVersion: SCHEMA_VERSION,
        timestamp: Date.now(),
        plugins: store.plugins
      };
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const filename = `cardspoke-${type}-${Date.now()}.json`;
    downloadWithFeedback(blob, filename, "JSON");
  }
  function downloadWithFeedback(content, filename, mimeType) {
    const blob = typeof content === "string" ? new Blob([content], { type: mimeType || "text/plain" }) : content;
    const url = URL.createObjectURL(blob);
    const format = mimeType || "file";
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`✓ ${format} export downloaded: ${filename}`, "success");
    } catch (err) {
      console.warn("[Export] Automatic download failed:", err);
      const overlay = h("div", { className: "modal-overlay show" });
      const modal = h("div", { className: "modal" });
      const modalHeader = h("div", { className: "modal-header" });
      modalHeader.appendChild(h("div", { className: "modal-title" }, "Export Ready"));
      const closeBtn = h("button", { className: "modal-close", "aria-label": "Close dialog", onclick: () => overlay.remove() }, "✕");
      modalHeader.appendChild(closeBtn);
      modal.appendChild(modalHeader);
      const modalBody = h("div", { className: "modal-body" });
      modalBody.appendChild(h(
        "p",
        { style: "margin-bottom: var(--space-lg);" },
        `Your ${format} export is ready. Click the button below to download.`
      ));
      const downloadBtn = h("a", {
        className: "btn btn-primary",
        href: url,
        download: filename,
        style: "display: inline-block; text-decoration: none;"
      }, `Download ${filename}`);
      downloadBtn.onclick = () => {
        showToast(`✓ ${format} export downloaded`, "success");
        setTimeout(() => overlay.remove(), 500);
      };
      modalBody.appendChild(downloadBtn);
      modal.appendChild(modalBody);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      showToast(`${format} export ready - click to download`, "info");
    }
    setTimeout(() => URL.revokeObjectURL(url), 6e4);
  }
  function exportTXT() {
    let text = "# CardSpoke Export\n\n";
    function writeCard(cardId, depth = 0) {
      const card = store.cards[cardId];
      if (!card) return;
      const indent = "  ".repeat(depth);
      text += `${indent}${card.title || "(Untitled)"}
`;
      if (card.body) {
        text += `${indent}  ${card.body.replace(/\n/g, "\n" + indent + "  ")}
`;
      }
      text += "\n";
      (card.children || []).forEach((cid) => writeCard(cid, depth + 1));
    }
    store.rootOrder.forEach((id) => writeCard(id));
    const blob = new Blob([text], { type: "text/plain" });
    const filename = `cardspoke-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.txt`;
    downloadWithFeedback(blob, filename, "TXT");
  }
  function exportMarkdown() {
    let markdown = "# CardSpoke Export\n\n";
    markdown += `*Exported: ${(/* @__PURE__ */ new Date()).toLocaleString()}*

`;
    markdown += "---\n\n";
    function writeCardMD(cardId, depth = 0) {
      const card = store.cards[cardId];
      if (!card) return;
      const heading = "#".repeat(Math.min(depth + 1, 6));
      markdown += `${heading} ${card.title || "(Untitled)"}

`;
      if (card.tags && card.tags.length > 0) {
        markdown += `*Tags: ${card.tags.map((t) => `\`${t}\``).join(", ")}*

`;
      }
      if (card.body) {
        markdown += `${card.body}

`;
      }
      (card.children || []).forEach((cid) => writeCardMD(cid, depth + 1));
    }
    store.rootOrder.forEach((id) => writeCardMD(id));
    const blob = new Blob([markdown], { type: "text/markdown" });
    const filename = `cardspoke-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.md`;
    downloadWithFeedback(blob, filename, "Markdown");
  }
  function csvCell(value) {
    let text = String(value == null ? "" : value);
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function exportCSV() {
    let csv = "ID,Title,Body,Parent ID,Tags,Children Count,Created,Updated\n";
    Object.values(store.cards).forEach((card) => {
      csv += [
        card.id || "",
        card.title || "",
        card.body || "",
        card.parentId || "",
        (card.tags || []).join(";"),
        (card.children || []).length,
        card.createdAt || "",
        card.updatedAt || ""
      ].map(csvCell).join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const filename = `cardspoke-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`;
    downloadWithFeedback(blob, filename, "CSV");
  }
  function handleExport(type) {
    if (type === "instance-json") exportJSON("instance");
    else if (type === "instance-txt") exportTXT();
    else if (type === "plugins-json") exportJSON("plugins");
  }
  async function importJSON(data, mode = "root") {
    const groupedUndo = window.startUndoGroup && window.startUndoGroup("importJSON");
    try {
      let pkg;
      try {
        pkg = typeof data === "string" ? JSON.parse(data) : data;
      } catch (err) {
        showToast("Invalid JSON: " + err.message, "error");
        throw new Error("Failed to parse JSON: " + err.message);
      }
      if (!pkg || typeof pkg !== "object") {
        showToast("Invalid import: data must be an object", "error");
        throw new Error("Invalid import data structure");
      }
      if (pkg.cards && (typeof pkg.cards !== "object" || Array.isArray(pkg.cards))) {
        showToast("Invalid import: cards must be an object", "error");
        throw new Error("Invalid cards structure");
      }
      if (pkg.cards) {
        for (const [cardId, card] of Object.entries(pkg.cards)) {
          if (!card || typeof card !== "object" || Array.isArray(card)) {
            showToast(`Invalid card structure for ID: ${cardId}`, "error");
            throw new Error("Invalid card structure");
          }
          if (card.children && !Array.isArray(card.children)) {
            showToast(`Invalid children array for card: ${cardId}`, "error");
            throw new Error("Invalid card children structure");
          }
        }
      }
      if (pkg.rootIds && !Array.isArray(pkg.rootIds)) {
        showToast("Invalid import: rootIds must be an array", "error");
        throw new Error("Invalid rootIds structure");
      }
      if (typeof pkg.schemaVersion === "number" && pkg.schemaVersion > SCHEMA_VERSION) {
        const proceed = await showConfirmDialog(
          `This backup uses schema v${pkg.schemaVersion}, but this app version supports schema v${SCHEMA_VERSION}.

Importing may lose fields this version does not understand. Continue?`,
          {
            title: "Newer Backup Format",
            confirmLabel: "Import Anyway",
            cancelLabel: "Cancel"
          }
        );
        if (!proceed) throw new Error("Import cancelled: incompatible schema version");
      }
      if (pkg.plugins && (pkg.exportType === "instance" || pkg.exportType === "plugins")) {
        const modCount = Object.keys(pkg.plugins).length;
        if (modCount > 0) {
          const confirmImportMods = await showConfirmDialog(
            `⚠️ SECURITY WARNING

This import includes ${modCount} plugin(s).

Plugins can execute code and access your data. Only import plugins from sources you trust.

Do you want to import the plugins?
(Click Cancel to import only the cards without plugins)`,
            {
              title: "Plugin Import Warning",
              confirmLabel: "Import Plugins",
              cancelLabel: "Cards Only",
              confirmClassName: "btn btn-danger"
            }
          );
          if (!confirmImportMods) {
            delete pkg.plugins;
          }
        }
      }
      const importedIds = [];
      const idMap = /* @__PURE__ */ Object.create(null);
      const remappedCards = {};
      Object.entries(pkg.cards || {}).forEach(([oldId, card]) => {
        const newId = uid();
        idMap[oldId] = newId;
        remappedCards[newId] = { ...card, id: newId };
        importedIds.push(newId);
      });
      Object.values(remappedCards).forEach((card) => {
        card.children = (card.children || []).map((cid) => idMap[cid] || cid);
        if (card.parentId && idMap[card.parentId]) {
          card.parentId = idMap[card.parentId];
        }
      });
      const remappedRootIds = (pkg.rootIds || []).map((id) => idMap[id] || id);
      Object.values(remappedCards).forEach((card) => {
        store.cards[card.id] = card;
      });
      if (mode === "root") {
        remappedRootIds.forEach((id) => {
          if (store.cards[id]) {
            store.cards[id].parentId = null;
            if (!store.rootOrder.includes(id)) {
              store.rootOrder.push(id);
            }
          }
        });
      } else {
        const parentCard = store.cards[mode];
        if (parentCard) {
          remappedRootIds.forEach((cardId) => {
            if (store.cards[cardId]) {
              store.cards[cardId].parentId = mode;
              if (!parentCard.children.includes(cardId)) {
                parentCard.children.push(cardId);
              }
            }
          });
        }
      }
      if ((pkg.exportType === "instance" || pkg.exportType === "plugins") && pkg.plugins) {
        Object.entries(pkg.plugins).forEach(([modId, plugin]) => {
          if (store.plugins[modId] || !plugin || typeof plugin !== "object") return;
          if (plugin.definition && plugin.definition.manifest) {
            store.plugins[modId] = {
              definition: plugin.definition,
              enabled: !!plugin.enabled
            };
          } else if (plugin.js || plugin.css || plugin.meta || plugin.manifest) {
            const meta = plugin.meta || plugin.manifest || {};
            store.plugins[modId] = {
              definition: {
                manifest: {
                  id: meta.id || modId,
                  name: meta.name || modId,
                  version: typeof meta.version === "string" && meta.version || "1.0.0",
                  author: meta.author || meta.creator || "Unknown",
                  layer: meta.layer || "feature",
                  description: meta.description || "",
                  permissions: Array.isArray(meta.permissions) ? meta.permissions : []
                },
                css: typeof plugin.css === "string" && plugin.css ? plugin.css : null,
                js: typeof plugin.js === "string" && plugin.js ? plugin.js : null,
                teardownJs: typeof plugin.teardownJs === "string" && plugin.teardownJs ? plugin.teardownJs : null
              },
              enabled: false
            };
          }
        });
        if (window.CardSpoke && window.CardSpoke.Plugin && window.CardSpoke.Plugin.syncFromStore) {
          try {
            await window.CardSpoke.Plugin.syncFromStore();
          } catch (err) {
            console.error("[Import] Plugin sync failed:", err);
          }
        }
      }
      if (pkg.exportType === "instance") {
        if (Array.isArray(pkg.bookmarks)) {
          if (!store.bookmarks) store.bookmarks = [];
          pkg.bookmarks.forEach((oldId) => {
            const newId = idMap[oldId];
            if (newId && !store.bookmarks.includes(newId)) store.bookmarks.push(newId);
          });
        }
        if (Array.isArray(pkg.recentCards)) {
          if (!store.recentCards) store.recentCards = [];
          const restoredRecents = pkg.recentCards.map((oldId) => idMap[oldId]).filter(Boolean);
          store.recentCards = restoredRecents.concat(store.recentCards.filter((id) => !restoredRecents.includes(id))).slice(0, 10);
        }
        if (pkg.viewMode === "normal" || pkg.viewMode === "compact") {
          store.viewMode = pkg.viewMode;
        }
        if (pkg.activeTheme === "light" || pkg.activeTheme === "dark") {
          store.activeTheme = pkg.activeTheme;
          if (typeof applyTheme === "function") applyTheme(pkg.activeTheme);
        }
        if (pkg.metadata && typeof pkg.metadata === "object") {
          if (!store.metadata) store.metadata = {};
          if (pkg.metadata.name && !store.metadata.name) {
            store.metadata.name = pkg.metadata.name;
          }
        }
      }
      importedIds.forEach((cardId) => {
        const storedCard = store.cards[cardId];
        if (storedCard) {
          try {
            const migrated = migrateCard(storedCard);
            migrated.warnings.forEach((w) => console.warn(`[Import] ${cardId}:`, w));
          } catch (err) {
            console.warn("[Import] Validation skipped for", cardId, err);
          }
        }
      });
      try {
        if (typeof validateStoreConsistency === "function") validateStoreConsistency();
      } catch (err) {
        console.warn("[Import] Consistency repair skipped:", err);
      }
      save();
      showToast(`Imported ${Object.keys(remappedCards).length} cards`);
      render();
    } finally {
      if (groupedUndo && window.endUndoGroup) window.endUndoGroup();
    }
  }
  function importTXT(text, mode = "outline", location2 = "root") {
    const createdIds = [];
    if (mode === "outline") {
      const lines = text.split("\n").filter((l) => l.trim());
      const stack = [];
      lines.forEach((line) => {
        const indent = line.search(/\S/);
        const title = line.trim();
        const depth = Math.floor(indent / 2);
        const parentId = depth > 0 && stack[depth - 1] ? stack[depth - 1] : location2 === "root" ? null : location2;
        const id = createCard(title, "", parentId);
        stack[depth] = id;
        stack.length = depth + 1;
        createdIds.push(id);
      });
      showToast("Imported outline successfully");
      render();
    } else if (mode === "append") {
      if (location2 && location2 !== "root") {
        const card = store.cards[location2];
        if (card) {
          card.body = (card.body ? card.body + "\n\n" : "") + text;
          card.updatedAt = Date.now();
          save();
          showToast("Text appended successfully");
          render();
        }
      }
    }
  }
  function showDatasetManager() {
    const overlay = h("div", { className: "modal-overlay show" });
    const modal = h("div", { className: "modal", style: "max-width: 700px;" });
    const modalHeader = h("div", { className: "modal-header" });
    modalHeader.appendChild(h("div", { className: "modal-title" }, "Dataset Manager"));
    const closeBtn = h("button", { className: "modal-close", "aria-label": "Close dialog", onclick: () => overlay.remove() }, "✕");
    modalHeader.appendChild(closeBtn);
    modal.appendChild(modalHeader);
    const modalBody = h("div", { className: "modal-body" });
    const allKeys = getAllDatasetKeys();
    const current = instanceKey || "nested_cards_store";
    const description = h(
      "p",
      { style: "margin-bottom: var(--space-lg); color: var(--text-secondary);" },
      "Manage your datasets. Each dataset is an independent collection of cards with its own storage."
    );
    modalBody.appendChild(description);
    const datasetsTitle = h("h3", { style: "margin-bottom: var(--space-md);" }, "Your Datasets");
    modalBody.appendChild(datasetsTitle);
    if (allKeys.length === 0) {
      const empty = h(
        "div",
        { className: "empty", style: "margin-bottom: var(--space-xl);" },
        "No datasets found. Create your first dataset below."
      );
      modalBody.appendChild(empty);
    } else {
      const datasetList = h("div", { style: "margin-bottom: var(--space-xl);" });
      allKeys.forEach((key) => {
        const isCurrent = key === current;
        const datasetItem = h("div", {
          style: `
                background: ${isCurrent ? "var(--primary-light, #e3f2fd)" : "var(--bg-secondary)"};
                padding: var(--space-lg);
                border-radius: var(--radius);
                border: 2px solid ${isCurrent ? "var(--primary)" : "var(--border)"};
                margin-bottom: var(--space-md);
                display: flex;
                justify-content: space-between;
                align-items: center;
              `
        });
        const datasetInfo = h("div", { style: "flex: 1;" });
        const datasetName = h(
          "div",
          { style: "font-weight: 700; margin-bottom: var(--space-xs);" },
          key + (isCurrent ? " (Active)" : "")
        );
        const datasetMeta = h("div", { style: "font-size: 0.875rem; color: var(--text-secondary);" });
        try {
          const data = localStorage.getItem(key);
          const size = data ? new Blob([data]).size : 0;
          const formatBytes2 = (bytes) => {
            if (bytes === 0) return "0 Bytes";
            const k = 1024;
            const sizes = ["Bytes", "KB", "MB", "GB"];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
          };
          const parsed = data ? JSON.parse(data) : null;
          if (parsed && parsed.encrypted === true && typeof parsed.payload === "string") {
            datasetMeta.textContent = `Storage: LocalStorage • Size: ${formatBytes2(size)} • Encrypted (PIN protected)`;
          } else {
            const cardCount = parsed ? Object.keys(parsed.cards || {}).length : 0;
            const storageType = parsed && parsed.metadata && parsed.metadata.storageType || "localstorage";
            const storageTypeDisplay = getStorageTypeLabel(storageType);
            datasetMeta.textContent = `Storage: ${storageTypeDisplay} • Size: ${formatBytes2(size)} • Cards: ${cardCount}`;
          }
        } catch (e) {
          datasetMeta.textContent = "Storage: Unknown • Unable to read dataset info";
        }
        datasetInfo.appendChild(datasetName);
        datasetInfo.appendChild(datasetMeta);
        datasetItem.appendChild(datasetInfo);
        const actions = h("div", { style: "display: flex; gap: var(--space-sm);" });
        if (!isCurrent) {
          const openBtn = h("button", {
            className: "btn btn-primary",
            onclick: async () => {
              overlay.remove();
              await flushPendingSave();
              localStorage.setItem("activeInstance", key);
              setInstanceKey(key);
              await load();
              await reconcilePluginsAfterDatasetSwitch();
              if (typeof updateDatasetSelector === "function") updateDatasetSelector();
              render();
              showToast("Switched to: " + key);
            }
          }, "Open");
          actions.appendChild(openBtn);
        }
        if (isCurrent) {
          const storageBtn = h("button", {
            className: "btn",
            onclick: async () => {
              overlay.remove();
              showDatasetStorageSettings();
            }
          }, "Storage Settings");
          actions.appendChild(storageBtn);
        }
        const deleteBtn = h("button", {
          className: "btn btn-danger",
          onclick: async () => {
            if (allKeys.length === 1) {
              showToast("Cannot delete the only dataset", "error");
              return;
            }
            if (await showConfirmDialog(`Delete dataset "${key}"?

This will permanently delete all cards and data in this dataset.

This action cannot be undone!`, {
              title: "Delete Dataset",
              confirmLabel: "Delete Dataset",
              cancelLabel: "Cancel",
              confirmClassName: "btn btn-danger"
            })) {
              if (isCurrent) cancelPendingSave();
              localStorage.removeItem(key);
              if (isCurrent && allKeys.length > 1) {
                const otherKey = allKeys.find((k) => k !== key);
                localStorage.setItem("activeInstance", otherKey);
                setInstanceKey(otherKey);
                await load();
                await reconcilePluginsAfterDatasetSwitch();
                render();
              }
              if (typeof updateDatasetSelector === "function") updateDatasetSelector();
              overlay.remove();
              showToast("Dataset deleted: " + key);
              setTimeout(() => showDatasetManager(), 100);
            }
          }
        }, "Delete");
        actions.appendChild(deleteBtn);
        datasetItem.appendChild(actions);
        datasetList.appendChild(datasetItem);
      });
      modalBody.appendChild(datasetList);
    }
    const createTitle = h("h3", { style: "margin-bottom: var(--space-md);" }, "Create New Dataset");
    modalBody.appendChild(createTitle);
    const createForm = h("div", {
      style: `
            background: var(--bg-secondary);
            padding: var(--space-lg);
            border-radius: var(--radius);
            border: 1px solid var(--border);
          `
    });
    const nameLabel = h("label", {
      for: "newDatasetName",
      style: "display: block; margin-bottom: var(--space-xs); font-weight: 600;"
    }, "Dataset Name");
    const nameInput = h("input", {
      type: "text",
      id: "newDatasetName",
      placeholder: "My Dataset",
      style: `
            width: 100%;
            padding: var(--space-md);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--bg-primary);
            color: var(--text-primary);
            margin-bottom: var(--space-lg);
            font-size: 1rem;
          `
    });
    const storageLabel = h("label", {
      for: "newDatasetStorage",
      style: "display: block; margin-bottom: var(--space-xs); font-weight: 600;"
    }, "Storage Type");
    const storageSelect = h("select", {
      id: "newDatasetStorage",
      style: `
            width: 100%;
            padding: var(--space-md);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--bg-primary);
            color: var(--text-primary);
            margin-bottom: var(--space-xs);
            font-size: 1rem;
          `
    });
    const optionLocal = h("option", { value: "localstorage" }, "LocalStorage (Browser storage, fast access)");
    const optionIndexed = h("option", { value: "indexeddb" }, "IndexedDB (Browser database, larger capacity)");
    const optionLocalFile = h("option", { value: "localfile" }, "Local File (choose location on device)");
    storageSelect.appendChild(optionLocal);
    storageSelect.appendChild(optionIndexed);
    storageSelect.appendChild(optionLocalFile);
    const storageHelp = h("div", {
      style: "font-size: 0.875rem; color: var(--text-secondary); margin-bottom: var(--space-lg);"
    }, "Default: LocalStorage. You can migrate later. Local File lets you choose a save location. All options keep your data on this device.");
    const pinFieldStyle = `
            width: 100%;
            padding: var(--space-md);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--bg-primary);
            color: var(--text-primary);
            margin-bottom: var(--space-xs);
            font-size: 1rem;
          `;
    const pinLabel = h("label", {
      for: "newDatasetPin",
      style: "display: block; margin-bottom: var(--space-xs); font-weight: 600;"
    }, "PIN Protection (Optional)");
    const pinInput = h("input", {
      type: "password",
      id: "newDatasetPin",
      placeholder: "Leave empty for no PIN",
      autocomplete: "new-password",
      "aria-describedby": "newDatasetPinHelp",
      style: pinFieldStyle
    });
    const pinConfirmLabel = h("label", {
      for: "newDatasetPinConfirm",
      style: "display: block; margin-bottom: var(--space-xs); font-weight: 600;"
    }, "Confirm PIN");
    const pinConfirmInput = h("input", {
      type: "password",
      id: "newDatasetPinConfirm",
      placeholder: "Re-enter the same PIN",
      autocomplete: "new-password",
      "aria-describedby": "newDatasetPinHelp",
      style: pinFieldStyle
    });
    const pinHelp = h("div", {
      id: "newDatasetPinHelp",
      style: "font-size: 0.875rem; color: var(--text-secondary); margin-bottom: var(--space-lg);"
    }, "If set, this PIN encrypts dataset payloads via Web Crypto (PBKDF2 + AES-GCM). The PIN is used exactly as typed and cannot be recovered if forgotten. A short PIN is convenience protection, not strong security.");
    const createBtn = h("button", {
      className: "btn btn-primary",
      style: "width: 100%;",
      onclick: async () => {
        let name = document.getElementById("newDatasetName").value.trim();
        const storageType = document.getElementById("newDatasetStorage").value;
        const pin = document.getElementById("newDatasetPin").value;
        const pinConfirm = document.getElementById("newDatasetPinConfirm").value;
        if (pin) {
          if (!pin.trim()) {
            showToast("The PIN cannot consist only of spaces", "error");
            return;
          }
          if (pin !== pin.trim()) {
            showToast("The PIN cannot start or end with a space", "error");
            return;
          }
          if (pin !== pinConfirm) {
            showToast("The PINs do not match. Please re-enter them.", "error");
            return;
          }
        }
        if (!name) {
          const count = getAllDatasetKeys().length + 1;
          name = "Dataset_" + count;
        }
        if (storageType === "localfile") {
          if (typeof window.showSaveFilePicker !== "function") {
            showToast("Local file location selection is not supported in this environment", "error");
            return;
          }
        }
        const shortId = Date.now().toString(36).slice(-4);
        const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 20);
        const newKey = "cards_" + cleanName + "_" + shortId;
        if (pin && !(window.crypto && window.crypto.subtle)) {
          showToast("PIN protection requires the Web Crypto API, which is unavailable in this environment", "error");
          return;
        }
        const newStore = {
          rootOrder: [],
          cards: {},
          plugins: {},
          bookmarks: [],
          recentCards: [],
          viewMode: "normal",
          activeTheme: "light",
          metadata: {
            name,
            storageType,
            storageConfig: {},
            createdAt: Date.now()
          }
        };
        await flushPendingSave();
        localStorage.setItem("activeInstance", newKey);
        setInstanceKey(newKey);
        setStore(newStore);
        setSessionPin(pin || null);
        save();
        if (typeof updateDatasetSelector === "function") updateDatasetSelector();
        render();
        overlay.remove();
        if (pin) {
          showToast(`Created encrypted dataset: ${name}. Remember your PIN — without it the data cannot be recovered.`, "warning", 8e3);
        } else {
          showToast(`Created new dataset: ${name} (${storageType})`);
        }
      }
    }, "+ Create Dataset");
    createForm.appendChild(nameLabel);
    createForm.appendChild(nameInput);
    createForm.appendChild(storageLabel);
    createForm.appendChild(storageSelect);
    createForm.appendChild(storageHelp);
    createForm.appendChild(pinLabel);
    createForm.appendChild(pinInput);
    createForm.appendChild(pinConfirmLabel);
    createForm.appendChild(pinConfirmInput);
    createForm.appendChild(pinHelp);
    createForm.appendChild(createBtn);
    modalBody.appendChild(createForm);
    modal.appendChild(modalBody);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
    setTimeout(() => nameInput.focus(), 100);
  }
  function showDatasetInfo() {
    const overlay = h("div", { className: "modal-overlay show" });
    const modal = h("div", { className: "modal" });
    const modalHeader = h("div", { className: "modal-header" });
    modalHeader.appendChild(h("div", { className: "modal-title" }, "Dataset Information"));
    const closeBtn = h("button", { className: "modal-close", "aria-label": "Close dialog", onclick: () => overlay.remove() }, "✕");
    modalHeader.appendChild(closeBtn);
    modal.appendChild(modalHeader);
    const modalBody = h("div", { className: "modal-body" });
    const currentKey = instanceKey || "nested_cards_store";
    const currentData = localStorage.getItem(currentKey);
    let dataSize = 0;
    let totalSize = 0;
    let itemCount = 0;
    if (currentData) {
      dataSize = new Blob([currentData]).size;
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      if (value) {
        totalSize += new Blob([value]).size;
        itemCount++;
      }
    }
    let cardCount = 0;
    let modCount = 0;
    let bookmarkCount = 0;
    let recentCount = 0;
    if (store) {
      cardCount = Object.keys(store.cards || {}).length;
      modCount = Object.keys(store.plugins || {}).length;
      bookmarkCount = (store.bookmarks || []).length;
      recentCount = (store.recentCards || []).length;
    }
    const formatBytes2 = (bytes) => {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
    };
    const displayName = store && store.metadata && store.metadata.name || currentKey;
    const storageType = store && store.metadata && store.metadata.storageType || "localstorage";
    const storageTypeDisplay = getStorageTypeLabel(storageType);
    let pinProtected = "No";
    try {
      const probe = currentData ? JSON.parse(currentData) : null;
      if (probe && probe.encrypted === true && typeof probe.payload === "string") {
        pinProtected = typeof getSessionPin === "function" && getSessionPin() ? "Yes (unlocked this session)" : "Yes (locked)";
      }
    } catch (_e) {
      pinProtected = "Unknown (unreadable data)";
    }
    const infoRow = (label, value) => {
      const row = h("div", { style: "margin-bottom: var(--space-sm);" });
      row.appendChild(h("strong", {}, label));
      row.appendChild(document.createTextNode(" " + value));
      return row;
    };
    const sectionStyle = "background: var(--bg-secondary); padding: var(--space-lg); border-radius: var(--radius); border: 1px solid var(--border);";
    const headingStyle = "margin-bottom: var(--space-md); color: var(--text-primary);";
    const currentSection = h(
      "div",
      { style: "margin-bottom: var(--space-xl);" },
      h("h3", { style: headingStyle }, "Current Dataset"),
      h(
        "div",
        { style: sectionStyle },
        infoRow("Name:", displayName),
        infoRow("Storage Type:", storageTypeDisplay),
        infoRow("Size:", formatBytes2(dataSize)),
        infoRow("PIN Protected:", pinProtected)
      )
    );
    modalBody.appendChild(currentSection);
    const contentsSection = h(
      "div",
      { style: "margin-bottom: var(--space-xl);" },
      h("h3", { style: headingStyle }, "Dataset Contents"),
      h(
        "div",
        { style: sectionStyle },
        infoRow("Cards:", String(cardCount)),
        infoRow("Plugins:", String(modCount)),
        infoRow("Bookmarks:", String(bookmarkCount)),
        infoRow("Recent Cards:", String(recentCount))
      )
    );
    modalBody.appendChild(contentsSection);
    const quotaPercent = "~" + Math.round(totalSize / (5 * 1024 * 1024) * 100) + "% (typical 5MB limit)";
    const storageSection = h(
      "div",
      { style: "margin-bottom: var(--space-xl);" },
      h("h3", { style: headingStyle }, "Storage Overview"),
      h(
        "div",
        { style: sectionStyle },
        infoRow("Total LocalStorage:", formatBytes2(totalSize)),
        infoRow("Total Items:", String(itemCount)),
        infoRow("Quota Used:", quotaPercent)
      )
    );
    modalBody.appendChild(storageSection);
    const exportBtn = h("button", {
      className: "btn btn-primary",
      onclick: () => {
        overlay.remove();
        handleExport("instance-json");
      }
    }, "Export Dataset");
    const switchBtn = h("button", {
      className: "btn btn-secondary",
      onclick: () => {
        overlay.remove();
        showDatasetManager();
      }
    }, "Switch Dataset");
    const actionsSection = h(
      "div",
      {},
      h("h3", { style: headingStyle }, "Quick Actions"),
      h(
        "div",
        { style: "display: flex; gap: var(--space-md); flex-wrap: wrap;" },
        exportBtn,
        switchBtn
      )
    );
    modalBody.appendChild(actionsSection);
    modal.appendChild(modalBody);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
  }
  function showPluginManager(initialTab) {
    initialTab = initialTab || "installed";
    var overlay = h("div", { className: "modal-overlay show" });
    var modal = h("div", {
      className: "modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "pluginManagerTitle",
      style: "max-width: 800px; max-height: 90vh;"
    });
    var modalHeader = h("div", { className: "modal-header" });
    modalHeader.appendChild(h("div", { className: "modal-title", id: "pluginManagerTitle" }, "Plugin Manager"));
    modalHeader.appendChild(h("button", {
      className: "modal-close",
      "aria-label": "Close Plugin Manager",
      onclick: function() {
        overlay.remove();
      }
    }, "✕"));
    modal.appendChild(modalHeader);
    var tabBar = h("div", { role: "tablist", "aria-label": "Plugin Manager sections", style: "display: flex; border-bottom: 2px solid var(--border); padding: 0 var(--space-lg);" });
    var tabs = ["installed", "install", "gallery", "create"];
    var tabButtons = {};
    var tabContents = {};
    tabs.forEach(function(tabName) {
      var btn = h("button", {
        className: "tab-btn",
        role: "tab",
        style: "padding: var(--space-md) var(--space-lg); border: none; background: none; cursor: pointer; border-bottom: 3px solid transparent; font-weight: 500; color: var(--text);",
        onclick: function() {
          switchTab(tabName);
        }
      }, tabName.charAt(0).toUpperCase() + tabName.slice(1));
      tabButtons[tabName] = btn;
      tabBar.appendChild(btn);
    });
    modal.appendChild(tabBar);
    var bodyContent = h("div", { className: "modal-body", style: "overflow-y: auto; max-height: 65vh; padding: var(--space-lg);" });
    tabs.forEach(function(tabName) {
      var container = h("div", {
        className: "tab-content",
        style: "display: none;"
      });
      tabContents[tabName] = container;
      bodyContent.appendChild(container);
    });
    function switchTab(tabName) {
      tabs.forEach(function(t) {
        tabButtons[t].style.borderBottom = t === tabName ? "3px solid var(--accent-strong, #1d4ed8)" : "3px solid transparent";
        tabButtons[t].style.color = t === tabName ? "var(--accent-strong, #1d4ed8)" : "var(--text)";
        tabButtons[t].setAttribute("aria-selected", t === tabName ? "true" : "false");
        tabContents[t].style.display = t === tabName ? "block" : "none";
      });
    }
    function renderInstalledTab() {
      var container = tabContents["installed"];
      container.innerHTML = "";
      var plugins2 = window.CardSpoke && window.CardSpoke.Plugin ? window.CardSpoke.Plugin.listAll() : [];
      if (plugins2.length === 0) {
        container.appendChild(h(
          "div",
          { className: "empty", style: "padding: var(--space-xl); text-align: center; color: var(--text-muted);" },
          "No plugins installed. Use the Install or Create tabs to add plugins."
        ));
        return;
      }
      plugins2.forEach(function(plugin) {
        var manifest = plugin.definition.manifest || {};
        var pkg = {
          manifest,
          setup: plugin.definition.setup,
          teardown: plugin.definition.teardown,
          css: plugin.definition.css,
          js: plugin.definition.js
        };
        var risk = window.CardSpoke.Plugin.assessModRisk(pkg);
        var card = h("div", {
          style: "border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-md); margin-bottom: var(--space-md);"
        });
        var headerRow = h("div", { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-sm);" });
        headerRow.appendChild(h("div", { style: "font-weight: 700; font-size: var(--text-lg);" }, manifest.name || plugin.id));
        var riskBadge = h("span", {
          title: risk === 'SAFE' ? "CSS-only theme — runs no JavaScript" : "Contains JavaScript. Plugins are not sandboxed: once enabled (with your consent), this code has full access to the app and your data.",
          style: "font-size: var(--text-xs); padding: 2px 8px; border-radius: 4px; font-weight: 600; " + (risk === 'SAFE' ? "background: #d1fae5; color: #065f46;" : risk === 'LOW' ? "background: #dbeafe; color: #1e40af;" : risk === 'MEDIUM' ? "background: #fef3c7; color: #92400e;" : "background: #fee2e2; color: #991b1b;")
        }, risk);
        headerRow.appendChild(riskBadge);
        card.appendChild(headerRow);
        var info = h("div", { style: "font-size: var(--text-sm); color: var(--text-muted); margin-bottom: var(--space-sm);" });
        info.textContent = "v" + (manifest.version || "1.0.0") + " by " + (manifest.author || "Unknown") + (manifest.description ? " — " + manifest.description : "");
        card.appendChild(info);
        var stateBadge = h("span", {
          style: "font-size: var(--text-xs); padding: 2px 8px; border-radius: 4px; font-weight: 600; " + (plugin.enabled ? "background: #d1fae5; color: #065f46;" : "background: #e5e7eb; color: #374151;")
        }, plugin.enabled ? "Active" : "Suspended");
        card.appendChild(stateBadge);
        var actions = h("div", { style: "display: flex; gap: var(--space-sm); margin-top: var(--space-md);" });
        var toggleBtn = h("button", {
          className: "btn btn-sm",
          style: "font-size: var(--text-sm);",
          onclick: async function() {
            try {
              if (plugin.enabled) {
                await window.CardSpoke.Plugin.disable(plugin.id);
                showToast("Plugin suspended: " + manifest.name);
              } else {
                await window.CardSpoke.Plugin.enable(plugin.id);
                showToast("Plugin enabled: " + manifest.name);
              }
              renderInstalledTab();
            } catch (err) {
              showToast("Error: " + err.message, "error");
              renderInstalledTab();
            }
          }
        }, plugin.enabled ? "Suspend" : "Enable");
        actions.appendChild(toggleBtn);
        var removeBtn = h("button", {
          className: "btn btn-sm",
          style: "font-size: var(--text-sm); background: var(--danger, #ef4444); color: white;",
          onclick: async function() {
            if (await showConfirmDialog('Remove plugin "' + manifest.name + '"?', {
              title: "Remove Plugin",
              confirmLabel: "Remove",
              cancelLabel: "Cancel",
              confirmClassName: "btn btn-danger"
            })) {
              try {
                await window.CardSpoke.Plugin.unregister(plugin.id);
                showToast("Plugin removed: " + manifest.name);
              } catch (err) {
                showToast("Failed to remove plugin: " + err.message, "error");
              }
              renderInstalledTab();
            }
          }
        }, "Remove");
        actions.appendChild(removeBtn);
        card.appendChild(actions);
        container.appendChild(card);
      });
      var modIds = Object.keys(store.plugins || {}).filter(function(modId) {
        return !(store.plugins[modId] && store.plugins[modId].definition);
      });
      if (modIds.length > 0) {
        var legacySection = h("div", { style: "margin-top: var(--space-xl); padding-top: var(--space-xl); border-top: 1px solid var(--border);" });
        legacySection.appendChild(h("h3", { style: "margin-bottom: var(--space-md); color: var(--warning, #f59e0b);" }, "Legacy Plugins (Non-functional)"));
        legacySection.appendChild(h(
          "p",
          { style: "margin-bottom: var(--space-md); color: var(--text-muted);" },
          "These legacy plugins use the old system and are no longer functional:"
        ));
        modIds.forEach(function(modId) {
          var pkg = store.plugins[modId];
          var manifest = pkg.manifest || {};
          var legacyCard = h("div", {
            style: "border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-md); margin-bottom: var(--space-md); opacity: 0.6;"
          });
          legacyCard.appendChild(h("div", { style: "font-weight: 700;" }, manifest.name || modId));
          legacyCard.appendChild(h(
            "div",
            { style: "font-size: var(--text-sm); color: var(--text-muted);" },
            "v" + (manifest.version || "?") + " by " + (manifest.author || "Unknown")
          ));
          var exportBtn = h("button", {
            className: "btn btn-sm",
            style: "font-size: var(--text-xs); margin-top: var(--space-sm);",
            onclick: function() {
              var json = JSON.stringify(pkg, null, 2);
              downloadWithFeedback(json, modId + ".json", "application/json");
              showToast("Legacy plugin exported for migration");
            }
          }, "Export");
          legacyCard.appendChild(exportBtn);
          legacySection.appendChild(legacyCard);
        });
        container.appendChild(legacySection);
      }
    }
    function renderInstallTab() {
      var container = tabContents["install"];
      container.innerHTML = "";
      container.appendChild(h("h3", { style: "margin-bottom: var(--space-md);" }, "Install Plugin"));
      var uploadSection = h("div", { style: "margin-bottom: var(--space-xl);" });
      uploadSection.appendChild(h("h4", { style: "margin-bottom: var(--space-sm);" }, "Upload Plugin File"));
      uploadSection.appendChild(h(
        "p",
        { style: "margin-bottom: var(--space-md); color: var(--text-muted);" },
        "Upload a JSON file containing a plugin definition."
      ));
      var fileInput = h("input", {
        type: "file",
        accept: ".json",
        style: "margin-bottom: var(--space-sm);"
      });
      var uploadBtn = h("button", {
        className: "btn",
        onclick: async function() {
          var file = fileInput.files[0];
          if (!file) {
            showToast("Please select a file", "error");
            return;
          }
          try {
            var text = await file.text();
            var pkg = JSON.parse(text);
            var id = await window.CardSpoke.Plugin.install(pkg);
            showToast("Plugin installed: " + (pkg.manifest.name || id), "success");
            renderInstalledTab();
            switchTab("installed");
          } catch (err) {
            showToast("Installation failed: " + err.message, "error");
          }
        }
      }, "Install from File");
      uploadSection.appendChild(fileInput);
      uploadSection.appendChild(uploadBtn);
      container.appendChild(uploadSection);
      var urlSection = h("div", {});
      urlSection.appendChild(h("h4", { style: "margin-bottom: var(--space-sm);" }, "Install from URL"));
      urlSection.appendChild(h(
        "p",
        { style: "margin-bottom: var(--space-md); color: var(--text-muted);" },
        "Load a plugin from a remote URL."
      ));
      var urlInput = h("input", {
        type: "url",
        placeholder: "https://example.com/plugin.json",
        style: "width: 100%; padding: var(--space-sm); margin-bottom: var(--space-sm); border: 1px solid var(--border); border-radius: 4px;"
      });
      var urlBtn = h("button", {
        className: "btn",
        onclick: async function() {
          var url = urlInput.value.trim();
          if (!url) {
            showToast("Please enter a URL", "error");
            return;
          }
          try {
            var response = await fetch(url);
            if (!response.ok) throw new Error("Failed to fetch plugin: " + response.status + " " + response.statusText);
            var pkg = await response.json();
            var id = await window.CardSpoke.Plugin.install(pkg);
            showToast("Plugin installed: " + (pkg.manifest.name || id), "success");
            renderInstalledTab();
            switchTab("installed");
          } catch (err) {
            showToast("Installation failed: " + err.message, "error");
          }
        }
      }, "Install from URL");
      urlSection.appendChild(urlInput);
      urlSection.appendChild(urlBtn);
      container.appendChild(urlSection);
    }
    function renderGalleryTab() {
      var container = tabContents["gallery"];
      container.innerHTML = "";
      container.appendChild(h("h3", { style: "margin-bottom: var(--space-md);" }, "Plugin Gallery"));
      container.appendChild(h(
        "p",
        { style: "margin-bottom: var(--space-lg); color: var(--text-muted);" },
        "Browse curated plugins from the CardSpoke GitHub repository."
      ));
      var loading = h("div", { style: "padding: var(--space-md); color: var(--text-muted);" }, "Loading gallery...");
      container.appendChild(loading);
      fetch("https://raw.githubusercontent.com/jxburros/CardSpoke/main/sample-plugins/manifest.json").then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function(manifest) {
        loading.remove();
        var plugins2 = Array.isArray(manifest.plugins) ? manifest.plugins : [];
        if (!plugins2.length) {
          container.appendChild(h("div", { className: "empty" }, "No gallery plugins available."));
          return;
        }
        plugins2.forEach(function(item) {
          var card = h("div", { style: "border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-md); margin-bottom: var(--space-md);" });
          card.appendChild(h("div", { style: "font-weight: 700;" }, item.name || item.id || "Plugin"));
          card.appendChild(h("div", { style: "font-size: var(--text-sm); color: var(--text-muted); margin-top: var(--space-xs);" }, item.description || ""));
          var installBtn = h("button", { className: "btn btn-sm", style: "margin-top: var(--space-sm);", onclick: async function() {
            try {
              var url = item.url || item.sourceUrl;
              if (!url) throw new Error("Missing plugin URL in manifest");
              var res = await fetch(url);
              if (!res.ok) throw new Error("Failed to fetch plugin package");
              var pkg = await res.json();
              var id = await window.CardSpoke.Plugin.install(pkg);
              showToast("Installed: " + (pkg.manifest && pkg.manifest.name ? pkg.manifest.name : id), "success");
              renderInstalledTab();
            } catch (err) {
              showToast("Gallery install failed: " + err.message, "error");
            }
          } }, "Install");
          card.appendChild(installBtn);
          container.appendChild(card);
        });
      }).catch(function(err) {
        loading.textContent = "Failed to load gallery: " + err.message;
      });
    }
    function renderCreateTab() {
      var container = tabContents["create"];
      container.innerHTML = "";
      container.appendChild(h("h3", { style: "margin-bottom: var(--space-md);" }, "Create Plugin"));
      container.appendChild(h(
        "p",
        { style: "margin-bottom: var(--space-lg); color: var(--text-muted);" },
        "Build a plugin directly in the app by providing metadata, JavaScript, and CSS."
      ));
      var form = h("div", {});
      form.appendChild(h("h4", { style: "margin-bottom: var(--space-sm);" }, "Manifest (JSON)"));
      var manifestInput = h("textarea", {
        placeholder: '{\n  "name": "My Plugin",\n  "version": "1.0.0",\n  "author": "Your Name",\n  "layer": "feature",\n  "permissions": []\n}',
        style: "width: 100%; min-height: 120px; padding: var(--space-sm); margin-bottom: var(--space-md); font-family: monospace; border: 1px solid var(--border); border-radius: 4px;"
      });
      form.appendChild(manifestInput);
      form.appendChild(h("h4", { style: "margin-bottom: var(--space-sm);" }, "JavaScript (setup function)"));
      var jsInput = h("textarea", {
        placeholder: "// Access APIs via ctx parameter\nconst cards = ctx.api.data.listCards();\nctx.api.ui.showToast(`Loaded ${cards.length} cards`, 'info');",
        style: "width: 100%; min-height: 150px; padding: var(--space-sm); margin-bottom: var(--space-md); font-family: monospace; border: 1px solid var(--border); border-radius: 4px;"
      });
      form.appendChild(jsInput);
      form.appendChild(h("h4", { style: "margin-bottom: var(--space-sm);" }, "CSS (optional)"));
      var cssInput = h("textarea", {
        placeholder: "/* Custom styles */\n.my-element {\n  color: var(--primary);\n}",
        style: "width: 100%; min-height: 100px; padding: var(--space-sm); margin-bottom: var(--space-md); font-family: monospace; border: 1px solid var(--border); border-radius: 4px;"
      });
      form.appendChild(cssInput);
      var saveBtn = h("button", {
        className: "btn",
        onclick: async function() {
          try {
            var manifest = JSON.parse(manifestInput.value || "{}");
            if (!manifest.name) {
              showToast("Plugin name is required", "error");
              return;
            }
            var jsCode = jsInput.value.trim();
            var css = cssInput.value.trim();
            var pkg = {
              manifest,
              css: css || void 0,
              js: jsCode || void 0
            };
            var id = await window.CardSpoke.Plugin.install(pkg);
            showToast("Plugin created and registered: " + manifest.name, "success");
            renderInstalledTab();
            switchTab("installed");
          } catch (err) {
            showToast("Failed to create plugin: " + err.message, "error");
          }
        }
      }, "Save & Register");
      form.appendChild(saveBtn);
      container.appendChild(form);
    }
    renderInstalledTab();
    renderInstallTab();
    renderGalleryTab();
    renderCreateTab();
    switchTab(initialTab);
    modal.appendChild(bodyContent);
    overlay.appendChild(modal);
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.remove();
    };
    document.body.appendChild(overlay);
  }
  function showAppearanceSettings() {
    const overlay = h("div", { className: "modal-overlay show" });
    const modal = h("div", { className: "modal", style: "max-width: 600px;" });
    const modalHeader = h("div", { className: "modal-header" });
    modalHeader.appendChild(h("div", { className: "modal-title" }, "Appearance Settings"));
    const closeBtn = h("button", { className: "modal-close", onclick: () => overlay.remove(), "aria-label": "Close" }, "✕");
    modalHeader.appendChild(closeBtn);
    modal.appendChild(modalHeader);
    const modalBody = h("div", { className: "modal-body" });
    const viewSection = h("div", { style: "margin-bottom: var(--space-2xl); padding-bottom: var(--space-xl); border-bottom: 1px solid var(--border);" });
    viewSection.appendChild(h("div", {
      style: "font-weight: 700; margin-bottom: var(--space-lg); font-size: var(--text-lg);"
    }, "View Options"));
    const richTextEnabled = localStorage.getItem("cardspoke_richtext") === "true";
    const richTextRow = h("div", {
      className: "menu-item-toggle",
      style: "padding: var(--space-md); border: 1px solid var(--border); border-radius: 4px; margin-bottom: var(--space-md);"
    });
    const richTextLabel = h("div", { className: "menu-item-label" });
    richTextLabel.appendChild(h("span", { style: "display: block;" }, "Rich Text"));
    richTextLabel.appendChild(h("span", { style: "font-size: var(--text-sm); color: var(--text-muted); display: block;" }, "Enable markdown formatting in card body"));
    const richTextToggle = h("label", { className: "switch-toggle" });
    const richTextInput = h("input", {
      type: "checkbox",
      checked: richTextEnabled,
      onchange: function(e) {
        localStorage.setItem("cardspoke_richtext", e.target.checked ? "true" : "false");
        showToast(e.target.checked ? "Rich Text enabled" : "Rich Text disabled");
        render();
      }
    });
    const richTextSlider = h("span", { className: "switch-slider" });
    richTextToggle.appendChild(richTextInput);
    richTextToggle.appendChild(richTextSlider);
    richTextRow.appendChild(richTextLabel);
    richTextRow.appendChild(richTextToggle);
    viewSection.appendChild(richTextRow);
    const compactViewEnabled = store.viewMode === "compact";
    const compactRow = h("div", {
      className: "menu-item-toggle",
      style: "padding: var(--space-md); border: 1px solid var(--border); border-radius: 4px; margin-bottom: var(--space-md);"
    });
    const compactLabel = h("label", { className: "menu-item-label" }, "Compact View");
    const compactToggle = h("label", { className: "switch-toggle" });
    const compactInput = h("input", {
      type: "checkbox",
      checked: compactViewEnabled,
      onchange: function(e) {
        store.viewMode = e.target.checked ? "compact" : "normal";
        save();
        render();
      }
    });
    const compactSlider = h("span", { className: "switch-slider" });
    compactToggle.appendChild(compactInput);
    compactToggle.appendChild(compactSlider);
    compactRow.appendChild(compactLabel);
    compactRow.appendChild(compactToggle);
    viewSection.appendChild(compactRow);
    const gridViewEnabled = localStorage.getItem("cardspoke_gridView") === "true";
    const gridRow = h("div", {
      className: "menu-item-toggle",
      style: "padding: var(--space-md); border: 1px solid var(--border); border-radius: 4px; margin-bottom: var(--space-md);"
    });
    const gridLabel = h("label", { className: "menu-item-label" }, "Grid View");
    const gridToggle = h("label", { className: "switch-toggle" });
    const gridInput = h("input", {
      type: "checkbox",
      checked: gridViewEnabled,
      onchange: function(e) {
        localStorage.setItem("cardspoke_gridView", e.target.checked.toString());
        render();
      }
    });
    const gridSlider = h("span", { className: "switch-slider" });
    gridToggle.appendChild(gridInput);
    gridToggle.appendChild(gridSlider);
    gridRow.appendChild(gridLabel);
    gridRow.appendChild(gridToggle);
    viewSection.appendChild(gridRow);
    const highContrastEnabled = localStorage.getItem("cardspoke_highcontrast") === "true";
    const contrastRow = h("div", {
      className: "menu-item-toggle",
      style: "padding: var(--space-md); border: 1px solid var(--border); border-radius: 4px;"
    });
    const contrastLabel = h("label", { className: "menu-item-label" }, "High Contrast");
    const contrastToggle = h("label", { className: "switch-toggle" });
    const contrastInput = h("input", {
      type: "checkbox",
      checked: highContrastEnabled,
      onchange: function(e) {
        localStorage.setItem("cardspoke_highcontrast", e.target.checked.toString());
        if (e.target.checked) {
          document.documentElement.classList.add("high-contrast");
        } else {
          document.documentElement.classList.remove("high-contrast");
        }
      }
    });
    const contrastSlider = h("span", { className: "switch-slider" });
    contrastToggle.appendChild(contrastInput);
    contrastToggle.appendChild(contrastSlider);
    contrastRow.appendChild(contrastLabel);
    contrastRow.appendChild(contrastToggle);
    viewSection.appendChild(contrastRow);
    const devModeEnabled = localStorage.getItem("cardspoke_devmode") === "true";
    const devRow = h("div", {
      className: "menu-item-toggle",
      style: "padding: var(--space-md); border: 1px solid var(--border); border-radius: 4px; margin-top: var(--space-md);"
    });
    const devLabel = h("label", { className: "menu-item-label" }, "Developer Mode");
    const devToggle = h("label", { className: "switch-toggle" });
    const devInput = h("input", {
      type: "checkbox",
      checked: devModeEnabled,
      onchange: function(e) {
        localStorage.setItem("cardspoke_devmode", e.target.checked.toString());
        if (e.target.checked) {
          showToast("Developer mode enabled - Open menu to access Developer Console", "success");
        } else {
          showToast("Developer mode disabled", "info");
        }
      }
    });
    const devSlider = h("span", { className: "switch-slider" });
    devToggle.appendChild(devInput);
    devToggle.appendChild(devSlider);
    devRow.appendChild(devLabel);
    devRow.appendChild(devToggle);
    viewSection.appendChild(devRow);
    modalBody.appendChild(viewSection);
    const typoSection = h("div", { style: "margin-bottom: var(--space-2xl); padding-bottom: var(--space-xl); border-bottom: 1px solid var(--border);" });
    typoSection.appendChild(h("div", {
      style: "font-weight: 700; margin-bottom: var(--space-lg); font-size: var(--text-lg);"
    }, "Typography"));
    const currentTypography = localStorage.getItem("cardspoke_typography") || "default";
    const typographyPresets = [
      { id: "default", name: "Default", desc: "Standard reading size" },
      { id: "comfortable", name: "Comfortable", desc: "Larger text, more spacing" },
      { id: "compact", name: "Compact", desc: "Smaller text, denser layout" },
      { id: "dyslexia", name: "Dyslexia-Friendly", desc: "Optimized for readability" }
    ];
    typographyPresets.forEach(function(preset) {
      const isActive = currentTypography === preset.id;
      const presetOption = h("div", {
        style: "padding: var(--space-md); border: 2px solid " + (isActive ? "var(--text)" : "var(--border)") + "; border-radius: 4px; margin-bottom: var(--space-md); cursor: pointer;",
        onclick: function() {
          localStorage.setItem("cardspoke_typography", preset.id);
          document.documentElement.setAttribute("data-typography", preset.id);
          showToast("Typography: " + preset.name);
          overlay.remove();
          showAppearanceSettings();
        }
      });
      presetOption.appendChild(h("div", { style: "font-weight: 600;" }, (isActive ? "✓ " : "") + preset.name));
      presetOption.appendChild(h("div", { style: "font-size: var(--text-sm); color: var(--text-muted);" }, preset.desc));
      typoSection.appendChild(presetOption);
    });
    modalBody.appendChild(typoSection);
    const modeSection = h("div", { style: "margin-bottom: var(--space-2xl); padding-bottom: var(--space-xl); border-bottom: 1px solid var(--border);" });
    modeSection.appendChild(h("div", {
      style: "font-weight: 700; margin-bottom: var(--space-lg); font-size: var(--text-lg);"
    }, "Mode"));
    const currentTheme = store.activeTheme || "light";
    const lightOption = h("div", {
      className: "theme-option",
      style: "padding: var(--space-lg); border: 2px solid " + (currentTheme === "light" ? "var(--text)" : "var(--border)") + "; margin-bottom: var(--space-md); cursor: pointer; border-radius: 4px; background: white; color: black;",
      onclick: function() {
        applyTheme("light");
        overlay.remove();
        showAppearanceSettings();
      }
    });
    lightOption.appendChild(h("div", { style: "font-weight: 600; margin-bottom: var(--space-xs);" }, (currentTheme === "light" ? "✓ " : "") + "Light Mode"));
    lightOption.appendChild(h("div", { style: "font-size: var(--text-sm); color: #666;" }, "Light color scheme"));
    modeSection.appendChild(lightOption);
    const darkOption = h("div", {
      className: "theme-option",
      style: "padding: var(--space-lg); border: 2px solid " + (currentTheme === "dark" ? "white" : "var(--border)") + "; margin-bottom: var(--space-md); cursor: pointer; border-radius: 4px; background: #1a1a1a; color: white;",
      onclick: function() {
        applyTheme("dark");
        overlay.remove();
        showAppearanceSettings();
      }
    });
    darkOption.appendChild(h("div", { style: "font-weight: 600; margin-bottom: var(--space-xs);" }, (currentTheme === "dark" ? "✓ " : "") + "Dark Mode"));
    darkOption.appendChild(h("div", { style: "font-size: var(--text-sm); color: #aaa;" }, "Dark color scheme"));
    modeSection.appendChild(darkOption);
    modalBody.appendChild(modeSection);
    const themeSection = h("div", { style: "margin-bottom: var(--space-xl);" });
    themeSection.appendChild(h("div", {
      style: "font-weight: 700; margin-bottom: var(--space-lg); font-size: var(--text-lg);"
    }, "Theme Plugins"));
    const themeExtensions = Object.entries(store.plugins || {}).filter(function([modId, plugin]) {
      var manifest = plugin.definition && plugin.definition.manifest || plugin.manifest || plugin.meta || {};
      return manifest.layer === "theme" || manifest.type && manifest.type === "Theme";
    }).map(function([modId, plugin]) {
      var manifest = plugin.definition && plugin.definition.manifest || plugin.manifest || plugin.meta || {};
      return { manifest, meta: manifest, enabled: plugin.enabled, id: modId, isModern: !!plugin.definition };
    });
    async function activateThemePlugin(themeId) {
      if (!(window.CardSpoke && window.CardSpoke.Plugin)) return;
      for (const other of themeExtensions) {
        if (other.isModern && other.enabled && other.id !== themeId) {
          try {
            await window.CardSpoke.Plugin.disable(other.id);
          } catch (err) {
            console.error("[Theme] Failed to suspend", other.id, err);
          }
        }
      }
      if (themeId) {
        await window.CardSpoke.Plugin.enable(themeId);
      }
    }
    const anyThemeEnabled = themeExtensions.some(function(t) {
      return t.enabled;
    });
    if (themeExtensions.length > 0) {
      const defaultThemeOption = h("div", {
        style: "padding: var(--space-md); border: 2px solid " + (!anyThemeEnabled ? "var(--text)" : "var(--border)") + "; border-radius: 4px; margin-bottom: var(--space-sm); cursor: pointer;",
        onclick: async function() {
          try {
            await activateThemePlugin(null);
            showToast("Default theme applied");
          } catch (err) {
            showToast("Failed to apply default theme: " + err.message, "error");
          }
          overlay.remove();
          showAppearanceSettings();
        }
      });
      defaultThemeOption.appendChild(h("div", { style: "font-weight: 600;" }, (!anyThemeEnabled ? "✓ " : "") + "Default Theme"));
      defaultThemeOption.appendChild(h("div", { style: "font-size: var(--text-sm); color: var(--text-muted);" }, "Standard CardSpoke appearance"));
      themeSection.appendChild(defaultThemeOption);
      themeExtensions.forEach(function(theme) {
        const isActive = theme.enabled;
        const themeOption = h("div", {
          style: "padding: var(--space-md); border: 2px solid " + (isActive ? "var(--text)" : "var(--border)") + "; border-radius: 4px; margin-bottom: var(--space-sm); cursor: pointer; display: flex; justify-content: space-between; align-items: center;",
          onclick: async function() {
            if (!theme.isModern) {
              showToast("This theme uses the legacy format and cannot be enabled. Re-install it from the Plugin Manager.", "error");
              return;
            }
            try {
              await activateThemePlugin(theme.id);
              showToast("Theme applied: " + (theme.manifest.name || theme.id));
            } catch (err) {
              showToast("Failed to apply theme: " + err.message, "error");
            }
            overlay.remove();
            showAppearanceSettings();
          }
        });
        const themeInfo = h("div", {});
        themeInfo.appendChild(h("div", { style: "font-weight: 600;" }, (isActive ? "✓ " : "") + (theme.manifest.name || theme.id)));
        themeInfo.appendChild(h("div", { style: "font-size: var(--text-sm); color: var(--text-muted);" }, "By " + (theme.manifest.author || theme.manifest.creator || "Unknown")));
        if (theme.manifest.description) {
          themeInfo.appendChild(h("div", { style: "font-size: var(--text-sm); color: var(--text-muted); margin-top: var(--space-xs);" }, theme.manifest.description));
        }
        themeOption.appendChild(themeInfo);
        const statusBadge = h("span", {
          style: "font-size: var(--text-xs); padding: 2px 8px; border-radius: 10px; background: " + (theme.enabled ? "var(--success, #28a745)" : "var(--text-muted)") + "; color: white;"
        }, theme.enabled ? "Enabled" : "Disabled");
        themeOption.appendChild(statusBadge);
        themeSection.appendChild(themeOption);
      });
    } else {
      themeSection.appendChild(h(
        "div",
        {
          style: "padding: var(--space-lg); background: var(--bg-secondary); border-radius: 4px; text-align: center; color: var(--text-muted);"
        },
        h("div", { style: "margin-bottom: var(--space-sm);" }, "No custom themes installed"),
        h("div", { style: "font-size: var(--text-sm);" }, "Install theme plugins from the Plugin Manager")
      ));
    }
    modalBody.appendChild(themeSection);
    modal.appendChild(modalBody);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    trapFocus(modal);
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.remove();
    };
  }
  function showBookmarks() {
    const overlay = h("div", { className: "modal-overlay show" });
    const modal = h("div", { className: "modal" });
    const modalHeader = h("div", { className: "modal-header" });
    modalHeader.appendChild(h("div", { className: "modal-title" }, "★ Bookmarked Cards"));
    const closeBtn = h("button", { className: "modal-close", "aria-label": "Close dialog", onclick: () => overlay.remove() }, "✕");
    modalHeader.appendChild(closeBtn);
    modal.appendChild(modalHeader);
    const modalBody = h("div", { className: "modal-body" });
    if (!store.bookmarks || store.bookmarks.length === 0) {
      modalBody.appendChild(h("div", { className: "empty" }, "No bookmarked cards yet"));
    } else {
      const bookmarkList = store.bookmarks.map((cardId) => store.cards[cardId]).filter((card) => card).map((card) => {
        const cardItem = h("div", {
          style: "padding: var(--space-lg); border: 1px solid var(--border); margin-bottom: var(--space-md); cursor: pointer;",
          onclick: () => {
            overlay.remove();
            goTo("read", { cardId: card.id });
          }
        });
        const cardHeader = h("div", { style: "display: flex; justify-content: space-between; align-items: center;" });
        cardHeader.appendChild(h("div", { style: "font-weight: 700;" }, card.title || "(Untitled)"));
        const unbookmarkBtn = h("button", {
          className: "btn btn-danger",
          style: "font-size: var(--text-sm);",
          onclick: (e) => {
            e.stopPropagation();
            toggleBookmark(card.id);
            overlay.remove();
            showBookmarks();
          }
        }, "Remove");
        cardHeader.appendChild(unbookmarkBtn);
        cardItem.appendChild(cardHeader);
        if (card.body) {
          const preview = card.body.substring(0, 100) + (card.body.length > 100 ? "..." : "");
          cardItem.appendChild(h("div", { style: "color: var(--text-muted); font-size: var(--text-sm); margin-top: var(--space-sm);" }, preview));
        }
        return cardItem;
      });
      bookmarkList.forEach((item) => modalBody.appendChild(item));
    }
    modal.appendChild(modalBody);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }
  function showRecentCards() {
    const overlay = h("div", { className: "modal-overlay show" });
    const modal = h("div", { className: "modal" });
    const modalHeader = h("div", { className: "modal-header" });
    modalHeader.appendChild(h("div", { className: "modal-title" }, "Recent Cards"));
    const closeBtn = h("button", { className: "modal-close", "aria-label": "Close dialog", onclick: () => overlay.remove() }, "✕");
    modalHeader.appendChild(closeBtn);
    modal.appendChild(modalHeader);
    const modalBody = h("div", { className: "modal-body" });
    if (!store.recentCards || store.recentCards.length === 0) {
      modalBody.appendChild(h("div", { className: "empty" }, "No recently viewed cards"));
    } else {
      const recentList = store.recentCards.map((cardId) => store.cards[cardId]).filter((card) => card).map((card, index) => {
        const cardItem = h("div", {
          style: "padding: var(--space-lg); border: 1px solid var(--border); margin-bottom: var(--space-md); cursor: pointer;",
          onclick: () => {
            overlay.remove();
            goTo("read", { cardId: card.id });
          }
        });
        const cardHeader = h("div", { style: "display: flex; justify-content: space-between; align-items: center;" });
        cardHeader.appendChild(h("div", { style: "font-weight: 700;" }, `${index + 1}. ${card.title || "(Untitled)"}`));
        cardItem.appendChild(cardHeader);
        if (card.body) {
          const preview = card.body.substring(0, 100) + (card.body.length > 100 ? "..." : "");
          cardItem.appendChild(h("div", { style: "color: var(--text-muted); font-size: var(--text-sm); margin-top: var(--space-sm);" }, preview));
        }
        return cardItem;
      });
      recentList.forEach((item) => modalBody.appendChild(item));
    }
    modal.appendChild(modalBody);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }
  function openUploadModalForCard(cardId, tabName) {
    updateImportLocationOptions();
    if (uploadModal.importLocationSelectTXT) {
      uploadModal.importLocationSelectTXT.value = cardId;
    }
    const txtAppendRadio = document.querySelector('input[name="txtImportMode"][value="append"]');
    if (txtAppendRadio) txtAppendRadio.checked = true;
    uploadModal.tabs.forEach((t) => t.classList.remove("active"));
    uploadModal.tabContents.forEach((content) => content.classList.remove("active"));
    const tabEl = document.querySelector(`.modal-tab[data-tab="${tabName}"]`);
    const contentEl = document.getElementById(`tab-${tabName}`);
    if (tabEl) tabEl.classList.add("active");
    if (contentEl) contentEl.classList.add("active");
    uploadModal.overlay.classList.add("show");
  }
  function updateImportLocationOptions() {
    const selectJSON = uploadModal.importLocationSelectJSON;
    const selectTXT = uploadModal.importLocationSelectTXT;
    const sortedCards = Object.values(store.cards).sort((a, b) => {
      const A = (a.title || "").toLowerCase();
      const B = (b.title || "").toLowerCase();
      return A.localeCompare(B);
    });
    if (selectJSON) {
      selectJSON.innerHTML = '<option value="root">Add as Root Cards</option>';
      sortedCards.forEach((card) => {
        const option = document.createElement("option");
        option.value = card.id;
        option.textContent = `Add as children of: ${card.title || "(Untitled)"}`;
        selectJSON.appendChild(option);
      });
    }
    if (selectTXT) {
      selectTXT.innerHTML = '<option value="root">Add as Root Cards (Outline Mode)</option>';
      sortedCards.forEach((card) => {
        const option = document.createElement("option");
        option.value = card.id;
        option.textContent = `Append to / Add children of: ${card.title || "(Untitled)"}`;
        selectTXT.appendChild(option);
      });
    }
  }
  function findCardByName(cardName) {
    _syncStoreToKernel();
    return _kernel.findCardByName(cardName);
  }
  function findCardsByName(cardName, exactMatch = true) {
    _syncStoreToKernel();
    return _kernel.findCardsByName(cardName, exactMatch);
  }
  function resolveCardLinks(text) {
    _syncStoreToKernel();
    return _kernel.resolveCardLinks(text);
  }
  function getTags(cardId) {
    _syncStoreToKernel();
    return _kernel.getTags(cardId);
  }
  function addTag(cardId, tag, skipSave = false, skipUndo = false) {
    _syncStoreToKernel();
    const result = _kernel.addTag(cardId, tag);
    if (result) {
      _syncKernelToStore();
      if (!skipUndo) pushUndo("addTag", { cardId, tag });
      if (!skipSave) save();
    }
    return result;
  }
  function removeTag(cardId, tag, skipSave = false, skipUndo = false) {
    _syncStoreToKernel();
    const result = _kernel.removeTag(cardId, tag);
    if (result) {
      _syncKernelToStore();
      if (!skipUndo) pushUndo("removeTag", { cardId, tag });
      if (!skipSave) save();
    }
    return result;
  }
  function setTags(cardId, tags, skipSave = false) {
    _syncStoreToKernel();
    const result = _kernel.setTags(cardId, tags);
    if (result) {
      _syncKernelToStore();
      if (!skipSave) save();
    }
    return result;
  }
  function getAllTags() {
    _syncStoreToKernel();
    return _kernel.getAllTags();
  }
  function createTagEditor(initialTags, datalistId) {
    const normalized = Array.from(new Set(normalizeTagInput(initialTags.join(" "))));
    const tagSet = new Set(normalized);
    const wrapper = h("div", { className: "tag-editor", role: "list", "aria-label": "Tag editor" });
    const input = h("input", {
      type: "text",
      className: "tag-editor-input",
      list: datalistId,
      placeholder: "Add tags...",
      "aria-label": "Add tag"
    });
    function renderChips() {
      wrapper.querySelectorAll(".tag-chip").forEach((c) => c.remove());
      tagSet.forEach((tag) => {
        const chip = h(
          "span",
          { className: "tag-chip", role: "listitem" },
          h("span", { className: "tag-chip-text" }, tag),
          h("button", {
            type: "button",
            className: "tag-chip-remove",
            "aria-label": `Remove tag ${tag}`,
            onclick: (e) => {
              e.stopPropagation();
              tagSet.delete(tag);
              renderChips();
            }
          }, "×")
        );
        wrapper.insertBefore(chip, input);
      });
    }
    function addTagsFromInput(val) {
      const tags = normalizeTagInput(val);
      tags.forEach((t) => tagSet.add(t));
      renderChips();
      input.value = "";
    }
    input.addEventListener("keydown", (e) => {
      if (["Enter", "Tab", ",", " "].includes(e.key)) {
        addTagsFromInput(input.value);
        if (e.key !== "Tab") e.preventDefault();
      } else if (e.key === "Backspace" && !input.value && tagSet.size) {
        const last = Array.from(tagSet).pop();
        tagSet.delete(last);
        renderChips();
      }
    });
    input.addEventListener("blur", () => addTagsFromInput(input.value));
    renderChips();
    wrapper.appendChild(input);
    wrapper.getTags = () => Array.from(tagSet);
    wrapper.focusInput = () => input.focus();
    return wrapper;
  }
      /**
       * Get all cards that link to a specific card via [[Title]] references.
       * @param {string} cardId - The ID of the card to find backlinks for
       * @returns {Array<{id: string, title: string, body: string}>}
       */
      function getBacklinks(cardId) {
        if (!cardId) return [];
        const card = store.cards[cardId];
        if (!card) return [];
        const result = [];
        for (const id of Object.keys(store.cards)) {
          if (id === cardId) continue;
          const otherCard = store.cards[id];
          if (otherCard.body && hasCardLink(otherCard.body, card.title || '')) {
            result.push({ id: otherCard.id, title: otherCard.title || '(Untitled)', body: otherCard.body });
          }
        }
        return result;
      }
      /**
       * Get related cards based on shared tags.
       * @param {string} cardId - The ID of the card
       * @param {number} [limit=10] - Maximum number of related cards to return
       * @returns {Array<{id: string, title: string, matchScore: number, matchedTags: string[]}>}
       */
      function getRelatedCards(cardId, limit = 10) {
        if (!cardId) return [];
        const cardTags = getTags(cardId);
        if (cardTags.length === 0) return [];
        const related = [];
        for (const id of Object.keys(store.cards)) {
          if (id === cardId) continue;
          const otherCard = store.cards[id];
          const otherTags = getTags(id);
          const matchedTags = cardTags.filter(t => otherTags.includes(t));
          if (matchedTags.length > 0) {
            related.push({
              id: otherCard.id,
              title: otherCard.title || '(Untitled)',
              matchScore: matchedTags.length / Math.max(cardTags.length, otherTags.length),
              matchedTags,
            });
          }
        }
        related.sort((a, b) => b.matchScore - a.matchScore);
        return related.slice(0, limit);
      }
  function getEditPageLabel() {
    if (navState.cardId) return "Edit Card";
    return navState.parentId ? "Add Child Card" : "New Card";
  }
  function renderBreadcrumbs() {
    breadcrumbs.innerHTML = "";
    if (navState.page === "search") {
      breadcrumbs.appendChild(h("span", { className: "breadcrumb current", "aria-current": "page" }, "Search Results"));
      return;
    }
    if (navState.page === "edit") {
      breadcrumbs.appendChild(h("span", { className: "breadcrumb current", "aria-current": "page" }, getEditPageLabel()));
      return;
    }
    let current = navState.cardId;
    const path = [];
    const seenCrumb = /* @__PURE__ */ new Set();
    while (current) {
      if (seenCrumb.has(current)) break;
      seenCrumb.add(current);
      const c = store.cards[current];
      if (!c) break;
      path.unshift(c);
      current = c.parentId;
    }
    if (path.length === 0) {
      breadcrumbs.appendChild(h("span", { className: "breadcrumb current", "aria-current": "page" }, "All Cards"));
    } else {
      const home = h("button", { className: "breadcrumb", onclick: () => goTo('list', { cardId: null }), "aria-label": "Go to All Cards" }, "All Cards");
      breadcrumbs.appendChild(home);
      path.forEach((c, i) => {
        const isCurrent = i === path.length - 1 && navState.page === "list";
        const cls = isCurrent ? "breadcrumb current" : "breadcrumb";
        const chip = isCurrent ? h("span", { className: cls, "aria-current": "page" }, c.title || "(Untitled)") : h("button", { className: cls, onclick: () => goTo('list', { cardId: c.id }), "aria-label": "Go to " + (c.title || "Untitled") }, c.title || "(Untitled)");
        breadcrumbs.appendChild(chip);
      });
    }
  }
  function renderCardList() {
    const parentId = navState.cardId;
    let kids = [];
    if (!parentId) {
      kids = store.rootOrder.map((id) => store.cards[id]).filter((c) => c);
    } else {
      const parent = store.cards[parentId];
      if (!parent) {
        main.appendChild(h("div", { className: "empty" }, "Card not found."));
        return;
      }
      kids = parent.children.map((id) => store.cards[id]).filter((c) => c);
    }
    searchContainer.style.display = "block";
    const title = parentId ? store.cards[parentId]?.title || "Card" : "Top Level Cards";
    main.appendChild(h("div", { className: "page-title" }, title));
    kids.sort((a, b) => (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase()));
    if (kids.length === 0) {
      const emptyEl = h("div", { className: "empty empty-state" });
      emptyEl.appendChild(h("p", {}, "No cards yet. Create one to get started!"));
      emptyEl.appendChild(h("button", {
        className: "empty-new-card-btn",
        onclick: () => goTo('edit', { cardId: null, parentId: parentId || null })
      }, parentId ? "+ Add Child Card" : "+ New Card"));
      main.appendChild(emptyEl);
    } else {
      const gridViewEnabled = localStorage.getItem("cardspoke_gridView") === "true";
      const isCompactMode = store.viewMode === "compact";
      const densityBar = h("div", { className: "density-bar", "aria-label": "Card density" });
      const densityOptions = [
        { key: "default", label: "Default", active: !gridViewEnabled && !isCompactMode },
        { key: "compact", label: "Compact", active: !gridViewEnabled && isCompactMode },
        { key: "grid", label: "Grid", active: gridViewEnabled }
      ];
      densityOptions.forEach((opt) => {
        const btn = h("button", {
          className: "density-btn" + (opt.active ? " active" : ""),
          "aria-pressed": opt.active ? "true" : "false",
          onclick: () => {
            if (opt.key === "grid") {
              localStorage.setItem("cardspoke_gridView", "true");
              if (store.viewMode === "compact") toggleViewMode();
            } else if (opt.key === "compact") {
              localStorage.removeItem("cardspoke_gridView");
              if (store.viewMode !== "compact") toggleViewMode();
            } else {
              localStorage.removeItem("cardspoke_gridView");
              if (store.viewMode === "compact") toggleViewMode();
            }
            render();
          }
        }, opt.label);
        densityBar.appendChild(btn);
      });
      main.appendChild(densityBar);
      const gridClass = gridViewEnabled ? "card-grid grid-view" : "card-grid";
      const grid = h("div", { className: gridClass, role: "list" });
      let renderIndex = 0;
      const batchSize = 60;
      const renderBatch = () => {
        const frag = document.createDocumentFragment();
        const start = renderIndex;
        const upgradeEntries = [];
        for (let i = start; i < Math.min(start + batchSize, kids.length); i++) {
          const card = kids[i];
          const cardEl = renderCardTile(card, { lazyBody: true });
          frag.appendChild(cardEl);
          upgradeEntries.push({ card, tileEl: cardEl });
        }
        grid.appendChild(frag);
        renderIndex += batchSize;
        scheduleCardRenderUpgrade(upgradeEntries);
      };
      const onScroll = () => {
        if (renderIndex >= kids.length) return;
        const threshold = grid.offsetTop + grid.offsetHeight - window.innerHeight * 2;
        if (window.scrollY + window.innerHeight > threshold) {
          requestAnimationFrame(renderBatch);
        }
      };
      renderBatch();
      window.addEventListener("scroll", onScroll, { passive: true });
      registerRenderCleanup(() => window.removeEventListener("scroll", onScroll));
      main.appendChild(grid);
    }
  }
  function renderCardTile(card, opts = {}) {
    const isCompact = store.viewMode === "compact";
    const cardClasses = isCompact ? "card card-compact" : "card";
    const cardEl = h("button", { className: cardClasses + " card-tile", onclick: () => goTo('read', { cardId: card.id }), "aria-label": "Open card: " + (card.title || "Untitled"), role: "listitem" });
    cardEl.dataset.cardId = card.id;
    cardEl.dataset.renderType = "list";
    const contentEl = h("div", { className: "card-content" });
    const titleWrapper = h("div", { style: "display: flex; align-items: center; gap: 8px; min-width: 0;" });
    if (isBookmarked(card.id)) {
      titleWrapper.appendChild(h("span", {
        style: "color: gold; font-size: 18px;",
        title: "Bookmarked"
      }, "★"));
    }
    const titleContent = opts.highlightQuery ? highlightText(card.title || "(Untitled)", opts.highlightQuery) : document.createTextNode(card.title || "(Untitled)");
    const titleDiv = h("div", { className: "card-title" });
    titleDiv.appendChild(titleContent);
    titleWrapper.appendChild(titleDiv);
    contentEl.appendChild(titleWrapper);
    if (card.body && !isCompact) {
      const previewText = card.body.substring(0, 140) + (card.body.length > 140 ? "..." : "");
      const desc = h("div", { className: "card-description" });
      if (opts.highlightQuery) {
        desc.appendChild(highlightText(previewText, opts.highlightQuery));
      } else if (opts.lazyBody) {
        desc.dataset.preview = previewText;
      } else {
        desc.textContent = previewText;
      }
      contentEl.appendChild(desc);
    }
    const tags = card.tags && card.tags.length ? card.tags : extractTags(card.body);
    if (tags.length > 0 && !isCompact) {
      const tagsEl = h("div", { className: "card-tags" });
      tags.forEach((tag) => {
        tagsEl.appendChild(h("span", { className: "card-tag" }, tag));
      });
      contentEl.appendChild(tagsEl);
    }
    cardEl.appendChild(contentEl);
    if (card.children && card.children.length > 0) {
      cardEl.appendChild(h("div", { className: "card-count" }, String(card.children.length)));
    }
    if (opts.lazyBody) {
      if (!previewObserver) {
        previewObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const previewEl = entry.target.querySelector(".card-description[data-preview]");
              if (previewEl && previewEl.dataset.preview) {
                previewEl.textContent = previewEl.dataset.preview;
                delete previewEl.dataset.preview;
              }
              previewObserver.unobserve(entry.target);
            }
          });
        }, { rootMargin: "200px" });
      }
      previewObserver.observe(cardEl);
    }
    return cardEl;
  }
  const cardRenderCache = /* @__PURE__ */ new Map();
  const CARD_RENDER_CACHE_LIMIT = 1e3;
  function buildTileSnapshot(tileEl) {
    const tagEls = tileEl.querySelectorAll(".card-tag");
    return {
      classList: Array.from(tileEl.classList),
      hasBody: !!tileEl.querySelector(".card-description"),
      hasTags: tagEls.length > 0,
      tagTexts: Array.from(tagEls).map((el) => el.textContent),
      isCompact: tileEl.classList.contains("card-compact")
    };
  }
  function applyCardRenderResults(results, byCardId) {
    (results || []).forEach((r) => {
      const entry = byCardId.get(r.cardId);
      if (!entry || !entry.tileEl || !entry.tileEl.isConnected) return;
      if (r.vnode) {
        try {
          const newEl = vnodeToDOM(r.vnode);
          newEl.dataset.cardId = String(r.cardId);
          newEl.dataset.renderType = entry.tileEl.dataset.renderType || "list";
          entry.tileEl.replaceWith(newEl);
          entry.tileEl = newEl;
        } catch (err) {
          console.warn("[Plugin] Card component render failed:", err);
        }
      }
      if (r.patch) {
        try {
          applyPatch(entry.tileEl, r.patch);
        } catch (err) {
          console.warn("[Plugin] card.render patch failed:", err);
        }
      }
    });
  }
  async function scheduleCardRenderUpgrade(entries) {
    const Plugin = window.CardSpoke && window.CardSpoke.Plugin;
    if (!Plugin) return;
    const pluginIds = Plugin.getCardRenderPluginIds();
    if (!pluginIds.length) return;
    const byCardId = /* @__PURE__ */ new Map();
    entries.forEach((e) => {
      if (e.tileEl && e.tileEl.isConnected) byCardId.set(e.card.id, e);
    });
    if (!byCardId.size) return;
    for (const pluginId of pluginIds) {
      const toFetch = [];
      const cachedResults = [];
      byCardId.forEach((entry, cardId) => {
        const cacheKey = pluginId + "|" + cardId + "|" + (entry.card.updatedAt || 0);
        const cached = cardRenderCache.get(cacheKey);
        if (cached) {
          cachedResults.push({ cardId, vnode: cached.vnode, patch: cached.patch });
        } else {
          toFetch.push({ card: entry.card, isSelected: !!entry.isSelected, tileSnapshot: buildTileSnapshot(entry.tileEl) });
        }
      });
      if (cachedResults.length) applyCardRenderResults(cachedResults, byCardId);
      if (toFetch.length) {
        const results = await Plugin.renderBatch(pluginId, toFetch, {});
        if (results) {
          results.forEach((r) => {
            const entry = byCardId.get(r.cardId);
            const key = pluginId + "|" + r.cardId + "|" + (entry ? entry.card.updatedAt || 0 : 0);
            cardRenderCache.set(key, { vnode: r.vnode, patch: r.patch });
          });
          if (cardRenderCache.size > CARD_RENDER_CACHE_LIMIT) {
            const excess = cardRenderCache.size - CARD_RENDER_CACHE_LIMIT;
            const it = cardRenderCache.keys();
            for (let i = 0; i < excess; i++) cardRenderCache.delete(it.next().value);
          }
          applyCardRenderResults(results, byCardId);
        }
      }
    }
  }
  function renderCardBody(text) {
    const container = h("div", { className: "card-detail-body" });
    if (!text) return container;
    const links = parseCardLinks(text);
    if (links.length === 0) {
      container.textContent = text;
      return container;
    }
    links.sort((a, b) => a.startIndex - b.startIndex);
    let lastIndex = 0;
    links.forEach((link) => {
      if (link.startIndex > lastIndex) {
        const textBefore = text.substring(lastIndex, link.startIndex);
        container.appendChild(document.createTextNode(textBefore));
      }
      const cardId = findCardByName(link.cardName);
      const linkEl = h("span", {
        className: cardId ? "card-link" : "card-link-missing",
        style: "cursor: pointer;",
        title: cardId ? `Go to: ${link.cardName}` : `Card not found: ${link.cardName} (click to create)`
      }, link.cardName);
      linkEl.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (cardId) {
          goTo("read", { cardId });
        } else {
          if (await showConfirmDialog(`Card "${link.cardName}" doesn't exist. Create it?`, {
            title: "Create Linked Card",
            confirmLabel: "Create Card",
            cancelLabel: "Cancel",
            confirmClassName: "btn btn-primary"
          })) {
            const newId = createCard(link.cardName, "", null);
            goTo("edit", { cardId: newId });
          }
        }
      });
      container.appendChild(linkEl);
      lastIndex = link.endIndex;
    });
    if (lastIndex < text.length) {
      const textAfter = text.substring(lastIndex);
      container.appendChild(document.createTextNode(textAfter));
    }
    return container;
  }
  function renderRichTextBody(text) {
    const container = h("div", { className: "card-detail-body rich-body", role: "article" });
    if (!text) return container;
    const lines = text.split(/\n/);
    let listEl = null;
    lines.forEach((line) => {
      if (/^#{1,3} /.test(line)) {
        if (listEl) {
          container.appendChild(listEl);
          listEl = null;
        }
        const level = line.match(/^#+/)[0].length;
        const title = line.replace(/^#{1,3} /, "");
        const header2 = h(`h${level}`, {}, title);
        container.appendChild(header2);
        return;
      }
      if (/^-\s+/.test(line)) {
        if (!listEl) listEl = document.createElement("ul");
        const li = document.createElement("li");
        li.textContent = line.replace(/^-\s+/, "");
        listEl.appendChild(li);
        return;
      }
      if (listEl) {
        container.appendChild(listEl);
        listEl = null;
      }
      const para = document.createElement("p");
      let html = escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/_(.+?)_/g, "<em>$1</em>");
      para.innerHTML = html;
      container.appendChild(para);
    });
    if (listEl) container.appendChild(listEl);
    return container;
  }
  function renderReadOnlyCard() {
    searchContainer.style.display = "none";
    const card = store.cards[navState.cardId];
    if (!card) {
      main.appendChild(h("div", { className: "empty" }, "Card not found."));
      return;
    }
    const detail = h("div", { className: "card-detail" });
    detail.appendChild(h("div", { className: "card-detail-title" }, card.title || "(Untitled)"));
    if (card.body) {
      const globalRichText = localStorage.getItem("cardspoke_richtext") === "true";
      const useRichText = globalRichText || card.isRichText;
      detail.appendChild(useRichText ? renderRichTextBody(card.body) : renderCardBody(card.body));
    }
    const _tags = card.tags && card.tags.length ? card.tags : extractTags(card.body);
    if (_tags.length) {
      const tagsWrap = h("div", { className: "card-tags" });
      _tags.forEach((t) => tagsWrap.appendChild(h("span", { className: "card-tag" }, t)));
      detail.appendChild(tagsWrap);
    }
    const actions = h("div", { className: "card-detail-actions" });
    actions.appendChild(h("button", { className: "btn btn-primary", onclick: () => goTo('edit', { cardId: card.id }) }, "Edit"));
    const bookmarkBtnText = isBookmarked(card.id) ? "★ Unbookmark" : "☆ Bookmark";
    actions.appendChild(h("button", {
      className: "btn",
      onclick: (e) => {
        e.stopPropagation();
        toggleBookmark(card.id);
      }
    }, bookmarkBtnText));
    actions.appendChild(h("button", {
      className: "btn",
      onclick: async () => {
        const choice = await showConfirmDialog("Duplicate this card with all of its children?", {
          title: "Duplicate Card",
          confirmLabel: "With Children",
          cancelLabel: "Only This Card",
          confirmClassName: "btn btn-primary"
        });
        const newId = duplicateCard(card.id, choice);
        if (newId) {
          showToast("Card duplicated successfully");
          goTo("read", { cardId: newId });
        }
      }
    }, "Duplicate"));
    actions.appendChild(h("button", {
      className: "btn",
      onclick: () => showShareCard(card.id)
    }, "Share"));
    actions.appendChild(h("button", { className: "btn", onclick: () => {
      goTo("edit", { parentId: card.id });
    } }, "Add Child"));
    actions.appendChild(h("button", { className: "btn", onclick: () => openUploadModalForCard(card.id, "txt") }, "Import TXT"));
    actions.appendChild(h("button", { className: "btn btn-danger", onclick: async () => {
      if (await showConfirmDialog("Delete this card and all of its children?", {
        title: "Delete Card",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        confirmClassName: "btn btn-danger"
      })) {
        deleteCard(card.id);
        goTo("list", { cardId: card.parentId });
      }
    } }, "Delete"));
    detail.appendChild(actions);
    if (card.children && card.children.length > 0) {
      const childrenSection = h("div", { className: "children-section" });
      childrenSection.appendChild(h("div", { className: "children-title" }, `Children (${card.children.length})`));
      const childrenGrid = h("div", { className: "card-grid" });
      const childUpgradeEntries = [];
      card.children.forEach((cid) => {
        const childCard = store.cards[cid];
        if (childCard) {
          const childEl = renderCardTile(childCard);
          childrenGrid.appendChild(childEl);
          childUpgradeEntries.push({ card: childCard, tileEl: childEl });
        }
      });
      scheduleCardRenderUpgrade(childUpgradeEntries);
      childrenSection.appendChild(childrenGrid);
      detail.appendChild(childrenSection);
    }
    const backlinks = getBacklinks(card.id);
    if (backlinks.length > 0) {
      const backlinksSection = h("div", { className: "backlinks-section" });
      backlinksSection.appendChild(h("div", { className: "section-title" }, `← Referenced By (${backlinks.length})`));
      const backlinksGrid = h("div", { className: "card-grid" });
      backlinks.forEach((backlink) => {
        const backlinkTile = h("div", {
          className: "card-tile",
          onclick: () => goTo('read', { cardId: backlink.id })
        });
        backlinkTile.appendChild(h("div", { className: "card-tile-title" }, backlink.title));
        backlinksGrid.appendChild(backlinkTile);
      });
      backlinksSection.appendChild(backlinksGrid);
      detail.appendChild(backlinksSection);
    }
    const relatedCards = getRelatedCards(card.id, 5);
    if (relatedCards.length > 0) {
      const relatedSection = h("div", { className: "related-section" });
      relatedSection.appendChild(h("div", { className: "section-title" }, `Related Cards (${relatedCards.length})`));
      const relatedGrid = h("div", { className: "card-grid" });
      relatedCards.forEach((related) => {
        const relatedTile = h("div", {
          className: "card-tile",
          onclick: () => goTo('read', { cardId: related.id })
        });
        const titleDiv = h("div", { className: "card-tile-title" }, related.title);
        relatedTile.appendChild(titleDiv);
        const tagsDiv = h("div", { className: "card-tags" });
        related.matchedTags.forEach(tag => {
          tagsDiv.appendChild(h("span", { className: "card-tag" }, tag));
        });
        relatedTile.appendChild(tagsDiv);
        relatedGrid.appendChild(relatedTile);
      });
      relatedSection.appendChild(relatedGrid);
      detail.appendChild(relatedSection);
    }
    main.appendChild(detail);
  }
  function renderEditCard() {
    searchContainer.style.display = "none";
    const editing = !!navState.cardId;
    const card = editing ? store.cards[navState.cardId] : {
      id: null,
      title: "",
      body: "",
      parentId: navState.parentId,
      children: []
    };
    if (editing && !card) {
      main.appendChild(h("div", { className: "empty" }, "Card not found."));
      return;
    }
    const form = h("form", {
      onsubmit: (e) => {
        e.preventDefault();
        const titleVal = form.querySelector("#cardTitle").value.trim();
        const bodyVal = form.querySelector("#cardBody").value.trim();
        const parentVal = form.querySelector("#cardParent").value || null;
        const tagsVal = tagEditor.getTags && tagEditor.getTags() || [];
        if (editing) {
          const oldParentId = card.parentId;
          if (oldParentId !== parentVal) {
            if (oldParentId) {
              const oldParent = store.cards[oldParentId];
              if (oldParent) oldParent.children = oldParent.children.filter((c) => c !== card.id);
            } else {
              store.rootOrder = store.rootOrder.filter((c) => c !== card.id);
            }
            if (parentVal) {
              const newParent = store.cards[parentVal];
              if (newParent && !newParent.children.includes(card.id)) newParent.children.push(card.id);
            } else {
              if (!store.rootOrder.includes(card.id)) store.rootOrder.push(card.id);
            }
            card.parentId = parentVal;
          }
          updateCard(card.id, { title: titleVal, body: bodyVal, tags: tagsVal, isRichText: richToggle.checked }, true, true);
          card.children.forEach((cid) => {
            const inp = childrenInpMap[cid];
            if (inp) updateCard(cid, { title: inp.value.trim() }, true, true);
          });
          const newKidRows = form.querySelectorAll("#addChildList .form-child-row input");
          newKidRows.forEach((inp) => {
            const t = inp.value.trim();
            if (t) createCard(t, "", card.id, true, true);
          });
          save();
          goTo("read", { cardId: card.id });
        } else {
          const newId = createCard(titleVal, bodyVal, parentVal, true, true);
          updateCard(newId, { tags: tagsVal, isRichText: richToggle.checked }, true, true);
          const newKidRows = form.querySelectorAll("#addChildList .form-child-row input");
          newKidRows.forEach((inp) => {
            const t = inp.value.trim();
            if (t) createCard(t, "", newId, true, true);
          });
          save();
          goTo("read", { cardId: newId });
        }
      }
    });
    const formGroup1 = h("div", { className: "form-group" });
    formGroup1.appendChild(h("label", { className: "form-label", for: "cardTitle" }, "Title"));
    formGroup1.appendChild(h("input", { type: "text", id: "cardTitle", className: "form-input", value: card.title, oninput: () => {
      setDirty(true);
    } }));
    form.appendChild(formGroup1);
    const formGroup2 = h("div", { className: "form-group" });
    const bodyLabelRow = h("div", { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-sm);" });
    bodyLabelRow.appendChild(h("label", { className: "form-label", style: "margin-bottom: 0;" }, "Body"));
    const importBodyBtn = h("button", {
      type: "button",
      className: "btn",
      style: "font-size: var(--text-sm);",
      onclick: function() {
        const fileInput = h("input", { type: "file", accept: ".txt,.md,.text", style: "display: none" });
        fileInput.onchange = function(e) {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = async function(ev) {
              const currentBody = document.getElementById("cardBody");
              const importAction = !currentBody.value ? "replace" : await showChoiceDialog(
                "How would you like to apply the imported file contents to this card body?",
                {
                  title: "Import Text File",
                  dismissValue: "cancel",
                  actions: [
                    { label: "Cancel", value: "cancel", className: "btn" },
                    { label: "Append", value: "append", className: "btn" },
                    { label: "Replace", value: "replace", className: "btn btn-primary" }
                  ]
                }
              );
              if (importAction === "cancel") {
                return;
              }
              if (importAction === "append") {
                currentBody.value += "\n\n" + ev.target.result;
              } else {
                currentBody.value = ev.target.result;
              }
              setDirty(true);
              showToast("Content imported from " + file.name);
            };
            reader.onerror = function() {
              showToast("Failed to read file", "error");
            };
            reader.readAsText(file);
          }
        };
        fileInput.click();
      }
    }, "Import from File");
    bodyLabelRow.appendChild(importBodyBtn);
    formGroup2.appendChild(bodyLabelRow);
    const richToggleRow = h("div", { className: "form-row" });
    const richToggle = h("input", { type: "checkbox", id: "cardRich", checked: card.isRichText });
    const richLabel = h("label", { for: "cardRich", style: "margin-left: 6px;" }, "Enable formatting (Markdown)");
    richToggle.addEventListener("change", () => {
      setDirty(true);
    });
    richToggleRow.appendChild(richToggle);
    richToggleRow.appendChild(richLabel);
    formGroup2.appendChild(richToggleRow);
    const bodyTextarea = h("textarea", { id: "cardBody", className: "form-textarea", "aria-label": "Card body" });
    bodyTextarea.value = card.body;
    bodyTextarea.addEventListener("input", () => {
      setDirty(true);
    });
    const toolbar = h("div", { className: "rich-toolbar", role: "toolbar", "aria-label": "Formatting toolbar" });
    const applyWrap = (before, after = before) => {
      const start = bodyTextarea.selectionStart;
      const end = bodyTextarea.selectionEnd;
      const selected = bodyTextarea.value.substring(start, end) || "text";
      const newValue = bodyTextarea.value.slice(0, start) + before + selected + after + bodyTextarea.value.slice(end);
      bodyTextarea.value = newValue;
      bodyTextarea.focus();
      bodyTextarea.selectionStart = start + before.length;
      bodyTextarea.selectionEnd = start + before.length + selected.length;
      setDirty(true);
    };
    const addBlockPrefix = (prefix) => {
      const cursor = bodyTextarea.selectionStart;
      const value = bodyTextarea.value;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const newText = before + `
${prefix}`;
      bodyTextarea.value = newText + after;
      bodyTextarea.focus();
      setDirty(true);
    };
    const buttonGroups = [
      [
        { label: "B", action: () => applyWrap("**", "**"), aria: "Bold" },
        { label: "I", action: () => applyWrap("_", "_"), aria: "Italic" }
      ],
      [
        { label: "H1", action: () => addBlockPrefix("# "), aria: "Heading 1" },
        { label: "H2", action: () => addBlockPrefix("## "), aria: "Heading 2" },
        { label: "H3", action: () => addBlockPrefix("### "), aria: "Heading 3" },
        { label: "• List", action: () => addBlockPrefix("- "), aria: "Bullet list" }
      ]
    ];
    buttonGroups.forEach((grp, gi) => {
      if (gi > 0) toolbar.appendChild(h("span", { className: "toolbar-sep", "aria-hidden": "true" }));
      grp.forEach((btn) => {
        const el = h("button", { type: "button", className: "btn btn-ghost", "aria-label": btn.aria, title: btn.aria, onclick: btn.action });
        el.textContent = btn.label;
        toolbar.appendChild(el);
      });
    });
    formGroup2.appendChild(toolbar);
    formGroup2.appendChild(bodyTextarea);
    form.appendChild(formGroup2);
    const formGroupTags = h("div", { className: "form-group" });
    formGroupTags.appendChild(h("label", { className: "form-label" }, "Tags (comma-separated)"));
    const tagsDatalistId = "tags-datalist-" + Date.now();
    const tagsDatalist = h("datalist", { id: tagsDatalistId });
    const existingTags = getAllTags();
    existingTags.forEach((tag) => {
      tagsDatalist.appendChild(h("option", { value: tag }));
    });
    const tagEditor = createTagEditor(card.tags || [], tagsDatalistId);
    tagEditor.addEventListener("focusin", () => {
      setDirty(true);
    });
    formGroupTags.appendChild(tagEditor);
    formGroupTags.appendChild(tagsDatalist);
    form.appendChild(formGroupTags);
    if (editing && card.id) {
      const suggestBtn = h("button", {
        type: "button",
        className: "btn btn-secondary",
        onclick: () => showTagSuggestions(card.id),
        style: "margin-top: var(--space-sm);"
      }, "Suggest Tags");
      formGroupTags.appendChild(suggestBtn);
    }
    const formGroup3 = h("div", { className: "form-group" });
    formGroup3.appendChild(h("label", { className: "form-label", for: "cardParent" }, "Parent Card"));
    const parentFilter = h("input", {
      type: "text",
      className: "form-input parent-filter-input",
      placeholder: "Filter parent cards…",
      "aria-label": "Filter parent cards"
    });
    const parentSel = h("select", { id: "cardParent", className: "form-select" });
    const parVal = card.parentId || "";
    parentSel.appendChild(h("option", { value: "", selected: !parVal }, "(Root Level)"));
    const excludedParentIds = /* @__PURE__ */ new Set([card.id]);
    if (editing && card.id) {
      const descStack = [card.id];
      const seenDesc = /* @__PURE__ */ new Set();
      while (descStack.length) {
        const curId = descStack.pop();
        if (seenDesc.has(curId)) continue;
        seenDesc.add(curId);
        const cur = store.cards[curId];
        if (cur && Array.isArray(cur.children)) {
          for (const kid of cur.children) {
            excludedParentIds.add(kid);
            descStack.push(kid);
          }
        }
      }
    }
    const parentCards = Object.values(store.cards).filter((c) => !excludedParentIds.has(c.id)).sort((a, b) => (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase()));
    parentCards.forEach((c) => {
      parentSel.appendChild(h("option", { value: c.id, selected: parVal === c.id }, c.title || "(Untitled)"));
    });
    parentFilter.addEventListener("input", () => {
      const val = parentFilter.value.toLowerCase();
      Array.from(parentSel.options).forEach((opt) => {
        if (opt.value === "") return;
        opt.hidden = val.length > 0 && !opt.text.toLowerCase().includes(val);
      });
    });
    parentSel.addEventListener("change", () => {
      setDirty(true);
    });
    formGroup3.appendChild(parentFilter);
    formGroup3.appendChild(parentSel);
    form.appendChild(formGroup3);
    let childrenInpMap = {};
    if (editing) {
      const formGroup4 = h("div", { className: "form-group" });
      formGroup4.appendChild(h("label", { className: "form-label form-section-title" }, "Children"));
      const kidsWrap = h("div", { className: "form-children" });
      card.children.forEach((cid) => {
        const c = store.cards[cid];
        const row = h("div", { className: "form-child-row" });
        const chInp = h("input", { type: "text", value: c.title, className: "form-input form-child-input", "aria-label": "Child card title" });
        chInp.addEventListener("input", () => {
          setDirty(true);
        });
        row.appendChild(chInp);
        const delBtn = h("button", {
          type: "button",
          className: "form-child-delete",
          "aria-label": "Delete child card",
          title: "Delete child card",
          onclick: async () => {
            if (await showConfirmDialog("Delete this child card and all of its children?", {
              title: "Delete Child Card",
              confirmLabel: "Delete",
              cancelLabel: "Cancel",
              confirmClassName: "btn btn-danger"
            })) {
              deleteCard(cid);
              save();
              render();
            }
          }
        }, "✕");
        row.appendChild(delBtn);
        childrenInpMap[cid] = chInp;
        kidsWrap.appendChild(row);
      });
      formGroup4.appendChild(kidsWrap);
      form.appendChild(formGroup4);
      const formGroup5 = h("div", { className: "form-group" });
      formGroup5.appendChild(h("label", { className: "form-label form-section-title" }, "Add New Children"));
      const newKidsWrap = h("div", { className: "form-children", id: "addChildList" });
      const addChildRow = (title = "") => {
        const r = h("div", { className: "form-child-row" });
        const t = h("input", { type: "text", value: title, placeholder: "Child title...", className: "form-input form-child-input", "aria-label": "New child card title" });
        t.addEventListener("input", () => {
          setDirty(true);
        });
        const d = h("button", { type: "button", className: "form-child-delete", "aria-label": "Remove child row", title: "Remove child row", onclick: () => {
          r.remove();
        } }, "✕");
        r.appendChild(t);
        r.appendChild(d);
        newKidsWrap.appendChild(r);
      };
      addChildRow();
      formGroup5.appendChild(newKidsWrap);
      formGroup5.appendChild(h("button", { type: "button", className: "btn", onclick: () => addChildRow() }, "+ Add Another Child"));
      form.appendChild(formGroup5);
    } else {
      const formGroup4 = h("div", { className: "form-group" });
      formGroup4.appendChild(h("label", { className: "form-label form-section-title" }, "Add Children Now (title only)"));
      const kidsWrap = h("div", { className: "form-children", id: "addChildList" });
      const addChildRow = (title = "") => {
        const r = h("div", { className: "form-child-row" });
        const t = h("input", { type: "text", value: title, placeholder: "Child title...", className: "form-input form-child-input", "aria-label": "New child card title" });
        t.addEventListener("input", () => {
          setDirty(true);
        });
        const d = h("button", { type: "button", className: "form-child-delete", "aria-label": "Remove child row", title: "Remove child row", onclick: () => {
          r.remove();
        } }, "✕");
        r.appendChild(t);
        r.appendChild(d);
        kidsWrap.appendChild(r);
      };
      addChildRow();
      formGroup4.appendChild(kidsWrap);
      formGroup4.appendChild(h("button", { type: "button", className: "btn", onclick: () => addChildRow() }, "+ Add Another Child"));
      form.appendChild(formGroup4);
    }
    const formActions = h("div", { className: "form-actions" });
    formActions.appendChild(h("button", { type: "submit", className: "btn btn-primary" }, "Save"));
    formActions.appendChild(h("button", { type: "button", className: "btn", onclick: () => editing ? goTo("read", { cardId: card.id }) : goBack() }, "Cancel"));
    if (editing) {
      formActions.appendChild(h("button", {
        type: "button",
        className: "btn btn-danger",
        onclick: async () => {
          if (await showConfirmDialog("Delete this card and all of its children?", {
            title: "Delete Card",
            confirmLabel: "Delete",
            cancelLabel: "Cancel",
            confirmClassName: "btn btn-danger"
          })) {
            deleteCard(card.id);
            save();
            goTo("list", { cardId: card.parentId ?? null });
          }
        }
      }, "Delete"));
    }
    form.appendChild(formActions);
    const editWrapper = h("div", { className: "card-edit-form" });
    main.appendChild(h("div", { className: "page-title" }, editing ? "Edit Card" : getEditPageLabel()));
    editWrapper.appendChild(form);
    main.appendChild(editWrapper);
  }
  function renderSearchResults() {
    searchContainer.style.display = "block";
    if (searchInput && searchInput.value.trim() !== navState.searchQuery.trim()) {
      searchInput.value = navState.searchQuery;
    }
    const query = navState.searchQuery.trim();
    if (!query) {
      main.appendChild(h("div", { className: "empty" }, "Please enter a search term."));
      return;
    }
    const scope = datasetSelector ? datasetSelector.value : "current";
    main.appendChild(h("div", { className: "page-title" }, `Search: "${navState.searchQuery}"`));
    const loadingDiv = h("div", {
      className: "search-info",
      style: "padding: 12px; margin-bottom: 12px; background: var(--bg-secondary); border-radius: 8px; font-size: 14px; color: var(--text-secondary);"
    }, "Searching...");
    main.appendChild(loadingDiv);
    fuzzySearchMultiDataset(query, scope).then((fuzzyResults) => {
      loadingDiv.remove();
      try {
        const filtersStr = sessionStorage.getItem("searchFilters");
        if (filtersStr) {
          const filters = JSON.parse(filtersStr);
          if (filters.tagFilter) {
            const tagFilterLower = filters.tagFilter.toLowerCase();
            fuzzyResults = fuzzyResults.filter((result) => {
              const card = result.card;
              return card.tags && card.tags.some((tag) => tag.toLowerCase() === tagFilterLower);
            });
          }
          if (filters.bookmarkOnly) {
            fuzzyResults = fuzzyResults.filter((result) => result.card.bookmarked === true);
          }
          if (filters.dateFilter) {
            const now = Date.now();
            let startTime = 0;
            if (filters.dateFilter === "today") {
              const today = /* @__PURE__ */ new Date();
              today.setHours(0, 0, 0, 0);
              startTime = today.getTime();
            } else if (filters.dateFilter === "week") {
              startTime = now - 7 * 24 * 60 * 60 * 1e3;
            } else if (filters.dateFilter === "month") {
              startTime = now - 30 * 24 * 60 * 60 * 1e3;
            }
            fuzzyResults = fuzzyResults.filter((result) => {
              const card = result.card;
              return card.createdAt && card.createdAt >= startTime || card.updatedAt && card.updatedAt >= startTime;
            });
          }
          sessionStorage.removeItem("searchFilters");
        }
      } catch (err) {
        console.error("Error applying search filters:", err);
      }
      const hookResults = fuzzyResults.map((result) => ({
        ...result,
        card: cloneCard(result.card)
      }));
      if (fuzzyResults.length === 0) {
        main.appendChild(h("div", { className: "empty" }, "No results found. Try different keywords."));
      } else {
        const scopeText = scope === "all" ? " across all datasets" : "";
        const resultInfo = h("div", {
          className: "search-info",
          style: "padding: 12px; margin-bottom: 8px; background: var(--bg-secondary); border-radius: 8px; font-size: 14px; color: var(--text-secondary);"
        }, `Found ${fuzzyResults.length} result${fuzzyResults.length === 1 ? "" : "s"}${scopeText}${fuzzyResults.some((result) => result.approximate) ? " (approximate matches marked with ~)" : ""}`);
        main.appendChild(resultInfo);
        let currentSortMode = "relevance";
        const sortBar = h("div", { className: "sort-bar", "aria-label": "Sort results" });
        sortBar.appendChild(h("span", { className: "sort-bar-label" }, "Sort:"));
        const sortOptions = [
          { key: "relevance", label: "Relevance" },
          { key: "title", label: "Title" },
          { key: "newest", label: "Newest" },
          { key: "updated", label: "Updated" }
        ];
        const applySortMode = (mode) => {
          currentSortMode = mode;
          sortBar.querySelectorAll(".sort-btn").forEach((b) => b.classList.toggle("active", b.dataset.sortKey === mode));
          const grid2 = main.querySelector("#searchResultGrid");
          if (!grid2) return;
          const sorted = fuzzyResults.slice().sort((a, b) => {
            if (mode === "title") return (a.card.title || "").toLowerCase().localeCompare((b.card.title || "").toLowerCase());
            if (mode === "newest") return (b.card.createdAt || 0) - (a.card.createdAt || 0);
            if (mode === "updated") return (b.card.updatedAt || b.card.createdAt || 0) - (a.card.updatedAt || a.card.createdAt || 0);
            return 0;
          });
          const frag = document.createDocumentFragment();
          sorted.forEach((result, i) => {
            const el = grid2.querySelector(`[data-result-index="${fuzzyResults.indexOf(result)}"]`);
            if (el) frag.appendChild(el);
          });
          grid2.appendChild(frag);
        };
        sortOptions.forEach((opt) => {
          const btn = h("button", {
            className: "sort-btn" + (opt.key === "relevance" ? " active" : ""),
            "data-sort-key": opt.key,
            onclick: () => applySortMode(opt.key)
          }, opt.label);
          sortBar.appendChild(btn);
        });
        main.appendChild(sortBar);
        const keyboardHint = h(
          "div",
          {
            className: "search-keyboard-hint",
            style: "padding: 8px 12px; margin-bottom: 12px; background: var(--bg-alt, var(--bg-secondary)); border: 1px solid var(--border); border-radius: 6px; font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 12px;"
          },
          h("span", { style: "opacity: 0.7;" }, "💡"),
          h(
            "span",
            {},
            h("kbd", { style: "background: var(--bg-primary); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border); font-size: 12px; font-family: monospace;" }, "↑"),
            " / ",
            h("kbd", { style: "background: var(--bg-primary); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border); font-size: 12px; font-family: monospace;" }, "↓"),
            " to navigate • ",
            h("kbd", { style: "background: var(--bg-primary); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border); font-size: 12px; font-family: monospace;" }, "Enter"),
            " to open"
          )
        );
        main.appendChild(keyboardHint);
        const gridViewEnabled = localStorage.getItem("cardspoke_gridView") === "true";
        const gridClass = gridViewEnabled ? "card-grid grid-view" : "card-grid";
        const grid = h("div", { className: gridClass, role: "list", id: "searchResultGrid" });
        setSearchResultsState({ items: fuzzyResults, elements: [], selectedIndex: 0 });
        const batchSize = 50;
        let renderIndex = 0;
        const renderBatch = () => {
          const frag = document.createDocumentFragment();
          const upgradeEntries = [];
          for (let i = renderIndex; i < Math.min(renderIndex + batchSize, fuzzyResults.length); i++) {
            const result = fuzzyResults[i];
            const card = result.card;
            const cardEl = renderCardTile(card, { highlightQuery: query, lazyBody: true });
            upgradeEntries.push({ card, tileEl: cardEl });
            cardEl.classList.add("search-result");
            cardEl.dataset.resultIndex = i;
            cardEl.addEventListener("click", () => {
              searchResultsState.selectedIndex = i;
              updateSearchSelection(0);
            });
            if (scope === "all" && result.datasetName) {
              const datasetBadge = h("span", {
                style: "position: absolute; top: 8px; left: 8px; background: #3b82f6; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;"
              }, result.datasetName);
              cardEl.style.position = "relative";
              cardEl.appendChild(datasetBadge);
              const activeKey = instanceKey || "nested_cards_store";
              if (result.datasetId && result.datasetId !== activeKey) {
                cardEl.onclick = async () => {
                  await flushPendingSave();
                  localStorage.setItem("activeInstance", result.datasetId);
                  setInstanceKey(result.datasetId);
                  await load();
                  if (typeof reconcilePluginsAfterDatasetSwitch === "function") {
                    await reconcilePluginsAfterDatasetSwitch();
                  }
                  if (store.cards && store.cards[card.id]) {
                    goTo("read", { cardId: card.id });
                  } else {
                    render();
                  }
                  showToast("Switched to dataset: " + result.datasetName);
                };
              }
            }
            if (result.approximate) {
              const matchBadge = h("span", {
                style: "position: absolute; top: 8px; right: 8px; background: #fbbf24; color: #000; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;"
              }, "~");
              cardEl.style.position = "relative";
              cardEl.appendChild(matchBadge);
            }
            frag.appendChild(cardEl);
            searchResultsState.elements.push(cardEl);
          }
          grid.appendChild(frag);
          renderIndex += batchSize;
          updateSearchSelection(0);
          scheduleCardRenderUpgrade(upgradeEntries);
        };
        const onScroll = () => {
          if (renderIndex >= fuzzyResults.length) return;
          const threshold = grid.offsetTop + grid.offsetHeight - window.innerHeight * 2;
          if (window.scrollY + window.innerHeight > threshold) {
            requestAnimationFrame(renderBatch);
          }
        };
        renderBatch();
        window.addEventListener("scroll", onScroll, { passive: true });
        registerRenderCleanup(() => window.removeEventListener("scroll", onScroll));
        main.appendChild(grid);
      }
    }).catch((err) => {
      loadingDiv.remove();
      main.appendChild(h("div", { className: "empty" }, "Search error: " + err.message));
    });
  }
  function render() {
    try {
      runRenderCleanup();
      renderBreadcrumbs();
      main.innerHTML = "";
      switch (navState.page) {
        case "read":
          renderReadOnlyCard();
          break;
        case "list":
          renderCardList();
          break;
        case "search":
          renderSearchResults();
          break;
        case "edit":
          renderEditCard();
          break;
        default:
          renderCardList();
      }
    } catch (e) {
      bootError("Render failed: " + (e.message || e));
    }
  }
  async function applyRegistryComponents() {
    if (!window.CardSpoke || !window.CardSpoke.ComponentRegistry) {
      return;
    }
    const registry = window.CardSpoke.ComponentRegistry;
    const CustomHeader = registry.get("Header");
    if (CustomHeader && typeof CustomHeader.render === "function") {
      try {
        const headerEl = document.querySelector(".header");
        if (headerEl) {
          const customEl = await CustomHeader.render({ header: headerEl });
          if (customEl instanceof HTMLElement) {
            headerEl.parentNode.replaceChild(customEl, headerEl);
            console.log("[ComponentRegistry] Custom Header component applied");
          }
        }
      } catch (err) {
        console.warn("[ComponentRegistry] Custom Header render failed, using default:", err);
      }
    }
    const CustomSidebar = registry.get("Sidebar");
    if (CustomSidebar && typeof CustomSidebar.render === "function") {
      try {
        const menuPanel = document.querySelector(".menu-panel");
        if (menuPanel) {
          const customEl = await CustomSidebar.render({ panel: menuPanel });
          if (customEl instanceof HTMLElement) {
            menuPanel.parentNode.replaceChild(customEl, menuPanel);
            console.log("[ComponentRegistry] Custom Sidebar component applied");
          }
        }
      } catch (err) {
        console.warn("[ComponentRegistry] Custom Sidebar render failed, using default:", err);
      }
    }
    const CustomSearchBar = registry.get("SearchBar");
    if (CustomSearchBar && typeof CustomSearchBar.render === "function") {
      try {
        const searchWrapper = document.querySelector(".search-input-wrapper");
        if (searchWrapper) {
          const customEl = await CustomSearchBar.render({ wrapper: searchWrapper });
          if (customEl instanceof HTMLElement) {
            searchWrapper.parentNode.replaceChild(customEl, searchWrapper);
            console.log("[ComponentRegistry] Custom SearchBar component applied");
          }
        }
      } catch (err) {
        console.warn("[ComponentRegistry] Custom SearchBar render failed, using default:", err);
      }
    }
  }
  function applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    store.activeTheme = theme;
    save();
    try {
      localStorage.setItem("cardspoke_theme", theme);
    } catch {
    }
    const moonIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    const sunIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    if (header.themeToggle) header.themeToggle.innerHTML = theme === "dark" ? sunIcon : moonIcon;
  }
  function populateFooter() {
    try {
      const creatorEl = document.getElementById("app-creator");
      const versionEl = document.getElementById("app-version");
      const dateEl = document.getElementById("app-release-date");
      const updaterEl = document.getElementById("app-updater");
      if (!creatorEl || !versionEl || !dateEl || !updaterEl) {
        console.error("[Footer] Missing footer elements:", {
          creator: !!creatorEl,
          version: !!versionEl,
          date: !!dateEl,
          updater: !!updaterEl
        });
        return;
      }
      creatorEl.textContent = APP_CREATOR;
      versionEl.textContent = APP_VERSION;
      dateEl.textContent = APP_RELEASE_DATE;
      updaterEl.textContent = APP_UPDATER;
      if (isDeveloperMode()) {
        console.log("[Footer] Populated successfully:", {
          creator: APP_CREATOR,
          version: APP_VERSION,
          date: APP_RELEASE_DATE,
          updater: APP_UPDATER
        });
      }
    } catch (error) {
      console.error("[Footer] Error populating footer:", error);
    }
  }
  function updateDatasetSelector() {
    if (!datasetSelector) return;
    datasetSelector.innerHTML = "";
    const currentOption = document.createElement("option");
    currentOption.value = "current";
    currentOption.textContent = "Current Dataset";
    datasetSelector.appendChild(currentOption);
    const datasetKeys = typeof getAllDatasetKeys === "function" ? getAllDatasetKeys() : [];
    const currentKey = instanceKey || "nested_cards_store";
    const datasets = datasetKeys.map((key) => {
      let name = key;
      try {
        const parsed = JSON.parse(localStorage.getItem(key));
        if (parsed && parsed.encrypted === true) {
          name = key + " (encrypted)";
        } else if (parsed && parsed.metadata && parsed.metadata.name) {
          name = parsed.metadata.name;
        }
      } catch (_e) {
      }
      return { id: key, name, isActive: key === currentKey };
    });
    if (datasets.length > 1) {
      const allOption = document.createElement("option");
      allOption.value = "all";
      allOption.textContent = "All Datasets";
      datasetSelector.appendChild(allOption);
      const separator = document.createElement("option");
      separator.disabled = true;
      separator.textContent = "───────────";
      datasetSelector.appendChild(separator);
      datasets.forEach((dataset) => {
        const option = document.createElement("option");
        option.value = dataset.id;
        option.textContent = dataset.name + (dataset.isActive ? " (active)" : "");
        datasetSelector.appendChild(option);
      });
    }
  }
  const savedTheme = store.activeTheme || localStorage.getItem("cardspoke_theme") || "light";
  applyTheme(savedTheme);
  if (header.themeToggle) header.themeToggle.onclick = () => {
    const isDark = document.documentElement.classList.contains("dark");
    applyTheme(isDark ? "light" : "dark");
  };
  const savedHC = localStorage.getItem("cardspoke_highcontrast") === "true";
  if (savedHC) document.documentElement.classList.add("high-contrast");
  let menuFocusTrapCleanup = null;
  function lockBodyScroll() {
    document.body.classList.add("scroll-locked");
  }
  function unlockBodyScroll() {
    document.body.classList.remove("scroll-locked");
  }
  function closeMenuOverlay() {
    if (menu.overlay) menu.overlay.classList.remove("show");
    unlockBodyScroll();
    if (menuFocusTrapCleanup) {
      menuFocusTrapCleanup();
      menuFocusTrapCleanup = null;
    }
  }
  if (header.menuBtn && menu.overlay) header.menuBtn.onclick = () => {
    menu.overlay.classList.add("show");
    lockBodyScroll();
    if (menu.developerSection) {
      menu.developerSection.style.display = isDeveloperMode() ? "block" : "none";
    }
    if (menuFocusTrapCleanup) {
      menuFocusTrapCleanup();
      menuFocusTrapCleanup = null;
    }
    const panel = menu.overlay.querySelector(".menu-panel");
    if (panel) menuFocusTrapCleanup = trapFocus(panel);
  };
  if (menu.closeBtn) menu.closeBtn.onclick = () => {
    closeMenuOverlay();
  };
  if (menu.overlay) menu.overlay.onclick = (e) => {
    if (e.target === menu.overlay) {
      closeMenuOverlay();
    }
  };
  if (menu.newCard) menu.newCard.onclick = () => {
    closeMenuOverlay();
    goTo("edit", { cardId: null, parentId: null });
  };
  if (menu.upload) menu.upload.onclick = () => {
    closeMenuOverlay();
    updateImportLocationOptions();
    if (uploadModal.importLocationSelectJSON) {
      uploadModal.importLocationSelectJSON.value = "root";
    }
    if (uploadModal.importLocationSelectTXT) {
      uploadModal.importLocationSelectTXT.value = "root";
    }
    const txtOutlineRadio = document.querySelector('input[name="txtImportMode"][value="outline"]');
    if (txtOutlineRadio) txtOutlineRadio.checked = true;
    const lastTab = localStorage.getItem("cardspoke_lastUploadTab") || "json";
    uploadModal.tabs.forEach((t) => t.classList.remove("active"));
    uploadModal.tabContents.forEach((content) => content.classList.remove("active"));
    const tabToActivate = document.querySelector(`.modal-tab[data-tab="${lastTab}"]`) || document.querySelector('.modal-tab[data-tab="json"]');
    const contentToActivate = document.getElementById(`tab-${lastTab}`) || document.getElementById("tab-json");
    if (tabToActivate) tabToActivate.classList.add("active");
    if (contentToActivate) contentToActivate.classList.add("active");
    uploadModal.overlay.classList.add("show");
    lockBodyScroll();
  };
  if (menu.pluginManager) menu.pluginManager.onclick = () => {
    closeMenuOverlay();
    showPluginManager("installed");
  };
  if (menu.tagManager) {
    menu.tagManager.onclick = () => {
      closeMenuOverlay();
      showTagManager();
    };
  }
  if (menu.advancedSearch) {
    menu.advancedSearch.onclick = () => {
      closeMenuOverlay();
      showAdvancedSearch();
    };
  }
  if (menu.trashBin) {
    menu.trashBin.onclick = () => {
      closeMenuOverlay();
      showTrashBin();
    };
  }
  if (menu.appearance) menu.appearance.onclick = () => {
    closeMenuOverlay();
    showAppearanceSettings();
  };
  if (menu.bookmarks) menu.bookmarks.onclick = () => {
    closeMenuOverlay();
    showBookmarks();
  };
  if (menu.recentCards) menu.recentCards.onclick = () => {
    closeMenuOverlay();
    showRecentCards();
  };
  if (menu.typography) {
    menu.typography.onclick = () => {
      closeMenuOverlay();
      showTypographySelector();
    };
  }
  if (menu.dataHub) menu.dataHub.onclick = () => {
    closeMenuOverlay();
    showDatasetInfo();
  };
  if (menu.clearAll) menu.clearAll.onclick = () => {
    closeMenuOverlay();
    clearAllData();
  };
  if (menu.gettingStarted) menu.gettingStarted.onclick = () => {
    closeMenuOverlay();
    showGettingStarted();
  };
  if (menu.help) menu.help.onclick = () => {
    closeMenuOverlay();
    showHelp();
  };
  if (menu.keyboardShortcuts) menu.keyboardShortcuts.onclick = () => {
    closeMenuOverlay();
    showKeyboardHelp();
  };
  if (menu.developerConsole) {
    menu.developerConsole.onclick = () => {
      closeMenuOverlay();
      showDeveloperConsole();
    };
  }
  const debouncedNavigateSearch = debounce((query) => {
    if (query) {
      goTo("search", { searchQuery: query });
    }
  }, 180);
  function updateSearchSelection(delta = 0) {
    if (!searchResultsState.items.length) return;
    const rendered = searchResultsState.elements.length;
    const max = (rendered > 0 ? rendered : searchResultsState.items.length) - 1;
    const next = Math.min(max, Math.max(0, searchResultsState.selectedIndex + delta));
    searchResultsState.selectedIndex = next;
    searchResultsState.elements.forEach((el, idx) => {
      if (idx === next) el.classList.add("search-result-selected");
      else el.classList.remove("search-result-selected");
    });
    const active = searchResultsState.elements[next];
    if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function openSelectedSearchResult() {
    if (!searchResultsState.items.length) return;
    const target = searchResultsState.items[searchResultsState.selectedIndex];
    if (target?.card?.id) goTo("read", { cardId: target.card.id });
  }
  if (header.homeBtn) header.homeBtn.onclick = () => {
    goTo("list", { cardId: null });
  };
  if (header.brandBtn) header.brandBtn.onclick = () => {
    goTo("list", { cardId: null });
  };
  if (header.undoBtn) header.undoBtn.onclick = () => {
    undo();
  };
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      if (e.target.value.trim()) {
        if (searchClear) searchClear.style.display = "block";
      } else {
        if (searchClear) searchClear.style.display = "none";
      }
      if (navState.page === "search") {
        debouncedNavigateSearch(e.target.value.trim());
      }
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && searchInput.value.trim()) {
        if (navState.page === "search" && searchResultsState.items.length) {
          e.preventDefault();
          openSelectedSearchResult();
          return;
        }
        e.preventDefault();
        goTo("search", { searchQuery: searchInput.value.trim() });
      }
      if (navState.page === "search" && searchResultsState.items.length) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          updateSearchSelection(1);
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          updateSearchSelection(-1);
        }
      }
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    if (navState.page !== "search" || !searchResultsState.items.length) return;
    const t = e.target;
    const tag = t && t.tagName ? t.tagName.toLowerCase() : "";
    if (t !== searchInput && (tag === "input" || tag === "textarea" || tag === "select" || t && t.isContentEditable)) {
      return;
    }
    if (document.querySelector(".modal-overlay.show, .menu-overlay.show")) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      updateSearchSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      updateSearchSelection(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      openSelectedSearchResult();
    }
  });
  if (searchClear) searchClear.onclick = () => {
    if (searchInput) searchInput.value = "";
    searchClear.style.display = "none";
    if (navState.page === "search") goBack();
  };
  const searchSubmit = document.getElementById("searchSubmit");
  if (searchSubmit && searchInput) {
    searchSubmit.onclick = () => {
      const q = searchInput.value.trim();
      if (q) goTo("search", { searchQuery: q });
      else searchInput.focus();
    };
  }
  if (uploadModal.tabs) uploadModal.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.getAttribute("data-tab");
      uploadModal.tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      uploadModal.tabContents.forEach((content) => content.classList.remove("active"));
      const tabContent = document.getElementById(`tab-${tabName}`);
      if (tabContent) tabContent.classList.add("active");
      localStorage.setItem("cardspoke_lastUploadTab", tabName);
    });
  });
  if (uploadModal.closeBtn) uploadModal.closeBtn.onclick = () => {
    if (uploadModal.overlay) uploadModal.overlay.classList.remove("show");
    unlockBodyScroll();
  };
  if (uploadModal.overlay) uploadModal.overlay.onclick = (e) => {
    if (e.target === uploadModal.overlay) {
      uploadModal.overlay.classList.remove("show");
      unlockBodyScroll();
    }
  };
  if (uploadModal.fileUploadAreaJSON) uploadModal.fileUploadAreaJSON.onclick = () => {
    if (uploadModal.fileInputJSON) uploadModal.fileInputJSON.click();
  };
  if (uploadModal.fileInputJSON) uploadModal.fileInputJSON.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const mode = uploadModal.importLocationSelectJSON ? uploadModal.importLocationSelectJSON.value || "root" : "root";
        await importJSON(data, mode);
        if (uploadModal.overlay) uploadModal.overlay.classList.remove("show");
      } catch (err) {
        showToast("Failed to parse JSON: " + err.message, "error");
      }
    };
    reader.readAsText(file);
  });
  if (uploadModal.fileUploadAreaTXT) uploadModal.fileUploadAreaTXT.onclick = () => {
    if (uploadModal.fileInputTXT) uploadModal.fileInputTXT.click();
  };
  if (uploadModal.fileInputTXT) uploadModal.fileInputTXT.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const modeRadio = document.querySelector('input[name="txtImportMode"]:checked');
      const mode = modeRadio ? modeRadio.value : "outline";
      const location2 = uploadModal.importLocationSelectTXT ? uploadModal.importLocationSelectTXT.value || "root" : "root";
      importTXT(text, mode, location2);
      if (uploadModal.overlay) uploadModal.overlay.classList.remove("show");
    };
    reader.readAsText(file);
  });
  function pushUndo(action, data) {
    if (undoGroupState.active) {
      undoGroupState.actions.push({ action, data, timestamp: Date.now() });
      redoStack.length = 0;
      return;
    }
    undoStack.push({
      action,
      data,
      timestamp: Date.now()
    });
    if (undoStack.length > MAX_UNDO_STACK) {
      undoStack.shift();
    }
    redoStack.length = 0;
  }
  const undoGroupState = {
    active: false,
    label: null,
    actions: []
  };
  function startUndoGroup(label) {
    if (undoGroupState.active) return false;
    undoGroupState.active = true;
    undoGroupState.label = label || "group";
    undoGroupState.actions = [];
    return true;
  }
  function endUndoGroup() {
    if (!undoGroupState.active) return false;
    const groupedActions = undoGroupState.actions.slice();
    const label = undoGroupState.label || "group";
    undoGroupState.active = false;
    undoGroupState.label = null;
    undoGroupState.actions = [];
    if (!groupedActions.length) return true;
    undoStack.push({
      action: "undoGroup",
      data: { label, actions: groupedActions },
      timestamp: Date.now()
    });
    if (undoStack.length > MAX_UNDO_STACK) undoStack.shift();
    redoStack.length = 0;
    return true;
  }
  function undo() {
    if (undoStack.length === 0) {
      showToast("Nothing to undo", "info");
      return false;
    }
    const action = undoStack.pop();
    try {
      if (action.action === "undoGroup") {
        const grouped = action.data.actions || [];
        for (let i = grouped.length - 1; i >= 0; i--) {
          applyUndoAction(grouped[i]);
        }
        redoStack.push(action);
        save();
        render();
        showToast("Undo: " + (action.data.label || "bulk operation"), "info");
        return true;
      }
      applyUndoAction(action);
      redoStack.push(action);
      save();
      render();
      showToast("Undo: " + action.action, "info");
      return true;
    } catch (err) {
      console.error("Undo failed:", err);
      showToast("Undo failed", "error");
      return false;
    }
  }
  function applyUndoAction(action) {
    switch (action.action) {
      case "deleteCard":
        const cardData = action.data.card;
        store.cards[cardData.id] = cardData;
        const undelParent = cardData.parentId ? store.cards[cardData.parentId] : null;
        if (undelParent) {
          if (Array.isArray(undelParent.children) && !undelParent.children.includes(cardData.id)) {
            undelParent.children.push(cardData.id);
          }
        } else {
          if (!store.rootOrder.includes(cardData.id)) {
            store.rootOrder.push(cardData.id);
          }
        }
        const trashIndex = trashBin.findIndex((t) => t.card.id === cardData.id);
        if (trashIndex > -1) trashBin.splice(trashIndex, 1);
        break;
      case "updateCard":
        Object.assign(store.cards[action.data.cardId], action.data.previousState);
        break;
      case "createCard":
        const card = store.cards[action.data.cardId];
        if (card) {
          if (card.parentId) {
            const parent = store.cards[card.parentId];
            if (parent) parent.children = parent.children.filter((c) => c !== card.id);
          } else {
            store.rootOrder = store.rootOrder.filter((c) => c !== card.id);
          }
          delete store.cards[action.data.cardId];
        }
        break;
      case "addTag":
        removeTag(action.data.cardId, action.data.tag, true, true);
        break;
      case "removeTag":
        addTag(action.data.cardId, action.data.tag, true, true);
        break;
      case "moveCard":
        const movedCard = store.cards[action.data.cardId];
        if (movedCard) {
          const currentParent = store.cards[movedCard.parentId];
          if (currentParent) {
            currentParent.children = currentParent.children.filter((c) => c !== movedCard.id);
          } else {
            store.rootOrder = store.rootOrder.filter((c) => c !== movedCard.id);
          }
          movedCard.parentId = action.data.originalParentId;
          if (action.data.originalParentId) {
            const origParent = store.cards[action.data.originalParentId];
            if (origParent && !origParent.children.includes(movedCard.id)) {
              origParent.children.push(movedCard.id);
            }
          } else {
            if (!store.rootOrder.includes(movedCard.id)) {
              store.rootOrder.push(movedCard.id);
            }
          }
        }
        break;
    }
  }
  function redo() {
    if (redoStack.length === 0) {
      showToast("Nothing to redo", "info");
      return false;
    }
    const action = redoStack.pop();
    try {
      if (action.action === "undoGroup") {
        const grouped = action.data.actions || [];
        grouped.forEach(applyRedoAction);
        undoStack.push(action);
        save();
        render();
        showToast("Redo: " + (action.data.label || "bulk operation"), "info");
        return true;
      }
      applyRedoAction(action);
      undoStack.push(action);
      save();
      render();
      showToast("Redo: " + action.action, "info");
      return true;
    } catch (err) {
      console.error("Redo failed:", err);
      showToast("Redo failed", "error");
      return false;
    }
  }
  function applyRedoAction(action) {
    switch (action.action) {
      case "deleteCard":
        const cardId = action.data.card.id;
        const card = store.cards[cardId];
        if (card) {
          if (card.parentId) {
            const parent = store.cards[card.parentId];
            if (parent) parent.children = parent.children.filter((c) => c !== cardId);
          } else {
            store.rootOrder = store.rootOrder.filter((c) => c !== cardId);
          }
          trashBin.unshift({ card: cloneCard(card), deletedAt: Date.now() });
          if (trashBin.length > MAX_TRASH_SIZE) trashBin.pop();
          delete store.cards[cardId];
        }
        break;
      case "updateCard":
        Object.assign(store.cards[action.data.cardId], action.data.newState);
        break;
      case "createCard":
        const newCard = action.data.card;
        store.cards[newCard.id] = newCard;
        if (newCard.parentId) {
          const parent = store.cards[newCard.parentId];
          if (parent && !parent.children.includes(newCard.id)) {
            parent.children.push(newCard.id);
          }
        } else {
          if (!store.rootOrder.includes(newCard.id)) {
            store.rootOrder.push(newCard.id);
          }
        }
        break;
      case "addTag":
        addTag(action.data.cardId, action.data.tag, true, true);
        break;
      case "removeTag":
        removeTag(action.data.cardId, action.data.tag, true, true);
        break;
      case "moveCard":
        const mvCard = store.cards[action.data.cardId];
        if (mvCard) {
          const oldParent = store.cards[mvCard.parentId];
          if (oldParent) {
            oldParent.children = oldParent.children.filter((c) => c !== mvCard.id);
          } else {
            store.rootOrder = store.rootOrder.filter((c) => c !== mvCard.id);
          }
          mvCard.parentId = action.data.newParentId;
          if (action.data.newParentId) {
            const newParent = store.cards[action.data.newParentId];
            if (newParent && !newParent.children.includes(mvCard.id)) {
              newParent.children.push(mvCard.id);
            }
          } else {
            if (!store.rootOrder.includes(mvCard.id)) {
              store.rootOrder.push(mvCard.id);
            }
          }
        }
        break;
    }
  }
  window.startUndoGroup = startUndoGroup;
  window.endUndoGroup = endUndoGroup;
  function showTrashBin() {
    const overlay = h("div", { className: "modal-overlay show" });
    const modal = h("div", { className: "modal", style: "max-width: 600px;" });
    const modalHeader = h("div", { className: "modal-header" });
    modalHeader.appendChild(h("div", { className: "modal-title" }, "Trash Bin"));
    const closeBtn = h("button", { className: "modal-close", "aria-label": "Close trash bin", onclick: () => overlay.remove() }, "✕");
    modalHeader.appendChild(closeBtn);
    modal.appendChild(modalHeader);
    const modalBody = h("div", { className: "modal-body" });
    if (trashBin.length === 0) {
      modalBody.appendChild(h("div", { className: "empty" }, "Trash bin is empty"));
    } else {
      const description = h(
        "p",
        { style: "margin-bottom: var(--space-lg); color: var(--text-secondary);" },
        trashBin.length + " item(s) in trash. Restore or permanently delete items."
      );
      modalBody.appendChild(description);
      trashBin.forEach((item, index) => {
        const itemDiv = h("div", {
          style: "background: var(--bg-secondary); padding: var(--space-lg); border-radius: var(--radius); border: 1px solid var(--border); margin-bottom: var(--space-md); display: flex; justify-content: space-between; align-items: center;"
        });
        const info = h("div", { style: "flex: 1;" });
        info.appendChild(h("div", { style: "font-weight: 700;" }, item.card.title || "(Untitled)"));
        info.appendChild(h(
          "div",
          { style: "font-size: 0.875rem; color: var(--text-secondary);" },
          "Deleted: " + new Date(item.deletedAt).toLocaleString()
        ));
        itemDiv.appendChild(info);
        const actions = h("div", { style: "display: flex; gap: var(--space-sm);" });
        const restoreBtn = h("button", {
          className: "btn btn-primary",
          onclick: () => {
            store.cards[item.card.id] = item.card;
            if (item.card.parentId) {
              const parent = store.cards[item.card.parentId];
              if (parent && !parent.children.includes(item.card.id)) {
                parent.children.push(item.card.id);
              }
            } else {
              if (!store.rootOrder.includes(item.card.id)) {
                store.rootOrder.push(item.card.id);
              }
            }
            trashBin.splice(index, 1);
            save();
            overlay.remove();
            showTrashBin();
            showToast("Card restored: " + (item.card.title || "(Untitled)"));
            render();
          }
        }, "Restore");
        actions.appendChild(restoreBtn);
        const deleteBtn = h("button", {
          className: "btn btn-danger",
          onclick: async () => {
            if (await showConfirmDialog("Permanently delete this card?", {
              title: "Delete Card",
              confirmLabel: "Delete",
              cancelLabel: "Cancel",
              confirmClassName: "btn btn-danger"
            })) {
              trashBin.splice(index, 1);
              overlay.remove();
              showTrashBin();
              showToast("Card permanently deleted");
            }
          }
        }, "Delete");
        actions.appendChild(deleteBtn);
        itemDiv.appendChild(actions);
        modalBody.appendChild(itemDiv);
      });
      const emptyBtn = h("button", {
        className: "btn btn-danger",
        style: "width: 100%; margin-top: var(--space-lg);",
        onclick: async () => {
          if (await showConfirmDialog("Permanently delete all items in trash?", {
            title: "Empty Trash",
            confirmLabel: "Empty Trash",
            cancelLabel: "Cancel",
            confirmClassName: "btn btn-danger"
          })) {
            trashBin.length = 0;
            overlay.remove();
            showToast("Trash emptied");
          }
        }
      }, "Empty Trash");
      modalBody.appendChild(emptyBtn);
    }
    modal.appendChild(modalBody);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
  }
  function renameTag(oldTag, newTag) {
    const normalizedOld = oldTag.replace(/^#/, "").toLowerCase().trim();
    const normalizedNew = newTag.replace(/^#/, "").toLowerCase().trim();
    if (!normalizedOld || !normalizedNew) return 0;
    if (normalizedOld === normalizedNew) return 0;
    let count = 0;
    Object.values(store.cards).forEach((card) => {
      if (card.tags && card.tags.includes(normalizedOld)) {
        card.tags = card.tags.map((t) => t === normalizedOld ? normalizedNew : t);
        card.tags = [...new Set(card.tags)];
        card.updatedAt = Date.now();
        count++;
      }
    });
    if (count > 0) save();
    return count;
  }
  function mergeTags(tag1, tag2) {
    return renameTag(tag1, tag2);
  }
  function deleteTagGlobal(tag) {
    const normalizedTag = tag.replace(/^#/, "").toLowerCase().trim();
    if (!normalizedTag) return 0;
    let count = 0;
    Object.values(store.cards).forEach((card) => {
      if (card.tags && card.tags.includes(normalizedTag)) {
        card.tags = card.tags.filter((t) => t !== normalizedTag);
        card.updatedAt = Date.now();
        count++;
      }
    });
    if (count > 0) save();
    return count;
  }
  function getTagStats() {
    const tagCounts = {};
    Object.values(store.cards).forEach((card) => {
      if (card.tags) {
        card.tags.forEach((tag) => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      }
    });
    return Object.entries(tagCounts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  }
  function showTagManager() {
    const overlay = h("div", { className: "modal-overlay show" });
    const modal = h("div", { className: "modal", style: "max-width: 700px;" });
    const modalHeader = h("div", { className: "modal-header" });
    modalHeader.appendChild(h("div", { className: "modal-title" }, "Tag Manager"));
    const closeBtn = h("button", {
      className: "modal-close",
      "aria-label": "Close tag manager",
      onclick: () => overlay.remove()
    }, "X");
    modalHeader.appendChild(closeBtn);
    modal.appendChild(modalHeader);
    const modalBody = h("div", { className: "modal-body" });
    const tagStats = getTagStats();
    if (tagStats.length === 0) {
      modalBody.appendChild(h("div", { className: "empty" }, "No tags found. Add tags to your cards to manage them here."));
    } else {
      const summary = h("div", { style: "background: var(--bg-secondary); padding: var(--space-lg); border-radius: var(--radius); margin-bottom: var(--space-xl);" });
      summary.appendChild(h(
        "div",
        { style: "font-weight: 700; margin-bottom: var(--space-sm);" },
        tagStats.length + " unique tags across " + Object.keys(store.cards).length + " cards"
      ));
      modalBody.appendChild(summary);
      tagStats.forEach(function(tagStat) {
        const tag = tagStat.tag;
        const count = tagStat.count;
        const tagItem = h("div", {
          style: "background: var(--bg-secondary); padding: var(--space-lg); border-radius: var(--radius); border: 1px solid var(--border); margin-bottom: var(--space-md); display: flex; justify-content: space-between; align-items: center;"
        });
        const tagInfo = h("div", { style: "display: flex; align-items: center; gap: var(--space-md);" });
        const tagChip = h("span", {
          className: "card-tag",
          style: "cursor: pointer;",
          onclick: function() {
            overlay.remove();
            goTo("search", { searchQuery: "#" + tag });
          }
        }, tag);
        tagInfo.appendChild(tagChip);
        tagInfo.appendChild(h("span", { style: "color: var(--text-secondary);" }, "(" + count + " card" + (count !== 1 ? "s" : "") + ")"));
        tagItem.appendChild(tagInfo);
        const actions = h("div", { style: "display: flex; gap: var(--space-sm);" });
        const renameBtn = h("button", {
          className: "btn",
          style: "font-size: var(--text-sm);",
          onclick: async function() {
            const newName = await showPromptDialog({
              title: "Rename Tag",
              message: `Rename tag "${tag}" to:`,
              label: "Tag name",
              defaultValue: tag,
              confirmLabel: "Rename",
              cancelLabel: "Cancel"
            });
            if (newName && newName.trim() !== tag) {
              const affected = renameTag(tag, newName.trim());
              if (affected > 0) {
                showToast('Renamed "' + tag + '" to "' + newName.trim() + '" in ' + affected + " card(s)");
                overlay.remove();
                showTagManager();
              }
            }
          }
        }, "Rename");
        actions.appendChild(renameBtn);
        const mergeBtn = h("button", {
          className: "btn",
          style: "font-size: var(--text-sm);",
          onclick: async function() {
            const otherTags = tagStats.map(function(t) {
              return t.tag;
            }).filter(function(t) {
              return t !== tag;
            });
            if (otherTags.length === 0) {
              showToast("No other tags to merge with", "info");
              return;
            }
            const targetTag = await showPromptDialog({
              title: "Merge Tags",
              message: 'Merge "' + tag + '" into which tag?\n\nAvailable: ' + otherTags.join(", "),
              label: "Target tag",
              placeholder: "Enter existing tag name",
              suggestions: otherTags,
              confirmLabel: "Merge",
              cancelLabel: "Cancel"
            });
            if (targetTag && otherTags.includes(targetTag.trim().toLowerCase())) {
              const affected = mergeTags(tag, targetTag.trim());
              if (affected > 0) {
                showToast('Merged "' + tag + '" into "' + targetTag.trim() + '" (' + affected + " card(s))");
                overlay.remove();
                showTagManager();
              }
            }
          }
        }, "Merge");
        actions.appendChild(mergeBtn);
        const deleteBtn = h("button", {
          className: "btn btn-danger",
          style: "font-size: var(--text-sm);",
          onclick: async function() {
            if (await showConfirmDialog('Delete tag "' + tag + '" from all ' + count + " card(s)?", {
              title: "Delete Tag",
              confirmLabel: "Delete Tag",
              cancelLabel: "Cancel",
              confirmClassName: "btn btn-danger"
            })) {
              const affected = deleteTagGlobal(tag);
              showToast('Deleted tag "' + tag + '" from ' + affected + " card(s)");
              overlay.remove();
              showTagManager();
            }
          }
        }, "Delete");
        actions.appendChild(deleteBtn);
        tagItem.appendChild(actions);
        modalBody.appendChild(tagItem);
      });
    }
    modal.appendChild(modalBody);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.remove();
    };
  }
  function showAdvancedSearch() {
    const overlay = h("div", { className: "modal-overlay show" });
    const modal = h("div", { className: "modal", style: "max-width: 600px;" });
    const modalHeader = h("div", { className: "modal-header" });
    modalHeader.appendChild(h("div", { className: "modal-title" }, "Advanced Search"));
    const closeBtn = h("button", {
      className: "modal-close",
      "aria-label": "Close advanced search",
      onclick: () => overlay.remove()
    }, "X");
    modalHeader.appendChild(closeBtn);
    modal.appendChild(modalHeader);
    const modalBody = h("form", { className: "modal-body" });
    const submitSearch = function() {
      const query = queryInput.value.trim();
      const tagFilter = tagSelect.value;
      const bookmarkOnly = bookmarkInput.checked;
      const dateFilter = dateSelect.value;
      sessionStorage.setItem("searchFilters", JSON.stringify({
        query,
        tagFilter,
        bookmarkOnly,
        dateFilter
      }));
      overlay.remove();
      goTo("search", { searchQuery: query || "*" });
    };
    modalBody.onsubmit = function(e) {
      e.preventDefault();
      submitSearch();
    };
    const helpText = h("div", {
      style: "background: var(--bg-secondary); padding: var(--space-md); border-radius: var(--radius); margin-bottom: var(--space-lg); font-size: 14px; color: var(--text-secondary);"
    }, "💡 Tip: Use advanced filters to narrow down your search results by tag, bookmark status, or date.");
    modalBody.appendChild(helpText);
    const queryGroup = h("div", { style: "margin-bottom: var(--space-lg);" });
    queryGroup.appendChild(h("label", { style: "display: block; margin-bottom: var(--space-xs); font-weight: 600;" }, "Search Text"));
    const queryInput = h("input", {
      type: "text",
      placeholder: "Search in titles and content...",
      "aria-label": "Search text input",
      style: "width: 100%; padding: var(--space-md); border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-primary); color: var(--text-primary); font-size: 1rem;"
    });
    queryInput.addEventListener("keydown", function(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        submitSearch();
      }
    });
    queryGroup.appendChild(queryInput);
    modalBody.appendChild(queryGroup);
    const tagGroup = h("div", { style: "margin-bottom: var(--space-lg);" });
    tagGroup.appendChild(h("label", { style: "display: block; margin-bottom: var(--space-xs); font-weight: 600;" }, "Filter by Tag"));
    const tagSelect = h("select", {
      "aria-label": "Filter by tag",
      style: "width: 100%; padding: var(--space-md); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 1rem;"
    });
    tagSelect.appendChild(h("option", { value: "" }, "Any tag"));
    getAllTags().forEach(function(tag) {
      tagSelect.appendChild(h("option", { value: tag }, tag));
    });
    tagGroup.appendChild(tagSelect);
    modalBody.appendChild(tagGroup);
    const bookmarkGroup = h("div", { style: "margin-bottom: var(--space-lg);" });
    const bookmarkCheck = h("label", { style: "display: flex; align-items: center; gap: var(--space-sm); cursor: pointer;" });
    const bookmarkInput = h("input", { type: "checkbox", "aria-label": "Only show bookmarked cards" });
    bookmarkCheck.appendChild(bookmarkInput);
    bookmarkCheck.appendChild(document.createTextNode("Only show bookmarked cards"));
    bookmarkGroup.appendChild(bookmarkCheck);
    modalBody.appendChild(bookmarkGroup);
    const dateGroup = h("div", { style: "margin-bottom: var(--space-lg);" });
    dateGroup.appendChild(h("label", { style: "display: block; margin-bottom: var(--space-xs); font-weight: 600;" }, "Created/Modified"));
    const dateSelect = h("select", {
      "aria-label": "Filter by date",
      style: "width: 100%; padding: var(--space-md); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 1rem;"
    });
    dateSelect.appendChild(h("option", { value: "" }, "Any time"));
    dateSelect.appendChild(h("option", { value: "today" }, "Today"));
    dateSelect.appendChild(h("option", { value: "week" }, "Past 7 days"));
    dateSelect.appendChild(h("option", { value: "month" }, "Past 30 days"));
    dateGroup.appendChild(dateSelect);
    modalBody.appendChild(dateGroup);
    const searchBtn = h("button", {
      type: "submit",
      className: "btn btn-primary",
      style: "width: 100%;"
    }, "Search");
    modalBody.appendChild(searchBtn);
    modal.appendChild(modalBody);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.remove();
    };
    setTimeout(function() {
      queryInput.focus();
    }, 100);
  }
  function simpleMarkdown(text) {
    if (!text) return "";
    var html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/^\* (.+)$/gm, "<li>$1</li>");
    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
    html = html.replace(/\n\n/g, "</p><p>");
    html = "<p>" + html + "</p>";
    return html;
  }
  function showPluginStore() {
    showPluginManager("install");
  }
  function bulkExportCards(cardIds, format) {
    format = format || "json";
    if (!cardIds || cardIds.length === 0) {
      showToast("No cards selected for export", "error");
      return;
    }
    const exportCards = {};
    function includeChildren(id) {
      const card = store.cards[id];
      if (!card) return;
      exportCards[id] = cloneCard(card);
      card.children.forEach(function(childId) {
        includeChildren(childId);
      });
    }
    cardIds.forEach(function(id) {
      includeChildren(id);
    });
    var content, filename, mimeType;
    if (format === "markdown") {
      content = Object.values(exportCards).map(function(card) {
        var md = "# " + (card.title || "(Untitled)") + "\n\n";
        if (card.tags && card.tags.length) {
          md += "Tags: " + card.tags.map(function(t) {
            return "#" + t;
          }).join(" ") + "\n\n";
        }
        md += card.body || "";
        return md;
      }).join("\n\n---\n\n");
      filename = "cardspoke-export-" + Date.now() + ".md";
      mimeType = "text/markdown";
    } else if (format === "txt") {
      content = Object.values(exportCards).map(function(card) {
        var txt = "=== " + (card.title || "(Untitled)") + " ===\n\n";
        if (card.tags && card.tags.length) {
          txt += "Tags: " + card.tags.join(", ") + "\n\n";
        }
        txt += card.body || "";
        return txt;
      }).join("\n\n" + "=".repeat(50) + "\n\n");
      filename = "cardspoke-export-" + Date.now() + ".txt";
      mimeType = "text/plain";
    } else {
      content = JSON.stringify({
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        cardCount: Object.keys(exportCards).length,
        cards: exportCards
      }, null, 2);
      filename = "cardspoke-export-" + Date.now() + ".json";
      mimeType = "application/json";
    }
    downloadWithFeedback(content, filename, mimeType);
    showToast("Exported " + Object.keys(exportCards).length + " card(s)");
  }
  function bulkImportCards(importData, targetParentId) {
    try {
      var cards = {};
      if (importData.cards) {
        cards = importData.cards;
      } else if (Array.isArray(importData)) {
        importData.forEach(function(card) {
          cards[card.id || uid()] = card;
        });
      } else if (importData.id) {
        cards[importData.id] = importData;
      }
      var idMap = {};
      Object.keys(cards).forEach(function(oldId) {
        idMap[oldId] = uid();
      });
      Object.values(cards).forEach(function(card) {
        var newId = idMap[card.id];
        var newCard = {
          id: newId,
          title: card.title || "",
          body: card.body || "",
          parentId: card.parentId ? idMap[card.parentId] || targetParentId : targetParentId,
          children: card.children ? card.children.map(function(cid) {
            return idMap[cid];
          }).filter(Boolean) : [],
          tags: card.tags || [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        store.cards[newId] = newCard;
        if (newCard.parentId) {
          var parent = store.cards[newCard.parentId];
          if (parent && !parent.children.includes(newId)) {
            parent.children.push(newId);
          }
        } else {
          if (!store.rootOrder.includes(newId)) {
            store.rootOrder.push(newId);
          }
        }
      });
      save();
      return Object.keys(cards).length;
    } catch (err) {
      console.error("Bulk import failed:", err);
      showToast("Import failed: " + err.message, "error");
      return 0;
    }
  }
  function handleDragStart(e, cardId) {
    setDraggedCardId(cardId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cardId);
    e.target.style.opacity = "0.5";
  }
  function handleDragEnd(e) {
    e.target.style.opacity = "1";
    setDraggedCardId(null);
    setDragOverCardId(null);
    document.querySelectorAll(".drag-over").forEach(function(el) {
      el.classList.remove("drag-over");
    });
  }
  function handleDragOver(e, cardId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverCardId !== cardId) {
      document.querySelectorAll(".drag-over").forEach(function(el) {
        el.classList.remove("drag-over");
      });
      if (cardId !== draggedCardId) {
        var tile = e.target.closest(".card-tile");
        if (tile) tile.classList.add("drag-over");
      }
      setDragOverCardId(cardId);
    }
  }
  function handleDrop(e, targetCardId) {
    e.preventDefault();
    var tile = e.target.closest(".card-tile");
    if (tile) tile.classList.remove("drag-over");
    if (!draggedCardId || draggedCardId === targetCardId) return;
    var draggedCard = store.cards[draggedCardId];
    var targetCard = store.cards[targetCardId];
    if (!draggedCard || !targetCard) return;
    if (isDescendant(targetCardId, draggedCardId)) {
      showToast("Cannot move a card into its own child", "error");
      return;
    }
    pushUndo("moveCard", {
      cardId: draggedCardId,
      originalParentId: draggedCard.parentId,
      newParentId: targetCardId
    });
    if (draggedCard.parentId) {
      var oldParent = store.cards[draggedCard.parentId];
      if (oldParent) {
        oldParent.children = oldParent.children.filter(function(c) {
          return c !== draggedCardId;
        });
      }
    } else {
      store.rootOrder = store.rootOrder.filter(function(c) {
        return c !== draggedCardId;
      });
    }
    draggedCard.parentId = targetCardId;
    if (!targetCard.children.includes(draggedCardId)) {
      targetCard.children.push(draggedCardId);
    }
    draggedCard.updatedAt = Date.now();
    save();
    render();
    showToast('Moved "' + (draggedCard.title || "(Untitled)") + '" to "' + (targetCard.title || "(Untitled)") + '"');
  }
  function isDescendant(cardId, ancestorId) {
    var ancestor = store.cards[ancestorId];
    if (!ancestor) return false;
    if (ancestor.children.includes(cardId)) return true;
    return ancestor.children.some(function(childId) {
      return isDescendant(cardId, childId);
    });
  }
  function reorderCard(parentId, cardId, newIndex) {
    if (parentId) {
      var parent = store.cards[parentId];
      if (!parent || !parent.children.includes(cardId)) return;
      parent.children = parent.children.filter(function(c) {
        return c !== cardId;
      });
      parent.children.splice(newIndex, 0, cardId);
    } else {
      if (!store.rootOrder.includes(cardId)) return;
      store.rootOrder = store.rootOrder.filter(function(c) {
        return c !== cardId;
      });
      store.rootOrder.splice(newIndex, 0, cardId);
    }
    save();
    render();
  }
  async function editDatasetName() {
    var currentName = store.metadata && store.metadata.name || instanceKey;
    var newName = await showPromptDialog({
      title: "Rename Dataset",
      message: "Enter new dataset name:",
      label: "Dataset name",
      defaultValue: currentName,
      confirmLabel: "Rename",
      cancelLabel: "Cancel"
    });
    if (newName && newName.trim() && newName.trim() !== currentName) {
      if (!store.metadata) store.metadata = {};
      store.metadata.name = newName.trim();
      store.metadata.updatedAt = Date.now();
      const datasets = JSON.parse(localStorage.getItem("cardspoke_datasets") || "{}");
      if (datasets[instanceKey]) {
        datasets[instanceKey].name = newName.trim();
        localStorage.setItem("cardspoke_datasets", JSON.stringify(datasets));
      }
      save();
      showToast("Dataset renamed to: " + newName.trim());
      render();
    }
  }
  const shortcuts = {
    "ctrl+h": { action: () => goTo("list"), description: "Go to Home (card list)" },
    "ctrl+n": { action: () => {
      menu.newCard.click();
    }, description: "New card" },
    "ctrl+f": { action: () => {
      searchInput.focus();
    }, description: "Focus search" },
    "ctrl+b": { action: () => {
      menu.bookmarks.click();
      closeMenu();
    }, description: "Show bookmarks" },
    "ctrl+r": { action: () => {
      menu.recentCards.click();
      closeMenu();
    }, description: "Show recent cards" },
    "ctrl+e": { action: () => {
      showPluginManager("installed");
      closeMenu();
    }, description: "Show plugin manager" },
    "ctrl+u": { action: () => {
      menu.upload.click();
      closeMenu();
    }, description: "Upload data" },
    "ctrl+/": { action: () => showKeyboardHelp(), description: "Show this help" },
    "ctrl+z": { action: () => undo(), description: "Undo last action" },
    "ctrl+y": { action: () => redo(), description: "Redo last action" },
    "escape": { action: () => handleEscape(), description: "Close modals/go back" },
    "alt+t": { action: () => {
      header.themeToggle.click();
    }, description: "Toggle theme" },
    "alt+c": { action: () => toggleViewMode(), description: "Toggle compact view" },
    "ctrl+d": { action: async () => {
      if (navState.page === "read" && navState.cardId) {
        const card = store.cards[navState.cardId];
        if (card) {
          const choice = await showConfirmDialog("Duplicate this card with all of its children?", {
            title: "Duplicate Card",
            confirmLabel: "With Children",
            cancelLabel: "Only This Card",
            confirmClassName: "btn btn-primary"
          });
          const newId = duplicateCard(navState.cardId, choice);
          if (newId) {
            showToast("Card duplicated successfully");
            goTo("read", { cardId: newId });
          }
        }
      }
    }, description: "Duplicate current card" },
    "ctrl+t": { action: () => {
      if (navState.page === "edit") {
        const tagsInput = document.getElementById("cardTags");
        if (tagsInput) tagsInput.focus();
      }
    }, description: "Focus tags input (when editing)" },
    "ctrl+[": { action: () => {
      if (navState.page === "read" && navState.cardId) {
        const card = store.cards[navState.cardId];
        if (card && card.parentId) {
          goTo("read", { cardId: card.parentId });
        } else {
          goTo("list");
        }
      }
    }, description: "Navigate to parent card" },
    "ctrl+]": { action: () => {
      if (navState.page === "read" && navState.cardId) {
        const card = store.cards[navState.cardId];
        if (card && card.children.length > 0) {
          goTo("read", { cardId: card.children[0] });
        }
      }
    }, description: "Navigate to first child card" },
    "ctrl+g": { action: () => {
      const gridModeEnabled = localStorage.getItem("cardspoke_gridView") === "true";
      localStorage.setItem("cardspoke_gridView", (!gridModeEnabled).toString());
      showToast(gridModeEnabled ? "List view enabled" : "Grid view enabled");
      render();
    }, description: "Toggle grid/list view" }
  };
  function handleEscape() {
    if (document.querySelector(
      '.modal-overlay.show[data-a11y-managed="true"], .modal-overlay.show[data-a11y-enhanced="true"], .permission-modal'
    )) {
      return;
    }
    if (menu.overlay.classList.contains("show")) {
      closeMenu();
      return;
    }
    if (uploadModal.overlay.classList.contains("show")) {
      uploadModal.overlay.classList.remove("show");
      if (typeof unlockBodyScroll === "function") unlockBodyScroll();
      return;
    }
    const helpModal = document.getElementById("keyboardHelpModal");
    if (helpModal && helpModal.classList.contains("show")) {
      helpModal.classList.remove("show");
      return;
    }
    if (navHistory.length > 0) {
      goBack();
    }
  }
  function closeMenu() {
    if (typeof closeMenuOverlay === "function") {
      closeMenuOverlay();
      return;
    }
    menu.overlay.classList.remove("show");
    if (typeof unlockBodyScroll === "function") unlockBodyScroll();
  }
  function showTypographySelector() {
    const currentTypography = localStorage.getItem("cardspoke_typography") || "default";
    const modal = h(
      "div",
      {
        id: "typographyModal",
        className: "menu-overlay show",
        onclick: (e) => {
          if (e.target === modal) modal.remove();
        }
      },
      h(
        "div",
        { className: "menu-panel" },
        h(
          "div",
          { className: "menu-header" },
          h("div", { className: "menu-title" }, "Typography"),
          h("button", {
            className: "menu-close",
            onclick: () => modal.remove()
          }, "✕")
        ),
        h(
          "div",
          { className: "typography-presets" },
          h("div", { className: "preset-description" }, "Choose a reading mode that suits your preference:"),
          ...[
            { id: "default", name: "Default", desc: "16px, comfortable line height" },
            { id: "comfortable", name: "Comfortable", desc: "18px, extra line height for relaxed reading" },
            { id: "compact", name: "Compact", desc: "14px, tighter spacing for more content" },
            { id: "dyslexia", name: "Dyslexia-Friendly", desc: "18px, wider spacing, readable font" }
          ].map(
            (preset) => h(
              "div",
              {
                className: `preset-option ${currentTypography === preset.id ? "active" : ""}`,
                onclick: () => {
                  localStorage.setItem("cardspoke_typography", preset.id);
                  document.documentElement.setAttribute("data-typography", preset.id);
                  showToast(`Typography: ${preset.name}`);
                  modal.remove();
                }
              },
              h("div", { className: "preset-name" }, preset.name),
              h("div", { className: "preset-desc" }, preset.desc)
            )
          )
        )
      )
    );
    document.body.appendChild(modal);
  }
  function suggestTags(cardId, limit = 5) {
    const card = store.cards[cardId];
    if (!card) return [];
    const existingTags = getTags(cardId);
    const allExistingTags = getAllTags();
    const suggestions = [];
    const content = ((card.title || "") + " " + (card.body || "")).toLowerCase();
    for (const tag of allExistingTags) {
      if (existingTags.includes(tag)) continue;
      const cardsWithTag = Object.values(store.cards).filter(
        (c) => c.tags && c.tags.includes(tag)
      );
      let totalScore = 0;
      for (const otherCard of cardsWithTag) {
        const otherContent = ((otherCard.title || "") + " " + (otherCard.body || "")).toLowerCase();
        const contentWords = new Set(content.split(/\s+/).filter((w) => w.length > 3));
        const otherWords = new Set(otherContent.split(/\s+/).filter((w) => w.length > 3));
        const commonWords = [...contentWords].filter((w) => otherWords.has(w));
        if (commonWords.length > 0) {
          totalScore += commonWords.length / Math.max(contentWords.size, otherWords.size);
        }
      }
      if (totalScore > 0) {
        suggestions.push({
          tag,
          score: totalScore / cardsWithTag.length
        });
      }
    }
    suggestions.sort((a, b) => b.score - a.score);
    return suggestions.slice(0, limit);
  }
  function showTagSuggestions(cardId) {
    const card = store.cards[cardId];
    if (!card) return;
    const suggestions = suggestTags(cardId, 8);
    if (suggestions.length === 0) {
      showToast("No tag suggestions available", "info");
      return;
    }
    const modal = h(
      "div",
      {
        id: "tagSuggestionsModal",
        className: "menu-overlay show",
        onclick: (e) => {
          if (e.target === modal) modal.remove();
        }
      },
      h(
        "div",
        { className: "menu-panel" },
        h(
          "div",
          { className: "menu-header" },
          h("div", { className: "menu-title" }, "Suggested Tags"),
          h("button", {
            className: "menu-close",
            onclick: () => modal.remove()
          }, "✕")
        ),
        h(
          "div",
          { className: "tag-suggestions" },
          h(
            "div",
            { className: "suggestion-description" },
            `Based on similar cards, you might want to add these tags:`
          ),
          ...suggestions.map(
            ({ tag, score }) => h(
              "button",
              {
                className: "suggestion-tag",
                onclick: () => {
                  addTag(cardId, tag);
                  showToast(`✓ Tag "${tag}" added`);
                  modal.remove();
                  render();
                }
              },
              h("span", { className: "tag-name" }, tag),
              h("span", { className: "tag-score" }, `${Math.round(score * 100)}% match`)
            )
          ),
          h("button", {
            className: "btn btn-primary",
            onclick: () => {
              suggestions.forEach(({ tag }) => addTag(cardId, tag, true));
              save();
              showToast(`✓ ${suggestions.length} tags added`);
              modal.remove();
              render();
            }
          }, `Apply All ${suggestions.length} Tags`)
        )
      )
    );
    document.body.appendChild(modal);
  }
  function getCardWithDescendants(cardId) {
    const card = store.cards[cardId];
    if (!card) return null;
    const result = {
      id: card.id,
      title: card.title,
      body: card.body,
      tags: card.tags || [],
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      children: []
    };
    if (card.children && card.children.length > 0) {
      card.children.forEach((childId) => {
        const childData = getCardWithDescendants(childId);
        if (childData) result.children.push(childData);
      });
    }
    return result;
  }
  function cardToMarkdown(cardData, depth = 0) {
    let md = "";
    const indent = "  ".repeat(depth);
    const headingLevel = Math.min(depth + 1, 6);
    const heading = "#".repeat(headingLevel);
    md += `${heading} ${cardData.title || "(Untitled)"}

`;
    if (cardData.tags && cardData.tags.length > 0) {
      md += `*Tags: ${cardData.tags.map((t) => "#" + t).join(", ")}*

`;
    }
    if (cardData.body) {
      md += `${cardData.body}

`;
    }
    if (cardData.children && cardData.children.length > 0) {
      cardData.children.forEach((child) => {
        md += cardToMarkdown(child, depth + 1);
      });
    }
    return md;
  }
  function showShareCard(cardId) {
    const card = store.cards[cardId];
    if (!card) {
      showToast("Card not found", "error");
      return;
    }
    const modal = h(
      "div",
      {
        className: "modal-overlay show",
        onclick: (e) => {
          if (e.target === modal) modal.remove();
        }
      },
      h(
        "div",
        { className: "modal", style: "max-width: 600px;" },
        h(
          "div",
          { className: "modal-header" },
          h("div", { className: "modal-title" }, "Share Card"),
          h("button", {
            className: "modal-close",
            "aria-label": "Close",
            onclick: () => modal.remove()
          }, "✕")
        ),
        h(
          "div",
          { className: "modal-body" },
          h(
            "p",
            { style: "margin-bottom: var(--space-xl); color: var(--text-secondary);" },
            "Copy this card in different formats to share with others."
          ),
          // Card only - JSON
          h(
            "div",
            { style: "margin-bottom: var(--space-lg);" },
            h("h3", { style: "margin-bottom: var(--space-md);" }, "Card Only"),
            h("button", {
              className: "btn btn-primary",
              style: "width: 100%; margin-bottom: var(--space-sm);",
              onclick: () => {
                const cardData = {
                  id: card.id,
                  title: card.title,
                  body: card.body,
                  tags: card.tags || []
                };
                navigator.clipboard.writeText(JSON.stringify(cardData, null, 2)).then(() => {
                  showToast("Card copied as JSON");
                  modal.remove();
                }).catch(() => showToast("Failed to copy", "error"));
              }
            }, "Copy as JSON"),
            h("button", {
              className: "btn",
              style: "width: 100%;",
              onclick: () => {
                let md = `# ${card.title || "(Untitled)"}

`;
                if (card.tags && card.tags.length > 0) {
                  md += `*Tags: ${card.tags.map((t) => "#" + t).join(", ")}*

`;
                }
                md += card.body || "";
                navigator.clipboard.writeText(md).then(() => {
                  showToast("Card copied as Markdown");
                  modal.remove();
                }).catch(() => showToast("Failed to copy", "error"));
              }
            }, "Copy as Markdown")
          ),
          // Card + Children
          h(
            "div",
            { style: "margin-bottom: var(--space-lg);" },
            h("h3", { style: "margin-bottom: var(--space-md);" }, "Card + Children"),
            h("button", {
              className: "btn btn-primary",
              style: "width: 100%; margin-bottom: var(--space-sm);",
              onclick: () => {
                const cardData = getCardWithDescendants(card.id);
                navigator.clipboard.writeText(JSON.stringify(cardData, null, 2)).then(() => {
                  showToast("Card tree copied as JSON");
                  modal.remove();
                }).catch(() => showToast("Failed to copy", "error"));
              }
            }, "Copy Tree as JSON"),
            h("button", {
              className: "btn",
              style: "width: 100%;",
              onclick: () => {
                const cardData = getCardWithDescendants(card.id);
                const md = cardToMarkdown(cardData);
                navigator.clipboard.writeText(md).then(() => {
                  showToast("Card tree copied as Markdown");
                  modal.remove();
                }).catch(() => showToast("Failed to copy", "error"));
              }
            }, "Copy Tree as Markdown")
          ),
          h(
            "div",
            { style: "font-size: var(--text-sm); color: var(--text-secondary); padding: var(--space-md); background: var(--bg-secondary); border-radius: var(--radius);" },
            "Tip: Use JSON format to import the card into another CardSpoke instance. Use Markdown to share in documents or emails."
          )
        )
      )
    );
    document.body.appendChild(modal);
  }
  function showGettingStarted() {
    let modal = document.getElementById("gettingStartedModal");
    if (!modal) {
      modal = h(
        "div",
        {
          id: "gettingStartedModal",
          className: "menu-overlay",
          onclick: (e) => {
            if (e.target === modal) modal.classList.remove("show");
          }
        },
        h(
          "div",
          { className: "menu-panel", style: "max-width: 700px; max-height: 85vh; overflow-y: auto;" },
          h(
            "div",
            { className: "menu-header" },
            h("div", { className: "menu-title" }, "Getting Started with CardSpoke"),
            h("button", {
              className: "menu-close",
              "aria-label": "Close",
              onclick: () => modal.classList.remove("show")
            }, "✕")
          ),
          h(
            "div",
            { style: "padding: var(--space-lg);" },
            // Welcome
            h(
              "div",
              { style: "margin-bottom: var(--space-xl); text-align: center;" },
              h("h2", { style: "margin-bottom: var(--space-sm); color: var(--primary);" }, "Welcome to CardSpoke!"),
              h("p", { style: "color: var(--text-secondary);" }, "A local-first, lightweight hierarchical note-taking app")
            ),
            // What are Cards?
            h(
              "div",
              { style: "margin-bottom: var(--space-xl);" },
              h("h3", { style: "margin-bottom: var(--space-md); color: var(--primary);" }, "What are Cards?"),
              h(
                "p",
                { style: "margin-bottom: var(--space-sm);" },
                "Cards are the building blocks of CardSpoke. Think of them as notes or ideas that can be organized hierarchically."
              ),
              h(
                "ul",
                { style: "margin-left: var(--space-lg); margin-bottom: var(--space-sm);" },
                h("li", { style: "margin-bottom: var(--space-xs);" }, "Each card has a title and body content"),
                h("li", { style: "margin-bottom: var(--space-xs);" }, "Cards can have child cards to create nested structures"),
                h("li", { style: "margin-bottom: var(--space-xs);" }, "Organize your thoughts in a hierarchy that makes sense to you")
              )
            ),
            // Creating Cards
            h(
              "div",
              { style: "margin-bottom: var(--space-xl);" },
              h("h3", { style: "margin-bottom: var(--space-md); color: var(--primary);" }, "Creating Cards"),
              h(
                "div",
                { style: "background: var(--bg-secondary); padding: var(--space-md); border-radius: var(--radius); border-left: 3px solid var(--primary); margin-bottom: var(--space-md);" },
                h("p", { style: "font-weight: 600; margin-bottom: var(--space-xs);" }, "To create your first card:"),
                h(
                  "ol",
                  { style: "margin-left: var(--space-lg);" },
                  h("li", { style: "margin-bottom: var(--space-xs);" }, "Click the menu button (☰) in the top right"),
                  h("li", { style: "margin-bottom: var(--space-xs);" }, 'Select "New Card" or press Ctrl+N'),
                  h("li", { style: "margin-bottom: var(--space-xs);" }, "Add a title and body text"),
                  h("li", {}, 'Click "Save Card"')
                )
              ),
              h(
                "p",
                { style: "margin-bottom: var(--space-sm);" },
                'To create a child card, open any existing card and click the "Add Child Card" button. Child cards appear nested under their parent.'
              )
            ),
            // Tags
            h(
              "div",
              { style: "margin-bottom: var(--space-xl);" },
              h("h3", { style: "margin-bottom: var(--space-md); color: var(--primary);" }, "Using Tags"),
              h(
                "p",
                { style: "margin-bottom: var(--space-sm);" },
                "Tags help you categorize and find cards quickly:"
              ),
              h(
                "ul",
                { style: "margin-left: var(--space-lg); margin-bottom: var(--space-sm);" },
                h("li", { style: "margin-bottom: var(--space-xs);" }, "Add tags when creating or editing a card"),
                h("li", { style: "margin-bottom: var(--space-xs);" }, "Click on a tag to see all cards with that tag"),
                h("li", { style: "margin-bottom: var(--space-xs);" }, "Use Tag Manager (in menu) to rename, merge, or delete tags")
              )
            ),
            // Search
            h(
              "div",
              { style: "margin-bottom: var(--space-xl);" },
              h("h3", { style: "margin-bottom: var(--space-md); color: var(--primary);" }, "Finding Cards with Search"),
              h(
                "p",
                { style: "margin-bottom: var(--space-sm);" },
                "CardSpoke has powerful search capabilities:"
              ),
              h(
                "ul",
                { style: "margin-left: var(--space-lg); margin-bottom: var(--space-sm);" },
                h("li", { style: "margin-bottom: var(--space-xs);" }, "Press Ctrl+F or click the search icon to search"),
                h("li", { style: "margin-bottom: var(--space-xs);" }, "Use ↑/↓ arrow keys to navigate results"),
                h("li", { style: "margin-bottom: var(--space-xs);" }, "Press Enter to open the selected card"),
                h("li", { style: "margin-bottom: var(--space-xs);" }, "Search works across titles, content, and tags")
              )
            ),
            // Other Features
            h(
              "div",
              { style: "margin-bottom: var(--space-xl);" },
              h("h3", { style: "margin-bottom: var(--space-md); color: var(--primary);" }, "More Features"),
              h(
                "div",
                { style: "display: grid; gap: var(--space-md);" },
                h(
                  "div",
                  {},
                  h("strong", {}, "Bookmarks"),
                  " — Click the star icon on any card to bookmark it for quick access"
                ),
                h(
                  "div",
                  {},
                  h("strong", {}, "Undo/Redo"),
                  " — Press Ctrl+Z to undo and Ctrl+Y to redo changes"
                ),
                h(
                  "div",
                  {},
                  h("strong", {}, "Export"),
                  " — Save your data in JSON, Markdown, or CSV formats (Data & Export menu)"
                ),
                h(
                  "div",
                  {},
                  h("strong", {}, "Backups"),
                  " — Create manual backups anytime from the Data & Export menu"
                ),
                h(
                  "div",
                  {},
                  h("strong", {}, "Plugins"),
                  " — Customize CardSpoke with themes and plugins (Plugin Manager)"
                ),
                h(
                  "div",
                  {},
                  h("strong", {}, "Dark Mode"),
                  " — Toggle dark mode with the moon icon in the header"
                )
              )
            ),
            // Privacy Note
            h(
              "div",
              { style: "margin-bottom: var(--space-lg);" },
              h(
                "div",
                { style: "background: var(--bg-secondary); padding: var(--space-md); border-radius: var(--radius);" },
                h("p", { style: "margin-bottom: var(--space-xs); font-weight: 600;" }, "Your Privacy Matters"),
                h(
                  "p",
                  { style: "color: var(--text-secondary); font-size: 0.9rem;" },
                  "All your data is stored locally on your device. CardSpoke never sends your data to any server. You have complete control and ownership of your information."
                )
              )
            ),
            // Get Started Button
            h(
              "div",
              { style: "text-align: center;" },
              h("button", {
                className: "btn btn-primary",
                style: "padding: var(--space-md) var(--space-xl);",
                onclick: () => {
                  modal.classList.remove("show");
                  localStorage.setItem("cardspoke_hasSeenGettingStarted", "true");
                  goTo("edit", { cardId: null, parentId: null });
                }
              }, "Create Your First Card")
            )
          )
        )
      );
      document.body.appendChild(modal);
    }
    modal.classList.add("show");
  }
  function showHelp() {
    let helpModal = document.getElementById("inAppHelpModal");
    if (!helpModal) {
      helpModal = h(
        "div",
        {
          id: "inAppHelpModal",
          className: "menu-overlay",
          onclick: (e) => {
            if (e.target === helpModal) helpModal.classList.remove("show");
          }
        },
        h(
          "div",
          { className: "menu-panel", style: "max-width: 600px; max-height: 80vh; overflow-y: auto;" },
          h(
            "div",
            { className: "menu-header" },
            h("div", { className: "menu-title" }, "Help & Documentation"),
            h("button", {
              className: "menu-close",
              onclick: () => helpModal.classList.remove("show")
            }, "✕")
          ),
          h(
            "div",
            { style: "padding: var(--space-md);" },
            // Quick Start Section
            h(
              "div",
              { style: "margin-bottom: var(--space-lg);" },
              h("h3", { style: "margin-bottom: var(--space-sm); color: var(--primary);" }, "Quick Start"),
              h("p", { style: "margin-bottom: var(--space-xs);" }, '1. Click "New Card" to create your first card'),
              h("p", { style: "margin-bottom: var(--space-xs);" }, "2. Add content, tags, and child cards"),
              h("p", { style: "margin-bottom: var(--space-xs);" }, "3. Use search to find cards quickly"),
              h("p", {}, "4. Organize with bookmarks and recent cards")
            ),
            // Features Section
            h(
              "div",
              { style: "margin-bottom: var(--space-lg);" },
              h("h3", { style: "margin-bottom: var(--space-sm); color: var(--primary);" }, "Key Features"),
              h(
                "div",
                { style: "display: grid; gap: var(--space-sm);" },
                h("div", {}, h("strong", {}, "Cards"), " — Hierarchical notes with parent-child relationships"),
                h("div", {}, h("strong", {}, "Tags"), " — Organize and filter cards with tags"),
                h("div", {}, h("strong", {}, "Links"), " — Reference other cards with [[Card Name]]"),
                h("div", {}, h("strong", {}, "Search"), " — Fuzzy search across all cards"),
                h("div", {}, h("strong", {}, "Bookmarks"), " — Star important cards for quick access"),
                h("div", {}, h("strong", {}, "Undo/Redo"), " — Ctrl+Z / Ctrl+Y for changes"),
                h("div", {}, h("strong", {}, "Trash Bin"), " — Recover deleted cards"),
                h("div", {}, h("strong", {}, "Plugins"), " — Customize with themes and plugins")
              )
            ),
            // Keyboard Shortcuts Section
            h(
              "div",
              { style: "margin-bottom: var(--space-lg);" },
              h("h3", { style: "margin-bottom: var(--space-sm); color: var(--primary);" }, "Keyboard Shortcuts"),
              h(
                "div",
                { style: "display: grid; grid-template-columns: auto 1fr; gap: var(--space-xs) var(--space-md);" },
                h("kbd", { style: "background: var(--bg-alt); padding: 2px 6px; border-radius: 4px;" }, "Ctrl+N"),
                h("span", {}, "New card"),
                h("kbd", { style: "background: var(--bg-alt); padding: 2px 6px; border-radius: 4px;" }, "Ctrl+F"),
                h("span", {}, "Search"),
                h("kbd", { style: "background: var(--bg-alt); padding: 2px 6px; border-radius: 4px;" }, "Ctrl+Z"),
                h("span", {}, "Undo"),
                h("kbd", { style: "background: var(--bg-alt); padding: 2px 6px; border-radius: 4px;" }, "Ctrl+Y"),
                h("span", {}, "Redo"),
                h("kbd", { style: "background: var(--bg-alt); padding: 2px 6px; border-radius: 4px;" }, "Ctrl+/"),
                h("span", {}, "All shortcuts")
              )
            ),
            // Plugins Section
            h(
              "div",
              { style: "margin-bottom: var(--space-lg);" },
              h("h3", { style: "margin-bottom: var(--space-sm); color: var(--primary);" }, "Plugins"),
              h("p", { style: "margin-bottom: var(--space-xs);" }, "CardSpoke supports JSON-based plugins in three layers:"),
              h(
                "ul",
                { style: "margin-left: var(--space-md); margin-bottom: var(--space-sm);" },
                h("li", {}, "Theme plugins: CSS-only visual changes (auto-enabled)"),
                h("li", {}, "Feature plugins: Add new functionality with the plugin API"),
                h("li", {}, "App plugins: Deep transformations (middleware, components, app rename) — enabled manually")
              ),
              h(
                "p",
                { style: "font-size: var(--text-sm); color: var(--text-secondary);" },
                "Access Plugin Manager from the menu to install and manage plugins."
              )
            ),
            // Advanced Features Section
            h(
              "div",
              { style: "margin-bottom: var(--space-lg);" },
              h("h3", { style: "margin-bottom: var(--space-sm); color: var(--primary);" }, "Advanced Features"),
              h(
                "div",
                { style: "display: grid; gap: var(--space-sm);" },
                h(
                  "div",
                  {},
                  h("strong", {}, "Tag Manager"),
                  " — Rename, merge, or delete tags across all cards. Access from the menu."
                ),
                h(
                  "div",
                  {},
                  h("strong", {}, "Advanced Search"),
                  " — Filter cards by tag, bookmark status, or date range. Access from the menu."
                ),
                h(
                  "div",
                  {},
                  h("strong", {}, "Datasets"),
                  " — Create multiple isolated data vaults. Access from Data & Export menu."
                ),
                h(
                  "div",
                  {},
                  h("strong", {}, "Developer Mode"),
                  " — Enable in Appearance settings to access debugging tools and system information."
                )
              )
            ),
            // Data & Privacy Section
            h(
              "div",
              { style: "margin-bottom: var(--space-lg);" },
              h("h3", { style: "margin-bottom: var(--space-sm); color: var(--primary);" }, "Data & Privacy"),
              h("p", {}, "Your data is stored locally on your device. CardSpoke never sends your data to external servers. Export anytime to JSON, Markdown, or CSV.")
            ),
            // Language & Localization Section (v1.0.0)
            h(
              "div",
              { style: "margin-bottom: var(--space-lg);" },
              h("h3", { style: "margin-bottom: var(--space-sm); color: var(--primary);" }, "Language & Localization"),
              h(
                "p",
                { style: "margin-bottom: var(--space-sm);" },
                "CardSpoke supports community language packs. Visit the CardSpoke website to download language packs for your preferred language."
              ),
              h(
                "p",
                { style: "font-size: var(--text-sm); color: var(--text-secondary);" },
                "Coming soon: Download language packs from ",
                h("a", {
                  href: "https://github.com/jxburros/CardSpoke/wiki/Language-Packs",
                  target: "_blank",
                  style: "color: var(--primary);"
                }, "CardSpoke Language Packs")
              )
            ),
            // Version Info
            h(
              "div",
              { style: "padding-top: var(--space-md); border-top: 1px solid var(--border); text-align: center; color: var(--text-secondary);" },
              h("p", {}, `CardSpoke v${APP_VERSION}`),
              h(
                "p",
                { style: "font-size: var(--text-sm);" },
                h("a", { href: "https://github.com/jxburros/CardSpoke", target: "_blank", style: "color: var(--primary);" }, "GitHub"),
                " · ",
                h("a", { href: "https://github.com/jxburros/CardSpoke/blob/main/README.md", target: "_blank", style: "color: var(--primary);" }, "Documentation")
              )
            )
          )
        )
      );
      document.body.appendChild(helpModal);
    }
    helpModal.classList.add("show");
  }
  function showKeyboardHelp() {
    let helpModal = document.getElementById("keyboardHelpModal");
    if (!helpModal) {
      helpModal = h(
        "div",
        {
          id: "keyboardHelpModal",
          className: "menu-overlay",
          onclick: (e) => {
            if (e.target === helpModal) helpModal.classList.remove("show");
          }
        },
        h(
          "div",
          { className: "menu-panel" },
          h(
            "div",
            { className: "menu-header" },
            h("div", { className: "menu-title" }, "Keyboard Shortcuts"),
            h("button", {
              className: "menu-close",
              onclick: () => helpModal.classList.remove("show")
            }, "✕")
          ),
          h(
            "div",
            { className: "keyboard-shortcuts" },
            h(
              "div",
              { className: "shortcuts-section" },
              h("div", { className: "shortcuts-section-title" }, "Navigation"),
              ...Object.entries(shortcuts).filter(([key]) => ["ctrl+h", "ctrl+b", "ctrl+r", "escape"].includes(key)).map(
                ([key, { description }]) => h(
                  "div",
                  { className: "shortcut-item" },
                  h("kbd", {}, key.replace("ctrl+", "Ctrl+")),
                  h("span", {}, description)
                )
              )
            ),
            h(
              "div",
              { className: "shortcuts-section" },
              h("div", { className: "shortcuts-section-title" }, "Actions"),
              ...Object.entries(shortcuts).filter(([key]) => ["ctrl+n", "ctrl+f", "ctrl+u", "ctrl+e"].includes(key)).map(
                ([key, { description }]) => h(
                  "div",
                  { className: "shortcut-item" },
                  h("kbd", {}, key.replace("ctrl+", "Ctrl+")),
                  h("span", {}, description)
                )
              )
            ),
            h(
              "div",
              { className: "shortcuts-section" },
              h("div", { className: "shortcuts-section-title" }, "View"),
              ...Object.entries(shortcuts).filter(([key]) => ["alt+t", "alt+c"].includes(key)).map(
                ([key, { description }]) => h(
                  "div",
                  { className: "shortcut-item" },
                  h("kbd", {}, key.replace("alt+", "Alt+")),
                  h("span", {}, description)
                )
              )
            ),
            h(
              "div",
              { className: "shortcuts-section" },
              h("div", { className: "shortcuts-section-title" }, "Help"),
              h(
                "div",
                { className: "shortcut-item" },
                h("kbd", {}, "Ctrl+/"),
                h("span", {}, "Show this help")
              )
            )
          )
        )
      );
      document.body.appendChild(helpModal);
    }
    helpModal.classList.add("show");
  }
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
      if (e.key === "Escape") {
        e.target.blur();
        handleEscape();
      }
      return;
    }
    let key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) key = "ctrl+" + key;
    if (e.altKey) key = "alt+" + key;
    const shortcut = shortcuts[key];
    if (shortcut) {
      e.preventDefault();
      try {
        shortcut.action();
      } catch (error) {
        console.error("Keyboard shortcut error:", error);
        showToast("Shortcut failed: " + key, "error");
      }
    }
  });
  function showDeveloperConsole() {
    const overlay = h("div", { className: "modal-overlay show" });
    const modal = h("div", { className: "modal", style: "max-width: 800px;" });
    const modalHeader = h("div", { className: "modal-header" });
    modalHeader.appendChild(h("div", { className: "modal-title" }, "🔧 Developer Console"));
    const closeBtn = h("button", {
      className: "modal-close",
      "aria-label": "Close developer console",
      onclick: () => overlay.remove()
    }, "X");
    modalHeader.appendChild(closeBtn);
    modal.appendChild(modalHeader);
    const modalBody = h("div", { className: "modal-body", style: "max-height: 70vh; overflow-y: auto;" });
    const sysSection = h("div", { style: "margin-bottom: var(--space-xl); padding: var(--space-lg); background: var(--bg-secondary); border-radius: var(--radius);" });
    sysSection.appendChild(h("div", { style: "font-weight: 700; margin-bottom: var(--space-md); font-size: var(--text-lg);" }, "📊 System Information"));
    const sysInfo = [
      { label: "App Version", value: APP_VERSION },
      { label: "Schema Version", value: store.schemaVersion || "N/A" },
      { label: "Active Dataset", value: datasetManager ? datasetManager.getActiveDataset().name : "Default" },
      { label: "Total Cards", value: Object.keys(store.cards).length },
      { label: "Root Cards", value: store.rootOrder.length },
      { label: "Total Tags", value: getAllTags().length },
      { label: "Active Plugins", value: store.plugins ? Object.keys(store.plugins).length : 0 },
      { label: "Developer Mode", value: isDeveloperMode() ? "✓ Enabled" : "✗ Disabled" }
    ];
    sysInfo.forEach((info) => {
      const row = h("div", { style: "display: flex; justify-content: space-between; padding: var(--space-sm) 0; border-bottom: 1px solid var(--border);" });
      row.appendChild(h("span", { style: "font-weight: 600;" }, info.label + ":"));
      row.appendChild(h("span", { style: "font-family: monospace; color: var(--text-secondary);" }, String(info.value)));
      sysSection.appendChild(row);
    });
    modalBody.appendChild(sysSection);
    const statsSection = h("div", { style: "margin-bottom: var(--space-xl); padding: var(--space-lg); background: var(--bg-secondary); border-radius: var(--radius);" });
    statsSection.appendChild(h("div", { style: "font-weight: 700; margin-bottom: var(--space-md); font-size: var(--text-lg);" }, "📈 Card Statistics"));
    const bookmarkedCount = Object.values(store.cards).filter((c) => c.bookmarked).length;
    const withTagsCount = Object.values(store.cards).filter((c) => c.tags && c.tags.length > 0).length;
    const withChildrenCount = Object.values(store.cards).filter((c) => c.children && c.children.length > 0).length;
    const stats = [
      { label: "Bookmarked Cards", value: bookmarkedCount },
      { label: "Cards with Tags", value: withTagsCount },
      { label: "Cards with Children", value: withChildrenCount },
      { label: "Orphaned Cards", value: Object.values(store.cards).filter((c) => !c.parentId && !store.rootOrder.includes(c.id)).length }
    ];
    stats.forEach((stat) => {
      const row = h("div", { style: "display: flex; justify-content: space-between; padding: var(--space-sm) 0; border-bottom: 1px solid var(--border);" });
      row.appendChild(h("span", { style: "font-weight: 600;" }, stat.label + ":"));
      row.appendChild(h("span", { style: "font-family: monospace; color: var(--text-secondary);" }, String(stat.value)));
      statsSection.appendChild(row);
    });
    modalBody.appendChild(statsSection);
    const activitySection = h("div", { style: "margin-bottom: var(--space-xl); padding: var(--space-lg); background: var(--bg-secondary); border-radius: var(--radius);" });
    activitySection.appendChild(h("div", { style: "font-weight: 700; margin-bottom: var(--space-md); font-size: var(--text-lg);" }, "🕐 Recent Activity"));
    const recentCards = Object.values(store.cards).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)).slice(0, 5);
    if (recentCards.length > 0) {
      recentCards.forEach((card) => {
        const row = h("div", {
          style: "padding: var(--space-sm); border-bottom: 1px solid var(--border); cursor: pointer;",
          onclick: () => {
            overlay.remove();
            goTo("read", { cardId: card.id });
          }
        });
        row.appendChild(h("div", { style: "font-weight: 600; margin-bottom: var(--space-xs);" }, card.title || "(Untitled)"));
        const timestamp = new Date(card.updatedAt || card.createdAt).toLocaleString();
        row.appendChild(h(
          "div",
          { style: "font-size: var(--text-sm); color: var(--text-secondary); font-family: monospace;" },
          `ID: ${card.id.slice(0, 8)}... • Updated: ${timestamp}`
        ));
        activitySection.appendChild(row);
      });
    } else {
      activitySection.appendChild(h("div", { style: "color: var(--text-secondary); font-style: italic;" }, "No recent activity"));
    }
    modalBody.appendChild(activitySection);
    const storageSection = h("div", { style: "margin-bottom: var(--space-xl); padding: var(--space-lg); background: var(--bg-secondary); border-radius: var(--radius);" });
    storageSection.appendChild(h("div", { style: "font-weight: 700; margin-bottom: var(--space-md); font-size: var(--text-lg);" }, "💾 Storage Information"));
    let storageUsed = 0;
    try {
      let total = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          total += localStorage[key].length + key.length;
        }
      }
      storageUsed = (total / 1024).toFixed(2);
    } catch (e) {
      storageUsed = "N/A";
    }
    const storageInfo = [
      { label: "LocalStorage Used", value: storageUsed + " KB" },
      { label: "Storage Keys", value: Object.keys(localStorage).filter((k) => k.startsWith("cardspoke_")).length }
    ];
    storageInfo.forEach((info) => {
      const row = h("div", { style: "display: flex; justify-content: space-between; padding: var(--space-sm) 0; border-bottom: 1px solid var(--border);" });
      row.appendChild(h("span", { style: "font-weight: 600;" }, info.label + ":"));
      row.appendChild(h("span", { style: "font-family: monospace; color: var(--text-secondary);" }, String(info.value)));
      storageSection.appendChild(row);
    });
    modalBody.appendChild(storageSection);
    const actionsSection = h("div", { style: "padding: var(--space-lg); background: var(--bg-secondary); border-radius: var(--radius);" });
    actionsSection.appendChild(h("div", { style: "font-weight: 700; margin-bottom: var(--space-md); font-size: var(--text-lg);" }, "⚡ Quick Actions"));
    const actionsRow = h("div", { style: "display: flex; gap: var(--space-sm); flex-wrap: wrap;" });
    const exportBtn = h("button", {
      className: "btn btn-primary",
      onclick: () => {
        overlay.remove();
        exportJSON("instance");
      }
    }, "Export Data");
    actionsRow.appendChild(exportBtn);
    const consoleBtn = h("button", {
      className: "btn",
      onclick: () => {
        console.log("[Developer Console] Store:", store);
        console.log("[Developer Console] NavState:", navState);
        showToast("Store logged to browser console", "info");
      }
    }, "Log to Console");
    actionsRow.appendChild(consoleBtn);
    const refreshBtn = h("button", {
      className: "btn",
      onclick: () => {
        overlay.remove();
        showDeveloperConsole();
      }
    }, "Refresh");
    actionsRow.appendChild(refreshBtn);
    actionsSection.appendChild(actionsRow);
    modalBody.appendChild(actionsSection);
    modal.appendChild(modalBody);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.remove();
    };
  }
  window.save = save;
  window.createCard = createCard;
  window.updateCard = updateCard;
  window.deleteCard = deleteCard;
  window.cloneCard = cloneCard;
  window.getTags = getTags;
  window.addTag = addTag;
  window.removeTag = removeTag;
  window.setTags = setTags;
  window.getAllTags = getAllTags;
  window.showToast = showToast;
  (async function() {
    initToast();
    initModalA11yObserver();
    const urlParams = new URLSearchParams(window.location.search);
    let safeMode = urlParams.has("safemode");
    if (safeMode) {
      console.warn("[Safe Mode] Plugins disabled via ?safemode parameter");
      showToast("Safe Mode Active - Plugins Disabled", "warning");
    }
    try {
      await load();
    } catch (err) {
      console.error("[Boot] load() failed; continuing with a usable store:", err);
      if (!store || typeof store !== "object" || !store.cards) {
        setStore(createDefaultStore());
      }
    }
    populateFooter();
    updateDatasetSelector();
    const savedTypography = localStorage.getItem("cardspoke_typography") || "default";
    document.documentElement.setAttribute("data-typography", savedTypography);
    if (window.CardSpoke && window.CardSpoke.Plugin && window.CardSpoke.Plugin.syncFromStore) {
      await window.CardSpoke.Plugin.syncFromStore(safeMode);
    }
    if (typeof applyRegistryComponents === "function") {
      await applyRegistryComponents();
    }
    render();
    populateFooter();
    setTimeout(() => {
      const hasSeenGettingStarted = localStorage.getItem("cardspoke_hasSeenGettingStarted");
      const hasCards = Object.keys(store.cards || {}).length > 0;
      if (!hasSeenGettingStarted && !hasCards) {
        showGettingStarted();
      }
    }, 500);
    window.addEventListener("beforeunload", (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  })();
})();
