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


// =============================================================
// CardSpoke JavaScript Application (Source)
// Version: 0.21.1
// Creator: Jeffrey Guntly (https://github.com/jxburros)
// Maintainer: JX Holdings, LLC (https://jxholdings.com)
// Schema: v4
// Note: Sources are split across www/src/* and concatenated with
//       `npm run build` for the file://-friendly bundle in www/app.js.
// =============================================================

'use strict';

// ── Shared state & constants (ESM) ───────────────────────────────────────────
import {
  APP_CREATOR, APP_VERSION, APP_RELEASE_DATE, APP_UPDATER, SCHEMA_VERSION,
  MAX_UNDO_STACK, MAX_TRASH_SIZE,
  createDefaultStore,
  store, setStore,
  navState, setNavState,
  navHistory, setNavHistory,
  instanceKey, setInstanceKey,
  dirty, setDirty,
  searchResultsState, setSearchResultsState,
  draggedCardId, setDraggedCardId,
  dragOverCardId, setDragOverCardId,
  undoStack, redoStack, trashBin
} from './state.js';

// =============================================================
// --- SELF-CONTAINED UTILITIES ---
// All utilities are defined locally to support opening directly
// from the filesystem (file:// protocol) without CORS issues.
// =============================================================

// --- APP METADATA & SIGNATURES ---
// (Imported from ./state.js — APP_CREATOR, APP_VERSION, APP_RELEASE_DATE, APP_UPDATER, SCHEMA_VERSION)

/**
 * Helper function to create DOM elements
 */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'className') el.className = v;
    else if (k === 'onclick') el.onclick = v;
    else if (k === 'onsubmit') el.onsubmit = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'oninput') el.oninput = v;
    else if (k === 'onchange') el.onchange = v;
    else if (k === 'selected' || k === 'disabled' || k === 'checked' || k === 'readonly') {
      if (v) el.setAttribute(k, '');
    }
    else if (k === 'value' && (tag === 'input' || tag === 'textarea')) {
      // Set the field's live value as a DOM property, never as an HTML
      // attribute. Reflecting user content (card titles, tags) into a
      // [value="…"] attribute makes it readable by plugin CSS attribute
      // selectors — a silent exfiltration channel. The input property is not
      // matchable by CSS and carries the same value for form reads.
      el.value = v == null ? '' : v;
    }
    else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, v);
  });
  children.flat().forEach(ch => {
    if (typeof ch === 'string') el.appendChild(document.createTextNode(ch));
    else if (ch instanceof Node) el.appendChild(ch);
    else if (typeof ch === 'number' || typeof ch === 'boolean' || typeof ch === 'bigint') {
      el.appendChild(document.createTextNode(String(ch)));
    }
  });
  return el;
}

/**
 * Generate unique ID
 */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Debounce function
 */
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

/**
 * Normalize and split tag input
 */
