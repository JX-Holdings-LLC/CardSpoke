/**
 * Data-integrity audit regressions (2026-09 audit).
 *
 * Runs the real Shell source (data.js wrappers, systems.js undo/redo and tag
 * manager) against a real Kernel via tests/helpers/app-layer-harness.js:
 *   #375  renaming a card rewrites [[Old Title]] links (one undo step)
 *   #372  PIN-protected exports: encrypted JSON option, plaintext confirm,
 *         encrypted-backup import
 *   HIGH  import is undoable as one step (createCard entries in the group)
 *   HIGH  updateCard undo/redo restores content only, not hierarchy
 *   SEC   imported plugins never auto-enable
 *   MED   tag normalization + case-insensitive Tag Manager
 *   MED   trash restore orphan fallback; permanent delete purges undo
 *   MED   Kernel.updateCard ignores structural fields; moves use reparent
 *   #11   UI edits fire plugin card.create / card.update hooks
 */

import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync } from 'node:fs';
import { createAppLayer, plain, downloadText } from './helpers/app-layer-harness.js';
import { Kernel, replaceCardLinks, normalizeTag } from '../www/src/kernel.js';
import { migrateCard } from '../www/src/core/migrations.js';
import {
  encryptStorePayload, decryptStorePayload, isEncryptedEnvelope
} from '../www/src/core/dataset-crypto.js';

const card = (id, title, body = '', extra = {}) => ({
  id, title, body, parentId: null, children: [], tags: [], modsData: {}, createdAt: 1, updatedAt: 1, ...extra
});

function linkedLayer() {
  return createAppLayer({
    cards: {
      a: card('a', 'Alpha', 'I am alpha. Self: [[Alpha]]'),
      b: card('b', 'Bravo', 'See [[Alpha]], [[ alpha ]] and [[Charlie]].'),
      c: card('c', 'Charlie', 'Only [[ALPHA]] here'),
      d: card('d', 'Delta', 'No links, just Alpha text')
    },
    rootOrder: ['a', 'b', 'c', 'd']
  });
}

// ── #375: rename rewrites links ───────────────────────────────────────────

test('#375 replaceCardLinks rewrites normalized matches only', () => {
  const r = replaceCardLinks('x [[Alpha]] y [[ alpha  ]] z [[Alphabet]] [[Beta]]', 'Alpha', 'Omega');
  assert.is(r.text, 'x [[Omega]] y [[Omega]] z [[Alphabet]] [[Beta]]');
  assert.is(r.count, 2);
  assert.is(replaceCardLinks('[[Alpha]]', 'Alpha', 'Bad]]name').count, 0, 'names that cannot be a link are refused');
  assert.is(replaceCardLinks('[[Alpha|label]]', 'Alpha', 'Omega').count, 0, 'no alias syntax exists, so nothing else is touched');
});

test('#375 renaming a card rewrites [[Old Title]] links in other cards', () => {
  const { context, store } = linkedLayer();
  context.updateCard('a', { title: 'Omega' });
  assert.is(store.cards.a.title, 'Omega');
  assert.is(store.cards.a.body, 'I am alpha. Self: [[Omega]]');
  assert.is(store.cards.b.body, 'See [[Omega]], [[Omega]] and [[Charlie]].');
  assert.is(store.cards.c.body, 'Only [[Omega]] here');
  assert.is(store.cards.d.body, 'No links, just Alpha text', 'plain text is not a link');
  assert.is(context._kernel.findCardByName('Omega'), 'a', 'links now resolve to the renamed card');
});

