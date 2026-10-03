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
 * The desktop data folder: one plain JSON file per dataset, in a folder the
 * user chooses (default: Documents/CardSpoke).
 *
 *   <folder>/<dataset key>.json   the dataset payload, exactly what the web
 *                                 app stores (plaintext JSON, pretty-printed,
 *                                 or a PIN-encrypted envelope)
 *   <folder>/.trash/              datasets deleted from the app are moved
 *                                 here instead of being destroyed
 *
 * The folder location (and the dataset last open in the app, for the CLI)
 * is recorded in storage.json inside Electron's userData folder.
 *
 * This module is plain Node.js so it can be unit-tested without Electron.
 * Every key that crosses the IPC boundary is validated here: only dataset
 * keys the web app itself uses can be read or written, and they can never
 * name a path outside the folder.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SETTINGS_FILE = 'storage.json';
const TRASH_DIR = '.trash';
const MAX_KEY_LENGTH = 128;
const MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;

/**
 * Dataset keys used by the web app (see getAllDatasetKeys in data.js):
 * 'nested_cards_store', legacy 'nested_cards_*', and 'cards_<name>_<id>'.
 * Restricted to a filename-safe alphabet.
 */
function isDatasetKey(key) {
  return typeof key === 'string' && key.length <= MAX_KEY_LENGTH &&
    /^(nested_cards_|cards_)[A-Za-z0-9_-]+$/.test(key);
}

function fileNameForKey(key) {
  if (!isDatasetKey(key)) throw new Error('Invalid dataset key');
  return key + '.json';
}

function keyFromFileName(name) {
  if (typeof name !== 'string' || !name.endsWith('.json')) return null;
  const key = name.slice(0, -'.json'.length);
  return isDatasetKey(key) ? key : null;
}

/**
 * Store plaintext payloads pretty-printed so the files are readable and
 * diff well; encrypted envelopes and anything unparsable are kept verbatim.
 */
function formatPayloadForDisk(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.encrypted === true) return text;
    return JSON.stringify(parsed, null, 2) + '\n';
  } catch {
    return text;
  }
}

/** Default folder: Documents/CardSpoke (home/CardSpoke if there is none). */
function defaultDataFolder(documentsDir) {
  return path.join(documentsDir || os.homedir(), 'CardSpoke');
}

function loadSettings(userDataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(userDataDir, SETTINGS_FILE), 'utf8'));
    const settings = {};
    if (raw && typeof raw.dataFolder === 'string' && path.isAbsolute(raw.dataFolder)) settings.dataFolder = raw.dataFolder;
    if (raw && isDatasetKey(raw.activeDataset)) settings.activeDataset = raw.activeDataset;
    return settings;
  } catch {
    return {};
  }
}

function saveSettings(userDataDir, settings) {
  fs.mkdirSync(userDataDir, { recursive: true });
  writeFileAtomic(path.join(userDataDir, SETTINGS_FILE), JSON.stringify(settings, null, 2) + '\n');
}

/** Write via a temp file + rename so readers never see a partial file. */
function writeFileAtomic(filePath, text) {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw err;
  }
}