function normalizeTagInput(raw) {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map(tag => tag.replace(/^#/, '').toLowerCase().trim())
    .filter(Boolean);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Highlight matched query terms within text
 */
function highlightText(text, query) {
  if (!query || !text) return document.createTextNode(text || '');
  const terms = query.split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
  if (!terms.length) return document.createTextNode(text);
  let html = escapeHtml(text);
  terms.forEach(term => {
    const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(safeTerm, 'gi'), match => `<mark>${match}</mark>`);
  });
  const span = document.createElement('span');
  span.innerHTML = html;
  return span;
}

/**
 * Clone a card object deeply
 */
function cloneCard(card) {
  if (!card) return null;
  let modsData = {};
  if (card.modsData) {
    try {
      modsData = JSON.parse(JSON.stringify(card.modsData));
    } catch (err) {
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

/**
 * Focus trapping for accessibility
 */
function trapFocus(modal) {
  const focusableElements = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusableElements.length) {
    return () => {};
  }
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  const handleKeyDown = (e) => {
    if (e.key !== 'Tab') return;

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

  modal.addEventListener('keydown', handleKeyDown);

  if (firstFocusable) {
    firstFocusable.focus();
  }

  return () => {
    modal.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Upgrade an ad-hoc modal overlay to the dialog accessibility contract
 * (CS-008): role="dialog", aria-modal, aria-labelledby (from the modal
 * title), focus trap, Escape-to-close for the topmost overlay only, and
 * focus restoration to the previously focused element on close.
 *
 * Works with both `.modal-overlay > .modal(.modal-title)` and
 * `.menu-overlay > .menu-panel(.menu-title)` structures. Every close path
 * funnels through overlay.remove(), which is wrapped here so cleanup and
 * focus restoration always run.
 */
function enhanceModalA11y(overlay) {
  if (!overlay || !overlay.dataset || overlay.dataset.a11yEnhanced === 'true') return;
  const modal = overlay.querySelector('.modal, .menu-panel');
  if (!modal) return;
  overlay.dataset.a11yEnhanced = 'true';

  const titleEl = modal.querySelector('.modal-title, .menu-title');
  if (titleEl) {
    if (!titleEl.id) titleEl.id = 'dialog-title-' + uid();
    modal.setAttribute('aria-labelledby', titleEl.id);
  }
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const previousActive = document.activeElement;
  const releaseFocus = trapFocus(modal);

  const isTopmostOverlay = () => {
    const overlays = document.querySelectorAll('.modal-overlay.show, .menu-overlay.show');
    return overlays.length > 0 && overlays[overlays.length - 1] === overlay;
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && isTopmostOverlay()) {
      e.preventDefault();
      e.stopPropagation();
      overlay.remove();
    }
  };
  document.addEventListener('keydown', onKeyDown, true);

  const originalRemove = overlay.remove.bind(overlay);
  overlay.remove = function() {
    document.removeEventListener('keydown', onKeyDown, true);
    if (typeof releaseFocus === 'function') releaseFocus();
    originalRemove();
    if (previousActive && typeof previousActive.focus === 'function' &&
        document.contains(previousActive)) {
      previousActive.focus();
    }
  };
}

/**
 * Watch for dynamically created modal/menu overlays and apply the dialog
 * accessibility contract to each one as it is added to the document.
 * Overlays that manage their own lifecycle opt out with
 * data-a11y-managed="true" (shared dialog primitives, lock screens) and
 * the permission dialogs (core module) are skipped via .permission-modal.
 */
function initModalA11yObserver() {
  if (typeof MutationObserver === 'undefined' || !document.body) return;
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (!node || node.nodeType !== 1 || !node.classList) return;
        const isOverlay = node.classList.contains('show') &&
          (node.classList.contains('modal-overlay') || node.classList.contains('menu-overlay'));
        if (!isOverlay) return;
        if (node.dataset.a11yManaged === 'true' || node.classList.contains('permission-modal')) return;
        enhanceModalA11y(node);
      });
    });
  });
  observer.observe(document.body, { childList: true });
}

/**
 * Format bytes into human readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Create a fresh store object with default values
 * @see ./state.js — canonical definition; re-exported here for local use.
 */
// (imported from ./state.js — createDefaultStore)

/**
 * Check if rich text mode is enabled globally
 */
function isRichTextEnabled() {
  return localStorage.getItem('cardspoke_richtext') === 'true';
}

/**
 * Set rich text mode
 */
function setRichTextEnabled(enabled) {
  localStorage.setItem('cardspoke_richtext', enabled ? 'true' : 'false');
}

/**
 * Get the active theme plugin ID (if any)
 */
function getActiveThemeMod() {
  return localStorage.getItem('cardspoke_activeThemeMod') || localStorage.getItem('cardspoke_activeThemeExtension') || null;
}

/**
 * Set the active theme plugin
 */
function setActiveThemeMod(modId) {
  if (modId) {
    localStorage.setItem('cardspoke_activeThemeMod', modId);
  } else {
    localStorage.removeItem('cardspoke_activeThemeMod');
  }
  localStorage.removeItem('cardspoke_activeThemeExtension');
}

/**
 * Check if developer mode is enabled
 * @returns {boolean} True if developer mode is active
 */