test('#375 a single Undo reverts the rename and every link rewrite', () => {
  const { context, store } = linkedLayer();
  context.updateCard('a', { title: 'Omega' });
  assert.is(context.undoStack.length, 1, 'one grouped undo entry');
  assert.is(context.undoStack[0].action, 'undoGroup');
  assert.ok(context.undo());
  assert.is(store.cards.a.title, 'Alpha');
  assert.is(store.cards.a.body, 'I am alpha. Self: [[Alpha]]');
  assert.is(store.cards.b.body, 'See [[Alpha]], [[ alpha ]] and [[Charlie]].');
  assert.is(store.cards.c.body, 'Only [[ALPHA]] here');
  assert.ok(context.redo());
  assert.is(store.cards.a.title, 'Omega');
  assert.is(store.cards.b.body, 'See [[Omega]], [[Omega]] and [[Charlie]].');
});

test('#375 links are left alone when the old title was not unique', () => {
  const { context, store } = createAppLayer({
    cards: {
      a: card('a', 'Alpha'),
      a2: card('a2', 'alpha'),
      b: card('b', 'Bravo', 'See [[Alpha]]')
    },
    rootOrder: ['a', 'a2', 'b']
  });
  context.updateCard('a', { title: 'Omega' });
  assert.is(store.cards.b.body, 'See [[Alpha]]', 'the link may mean the other "alpha" card');
  assert.is(context.undoStack.length, 1);
  assert.is(context.undoStack[0].action, 'updateCard', 'no group for a plain update');
});

test('#375 case-only renames and non-title updates do not rewrite', () => {
  const { context, store } = linkedLayer();
  context.updateCard('a', { title: 'ALPHA' });
  assert.is(store.cards.b.body, 'See [[Alpha]], [[ alpha ]] and [[Charlie]].');
  context.updateCard('a', { body: 'new body' });
  assert.is(store.cards.c.body, 'Only [[ALPHA]] here');
});

test('#375 plugin hooks fire for cards whose links were rewritten', () => {
  const { context, calls } = linkedLayer();
  context.updateCard('a', { title: 'Omega' });
  const updated = calls.hooks.filter(h => h.op === 'card.update').map(h => h.id).sort();
  assert.equal(updated, ['a', 'b', 'c']);
});

// ── #4: import undo + content-only updateCard undo ────────────────────────

test('import is undone as one step and only removes the imported cards', async () => {
  const { context, store } = createAppLayer({
    cards: { keep: card('keep', 'Existing') },
    rootOrder: ['keep']
  });
  context.updateCard('keep', { body: 'edited before import' });
  const pkg = {
    exportType: 'instance',
    cards: {
      p: card('p', 'Imported Parent', '', { children: ['c'] }),
      c: card('c', 'Imported Child', '', { parentId: 'p' })
    },
    rootIds: ['p']
  };
  assert.ok(await context.importJSON(pkg));
  assert.is(Object.keys(store.cards).length, 3);
  const top = context.undoStack[context.undoStack.length - 1];
  assert.is(top.action, 'undoGroup');
  assert.equal(plain(top.data.actions.map(a => a.action)), ['createCard', 'createCard']);
  const [first, second] = top.data.actions.map(a => store.cards[a.data.cardId]);
  assert.is(first.title, 'Imported Parent', 'parents are recorded before children');
  assert.is(second.title, 'Imported Child');

  assert.ok(context.undo());
  assert.equal(plain(Object.keys(store.cards)), ['keep'], 'only the imported cards are removed');
  assert.equal(plain(store.rootOrder), ['keep']);
  assert.is(store.cards.keep.body, 'edited before import', 'the earlier edit is NOT the one undone');

  assert.ok(context.redo());
  assert.is(Object.keys(store.cards).length, 3);
  const parentId = Object.keys(store.cards).find(id => store.cards[id].title === 'Imported Parent');
  const childId = Object.keys(store.cards).find(id => store.cards[id].title === 'Imported Child');
  assert.equal(plain(store.cards[parentId].children), [childId]);
  assert.is(store.cards[childId].parentId, parentId);
});

