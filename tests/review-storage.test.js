import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../www/src/storage.js', import.meta.url), 'utf8');

// Execute the actual fused-layer persistence functions with controlled IO.
function harness(overrides = {}) {
  const writes = [];
  const context = vm.createContext({
    store: { cards: {}, metadata: {} }, instanceKey: 'dataset-a', navState: {}, navHistory: [],
    saveTimeout: null, savePending: true, saveRevision: 1, saveEpoch: 0, saveWriteQueue: Promise.resolve(),
    lastSaveTime: 0, activeSessionPin: null, storageWriteLock: false,
    window: {}, performance, setTimeout, clearTimeout, console,
    SAVE_DEBOUNCE_MS: 500, MIN_SAVE_INTERVAL_MS: 100,
    stripLegacyPinMetadata() {}, setDirty() {}, updateSaveStatus() {}, showToast() {},
    getStorageType: () => 'localstorage',
    localStorage: { setItem: (key, value) => writes.push({ key, value }) },
    ...overrides
  });
  vm.runInContext(source.slice(source.indexOf('      async function saveNow()'), source.indexOf('      function updateSaveStatus(')), context);
  return { context, writes };
}
test('encrypted writes remain ordered when an earlier encryption is delayed', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const { context, writes } = harness({ activeSessionPin: 'pin', encryptStorePayload: async payload => { if (++calls === 1) await gate; return payload; } });
  context.store.cards.a = { title: 'first' };
  const first = context.persistStoreNow('dataset-a');
  context.store.cards.a.title = 'second';
  context.saveRevision++;
  const second = context.persistStoreNow('dataset-a');
  release();
  await Promise.all([first, second]);
  assert.is(JSON.parse(writes.at(-1).value).cards.a.title, 'second');
  assert.is(writes.length, 2);
});
test('failed flush rejects to prevent switching away from unsaved data', async () => {
  const { context } = harness({ localStorage: { setItem() { throw new Error('disk full'); } } });
  let rejected = false;
  try { await context.flushPendingSave(); } catch { rejected = true; }
  assert.ok(rejected);
  assert.ok(context.savePending);
});
test('cancelled dataset write cannot resurrect a deleted dataset', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { context, writes } = harness({ activeSessionPin: 'pin', encryptStorePayload: async payload => { await gate; return payload; } });
  const save = context.persistStoreNow('dataset-a');
  context.cancelPendingSave();
  release();
  await save;
  assert.is(writes.length, 0);
});
test('selected local file failure is a failed save, not a false success', async () => {
  const { context } = harness({ getStorageType: () => 'localfile', ensureLocalFileHandle: async () => ({ createWritable: async () => ({ write: async () => { throw new Error('file denied'); }, close: async () => {} }) }) });
  let rejected = false;
  try { await context.persistStoreNow('dataset-a'); } catch { rejected = true; }
  assert.ok(rejected);
  assert.ok(context.savePending);
});
test('IndexedDB put resolves on transaction commit and rejects late abort', async () => {
  const context = vm.createContext({});
  vm.runInContext('class StorageDriver {}\n' + source.slice(source.indexOf('      class IndexedDBDriver'), source.indexOf('      class LocalStorageDriver')) + '\nthis.Driver = IndexedDBDriver;', context);
  const driver = new context.Driver();
  const request = {};
  const transaction = { objectStore: () => ({ put: () => request }) };
  driver.db = { transaction: () => transaction };
  let settled = false;
  const pending = driver.set('a', 'data').then(() => { settled = true; }, () => { settled = true; return 'aborted'; });
  if (request.onsuccess) request.onsuccess();
  await Promise.resolve();
  assert.not.ok(settled);
  transaction.onabort();
  assert.is(await pending, 'aborted');
});
test('CSV export escapes quotes and guards spreadsheet formula-like text', () => {
  const dataSource = readFileSync(new URL('../www/src/data.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({ Blob, store: { cards: { a: { id: 'a', title: '=1+1', body: 'line 1\\nline 2', tags: ['say "hello"'], children: [] } } }, downloadWithFeedback(blob) { this.output = blob; } });
  vm.runInContext(dataSource.slice(dataSource.indexOf('      function csvCell('), dataSource.indexOf('      function handleExport(')), ctx);
  assert.is(ctx.csvCell('say "hello"'), '"say ""hello"""');
  assert.is(ctx.csvCell('=1+1'), '\"\'=1+1\"');
  assert.is(ctx.csvCell('normal'), '"normal"');
});
test.run();