function isDeveloperMode() {
  return localStorage.getItem('cardspoke_devmode') === 'true';
}

// --- TOAST NOTIFICATION SYSTEM ---
let toastContainer = null;

/**
 * Initialize toast container
 */
function initToast() {
  toastContainer = document.getElementById('toastContainer');
}

/**
 * Show a toast notification
 */
function showToast(message, type = 'success', duration = 3000) {
  if (!toastContainer) {
    toastContainer = document.getElementById('toastContainer');
  }
  if (!toastContainer) {
    console.warn('[Toast] Container not found');
    return;
  }

  const toast = h('div', { 
    className: `toast ${type}`,
    role: 'alert',
    'aria-live': type === 'error' ? 'assertive' : 'polite',
    'aria-atomic': 'true',
    tabindex: '0'
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
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }
    }, remainingTime);
  };
  
  const pauseTimer = () => {
    if (!isPaused && timeoutId) {
      clearTimeout(timeoutId);
      remainingTime -= (Date.now() - startTime);
      isPaused = true;
    }
  };
  
  const resumeTimer = () => {
    if (isPaused) {
      isPaused = false;
      scheduleRemoval();
    }
  };

  toast.addEventListener('mouseenter', pauseTimer);
  toast.addEventListener('mouseleave', resumeTimer);

  // Add click to dismiss
  toast.style.cursor = 'pointer';
  const dismissToast = () => {
    clearTimeout(timeoutId);
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  };

  toast.addEventListener('click', dismissToast);

  // Add keyboard support
  toast.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      dismissToast();
    }
  });

  scheduleRemoval();
}

