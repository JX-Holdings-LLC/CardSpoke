'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeState, DEFAULTS } = require('../lib/window-state');

test('falls back to defaults for junk input', () => {
  assert.deepEqual(sanitizeState(null), { ...DEFAULTS });
  assert.deepEqual(sanitizeState('x'), { ...DEFAULTS });
  assert.deepEqual(sanitizeState({ width: 'big', height: -1, x: 1.5, y: 2 }), { ...DEFAULTS });
});

test('keeps valid saved bounds', () => {
  assert.deepEqual(
    sanitizeState({ width: 900, height: 700, x: 10, y: -20, isMaximized: true }),
    { width: 900, height: 700, x: 10, y: -20, isMaximized: true }
  );
});

test('rejects sizes below the window minimum', () => {
  const s = sanitizeState({ width: 100, height: 100 });
  assert.equal(s.width, DEFAULTS.width);
  assert.equal(s.height, DEFAULTS.height);
});
