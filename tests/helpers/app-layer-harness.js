/**
 * App-layer harness: executes the REAL fused-scope source of the Shell
 * (data.js CRUD wrappers, systems.js undo/redo + tag manager, storage.js
 * helpers) inside a vm context, wired to a real Kernel instance. Only the
 * UI/IO edges (save, render, toasts, dialogs, downloads) are stubbed, so the
 * tests exercise the same code that ships in www/app.js.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  Kernel, cloneCard, normalizeCardName, parseCardLinks, hasCardLink, normalizeTag
} from '../../www/src/kernel.js';
import { migrateCard } from '../../www/src/core/migrations.js';
import {
  encryptStorePayload, decryptStorePayload, isEncryptedEnvelope
} from '../../www/src/core/dataset-crypto.js';

const read = rel => readFileSync(new URL('../../www/src/' + rel, import.meta.url), 'utf8');
export const sources = {
  data: read('data.js'),
  systems: read('systems.js'),
  storage: read('storage.js')
};

/** Slice `source` from the line containing startMarker up to the line containing endMarker. */
export function slice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error('harness: start marker not found: ' + startMarker);
  const lineStart = source.lastIndexOf('\n', start) + 1;
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error('harness: end marker not found: ' + endMarker);
  const lineEnd = source.lastIndexOf('\n', end) + 1;
  return source.slice(lineStart, lineEnd);
}

/**
 * Build a context holding a store, the undo system, the CRUD wrappers and
 * (optionally) the import/export and tag-manager code.
 * @param {Object} [opts]
 * @param {Object} [opts.cards] - Initial cards { id: card }
 * @param {string[]} [opts.rootOrder]
 * @param {Object} [opts.overrides] - Extra context globals (dialogs, pin…)
 */
export function createAppLayer(opts = {}) {
  const calls = { saves: 0, toasts: [], hooks: [], downloads: [] };
  const store = {
    cards: JSON.parse(JSON.stringify(opts.cards || {})),
    rootOrder: (opts.rootOrder || []).slice(),
    plugins: {},
    bookmarks: [],
    recentCards: [],
    metadata: {}
  };
  const context = vm.createContext({
    console, Blob,
    store,
    undoStack: [],
    redoStack: [],
    trashBin: [],
    MAX_UNDO_STACK: 50,
    MAX_TRASH_SIZE: 100,
    APP_VERSION: 'test',
    SCHEMA_VERSION: 4,
    cloneCard,
    kernelCloneCard: cloneCard,
    normalizeCardName,
    parseCardLinks,
    hasCardLink,
    normalizeTag,
    coreMigrateCard: migrateCard,
    encryptStorePayload,
    decryptStorePayload,
    isEncryptedEnvelope,
    uid: () => 'id' + Math.random().toString(36).slice(2),
    save: () => { calls.saves++; },
    render: () => {},
    showToast: (msg, type) => { calls.toasts.push({ msg, type }); },
    getSessionPin: () => null,
    window: {
      CardSpoke: {
        Middleware: { run: (op, args) => { calls.hooks.push({ op, id: args[0] }); return Promise.resolve(); } },
        Plugin: { notifyDataUpdate: () => {} }
      }
    },
    ...(opts.overrides || {})
  });
  context._kernel = new Kernel({ cards: store.cards, rootOrder: store.rootOrder });

  const { data, systems, storage } = sources;
  vm.runInContext(slice(data, 'function _syncKernelToStore()', '// --- DATA (CRUD)'), context);
  vm.runInContext(slice(data, 'function createCard(', 'function getStorageTypeLabel('), context);
  vm.runInContext(slice(systems, 'function pushUndo(action, data)', 'function showTrashBin()'), context);
  vm.runInContext(slice(systems, 'function renameTag(oldTag, newTag)', 'function showTagManager()'), context);
  vm.runInContext(slice(storage, 'function validateStoreConsistency()', 'function migrateTypedCards()'), context);
  vm.runInContext(slice(data, 'function buildInstanceExport()', 'function importTXT('), context);
  // Replace the DOM download with a recorder (declared after the slice).
  context.downloadWithFeedback = (content, filename, format) => {
    calls.downloads.push({ content, filename, format });
  };
  return { context, calls, get store() { return context.store; } };
}

/** Copy a (possibly cross-realm) value into plain main-realm JSON data. */
export function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Read a recorded download's text (Blob or string). */
export async function downloadText(download) {
  return typeof download.content === 'string' ? download.content : download.content.text();
}
