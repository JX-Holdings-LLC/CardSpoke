/**
 * Desktop data folder sync (www/src/storage.js "DESKTOP DATA FOLDER").
 *
 * Runs the real block in a VM with a fake LocalStorage and a fake
 * window.cardspokeDesktop.storage bridge, so boot hydration, saves and
 * outside changes are checked against the code that ships.
 */

import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../www/src/storage.js', import.meta.url), 'utf8');
const START = '      // --- DESKTOP DATA FOLDER ---';
const END = '      // --- DATASET ENCRYPTION SESSION STATE';
const block = source.slice(source.indexOf(START), source.indexOf(END));

function fakeLocalStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    keys: () => Array.from(data.keys())
  };
}

function fakeBridge(files = {}, { available = true, folder = '/data' } = {}) {
  const state = { files: new Map(Object.entries(files)), writes: [], removed: [], active: [], failWrites: false };
  state.api = {
    readAll: async () => ({
      available, folder, canChange: true,
      datasets: Array.from(state.files, ([key, text]) => ({ key, text }))
    }),
    write: async (key, text) => {
      if (state.failWrites) throw new Error('disk offline');
      if (state.conflictText !== undefined) {
        const text2 = state.conflictText;
        state.conflictText = undefined;
        return { written: false, conflict: true, text: text2 };
      }
      state.files.set(key, text);
      state.writes.push(key);
      return { written: true };
    },
    remove: async key => { state.files.delete(key); state.removed.push(key); return true; },
    setActive: async key => { state.active.push(key); },
    onChange: cb => { state.emit = cb; },
    onChangeFolderRequest: () => {}
  };
  return state;
}

function harness({ local = {}, files = {}, bridge: bridgeOpts, active = 'nested_cards_store', overrides = {} } = {}) {
  const localStorage = fakeLocalStorage(local);
  const bridge = fakeBridge(files, bridgeOpts);
  const calls = { load: 0, save: [], toasts: [], dialogs: 0, cancel: 0 };
  const context = vm.createContext({
    window: { cardspokeDesktop: { storage: bridge.api } },
    localStorage,
    instanceKey: active,
    savePending: false,
    storageWriteLock: false,
    console: { error() {}, warn() {}, log() {} },
    setTimeout, Date, Math, JSON, Promise, Map, Array, String,
    getAllDatasetKeys: () => localStorage.keys().filter(k =>
      (k === 'nested_cards_store' || k.startsWith('nested_cards_') || k.startsWith('cards_')) && !k.includes('.corrupt.')),
    showToast: (msg, type) => calls.toasts.push({ msg, type }),
    showChoiceDialog: async () => { calls.dialogs++; return context.dialogAnswer; },
    save: (immediate) => calls.save.push(immediate),
    cancelPendingSave: () => { calls.cancel++; },
    flushPendingSave: async () => {},
    load: async () => { calls.load++; },
    render: () => {},
    location: { reload() {} },
    ...overrides
  });
  context.setInstanceKey = k => { context.instanceKey = k; };
  vm.runInContext(block + `
    this.api = {
      hydrate: hydrateFromDesktopFolder,
      write: writeDatasetToDesktopFolder,
      remove: removeDatasetFromDesktopFolder,
      queue: queueDesktopDatasetChange,
      folder: () => getDesktopDataFolder(),
      idle: () => desktopChangeRunner || Promise.resolve()
    };`, context);
  return { context, api: context.api, localStorage, bridge, calls };
}

const store = (title) => JSON.stringify({ cards: { a: { id: 'a', title } }, rootOrder: ['a'] });

test('no desktop bridge: nothing happens', async () => {
  const h = harness();
  h.context.window = {};
  await h.api.hydrate();
  assert.is(h.api.folder(), null);
});

test('first launch copies existing datasets into the folder', async () => {
  const h = harness({ local: { nested_cards_store: store('Local'), cards_work_ab12: store('Work'), cardspoke_theme: 'dark' } });
  await h.api.hydrate();
  assert.equal(h.bridge.writes.sort(), ['cards_work_ab12', 'nested_cards_store']);
  assert.is(h.localStorage.getItem('cardspoke_desktop_data_folder'), '/data');
  assert.ok(h.api.folder(), 'folder is active');
  assert.not.ok(h.bridge.files.has('cardspoke_theme'), 'preferences stay out of the folder');
});