test('import never grafts onto existing cards through unmapped ids', async () => {
  const { context, store } = createAppLayer({
    cards: { victim: card('victim', 'Existing child', '', { parentId: 'owner' }), owner: card('owner', 'Owner', '', { children: ['victim'] }) },
    rootOrder: ['owner']
  });
  await context.importJSON({
    exportType: 'instance',
    cards: { x: card('x', 'Imported', '', { parentId: 'owner', children: ['victim'] }) },
    rootIds: ['x', 'victim']
  });
  assert.is(store.cards.victim.parentId, 'owner', 'existing card was not reparented to root');
  assert.equal(plain(store.cards.owner.children), ['victim'], 'imported card not attached under an existing card');
  const imported = Object.values(store.cards).find(c => c.title === 'Imported');
  assert.is(imported.parentId, null);
  assert.equal(plain(imported.children), []);
});

test('updateCard undo restores content fields only — never children/parentId', () => {
  const { context, store } = createAppLayer({
    cards: { x: card('x', 'Before', 'body') },
    rootOrder: ['x']
  });
  context.updateCard('x', { title: 'After', color: 'red' });
  // A structural change that is not on the undo stack (e.g. a trash
  // restore re-attaching a child) happens after the edit.
  store.cards.kid = card('kid', 'Kid', '', { parentId: 'x' });
  store.cards.x.children.push('kid');
  assert.ok(context.undo());
  assert.is(store.cards.x.title, 'Before');
  assert.not.ok('color' in store.cards.x, 'fields the edit introduced are removed');
  assert.equal(plain(store.cards.x.children), ['kid'], 'children snapshot was not replayed');
  assert.ok(context.redo());
  assert.is(store.cards.x.title, 'After');
  assert.is(store.cards.x.color, 'red');
  assert.equal(plain(store.cards.x.children), ['kid']);
});

test('undo of an updateCard for a card that no longer exists does not throw', () => {
  const { context, store } = createAppLayer({ cards: { x: card('x', 'X') }, rootOrder: ['x'] });
  context.updateCard('x', { title: 'Y' });
  delete store.cards.x;
  assert.ok(context.undo(), 'undo succeeds instead of failing with a TypeError');
});

// ── #5: imported plugins never auto-enable ────────────────────────────────

test('imported plugins are restored disabled even if the backup says enabled', async () => {
  const { context, store } = createAppLayer({
    overrides: { showConfirmDialog: async () => true }
  });
  await context.importJSON({
    exportType: 'instance',
    cards: {},
    plugins: {
      evil: { definition: { manifest: { id: 'evil', name: 'Evil', version: '1.0.0' }, js: 'steal()' }, enabled: true },
      legacy: { js: 'x()', meta: { name: 'Legacy' }, enabled: true }
    }
  });
  assert.is(store.plugins.evil.enabled, false);
  assert.is(store.plugins.legacy.enabled, false);
});

// ── #8: Kernel.updateCard ignores structural fields; moves use reparent ──

test('Kernel.updateCard strips id/parentId/children/createdAt', () => {
  const k = new Kernel({
    cards: { p: card('p', 'P', '', { children: ['x'] }), x: card('x', 'X', '', { parentId: 'p' }), y: card('y', 'Y') },
    rootOrder: ['p', 'y']
  });
  const { card: updated } = k.updateCard('x', {
    id: 'hijack', parentId: 'y', children: ['p'], createdAt: 999, title: 'X2',
    ['__proto__']: { polluted: true }
  });
  assert.is(updated.id, 'x');
  assert.is(updated.parentId, 'p');
  assert.equal(updated.children, []);
  assert.is(updated.createdAt, 1);
  assert.is(updated.title, 'X2');
  assert.equal(k.getCard('y').children, [], 'no half-applied move');
  assert.is(({}).polluted, undefined);
});

