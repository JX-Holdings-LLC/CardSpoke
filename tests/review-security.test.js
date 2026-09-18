import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { createRpcChannel, dispatch } from '../www/src/core/plugin-rpc.js';
import { h, vnodeToDOM, updateElementFromVnode } from '../www/src/core/plugin-vnode.js';
import { createPluginWorker } from '../www/src/core/plugin-worker-manager.js';
import { installFakeWorkerGlobal } from './helpers/fake-worker-global.js';

test('RPC only invokes own exported methods and rejects constructor traversal', () => {
  const api = { data: { value: 7, get() { return this.value; } } };
  assert.is(dispatch(api, ['data', 'get'], []), 7);
  for (const path of [['constructor'], ['data', 'get', 'constructor'], ['__proto__', 'toString'], ['data', 'toString'], ['data', 'get', 'call'], ['data', {}]]) {
    assert.throws(() => dispatch(api, path, ['return globalThis']), /RPC/);
  }
  assert.throws(() => dispatch(api, ['data', 'get'], {}), /RPC/);
});

test('RPC preserves prototype-shaped data as inert own properties', async () => {
  let hostListener, workerListener;
  const host = createRpcChannel({ postMessage: msg => queueMicrotask(() => workerListener(structuredClone(msg))), addListener: fn => { hostListener = fn; }, onCall: (_path, args) => args[0] });
  const worker = createRpcChannel({ postMessage: msg => queueMicrotask(() => hostListener(structuredClone(msg))), addListener: fn => { workerListener = fn; } });
  const value = await worker.call(['echo'], [JSON.parse('{"__proto__":{"polluted":true},"title":"safe"}')]);
  assert.is(Object.getPrototypeOf(value), Object.prototype);
  assert.ok(Object.hasOwn(value, '__proto__'));
  assert.is(value.polluted, undefined);
  assert.is(host.pendingCount(), 0);
});

function element(tag) {
  return { tag, attrs: {}, style: {}, dataset: {}, children: [], listeners: [],
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); }, removeChild() { this.children.shift(); },
    get firstChild() { return this.children[0]; }, get attributes() { return Object.keys(this.attrs).map(name => ({ name })); },
    addEventListener(type, fn) { this.listeners.push([type, fn]); },
    removeEventListener(type, fn) { this.listeners = this.listeners.filter(x => x[0] !== type || x[1] !== fn); }
  };
}
test('worker UI rejects active elements, inline handlers and unsafe URLs', () => {
  global.document = { createElement: element, createTextNode: text => ({ text }) };
  for (const tag of ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'svg', 'custom-element']) assert.throws(() => vnodeToDOM(h(tag)), /Unsupported/);
  for (const props of [{ onclick: 'alert(1)' }, { srcdoc: '<script></script>' }, { href: 'java\nscript:alert(1)' }, { href: 'javascript:alert(1)' }, { src: 'https://example.com/track' }]) assert.throws(() => vnodeToDOM(h('a', props)), /Unsupported|callbacks/);
  assert.is(vnodeToDOM(h('button', { 'aria-label': 'Save', onclick() {} }, 'Save')).listeners.length, 1);
});
test('updating plugin UI replaces event listeners instead of accumulating them', () => {
  global.document = { createElement: element, createTextNode: text => ({ text }) };
  const el = vnodeToDOM(h('button', { onclick() {} }));
  updateElementFromVnode(el, h('button', { onclick() {} }));
  updateElementFromVnode(el, h('button', {}));
  assert.is(el.listeners.length, 0);
});

test('failed worker initialization terminates its worker', async () => {
  installFakeWorkerGlobal();
  let terminated = false;
  const Base = global.Worker;
  global.Worker = class extends Base { terminate() { terminated = true; super.terminate(); } };
  try {
    let failed = false;
    try { await createPluginWorker('bad-init', { js: 'invalid syntax {{{' }, () => {}); } catch { failed = true; }
    assert.ok(failed);
    assert.ok(terminated);
  } finally { global.Worker = Base; }
});

test('worker deadline terminates a genuinely busy worker', async () => {
  installFakeWorkerGlobal();
  const worker = await createPluginWorker('deadline', { js: 'while (true) {}' }, () => {});
  try {
    let failed = false;
    try { await worker.callWithDeadline(['lifecycle', 'runSetup'], [], 30); } catch { failed = true; }
    assert.ok(failed);
    assert.is(worker.channel.pendingCount(), 0);
  } finally { worker.terminate(); }
});
test.run();
