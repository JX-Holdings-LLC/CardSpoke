/**
 * CardSpoke CLI (cli/cardspoke.js).
 *
 * Drives main() in-process against temporary dataset files and checks the
 * on-disk format stays importable by the app (instance backups keep
 * rootIds, raw dataset payloads keep rootOrder).
 */

import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main, parseArgs } from '../cli/cardspoke.js';
import { isEncryptedEnvelope } from '../www/src/core/dataset-crypto.js';

let dir;

async function run(...args) {
  let out = '';
  let err = '';
  const code = await main(['--file', join(dir, 'data.json'), ...args], {
    cwd: dir,
    env: {},
    stdout: s => { out += s; },
    stderr: s => { err += s; }
  });
  return { code, out, err };
}

async function runJson(...args) {
  const r = await run(...args, '--json');
  return { ...r, result: JSON.parse(r.out) };
}

const readData = () => JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8'));

test.before.each(() => { dir = mkdtempSync(join(tmpdir(), 'cardspoke-cli-')); });
test.after.each(() => { rmSync(dir, { recursive: true, force: true }); });

test('parseArgs handles values, booleans, repeats and short aliases', () => {
  const { positionals, flags } = parseArgs(['create', 'A', 'title', '-p', 'root', '--tag', 'x', '--tag=y', '--json', '--no-dry-run']);
  assert.equal(positionals, ['create', 'A', 'title']);
  assert.equal(flags, { parent: 'root', tag: ['x', 'y'], json: true, 'dry-run': false });
});

test('init writes an empty instance backup and refuses to overwrite', async () => {
  assert.is((await run('init')).code, 0);
  const data = readData();
  assert.is(data.exportType, 'instance');
  assert.equal(data.rootIds, []);
  assert.equal(data.cards, {});
  const again = await runJson('init');
  assert.is(again.code, 1);
  assert.is(again.result.error.code, 'exists');
});

test('missing dataset file is a clear error', async () => {
  const r = await runJson('list');
  assert.is(r.code, 1);
  assert.is(r.result.ok, false);
  assert.is(r.result.error.code, 'not_found');
});

test('create, list and show cards by ID or title', async () => {
  await run('init');
  const parent = (await runJson('create', 'Projects', '--tag', 'Work')).result.data;
  const child = (await runJson('create', 'Child', '--parent', 'projects', '--body', 'Hello')).result.data;
  assert.is(child.parentId, parent.id);
  assert.equal(parent.tags, ['work']);

  const data = readData();
  assert.equal(data.rootIds, [parent.id]);
  assert.equal(data.cards[parent.id].children, [child.id]);

  const listed = (await runJson('list', '--parent', parent.id)).result.data.cards;
  assert.is(listed.length, 1);
  assert.is(listed[0].path, 'Projects / Child');

  const shown = (await runJson('show', 'child')).result.data;
  assert.is(shown.body, 'Hello');
  assert.is(shown.id, child.id);
});

test('ambiguous titles report every match', async () => {
  await run('init');
  await run('create', 'Same');
  await run('create', 'Same');
  const r = await runJson('show', 'same');
  assert.is(r.code, 1);
  assert.is(r.result.error.code, 'ambiguous');
  assert.is(r.result.error.details.matches.length, 2);
});

test('update renames and rewrites [[links]], --append extends the body', async () => {
  await run('init');
  const a = (await runJson('create', 'Alpha')).result.data;
  const b = (await runJson('create', 'Beta', '--body', 'see [[alpha]]')).result.data;
  const r = await runJson('update', a.id, '--title', 'Gamma');
  assert.is(r.result.data.rewrittenLinks.length, 1);
  assert.is(readData().cards[b.id].body, 'see [[Gamma]]');
  await run('update', b.id, '--body', 'more', '--append');
  assert.is(readData().cards[b.id].body, 'see [[Gamma]]\n\nmore');
});

test('move reparents and reorders, and refuses cycles', async () => {
  await run('init');
  const a = (await runJson('create', 'A')).result.data;
  const b = (await runJson('create', 'B', '--parent', a.id)).result.data;
  const c = (await runJson('create', 'C')).result.data;
  assert.is((await run('move', c.id, '--parent', a.id, '--index', '0')).code, 0);
  assert.equal(readData().cards[a.id].children, [c.id, b.id]);
  assert.equal(readData().rootIds, [a.id]);
  const bad = await runJson('move', a.id, '--parent', b.id);
  assert.is(bad.code, 1);
  assert.is(bad.result.error.code, 'invalid_move');
  assert.is((await run('move', b.id, '--parent', 'root')).code, 0);
  assert.equal(readData().rootIds, [a.id, b.id]);
});

test('delete removes descendants and stale bookmarks', async () => {
  await run('init');
  const a = (await runJson('create', 'A')).result.data;
  const b = (await runJson('create', 'B', '--parent', a.id)).result.data;
  await run('bookmark', 'add', b.id);
  assert.equal(readData().bookmarks, [b.id]);
  const r = await runJson('delete', a.id);
  assert.is(r.result.data.deleted.length, 2);
  const data = readData();
  assert.equal(data.cards, {});
  assert.equal(data.bookmarks, []);
});

test('duplicate --with-children copies the subtree', async () => {
  await run('init');
  const a = (await runJson('create', 'A')).result.data;
  await run('create', 'B', '--parent', a.id);
  const r = await runJson('duplicate', a.id, '--with-children');
  assert.is(r.result.data.created.length, 2);
  assert.is(readData().cards[r.result.data.id].title, 'A (Copy)');
});