test('a card parked at root with a missing parent is not listed twice after reparent/delete', () => {
  // C was restored from Trash while its parent P is still trashed: it sits in
  // rootOrder but keeps parentId 'p' so restoring P can re-adopt it.
  const k = new Kernel({
    cards: { q: card('q', 'Q'), c: card('c', 'C', '', { parentId: 'p' }), d: card('d', 'D', '', { parentId: 'p' }) },
    rootOrder: ['q', 'c', 'd']
  });
  const r = k.reparent('c', 'q');
  assert.ok(r.success);
  assert.equal(k.rootOrder, ['q', 'd'], 'c left root when moved under q');
  assert.equal(k.getCard('q').children, ['c']);
  k.deleteCard('d');
  assert.equal(k.rootOrder, ['q'], 'deleted orphan does not leave a dangling root id');
});

test('moveCard reparents through the kernel with an undoable entry', () => {
  const { context, store } = createAppLayer({
    cards: { p: card('p', 'P'), x: card('x', 'X', '', { children: ['kid'] }), kid: card('kid', 'Kid', '', { parentId: 'x' }) },
    rootOrder: ['p', 'x']
  });
  assert.ok(context.moveCard('x', 'p'));
  assert.is(store.cards.x.parentId, 'p');
  assert.equal(plain(store.cards.p.children), ['x']);
  assert.not.ok(store.rootOrder.includes('x'));
  assert.not.ok(context.moveCard('p', 'kid'), 'cannot move into own subtree');
  assert.ok(context.undo());
  assert.is(store.cards.x.parentId, null);
  assert.ok(store.rootOrder.includes('x'));
  assert.equal(plain(store.cards.p.children), []);
});

test('the edit form moves via moveCard and fires plugin hooks (#11)', () => {
  const rendering = readFileSync(new URL('../www/src/rendering.js', import.meta.url), 'utf8');
  const form = rendering.slice(rendering.indexOf('function renderEditCard()'), rendering.indexOf('const formGroup1'));
  assert.ok(form.includes('moveCard(card.id, parentVal, true)'), 'edit-form moves go through moveCard');
  assert.not.ok(form.includes('card.parentId = parentVal'), 'no direct parentId mutation');
  assert.ok(form.includes("isRichText: richToggle.checked }, true, false)"), 'UI edits fire card.update hooks');
  assert.ok(form.includes("runCardHooks('card.create', newId)"), 'UI creations fire card.create hooks');
  assert.ok(form.includes("startUndoGroup('edit card')"), 'one Undo reverts a whole edit-form save');
});

// ── #6: tag normalization and case-insensitive Tag Manager ───────────────

test('migrateCard normalizes tags (case, #, whitespace, dupes, non-strings)', () => {
  const c = { id: 'x', tags: ['Work', '#work', ' Home ', '', null, 42, { bad: 1 }, 'HOME'], children: [], modsData: {} };
  const result = migrateCard(c);
  assert.ok(result.changed);
  assert.equal(c.tags, ['work', 'home', '42']);
  assert.not.ok(migrateCard(c).changed, 'idempotent');
});

test('Tag Manager rename/merge/delete match tags case-insensitively', () => {
  const { context, store } = createAppLayer({
    cards: {
      a: card('a', 'A', '', { tags: ['Work', 'x'] }),
      b: card('b', 'B', '', { tags: ['work'] }),
      c: card('c', 'C', '', { tags: ['#WORK', 'Other'] })
    },
    rootOrder: ['a', 'b', 'c']
  });
  const stats = plain(context.getTagStats());
  assert.equal(stats.find(s => s.tag === 'work'), { tag: 'work', count: 3 }, 'variants grouped');
  assert.is(context.renameTag('work', 'Job'), 3);
  assert.equal(plain(store.cards.a.tags), ['job', 'x']);
  assert.equal(plain(store.cards.c.tags), ['job', 'Other']);
  assert.is(context.mergeTags('OTHER', 'x'), 1);
  assert.equal(plain(store.cards.c.tags), ['job', 'x']);
  assert.is(context.deleteTagGlobal('JOB'), 3);
  assert.ok(Object.values(store.cards).every(c => !c.tags.includes('job')));
});

