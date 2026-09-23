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

/**
 * Remembers the main window's size, position and maximized state between
 * launches (stored as window-state.json in the Electron userData folder).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({ width: 1200, height: 800, isMaximized: false });
const FILE = 'window-state.json';

function isFiniteInt(n) {
  return Number.isInteger(n) && Number.isFinite(n);
}

/** Validate untrusted JSON from disk; fall back to defaults field by field. */
function sanitizeState(raw) {
  const state = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return state;
  if (isFiniteInt(raw.width) && raw.width >= 360 && raw.width <= 10000) state.width = raw.width;
  if (isFiniteInt(raw.height) && raw.height >= 480 && raw.height <= 10000) state.height = raw.height;
  if (isFiniteInt(raw.x) && isFiniteInt(raw.y)) {
    state.x = raw.x;
    state.y = raw.y;
  }
  state.isMaximized = raw.isMaximized === true;
  return state;
}

function loadWindowState(dir) {
  let state;
  try {
    state = sanitizeState(JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')));
  } catch {
    state = { ...DEFAULTS };
  }
  // Drop a saved position that is no longer on any display (monitor
  // unplugged, resolution changed) so the window can't open off-screen.
  if (state.x !== undefined) {
    try {
      const { screen } = require('electron');
      const visible = screen.getAllDisplays().some(({ workArea: a }) =>
        state.x + 100 > a.x && state.x < a.x + a.width &&
        state.y >= a.y - 10 && state.y < a.y + a.height - 50);
      if (!visible) {
        delete state.x;
        delete state.y;
      }
    } catch {
      delete state.x;
      delete state.y;
    }
  }
  return state;
}

function trackWindowState(win, dir) {
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = null;
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    const data = { ...bounds, isMaximized: win.isMaximized() };
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, FILE), JSON.stringify(data));
    } catch {
      // Non-fatal: the window simply opens at the default size next time.
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('close', save);
}

module.exports = { DEFAULTS, sanitizeState, loadWindowState, trackWindowState };
