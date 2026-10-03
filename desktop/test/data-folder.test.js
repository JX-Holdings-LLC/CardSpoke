'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DataFolder, isDatasetKey, keyFromFileName, formatPayloadForDisk,
  loadSettings, saveSettings, defaultDataFolder, TRASH_DIR
} = require('../lib/data-folder');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cardspoke-folder-'));
}

test('only dataset keys the app uses are accepted', () => {
  assert.ok(isDatasetKey('nested_cards_store'));
  assert.ok(isDatasetKey('cards_my_notes_ab12'));
  assert.ok(isDatasetKey('nested_cards_legacy-1'));
  for (const bad of ['', 'cards_', 'other', '../cards_x', 'cards_a/b', 'cards_a.json', 'cards_a b',
    'nested_cards_store.corrupt.x', 'cards_' + 'x'.repeat(200), null, 42]) {
    assert.equal(isDatasetKey(bad), false, String(bad));
  }
  assert.equal(keyFromFileName('cards_a_1.json'), 'cards_a_1');
  assert.equal(keyFromFileName('.cards_a_1.json.123.tmp'), null);
  assert.equal(keyFromFileName('notes.json'), null);
});

test('plaintext payloads are pretty-printed, envelopes and junk kept verbatim', () => {
  assert.equal(formatPayloadForDisk('{"cards":{}}'), '{\n  "cards": {}\n}\n');
  const envelope = '{"encrypted":true,"payload":"abc"}';
  assert.equal(formatPayloadForDisk(envelope), envelope);
  assert.equal(formatPayloadForDisk('not json'), 'not json');
});

test('write, read, readAll and remove (to .trash)', () => {
  const dir = tempDir();
  const folder = new DataFolder(dir);
  assert.deepEqual(folder.ensure(), { available: true });
  folder.write('cards_a_1', '{"cards":{}}');
  folder.write('nested_cards_store', '{"cards":{"x":{}}}');
  fs.writeFileSync(path.join(dir, 'unrelated.json'), '{}');
  assert.deepEqual(folder.readAll().map(d => d.key).sort(), ['cards_a_1', 'nested_cards_store']);
  assert.deepEqual(JSON.parse(folder.read('cards_a_1').text), { cards: {} });
  assert.equal(folder.read('cards_missing_1'), null);

  assert.equal(folder.remove('cards_a_1'), true);
  assert.equal(fs.existsSync(path.join(dir, 'cards_a_1.json')), false);
  const trashed = fs.readdirSync(path.join(dir, TRASH_DIR));
  assert.equal(trashed.length, 1);
  assert.match(trashed[0], /^cards_a_1\..+\.json$/);
  assert.equal(folder.remove('cards_a_1'), false);
  assert.throws(() => folder.write('../escape', '{}'), /Invalid dataset key/);
  assert.equal(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')).length, 0, 'no temp files left');
});

test('a write never overwrites an outside change it has not seen', () => {
  const folder = new DataFolder(tempDir());
  assert.deepEqual(folder.write('cards_a_1', '{"v":1}'), { written: true });
  fs.writeFileSync(folder.pathFor('cards_a_1'), '{"v":"cli"}');
  const refused = folder.write('cards_a_1', '{"v":2}');
  assert.equal(refused.conflict, true);
  assert.equal(refused.text, '{"v":"cli"}');
  assert.equal(fs.readFileSync(folder.pathFor('cards_a_1'), 'utf8'), '{"v":"cli"}');
  // Once the change has been seen, the next write goes through.
  assert.deepEqual(folder.write('cards_a_1', '{"v":3}'), { written: true });
  // A file the process never saw is not overwritten either.
  fs.writeFileSync(path.join(folder.dir, 'cards_new_1.json'), '{}');
  assert.equal(folder.write('cards_new_1', '{"v":1}').conflict, true);
  assert.deepEqual(folder.write('cards_new_2', '{"v":1}', { force: true }), { written: true });
});

test('an unusable folder is reported, not thrown', () => {
  const file = path.join(tempDir(), 'a-file');
  fs.writeFileSync(file, 'x');
  const status = new DataFolder(path.join(file, 'sub')).ensure();
  assert.equal(status.available, false);
  assert.ok(status.error);
});

test('copyFrom copies missing datasets and never overwrites', () => {
  const from = new DataFolder(tempDir());
  const to = new DataFolder(tempDir());
  from.write('cards_a_1', '{"v":"from"}');
  from.write('cards_b_1', '{"v":"from"}');
  to.write('cards_b_1', '{"v":"to"}');
  assert.deepEqual(to.copyFrom(from.dir), ['cards_a_1']);
  assert.equal(JSON.parse(to.read('cards_b_1').text).v, 'to');
  assert.deepEqual(to.copyFrom(to.dir), []);
});

test('watch reports outside changes and deletions, not its own writes', async () => {
  const folder = new DataFolder(tempDir());
  folder.write('cards_a_1', '{"v":1}');
  const events = [];
  folder.watch(change => events.push(change), { debounceMs: 30 });
  const settle = () => new Promise(r => setTimeout(r, 300));
  try {
    folder.write('cards_a_1', '{"v":2}');
    await settle();
    assert.deepEqual(events, [], 'own write is not an outside change');

    fs.writeFileSync(path.join(folder.dir, '.cards_a_1.json.tmp'), '{"v":3}');
    fs.renameSync(path.join(folder.dir, '.cards_a_1.json.tmp'), path.join(folder.dir, 'cards_a_1.json'));
    await settle();
    assert.equal(events.length, 1);
    assert.equal(events[0].key, 'cards_a_1');
    assert.deepEqual(JSON.parse(events[0].text), { v: 3 });

    fs.unlinkSync(path.join(folder.dir, 'cards_a_1.json'));
    await settle();
    assert.deepEqual(events[1], { key: 'cards_a_1', text: null });
  } finally {
    folder.unwatch();
  }
});

test('settings round-trip and reject junk', () => {
  const dir = tempDir();
  assert.deepEqual(loadSettings(dir), {});
  saveSettings(dir, { dataFolder: '/abs/folder', activeDataset: 'cards_a_1' });
  assert.deepEqual(loadSettings(dir), { dataFolder: '/abs/folder', activeDataset: 'cards_a_1' });
  fs.writeFileSync(path.join(dir, 'storage.json'), JSON.stringify({ dataFolder: 'relative', activeDataset: '../x' }));
  assert.deepEqual(loadSettings(dir), {});
  assert.equal(defaultDataFolder('/docs'), path.join('/docs', 'CardSpoke'));
});