// =============================================================
// --- SHARED MODAL DIALOG PRIMITIVES ---
// The single accessible dialog implementation used by every confirm /
// choice / prompt flow in the app (CS-008): role="dialog", aria-modal,
// aria-labelledby wiring, focus trap, Escape handling, backdrop
// dismissal, and focus restoration to the previously focused element.
//
// NOTE: These MUST stay at module top level. They were once nested
// inside showToast()'s resumeTimer closure by accident, which made
// every confirm/prompt call site throw ReferenceError at runtime.
// =============================================================

    /**
     * Show an in-app modal dialog and resolve with the chosen value.
     * @param {Object} options - Dialog configuration
     * @returns {Promise<any>}
     */
    function showModalDialog(options = {}) {
      const {
        title = 'Dialog',
        message = '',
        content = null,
        actions = [],
        dismissValue = null,
        width = '520px',
        ariaLabelledBy = '',
        onOpen = null
      } = options;

      return new Promise(resolve => {
        const previousActive = document.activeElement;
        // Manages its own focus/Escape lifecycle — opt out of the observer.
        const overlay = h('div', { className: 'modal-overlay show', 'data-a11y-managed': 'true' });
        const modal = h('div', {
          className: 'modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': ariaLabelledBy || `dialog-title-${uid()}`,
          style: `max-width: ${width};`
        });
        const modalHeader = h('div', { className: 'modal-header' });
        const titleEl = h('div', {
          className: 'modal-title',
          id: modal.getAttribute('aria-labelledby')
        }, title);
        modalHeader.appendChild(titleEl);

        const closeBtn = h('button', {
          className: 'modal-close',
          type: 'button',
          'aria-label': 'Close dialog'
        }, '×');
        modalHeader.appendChild(closeBtn);
        modal.appendChild(modalHeader);

        const modalBody = h('div', { className: 'modal-body' });
        if (message) {
          modalBody.appendChild(h('div', { className: 'modal-message' }, message));
        }
        if (content) {
          modalBody.appendChild(content);
        }

        const modalActions = h('div', { className: 'modal-actions' });
        modalBody.appendChild(modalActions);
        modal.appendChild(modalBody);
        overlay.appendChild(modal);

        let releasedFocus = null;
        let settled = false;

        const finish = value => {
          if (settled) return;
          settled = true;
          document.removeEventListener('keydown', onKeyDown);
          if (releasedFocus) releasedFocus();
          overlay.remove();
          if (previousActive && typeof previousActive.focus === 'function') {
            previousActive.focus();
          }
          resolve(value);
        };

        const onKeyDown = e => {
          if (e.key === 'Escape') {
            // Only the topmost overlay may react — a confirm stacked over
            // another dialog must not close both.
            const overlays = document.querySelectorAll('.modal-overlay.show, .menu-overlay.show');
            if (overlays.length && overlays[overlays.length - 1] !== overlay) return;
            e.preventDefault();
            finish(dismissValue);
          }
        };

        document.addEventListener('keydown', onKeyDown);
        closeBtn.onclick = () => finish(dismissValue);
        overlay.onclick = e => {
          if (e.target === overlay) finish(dismissValue);
        };

        actions.forEach(action => {
          const btn = h('button', {
            type: 'button',
            className: action.className || 'btn',
            onclick: () => finish(typeof action.getValue === 'function' ? action.getValue() : action.value)
          }, action.label);
          if (typeof action.onCreate === 'function') {
            action.onCreate(btn);
          }
          if (action.autoFocus) {
            btn.dataset.autofocus = 'true';
          }
          modalActions.appendChild(btn);
        });

        document.body.appendChild(overlay);
        releasedFocus = trapFocus(modal);

        requestAnimationFrame(() => {
          if (typeof onOpen === 'function') {
            onOpen({ overlay, modal, modalBody, finish });
          }
          const preferred = modal.querySelector('[data-autofocus="true"]');
          if (preferred && typeof preferred.focus === 'function') {
            preferred.focus();
          }
        });
      });
    }

    /**
     * Show an in-app confirmation dialog.
     * @param {string} message - Dialog body
     * @param {Object} options - Labels and title
     * @returns {Promise<boolean>}
     */
    function showConfirmDialog(message, options = {}) {
      return showModalDialog({
        title: options.title || 'Confirm Action',
        message,
        width: options.width || '520px',
        dismissValue: false,
        actions: [
          {
            label: options.cancelLabel || 'Cancel',
            value: false,
            className: 'btn',
            autoFocus: !options.confirmFirst
          },
          {
            label: options.confirmLabel || 'Confirm',
            value: true,
            className: options.confirmClassName || 'btn btn-primary',
            autoFocus: !!options.confirmFirst
          }
        ]
      });
    }

    /**
     * Show an in-app multi-action dialog.
     * @param {string} message - Dialog body
     * @param {Object} options - Dialog options
     * @returns {Promise<any>}
     */
    function showChoiceDialog(message, options = {}) {
      return showModalDialog({
        title: options.title || 'Choose Action',
        message,
        width: options.width || '520px',
        dismissValue: options.dismissValue ?? null,
        actions: options.actions || []
      });
    }

    /**
     * Show an in-app text input dialog.
     * @param {Object} options - Prompt configuration
     * @returns {Promise<string|null>}
     */
    function showPromptDialog(options = {}) {
      const fieldId = `dialog-input-${uid()}`;
      const inputWrap = h('div', { className: 'form-group dialog-field' });
      if (options.label) {
        inputWrap.appendChild(h('label', { className: 'form-label', for: fieldId }, options.label));
      }

      const input = h('input', {
        id: fieldId,
        type: options.type || 'text',
        className: 'form-input',
        value: options.defaultValue || '',
        placeholder: options.placeholder || '',
        autocomplete: 'off'
      });
      input.dataset.autofocus = 'true';

      if (Array.isArray(options.suggestions) && options.suggestions.length > 0) {
        const datalistId = `dialog-datalist-${uid()}`;
        input.setAttribute('list', datalistId);
        const datalist = h('datalist', { id: datalistId });
        options.suggestions.forEach(suggestion => {
          datalist.appendChild(h('option', { value: suggestion }));
        });
        inputWrap.appendChild(input);
        inputWrap.appendChild(datalist);
      } else {
        inputWrap.appendChild(input);
      }

      let submitBtn = null;
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && submitBtn) {
          e.preventDefault();
          submitBtn.click();
        }
      });

      return showModalDialog({
        title: options.title || 'Enter Value',
        message: options.message || '',
        content: inputWrap,
        width: options.width || '520px',
        dismissValue: null,
        actions: [
          {
            label: options.cancelLabel || 'Cancel',
            value: null,
            className: 'btn'
          },
          {
            label: options.confirmLabel || 'Save',
            className: options.confirmClassName || 'btn btn-primary',
            getValue: () => input.value,
            onCreate: btn => {
              submitBtn = btn;
            }
          }
        ],
        onOpen: () => {
          input.focus();
          input.select();
        }
      }).then(value => {
        submitBtn = null;
        return value;
      });
    }