test('first launch keeps a conflicting local copy under a new key', async () => {
  const h = harness({
    local: { nested_cards_store: store('Local') },
    files: { nested_cards_store: JSON.stringify(JSON.parse(store('Folder')), null, 2) }
  });
  await h.api.hydrate();
  const copies = Array.from(h.bridge.files.keys()).filter(k => k.startsWith('nested_cards_store_local_'));
  assert.is(copies.length, 1);
  assert.is(JSON.parse(h.bridge.files.get(copies[0])).cards.a.title, 'Local');
  assert.is(JSON.parse(h.localStorage.getItem('nested_cards_store')).cards.a.title, 'Folder', 'folder wins the key');
});

test('later launches: the folder is the source of truth', async () => {
  const h = harness({
    local: { cardspoke_desktop_data_folder: '/data', nested_cards_store: store('Old'), cards_gone_ab12: store('Gone') },
    files: { nested_cards_store: store('New'), cards_added_cd34: store('Added') }
  });
  await h.api.hydrate();
  assert.is(h.bridge.writes.length, 0);
  assert.is(JSON.parse(h.localStorage.getItem('nested_cards_store')).cards.a.title, 'New');
  assert.ok(h.localStorage.getItem('cards_added_cd34'));
  assert.is(h.localStorage.getItem('cards_gone_ab12'), null, 'deleted from the folder → gone from the app');
});

test('edits made while the folder was offline are pushed first', async () => {
  const h = harness({
    local: {
      cardspoke_desktop_data_folder: '/data',
      cardspoke_desktop_unsynced: JSON.stringify(['nested_cards_store']),
      nested_cards_store: store('Offline edit')
    },
    files: { nested_cards_store: store('Stale') }
  });
  await h.api.hydrate();
  assert.equal(h.bridge.writes, ['nested_cards_store']);
  assert.is(JSON.parse(h.localStorage.getItem('nested_cards_store')).cards.a.title, 'Offline edit');
  assert.is(h.localStorage.getItem('cardspoke_desktop_unsynced'), null);
});

test('an unavailable folder leaves the cache alone', async () => {
  const h = harness({ local: { cardspoke_desktop_data_folder: '/data', nested_cards_store: store('Cached') }, bridge: { available: false } });
  await h.api.hydrate();
  assert.is(h.api.folder(), null);
  assert.ok(h.localStorage.getItem('nested_cards_store'));
  assert.ok(h.calls.toasts.some(t => t.type === 'warning'));
});

test('a missing active dataset switches to one that exists', async () => {
  const h = harness({ local: { cardspoke_desktop_data_folder: '/data' }, files: { cards_only_ab12: store('Only') }, active: 'cards_deleted_zz99' });
  await h.api.hydrate();
  assert.is(h.context.instanceKey, 'cards_only_ab12');
  assert.is(h.localStorage.getItem('activeInstance'), 'cards_only_ab12');
});

test('a failed folder write is a warning and is retried later, never a throw', async () => {
  const h = harness({ local: { cardspoke_desktop_data_folder: '/data' } });
  await h.api.hydrate();
  h.bridge.failWrites = true;
  await h.api.write('nested_cards_store', store('x'));
  assert.equal(JSON.parse(h.localStorage.getItem('cardspoke_desktop_unsynced')), ['nested_cards_store']);
  assert.ok(h.calls.toasts.some(t => t.type === 'warning'));
  h.bridge.failWrites = false;
  await h.api.write('nested_cards_store', store('y'));
  assert.is(h.localStorage.getItem('cardspoke_desktop_unsynced'), null);
  assert.equal(h.bridge.active, ['nested_cards_store'], 'reports the open dataset for the CLI');
});

test('outside change to another dataset updates the cache only', async () => {
  const h = harness({ local: { cardspoke_desktop_data_folder: '/data' }, files: { nested_cards_store: store('A'), cards_b_ab12: store('B') } });
  await h.api.hydrate();
  h.bridge.emit({ key: 'cards_b_ab12', text: store('B2') });
  await h.api.idle();
  assert.is(JSON.parse(h.localStorage.getItem('cards_b_ab12')).cards.a.title, 'B2');
  assert.is(h.calls.load, 0);
  h.bridge.emit({ key: 'cards_b_ab12', text: null });
  await h.api.idle();
  assert.is(h.localStorage.getItem('cards_b_ab12'), null);
});