test('kernel tag ops tolerate non-string tags instead of throwing', () => {
  const k = new Kernel({ cards: { a: card('a', 'A', '', { tags: [7, null, 'Mixed'] }) }, rootOrder: ['a'] });
  assert.ok(k.addTag('a', 12));
  assert.not.ok(k.addTag('a', 'MIXED'), 'case-insensitive duplicate');
  assert.not.ok(k.addTag('a', null));
  assert.ok(k.removeTag('a', '7'));
  assert.ok(k.setTags('a', ['#A', 'a', 5, undefined]));
  assert.equal(k.getTags('a'), ['a', '5']);
  assert.is(normalizeTag(' #Foo '), 'foo');
});

// ── #7: trash restore fallback and permanent-delete purge ─────────────────

test('restoring a child whose parent is still trashed parks it at root; parent restore re-adopts it', () => {
  const { context, store } = createAppLayer({
    cards: { p: card('p', 'P', '', { children: ['c'] }), c: card('c', 'C', '', { parentId: 'p' }) },
    rootOrder: ['p']
  });
  context.deleteCard('p');
  assert.equal(plain(Object.keys(store.cards)), []);
  const childItem = context.trashBin.find(t => t.card.id === 'c');
  context.restoreCardIntoTree(childItem.card);
  assert.ok(store.cards.c, 'child restored');
  assert.ok(store.rootOrder.includes('c'), 'reachable at root, not an invisible orphan');
  assert.not.ok(context.trashBin.some(t => t.card.id === 'c'));

  const parentItem = context.trashBin.find(t => t.card.id === 'p');
  context.restoreCardIntoTree(parentItem.card);
  assert.equal(plain(store.rootOrder), ['p'], 'child re-adopted: no longer listed at root');
  assert.equal(plain(store.cards.p.children), ['c']);
});

test('the Trash Bin restore button uses the shared restore path', () => {
  const systems = readFileSync(new URL('../www/src/systems.js', import.meta.url), 'utf8');
  const trash = systems.slice(systems.indexOf('function showTrashBin()'), systems.indexOf('function renameTag('));
  assert.ok(trash.includes('restoreCardIntoTree(item.card)'));
  assert.ok(trash.includes('purgeUndoEntriesForCards([item.card.id])'), 'permanent delete purges undo');
  assert.ok(trash.includes('purgeUndoEntriesForCards(trashBin.map('), 'empty trash purges undo');
});

test('permanently deleted cards cannot be resurrected by Undo', () => {
  const { context, store } = createAppLayer({
    cards: { p: card('p', 'P', '', { children: ['c'] }), c: card('c', 'C', '', { parentId: 'p' }), z: card('z', 'Z') },
    rootOrder: ['p', 'z']
  });
  context.deleteCard('z');
  context.deleteCard('p');
  // Permanently delete only the child from the trash.
  context.purgeUndoEntriesForCards(['c']);
  const group = context.undoStack[context.undoStack.length - 1];
  assert.equal(plain(group.data.actions.map(a => a.data.card.id)), ['p'], 'child entry removed from the group');
  context.purgeUndoEntriesForCards(['z']);
  assert.is(context.undoStack.length, 1, 'z entry dropped');
  assert.ok(context.undo());
  assert.ok(store.cards.p, 'parent still restorable');
  assert.not.ok(store.cards.c, 'purged child stays gone');
  assert.not.ok(store.cards.z, 'purged card stays gone');
  context.purgeUndoEntriesForCards(['p']);
  assert.is(context.redoStack.length, 0, 'redo entries that could replay the delete are gone too');
});

// ── #372: PIN-protected exports and encrypted-backup import ───────────────

function pinLayer(overrides = {}) {
  return createAppLayer({
    cards: { s: card('s', 'Secret Title', 'secret body') },
    rootOrder: ['s'],
    overrides: { getSessionPin: () => '2468', ...overrides }
  });
}

