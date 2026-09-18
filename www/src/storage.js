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

import {
  APP_VERSION, SCHEMA_VERSION,
  store, setStore, createDefaultStore,
  navState, setNavState,
  navHistory, setNavHistory,
  instanceKey
} from './state.js';
import { migrateStore as coreMigrateStore } from '@core/migrations.js';
import {
  encryptStorePayload,
  decryptStorePayload,
  isEncryptedEnvelope
} from '@core/dataset-crypto.js';


      // Source Part 2/5: Storage drivers, navigation, and plugin runtime
      // Concatenated via `npm run build` in lexical order of www/src/*.js
      // =============================================================
      // --- STORAGE DRIVER ARCHITECTURE (v0.9.4) ---
      // =============================================================

      /**
       * StorageDriver Interface
       * Provides abstraction for different storage backends
       */
      class StorageDriver {
        constructor() {
          if (new.target === StorageDriver) {
            throw new Error('StorageDriver is an abstract class');
          }
        }
      
        async init(config) {
          throw new Error('init() must be implemented');
        }
      
        async get(key) {
          throw new Error('get() must be implemented');
        }
      
        async set(key, value) {
          throw new Error('set() must be implemented');
        }
      
        async remove(key) {
          throw new Error('remove() must be implemented');
        }
      
        async list(prefix) {
          throw new Error('list() must be implemented');
        }
      
        async getSize() {
          throw new Error('getSize() must be implemented');
        }
      
        getKind() {
          throw new Error('getKind() must be implemented');
        }
      }
      
      /**
       * IndexedDB Storage Driver
       */
      class IndexedDBDriver extends StorageDriver {
        constructor() {
          super();
          this.dbName = 'CardSpokeDB';
          this.storeName = 'datasets';
          this.db = null;
        }
      
        async init(config = {}) {
          this.dbName = config.dbName || 'CardSpokeDB';
          this.storeName = config.storeName || 'datasets';
      
          return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
      
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              this.db = request.result;
              resolve();
            };
      
            request.onupgradeneeded = (event) => {
              const db = event.target.result;
              if (!db.objectStoreNames.contains(this.storeName)) {
                db.createObjectStore(this.storeName);
              }
            };
          });
        }
      
        async get(key) {
          return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
      
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
        }
      
        async set(key, value) {
          return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(value, key);
      
            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
            transaction.onerror = () => reject(transaction.error);
          });
        }
      
        async remove(key) {
          return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);
      
            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
            transaction.onerror = () => reject(transaction.error);
          });
        }
      
        async list(prefix = '') {
          return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAllKeys();
      
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const keys = request.result;
              const filtered = prefix ? keys.filter(k => k.startsWith(prefix)) : keys;
              resolve(filtered);
            };
          });
        }
      
        async getSize() {
          const keys = await this.list();
          let totalSize = 0;
      
          for (const key of keys) {
            const value = await this.get(key);
            if (value) {
              totalSize += JSON.stringify(value).length;
            }
          }
      
          return totalSize;
        }
      
        getKind() {
          return 'indexeddb';
        }
      }
      
      /**
       * LocalStorage Driver (fallback/compatibility)
       */
      class LocalStorageDriver extends StorageDriver {
        constructor() {
          super();
          this.prefix = 'cardspoke_';
        }
      
        async init(config = {}) {
          this.prefix = config.prefix || 'cardspoke_';
          return Promise.resolve();
        }
      
        async get(key) {
          const fullKey = this.prefix + key;
          const value = localStorage.getItem(fullKey);
          return value ? JSON.parse(value) : null;
        }
      
        async set(key, value) {
          const fullKey = this.prefix + key;
          localStorage.setItem(fullKey, JSON.stringify(value));
          return Promise.resolve();
        }
      
        async remove(key) {
          const fullKey = this.prefix + key;
          localStorage.removeItem(fullKey);
          return Promise.resolve();
        }
      
        async list(prefix = '') {
          const keys = [];
          const searchPrefix = this.prefix + prefix;
      
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(searchPrefix)) {
              keys.push(key.substring(this.prefix.length));
            }
          }
      
          return keys;
        }
      
        async getSize() {
          const keys = await this.list();
          let totalSize = 0;
      
          for (const key of keys) {
            const fullKey = this.prefix + key;
            const value = localStorage.getItem(fullKey);
            if (value) {
              totalSize += value.length;
            }
          }
      
          return totalSize;
        }
      
        getKind() {
          return 'localstorage';
        }
      }

      /**
       * Local File Storage Driver
       * Uses File System Access API (web) or Capacitor Filesystem (native)
       */
      class LocalFileDriver extends StorageDriver {
        constructor() {
          super();
          this.fileHandle = null;
          this.fileName = 'cardspoke.json';
          this.handleKey = 'cardspoke_localfile_handle';
          this.isNative = false;
          this.nativeFilePath = null;
        }

        async init(config = {}) {
          this.fileName = config.fileName || 'cardspoke.json';
          this.handleKey = config.handleKey || 'cardspoke_localfile_handle';
          
          // Detect if running in Capacitor native environment
          this.isNative = typeof window.Capacitor !== 'undefined' && 
                          typeof window.Capacitor.isNativePlatform === 'function' && 
                          window.Capacitor.isNativePlatform();
          
          if (this.isNative) {
            // Native: Use Capacitor Filesystem
            const { Filesystem } = window.Capacitor.Plugins;
            if (!Filesystem) {
              throw new Error('Capacitor Filesystem plugin not available');
            }
            // Store file in Documents directory
            this.nativeFilePath = this.fileName;
          } else {
            // Web: Try to restore file handle from IndexedDB
            await this.restoreHandle();
          }
          
          return Promise.resolve();
        }

        async restoreHandle() {
          try {
            // Try to restore the file handle from IndexedDB
            const db = await this.openHandleDB();
            const handle = await this.getHandleFromDB(db);
            if (handle) {
              // Verify we still have permission
              const permission = await handle.queryPermission({ mode: 'readwrite' });
              if (permission === 'granted') {
                this.fileHandle = handle;
              }
            }
          } catch (error) {
            console.warn('Could not restore file handle:', error);
          }
        }

        async openHandleDB() {
          return new Promise((resolve, reject) => {
            const request = indexedDB.open('CardSpokeFileHandles', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
              const db = event.target.result;
              if (!db.objectStoreNames.contains('handles')) {
                db.createObjectStore('handles');
              }
            };
          });
        }

        async getHandleFromDB(db) {
          return new Promise((resolve, reject) => {
            const transaction = db.transaction(['handles'], 'readonly');
            const store = transaction.objectStore('handles');
            const request = store.get(this.handleKey);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
        }

        async saveHandleToDB(handle) {
          const db = await this.openHandleDB();
          return new Promise((resolve, reject) => {
            const transaction = db.transaction(['handles'], 'readwrite');
            const store = transaction.objectStore('handles');
            const request = store.put(handle, this.handleKey);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
          });
        }

        async ensureHandle() {
          if (this.isNative) {
            // Native platform always has access to file system
            return;
          }
          
          if (!this.fileHandle) {
            // Check if File System Access API is supported
            if (!('showSaveFilePicker' in window)) {
              throw new Error('File System Access API not supported in this browser. Please use Chrome, Edge, or another compatible browser.');
            }
            
            // Prompt user to select/create a file
            try {
              this.fileHandle = await window.showSaveFilePicker({
                suggestedName: this.fileName,
                types: [{
                  description: 'CardSpoke Data File',
                  accept: { 'application/json': ['.json'] }
                }]
              });
              
              // Save handle to IndexedDB for future use
              await this.saveHandleToDB(this.fileHandle);
            } catch (error) {
              if (error.name === 'AbortError') {
                throw new Error('File selection cancelled by user');
              }
              throw error;
            }
          }
        }

        async readFile() {
          if (this.isNative) {
            // Native: Read using Capacitor Filesystem
            const { Filesystem, Directory } = window.Capacitor.Plugins;
            try {
              const result = await Filesystem.readFile({
                path: this.nativeFilePath,
                directory: Directory.Documents,
                encoding: 'utf8'
              });
              const text = result.data || '';
              if (!text.trim()) {
                return {};
              }
              try {
                return JSON.parse(text);
              } catch (parseError) {
                console.error('Failed to parse file content:', parseError);
                throw new Error('Invalid JSON in file');
              }
            } catch (error) {
              // Check for file not found error
              if (error.code === 'NOT_FOUND' || (error.message && error.message.toLowerCase().includes('not exist'))) {
                return {};
              }
              throw error;
            }
          } else {
            // Web: Read using File System Access API
            await this.ensureHandle();
            const file = await this.fileHandle.getFile();
            const text = await file.text();
            if (!text.trim()) {
              return {};
            }
            try {
              return JSON.parse(text);
            } catch (parseError) {
              console.error('Failed to parse file content:', parseError);
              throw new Error('Invalid JSON in file');
            }
          }
        }

        async writeFile(data) {
          if (this.isNative) {
            // Native: Write using Capacitor Filesystem
            const { Filesystem, Directory } = window.Capacitor.Plugins;
            await Filesystem.writeFile({
              path: this.nativeFilePath,
              data: JSON.stringify(data, null, 2),
              directory: Directory.Documents,
              encoding: 'utf8'
            });
          } else {
            // Web: Write using File System Access API
            await this.ensureHandle();
            const writable = await this.fileHandle.createWritable();
            await writable.write(JSON.stringify(data, null, 2));
            await writable.close();
          }
        }

        async get(key) {
          try {
            const data = await this.readFile();
            return data[key] || null;
          } catch (error) {
            console.error('LocalFile get error:', error);
            showToast('Failed to read from local file: ' + error.message, 'error');
            return null;
          }
        }

        async set(key, value) {
          try {
            const data = await this.readFile();
            data[key] = value;
            await this.writeFile(data);
          } catch (error) {
            console.error('LocalFile set error:', error);
            showToast('Failed to save to local file: ' + error.message, 'error');
            throw error;
          }
        }

        async remove(key) {
          try {
            const data = await this.readFile();
            delete data[key];
            await this.writeFile(data);
          } catch (error) {
            console.error('LocalFile remove error:', error);
            showToast('Failed to remove from local file: ' + error.message, 'error');
            throw error;
          }
        }

        async list(prefix = '') {
          try {
            const data = await this.readFile();
            const keys = Object.keys(data);
            return prefix ? keys.filter(k => k.startsWith(prefix)) : keys;
          } catch (error) {
            console.error('LocalFile list error:', error);
            return [];
          }
        }

        async getSize() {
          try {
            if (this.isNative) {
              const { Filesystem, Directory } = window.Capacitor.Plugins;
              const stat = await Filesystem.stat({
                path: this.nativeFilePath,
                directory: Directory.Documents
              });
              return stat.size;
            } else {
              await this.ensureHandle();
              const file = await this.fileHandle.getFile();
              return file.size;
            }
          } catch (error) {
            console.error('LocalFile getSize error:', error);
            return 0;
          }
        }

        getKind() {
          return 'localfile';
        }
      }

      /**
       * Dataset Manager
       * Manages multiple datasets with different storage drivers
       */
      class DatasetManager {
        constructor() {
          this.datasets = new Map();
          this.activeDatasetId = null;
          this.metadataKey = 'cardspoke_dataset_metadata';
        }
      
        async init() {
          // Load dataset metadata from localStorage
          const metadataJson = localStorage.getItem(this.metadataKey);
          if (metadataJson) {
            const metadata = JSON.parse(metadataJson);
            this.activeDatasetId = metadata.activeDatasetId;
      
            // Initialize datasets. Legacy metadata stored the raw PIN in
            // plaintext; it is intentionally NOT loaded (and saveMetadata
            // scrubs it on the next write) — PINs live only in the
            // encryption session, never in stored metadata (CS-001).
            for (const [id, meta] of Object.entries(metadata.datasets || {})) {
              const driver = await this.createDriver(meta.storage.driver, meta.storage.config);
              this.datasets.set(id, {
                id,
                name: meta.name,
                driver,
                pin: null,
                hasPin: !!(meta.hasPin || meta.pin),
                createdAt: meta.createdAt,
                updatedAt: meta.updatedAt
              });
            }
          }
      
          // Create default dataset if none exist
          if (this.datasets.size === 0) {
            await this.createDataset('Default', 'localstorage');
          }
        }
      
        async createDriver(kind, config = {}) {
          let driver;

          switch (kind) {
            case 'indexeddb':
              driver = new IndexedDBDriver();
              break;
            case 'localfile':
              driver = new LocalFileDriver();
              break;
            case 'localstorage':
            default:
              // Cloud drivers (googledrive/onedrive/webdav) are not part of
              // the public app; legacy dataset metadata referencing them
              // falls back to on-device LocalStorage.
              driver = new LocalStorageDriver();
              break;
          }

          await driver.init(config);
          return driver;
        }
      
        async createDataset(name, storageKind = 'localstorage', pin = null) {
          const id = 'dataset_' + Date.now();
          const driver = await this.createDriver(storageKind, {
            dbName: `CardSpokeDB_${id}`,
            prefix: `cardspoke_${id}_`
          });
      
          const dataset = {
            id,
            name,
            driver,
            pin,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
      
          this.datasets.set(id, dataset);
      
          if (!this.activeDatasetId) {
            this.activeDatasetId = id;
          }
      
          await this.saveMetadata();
          return dataset;
        }
      
        async saveMetadata() {
          const metadata = {
            activeDatasetId: this.activeDatasetId,
            datasets: {}
          };
      
          for (const [id, dataset] of this.datasets) {
            metadata.datasets[id] = {
              name: dataset.name,
              storage: {
                driver: dataset.driver.getKind(),
                config: {}
              },
              // Never persist the PIN itself — only whether one exists.
              hasPin: !!(dataset.pin || dataset.hasPin),
              createdAt: dataset.createdAt,
              updatedAt: dataset.updatedAt
            };
          }
      
          localStorage.setItem(this.metadataKey, JSON.stringify(metadata));
        }
      
        getActiveDataset() {
          return this.datasets.get(this.activeDatasetId);
        }
      
        async switchDataset(datasetId, pin = null) {
          const dataset = this.datasets.get(datasetId);
          if (!dataset) {
            throw new Error('Dataset not found');
          }
      
          // Check PIN if required
          if (dataset.pin && dataset.pin !== pin) {
            throw new Error('Invalid PIN');
          }
      
          this.activeDatasetId = datasetId;
          await this.saveMetadata();
          return dataset;
        }
      
        async deleteDataset(datasetId) {
          if (this.datasets.size <= 1) {
            throw new Error('Cannot delete the last dataset');
          }
      
          const dataset = this.datasets.get(datasetId);
          if (!dataset) {
            throw new Error('Dataset not found');
          }
      
          // Remove all data from storage
          const keys = await dataset.driver.list();
          for (const key of keys) {
            await dataset.driver.remove(key);
          }
      
          this.datasets.delete(datasetId);
      
          // Switch to another dataset if this was active
          if (this.activeDatasetId === datasetId) {
            this.activeDatasetId = this.datasets.keys().next().value;
          }
      
          await this.saveMetadata();
        }
      
        async getDatasetInfo(datasetId) {
          const dataset = this.datasets.get(datasetId || this.activeDatasetId);
          if (!dataset) {
            throw new Error('Dataset not found');
          }
      
          const size = await dataset.driver.getSize();
          const keys = await dataset.driver.list();
      
          return {
            id: dataset.id,
            name: dataset.name,
            storageKind: dataset.driver.getKind(),
            hasPIN: !!(dataset.pin || dataset.hasPin),
            size: size,
            sizeFormatted: this.formatBytes(size),
            itemCount: keys.length,
            createdAt: new Date(dataset.createdAt).toLocaleString(),
            updatedAt: new Date(dataset.updatedAt).toLocaleString()
          };
        }
      
        formatBytes(bytes) {
          if (bytes === 0) return '0 Bytes';
          const k = 1024;
          const sizes = ['Bytes', 'KB', 'MB', 'GB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
        }
      
        listDatasets() {
          return Array.from(this.datasets.values()).map(d => ({
            id: d.id,
            name: d.name,
            storageKind: d.driver.getKind(),
            hasPIN: !!(d.pin || d.hasPin),
            isActive: d.id === this.activeDatasetId
          }));
        }
      }
      
      // Global dataset manager instance
      let datasetManager = null;
      

      // --- LOCAL STORAGE ---

      // Save state tracking
      let saveTimeout = null;
      let savePending = false;
      let saveRevision = 0;
      let saveEpoch = 0;
      let saveWriteQueue = Promise.resolve();
      let lastSaveTime = 0;
      const SAVE_DEBOUNCE_MS = 500; // Wait 500ms after last change before saving
      const MIN_SAVE_INTERVAL_MS = 100; // Minimum time between actual saves


      let indexedDbMirrorDriver = null;

      async function getIndexedDbMirrorDriver() {
        if (indexedDbMirrorDriver) return indexedDbMirrorDriver;
        const driver = new IndexedDBDriver();
        await driver.init({ dbName: 'CardSpokeDB', storeName: 'datasets' });
        indexedDbMirrorDriver = driver;
        return indexedDbMirrorDriver;
      }

      function isIndexedDbDataset() {
        return !!(store && store.metadata && store.metadata.storageType === 'indexeddb');
      }

      function getStorageType() {
        return (store && store.metadata && store.metadata.storageType) || 'localstorage';
      }

      function supportsFileSystemAccess() {
        return typeof window.showSaveFilePicker === 'function';
      }

      function getDatasetFileHandleKey() {
        const key = instanceKey || 'nested_cards_store';
        return (store.metadata && store.metadata.storageConfig && store.metadata.storageConfig.handleKey) || (`cardspoke_file_handle_${key}`);
      }

      async function openFileHandleDb() {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open('CardSpokeFileHandles', 1);
          req.onerror = () => reject(req.error);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
          };
          req.onsuccess = () => resolve(req.result);
        });
      }

      async function saveDatasetFileHandle(handleKey, handle) {
        const db = await openFileHandleDb();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(['handles'], 'readwrite');
          tx.objectStore('handles').put(handle, handleKey);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }

      async function loadDatasetFileHandle(handleKey) {
        const db = await openFileHandleDb();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(['handles'], 'readonly');
          const req = tx.objectStore('handles').get(handleKey);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      }

      async function ensureLocalFileHandle() {
        if (!supportsFileSystemAccess()) {
          throw new Error('File System Access API is not supported in this browser/runtime');
        }
        const handleKey = getDatasetFileHandleKey();
        let handle = await loadDatasetFileHandle(handleKey);
        if (!handle) {
          const suggestedName = ((store.metadata && store.metadata.name) || 'cardspoke-dataset').replace(/\s+/g, '-').toLowerCase() + '.json';
          handle = await window.showSaveFilePicker({
            suggestedName,
            types: [{ description: 'JSON Dataset', accept: { 'application/json': ['.json'] } }]
          });
          await saveDatasetFileHandle(handleKey, handle);
        }
        if (store.metadata && store.metadata.storageConfig) {
          store.metadata.storageConfig.handleKey = handleKey;
          store.metadata.storageConfig.fileName = handle.name || 'dataset.json';
        }
        return handle;
      }

      async function writeDatasetToLocalFile(payload) {
        if (getStorageType() !== 'localfile') return;
        const handle = await ensureLocalFileHandle();
        const writable = await handle.createWritable();
        await writable.write(payload);
        await writable.close();
      }

      async function readDatasetFromLocalFile() {
        if (getStorageType() !== 'localfile') return null;
        const handle = await ensureLocalFileHandle();
        const file = await handle.getFile();
        const text = await file.text();
        return text || null;
      }



      // =============================================================
      // --- DATASET ENCRYPTION SESSION STATE (CS-001) ---
      // The PIN for an encrypted dataset lives ONLY in memory for the
      // current session. It is never written to storage in any form —
      // the persisted envelope carries salt/KDF/cipher parameters, and
      // unlocking re-derives the key from the PIN the user types.
      // =============================================================

      let activeSessionPin = null;
      // When true, saveNow() refuses to write the active dataset key.
      // Set while an encrypted dataset is locked (no/failed unlock) or
      // while corrupted stored data awaits an explicit recovery choice,
      // so the original payload can never be overwritten silently
      // (CS-001 / CS-004).
      let storageWriteLock = false;

      function setSessionPin(pin) {
        activeSessionPin = pin || null;
      }

      function getSessionPin() {
        return activeSessionPin;
      }

      function isStorageWriteLocked() {
        return storageWriteLock;
      }

      /**
       * Small, stable, non-cryptographic hash of a payload string. Used only
       * to derive an idempotent quarantine key for corrupt data (CS-004), so
       * retrying on the same bytes reuses one recovery copy.
       */
      function hashPayload(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
          h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
        }
        return (h >>> 0).toString(36);
      }

      // (isEncryptedEnvelope / encryptStorePayload / decryptStorePayload are
      // imported from @core/dataset-crypto.js so the envelope format has
      // real unit tests.)

      /**
       * Legacy stores persisted the dataset PIN inside store.metadata.
       * Move it into the in-memory session (so saves keep encrypting)
       * and delete it so the PIN is never written back out again.
       * @returns {boolean} True if a legacy PIN was found and migrated.
       */
      function stripLegacyPinMetadata() {
        if (store && store.metadata && store.metadata.pin) {
          if (!activeSessionPin) activeSessionPin = store.metadata.pin;
          delete store.metadata.pin;
          return true;
        }
        return false;
      }

      function validateStoreConsistency() {
        if (!store || !store.cards || typeof store.cards !== 'object') return false;
        let changed = false;
        const cards = store.cards;
        const ids = new Set(Object.keys(cards));

        Object.values(cards).forEach(card => {
          if (!Array.isArray(card.children)) {
            card.children = [];
            changed = true;
          }
          card.children = card.children.filter(cid => ids.has(cid));
        });

        Object.values(cards).forEach(card => {
          if (card.parentId && !cards[card.parentId]) {
            card.parentId = null;
            changed = true;
          }
        });

        const visiting = new Set();
        const visited = new Set();
        const breakCycle = (id) => {
          if (visited.has(id)) return;
          if (visiting.has(id)) {
            cards[id].parentId = null;
            changed = true;
            return;
          }
          visiting.add(id);
          const parentId = cards[id] && cards[id].parentId;
          if (parentId && cards[parentId]) breakCycle(parentId);
          visiting.delete(id);
          visited.add(id);
        };
        Object.keys(cards).forEach(breakCycle);

        Object.values(cards).forEach(card => {
          if (card.parentId && cards[card.parentId] && !cards[card.parentId].children.includes(card.id)) {
            cards[card.parentId].children.push(card.id);
            changed = true;
          }
        });

        const computedRoots = Object.values(cards).filter(card => !card.parentId).map(card => card.id);
        const existingRootOrder = Array.isArray(store.rootOrder) ? store.rootOrder : [];
        const cleanedRootOrder = existingRootOrder.filter(id => cards[id] && !cards[id].parentId);
        computedRoots.forEach(id => {
          if (!cleanedRootOrder.includes(id)) {
            cleanedRootOrder.push(id);
            changed = true;
          }
        });
        if (cleanedRootOrder.length !== existingRootOrder.length || !cleanedRootOrder.every((id, i) => id === existingRootOrder[i])) {
          store.rootOrder = cleanedRootOrder;
          changed = true;
        }

        return changed;
      }

      /**
       * Run the typed-card migration layer over the loaded store.
       * Idempotent and loss-free (see www/src/core/migrations.js): fills
       * missing kind defaults, preserves unknown kinds/metadata, and logs
       * warnings instead of dropping data.
       * @returns {boolean} True if any card changed and a save is needed.
       */
      function migrateTypedCards() {
        try {
          const result = coreMigrateStore(store);
          result.warnings.forEach(w => console.warn('[TypedCards]', w));
          return result.changed;
        } catch (err) {
          console.error('[TypedCards] Migration failed (data left untouched):', err);
          return false;
        }
      }

      async function saveNow() {
        const savingStore = store;
        const savingKey = instanceKey;
        try {
          // Never write while the dataset is locked (encrypted-but-not-
          // unlocked) or awaiting corruption recovery: the stored payload
          // is the user's only copy and must survive untouched (CS-001/CS-004).
          if (storageWriteLock) {
            savePending = false;
            updateSaveStatus('locked');
            return;
          }

          // Run middleware pipeline before saving (Task 1.1)
          if (window.CardSpoke && window.CardSpoke.Middleware) {
            try {
              const result = await window.CardSpoke.Middleware.run('card.save', [store]);
              if (result && result.prevented) {
                savePending = true;
                return;
              }
            } catch (err) {
              console.error('[Middleware] card.save pipeline error:', err);
            }
          }

          if (store !== savingStore || instanceKey !== savingKey || storageWriteLock) return;
          const key = instanceKey || 'nested_cards_store';
          const startTime = performance.now();

          if (!store.metadata) store.metadata = {};
          store.metadata.navState = { ...navState };
          store.metadata.navHistory = Array.isArray(navHistory) ? navHistory.slice(-100) : [];

          // Await the write; an untracked idle callback can outlive a dataset switch.
          const doSave = async () => {
            try {
              await persistStoreNow(key);
              const duration = performance.now() - startTime;
              // Show success indicator briefly
              if (!savePending && store === savingStore) {
                updateSaveStatus('saved');
                setTimeout(() => { if (!savePending && store === savingStore) updateSaveStatus('idle'); }, 1000);
              }
              console.log(`Saved in ${duration.toFixed(2)}ms`);
            } catch (e) {
              savePending = true;
              if (isQuotaError(e)) {
                showToast('Storage quota exceeded! Please clear old data or export your cards.', 'error');
              } else {
                showToast('Failed to save: ' + e.message, 'error');
              }
              updateSaveStatus('error');
            }
          };

          await doSave();
        } catch (e) {
          showToast('Failed to save: ' + e.message, 'error');
          savePending = true;
          updateSaveStatus('error');
        }
      }

      /**
       * Persist the current store to a specific dataset key, encrypting when a
       * session PIN is active. Shared by the debounced save and by
       * flushPendingSave() so a dataset switch cannot redirect a pending write
       * to another dataset's key. Throws on primary-write failure so the caller
       * can report it. (CS-001: never write plaintext for an encrypted dataset.)
       */
      async function persistStoreNow(key) {
        stripLegacyPinMetadata();
        const payload = JSON.stringify(store);
        const activePin = activeSessionPin;
        const revision = saveRevision;
        const epoch = saveEpoch;
        const storageType = getStorageType();
        // Capture the file handle before yielding so a later dataset cannot
        // redirect this write. Writes serialize in invocation order, including
        // encryption, which can otherwise finish out of order.
        const fileHandle = storageType === 'localfile' ? ensureLocalFileHandle() : null;
        if (fileHandle) fileHandle.catch(() => {});
        const write = async () => {
          const finalPayload = activePin ? await encryptStorePayload(payload, activePin) : payload;
          if (epoch !== saveEpoch) return;
          localStorage.setItem(key, finalPayload);
          if (storageType === 'indexeddb') {
            const driver = await getIndexedDbMirrorDriver();
            await driver.set(key, finalPayload);
          }
          if (fileHandle) {
            const handle = await fileHandle;
            if (epoch !== saveEpoch) return;
            const writable = await handle.createWritable();
            await writable.write(finalPayload);
            await writable.close();
          }
          lastSaveTime = Date.now();
          if (revision === saveRevision && epoch === saveEpoch) {
            savePending = false;
            if (typeof setDirty === 'function') setDirty(false);
          }
        };
        const result = saveWriteQueue.then(write);
        saveWriteQueue = result.catch(() => {});
        return result;
      }

      // QuotaExceededError is named differently across engines; match the
      // common variants so a full-disk save is reported, not swallowed.
      function isQuotaError(e) {
        return !!e && (e.name === 'QuotaExceededError' ||
          e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
      }

      /**
       * Flush a pending debounced save synchronously (awaitable), writing the
       * CURRENT store to the CURRENT dataset key. Callers MUST await this before
       * switching datasets so a stale debounce timer can never fire after the
       * key changed and write one dataset's data (possibly unencrypted) into
       * another dataset's key (CS-101-adjacent data-loss race).
       */
      async function flushPendingSave() {
        if (saveTimeout) { clearTimeout(saveTimeout); saveTimeout = null; }
        await saveWriteQueue;
        if (!savePending) return;
        if (storageWriteLock) { savePending = false; return; }
        const key = instanceKey || 'nested_cards_store';
        if (!store.metadata) store.metadata = {};
        store.metadata.navState = { ...navState };
        store.metadata.navHistory = Array.isArray(navHistory) ? navHistory.slice(-100) : [];
        try {
          await persistStoreNow(key);
        } catch (e) {
          console.error('[Storage] Flush-before-switch save failed:', e);
          if (isQuotaError(e)) {
            showToast('Storage quota exceeded! Please clear old data or export your cards.', 'error');
          } else {
            showToast('Failed to save: ' + e.message, 'error');
          }
          updateSaveStatus('error');
          throw e; // Keep the current dataset open when its latest data could not be saved.
        }
      }

      /**
       * Cancel a pending debounced save WITHOUT writing. Used when the current
       * dataset is being deleted, so a queued timer can't recreate it at its
       * (now removed) key after the switch.
       */
      function cancelPendingSave() {
        saveEpoch++;
        if (saveTimeout) { clearTimeout(saveTimeout); saveTimeout = null; }
        savePending = false;
      }

      function save(immediate = false) {
        saveRevision++;
        // Clear any pending save
        if (saveTimeout) {
          clearTimeout(saveTimeout);
          saveTimeout = null;
        }

        // Locked datasets are read-only until unlocked or explicitly reset;
        // surface that instead of pretending a save is scheduled.
        if (storageWriteLock) {
          savePending = false;
          updateSaveStatus('locked');
          return;
        }

        // If immediate save requested, save now
        if (immediate) {
          savePending = true;
          saveNow();
          return;
        }

        // Check if we're saving too frequently
        const timeSinceLastSave = Date.now() - lastSaveTime;
        if (timeSinceLastSave < MIN_SAVE_INTERVAL_MS) {
          // Schedule save after minimum interval
          savePending = true;
          updateSaveStatus('pending');
          saveTimeout = setTimeout(saveNow, Math.max(SAVE_DEBOUNCE_MS, MIN_SAVE_INTERVAL_MS - timeSinceLastSave));
          return;
        }

        // Debounce: wait for user to stop making changes
        savePending = true;
        updateSaveStatus('pending');
        saveTimeout = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
      }

      function updateSaveStatus(status) {
        const indicator = document.getElementById('saveStatus');
        if (!indicator) return;

        indicator.className = 'save-status ' + status;
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        switch (status) {
          case 'pending':
            indicator.textContent = 'Saving…';
            indicator.title = `Saving… (${timeStr})`;
            break;
          case 'saved':
            indicator.textContent = 'Saved';
            indicator.title = `Last saved at ${timeStr}`;
            break;
          case 'error':
            indicator.textContent = 'Save failed';
            indicator.title = `Save failed at ${timeStr}`;
            break;
          case 'locked':
            indicator.textContent = 'Not saved — dataset locked';
            indicator.title = 'Changes are not being saved while the dataset is locked';
            break;
          default:
            indicator.textContent = '';
            indicator.title = '';
        }
      }

      async function clearAllData() {
        if (!await showConfirmDialog('WARNING: This will DELETE ALL instances and data from localStorage.\n\nThis action CANNOT be undone!\n\nAre you absolutely sure?', {
          title: 'Delete All Data',
          confirmLabel: 'Continue',
          cancelLabel: 'Cancel',
          confirmClassName: 'btn btn-danger'
        })) {
          return;
        }

        if (!await showConfirmDialog('This is your FINAL warning.\n\nAll card data, all instances, and all settings will be permanently deleted.\n\nContinue?', {
          title: 'Final Warning',
          confirmLabel: 'Delete Everything',
          cancelLabel: 'Cancel',
          confirmClassName: 'btn btn-danger'
        })) {
          return;
        }

        try {
          // Get all keys to clear
          const allKeys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            allKeys.push(key);
          }

          // Clear everything
          localStorage.clear();

          showToast(`Cleared ${allKeys.length} items from localStorage`, 'success');

          // Reset the app
          setTimeout(() => {
            location.reload();
          }, 1000);
        } catch (e) {
          showToast('Failed to clear data: ' + e.message, 'error');
        }
      }

      /**
       * Interactive unlock for an encrypted dataset envelope (CS-001).
       * Tries the in-memory session PIN first, then prompts the user in a
       * retry loop. Returns the decrypted payload string, or null when the
       * user declines (or no dialog UI is available) — in which case the
       * caller must leave the stored envelope untouched.
       */
      async function unlockEncryptedDataset(rawEnvelope) {
        if (activeSessionPin) {
          try {
            return await decryptStorePayload(rawEnvelope, activeSessionPin);
          } catch (_err) {
            // Session PIN belongs to a different dataset — fall through.
            activeSessionPin = null;
          }
        }

        if (typeof showPromptDialog !== 'function' ||
            typeof document === 'undefined' || !document.body) {
          return null;
        }

        let attempt = 0;
        for (;;) {
          const pin = await showPromptDialog({
            title: 'Unlock Encrypted Dataset',
            message: attempt === 0
              ? 'This dataset is protected with a PIN. Enter it to unlock your cards. Your data stays untouched until the correct PIN is entered.'
              : 'Incorrect PIN. Please try again.',
            label: 'PIN',
            type: 'password',
            confirmLabel: 'Unlock',
            cancelLabel: 'Not now'
          });
          if (pin === null || pin === undefined) return null;
          if (!pin.trim()) { attempt++; continue; }
          try {
            const decrypted = await decryptStorePayload(rawEnvelope, pin);
            activeSessionPin = pin;
            return decrypted;
          } catch (err) {
            console.warn('[Dataset] Unlock attempt failed');
            attempt++;
          }
        }
      }

      /**
       * Full-screen blocker shown while an encrypted dataset stays locked.
       * Writes are disabled; the user can retry the PIN, download the
       * encrypted payload, or switch to another dataset.
       */
      function showDatasetLockScreen(key) {
        if (typeof document === 'undefined' || !document.body) return;
        const existing = document.getElementById('datasetLockScreen');
        if (existing) existing.remove();

        // Deliberately NOT Escape-dismissable (data-a11y-managed): dismissing
        // the lock screen would leave a locked dataset with no recovery UI.
        const overlay = h('div', { id: 'datasetLockScreen', className: 'modal-overlay show', 'data-a11y-managed': 'true' });
        const modal = h('div', {
          className: 'modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'datasetLockTitle',
          style: 'max-width: 480px;'
        });
        const header = h('div', { className: 'modal-header' });
        header.appendChild(h('div', { className: 'modal-title', id: 'datasetLockTitle' }, 'Dataset Locked'));
        modal.appendChild(header);

        const body = h('div', { className: 'modal-body' });
        body.appendChild(h('p', { style: 'margin-bottom: var(--space-lg);' },
          'This dataset is encrypted and has not been unlocked. Your data is safe: nothing will be saved over it while it stays locked.'));

        const actions = h('div', { style: 'display: flex; gap: var(--space-sm); flex-wrap: wrap;' });
        actions.appendChild(h('button', {
          className: 'btn btn-primary',
          onclick: async () => {
            overlay.remove();
            await load();
            render();
          }
        }, 'Unlock'));
        actions.appendChild(h('button', {
          className: 'btn',
          onclick: () => {
            const payload = localStorage.getItem(key);
            if (payload && typeof downloadWithFeedback === 'function') {
              downloadWithFeedback(payload, key + '-encrypted-backup.json', 'application/json');
            }
          }
        }, 'Download encrypted backup'));
        actions.appendChild(h('button', {
          className: 'btn',
          onclick: () => {
            // The manager opens on top of this lock screen; the lock stays
            // behind it until another dataset is loaded (load() clears it).
            if (typeof showDatasetManager === 'function') showDatasetManager();
          }
        }, 'Switch dataset'));
        body.appendChild(actions);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        if (typeof trapFocus === 'function') trapFocus(modal);
      }

      /**
       * Recovery blocker for unreadable stored data (CS-004). The original
       * payload has already been quarantined; the active key is untouched
       * and writes are locked until the user makes an explicit choice.
       */
      function showCorruptDataRecovery(key, raw, quarantineKey) {
        if (typeof document === 'undefined' || !document.body) return;
        const existing = document.getElementById('corruptRecoveryScreen');
        if (existing) existing.remove();

        // Deliberately NOT Escape-dismissable (data-a11y-managed): the user
        // must make an explicit recovery choice before writes unlock.
        const overlay = h('div', { id: 'corruptRecoveryScreen', className: 'modal-overlay show', 'data-a11y-managed': 'true' });
        const modal = h('div', {
          className: 'modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'corruptRecoveryTitle',
          style: 'max-width: 560px;'
        });
        const header = h('div', { className: 'modal-header' });
        header.appendChild(h('div', { className: 'modal-title', id: 'corruptRecoveryTitle' }, 'Stored Data Could Not Be Read'));
        modal.appendChild(header);

        const body = h('div', { className: 'modal-body' });
        body.appendChild(h('p', { style: 'margin-bottom: var(--space-md);' },
          'The saved data for this dataset could not be parsed. The original data has NOT been changed or deleted.'));
        if (quarantineKey) {
          body.appendChild(h('p', { style: 'margin-bottom: var(--space-md); color: var(--text-muted); font-size: var(--text-sm);' },
            'A recovery copy was also stored under the key "' + quarantineKey + '".'));
        }
        body.appendChild(h('p', { style: 'margin-bottom: var(--space-lg);' },
          'Download a copy of the raw data before deciding how to continue. Nothing will be overwritten until you explicitly choose "Start fresh".'));

        const actions = h('div', { style: 'display: flex; gap: var(--space-sm); flex-wrap: wrap;' });
        actions.appendChild(h('button', {
          className: 'btn btn-primary',
          onclick: () => {
            if (typeof downloadWithFeedback === 'function') {
              const stamp = new Date().toISOString().slice(0, 10);
              downloadWithFeedback(raw, key + '-recovered-' + stamp + '.json', 'application/json');
            }
          }
        }, 'Download raw data'));
        actions.appendChild(h('button', {
          className: 'btn',
          onclick: () => location.reload()
        }, 'Try again'));
        actions.appendChild(h('button', {
          className: 'btn btn-danger',
          onclick: async () => {
            const confirmed = typeof showConfirmDialog === 'function'
              ? await showConfirmDialog(
                  'Replace the unreadable data with a new empty dataset?\n\n' +
                  (quarantineKey
                    ? 'The quarantined recovery copy will be kept under "' + quarantineKey + '".'
                    : 'Download the raw data first if you have not already — this overwrites the active key.'),
                  {
                    title: 'Start Fresh',
                    confirmLabel: 'Start Fresh',
                    cancelLabel: 'Cancel',
                    confirmClassName: 'btn btn-danger'
                  })
              : false;
            if (!confirmed) return;
            storageWriteLock = false;
            setStore(createDefaultStore());
            overlay.remove();
            save(true);
            render();
            showToast('Started a fresh dataset. The previous data remains quarantined.', 'info', 6000);
          }
        }, 'Start fresh'));
        body.appendChild(actions);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        if (typeof trapFocus === 'function') trapFocus(modal);
      }

      async function load() {
        const key = instanceKey || 'nested_cards_store';
        let raw = localStorage.getItem(key);

        // A fresh load re-decides the lock state for the (possibly new)
        // active dataset; clear any blocker left from a previous dataset.
        storageWriteLock = false;

        // Undo/redo history and the trash bin are in-memory and scoped to the
        // active dataset. A load (boot or dataset switch) must not let one
        // dataset's undo entries or trashed cards apply to another — doing so
        // could inject a foreign card object or throw mid-undo.
        if (Array.isArray(undoStack)) undoStack.length = 0;
        if (Array.isArray(redoStack)) redoStack.length = 0;
        if (Array.isArray(trashBin)) trashBin.length = 0;
        if (typeof document !== 'undefined') {
          const staleLock = document.getElementById('datasetLockScreen');
          if (staleLock) staleLock.remove();
          const staleRecovery = document.getElementById('corruptRecoveryScreen');
          if (staleRecovery) staleRecovery.remove();
        }

        if (!raw) {
          // A fresh/empty dataset must not inherit a prior dataset's session
          // PIN, or the default store would be silently encrypted with it.
          activeSessionPin = null;
          setStore(createDefaultStore());
          save();
          return;
        }

        // Detect the encrypted envelope BEFORE parsing the payload as a
        // store, so an encrypted dataset is never mistaken for (and then
        // overwritten by) an empty store (CS-001).
        let envelope = null;
        try {
          const probe = JSON.parse(raw);
          if (isEncryptedEnvelope(probe)) envelope = probe;
        } catch (_probeErr) {
          // Unparseable payloads take the corruption-recovery path below.
        }

        if (envelope) {
          const decrypted = await unlockEncryptedDataset(raw);
          if (decrypted === null) {
            // No unlock: boot with an empty in-memory store, writes locked,
            // and a lock screen offering retry/backup/switch (CS-001).
            storageWriteLock = true;
            setStore(createDefaultStore());
            updateSaveStatus('locked');
            showDatasetLockScreen(key);
            return;
          }
          raw = decrypted;
        } else if (activeSessionPin) {
          // The active dataset is not encrypted; a session PIN left over
          // from a previously open dataset must not re-encrypt it.
          activeSessionPin = null;
        }

        try {
          const parsed = JSON.parse(raw);
          setStore({
            rootOrder: parsed.rootOrder || [],
            cards: parsed.cards || {},
            plugins: parsed.plugins || {},
            bookmarks: parsed.bookmarks || [],
            recentCards: parsed.recentCards || [],
            viewMode: parsed.viewMode || 'normal',
            activeTheme: parsed.activeTheme || 'light',
            metadata: parsed.metadata || {}
          });

          if (store.metadata && store.metadata.navState) {
            setNavState({ ...navState, ...store.metadata.navState });
          }
          if (store.metadata && Array.isArray(store.metadata.navHistory)) {
            setNavHistory(store.metadata.navHistory.slice(-100));
          }

          const pinMigrated = stripLegacyPinMetadata();
          const repaired = validateStoreConsistency();
          const typedChanged = migrateTypedCards();
          if (repaired || typedChanged || pinMigrated) {
            save();
            if (repaired) showToast('Data integrity check repaired structural metadata', 'info');
          }

          const storageType = getStorageType();
          // LocalStorage is the primary committed payload. An older mirror
          // must never replace it on startup after a failed secondary write.
          if (storageType === 'localfile') {
            await readDatasetFromLocalFile()
              .then(async payload => {
                if (!payload) return;
                let parsedFile = JSON.parse(payload);
                if (isEncryptedEnvelope(parsedFile)) {
                  // Same rule as the IndexedDB mirror: an undecryptable file
                  // payload must never replace the loaded store.
                  if (!activeSessionPin) return;
                  try {
                    parsedFile = JSON.parse(await decryptStorePayload(parsedFile, activeSessionPin));
                  } catch (_fileErr) {
                    console.warn('[Local File] Payload could not be decrypted; skipping');
                    return;
                  }
                }
                if (!parsedFile || typeof parsedFile !== 'object') return;
                setStore({
                  rootOrder: parsedFile.rootOrder || [],
                  cards: parsedFile.cards || {},
                  plugins: parsedFile.plugins || {},
                  bookmarks: parsedFile.bookmarks || [],
                  recentCards: parsedFile.recentCards || [],
                  viewMode: parsedFile.viewMode || 'normal',
                  activeTheme: parsedFile.activeTheme || 'light',
                  metadata: parsedFile.metadata || store.metadata
                });
                if (store.metadata && store.metadata.navState) setNavState({ ...navState, ...store.metadata.navState });
                if (store.metadata && Array.isArray(store.metadata.navHistory)) setNavHistory(store.metadata.navHistory.slice(-100));
                const filePinMigrated = stripLegacyPinMetadata();
                const fileRepaired = validateStoreConsistency();
                const fileTypedChanged = migrateTypedCards();
                if (fileRepaired || fileTypedChanged || filePinMigrated) save();
                // Same as the IndexedDB path: pick up plugins that arrived
                // with the async payload (idempotent re-sync).
                if (window.CardSpoke && window.CardSpoke.Plugin && window.CardSpoke.Plugin.syncFromStore) {
                  window.CardSpoke.Plugin.syncFromStore()
                    .catch(err => console.error('[Plugin] Re-sync after local-file load failed:', err));
                }
                render();
              })
              .catch(err => {
                console.error('[Local File] Load failed, using LocalStorage fallback:', err);
              });
          }
        } catch (e) {
          // CS-004: never overwrite unreadable data. Quarantine a copy under
          // a recovery key, lock writes to the active key, and let the user
          // choose download / retry / start-fresh explicitly.
          console.error('[CardSpoke] Failed to parse stored data — entering recovery mode:', e);
          let quarantineKey = null;
          try {
            // Content-derived suffix so retrying (which reloads the page) on the
            // SAME corrupt payload reuses the SAME quarantine key instead of
            // accumulating a new copy every reboot and eventually exhausting
            // the storage quota.
            quarantineKey = key + '.corrupt.' + hashPayload(raw);
            localStorage.setItem(quarantineKey, raw);
          } catch (quarantineErr) {
            quarantineKey = null;
            console.error('[CardSpoke] Could not quarantine corrupt payload:', quarantineErr);
          }
          storageWriteLock = true;
          setStore(createDefaultStore());
          updateSaveStatus('locked');
          showCorruptDataRecovery(key, raw, quarantineKey);
          if (typeof showToast === 'function') {
            showToast('Stored data could not be read. Recovery options are shown — nothing has been overwritten.', 'warning', 8000);
          }
        }
      }

      // --- NAVIGATION ---

      function goTo(page, opts = {}) {
        navHistory.push({ ...navState });
        setNavState({
          // Mode-aware routing: missing mode defaults to the full CardSpoke
          // experience so existing pages/routes stay backward compatible.
          mode: opts.mode ?? navState.mode ?? 'cardspoke',
          page,
          cardId: opts.cardId ?? null,
          parentId: opts.parentId ?? null,
          searchQuery: opts.searchQuery ?? ''
        });

        // Add to recent cards when viewing a card
        if (page === 'read' && opts.cardId) {
          addToRecentCards(opts.cardId);
        }

        render();
        // A saved card opens at its heading, not the editor button scroll offset.
        if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
      }

      function goBack() {
        if (navHistory.length) {
          setNavState(navHistory.pop());
          render();
        }
      }
      
      // --- PLUGINS API ---

      // =============================================================
      // --- PLUGIN SYSTEM v2 ---
      // JSON-driven plugin loading system. Plugins are JSON packages that
      // range from simple CSS themes to deep app transformations.
      //
      // Plugin layers:
      //   theme   - CSS only. No JS execution. Safest; auto-enabled.
      //   feature - CSS + JS. Middleware hooks, DOM injection, card
      //             behavior via ctx.api. Auto-enabled unless it declares
      //             overrides.
      //   app     - CSS + JS + overrides (currently: appName). Component
      //             replacement, middleware, custom pages via ctx.api.
      //             HIGH risk; must be enabled manually by the user.
      // =============================================================
      


      // =============================================================
      // --- Modern Plugin System ---
      // Use the modern Plugin API (window.CardSpoke.Plugin) for all extensions.
      // See docs/architecture/PLUGIN_SYSTEM.md for complete plugin development documentation.
      // =============================================================

      // =============================================================
      // --- CardSpoke.utils API ---
      // Public utility API for plugin developers.
      //
      // The window.CardSpoke root object is created (and frozen) by
      // core/global-api.js before this module runs; its `utils` property is
      // a stable mutable object that this block populates in place. Do NOT
      // reassign window.CardSpoke or window.CardSpoke.utils — merge into it.
      // =============================================================

      Object.assign((window.CardSpoke && window.CardSpoke.utils) || {}, {
        createCard: async function(data) {
          data = data || {};
          var title = data.title || '';
          var body = data.body || '';
          var parentId = data.parentId || null;
          var tags = data.tags || [];
          var cardId = createCard(title, body, parentId, false, false);
          if (tags.length > 0) tags.forEach(function(tag) { addTag(cardId, tag, true); });
          save();
          render();
          return { id: cardId, card: cloneCard(store.cards[cardId]) };
        },
        updateCard: async function(cardId, changes) {
          changes = changes || {};
          if (!cardId) throw new Error('cardId is required');
          if (!store.cards[cardId]) throw new Error('Card ' + cardId + ' not found');
          var tags = changes.tags;
          var otherChanges = Object.assign({}, changes);
          delete otherChanges.tags;
          if (Object.keys(otherChanges).length > 0) updateCard(cardId, otherChanges, false, false);
          if (tags !== undefined) setTags(cardId, tags, false);
          return true;
        },
        getTags: async function(cardId) { return getTags(cardId); },
        addTag: async function(cardId, tag) { return addTag(cardId, tag, false); },
        removeTag: async function(cardId, tag) { return removeTag(cardId, tag, false); },
        setTags: async function(cardId, tags) { return setTags(cardId, tags, false); },
        getAllTags: async function() { return getAllTags(); },
        showToast: async function(message, type, duration) { showToast(message, type || 'info', duration || 3000); },
        getDatasetMeta: async function() {
          return {
            name: instanceKey,
            cardCount: Object.keys(store.cards).length,
            rootCardCount: store.rootOrder.length,
            bookmarkCount: (store.bookmarks || []).length,
            recentCount: (store.recentCards || []).length,
            modCount: Object.keys(store.plugins || {}).length,
            schemaVersion: SCHEMA_VERSION,
            appVersion: APP_VERSION
          };
        },
        getCard: async function(cardId) {
          if (!cardId) return null;
          var card = store.cards[cardId];
          return card ? cloneCard(card) : null;
        },
        searchCards: async function(query) {
          if (!query) return [];
          var lowerQuery = query.toLowerCase();
          var results = [];
          for (var id in store.cards) {
            var card = store.cards[id];
            if (card.title.toLowerCase().includes(lowerQuery) ||
                card.body.toLowerCase().includes(lowerQuery) ||
                (card.tags && card.tags.some(function(tag) { return tag.toLowerCase().includes(lowerQuery); }))) {
              results.push(cloneCard(card));
            }
          }
          return results;
        },
        getAccessibilitySettings: async function() {
          return {
            theme: store.activeTheme || 'light',
            typography: localStorage.getItem('cardspoke_typography') || 'default',
            highContrast: document.documentElement.classList.contains('high-contrast'),
            reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          };
        },
        setTheme: async function(theme) {
          if (theme !== 'light' && theme !== 'dark') throw new Error('Theme must be "light" or "dark"');
          applyTheme(theme);
          return true;
        },
        getTheme: async function() { return store.activeTheme || 'light'; },
        setTypography: async function(preset) {
          var valid = ['default', 'comfortable', 'compact', 'dyslexia'];
          if (!valid.includes(preset)) throw new Error('Preset must be one of: ' + valid.join(', '));
          localStorage.setItem('cardspoke_typography', preset);
          document.documentElement.setAttribute('data-typography', preset);
          return true;
        },
        getTypography: async function() { return localStorage.getItem('cardspoke_typography') || 'default'; },
        setHighContrast: async function(enabled) {
          if (enabled) document.documentElement.classList.add('high-contrast');
          else document.documentElement.classList.remove('high-contrast');
          localStorage.setItem('cardspoke_highcontrast', enabled.toString());
          return true;
        },
        isHighContrast: async function() { return document.documentElement.classList.contains('high-contrast'); },
        prefersReducedMotion: async function() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; },
        getThemeVariables: async function() {
          return {
            colors: ['--bg', '--surface', '--border', '--text', '--text-medium', '--text-muted', '--text-ghost'],
            typography: ['--font', '--font-brand', '--text-xs', '--text-sm', '--text-base', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl'],
            spacing: ['--space-xs', '--space-sm', '--space-md', '--space-lg', '--space-xl', '--space-2xl', '--space-3xl', '--space-4xl', '--radius'],
            accessibility: {
              highContrast: ['--hc-bg', '--hc-text', '--hc-border', '--hc-accent'],
              focus: ['--focus-outline-color', '--focus-outline-width']
            }
          };
        }
      });

      if (isDeveloperMode()) {
        console.log('[CardSpoke.utils] API initialized and available at window.CardSpoke.utils');
      }