test('outside change to the open dataset reloads it', async () => {
  const h = harness({ local: { cardspoke_desktop_data_folder: '/data' }, files: { nested_cards_store: store('A') } });
  await h.api.hydrate();
  h.bridge.emit({ key: 'nested_cards_store', text: JSON.stringify(JSON.parse(store('A')), null, 2) });
  await h.api.idle();
  assert.is(h.calls.load, 0, 'same content (just reformatted) is not a change');
  h.bridge.emit({ key: 'nested_cards_store', text: store('From CLI') });
  await h.api.idle();
  assert.is(h.calls.load, 1);
  assert.is(JSON.parse(h.localStorage.getItem('nested_cards_store')).cards.a.title, 'From CLI');
});

test('unsaved edits: the user chooses between their version and the file', async () => {
  const h = harness({ local: { cardspoke_desktop_data_folder: '/data' }, files: { nested_cards_store: store('A') } });
  await h.api.hydrate();
  h.context.savePending = true;

  h.context.dialogAnswer = 'keep';
  h.bridge.emit({ key: 'nested_cards_store', text: store('File 1') });
  await h.api.idle();
  assert.is(h.calls.dialogs, 1);
  assert.is(h.calls.load, 0);
  assert.equal(h.calls.save, [true], 'keeping mine writes it back over the file');

  h.context.dialogAnswer = 'reload';
  h.bridge.emit({ key: 'nested_cards_store', text: store('File 2') });
  await h.api.idle();
  assert.is(h.calls.cancel, 1);
  assert.is(h.calls.load, 1);
});

test('a refused save (file changed since last seen) asks even without pending edits', async () => {
  const h = harness({ local: { cardspoke_desktop_data_folder: '/data' }, files: { nested_cards_store: store('A') } });
  await h.api.hydrate();
  h.bridge.conflictText = store('From CLI');
  h.context.dialogAnswer = 'reload';
  const result = await h.api.write('nested_cards_store', store('App edit'));
  assert.ok(result.conflict, 'reported to persistStoreNow so it does not show Saved');
  await h.api.idle();
  assert.is(h.calls.dialogs, 1);
  assert.is(h.calls.load, 1);
  assert.is(JSON.parse(h.localStorage.getItem('nested_cards_store')).cards.a.title, 'From CLI');
});

test('switching to a new folder keeps edits that never reached the old one', async () => {
  const h = harness({
    local: {
      cardspoke_desktop_data_folder: '/old',
      cardspoke_desktop_unsynced: JSON.stringify(['nested_cards_store', 'cards_x_ab12']),
      nested_cards_store: store('Unsynced'),
      cards_x_ab12: store('Only here')
    },
    files: { nested_cards_store: store('In new folder') },
    bridge: { folder: '/new' }
  });
  await h.api.hydrate();
  assert.ok(h.bridge.files.has('cards_x_ab12'), 'missing dataset copied into the new folder');
  assert.is(JSON.parse(h.bridge.files.get('nested_cards_store')).cards.a.title, 'In new folder', 'new folder file is kept');
  assert.ok(Array.from(h.bridge.files.keys()).some(k => k.startsWith('nested_cards_store_local_')), 'unsynced edit kept beside it');
});

test('deleting the open dataset\'s file saves it again', async () => {
  const h = harness({ local: { cardspoke_desktop_data_folder: '/data' }, files: { nested_cards_store: store('A') } });
  await h.api.hydrate();
  h.bridge.emit({ key: 'nested_cards_store', text: null });
  await h.api.idle();
  assert.equal(h.calls.save, [true]);
  assert.ok(h.localStorage.getItem('nested_cards_store'), 'open dataset is kept');
});

test('saves write the file after LocalStorage', () => {
  const persist = source.slice(source.indexOf('      async function persistStoreNow('), source.indexOf('      function isQuotaError('));
  const local = persist.indexOf('localStorage.setItem(key, finalPayload)');
  const folder = persist.indexOf('writeDatasetToDesktopFolder(key, finalPayload)');
  assert.ok(local > -1 && folder > local);
});

test('boot syncs the folder before the first load()', () => {
  const systems = readFileSync(new URL('../www/src/systems.js', import.meta.url), 'utf8');
  const hydrate = systems.indexOf('await hydrateFromDesktopFolder()');
  assert.ok(hydrate > -1 && hydrate < systems.indexOf('await load();'));
});

test.run();