test('#372 TXT/Markdown/CSV exports of a PIN dataset require explicit confirmation', async () => {
  let asked = 0;
  const declined = pinLayer({ showConfirmDialog: async () => { asked++; return false; } });
  await declined.context.exportTXT();
  await declined.context.exportMarkdown();
  await declined.context.exportCSV();
  assert.is(asked, 3);
  assert.is(declined.calls.downloads.length, 0, 'nothing leaves the device without consent');

  const accepted = pinLayer({ showConfirmDialog: async () => true });
  await accepted.context.exportTXT();
  await accepted.context.exportMarkdown();
  await accepted.context.exportCSV();
  assert.is(accepted.calls.downloads.length, 3);

  let unprotectedAsked = 0;
  const plainLayer = createAppLayer({
    cards: { s: card('s', 'T') }, rootOrder: ['s'],
    overrides: { showConfirmDialog: async () => { unprotectedAsked++; return false; } }
  });
  await plainLayer.context.exportTXT();
  assert.is(unprotectedAsked, 0, 'unprotected datasets export without a dialog');
  assert.is(plainLayer.calls.downloads.length, 1);
});

test('#372 JSON export of a PIN dataset offers an encrypted backup', async () => {
  const layer = pinLayer({ showChoiceDialog: async () => 'encrypted' });
  await layer.context.exportJSON('instance');
  assert.is(layer.calls.downloads.length, 1);
  const text = await downloadText(layer.calls.downloads[0]);
  assert.not.ok(text.includes('Secret Title'), 'no plaintext in the file');
  const envelope = JSON.parse(text);
  assert.ok(isEncryptedEnvelope(envelope));
  const inner = JSON.parse(await decryptStorePayload(text, '2468'));
  assert.is(inner.exportType, 'instance');
  assert.is(inner.cards.s.title, 'Secret Title');

  const cancelled = pinLayer({ showChoiceDialog: async () => 'cancel' });
  await cancelled.context.exportJSON('instance');
  assert.is(cancelled.calls.downloads.length, 0);

  const plaintext = pinLayer({ showChoiceDialog: async () => 'plaintext' });
  await plaintext.context.exportJSON('instance');
  assert.ok((await downloadText(plaintext.calls.downloads[0])).includes('Secret Title'));
});

test('#372 importing an encrypted backup prompts for the PIN and decrypts', async () => {
  const envelope = JSON.parse(await encryptStorePayload(JSON.stringify({
    exportType: 'instance', cards: { s: card('s', 'Recovered') }, rootIds: ['s']
  }), '1357'));
  const answers = ['wrong', '1357'];
  const prompts = [];
  const layer = createAppLayer({
    overrides: { showPromptDialog: async opts => { prompts.push(opts.message); return answers.shift(); } }
  });
  assert.ok(await layer.context.importJSON(envelope));
  assert.is(prompts.length, 2, 'wrong PIN re-prompts');
  assert.ok(Object.values(layer.store.cards).some(c => c.title === 'Recovered'));

  const cancelled = createAppLayer({ overrides: { showPromptDialog: async () => null } });
  assert.is(await cancelled.context.importJSON(envelope), false);
  assert.equal(plain(Object.keys(cancelled.store.cards)), [], 'nothing imported when the PIN prompt is cancelled');
});

test('#372 a raw encrypted dataset backup (rootOrder shape) imports too', async () => {
  const envelope = JSON.parse(await encryptStorePayload(JSON.stringify({
    rootOrder: ['r'], cards: { r: card('r', 'Raw Store Card') }, metadata: {}
  }), '1111'));
  const layer = createAppLayer({ overrides: { getSessionPin: () => '1111' } });
  assert.ok(await layer.context.importJSON(envelope), 'session PIN is tried first, silently');
  const imported = Object.values(layer.store.cards).find(c => c.title === 'Raw Store Card');
  assert.ok(imported);
  assert.ok(layer.store.rootOrder.includes(imported.id));
});

test.run();
