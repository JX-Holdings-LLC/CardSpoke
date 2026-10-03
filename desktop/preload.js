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
 * Sandboxed preload. Exposes a small description of the desktop host and a
 * narrow dataset-storage API backed by the data folder (see main.js). No
 * Node.js capability, file path or generic IPC is bridged: every storage
 * call names a dataset key that the main process validates.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke('cardspoke-storage:' + channel, ...args);

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on('cardspoke-storage:' + channel, listener);
  return () => ipcRenderer.removeListener('cardspoke-storage:' + channel, listener);
}

contextBridge.exposeInMainWorld('cardspokeDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome
  }),
  storage: Object.freeze({
    info: () => invoke('info'),
    readAll: () => invoke('read-all'),
    write: (key, text) => invoke('write', String(key), String(text)),
    remove: (key) => invoke('remove', String(key)),
    setActive: (key) => invoke('set-active', String(key)),
    chooseFolder: () => invoke('choose-folder'),
    openFolder: () => invoke('open-folder'),
    // Fired with { key, text } when a dataset file changes outside the app
    // (text is null when the file was deleted).
    onChange: (callback) => subscribe('changed', callback),
    // Fired when File > Change Data Folder… is chosen from the menu.
    onChangeFolderRequest: (callback) => subscribe('request-change-folder', () => callback())
  })
}));