class DataFolder {
  /**
   * @param {string} dir - Absolute folder path.
   */
  constructor(dir) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Data folder must be an absolute path');
    this.dir = dir;
    // Last content this process read or wrote per key. The watcher only
    // reports changes that differ from it, so the app's own saves never
    // come back as "changed outside the app".
    this.known = new Map();
    this.watcher = null;
    this.timers = new Map();
  }

  /** Create the folder if needed and report whether it is usable. */
  ensure() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.accessSync(this.dir, fs.constants.R_OK | fs.constants.W_OK);
      return { available: true };
    } catch (err) {
      return { available: false, error: err.message };
    }
  }

  pathFor(key) {
    return path.join(this.dir, fileNameForKey(key));
  }

  /** Every dataset file in the folder: [{ key, text, mtimeMs }]. */
  readAll() {
    const out = [];
    for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const key = keyFromFileName(entry.name);
      if (!key) continue;
      const item = this.read(key);
      if (item) out.push(item);
    }
    return out;
  }

  /** @returns {{ key, text, mtimeMs }|null} null when the file is missing. */
  read(key) {
    const file = this.pathFor(key);
    try {
      const text = fs.readFileSync(file, 'utf8');
      const { mtimeMs } = fs.statSync(file);
      this.known.set(key, text);
      return { key, text, mtimeMs };
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Write a dataset file. Refuses (returns { conflict: true, text }) when
   * the file changed on disk since this process last read or wrote it and
   * the watcher has not reported that yet, so a save can never silently
   * overwrite an outside edit. Pass { force: true } to write anyway.
   * @returns {{ written: boolean, conflict?: boolean, text?: string|null }}
   */
  write(key, payload, { force = false } = {}) {
    if (typeof payload !== 'string') throw new Error('Dataset payload must be a string');
    if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) throw new Error('Dataset payload is too large');
    const file = this.pathFor(key);
    if (!force) {
      let onDisk = null;
      try {
        onDisk = fs.readFileSync(file, 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      const expected = this.known.has(key) ? this.known.get(key) : null;
      if (onDisk !== null && onDisk !== expected) {
        // The caller now knows this content; don't report it again.
        this.known.set(key, onDisk);
        return { written: false, conflict: true, text: onDisk };
      }
    }
    const text = formatPayloadForDisk(payload);
    fs.mkdirSync(this.dir, { recursive: true });
    this.known.set(key, text);
    writeFileAtomic(file, text);
    return { written: true };
  }

  /**
   * Move a dataset file into .trash/ (never destroyed outright: the folder
   * may be the user's only copy). Returns false if there was no file.
   */
  remove(key) {
    const file = this.pathFor(key);
    if (!fs.existsSync(file)) return false;
    const trash = path.join(this.dir, TRASH_DIR);
    fs.mkdirSync(trash, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.known.delete(key);
    fs.renameSync(file, path.join(trash, `${key}.${stamp}.json`));
    return true;
  }

  /**
   * Copy every dataset file from another folder into this one, skipping
   * keys this folder already has. Returns the copied keys.
   */
  copyFrom(otherDir) {
    const copied = [];
    if (!otherDir || path.resolve(otherDir) === path.resolve(this.dir) || !fs.existsSync(otherDir)) return copied;
    fs.mkdirSync(this.dir, { recursive: true });
    for (const entry of fs.readdirSync(otherDir, { withFileTypes: true })) {
      const key = entry.isFile() ? keyFromFileName(entry.name) : null;
      if (!key || fs.existsSync(this.pathFor(key))) continue;
      fs.copyFileSync(path.join(otherDir, entry.name), this.pathFor(key), fs.constants.COPYFILE_EXCL);
      copied.push(key);
    }
    return copied;
  }

  /**
   * Watch the folder for changes made outside this process (the CLI, a text
   * editor, a sync client). Calls onChange({ key, text }) — text is null when
   * the file was deleted. Events are debounced per key.
   */
  watch(onChange, { debounceMs = 150 } = {}) {
    this.unwatch();
    const check = (key) => {
      this.timers.delete(key);
      let current = null;
      try {
        current = fs.readFileSync(this.pathFor(key), 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') return;
      }
      const previous = this.known.has(key) ? this.known.get(key) : null;
      if (current === previous) return;
      if (current === null) this.known.delete(key);
      else this.known.set(key, current);
      onChange({ key, text: current });
    };
    try {
      this.watcher = fs.watch(this.dir, { persistent: false }, (_event, name) => {
        const key = keyFromFileName(name ? String(name) : '');
        if (!key) return;
        clearTimeout(this.timers.get(key));
        this.timers.set(key, setTimeout(() => check(key), debounceMs));
      });
      this.watcher.on('error', () => this.unwatch());
    } catch {
      this.watcher = null;
    }
    return !!this.watcher;
  }

  unwatch() {
    if (this.watcher) {
      try { this.watcher.close(); } catch { /* already closed */ }
      this.watcher = null;
    }
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

module.exports = {
  DataFolder,
  SETTINGS_FILE,
  TRASH_DIR,
  isDatasetKey,
  fileNameForKey,
  keyFromFileName,
  formatPayloadForDisk,
  defaultDataFolder,
  loadSettings,
  saveSettings,
  writeFileAtomic
};
