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


// Plugin Validation System
// Validates plugin manifests, CSS, and JS content before execution
// Prevents malformed or potentially dangerous plugins from loading

// Valid values for plugin manifest fields
var VALID_LAYERS = ['theme', 'feature', 'app'];
  var VALID_PERMISSIONS = ['ui-override', 'storage', 'network', 'filesystem', 'core-override', 'data-modify'];
  var MAX_CSS_LENGTH = 100000;   // 100KB max CSS
  var MAX_JS_LENGTH = 500000;    // 500KB max JS
  // Documented plugin id format: lowercase letters, digits and hyphens,
  // no leading/trailing hyphen.
  var PLUGIN_ID_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  // Characters an id may contain at all. Ids outside the documented format
  // but within this set (uppercase, underscores) were accepted by earlier
  // releases, so they stay loadable with a warning instead of silently
  // disappearing from existing datasets after an upgrade.
  var PLUGIN_ID_SAFE_CHARS = /^[A-Za-z0-9_-]+$/;

  // Dangerous CSS patterns that could be used for attacks
  var DANGEROUS_CSS_PATTERNS = [
    { pattern: /@import/gi, name: '@import (external resource loading)' },
    { pattern: /javascript:/gi, name: 'javascript: protocol' },
    { pattern: /behavior:/gi, name: 'behavior: (IE behavior)' },
    { pattern: /-moz-binding/gi, name: '-moz-binding (Mozilla binding)' },
    { pattern: /expression\s*\(/gi, name: 'expression() (IE expressions)' }
  ];

  // Dangerous JS patterns
  // Task 1.3: Allow new Function('ctx', ...) since the installer uses that exact pattern
  // to instantiate stringified JS from manifests. Other new Function() forms are still blocked.
  var DANGEROUS_JS_PATTERNS = [
    { pattern: /\beval\s*\(/g, name: 'eval()' },
    { pattern: /\bnew\s+Function\s*\(\s*(?!['"]ctx['"])/g, name: 'new Function()' }
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

      // 1. Validate required fields
      if (!plugin) {
        return { valid: false, errors: ['Plugin object is required'], warnings: [], sanitized: null };
      }

      if (!plugin.id || typeof plugin.id !== 'string') {
        errors.push('Plugin must have a string id');
      } else if (!PLUGIN_ID_SAFE_CHARS.test(plugin.id)) {
        // An error, not a warning: the id is interpolated into CSS selectors
        // (style[data-plugin-id="..."]), storage namespaces and middleware
        // names, so quotes, brackets, spaces or path-like characters must
        // never reach those sinks.
        errors.push('Plugin id may only contain letters, numbers, hyphens and underscores: ' +
          JSON.stringify(plugin.id));
      } else if (!PLUGIN_ID_PATTERN.test(plugin.id)) {
        warnings.push('Plugin id should use lowercase letters, numbers, and hyphens only ' +
          '(no leading/trailing hyphen): ' + JSON.stringify(plugin.id));
      }

      // 2. Validate manifest
      var manifestResult = this.validateManifest(plugin.manifest);
      errors = errors.concat(manifestResult.errors);
      warnings = warnings.concat(manifestResult.warnings);

      // 3. Validate and sanitize CSS
      if (plugin.css) {
        var cssResult = this.validateCSS(plugin.css);
        errors = errors.concat(cssResult.errors);
        warnings = warnings.concat(cssResult.warnings);
        if (cssResult.sanitized !== plugin.css) {
          plugin.css = cssResult.sanitized;
        }
      }

      // 4. Validate JS
      if (plugin.js) {
        var jsResult = this.validateJS(plugin.js);
        errors = errors.concat(jsResult.errors);
        warnings = warnings.concat(jsResult.warnings);
      }

      return {
        valid: errors.length === 0,
        errors: errors,
        warnings: warnings,
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

      if (!manifest || typeof manifest !== 'object') {
        errors.push('Plugin manifest is required and must be an object');
        return { errors: errors, warnings: warnings };
      }

      // Required fields
      if (!manifest.name || typeof manifest.name !== 'string') {
        errors.push('manifest.name is required and must be a string');
      } else if (manifest.name.length > 100) {
        errors.push('manifest.name must be 100 characters or less');
      }

      if (!manifest.version || typeof manifest.version !== 'string') {
        errors.push('manifest.version is required and must be a string');
      } else if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
        warnings.push('manifest.version should follow semver format (e.g., 1.0.0)');
      }

      if (!manifest.layer || typeof manifest.layer !== 'string') {
        errors.push('manifest.layer is required and must be a string');
      } else if (VALID_LAYERS.indexOf(manifest.layer) === -1) {
        errors.push('manifest.layer must be one of: ' + VALID_LAYERS.join(', '));
      }

      // Optional fields
      if (manifest.author && typeof manifest.author !== 'string') {
        warnings.push('manifest.author should be a string');
      } else if (manifest.author && manifest.author.length > 200) {
        warnings.push('manifest.author should be 200 characters or less');
      }

      if (manifest.description && typeof manifest.description !== 'string') {
        warnings.push('manifest.description should be a string');
      } else if (manifest.description && manifest.description.length > 500) {
        warnings.push('manifest.description should be 500 characters or less');
      }

      // Validate permissions
      if (manifest.permissions) {
        if (!Array.isArray(manifest.permissions)) {
          errors.push('manifest.permissions must be an array');
        } else {
          manifest.permissions.forEach(function(perm) {
            if (VALID_PERMISSIONS.indexOf(perm) === -1) {
              warnings.push('Unknown permission: ' + perm);
            }
          });
        }
      }

      return { errors: errors, warnings: warnings };
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

      if (typeof css !== 'string') {
        return { errors: ['CSS must be a string'], warnings: [], sanitized: '' };
      }

      if (css.length > MAX_CSS_LENGTH) {
        errors.push('CSS exceeds maximum size of ' + MAX_CSS_LENGTH + ' characters');
        return { errors: errors, warnings: warnings, sanitized: css };
      }

      // Check and remove dangerous patterns
      DANGEROUS_CSS_PATTERNS.forEach(function(entry) {
        if (entry.pattern.test(sanitized)) {
          warnings.push('Removed dangerous CSS pattern: ' + entry.name);
          sanitized = sanitized.replace(entry.pattern, '/* removed */');
        }
        // Reset lastIndex for global regex
        entry.pattern.lastIndex = 0;
      });

      return { errors: errors, warnings: warnings, sanitized: sanitized };
    },

    /**
     * Validate JS content for dangerous patterns
     * @param {string} js - JS string to validate
     * @returns {Object} { errors: string[], warnings: string[] }
     */
    validateJS: function(js) {
      var errors = [];
      var warnings = [];

      if (typeof js !== 'string') {
        return { errors: ['JS must be a string'], warnings: [] };
      }

      if (js.length > MAX_JS_LENGTH) {
        errors.push('JS exceeds maximum size of ' + MAX_JS_LENGTH + ' characters');
        return { errors: errors, warnings: warnings };
      }

      // Check for dangerous patterns
      DANGEROUS_JS_PATTERNS.forEach(function(entry) {
        if (entry.pattern.test(js)) {
          errors.push('Plugin contains ' + entry.name + ' - not allowed');
        }
        // Reset lastIndex for global regex
        entry.pattern.lastIndex = 0;
      });

      return { errors: errors, warnings: warnings };
    }
  };

  console.log('[PluginValidator] Validation system initialized');

export { PluginValidator };
