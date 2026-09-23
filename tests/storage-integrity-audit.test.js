/**
 * Storage/session integrity regressions (2026-09 audit).
 *
 * Executes the real storage.js source in a vm context (same pattern as
 * review-storage.test.js):
 *   HIGH  every dataset switch/create path resets the per-dataset session
 *         (undo/redo, trash, navigation, write lock)
 *   MED   Clear All Data also deletes the app's IndexedDB databases;
 *         dataset delete removes the IndexedDB mirror copy
 *   LOW   persisted payloads carry a revision; a stale local file never
 *         overwrites newer LocalStorage data on boot
 *   SEC   plugins restored from a local file cannot switch themselves on
 */

import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { slice } from './helpers/app-layer-harness.js';

const storage = readFileSync(new URL('../www/src/storage.js', import.meta.url), 'utf8');
const data = readFileSync(new URL('../www/src/data.js', import.meta.url), 'utf8');

function sessionContext(overrides = {}) {
  const context = vm.createContext({
    console,
    undoStack: [{ action: 'deleteCard', data: { card: { id: 'secret', title: 'PIN-protected' } } }],
    redoStack: [{ action: 'createCard', data: { cardId: 'secret' } }],
    trashBin: [{ card: { id: 'secret', title: 'PIN-protected' }, deletedAt: 1 }],
    navState: { mode: 'focus', page: 'read', cardId: 'secret', parentId: 'p', searchQuery: 'q' },
    navHistory: [{ page: 'read', cardId: 'secret' }],
    storageWriteLock: true,
    ...overrides
  });
  context.setNavState = s => { context.navState = s; };
  context.setNavHistory = h => { context.navHistory = h; };
  vm.runInContext(slice(storage, 'function resetSessionState()', 'async function load()'), context);
  return context;
}

// ── HIGH: session reset on every dataset switch/create path ───────────────

test('resetSessionState clears undo/redo, trash, navigation and the write lock', () => {
  const context = sessionContext();
  const undoRef = context.undoStack;
  context.resetSessionState();
  assert.is(context.undoStack.length, 0);
  assert.is(context.undoStack, undoRef, 'shared arrays are emptied in place, not replaced');
  assert.is(context.redoStack.length, 0);
  assert.is(context.trashBin.length, 0);
  assert.is(context.navHistory.length, 0);
  assert.is(context.navState.cardId, null);
  assert.is(context.navState.page, 'list');
  assert.is(context.navState.mode, 'focus', 'app mode survives the switch');
  assert.is(context.storageWriteLock, false);
});

test('load() and the Create Dataset flow both run the shared reset', () => {
  const loadSrc = storage.slice(storage.indexOf('async function load()'));
  assert.ok(loadSrc.slice(0, 600).includes('resetSessionState();'), 'load() resets the session');
  const createIdx = data.indexOf('setStore(newStore);');
  assert.ok(createIdx > -1);
  const before = data.slice(createIdx - 600, createIdx);
  const after = data.slice(createIdx, createIdx + 600);
  assert.ok(before.includes('resetSessionState();'), 'create resets undo/trash/nav before swapping stores');
  assert.ok(after.includes('await reconcilePluginsAfterDatasetSwitch();'), 'create tears down the previous dataset plugins');
});

// ── MED: Clear All Data / dataset delete remove IndexedDB copies ─────────

test('Clear All Data deletes the app IndexedDB databases and stops pending writes', async () => {
  const deleted = [];
  let cleared = false;
  let cancelled = false;
  let closed = false;
  const context = vm.createContext({
    console,
    indexedDbMirrorDriver: { db: { close() { closed = true; } } },
    storageWriteLock: false,
    showConfirmDialog: async () => true,
    showToast() {},
    cancelPendingSave() { cancelled = true; },
    setTimeout() {},
    location: { reload() {} },
    localStorage: { length: 0, key: () => null, clear() { cleared = true; } },
    indexedDB: {
      deleteDatabase(name) {
        deleted.push(name);
        const req = {};
        Promise.resolve().then(() => req.onsuccess && req.onsuccess());
        return req;
      }
    }
  });
  vm.runInContext(slice(storage, 'const APP_INDEXEDDB_DATABASES', 'async function unlockEncryptedDataset('), context);
  await context.clearAllData();
  assert.ok(cleared, 'localStorage cleared');
  assert.equal([...deleted].sort(), ['CardSpokeDB', 'CardSpokeFileHandles']);
  assert.ok(closed, 'cached mirror connection closed so the delete is not blocked');
  assert.ok(cancelled, 'pending debounced save cancelled');
  assert.is(context.storageWriteLock, true, 'no write can recreate data before the reload');
});

test('a blocked IndexedDB delete does not hang Clear All Data', async () => {
  const context = vm.createContext({
    console,
    indexedDbMirrorDriver: null,
    indexedDB: {
      deleteDatabase() {
        const req = {};
        Promise.resolve().then(() => req.onblocked && req.onblocked());
        return req;
      }
    }
  });
  vm.runInContext(slice(storage, 'const APP_INDEXEDDB_DATABASES', 'async function clearAllData()'), context);
  const results = await context.deleteAppIndexedDbDatabases();
  assert.equal([...results], [false, false]);
});