test('tag subcommands and tag counts', async () => {
  await run('init');
  const a = (await runJson('create', 'A')).result.data;
  await run('create', 'B', '--tag', 'x');
  assert.equal((await runJson('tag', 'add', a.id, '#X', 'y')).result.data.tags, ['x', 'y']);
  assert.equal((await runJson('tag', 'remove', a.id, 'y')).result.data.tags, ['x']);
  assert.equal((await runJson('tags')).result.data.tags, [{ tag: 'x', count: 2 }]);
  assert.equal((await runJson('tag', 'set', a.id)).result.data.tags, []);
});

test('search matches titles, bodies and tags', async () => {
  await run('init');
  await run('create', 'Garden plan', '--body', 'tomatoes and basil', '--tag', 'home');
  await run('create', 'Work plan', '--tag', 'work');
  const plans = (await runJson('search', 'plan')).result.data.results;
  assert.is(plans.length, 2);
  const basil = (await runJson('search', 'basil')).result.data.results;
  assert.is(basil.length, 1);
  assert.ok(basil[0].snippet.includes('basil'));
  const tagged = (await runJson('search', 'plan', '--tag', 'work')).result.data.results;
  assert.is(tagged.length, 1);
  assert.is(tagged[0].title, 'Work plan');
});

test('--dry-run leaves the file untouched', async () => {
  await run('init');
  const before = readFileSync(join(dir, 'data.json'), 'utf8');
  const r = await runJson('create', 'Ghost', '--dry-run');
  assert.is(r.result.saved, false);
  assert.is(readFileSync(join(dir, 'data.json'), 'utf8'), before);
});

test('import outline and JSON backups with fresh IDs', async () => {
  await run('init');
  writeFileSync(join(dir, 'outline.txt'), 'Top\n  Middle\n    Leaf\nSecond\n');
  const outline = await runJson('import', 'outline.txt');
  assert.is(outline.result.data.imported, 4);

  const other = {
    exportType: 'instance',
    rootIds: ['r'],
    cards: {
      r: { id: 'r', title: 'Root', parentId: null, children: ['c'], tags: ['Mixed'] },
      c: { id: 'c', title: 'Kid', parentId: 'r', children: [] }
    }
  };
  writeFileSync(join(dir, 'other.json'), JSON.stringify(other));
  const r = await runJson('import', 'other.json', '--parent', 'Top');
  assert.is(r.result.data.imported, 2);
  const data = readData();
  const [rootId] = r.result.data.rootIds;
  assert.not.ok(data.cards.r, 'IDs are remapped');
  assert.is(data.cards[rootId].parentId, data.rootIds[0]);
  assert.equal(data.cards[rootId].tags, ['mixed']);
  assert.is((await run('validate')).code, 0);
});

test('export formats', async () => {
  await run('init');
  const a = (await runJson('create', 'A', '--body', '=SUM(1)')).result.data;
  await run('create', 'B', '--parent', a.id);
  assert.ok((await run('export', '--format', 'md')).out.includes('## B'));
  assert.is((await run('export', '--format', 'outline')).out, 'A\n  B\n');
  assert.ok((await run('export', '--format', 'csv')).out.includes('"\'=SUM(1)"'), 'CSV formula injection guarded');
  const r = await runJson('export', '--format', 'json', '--out', 'copy.json');
  assert.ok(existsSync(r.result.data.file));
  assert.is(JSON.parse(readFileSync(join(dir, 'copy.json'), 'utf8')).rootIds.length, 1);
});

test('validate reports and repairs hierarchy problems', async () => {
  writeFileSync(join(dir, 'data.json'), JSON.stringify({
    rootOrder: ['ghost'],
    cards: {
      a: { id: 'a', title: 'A', parentId: null, children: ['b', 'missing'] },
      b: { id: 'b', title: 'B', parentId: 'nope', children: [] }
    }
  }));
  const report = await runJson('validate');
  assert.is(report.code, 1);
  assert.ok(report.result.data.issues.length >= 3);
  const fixed = await runJson('validate', '--fix');
  assert.equal(fixed.result.data.remaining, []);
  const data = readData();
  assert.ok(Array.isArray(data.rootOrder), 'raw dataset payloads keep rootOrder');
  assert.not.ok(data.rootIds);
  assert.ok(data.metadata.persistedAt > 0, 'persistedAt is bumped for local-file datasets');
  assert.is((await run('validate')).code, 0);
});

test('PIN-encrypted datasets stay encrypted', async () => {
  await run('init', '--pin', '1234');
  assert.ok(isEncryptedEnvelope(readData()));
  const locked = await runJson('list');
  assert.is(locked.result.error.code, 'pin_required');
  const wrong = await runJson('list', '--pin', '9999');
  assert.is(wrong.result.error.code, 'pin_invalid');
  assert.is((await run('create', 'Secret', '--pin', '1234')).code, 0);
  assert.ok(isEncryptedEnvelope(readData()));
  assert.not.ok(readFileSync(join(dir, 'data.json'), 'utf8').includes('Secret'));
  const listed = (await runJson('list', '--pin', '1234')).result.data.cards;
  assert.is(listed[0].title, 'Secret');
});

test('commands --json describes every command', async () => {
  const r = await runJson('commands');
  const names = r.result.data.commands.map(c => c.name);
  for (const n of ['create', 'update', 'delete', 'move', 'search', 'export', 'import']) assert.ok(names.includes(n), n);
});

test('unknown command exits with usage code 2', async () => {
  const r = await run('frobnicate');
  assert.is(r.code, 2);
  assert.ok(r.err.includes('Unknown command'));
});

test.run();
