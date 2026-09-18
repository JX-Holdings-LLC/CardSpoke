/**
 * Kernel cycle-guard regressions (audit 2026-07-16).
 *
 * A hand-crafted or third-party import can contain a card whose parent chain
 * (or children array) forms a cycle. The Kernel's ancestor/descendant walks
 * must terminate on such data instead of looping forever or overflowing the
 * stack. (The UI additionally repairs these on load/import and prevents
 * creating them via the editor, but the engine must be safe on its own.)
 */

import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { Kernel } from '../www/src/kernel.js';

test('getAncestors terminates on a cyclic parent chain', () => {
  const k = new Kernel({
    cards: {
      a: { id: 'a', title: 'A', parentId: 'b', children: ['b'], tags: [] },
      b: { id: 'b', title: 'B', parentId: 'a', children: ['a'], tags: [] }
    },
    rootOrder: []
  });
  const ancestors = k.getAncestors('a'); // would loop forever without the guard
  assert.ok(Array.isArray(ancestors), 'returns an array');
  assert.ok(ancestors.length <= 2, 'bounded — does not loop forever');
});

test('getDescendantIds terminates on a cyclic children array', () => {
  const k = new Kernel({
    cards: {
      a: { id: 'a', title: 'A', parentId: null, children: ['b'], tags: [] },
      b: { id: 'b', title: 'B', parentId: 'a', children: ['a'], tags: [] } // cycles back
    },
    rootOrder: ['a']
  });
  const ids = k.getDescendantIds('a'); // would recurse forever without the guard
  assert.ok(Array.isArray(ids), 'returns an array');
  assert.ok(ids.length <= 2, 'bounded — does not recurse forever');
});

test('delete and duplicate terminate on corrupt cyclic children', () => {
  const fixture = { cards: { a: { id: 'a', children: ['b'], parentId: null }, b: { id: 'b', children: ['a'], parentId: 'a' } }, rootOrder: ['a'] };
  const duplicate = new Kernel(fixture).duplicateHierarchy('a', true);
  assert.is(duplicate.allNewIds.length, 2);
  const k = new Kernel(fixture);
  assert.is(k.deleteCard('a').deleted.length, 2);
  assert.is(Object.keys(k.cards).length, 0);
});
test('unknown parents cannot orphan newly created or moved cards', () => {
  const k = new Kernel();
  assert.throws(() => k.createCard('x', '', 'missing'), /Parent/);
  const { id } = k.createCard('valid', '');
  assert.not.ok(k.reparent(id, 'missing').success);
  assert.equal(k.rootOrder, [id]);
});
test('metadata and custom fields are isolated in kernel snapshots', () => {
  const k = new Kernel({ cards: { a: { id: 'a', meta: { nested: { value: 1 } }, attributes: { list: [1] } } }, rootOrder: ['a'] });
  const snapshot = k.snapshot();
  snapshot.cards.a.meta.nested.value = 2;
  snapshot.cards.a.attributes.list.push(2);
  assert.is(k.getCard('a').meta.nested.value, 1);
  assert.equal(k.getCard('a').attributes.list, [1]);
});
test.run();