test('deleting a dataset removes its IndexedDB mirror copy', async () => {
  const removed = [];
  const handleDeletes = [];
  const context = vm.createContext({
    console,
    indexedDB: {},
    getIndexedDbMirrorDriver: async () => ({ remove: async key => { removed.push(key); } }),
    openFileHandleDb: async () => ({
      close() {},
      transaction() {
        const tx = {
          objectStore: () => ({ delete: key => { handleDeletes.push(key); Promise.resolve().then(() => tx.oncomplete()); } })
        };
        return tx;
      }
    })
  });
  vm.runInContext(slice(storage, 'async function removeDatasetMirrors(', 'function isLocalFilePayloadCurrent('), context);
  await context.removeDatasetMirrors('cards_old_ab12');
  assert.equal(removed, ['cards_old_ab12']);
  assert.equal(handleDeletes, ['cardspoke_file_handle_cards_old_ab12']);

  const deleteFlow = data.slice(data.indexOf("Delete dataset \"${key}\""));
  const removeIdx = deleteFlow.indexOf('localStorage.removeItem(key);');
  assert.ok(removeIdx > -1);
  assert.ok(deleteFlow.slice(removeIdx, removeIdx + 300).includes('await removeDatasetMirrors(key);'));
});

// ── LOW/MED: revisioned payloads; stale local file never wins ────────────

function persistHarness() {
  const writes = [];
  const context = vm.createContext({
    store: { cards: { a: { title: 'x' } } }, instanceKey: 'dataset-a', navState: {}, navHistory: [],
    saveTimeout: null, savePending: true, saveRevision: 1, saveEpoch: 0, saveWriteQueue: Promise.resolve(),
    lastSaveTime: 0, activeSessionPin: null, storageWriteLock: false,
    window: {}, performance, setTimeout, clearTimeout, console,
    stripLegacyPinMetadata() {}, setDirty() {}, updateSaveStatus() {}, showToast() {},
    getStorageType: () => 'localstorage',
    localStorage: { setItem: (key, value) => writes.push({ key, value }) }
  });
  vm.runInContext(slice(storage, 'async function saveNow()', 'function updateSaveStatus('), context);
  return { context, writes };
}

test('every persisted payload carries a strictly increasing persistedAt revision', async () => {
  const { context, writes } = persistHarness();
  await context.persistStoreNow('dataset-a');
  await context.persistStoreNow('dataset-a');
  const first = JSON.parse(writes[0].value).metadata.persistedAt;
  const second = JSON.parse(writes[1].value).metadata.persistedAt;
  assert.type(first, 'number');
  assert.ok(second > first, 'revision increases even within the same millisecond');
});

function revisionContext() {
  const context = vm.createContext({ console, Number, Object, JSON });
  vm.runInContext(slice(storage, 'function isLocalFilePayloadCurrent(', 'async function load()'), context);
  return context;
}

test('a local file only replaces LocalStorage data when it is at least as new', () => {
  const { isLocalFilePayloadCurrent: current } = revisionContext();
  const at = t => ({ metadata: { persistedAt: t } });
  assert.ok(current(at(200), at(100)), 'newer file wins');
  assert.ok(current(at(100), at(100)), 'equal revision: file wins (same write)');
  assert.not.ok(current(at(99), at(100)), 'stale file loses');
  assert.not.ok(current({ metadata: {} }, at(100)), 'missing revision is older than a present one');
  assert.ok(current(at(5), { metadata: {} }), 'legacy LocalStorage copy without a revision: file wins');
  assert.ok(current({}, {}), 'neither has a revision: legacy behaviour (file wins)');
});

test('the boot path checks the revision before letting the file replace the store', () => {
  const branch = storage.slice(storage.indexOf("if (storageType === 'localfile')"));
  const checkIdx = branch.indexOf('isLocalFilePayloadCurrent(parsedFile, store)');
  const setIdx = branch.indexOf('setStore(');
  assert.ok(checkIdx > -1 && checkIdx < setIdx, 'revision check happens before setStore');
  assert.ok(branch.slice(setIdx, setIdx + 300).includes('gateLocalFilePlugins(parsedFile.plugins, store.plugins)'));
});

test('plugins from a local file cannot enable code LocalStorage did not already run', () => {
  const { gateLocalFilePlugins: gate } = revisionContext();
  const def = { manifest: { id: 'p', name: 'P', version: '1.0.0' }, js: 'ok()' };
  const local = {
    same: { definition: def, enabled: true },
    changed: { definition: def, enabled: true },
    off: { definition: def, enabled: false }
  };
  const file = {
    same: { definition: def, enabled: true },
    changed: { definition: { ...def, js: 'evil()' }, enabled: true },
    off: { definition: def, enabled: true },
    injected: { definition: def, enabled: true },
    userDisabled: { definition: def, enabled: false }
  };
  const result = JSON.parse(JSON.stringify(gate(file, local)));
  assert.is(result.same.enabled, true, 'unchanged, already-enabled plugin keeps running');
  assert.is(result.changed.enabled, false, 'changed code is suspended');
  assert.is(result.off.enabled, false, 'file cannot flip a disabled plugin on');
  assert.is(result.injected.enabled, false, 'new plugin arrives suspended');
  assert.is(result.userDisabled.enabled, false);
  assert.equal(result.changed.definition.js, 'evil()', 'definition kept for review, just not enabled');
});

test.run();
