// Prepended to each worker setup body by scripts/build-advanced-plugins.mjs.
// No runtime imports or external dependencies. Each JSON is self-contained.
const h = ctx.h;
const text = value => String(value == null ? '' : value);
const tagsOf = card => Array.isArray(card.tags) ? card.tags : [];
const includes = (value, query) => text(value).toLowerCase().includes(text(query).toLowerCase());
const number = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.max(min, Math.min(max, Number(value))) : fallback;
let panel = null;
let queue = Promise.resolve();
let notice = '';
let draw = async () => [];
let heading = '';
let refreshButton;
const action = fn => (...args) => {
  queue = queue.then(() => fn(...args)).catch(async error => {
    notice = text(error.message || error);
    await ctx.api.ui.showToast(notice, 'error');
  });
  return queue;
};
const button = (label, fn, disabled = false) => h('button', {
  type: 'button', className: 'btn', disabled, onclick: action(fn)
}, label);
const field = (label, value, change, type = 'text') => h('label', { className: 'lab-field' }, [
  h('span', {}, label), h(type === 'textarea' ? 'textarea' : 'input', {
    type: type === 'textarea' ? undefined : type, value,
    'aria-label': label, oninput: event => { change(event.target.value); }
  }, type === 'textarea' ? value : undefined)
]);
const select = (label, value, choices, change) => h('label', { className: 'lab-field' }, [
  h('span', {}, label), h('select', { 'aria-label': label, onchange: event => { change(event.target.value); } },
    choices.map(([id, name]) => h('option', { value: id, selected: id === value }, name)))
]);
const box = children => h('div', { className: 'lab-box' }, children);
const row = children => h('div', { className: 'lab-row' }, children);
const title = card => card.title || '(Untitled)';
async function paint() {
  if (!panel) return;
  const children = await draw();
  await panel.update(h('section', { className: 'cs-lab', id: ctx.modId + '-panel', 'aria-label': heading }, [
    row([h('h2', {}, heading), button('Refresh', async () => { notice = ''; await paint(); }),
      button('Close', async () => { await panel.remove(); panel = null; })]),
    h('p', { role: 'status', className: 'lab-notice' }, notice), ...children
  ]));
}
async function start(label, render) {
  heading = label;
  draw = render;
  refreshButton = await ctx.api.ui.inject('.header', button(label, async () => {
    if (!panel) panel = await ctx.api.ui.inject('#main', h('section', {}), 'before');
    await paint();
  }), 'append');
  // Notify without replacing a form while someone is typing. Refresh is explicit.
  ctx.api.data.onUpdate(() => { notice = 'Cards changed. Refresh to see the latest data.'; });
}
async function readState(key, fallback) {
  const stored = await ctx.api.storage.get(key);
  return stored && stored.schema === 1 ? stored.value : fallback;
}
const writeState = (key, value) => ctx.api.storage.set(key, { schema: 1, value });
const cardSignature = card => JSON.stringify([card.title, card.body, tagsOf(card), card.parentId]);
