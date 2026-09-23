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

import {
  APP_VERSION,
  SCHEMA_VERSION,
  MAX_TRASH_SIZE,
  createDefaultStore,
  store, setStore,
  instanceKey, setInstanceKey,
  trashBin
} from './state.js';
import {
  Kernel,
  cloneCard as kernelCloneCard,
  parseCardLinks as kernelParseCardLinks,
  normalizeCardName as kernelNormalizeCardName,
  hasCardLink as kernelHasCardLink,
  extractTags as kernelExtractTags
} from './kernel.js';
import { migrateCard as coreMigrateCard } from '@core/migrations.js';

      // Source Part 3/5: Data CRUD, imports/exports, dataset modals
      // Concatenated via `npm run build` in lexical order of www/src/*.js
      //
      // Layer 2 (Shell) wrappers — these delegate pure data operations to the
      // Kernel (Layer 0) and layer on side effects: undo logging, persistence,
      // middleware hooks, and UI toasts.
      //
      // The shared kernel instance is initialised here and kept in sync with
      // the legacy `store` object so existing rendering and storage code still
      // works without changes.

      /** @type {Kernel} Shared kernel instance — bridges Layer 0 ↔ Layer 2 */
      const _kernel = new Kernel({ cards: store.cards, rootOrder: store.rootOrder });

      /**
       * Sync kernel data back into the legacy store object.
       * Called after every mutating kernel operation so that rendering,
       * storage, and other Layer-2 code sees up-to-date data.
       */
      function _syncKernelToStore() {
        const snap = _kernel.snapshot();
        store.cards = snap.cards;
        store.rootOrder = snap.rootOrder;
      }

      /**
       * Sync legacy store data into the kernel.
       * Called when the store is replaced wholesale (e.g. after a load).
       */
      function _syncStoreToKernel() {
        _kernel.hydrate({ cards: store.cards, rootOrder: store.rootOrder });
      }

      // --- DATA (CRUD) — Shell wrappers around Kernel ---

      /**
       * Create a new card
       * @param {string} title - Card title
       * @param {string} body - Card content/body
       * @param {string|null} parentId - Parent card ID or null for root
       * @param {boolean} skipSave - Skip saving to localStorage
       * @param {boolean} skipHooks - Skip running plugin hooks
       * @returns {string} New card ID
       */
      function createCard(title, body, parentId = null, skipSave = false, skipHooks = false) {
        _syncStoreToKernel();
        const result = _kernel.createCard(title, body, parentId);
        _syncKernelToStore();

        // Undo support
        pushUndo('createCard', { cardId: result.id, card: result.card });
        if (!skipSave) save();
        // Fire middleware event for plugins (Task 1.1)
        if (!skipHooks && window.CardSpoke && window.CardSpoke.Middleware) {
          window.CardSpoke.Middleware.run('card.create', [result.id, store.cards[result.id]])
            .catch(err => console.error('[Middleware] card.create error:', err));
        }
        // Notify plugin data-update listeners (ctx.api.data.onUpdate)
        if (!skipHooks && window.CardSpoke && window.CardSpoke.Plugin && window.CardSpoke.Plugin.notifyDataUpdate) {
          window.CardSpoke.Plugin.notifyDataUpdate({ type: 'card.create', cardId: result.id, card: store.cards[result.id] });
        }
        return result.id;
      }

      /**
       * Update an existing card
       * @param {string} id - Card ID to update
       * @param {Object} updates - Fields to update
       * @param {boolean} skipSave - Skip saving to localStorage
       * @param {boolean} skipHooks - Skip running plugin hooks
       */
      function updateCard(id, updates, skipSave = false, skipHooks = false) {
        _syncStoreToKernel();
        const result = _kernel.updateCard(id, updates);
        if (!result.previousState) return;
        _syncKernelToStore();

        // Undo support
        pushUndo('updateCard', {
          cardId: id,
          previousState: result.previousState,
          newState: result.card
        });
        if (!skipSave) save();
        // Fire middleware event for plugins (Task 1.1)
        if (!skipHooks && window.CardSpoke && window.CardSpoke.Middleware) {
          window.CardSpoke.Middleware.run('card.update', [id, store.cards[id]])
            .catch(err => console.error('[Middleware] card.update error:', err));
        }
        // Notify plugin data-update listeners (ctx.api.data.onUpdate)
        if (!skipHooks && window.CardSpoke && window.CardSpoke.Plugin && window.CardSpoke.Plugin.notifyDataUpdate) {
          window.CardSpoke.Plugin.notifyDataUpdate({ type: 'card.update', cardId: id, card: store.cards[id] });
        }
      }

      /**
       * Delete a card and all its children recursively
       * @param {string} id - Card ID to delete
       */
      function deleteCard(id, opts = {}) {
        _syncStoreToKernel();
        const { skipSave = false, skipHooks = false } = opts;

        // Snapshot deleted cards via kernel before removal
        const result = _kernel.deleteCard(id);
        _syncKernelToStore();

        // Group the whole cascade so a single Undo restores the entire subtree
        // atomically. result.deleted is root-first; push it children-first so
        // the group's reverse-order replay restores PARENTS before children —
        // children then re-attach to an existing parent instead of becoming
        // unreachable orphans.
        const groupedDelete = window.startUndoGroup && window.startUndoGroup('deleteCard');
        for (let i = result.deleted.length - 1; i >= 0; i--) {
          pushUndo('deleteCard', { card: result.deleted[i] });
        }
        if (groupedDelete && window.endUndoGroup) window.endUndoGroup();
        for (const deleted of result.deleted) {
          trashBin.unshift({ card: deleted, deletedAt: Date.now() });
          if (trashBin.length > MAX_TRASH_SIZE) trashBin.pop();
        }

        if (!skipSave) save();
        // Fire middleware event for plugins (Task 1.1)
        if (!skipHooks && window.CardSpoke && window.CardSpoke.Middleware) {
          window.CardSpoke.Middleware.run('card.delete', [id])
            .catch(err => console.error('[Middleware] card.delete error:', err));
        }
        // Notify plugin data-update listeners (ctx.api.data.onUpdate)
        if (!skipHooks && window.CardSpoke && window.CardSpoke.Plugin && window.CardSpoke.Plugin.notifyDataUpdate) {
          window.CardSpoke.Plugin.notifyDataUpdate({ type: 'card.delete', cardId: id });
        }
      }

      function getStorageTypeLabel(storageType) {
        switch (storageType) {
          case 'indexeddb': return 'IndexedDB';
          case 'localfile': return 'Local File (chosen location)';
          default: return 'LocalStorage';
        }
      }

      /**
       * Enumerate every dataset key in LocalStorage. Datasets have
       * historically used two key shapes: the default 'nested_cards_store'
       * (plus legacy 'nested_cards_*' variants) and 'cards_<name>_<id>'
       * produced by the Create Dataset flow. Quarantined recovery copies
       * ('<key>.corrupt.<ts>') are excluded.
       */
      function getAllDatasetKeys() {
        return Object.keys(localStorage).filter(k =>
          (k === 'nested_cards_store' || k.startsWith('nested_cards_') || k.startsWith('cards_')) &&
          !k.includes('.corrupt.')
        );
      }

      /** Safe mode disables all plugin execution (?safemode URL parameter). */
      function isSafeModeActive() {
        return typeof window !== 'undefined' && window.location &&
          new URLSearchParams(window.location.search).has('safemode');
      }

      /**
       * After the active dataset changes, make the running plugin set match
       * the NEW dataset. Every plugin registered for the previous dataset is
       * torn down from the runtime (cleaning its CSS/DOM/resources) WITHOUT
       * disturbing the persisted store or the user's trust/permission grants;
       * then syncFromStore re-registers and re-enables exactly the new
       * dataset's plugins per their stored enabled flags.
       *
       * A plain disable() is not enough: it leaves the instance registered, so
       * syncFromStore (which skips ids already in the runtime) can neither
       * re-enable a carried-over plugin nor pick up a differing definition —
       * the plugin would be stuck in the previous dataset's state until reload.
       */
      async function reconcilePluginsAfterDatasetSwitch() {
        if (!(window.CardSpoke && window.CardSpoke.Plugin)) return;
        const Plugin = window.CardSpoke.Plugin;
        if (Plugin.teardownForReload) {
          for (const instance of Plugin.listAll()) {
            try {
              await Plugin.teardownForReload(instance.id);
            } catch (err) {
              console.warn('[Dataset] Plugin teardown on switch failed:', instance.id, err);
            }
          }
        }
        if (!isSafeModeActive() && Plugin.syncFromStore) {
          try {
            await Plugin.syncFromStore();
          } catch (err) {
            console.error('[Dataset] Plugin re-sync after switch failed:', err);
          }
        }
      }

      async function migrateCurrentDatasetStorage(targetStorage) {
        const currentStorage = (store.metadata && store.metadata.storageType) || 'localstorage';
        if (targetStorage === currentStorage) {
          showToast('Dataset is already using ' + getStorageTypeLabel(targetStorage), 'info');
          return;
        }

        if (!store.metadata) store.metadata = {};
        if (!store.metadata.storageConfig) store.metadata.storageConfig = {};

        if (targetStorage === 'indexeddb') {
          const driver = new IndexedDBDriver();
          await driver.init({ dbName: 'CardSpokeDB', storeName: 'datasets' });
          store.metadata.storageType = 'indexeddb';
          store.metadata.storageConfig = { dbName: 'CardSpokeDB', storeName: 'datasets' };
          // Encrypt exactly as the normal save path does, so migrating a
          // PIN-protected dataset never writes its plaintext to the target
          // backend (CS-001).
          const encPayload = activeSessionPin
            ? await encryptStorePayload(JSON.stringify(store), activeSessionPin)
            : JSON.stringify(store);
          await driver.set(instanceKey, encPayload);
        } else if (targetStorage === 'localfile') {
          if (typeof window.showSaveFilePicker !== 'function') {
            throw new Error('Local file location selection is not supported in this environment');
          }
          store.metadata.storageType = 'localfile';
          if (!store.metadata.storageConfig) store.metadata.storageConfig = {};
          // Same encryption guard for the chosen-file backend (CS-001).
          const encPayload = activeSessionPin
            ? await encryptStorePayload(JSON.stringify(store), activeSessionPin)
            : JSON.stringify(store);
          await writeDatasetToLocalFile(encPayload);
        } else {
          store.metadata.storageType = 'localstorage';
          store.metadata.storageConfig = {};
        }

        store.metadata.migratedAt = Date.now();
        save(true);
        showToast('Dataset storage updated to ' + getStorageTypeLabel(targetStorage), 'success');
      }

      function showDatasetStorageSettings() {
        const overlay = h('div', { className: 'modal-overlay show' });
        const modal = h('div', { className: 'modal', style: 'max-width: 560px;' });
        const header = h('div', { className: 'modal-header' });
        header.appendChild(h('div', { className: 'modal-title' }, 'Dataset Storage Settings'));
        header.appendChild(h('button', { className: 'modal-close', 'aria-label': 'Close dialog', onclick: () => overlay.remove() }, '✕'));
        modal.appendChild(header);

        const body = h('div', { className: 'modal-body' });
        const currentStorage = (store.metadata && store.metadata.storageType) || 'localstorage';

        body.appendChild(h('p', { style: 'margin-bottom: var(--space-md); color: var(--text-secondary);' },
          'New datasets default to LocalStorage. You can migrate this dataset to another on-device storage backend after creation.'));
        body.appendChild(h('p', { style: 'margin-bottom: var(--space-lg);' },
          'Current storage: ' + getStorageTypeLabel(currentStorage)));

        const select = h('select', {
          style: 'width: 100%; padding: var(--space-md); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: var(--space-md);'
        });
        const localOpt = h('option', { value: 'localstorage' }, 'LocalStorage (default)');
        const idbOpt = h('option', { value: 'indexeddb' }, 'IndexedDB (on-device database)');
        const fileOpt = h('option', { value: 'localfile' }, 'Local File (choose location on device)');
        if (currentStorage === 'localstorage') localOpt.selected = true;
        if (currentStorage === 'indexeddb') idbOpt.selected = true;
        if (currentStorage === 'localfile') fileOpt.selected = true;
        select.appendChild(localOpt);
        select.appendChild(idbOpt);
        select.appendChild(fileOpt);
        body.appendChild(select);

        body.appendChild(h('div', { style: 'font-size: 0.875rem; color: var(--text-secondary); margin-bottom: var(--space-lg);' },
          'Migration copies data to the selected storage target and keeps a local fallback copy in LocalStorage.'));

        const migrateBtn = h('button', {
          className: 'btn btn-primary',
          style: 'width: 100%;',
          onclick: async () => {
            migrateBtn.disabled = true;
            const target = select.value;
            try {
              await migrateCurrentDatasetStorage(target);
              overlay.remove();
            } catch (err) {
              showToast('Migration failed: ' + err.message, 'error');
              migrateBtn.disabled = false;
            }
          }
        }, 'Migrate Storage');
        body.appendChild(migrateBtn);

        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.onclick = (e) => {
          if (e.target === overlay) overlay.remove();
        };
      }

      /**
       * Duplicate a card with option to clone children
       * @param {string} id - Card ID to duplicate
       * @param {boolean} withChildren - Whether to clone children recursively
       * @returns {string} New card ID
       */
      function duplicateCard(id, withChildren = false) {
        _syncStoreToKernel();
        if (!_kernel.hasCard(id)) return null;

        const result = _kernel.duplicateHierarchy(id, withChildren);
        _syncKernelToStore();

        // Make the duplicate undoable: one createCard entry per new card,
        // grouped so a single Undo removes the whole duplicated subtree.
        // allNewIds is root-first, so the group's reverse-order replay removes
        // children before parents (no orphaned removals).
        const ids = result.allNewIds && result.allNewIds.length
          ? result.allNewIds
          : (result.newId ? [result.newId] : []);
        const groupedUndo = ids.length > 1 && window.startUndoGroup && window.startUndoGroup('duplicateCard');
        for (const newId of ids) {
          pushUndo('createCard', { cardId: newId, card: store.cards[newId] });
        }
        if (groupedUndo && window.endUndoGroup) window.endUndoGroup();

        save();
        return result.newId;
      }

      /**
       * Helper to duplicate a card as child of another card
       * (Legacy compatibility — delegates to kernel reparent after dup)
       * @param {string} id - Card ID to duplicate
       * @param {string} newParentId - New parent card ID
       * @param {boolean} withChildren - Whether to clone children recursively
       * @returns {string} New card ID
       */
      function duplicateCardAsChild(id, newParentId, withChildren = false) {
        _syncStoreToKernel();
        if (!_kernel.hasCard(id)) return null;

        const result = _kernel.duplicateHierarchy(id, withChildren);
        if (!result.newId) return null;

        // The kernel placed the duplicate next to the original; reparent it.
        _kernel.reparent(result.newId, newParentId);
        _syncKernelToStore();

        // Make the duplicate undoable (grouped for a multi-card subtree).
        const ids = result.allNewIds && result.allNewIds.length
          ? result.allNewIds
          : [result.newId];
        const groupedUndo = ids.length > 1 && window.startUndoGroup && window.startUndoGroup('duplicateCard');
        for (const newId of ids) {
          if (store.cards[newId]) pushUndo('createCard', { cardId: newId, card: store.cards[newId] });
        }
        if (groupedUndo && window.endUndoGroup) window.endUndoGroup();

        return result.newId;
      }

      /**
       * Toggle bookmark status for a card
       * @param {string} cardId - Card ID to bookmark/unbookmark
       */
      function toggleBookmark(cardId) {
        if (!store.bookmarks) store.bookmarks = [];
        const idx = store.bookmarks.indexOf(cardId);
        if (idx >= 0) {
          store.bookmarks.splice(idx, 1);
          showToast('Bookmark removed', 'info');
        } else {
          store.bookmarks.push(cardId);
          showToast('Card bookmarked', 'success');
        }
        save();
        render();
      }

      /**
       * Check if a card is bookmarked
       * @param {string} cardId - Card ID to check
       * @returns {boolean} True if bookmarked
       */
      function isBookmarked(cardId) {
        if (!store.bookmarks) store.bookmarks = [];
        return store.bookmarks.includes(cardId);
      }

      /**
       * Add card to recent history
       * @param {string} cardId - Card ID to add to recent history
       */
      function addToRecentCards(cardId) {
        if (!store.recentCards) store.recentCards = [];
        // Remove if already in list
        store.recentCards = store.recentCards.filter(id => id !== cardId);
        // Add to front
        store.recentCards.unshift(cardId);
        // Keep only last 10
        if (store.recentCards.length > 10) {
          store.recentCards = store.recentCards.slice(0, 10);
        }
        save(true); // Save immediately but don't show toast
      }

      /**
       * Toggle view mode between normal and compact
       */
      function toggleViewMode() {
        if (!store.viewMode) store.viewMode = 'normal';
        store.viewMode = store.viewMode === 'normal' ? 'compact' : 'normal';
        save();
        render();
        showToast(`View mode: ${store.viewMode}`, 'info');
      }

      // --- DATA (IMPORT/EXPORT) ---

      /**
       * Versioned instance backup (CS-005). formatVersion 2 includes every
       * user-owned field — cards, hierarchy, plugins (modern persisted
       * shape), bookmarks, recent cards, view mode, theme, and dataset
       * metadata — plus schemaVersion for compatibility checks on import.
       * The dataset PIN and storage handles are intentionally excluded.
       */
      function buildInstanceExport() {
        const metadata = { ...(store.metadata || {}) };
        // Never export secrets or environment-specific storage handles.
        delete metadata.pin;
        delete metadata.storageConfig;
        // Navigation position is ephemeral and its card IDs would not
        // survive the import-time ID remap.
        delete metadata.navState;
        delete metadata.navHistory;
        return {
          exportType: 'instance',
          formatVersion: 2,
          appVersion: APP_VERSION,
          schemaVersion: SCHEMA_VERSION,
          timestamp: Date.now(),
          cards: store.cards,
          rootIds: store.rootOrder,
          plugins: store.plugins,
          bookmarks: store.bookmarks || [],
          recentCards: store.recentCards || [],
          viewMode: store.viewMode || 'normal',
          activeTheme: store.activeTheme || 'light',
          metadata
        };
      }

      function exportJSON(type = 'instance') {
        let data;
        if (type === 'instance') {
          data = buildInstanceExport();
        } else if (type === 'plugins') {
          data = {
            exportType: 'plugins',
            formatVersion: 2,
            appVersion: APP_VERSION,
            schemaVersion: SCHEMA_VERSION,
            timestamp: Date.now(),
            plugins: store.plugins
          };
        }
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const filename = `cardspoke-${type}-${Date.now()}.json`;
        downloadWithFeedback(blob, filename, 'JSON');
      }

      /**
       * Download file with feedback and fallback handling
       * @param {Blob} blob - File blob to download
       * @param {string} filename - Suggested filename
       * @param {string} format - File format for display (e.g., 'TXT', 'Markdown')
       */
      function downloadWithFeedback(content, filename, mimeType) {
        // Create blob from content if it's a string
        const blob = typeof content === 'string' 
          ? new Blob([content], { type: mimeType || 'text/plain' })
          : content;
        const url = URL.createObjectURL(blob);
        const format = mimeType || 'file';
        
        try {
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          
          // Add to document for Firefox compatibility
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          
          // Show success feedback
          showToast(`✓ ${format} export downloaded: ${filename}`, 'success');
          
        } catch (err) {
          // Fallback: show modal with download link
          console.warn('[Export] Automatic download failed:', err);
          
          const overlay = h('div', { className: 'modal-overlay show' });
          const modal = h('div', { className: 'modal' });
          const modalHeader = h('div', { className: 'modal-header' });
          modalHeader.appendChild(h('div', { className: 'modal-title' }, 'Export Ready'));
          const closeBtn = h('button', { className: 'modal-close', 'aria-label': 'Close dialog', onclick: () => overlay.remove() }, '✕');
          modalHeader.appendChild(closeBtn);
          modal.appendChild(modalHeader);
          
          const modalBody = h('div', { className: 'modal-body' });
          modalBody.appendChild(h('p', { style: 'margin-bottom: var(--space-lg);' }, 
            `Your ${format} export is ready. Click the button below to download.`));
          
          const downloadBtn = h('a', {
            className: 'btn btn-primary',
            href: url,
            download: filename,
            style: 'display: inline-block; text-decoration: none;'
          }, `Download ${filename}`);
          
          downloadBtn.onclick = () => {
            showToast(`✓ ${format} export downloaded`, 'success');
            setTimeout(() => overlay.remove(), 500);
          };
          
          modalBody.appendChild(downloadBtn);
          modal.appendChild(modalBody);
          overlay.appendChild(modal);
          document.body.appendChild(overlay);
          
          showToast(`${format} export ready - click to download`, 'info');
        }
        
        // Clean up blob URL after a delay
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }

      function exportTXT() {
        let text = '# CardSpoke Export\n\n';
        function writeCard(cardId, depth = 0) {
          const card = store.cards[cardId];
          if (!card) return;
          const indent = '  '.repeat(depth);
          text += `${indent}${card.title || '(Untitled)'}\n`;
          if (card.body) {
            text += `${indent}  ${card.body.replace(/\n/g, '\n' + indent + '  ')}\n`;
          }
          text += '\n';
          (card.children || []).forEach(cid => writeCard(cid, depth + 1));
        }
        store.rootOrder.forEach(id => writeCard(id));
        const blob = new Blob([text], { type: 'text/plain' });
        const filename = `cardspoke-${new Date().toISOString().slice(0,10)}.txt`;
        downloadWithFeedback(blob, filename, 'TXT');
      }


      /**
       * Export cards to Markdown format with hierarchy
       */
      function exportMarkdown() {
        let markdown = '# CardSpoke Export\n\n';
        markdown += `*Exported: ${new Date().toLocaleString()}*\n\n`;
        markdown += '---\n\n';
        
        function writeCardMD(cardId, depth = 0) {
          const card = store.cards[cardId];
          if (!card) return;
          
          const heading = '#'.repeat(Math.min(depth + 1, 6));
          markdown += `${heading} ${card.title || '(Untitled)'}\n\n`;
          
          if (card.tags && card.tags.length > 0) {
            markdown += `*Tags: ${card.tags.map(t => `\`${t}\``).join(', ')}*\n\n`;
          }
          
          if (card.body) {
            markdown += `${card.body}\n\n`;
          }
          
          (card.children || []).forEach(cid => writeCardMD(cid, depth + 1));
        }
        
        store.rootOrder.forEach(id => writeCardMD(id));

        const blob = new Blob([markdown], { type: 'text/markdown' });
        const filename = `cardspoke-${new Date().toISOString().slice(0,10)}.md`;
        downloadWithFeedback(blob, filename, 'Markdown');
      }

      /**
       * Export cards to CSV format (flat structure)
       */
      // Spreadsheet-safe text encoding. Quotes escape CSV delimiters, while
      // a leading apostrophe prevents spreadsheet formula interpretation.
      function csvCell(value) {
        let text = String(value == null ? '' : value);
        if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
      }

      function exportCSV() {
        let csv = 'ID,Title,Body,Parent ID,Tags,Children Count,Created,Updated\n';
        Object.values(store.cards).forEach(card => {
          csv += [card.id || '', card.title || '', card.body || '', card.parentId || '',
            (card.tags || []).join(';'), (card.children || []).length,
            card.createdAt || '', card.updatedAt || ''].map(csvCell).join(',') + '\n';
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const filename = `cardspoke-${new Date().toISOString().slice(0,10)}.csv`;
        downloadWithFeedback(blob, filename, 'CSV');
      }
      function handleExport(type) {
        if (type === 'instance-json') exportJSON('instance');
        else if (type === 'instance-txt') exportTXT();
        else if (type === 'plugins-json') exportJSON('plugins');
      }

      async function importJSON(data, mode = 'root') {
        const groupedUndo = window.startUndoGroup && window.startUndoGroup('importJSON');
        try {
          let pkg;
          try {
            pkg = typeof data === 'string' ? JSON.parse(data) : data;
          } catch (err) {
            showToast('Invalid JSON: ' + err.message, 'error');
            throw new Error('Failed to parse JSON: ' + err.message);
          }

        // Security: Validate import data structure
        if (!pkg || typeof pkg !== 'object') {
          showToast('Invalid import: data must be an object', 'error');
          throw new Error('Invalid import data structure');
        }

        // Validate cards object
        if (pkg.cards && (typeof pkg.cards !== 'object' || Array.isArray(pkg.cards))) {
          showToast('Invalid import: cards must be an object', 'error');
          throw new Error('Invalid cards structure');
        }

        // Validate each card has required fields
        if (pkg.cards) {
          for (const [cardId, card] of Object.entries(pkg.cards)) {
            if (!card || typeof card !== 'object' || Array.isArray(card)) {
              showToast(`Invalid card structure for ID: ${cardId}`, 'error');
              throw new Error('Invalid card structure');
            }
            // Validate required card fields
            if (card.children && !Array.isArray(card.children)) {
              showToast(`Invalid children array for card: ${cardId}`, 'error');
              throw new Error('Invalid card children structure');
            }
          }
        }

        // Validate rootIds if present
        if (pkg.rootIds && !Array.isArray(pkg.rootIds)) {
          showToast('Invalid import: rootIds must be an array', 'error');
          throw new Error('Invalid rootIds structure');
        }

        // Schema compatibility: newer-schema backups may contain data this
        // version does not understand. Ask before merging (CS-005).
        if (typeof pkg.schemaVersion === 'number' && pkg.schemaVersion > SCHEMA_VERSION) {
          const proceed = await showConfirmDialog(
            `This backup uses schema v${pkg.schemaVersion}, but this app version supports schema v${SCHEMA_VERSION}.\n\n` +
            'Importing may lose fields this version does not understand. Continue?',
            {
              title: 'Newer Backup Format',
              confirmLabel: 'Import Anyway',
              cancelLabel: 'Cancel'
            }
          );
          if (!proceed) throw new Error('Import cancelled: incompatible schema version');
        }

        // Validate plugins if present (and warn about security)
        if (pkg.plugins && (pkg.exportType === 'instance' || pkg.exportType === 'plugins')) {
          const modCount = Object.keys(pkg.plugins).length;
          if (modCount > 0) {
            const confirmImportMods = await showConfirmDialog(
              `⚠️ SECURITY WARNING\n\n` +
              `This import includes ${modCount} plugin(s).\n\n` +
              `Plugins can execute code and access your data. ` +
              `Only import plugins from sources you trust.\n\n` +
              `Do you want to import the plugins?\n` +
              `(Click Cancel to import only the cards without plugins)`,
              {
                title: 'Plugin Import Warning',
                confirmLabel: 'Import Plugins',
                cancelLabel: 'Cards Only',
                confirmClassName: 'btn btn-danger'
              }
            );
            if (!confirmImportMods) {
              delete pkg.plugins;
            }
          }
        }

        const importedIds = [];
        const idMap = Object.create(null);
        const remappedCards = {};

        Object.entries(pkg.cards || {}).forEach(([oldId, card]) => {
          const newId = uid();
          idMap[oldId] = newId;
          remappedCards[newId] = { ...card, id: newId };
          importedIds.push(newId);
        });
        
        Object.values(remappedCards).forEach(card => {
          card.children = (card.children || []).map(cid => idMap[cid] || cid);
          if (card.parentId && idMap[card.parentId]) {
            card.parentId = idMap[card.parentId];
          }
        });
        
        const remappedRootIds = (pkg.rootIds || []).map(id => idMap[id] || id);
        
        Object.values(remappedCards).forEach(card => {
          store.cards[card.id] = card;
        });
        
        if (mode === 'root') {
          remappedRootIds.forEach(id => {
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
            remappedRootIds.forEach(cardId => {
              if (store.cards[cardId]) {
                store.cards[cardId].parentId = mode;
                if (!parentCard.children.includes(cardId)) {
                  parentCard.children.push(cardId);
                }
              }
            });
          }
        }
        
        if ((pkg.exportType === 'instance' || pkg.exportType === 'plugins') && pkg.plugins) {
          // Restore plugins in the modern persisted shape ({definition,
          // enabled}) — the runtime refuses to execute entries without a
          // definition, so the old lossy conversion made every JSON
          // export/import silently break plugins (CS-005). Legacy-shape
          // entries ({js, css, meta}) are upgraded to a definition so they
          // become runnable again; they stay suspended until enabled.
          Object.entries(pkg.plugins).forEach(([modId, plugin]) => {
            if (store.plugins[modId] || !plugin || typeof plugin !== 'object') return;
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
                    version: (typeof meta.version === 'string' && meta.version) || '1.0.0',
                    author: meta.author || meta.creator || 'Unknown',
                    layer: meta.layer || 'feature',
                    description: meta.description || '',
                    permissions: Array.isArray(meta.permissions) ? meta.permissions : []
                  },
                  css: typeof plugin.css === 'string' && plugin.css ? plugin.css : null,
                  js: typeof plugin.js === 'string' && plugin.js ? plugin.js : null,
                  teardownJs: typeof plugin.teardownJs === 'string' && plugin.teardownJs ? plugin.teardownJs : null
                },
                enabled: false
              };
            }
          });
          // Register the restored plugins with the runtime (idempotent);
          // enabling still goes through the normal consent gates.
          if (window.CardSpoke && window.CardSpoke.Plugin && window.CardSpoke.Plugin.syncFromStore) {
            try {
              await window.CardSpoke.Plugin.syncFromStore();
            } catch (err) {
              console.error('[Import] Plugin sync failed:', err);
            }
          }
        }

        // Restore the remaining user-owned fields from instance backups
        // (bookmarks and recent cards follow the card ID remap).
        if (pkg.exportType === 'instance') {
          if (Array.isArray(pkg.bookmarks)) {
            if (!store.bookmarks) store.bookmarks = [];
            pkg.bookmarks.forEach(oldId => {
              const newId = idMap[oldId];
              if (newId && !store.bookmarks.includes(newId)) store.bookmarks.push(newId);
            });
          }
          if (Array.isArray(pkg.recentCards)) {
            if (!store.recentCards) store.recentCards = [];
            const restoredRecents = pkg.recentCards.map(oldId => idMap[oldId]).filter(Boolean);
            store.recentCards = restoredRecents
              .concat(store.recentCards.filter(id => !restoredRecents.includes(id)))
              .slice(0, 10);
          }
          if (pkg.viewMode === 'normal' || pkg.viewMode === 'compact') {
            store.viewMode = pkg.viewMode;
          }
          if (pkg.activeTheme === 'light' || pkg.activeTheme === 'dark') {
            store.activeTheme = pkg.activeTheme;
            if (typeof applyTheme === 'function') applyTheme(pkg.activeTheme);
          }
          if (pkg.metadata && typeof pkg.metadata === 'object') {
            if (!store.metadata) store.metadata = {};
            // Only adopt the dataset display name when the target has none —
            // imports merge into the current dataset rather than replace it.
            if (pkg.metadata.name && !store.metadata.name) {
              store.metadata.name = pkg.metadata.name;
            }
          }
        }

        // Import safeguards: repair baseline card structure in place
        // (children/tags arrays, modsData object). Preserves plugin
        // metadata and warns instead of stripping anything.
        importedIds.forEach(cardId => {
          const storedCard = store.cards[cardId];
          if (storedCard) {
            try {
              const migrated = coreMigrateCard(storedCard);
              migrated.warnings.forEach(w => console.warn(`[Import] ${cardId}:`, w));
            } catch (err) {
              console.warn('[Import] Validation skipped for', cardId, err);
            }
          }
        });

        // A hand-crafted or third-party import can carry cyclic or dangling
        // parent references. Repair them (break cycles, drop missing parents,
        // rebuild rootOrder) before persisting so breadcrumb/ancestor traversal
        // can never hang on the imported data.
        try {
          if (typeof validateStoreConsistency === 'function') validateStoreConsistency();
        } catch (err) {
          console.warn('[Import] Consistency repair skipped:', err);
        }

        save();
        
        showToast(`Imported ${Object.keys(remappedCards).length} cards`);
        render();
        } finally {
          if (groupedUndo && window.endUndoGroup) window.endUndoGroup();
        }
      }

      function importTXT(text, mode = 'outline', location = 'root') {
        const createdIds = [];
        if (mode === 'outline') {
          const lines = text.split('\n').filter(l => l.trim());
          const stack = [];
          lines.forEach(line => {
            const indent = line.search(/\S/);
            const title = line.trim();
            const depth = Math.floor(indent / 2);
            const parentId = depth > 0 && stack[depth - 1] ? stack[depth - 1] :
                           (location === 'root' ? null : location);
            const id = createCard(title, '', parentId);
            stack[depth] = id;
            stack.length = depth + 1;
            createdIds.push(id);
          });
          showToast('Imported outline successfully');
          render();
        } else if (mode === 'append') {
          if (location && location !== 'root') {
            const card = store.cards[location];
            if (card) {
              card.body = (card.body ? card.body + '\n\n' : '') + text;
              card.updatedAt = Date.now();
              save();
              showToast('Text appended successfully');
              render();
            }
          }
        }

      }

      // --- INSTANCE & MODALS ---

      function showDatasetManager() {
        const overlay = h('div', { className: 'modal-overlay show' });
        const modal = h('div', { className: 'modal', style: 'max-width: 700px;' });
        const modalHeader = h('div', { className: 'modal-header' });
        modalHeader.appendChild(h('div', { className: 'modal-title' }, 'Dataset Manager'));
        const closeBtn = h('button', { className: 'modal-close', 'aria-label': 'Close dialog', onclick: () => overlay.remove() }, '✕');
        modalHeader.appendChild(closeBtn);
        modal.appendChild(modalHeader);
        const modalBody = h('div', { className: 'modal-body' });

        // Get all existing datasets (instances) — both key shapes (NEW-2)
        const allKeys = getAllDatasetKeys();
        const current = instanceKey || 'nested_cards_store';

        // Title and description
        const description = h('p', { style: 'margin-bottom: var(--space-lg); color: var(--text-secondary);' }, 
          'Manage your datasets. Each dataset is an independent collection of cards with its own storage.');
        modalBody.appendChild(description);

        // Existing datasets section
        const datasetsTitle = h('h3', { style: 'margin-bottom: var(--space-md);' }, 'Your Datasets');
        modalBody.appendChild(datasetsTitle);

        if (allKeys.length === 0) {
          const empty = h('div', { className: 'empty', style: 'margin-bottom: var(--space-xl);' }, 
            'No datasets found. Create your first dataset below.');
          modalBody.appendChild(empty);
        } else {
          // List existing datasets
          const datasetList = h('div', { style: 'margin-bottom: var(--space-xl);' });
          
          allKeys.forEach(key => {
            const isCurrent = key === current;
            const datasetItem = h('div', { 
              style: `
                background: ${isCurrent ? 'var(--primary-light, #e3f2fd)' : 'var(--bg-secondary)'};
                padding: var(--space-lg);
                border-radius: var(--radius);
                border: 2px solid ${isCurrent ? 'var(--primary)' : 'var(--border)'};
                margin-bottom: var(--space-md);
                display: flex;
                justify-content: space-between;
                align-items: center;
              `
            });

            // Dataset info
            const datasetInfo = h('div', { style: 'flex: 1;' });
            const datasetName = h('div', { style: 'font-weight: 700; margin-bottom: var(--space-xs);' }, 
              key + (isCurrent ? ' (Active)' : ''));
            const datasetMeta = h('div', { style: 'font-size: 0.875rem; color: var(--text-secondary);' });
            
            // Get size info
            try {
              const data = localStorage.getItem(key);
              const size = data ? new Blob([data]).size : 0;
              const formatBytes = (bytes) => {
                if (bytes === 0) return '0 Bytes';
                const k = 1024;
                const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
              };

              const parsed = data ? JSON.parse(data) : null;
              if (parsed && parsed.encrypted === true && typeof parsed.payload === 'string') {
                datasetMeta.textContent = `Storage: LocalStorage • Size: ${formatBytes(size)} • Encrypted (PIN protected)`;
              } else {
                const cardCount = parsed ? Object.keys(parsed.cards || {}).length : 0;
                const storageType = (parsed && parsed.metadata && parsed.metadata.storageType) || 'localstorage';
                const storageTypeDisplay = getStorageTypeLabel(storageType);
                datasetMeta.textContent = `Storage: ${storageTypeDisplay} • Size: ${formatBytes(size)} • Cards: ${cardCount}`;
              }
            } catch (e) {
              datasetMeta.textContent = 'Storage: Unknown • Unable to read dataset info';
            }

            datasetInfo.appendChild(datasetName);
            datasetInfo.appendChild(datasetMeta);
            datasetItem.appendChild(datasetInfo);

            // Actions
            const actions = h('div', { style: 'display: flex; gap: var(--space-sm);' });
            
            if (!isCurrent) {
              const openBtn = h('button', {
                className: 'btn btn-primary',
                onclick: async () => {
                  overlay.remove();
                  // Flush the current dataset's pending save to ITS key before
                  // switching, so a stale debounce timer can't later write this
                  // dataset's (possibly unencrypted) data into the opened
                  // dataset's key.
                  await flushPendingSave();
                  localStorage.setItem('activeInstance', key);
                  setInstanceKey(key);
                  await load();
                  await reconcilePluginsAfterDatasetSwitch();
                  if (typeof updateDatasetSelector === 'function') updateDatasetSelector();
                  render();
                  showToast('Switched to: ' + key);
                }
              }, 'Open');
              actions.appendChild(openBtn);
            }

            if (isCurrent) {
              const storageBtn = h('button', {
                className: 'btn',
                onclick: async () => {
                  overlay.remove();
                  showDatasetStorageSettings();
                }
              }, 'Storage Settings');
              actions.appendChild(storageBtn);
            }

            const deleteBtn = h('button', { 
              className: 'btn btn-danger',
              onclick: async () => {
                if (allKeys.length === 1) {
                  showToast('Cannot delete the only dataset', 'error');
                  return;
                }
                if (await showConfirmDialog(`Delete dataset "${key}"?\n\nThis will permanently delete all cards and data in this dataset.\n\nThis action cannot be undone!`, {
                  title: 'Delete Dataset',
                  confirmLabel: 'Delete Dataset',
                  cancelLabel: 'Cancel',
                  confirmClassName: 'btn btn-danger'
                })) {
                  // If we're deleting the active dataset, cancel any pending
                  // debounced save first so it can't fire after removal and
                  // silently recreate this dataset at its key.
                  if (isCurrent) cancelPendingSave();
                  localStorage.removeItem(key);
                  if (isCurrent && allKeys.length > 1) {
                    // Switch to another dataset
                    const otherKey = allKeys.find(k => k !== key);
                    localStorage.setItem('activeInstance', otherKey);
                    setInstanceKey(otherKey);
                    await load();
                    await reconcilePluginsAfterDatasetSwitch();
                    render();
                  }
                  if (typeof updateDatasetSelector === 'function') updateDatasetSelector();
                  overlay.remove();
                  showToast('Dataset deleted: ' + key);
                  // Reopen manager to refresh list
                  setTimeout(() => showDatasetManager(), 100);
                }
              }
            }, 'Delete');
            actions.appendChild(deleteBtn);

            datasetItem.appendChild(actions);
            datasetList.appendChild(datasetItem);
          });

          modalBody.appendChild(datasetList);
        }

        // Create new dataset section
        const createTitle = h('h3', { style: 'margin-bottom: var(--space-md);' }, 'Create New Dataset');
        modalBody.appendChild(createTitle);

        const createForm = h('div', { 
          style: `
            background: var(--bg-secondary);
            padding: var(--space-lg);
            border-radius: var(--radius);
            border: 1px solid var(--border);
          `
        });

        // Dataset name input
        const nameLabel = h('label', {
          for: 'newDatasetName',
          style: 'display: block; margin-bottom: var(--space-xs); font-weight: 600;'
        }, 'Dataset Name');
        const nameInput = h('input', {
          type: 'text',
          id: 'newDatasetName',
          placeholder: 'My Dataset',
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

        // Storage type selection
        const storageLabel = h('label', {
          for: 'newDatasetStorage',
          style: 'display: block; margin-bottom: var(--space-xs); font-weight: 600;'
        }, 'Storage Type');
        const storageSelect = h('select', {
          id: 'newDatasetStorage',
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

        const optionLocal = h('option', { value: 'localstorage' }, 'LocalStorage (Browser storage, fast access)');
        const optionIndexed = h('option', { value: 'indexeddb' }, 'IndexedDB (Browser database, larger capacity)');
        const optionLocalFile = h('option', { value: 'localfile' }, 'Local File (choose location on device)');
        storageSelect.appendChild(optionLocal);
        storageSelect.appendChild(optionIndexed);
        storageSelect.appendChild(optionLocalFile);

        const storageHelp = h('div', {
          style: 'font-size: 0.875rem; color: var(--text-secondary); margin-bottom: var(--space-lg);'
        }, 'Default: LocalStorage. You can migrate later. Local File lets you choose a save location. All options keep your data on this device.');

        // PIN protection
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
        const pinLabel = h('label', {
          for: 'newDatasetPin',
          style: 'display: block; margin-bottom: var(--space-xs); font-weight: 600;'
        }, 'PIN Protection (Optional)');
        const pinInput = h('input', {
          type: 'password',
          id: 'newDatasetPin',
          placeholder: 'Leave empty for no PIN',
          autocomplete: 'new-password',
          'aria-describedby': 'newDatasetPinHelp',
          style: pinFieldStyle
        });

        const pinConfirmLabel = h('label', {
          for: 'newDatasetPinConfirm',
          style: 'display: block; margin-bottom: var(--space-xs); font-weight: 600;'
        }, 'Confirm PIN');
        const pinConfirmInput = h('input', {
          type: 'password',
          id: 'newDatasetPinConfirm',
          placeholder: 'Re-enter the same PIN',
          autocomplete: 'new-password',
          'aria-describedby': 'newDatasetPinHelp',
          style: pinFieldStyle
        });

        const pinHelp = h('div', {
          id: 'newDatasetPinHelp',
          style: 'font-size: 0.875rem; color: var(--text-secondary); margin-bottom: var(--space-lg);'
        }, 'If set, this PIN encrypts dataset payloads via Web Crypto (PBKDF2 + AES-GCM). ' +
           'The PIN is used exactly as typed and cannot be recovered if forgotten. ' +
           'A short PIN is convenience protection, not strong security.');

        // Create button
        const createBtn = h('button', {
          className: 'btn btn-primary',
          style: 'width: 100%;',
          onclick: async () => {
            let name = document.getElementById('newDatasetName').value.trim();
            const storageType = document.getElementById('newDatasetStorage').value;
            // The PIN is a secret: never silently normalize it (CS-106). The
            // unlock prompt uses the PIN exactly as typed, so creation must
            // too — but reject shapes the unlock flow can never accept.
            const pin = document.getElementById('newDatasetPin').value;
            const pinConfirm = document.getElementById('newDatasetPinConfirm').value;

            if (pin) {
              if (!pin.trim()) {
                showToast('The PIN cannot consist only of spaces', 'error');
                return;
              }
              if (pin !== pin.trim()) {
                showToast('The PIN cannot start or end with a space', 'error');
                return;
              }
              if (pin !== pinConfirm) {
                showToast('The PINs do not match. Please re-enter them.', 'error');
                return;
              }
            }

            // Generate a readable default name if none provided
            if (!name) {
              const count = getAllDatasetKeys().length + 1;
              name = 'Dataset_' + count;
            }

            if (storageType === 'localfile') {
              if (typeof window.showSaveFilePicker !== 'function') {
                showToast('Local file location selection is not supported in this environment', 'error');
                return;
              }
            }

            // Generate a clean, short key using the name and a short timestamp
            const shortId = Date.now().toString(36).slice(-4);
            const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
            const newKey = 'cards_' + cleanName + '_' + shortId;

            if (pin && !(window.crypto && window.crypto.subtle)) {
              showToast('PIN protection requires the Web Crypto API, which is unavailable in this environment', 'error');
              return;
            }

            // Store the display name and storage type in the store metadata.
            // The PIN itself is NEVER persisted (not even inside the
            // encrypted payload) — it lives in the encryption session only,
            // and unlocking after a reload re-derives the key from the PIN
            // the user types (CS-001).
            const newStore = {
              rootOrder: [],
              cards: {},
              plugins: {},
              bookmarks: [],
              recentCards: [],
              viewMode: 'normal',
              activeTheme: 'light',
              metadata: {
                name: name,
                storageType: storageType,
                storageConfig: {},
                createdAt: Date.now()
              }
            };

            // Flush the current dataset's pending save to its own key before
            // switching to the new dataset, so an in-flight edit isn't lost.
            await flushPendingSave();
            localStorage.setItem('activeInstance', newKey);
            setInstanceKey(newKey);
            setStore(newStore);
            setSessionPin(pin || null);
            save();
            if (typeof updateDatasetSelector === 'function') updateDatasetSelector();
            render();
            overlay.remove();
            if (pin) {
              showToast(`Created encrypted dataset: ${name}. Remember your PIN — without it the data cannot be recovered.`, 'warning', 8000);
            } else {
              showToast(`Created new dataset: ${name} (${storageType})`);
            }
          }
        }, '+ Create Dataset');

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

        // Focus on name input
        setTimeout(() => nameInput.focus(), 100);
      }



      function showDatasetInfo() {
        const overlay = h('div', { className: 'modal-overlay show' });
        const modal = h('div', { className: 'modal' });
        const modalHeader = h('div', { className: 'modal-header' });
        modalHeader.appendChild(h('div', { className: 'modal-title' }, 'Dataset Information'));
        const closeBtn = h('button', { className: 'modal-close', 'aria-label': 'Close dialog', onclick: () => overlay.remove() }, '✕');
        modalHeader.appendChild(closeBtn);
        modal.appendChild(modalHeader);
        const modalBody = h('div', { className: 'modal-body' });

        // Current instance/dataset info
        const currentKey = instanceKey || 'nested_cards_store';
        const currentData = localStorage.getItem(currentKey);
        
        // Calculate size
        let dataSize = 0;
        let totalSize = 0;
        let itemCount = 0;
        
        if (currentData) {
          dataSize = new Blob([currentData]).size;
        }
        
        // Count all localStorage items
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const value = localStorage.getItem(key);
          if (value) {
            totalSize += new Blob([value]).size;
            itemCount++;
          }
        }

        // Parse store info
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

        // Format bytes
        const formatBytes = (bytes) => {
          if (bytes === 0) return '0 Bytes';
          const k = 1024;
          const sizes = ['Bytes', 'KB', 'MB', 'GB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
        };

        // Get storage type and display name from store metadata
        const displayName = (store && store.metadata && store.metadata.name) || currentKey;
        const storageType = (store && store.metadata && store.metadata.storageType) || 'localstorage';
        const storageTypeDisplay = getStorageTypeLabel(storageType);

        // Report PIN protection from the stored envelope, not a hardcoded 'No'
        let pinProtected = 'No';
        try {
          const probe = currentData ? JSON.parse(currentData) : null;
          if (probe && probe.encrypted === true && typeof probe.payload === 'string') {
            pinProtected = (typeof getSessionPin === 'function' && getSessionPin())
              ? 'Yes (unlocked this session)'
              : 'Yes (locked)';
          }
        } catch (_e) {
          pinProtected = 'Unknown (unreadable data)';
        }

        // Create info sections using safe DOM methods
        const infoRow = (label, value) => {
          const row = h('div', { style: 'margin-bottom: var(--space-sm);' });
          row.appendChild(h('strong', {}, label));
          row.appendChild(document.createTextNode(' ' + value));
          return row;
        };
        const sectionStyle = 'background: var(--bg-secondary); padding: var(--space-lg); border-radius: var(--radius); border: 1px solid var(--border);';
        const headingStyle = 'margin-bottom: var(--space-md); color: var(--text-primary);';

        // Current Dataset section
        const currentSection = h('div', { style: 'margin-bottom: var(--space-xl);' },
          h('h3', { style: headingStyle }, 'Current Dataset'),
          h('div', { style: sectionStyle },
            infoRow('Name:', displayName),
            infoRow('Storage Type:', storageTypeDisplay),
            infoRow('Size:', formatBytes(dataSize)),
            infoRow('PIN Protected:', pinProtected)
          )
        );
        modalBody.appendChild(currentSection);

        // Dataset Contents section
        const contentsSection = h('div', { style: 'margin-bottom: var(--space-xl);' },
          h('h3', { style: headingStyle }, 'Dataset Contents'),
          h('div', { style: sectionStyle },
            infoRow('Cards:', String(cardCount)),
            infoRow('Plugins:', String(modCount)),
            infoRow('Bookmarks:', String(bookmarkCount)),
            infoRow('Recent Cards:', String(recentCount))
          )
        );
        modalBody.appendChild(contentsSection);

        // Storage Overview section
        const quotaPercent = '~' + Math.round((totalSize / (5 * 1024 * 1024)) * 100) + '% (typical 5MB limit)';
        const storageSection = h('div', { style: 'margin-bottom: var(--space-xl);' },
          h('h3', { style: headingStyle }, 'Storage Overview'),
          h('div', { style: sectionStyle },
            infoRow('Total LocalStorage:', formatBytes(totalSize)),
            infoRow('Total Items:', String(itemCount)),
            infoRow('Quota Used:', quotaPercent)
          )
        );
        modalBody.appendChild(storageSection);

        // Quick Actions section
        const exportBtn = h('button', {
          className: 'btn btn-primary',
          onclick: () => { overlay.remove(); handleExport('instance-json'); }
        }, 'Export Dataset');
        const switchBtn = h('button', {
          className: 'btn btn-secondary',
          onclick: () => { overlay.remove(); showDatasetManager(); }
        }, 'Switch Dataset');
        const actionsSection = h('div', {},
          h('h3', { style: headingStyle }, 'Quick Actions'),
          h('div', { style: 'display: flex; gap: var(--space-md); flex-wrap: wrap;' },
            exportBtn, switchBtn
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


      // =============================================================
      // --- PLUGIN MANAGER UI ---
      // Unified interface for installing, managing, and creating plugins
      // =============================================================

      function showPluginManager(initialTab) {
        initialTab = initialTab || 'installed';
        var overlay = h('div', { className: 'modal-overlay show' });
        var modal = h('div', {
          className: 'modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'pluginManagerTitle',
          style: 'max-width: 800px; max-height: 90vh;'
        });

        var modalHeader = h('div', { className: 'modal-header' });
        modalHeader.appendChild(h('div', { className: 'modal-title', id: 'pluginManagerTitle' }, 'Plugin Manager'));
        modalHeader.appendChild(h('button', {
          className: 'modal-close',
          'aria-label': 'Close Plugin Manager',
          onclick: function() { overlay.remove(); }
        }, '\u2715'));
        modal.appendChild(modalHeader);

        // Tab buttons
        var tabBar = h('div', { role: 'tablist', 'aria-label': 'Plugin Manager sections', style: 'display: flex; border-bottom: 2px solid var(--border); padding: 0 var(--space-lg);' });
        var tabs = ['installed', 'install', 'gallery', 'create'];
        var tabButtons = {};
        var tabContents = {};

        tabs.forEach(function(tabName) {
          var btn = h('button', {
            className: 'tab-btn',
            role: 'tab',
            style: 'padding: var(--space-md) var(--space-lg); border: none; background: none; cursor: pointer; border-bottom: 3px solid transparent; font-weight: 500; color: var(--text);',
            onclick: function() { switchTab(tabName); }
          }, tabName.charAt(0).toUpperCase() + tabName.slice(1));
          tabButtons[tabName] = btn;
          tabBar.appendChild(btn);
        });
        modal.appendChild(tabBar);

        var bodyContent = h('div', { className: 'modal-body', style: 'overflow-y: auto; max-height: 65vh; padding: var(--space-lg);' });

        // Tab content containers
        tabs.forEach(function(tabName) {
          var container = h('div', { 
            className: 'tab-content',
            style: 'display: none;'
          });
          tabContents[tabName] = container;
          bodyContent.appendChild(container);
        });

        function switchTab(tabName) {
          tabs.forEach(function(t) {
            // --accent-strong keeps active-tab text at >= 4.5:1 contrast in
            // light and dark themes (QA A11Y-5).
            tabButtons[t].style.borderBottom = t === tabName ? '3px solid var(--accent-strong, #1d4ed8)' : '3px solid transparent';
            tabButtons[t].style.color = t === tabName ? 'var(--accent-strong, #1d4ed8)' : 'var(--text)';
            tabButtons[t].setAttribute('aria-selected', t === tabName ? 'true' : 'false');
            tabContents[t].style.display = t === tabName ? 'block' : 'none';
          });
        }

        // ===== INSTALLED TAB =====
        function renderInstalledTab() {
          var container = tabContents['installed'];
          container.innerHTML = '';

          var plugins = window.CardSpoke && window.CardSpoke.Plugin ? window.CardSpoke.Plugin.listAll() : [];
          
          if (plugins.length === 0) {
            container.appendChild(h('div', { className: 'empty', style: 'padding: var(--space-xl); text-align: center; color: var(--text-muted);' }, 
              'No plugins installed. Use the Install or Create tabs to add plugins.'));
            return;
          }

          plugins.forEach(function(plugin) {
            var manifest = plugin.definition.manifest || {};
            var pkg = {
              manifest: manifest,
              setup: plugin.definition.setup,
              teardown: plugin.definition.teardown,
              css: plugin.definition.css,
              js: plugin.definition.js
            };
            var risk = window.CardSpoke.Plugin.assessModRisk(pkg);
            
            var card = h('div', {
              style: 'border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-md); margin-bottom: var(--space-md);'
            });

            var headerRow = h('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-sm);' });
            headerRow.appendChild(h('div', { style: 'font-weight: 700; font-size: var(--text-lg);' }, manifest.name || plugin.id));
            
            var riskBadge = h('span', {
              title: risk === 'SAFE'
                ? 'CSS-only theme — runs no JavaScript'
                : 'Contains JavaScript. Plugins are not sandboxed: once enabled (with your consent), this code has full access to the app and your data.',
              style: 'font-size: var(--text-xs); padding: 2px 8px; border-radius: 4px; font-weight: 600; ' +
                (risk === 'SAFE' ? 'background: #d1fae5; color: #065f46;' :
                 risk === 'LOW' ? 'background: #dbeafe; color: #1e40af;' :
                 risk === 'MEDIUM' ? 'background: #fef3c7; color: #92400e;' :
                 'background: #fee2e2; color: #991b1b;')
            }, risk);
            headerRow.appendChild(riskBadge);
            card.appendChild(headerRow);

            var info = h('div', { style: 'font-size: var(--text-sm); color: var(--text-muted); margin-bottom: var(--space-sm);' });
            info.textContent = 'v' + (manifest.version || '1.0.0') + ' by ' + (manifest.author || 'Unknown') +
              (manifest.description ? ' — ' + manifest.description : '');
            card.appendChild(info);

            var stateBadge = h('span', {
              style: 'font-size: var(--text-xs); padding: 2px 8px; border-radius: 4px; font-weight: 600; ' +
                (plugin.enabled ? 'background: #d1fae5; color: #065f46;' : 'background: #e5e7eb; color: #374151;')
            }, plugin.enabled ? 'Active' : 'Suspended');
            card.appendChild(stateBadge);

            var actions = h('div', { style: 'display: flex; gap: var(--space-sm); margin-top: var(--space-md);' });
            
            var toggleBtn = h('button', {
              className: 'btn btn-sm',
              style: 'font-size: var(--text-sm);',
              onclick: async function() {
                try {
                  if (plugin.enabled) {
                    await window.CardSpoke.Plugin.disable(plugin.id);
                    showToast('Plugin suspended: ' + manifest.name);
                  } else {
                    await window.CardSpoke.Plugin.enable(plugin.id);
                    showToast('Plugin enabled: ' + manifest.name);
                  }
                  renderInstalledTab();
                } catch (err) {
                  showToast('Error: ' + err.message, 'error');
                  renderInstalledTab();
                }
              }
            }, plugin.enabled ? 'Suspend' : 'Enable');
            actions.appendChild(toggleBtn);

            var removeBtn = h('button', {
              className: 'btn btn-sm',
              style: 'font-size: var(--text-sm); background: var(--danger, #ef4444); color: white;',
              onclick: async function() {
                if (await showConfirmDialog('Remove plugin "' + manifest.name + '"?', {
                  title: 'Remove Plugin',
                  confirmLabel: 'Remove',
                  cancelLabel: 'Cancel',
                  confirmClassName: 'btn btn-danger'
                })) {
                  try {
                    await window.CardSpoke.Plugin.unregister(plugin.id);
                    showToast('Plugin removed: ' + manifest.name);
                  } catch (err) {
                    showToast('Failed to remove plugin: ' + err.message, 'error');
                  }
                  renderInstalledTab();
                }
              }
            }, 'Remove');
            actions.appendChild(removeBtn);
            
            card.appendChild(actions);
            container.appendChild(card);
          });

          // Legacy plugins section: only entries WITHOUT a definition are
          // legacy (pre-v2) packages the current runtime cannot execute.
          // Modern installed plugins also live in store.plugins (with a
          // definition) and are already listed above — never show them here.
          var modIds = Object.keys(store.plugins || {}).filter(function(modId) {
            return !(store.plugins[modId] && store.plugins[modId].definition);
          });
          if (modIds.length > 0) {
            var legacySection = h('div', { style: 'margin-top: var(--space-xl); padding-top: var(--space-xl); border-top: 1px solid var(--border);' });
            legacySection.appendChild(h('h3', { style: 'margin-bottom: var(--space-md); color: var(--warning, #f59e0b);' }, 'Legacy Plugins (Non-functional)'));
            legacySection.appendChild(h('p', { style: 'margin-bottom: var(--space-md); color: var(--text-muted);' },
              'These legacy plugins use the old system and are no longer functional:'));

            modIds.forEach(function(modId) {
              var pkg = store.plugins[modId];
              var manifest = pkg.manifest || {};
              
              var legacyCard = h('div', {
                style: 'border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-md); margin-bottom: var(--space-md); opacity: 0.6;'
              });

              legacyCard.appendChild(h('div', { style: 'font-weight: 700;' }, manifest.name || modId));
              legacyCard.appendChild(h('div', { style: 'font-size: var(--text-sm); color: var(--text-muted);' }, 
                'v' + (manifest.version || '?') + ' by ' + (manifest.author || 'Unknown')));
              
              var exportBtn = h('button', {
                className: 'btn btn-sm',
                style: 'font-size: var(--text-xs); margin-top: var(--space-sm);',
                onclick: function() {
                  var json = JSON.stringify(pkg, null, 2);
                  downloadWithFeedback(json, modId + '.json', 'application/json');
                  showToast('Legacy plugin exported for migration');
                }
              }, 'Export');
              legacyCard.appendChild(exportBtn);
              
              legacySection.appendChild(legacyCard);
            });

            container.appendChild(legacySection);
          }
        }

        // ===== INSTALL TAB =====
        function renderInstallTab() {
          var container = tabContents['install'];
          container.innerHTML = '';

          container.appendChild(h('h3', { style: 'margin-bottom: var(--space-md);' }, 'Install Plugin'));
          
          // File upload section
          var uploadSection = h('div', { style: 'margin-bottom: var(--space-xl);' });
          uploadSection.appendChild(h('h4', { style: 'margin-bottom: var(--space-sm);' }, 'Upload Plugin File'));
          uploadSection.appendChild(h('p', { style: 'margin-bottom: var(--space-md); color: var(--text-muted);' }, 
            'Upload a JSON file containing a plugin definition.'));
          
          var fileInput = h('input', { 
            type: 'file', 
            accept: '.json',
            style: 'margin-bottom: var(--space-sm);'
          });
          
          var uploadBtn = h('button', {
            className: 'btn',
            onclick: async function() {
              var file = fileInput.files[0];
              if (!file) {
                showToast('Please select a file', 'error');
                return;
              }
              
              try {
                var text = await file.text();
                var pkg = JSON.parse(text);

                // install() validates the package and compiles its js/css —
                // it is the single entry point for plugin packages.
                var id = await window.CardSpoke.Plugin.install(pkg);
                showToast('Plugin installed: ' + (pkg.manifest.name || id), 'success');
                renderInstalledTab();
                switchTab('installed');
              } catch (err) {
                showToast('Installation failed: ' + err.message, 'error');
              }
            }
          }, 'Install from File');
          
          uploadSection.appendChild(fileInput);
          uploadSection.appendChild(uploadBtn);
          container.appendChild(uploadSection);

          // URL section
          var urlSection = h('div', {});
          urlSection.appendChild(h('h4', { style: 'margin-bottom: var(--space-sm);' }, 'Install from URL'));
          urlSection.appendChild(h('p', { style: 'margin-bottom: var(--space-md); color: var(--text-muted);' }, 
            'Load a plugin from a remote URL.'));
          
          var urlInput = h('input', {
            type: 'url',
            placeholder: 'https://example.com/plugin.json',
            style: 'width: 100%; padding: var(--space-sm); margin-bottom: var(--space-sm); border: 1px solid var(--border); border-radius: 4px;'
          });
          
          var urlBtn = h('button', {
            className: 'btn',
            onclick: async function() {
              var url = urlInput.value.trim();
              if (!url) {
                showToast('Please enter a URL', 'error');
                return;
              }
              
              try {
                var response = await fetch(url);
                if (!response.ok) throw new Error('Failed to fetch plugin: ' + response.status + ' ' + response.statusText);
                var pkg = await response.json();

                // install() validates the package and compiles its js/css —
                // it is the single entry point for plugin packages.
                var id = await window.CardSpoke.Plugin.install(pkg);
                showToast('Plugin installed: ' + (pkg.manifest.name || id), 'success');
                renderInstalledTab();
                switchTab('installed');
              } catch (err) {
                showToast('Installation failed: ' + err.message, 'error');
              }
            }
          }, 'Install from URL');
          
          urlSection.appendChild(urlInput);
          urlSection.appendChild(urlBtn);
          container.appendChild(urlSection);
        }



        // ===== GALLERY TAB =====
        function renderGalleryTab() {
          var container = tabContents['gallery'];
          container.innerHTML = '';
          container.appendChild(h('h3', { style: 'margin-bottom: var(--space-md);' }, 'Plugin Gallery'));
          container.appendChild(h('p', { style: 'margin-bottom: var(--space-lg); color: var(--text-muted);' },
            'Browse curated plugins from the CardSpoke GitHub repository.'));

          var loading = h('div', { style: 'padding: var(--space-md); color: var(--text-muted);' }, 'Loading gallery...');
          container.appendChild(loading);

          fetch('https://raw.githubusercontent.com/jxburros/CardSpoke/main/sample-plugins/manifest.json')
            .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function(manifest) {
              loading.remove();
              var plugins = Array.isArray(manifest.plugins) ? manifest.plugins : [];
              if (!plugins.length) {
                container.appendChild(h('div', { className: 'empty' }, 'No gallery plugins available.'));
                return;
              }
              plugins.forEach(function(item) {
                var card = h('div', { style: 'border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-md); margin-bottom: var(--space-md);' });
                card.appendChild(h('div', { style: 'font-weight: 700;' }, item.name || item.id || 'Plugin'));
                card.appendChild(h('div', { style: 'font-size: var(--text-sm); color: var(--text-muted); margin-top: var(--space-xs);' }, item.description || ''));
                var installBtn = h('button', { className: 'btn btn-sm', style: 'margin-top: var(--space-sm);', onclick: async function() {
                  try {
                    var url = item.url || item.sourceUrl;
                    if (!url) throw new Error('Missing plugin URL in manifest');
                    var res = await fetch(url);
                    if (!res.ok) throw new Error('Failed to fetch plugin package');
                    var pkg = await res.json();
                    var id = await window.CardSpoke.Plugin.install(pkg);
                    showToast('Installed: ' + (pkg.manifest && pkg.manifest.name ? pkg.manifest.name : id), 'success');
                    renderInstalledTab();
                  } catch (err) {
                    showToast('Gallery install failed: ' + err.message, 'error');
                  }
                }}, 'Install');
                card.appendChild(installBtn);
                container.appendChild(card);
              });
            })
            .catch(function(err) {
              loading.textContent = 'Failed to load gallery: ' + err.message;
            });
        }

        // ===== CREATE TAB =====
        function renderCreateTab() {
          var container = tabContents['create'];
          container.innerHTML = '';

          container.appendChild(h('h3', { style: 'margin-bottom: var(--space-md);' }, 'Create Plugin'));
          container.appendChild(h('p', { style: 'margin-bottom: var(--space-lg); color: var(--text-muted);' }, 
            'Build a plugin directly in the app by providing metadata, JavaScript, and CSS.'));

          var form = h('div', {});

          // Manifest section
          form.appendChild(h('h4', { style: 'margin-bottom: var(--space-sm);' }, 'Manifest (JSON)'));
          var manifestInput = h('textarea', {
            placeholder: '{\n  "name": "My Plugin",\n  "version": "1.0.0",\n  "author": "Your Name",\n  "layer": "feature",\n  "permissions": []\n}',
            style: 'width: 100%; min-height: 120px; padding: var(--space-sm); margin-bottom: var(--space-md); font-family: monospace; border: 1px solid var(--border); border-radius: 4px;'
          });
          form.appendChild(manifestInput);

          // JavaScript section
          form.appendChild(h('h4', { style: 'margin-bottom: var(--space-sm);' }, 'JavaScript (setup function)'));
          var jsInput = h('textarea', {
            placeholder: '// Access APIs via ctx parameter\nconst cards = ctx.api.data.listCards();\nctx.api.ui.showToast(`Loaded ${cards.length} cards`, \'info\');',
            style: 'width: 100%; min-height: 150px; padding: var(--space-sm); margin-bottom: var(--space-md); font-family: monospace; border: 1px solid var(--border); border-radius: 4px;'
          });
          form.appendChild(jsInput);

          // CSS section
          form.appendChild(h('h4', { style: 'margin-bottom: var(--space-sm);' }, 'CSS (optional)'));
          var cssInput = h('textarea', {
            placeholder: '/* Custom styles */\n.my-element {\n  color: var(--primary);\n}',
            style: 'width: 100%; min-height: 100px; padding: var(--space-sm); margin-bottom: var(--space-md); font-family: monospace; border: 1px solid var(--border); border-radius: 4px;'
          });
          form.appendChild(cssInput);

          // Save button
          var saveBtn = h('button', {
            className: 'btn',
            onclick: async function() {
              try {
                var manifest = JSON.parse(manifestInput.value || '{}');
                if (!manifest.name) {
                  showToast('Plugin name is required', 'error');
                  return;
                }

                var jsCode = jsInput.value.trim();
                var css = cssInput.value.trim();

                // Pass the RAW source string: install() compiles it and
                // persists the string so the plugin survives page reloads.
                var pkg = {
                  manifest: manifest,
                  css: css || undefined,
                  js: jsCode || undefined
                };

                var id = await window.CardSpoke.Plugin.install(pkg);
                showToast('Plugin created and registered: ' + manifest.name, 'success');
                renderInstalledTab();
                switchTab('installed');
              } catch (err) {
                showToast('Failed to create plugin: ' + err.message, 'error');
              }
            }
          }, 'Save & Register');
          form.appendChild(saveBtn);

          container.appendChild(form);
        }

        // Render all tabs
        renderInstalledTab();
        renderInstallTab();
        renderGalleryTab();
        renderCreateTab();

        // Switch to initial tab
        switchTab(initialTab);

        modal.appendChild(bodyContent);
        overlay.appendChild(modal);
        overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
      }

      function showAppearanceSettings() {
        const overlay = h('div', { className: 'modal-overlay show' });
        const modal = h('div', { className: 'modal', style: 'max-width: 600px;' });
        const modalHeader = h('div', { className: 'modal-header' });
        modalHeader.appendChild(h('div', { className: 'modal-title' }, 'Appearance Settings'));
        const closeBtn = h('button', { className: 'modal-close', onclick: () => overlay.remove(), 'aria-label': 'Close' }, '✕');
        modalHeader.appendChild(closeBtn);
        modal.appendChild(modalHeader);
        
        const modalBody = h('div', { className: 'modal-body' });
        
        // View Mode Section
        const viewSection = h('div', { style: 'margin-bottom: var(--space-2xl); padding-bottom: var(--space-xl); border-bottom: 1px solid var(--border);' });
        viewSection.appendChild(h('div', { 
          style: 'font-weight: 700; margin-bottom: var(--space-lg); font-size: var(--text-lg);'
        }, 'View Options'));
        
        // Rich Text Toggle (NEW)
        const richTextEnabled = localStorage.getItem('cardspoke_richtext') === 'true';
        const richTextRow = h('div', { 
          className: 'menu-item-toggle',
          style: 'padding: var(--space-md); border: 1px solid var(--border); border-radius: 4px; margin-bottom: var(--space-md);'
        });
        const richTextLabel = h('div', { className: 'menu-item-label' });
        richTextLabel.appendChild(h('span', { style: 'display: block;' }, 'Rich Text'));
        richTextLabel.appendChild(h('span', { style: 'font-size: var(--text-sm); color: var(--text-muted); display: block;' }, 'Enable markdown formatting in card body'));
        const richTextToggle = h('label', { className: 'switch-toggle' });
        const richTextInput = h('input', { 
          type: 'checkbox', 
          checked: richTextEnabled,
          onchange: function(e) {
            localStorage.setItem('cardspoke_richtext', e.target.checked ? 'true' : 'false');
            showToast(e.target.checked ? 'Rich Text enabled' : 'Rich Text disabled');
            render();
          }
        });
        const richTextSlider = h('span', { className: 'switch-slider' });
        richTextToggle.appendChild(richTextInput);
        richTextToggle.appendChild(richTextSlider);
        richTextRow.appendChild(richTextLabel);
        richTextRow.appendChild(richTextToggle);
        viewSection.appendChild(richTextRow);
        
        // Compact View Toggle
        const compactViewEnabled = store.viewMode === 'compact';
        const compactRow = h('div', { 
          className: 'menu-item-toggle',
          style: 'padding: var(--space-md); border: 1px solid var(--border); border-radius: 4px; margin-bottom: var(--space-md);'
        });
        const compactLabel = h('label', { className: 'menu-item-label' }, 'Compact View');
        const compactToggle = h('label', { className: 'switch-toggle' });
        const compactInput = h('input', { 
          type: 'checkbox', 
          checked: compactViewEnabled,
          onchange: function(e) {
            store.viewMode = e.target.checked ? 'compact' : 'normal';
            save();
            render();
          }
        });
        const compactSlider = h('span', { className: 'switch-slider' });
        compactToggle.appendChild(compactInput);
        compactToggle.appendChild(compactSlider);
        compactRow.appendChild(compactLabel);
        compactRow.appendChild(compactToggle);
        viewSection.appendChild(compactRow);
        
        // Grid View Toggle
        const gridViewEnabled = localStorage.getItem('cardspoke_gridView') === 'true';
        const gridRow = h('div', { 
          className: 'menu-item-toggle',
          style: 'padding: var(--space-md); border: 1px solid var(--border); border-radius: 4px; margin-bottom: var(--space-md);'
        });
        const gridLabel = h('label', { className: 'menu-item-label' }, 'Grid View');
        const gridToggle = h('label', { className: 'switch-toggle' });
        const gridInput = h('input', { 
          type: 'checkbox', 
          checked: gridViewEnabled,
          onchange: function(e) {
            localStorage.setItem('cardspoke_gridView', e.target.checked.toString());
            render();
          }
        });
        const gridSlider = h('span', { className: 'switch-slider' });
        gridToggle.appendChild(gridInput);
        gridToggle.appendChild(gridSlider);
        gridRow.appendChild(gridLabel);
        gridRow.appendChild(gridToggle);
        viewSection.appendChild(gridRow);
        
        // High Contrast Toggle
        const highContrastEnabled = localStorage.getItem('cardspoke_highcontrast') === 'true';
        const contrastRow = h('div', { 
          className: 'menu-item-toggle',
          style: 'padding: var(--space-md); border: 1px solid var(--border); border-radius: 4px;'
        });
        const contrastLabel = h('label', { className: 'menu-item-label' }, 'High Contrast');
        const contrastToggle = h('label', { className: 'switch-toggle' });
        const contrastInput = h('input', { 
          type: 'checkbox', 
          checked: highContrastEnabled,
          onchange: function(e) {
            localStorage.setItem('cardspoke_highcontrast', e.target.checked.toString());
            if (e.target.checked) {
              document.documentElement.classList.add('high-contrast');
            } else {
              document.documentElement.classList.remove('high-contrast');
            }
          }
        });
        const contrastSlider = h('span', { className: 'switch-slider' });
        contrastToggle.appendChild(contrastInput);
        contrastToggle.appendChild(contrastSlider);
        contrastRow.appendChild(contrastLabel);
        contrastRow.appendChild(contrastToggle);
        viewSection.appendChild(contrastRow);
        
        // Developer Mode Toggle
        const devModeEnabled = localStorage.getItem('cardspoke_devmode') === 'true';
        const devRow = h('div', { 
          className: 'menu-item-toggle',
          style: 'padding: var(--space-md); border: 1px solid var(--border); border-radius: 4px; margin-top: var(--space-md);'
        });
        const devLabel = h('label', { className: 'menu-item-label' }, 'Developer Mode');
        const devToggle = h('label', { className: 'switch-toggle' });
        const devInput = h('input', { 
          type: 'checkbox', 
          checked: devModeEnabled,
          onchange: function(e) {
            localStorage.setItem('cardspoke_devmode', e.target.checked.toString());
            if (e.target.checked) {
              showToast('Developer mode enabled - Open menu to access Developer Console', 'success');
            } else {
              showToast('Developer mode disabled', 'info');
            }
          }
        });
        const devSlider = h('span', { className: 'switch-slider' });
        devToggle.appendChild(devInput);
        devToggle.appendChild(devSlider);
        devRow.appendChild(devLabel);
        devRow.appendChild(devToggle);
        viewSection.appendChild(devRow);
        
        modalBody.appendChild(viewSection);
        
        // Typography Section
        const typoSection = h('div', { style: 'margin-bottom: var(--space-2xl); padding-bottom: var(--space-xl); border-bottom: 1px solid var(--border);' });
        typoSection.appendChild(h('div', { 
          style: 'font-weight: 700; margin-bottom: var(--space-lg); font-size: var(--text-lg);'
        }, 'Typography'));
        
        const currentTypography = localStorage.getItem('cardspoke_typography') || 'default';
        const typographyPresets = [
          { id: 'default', name: 'Default', desc: 'Standard reading size' },
          { id: 'comfortable', name: 'Comfortable', desc: 'Larger text, more spacing' },
          { id: 'compact', name: 'Compact', desc: 'Smaller text, denser layout' },
          { id: 'dyslexia', name: 'Dyslexia-Friendly', desc: 'Optimized for readability' }
        ];
        
        typographyPresets.forEach(function(preset) {
          const isActive = currentTypography === preset.id;
          const presetOption = h('div', {
            style: 'padding: var(--space-md); border: 2px solid ' + (isActive ? 'var(--text)' : 'var(--border)') + '; border-radius: 4px; margin-bottom: var(--space-md); cursor: pointer;',
            onclick: function() {
              localStorage.setItem('cardspoke_typography', preset.id);
              document.documentElement.setAttribute('data-typography', preset.id);
              showToast('Typography: ' + preset.name);
              overlay.remove();
              showAppearanceSettings();
            }
          });
          presetOption.appendChild(h('div', { style: 'font-weight: 600;' }, (isActive ? '✓ ' : '') + preset.name));
          presetOption.appendChild(h('div', { style: 'font-size: var(--text-sm); color: var(--text-muted);' }, preset.desc));
          typoSection.appendChild(presetOption);
        });
        
        modalBody.appendChild(typoSection);
        
        // Mode Section (Light/Dark)
        const modeSection = h('div', { style: 'margin-bottom: var(--space-2xl); padding-bottom: var(--space-xl); border-bottom: 1px solid var(--border);' });
        modeSection.appendChild(h('div', { 
          style: 'font-weight: 700; margin-bottom: var(--space-lg); font-size: var(--text-lg);'
        }, 'Mode'));
        
        const currentTheme = store.activeTheme || 'light';
        
        // Light mode option
        const lightOption = h('div', { 
          className: 'theme-option',
          style: 'padding: var(--space-lg); border: 2px solid ' + (currentTheme === 'light' ? 'var(--text)' : 'var(--border)') + '; margin-bottom: var(--space-md); cursor: pointer; border-radius: 4px; background: white; color: black;',
          onclick: function() {
            applyTheme('light');
            overlay.remove();
            showAppearanceSettings();
          }
        });
        lightOption.appendChild(h('div', { style: 'font-weight: 600; margin-bottom: var(--space-xs);' }, (currentTheme === 'light' ? '✓ ' : '') + 'Light Mode'));
        lightOption.appendChild(h('div', { style: 'font-size: var(--text-sm); color: #666;' }, 'Light color scheme'));
        modeSection.appendChild(lightOption);
        
        // Dark mode option
        const darkOption = h('div', { 
          className: 'theme-option',
          style: 'padding: var(--space-lg); border: 2px solid ' + (currentTheme === 'dark' ? 'white' : 'var(--border)') + '; margin-bottom: var(--space-md); cursor: pointer; border-radius: 4px; background: #1a1a1a; color: white;',
          onclick: function() {
            applyTheme('dark');
            overlay.remove();
            showAppearanceSettings();
          }
        });
        darkOption.appendChild(h('div', { style: 'font-weight: 600; margin-bottom: var(--space-xs);' }, (currentTheme === 'dark' ? '✓ ' : '') + 'Dark Mode'));
        darkOption.appendChild(h('div', { style: 'font-size: var(--text-sm); color: #aaa;' }, 'Dark color scheme'));
        modeSection.appendChild(darkOption);
        
        modalBody.appendChild(modeSection);
        
        // Theme Plugins Section
        const themeSection = h('div', { style: 'margin-bottom: var(--space-xl);' });
        themeSection.appendChild(h('div', {
          style: 'font-weight: 700; margin-bottom: var(--space-lg); font-size: var(--text-lg);'
        }, 'Theme Plugins'));

        // Theme-layer plugins from the modern runtime. Installed plugins
        // live in store.plugins as { definition: { manifest, css, ... },
        // enabled }; enabling/suspending them goes through
        // window.CardSpoke.Plugin so CSS injection and persistence are
        // handled by the plugin lifecycle (no separate theme mechanism).
        const themeExtensions = Object.entries(store.plugins || {}).filter(function([modId, plugin]) {
          var manifest = (plugin.definition && plugin.definition.manifest) || plugin.manifest || plugin.meta || {};
          return manifest.layer === 'theme' || (manifest.type && manifest.type === 'Theme');
        }).map(function([modId, plugin]) {
          var manifest = (plugin.definition && plugin.definition.manifest) || plugin.manifest || plugin.meta || {};
          return { manifest: manifest, meta: manifest, enabled: plugin.enabled, id: modId, isModern: !!plugin.definition };
        });

        async function activateThemePlugin(themeId) {
          if (!(window.CardSpoke && window.CardSpoke.Plugin)) return;
          // Themes are mutually exclusive: suspend every other enabled
          // theme-layer plugin, then enable the chosen one (if any).
          for (const other of themeExtensions) {
            if (other.isModern && other.enabled && other.id !== themeId) {
              try { await window.CardSpoke.Plugin.disable(other.id); } catch (err) { console.error('[Theme] Failed to suspend', other.id, err); }
            }
          }
          if (themeId) {
            await window.CardSpoke.Plugin.enable(themeId);
          }
        }

        const anyThemeEnabled = themeExtensions.some(function(t) { return t.enabled; });

        if (themeExtensions.length > 0) {
          // Default Theme option (no theme plugin enabled)
          const defaultThemeOption = h('div', {
            style: 'padding: var(--space-md); border: 2px solid ' + (!anyThemeEnabled ? 'var(--text)' : 'var(--border)') + '; border-radius: 4px; margin-bottom: var(--space-sm); cursor: pointer;',
            onclick: async function() {
              try {
                await activateThemePlugin(null);
                showToast('Default theme applied');
              } catch (err) {
                showToast('Failed to apply default theme: ' + err.message, 'error');
              }
              overlay.remove();
              showAppearanceSettings();
            }
          });
          defaultThemeOption.appendChild(h('div', { style: 'font-weight: 600;' }, (!anyThemeEnabled ? '✓ ' : '') + 'Default Theme'));
          defaultThemeOption.appendChild(h('div', { style: 'font-size: var(--text-sm); color: var(--text-muted);' }, 'Standard CardSpoke appearance'));
          themeSection.appendChild(defaultThemeOption);

          themeExtensions.forEach(function(theme) {
            const isActive = theme.enabled;
            const themeOption = h('div', {
              style: 'padding: var(--space-md); border: 2px solid ' + (isActive ? 'var(--text)' : 'var(--border)') + '; border-radius: 4px; margin-bottom: var(--space-sm); cursor: pointer; display: flex; justify-content: space-between; align-items: center;',
              onclick: async function() {
                if (!theme.isModern) {
                  showToast('This theme uses the legacy format and cannot be enabled. Re-install it from the Plugin Manager.', 'error');
                  return;
                }
                try {
                  await activateThemePlugin(theme.id);
                  showToast('Theme applied: ' + (theme.manifest.name || theme.id));
                } catch (err) {
                  showToast('Failed to apply theme: ' + err.message, 'error');
                }
                overlay.remove();
                showAppearanceSettings();
              }
            });
            
            const themeInfo = h('div', {});
            themeInfo.appendChild(h('div', { style: 'font-weight: 600;' }, (isActive ? '✓ ' : '') + (theme.manifest.name || theme.id)));
            themeInfo.appendChild(h('div', { style: 'font-size: var(--text-sm); color: var(--text-muted);' }, 'By ' + (theme.manifest.author || theme.manifest.creator || 'Unknown')));
            if (theme.manifest.description) {
              themeInfo.appendChild(h('div', { style: 'font-size: var(--text-sm); color: var(--text-muted); margin-top: var(--space-xs);' }, theme.manifest.description));
            }
            themeOption.appendChild(themeInfo);
            
            // Status badge
            const statusBadge = h('span', {
              style: 'font-size: var(--text-xs); padding: 2px 8px; border-radius: 10px; background: ' + (theme.enabled ? 'var(--success, #28a745)' : 'var(--text-muted)') + '; color: white;'
            }, theme.enabled ? 'Enabled' : 'Disabled');
            themeOption.appendChild(statusBadge);
            
            themeSection.appendChild(themeOption);
          });
        } else {
          themeSection.appendChild(h('div', { 
            style: 'padding: var(--space-lg); background: var(--bg-secondary); border-radius: 4px; text-align: center; color: var(--text-muted);'
          },
            h('div', { style: 'margin-bottom: var(--space-sm);' }, 'No custom themes installed'),
            h('div', { style: 'font-size: var(--text-sm);' }, 'Install theme plugins from the Plugin Manager')
          ));
        }
        
        modalBody.appendChild(themeSection);
        
        modal.appendChild(modalBody);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Set up focus trap
        trapFocus(modal);
        
        overlay.onclick = function(e) {
          if (e.target === overlay) overlay.remove();
        };
      }

      function showBookmarks() {
        const overlay = h('div', { className: 'modal-overlay show' });
        const modal = h('div', { className: 'modal' });
        const modalHeader = h('div', { className: 'modal-header' });
        modalHeader.appendChild(h('div', { className: 'modal-title' }, '★ Bookmarked Cards'));
        const closeBtn = h('button', { className: 'modal-close', 'aria-label': 'Close dialog', onclick: () => overlay.remove() }, '✕');
        modalHeader.appendChild(closeBtn);
        modal.appendChild(modalHeader);
        const modalBody = h('div', { className: 'modal-body' });
        
        if (!store.bookmarks || store.bookmarks.length === 0) {
          modalBody.appendChild(h('div', { className: 'empty' }, 'No bookmarked cards yet'));
        } else {
          const bookmarkList = store.bookmarks
            .map(cardId => store.cards[cardId])
            .filter(card => card) // Filter out deleted cards
            .map(card => {
              const cardItem = h('div', { 
                style: 'padding: var(--space-lg); border: 1px solid var(--border); margin-bottom: var(--space-md); cursor: pointer;',
                onclick: () => {
                  overlay.remove();
                  goTo('read', { cardId: card.id });
                }
              });
              
              const cardHeader = h('div', { style: 'display: flex; justify-content: space-between; align-items: center;' });
              cardHeader.appendChild(h('div', { style: 'font-weight: 700;' }, card.title || '(Untitled)'));
              
              const unbookmarkBtn = h('button', {
                className: 'btn btn-danger',
                style: 'font-size: var(--text-sm);',
                onclick: (e) => {
                  e.stopPropagation();
                  toggleBookmark(card.id);
                  overlay.remove();
                  showBookmarks();
                }
              }, 'Remove');
              cardHeader.appendChild(unbookmarkBtn);
              cardItem.appendChild(cardHeader);
              
              if (card.body) {
                const preview = card.body.substring(0, 100) + (card.body.length > 100 ? '...' : '');
                cardItem.appendChild(h('div', { style: 'color: var(--text-muted); font-size: var(--text-sm); margin-top: var(--space-sm);' }, preview));
              }
              
              return cardItem;
            });
          
          bookmarkList.forEach(item => modalBody.appendChild(item));
        }
        
        modal.appendChild(modalBody);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
      }

      function showRecentCards() {
        const overlay = h('div', { className: 'modal-overlay show' });
        const modal = h('div', { className: 'modal' });
        const modalHeader = h('div', { className: 'modal-header' });
        modalHeader.appendChild(h('div', { className: 'modal-title' }, 'Recent Cards'));
        const closeBtn = h('button', { className: 'modal-close', 'aria-label': 'Close dialog', onclick: () => overlay.remove() }, '✕');
        modalHeader.appendChild(closeBtn);
        modal.appendChild(modalHeader);
        const modalBody = h('div', { className: 'modal-body' });
        
        if (!store.recentCards || store.recentCards.length === 0) {
          modalBody.appendChild(h('div', { className: 'empty' }, 'No recently viewed cards'));
        } else {
          const recentList = store.recentCards
            .map(cardId => store.cards[cardId])
            .filter(card => card) // Filter out deleted cards
            .map((card, index) => {
              const cardItem = h('div', { 
                style: 'padding: var(--space-lg); border: 1px solid var(--border); margin-bottom: var(--space-md); cursor: pointer;',
                onclick: () => {
                  overlay.remove();
                  goTo('read', { cardId: card.id });
                }
              });
              
              const cardHeader = h('div', { style: 'display: flex; justify-content: space-between; align-items: center;' });
              cardHeader.appendChild(h('div', { style: 'font-weight: 700;' }, `${index + 1}. ${card.title || '(Untitled)'}`));
              cardItem.appendChild(cardHeader);
              
              if (card.body) {
                const preview = card.body.substring(0, 100) + (card.body.length > 100 ? '...' : '');
                cardItem.appendChild(h('div', { style: 'color: var(--text-muted); font-size: var(--text-sm); margin-top: var(--space-sm);' }, preview));
              }
              
              return cardItem;
            });
          
          recentList.forEach(item => modalBody.appendChild(item));
        }
        
        modal.appendChild(modalBody);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
      }

      function openUploadModalForCard(cardId, tabName) {
        // 1. Update all the select dropdowns
        updateImportLocationOptions();
        
        // 2. Set the value for the TXT dropdown to this cardId
        if (uploadModal.importLocationSelectTXT) {
          uploadModal.importLocationSelectTXT.value = cardId;
        }
        
        // 3. Set the correct radio button for TXT import (append)
        const txtAppendRadio = document.querySelector('input[name="txtImportMode"][value="append"]');
        if (txtAppendRadio) txtAppendRadio.checked = true;

        // 4. Switch to the correct tab (keeps aria-selected / roving
        //    tabindex in sync — activateUploadTab lives in rendering.js)
        activateUploadTab(tabName);
        
        // 5. Show the modal: locks body scroll, traps focus inside it and
        //    remembers the opener so closing returns focus there.
        openUploadModal();
      }

      function updateImportLocationOptions() {
        const selectJSON = uploadModal.importLocationSelectJSON;
        const selectTXT = uploadModal.importLocationSelectTXT;
        const sortedCards = Object.values(store.cards).sort((a, b) => {
          const A = (a.title || '').toLowerCase();
          const B = (b.title || '').toLowerCase();
          return A.localeCompare(B);
        });
        if (selectJSON) {
          selectJSON.innerHTML = '<option value="root">Add as Root Cards</option>';
          sortedCards.forEach(card => {
            const option = document.createElement('option');
            option.value = card.id;
            option.textContent = `Add as children of: ${card.title || '(Untitled)'}`;
            selectJSON.appendChild(option);
          });
        }
        if (selectTXT) {
          // Compromise text to work for both radio options
          selectTXT.innerHTML = '<option value="root">Add as Root Cards (Outline Mode)</option>';
          sortedCards.forEach(card => {
            const option = document.createElement('option');
            option.value = card.id;
            option.textContent = `Append to / Add children of: ${card.title || '(Untitled)'}`;
            selectTXT.appendChild(option);
          });
        }
      }

      // Pure utility functions — delegated to Kernel (Layer 0) imports
      function extractTags(body) { return kernelExtractTags(body); }
      function parseCardLinks(text) { return kernelParseCardLinks(text); }
      function normalizeCardName(name) { return kernelNormalizeCardName(name); }
      function hasCardLink(text, cardName) { return kernelHasCardLink(text, cardName); }

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
          // Record for undo unless this call is itself an undo/redo replay
          // (skipUndo) — pushUndo clears the redo stack, so replays must not.
          if (!skipUndo) pushUndo('addTag', { cardId, tag });
          if (!skipSave) save();
        }
        return result;
      }

      function removeTag(cardId, tag, skipSave = false, skipUndo = false) {
        _syncStoreToKernel();
        const result = _kernel.removeTag(cardId, tag);
        if (result) {
          _syncKernelToStore();
          if (!skipUndo) pushUndo('removeTag', { cardId, tag });
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

      /**
       * Create interactive tag editor with chips
       */
      function createTagEditor(initialTags, datalistId) {
        const normalized = Array.from(new Set(normalizeTagInput(initialTags.join(' '))));
        const tagSet = new Set(normalized);
        const wrapper = h('div', { className: 'tag-editor', role: 'list', 'aria-label': 'Tag editor' });
        const input = h('input', {
          type: 'text',
          className: 'tag-editor-input',
          list: datalistId,
          placeholder: 'Add tags...',
          'aria-label': 'Add tag'
        });

        function renderChips() {
          wrapper.querySelectorAll('.tag-chip').forEach(c => c.remove());
          tagSet.forEach(tag => {
            const chip = h('span', { className: 'tag-chip', role: 'listitem' },
              h('span', { className: 'tag-chip-text' }, tag),
              h('button', {
                type: 'button',
                className: 'tag-chip-remove',
                'aria-label': `Remove tag ${tag}`,
                onclick: (e) => {
                  e.stopPropagation();
                  tagSet.delete(tag);
                  renderChips();
                }
              }, '×')
            );
            wrapper.insertBefore(chip, input);
          });
        }

        function addTagsFromInput(val) {
          const tags = normalizeTagInput(val);
          tags.forEach(t => tagSet.add(t));
          renderChips();
          input.value = '';
        }

        input.addEventListener('keydown', (e) => {
          if (['Enter', 'Tab', ',', ' '].includes(e.key)) {
            addTagsFromInput(input.value);
            if (e.key !== 'Tab') e.preventDefault();
          } else if (e.key === 'Backspace' && !input.value && tagSet.size) {
            const last = Array.from(tagSet).pop();
            tagSet.delete(last);
            renderChips();
          }
        });
        input.addEventListener('blur', () => addTagsFromInput(input.value));

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
