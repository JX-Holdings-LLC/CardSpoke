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

// Plugin worker lifecycle (host side)
//
// Owns the mechanics of spinning up, talking to, and killing a plugin's
// dedicated Worker. Policy (what a given ctx.api call is actually allowed to
// do) lives in plugin-api.js, which supplies the `onCall` handler; this
// module only knows how to construct the worker, wait for it to report
// ready, wire an RPC channel to it, and terminate it — including forcibly,
// for a hung or misbehaving plugin, which is not possible for main-thread
// code.

import { createRpcChannel } from './plugin-rpc.js';

const WORKER_SCRIPT_URL = './plugin-worker-bootstrap.js';
const READY_TIMEOUT_MS = 5000;

/**
 * Create and initialize a dedicated worker for one plugin instance.
 *
 * @param {string} pluginId
 * @param {object} initPayload - { js, teardownJs, permissions, config, appVersion, schemaVersion }
 * @param {(path: string[], args: any[]) => any} onCall - host-side RPC dispatcher
 * @returns {Promise<PluginWorkerHandle>}
 */
export async function createPluginWorker(pluginId, initPayload, onCall) {
  const worker = new Worker(WORKER_SCRIPT_URL, { type: 'module' });

  let terminated = false;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const readyTimer = setTimeout(() => readyReject(new Error('Plugin worker for "' + pluginId + '" failed to start')), READY_TIMEOUT_MS);

  const channel = createRpcChannel({
    postMessage: (msg) => {
      if (terminated) throw new Error('Plugin worker was terminated');
      worker.postMessage(msg);
    },
    addListener: (handler) => {
      worker.addEventListener('message', (evt) => {
        const data = evt.data;
        if (data && data.kind === 'ready') {
          clearTimeout(readyTimer);
          readyResolve();
          return;
        }
        handler(data);
      });
    },
    onCall: onCall
  });

  let onError = () => {};
  worker.addEventListener('error', (evt) => {
    readyReject(new Error('Plugin worker failed to start: ' + (evt.message || 'unknown error')));
    channel.rejectAll(new Error('Plugin worker error: ' + (evt.message || 'unknown error')));
    onError(evt);
  });
  worker.addEventListener('messageerror', () => {
    channel.rejectAll(new Error('Plugin worker sent an unclonable message'));
  });

  try {
    await ready;
    await channel.call(['lifecycle', 'init'], [Object.assign({ id: pluginId }, initPayload)], { timeoutMs: READY_TIMEOUT_MS });
  } catch (error) {
    terminate();
    throw error;
  }

  function terminate() {
    if (terminated) return;
    terminated = true;
    clearTimeout(readyTimer);
    channel.rejectAll(new Error('Plugin "' + pluginId + '" worker was terminated'));
    worker.terminate();
  }

  return {
    channel,
    terminate,
    onError: (fn) => { onError = fn; },
    /**
     * Race a call against a deadline; on timeout, forcibly terminate the
     * worker (a capability main-thread plugin execution never had — a hung
     * `while(true){}` in a worker can be killed outright instead of freezing
     * the whole app).
     */
    async callWithDeadline(path, args, timeoutMs) {
      let timer = null;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Plugin "' + pluginId + '" timed out after ' + timeoutMs + 'ms')), timeoutMs);
      });
      try {
        return await Promise.race([channel.call(path, args), timeout]);
      } catch (error) {
        terminate();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    isHung(hangThresholdMs) {
      return terminated || channel.oldestPendingAgeMs() > hangThresholdMs;
    }
  };
}