// =============================================================
// --- AI DEVELOPER INSTRUCTIONS ---
//
// 1. UPDATE VERSION & METADATA:
//    Update APP_VERSION, APP_RELEASE_DATE, APP_UPDATER above.
//
// 2. MAINTAIN FUNCTIONALITY:
//    Do not remove or break existing features unless explicitly requested.
//    All changes should be additive or improvements.
//
// 3. FILE PROTOCOL COMPATIBILITY:
//    This file is self-contained to work with file:// URLs.
//
// =============================================================

// Version History
// Version 0.16.0: Split source into buildable chunks (see www/src/*, `npm run build`)
// Version 1.0.0: Major refactor - ES Modules for maintainability, Rich Text toggle, Theme plugin handler
// Version 0.13.1: Accessibility & Theme Customization for Plugins
// (see previous versions in git history)

// --- CORE APP STATE ---
// All mutable state is declared in and exported from ./state.js.
// The names (store, navState, navHistory, …) are imported at the top of this
// file so the rest of the module can reference them without qualification.

// renderCleanupCallbacks is private to this module (not shared cross-module).
let renderCleanupCallbacks = [];

function registerRenderCleanup(fn) {
  if (typeof fn === 'function') renderCleanupCallbacks.push(fn);
}

function runRenderCleanup() {
  if (!renderCleanupCallbacks.length) return;
  renderCleanupCallbacks.forEach(fn => {
    try {
      fn();
    } catch (err) {
      console.error('[Render Cleanup] Failed:', err);
    }
  });
  renderCleanupCallbacks = [];
}

// Note: save, saveNow, load, clearAllData, showAppearanceSettings, applyTheme 
// are defined later in this file with local implementations

// --- DOM ELEMENTS ---
const header = {
        homeBtn: document.getElementById('homeBtn'),
        themeToggle: document.getElementById('themeToggle'),
        menuBtn: document.getElementById('menuBtn'),
        brandBtn: document.getElementById('brandBtn'),
        undoBtn: document.getElementById('undoBtn')
      };
      
      const menu = {
        overlay: document.getElementById('menuOverlay'),
        closeBtn: document.getElementById('menuClose'),
        newCard: document.getElementById('menuNewCard'),
        upload: document.getElementById('menuUpload'),
        pluginManager: document.getElementById('menuPluginManager'),
        appearance: document.getElementById('menuAppearance'),
        tagManager: document.getElementById('menuTagManager'),
        advancedSearch: document.getElementById('menuAdvancedSearch'),
        trashBin: document.getElementById('menuTrashBin'),
        bookmarks: document.getElementById('menuBookmarks'),
        typography: document.getElementById('menuTypography'),
        recentCards: document.getElementById('menuRecentCards'),
        dataHub: document.getElementById('menuDataHub'),
        clearAll: document.getElementById('menuClearAll'),
        gettingStarted: document.getElementById('menuGettingStarted'),
        help: document.getElementById('menuHelp'),
        keyboardShortcuts: document.getElementById('menuKeyboardShortcuts'),
        developerSection: document.getElementById('menuDeveloperSection'),
        developerConsole: document.getElementById('menuDeveloperConsole')
      };
      
      const searchContainer = document.getElementById('searchContainer');
      const searchInput = document.getElementById('searchInput');
      const searchClear = document.getElementById('searchClear');
      const datasetSelector = document.getElementById('datasetSelector');
      
      const breadcrumbs = document.getElementById('breadcrumbs');
      const main = document.getElementById('main');
      // Note: toastContainer is initialized via initToast() called during app boot
      let previewObserver = null;

      const uploadModal = {
        overlay: document.getElementById('uploadModal'),
        closeBtn: document.getElementById('closeUploadModal'),
        tabs: document.querySelectorAll('.modal-tab'),
        tabContents: document.querySelectorAll('.tab-content'),
        fileUploadAreaJSON: document.getElementById('fileUploadAreaJSON'),
        fileInputJSON: document.getElementById('fileInputJSON'),
        importLocationSelectJSON: document.getElementById('importLocationSelectJSON'),
        fileUploadAreaTXT: document.getElementById('fileUploadAreaTXT'),
        fileInputTXT: document.getElementById('fileInputTXT'),
        importLocationSelectTXT: document.getElementById('importLocationSelectTXT'),
        fileUploadAreaMods: document.getElementById('fileUploadAreaMods'),
        fileInputMods: document.getElementById('fileInputMods'),
        // Plugin install fields
        manualModName: document.getElementById('manualModName'),
        manualModCreator: document.getElementById('manualModCreator'),
        manualModVersion: document.getElementById('manualModVersion'),
        manualModReleaseDate: document.getElementById('manualModReleaseDate'),
        manualModJS: document.getElementById('manualModJS'),
        manualModCSS: document.getElementById('manualModCSS'),
        installManualMod: document.getElementById('installManualMod')
      };

      // --- UTILITIES ---
      // Imported from modules: h, uid, debounce, normalizeTagInput, escapeHtml, 
      // highlightText, cloneCard, trapFocus, formatBytes, showToast
      // Locally defined: simpleMarkdown (~line 7379), isDeveloperMode (~line 359)

      function bootError(msg) {
        main.innerHTML = '';
        main.appendChild(h('div', { className: 'empty' }, 'Error: ' + msg));
      }


      // =============================================================
      // --- FUZZY SEARCH ---
      // Typo-tolerant search using Levenshtein distance
      // =============================================================

      /**
       * Calculate Levenshtein distance between two strings
       * @param {string} a - First string
       * @param {string} b - Second string
       * @returns {number} - Edit distance
       */
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
                matrix[i - 1][j - 1] + 1, // substitution
                matrix[i][j - 1] + 1,     // insertion
                matrix[i - 1][j] + 1      // deletion
              );
            }
          }
        }
        
        return matrix[b.length][a.length];
      }

      /**
       * Calculate fuzzy match score (0-100, higher is better)
       * @param {string} query - Search query
       * @param {string} text - Text to match against
       * @returns {number} - Match score
       */
      function fuzzyMatchScore(query, text) {
        // Compare a short prefix window before falling back to word windows so
        // small typos near the start of a title still score well without
        // overmatching long unrelated bodies.
        const FUZZY_PREFIX_PADDING = 10;
        const queryLower = query.toLowerCase();
        const textLower = text.toLowerCase();
        if (!queryLower || !textLower) return 0;
        const queryTerms = queryLower.split(/\s+/).filter(Boolean);
        if (queryTerms.length > 1 && !queryTerms.some(term => textLower.includes(term))) {
          return 0;
        }
        
        // Exact match gets highest score
        if (textLower.includes(queryLower)) {
          const position = textLower.indexOf(queryLower);
          // Bonus for matches at start of text
          return 100 - (position * 0.5);
        }

        const candidates = new Set();
        candidates.add(textLower.substring(0, query.length + FUZZY_PREFIX_PADDING));

        const words = textLower.split(/\s+/).filter(Boolean);
        if (words.length > 0) {
          const windowSize = Math.min(words.length, Math.max(1, queryTerms.length));
          for (let i = 0; i <= words.length - windowSize; i++) {
            candidates.add(words.slice(i, i + windowSize).join(' '));
          }
        }
        
        let bestScore = 0;
        candidates.forEach(candidate => {
          if (!candidate) return;
          const distance = levenshteinDistance(queryLower, candidate);
          const maxLen = Math.max(queryLower.length, candidate.length);
          const similarity = 1 - (distance / maxLen);
          bestScore = Math.max(bestScore, Math.max(0, similarity * 70));
        });
        
        return bestScore;
      }

      /**
       * Fuzzy search cards
       * @param {Object} store - Card store
       * @param {string} query - Search query
       * @returns {Array} - Sorted results with scores
       */
      function fuzzySearchCards(store, query) {
        // Direct substring matches stay permissive, while approximate matches
        // require stronger scores—especially for multi-term queries—to keep
        // stress-test phrases from returning broad unrelated results.
        const EXACT_MATCH_THRESHOLD = 30;
        const MULTI_TERM_APPROX_THRESHOLD = 62;
        const SINGLE_TERM_APPROX_THRESHOLD = 48;
        if (!query || query.trim() === '') {
          return [];
        }
        // '*' is the "match everything" sentinel used by Advanced Search's
        // filters-only path: return all cards so the tag/bookmark/date filters
        // apply to the full set instead of to a literal-'*' substring search.
        if (query.trim() === '*') {
          return Object.values(store.cards).map(card => ({
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
        
        Object.values(store.cards).forEach(card => {
          const titleText = (card.title || '').toLowerCase();
          const bodyText = (card.body || '').toLowerCase();
          const tags = Array.isArray(card.tags) ? card.tags : [];
          const exactTitleMatch = titleText.includes(queryLower);
          const exactBodyMatch = bodyText.includes(queryLower);
          const exactTagMatch = tags.some(tag => tag.toLowerCase().includes(queryLower));
          const titleScore = fuzzyMatchScore(queryLower, card.title || '');
          const bodyScore = fuzzyMatchScore(queryLower, card.body || '') * 0.55;
          const tagScore = tags.length
            ? Math.max(...tags.map(tag => fuzzyMatchScore(queryLower, tag) * 0.9), 0)
            : 0;
          const totalScore = Math.max(titleScore, bodyScore, tagScore);
          const hasDirectMatch = exactTitleMatch || exactBodyMatch || exactTagMatch;
          const threshold = hasDirectMatch
            ? EXACT_MATCH_THRESHOLD
            : (queryTerms.length > 1 ? MULTI_TERM_APPROX_THRESHOLD : SINGLE_TERM_APPROX_THRESHOLD);
          
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
        
        // Sort by score (highest first)
        results.sort((a, b) => b.score - a.score);
        
        return results;
      }

      /**
       * Multi-dataset fuzzy search
       * Search across multiple datasets with optional scope
       * @param {string} query - Search query
       * @param {string} scope - Dataset scope: 'current', 'all', or specific dataset ID
       * @returns {Promise<Array>} - Sorted results with scores and dataset info
       */
      async function fuzzySearchMultiDataset(query, scope = 'current') {
        if (!query || query.trim() === '') {
          return [];
        }

        const currentKey = (typeof instanceKey !== 'undefined' && instanceKey) || 'nested_cards_store';
        const currentName = (store && store.metadata && store.metadata.name) || currentKey;
        const MAX_RESULTS = 100;

        // Datasets live in LocalStorage under two key shapes; enumerate them
        // directly (there is no separate dataset-manager runtime).
        const searchableKeys = scope === 'all' && typeof getAllDatasetKeys === 'function'
          ? getAllDatasetKeys()
          : (scope !== 'current' && scope !== 'all' ? [scope] : [currentKey]);

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
              if (!parsed || typeof parsed !== 'object') continue;
              if (parsed.encrypted === true && typeof parsed.payload === 'string') {
                // Locked encrypted datasets cannot be searched without their PIN.
                continue;
              }
              if (!parsed.cards || typeof parsed.cards !== 'object') continue;
              datasetStore = { cards: parsed.cards };
              datasetName = (parsed.metadata && parsed.metadata.name) || key;
            }

            const results = fuzzySearchCards(datasetStore, query);
            results.forEach(result => {
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

        // Sort combined results by score
        allResults.sort((a, b) => b.score - a.score);

        return allResults.slice(0, MAX_RESULTS);
      }
