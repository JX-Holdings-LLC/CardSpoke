#!/usr/bin/env node
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
 * CardSpoke command-line interface.
 *
 * Drives the headless Kernel (www/src/kernel.js) against a CardSpoke JSON
 * file on disk: an instance backup exported from the app ("Export JSON"),
 * or a raw dataset payload such as a local-file dataset. Designed to be
 * scriptable and easy for AI agents to drive: every command accepts --json
 * for machine-readable output, errors exit non-zero, and nothing touches
 * the network.
 *
 * See docs/guides/CLI.md for the full reference.
 */

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname, basename } from 'path';
import { Kernel, normalizeCardName, parseCardLinks, uid } from '../www/src/kernel.js';
import { migrateStore } from '../www/src/core/migrations.js';
import { APP_VERSION, SCHEMA_VERSION, createDefaultStore } from '../www/src/state.js';
import { encryptStorePayload, decryptStorePayload, isEncryptedEnvelope } from '../www/src/core/dataset-crypto.js';

// ── Errors and output ────────────────────────────────────────────────────────

class CliError extends Error {
  constructor(message, { code = 'error', exitCode = 1, details } = {}) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

const usageError = (message) => new CliError(message, { code: 'usage', exitCode: 2 });

// ── Argument parsing ─────────────────────────────────────────────────────────

const BOOLEAN_FLAGS = new Set([
  'json', 'dry-run', 'help', 'force', 'with-children', 'tree', 'append', 'body-stdin',
  'fix', 'stdout', 'include-body', 'exact', 'yes'
]);
const REPEATABLE_FLAGS = new Set(['tag']);
const SHORT_FLAGS = { f: 'file', h: 'help', p: 'parent', t: 'title', b: 'body', o: 'out', n: 'limit' };

/**
 * Parse argv into positionals and flags. Supports --key value, --key=value,
 * --no-key, short aliases, repeatable flags and a bare "--" terminator.
 */
export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  const setFlag = (key, value) => {
    if (REPEATABLE_FLAGS.has(key)) (flags[key] ||= []).push(value);
    else flags[key] = value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (arg.startsWith('--') || (/^-[a-z]$/i.test(arg) && SHORT_FLAGS[arg[1]])) {
      let key; let value;
      if (arg.startsWith('--')) {
        const eq = arg.indexOf('=');
        key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
        if (eq !== -1) value = arg.slice(eq + 1);
      } else {
        key = SHORT_FLAGS[arg[1]];
      }
      if (key.startsWith('no-') && BOOLEAN_FLAGS.has(key.slice(3))) { flags[key.slice(3)] = false; continue; }
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = value === undefined ? true : !/^(false|0|no)$/i.test(value);
        continue;
      }
      if (value === undefined) {
        if (i + 1 >= argv.length) throw usageError(`Flag --${key} requires a value`);
        value = argv[++i];
      }
      setFlag(key, value);
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

// ── Dataset file I/O ─────────────────────────────────────────────────────────

/**
 * Load a CardSpoke file. Accepts an instance backup (exportType 'instance',
 * rootIds) or a raw dataset payload (rootOrder), optionally wrapped in an
 * encrypted envelope. Returns a normalized store plus how to write it back.
 */
export async function loadDataset(filePath, { pin } = {}) {
  if (!existsSync(filePath)) {
    throw new CliError(`Dataset file not found: ${filePath} (create one with "cardspoke init")`, { code: 'not_found' });
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new CliError(`Invalid JSON in ${filePath}: ${err.message}`, { code: 'invalid_file' });
  }

  let encrypted = false;
  if (isEncryptedEnvelope(parsed)) {
    if (!pin) throw new CliError('This dataset is PIN-encrypted. Pass --pin or set CARDSPOKE_PIN.', { code: 'pin_required' });
    try {
      parsed = JSON.parse(await decryptStorePayload(JSON.stringify(parsed), pin));
    } catch (_err) {
      throw new CliError('Could not decrypt the dataset: wrong PIN or corrupted file.', { code: 'pin_invalid' });
    }
    encrypted = true;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('Not a CardSpoke dataset: the file must contain a JSON object.', { code: 'invalid_file' });
  }
  if (parsed.exportType === 'plugins') {
    throw new CliError('This is a plugins-only export; it contains no cards.', { code: 'invalid_file' });
  }
  if (parsed.cards !== undefined && (typeof parsed.cards !== 'object' || parsed.cards === null || Array.isArray(parsed.cards))) {
    throw new CliError('Not a CardSpoke dataset: "cards" must be an object.', { code: 'invalid_file' });
  }
  if (typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > SCHEMA_VERSION) {
    throw new CliError(
      `This file uses schema v${parsed.schemaVersion}; this CLI supports schema v${SCHEMA_VERSION}. ` +
      'Upgrade CardSpoke before editing it.', { code: 'schema_unsupported' });
  }

  const format = parsed.exportType === 'instance' ? 'instance' : 'store';
  const { rootIds, ...rest } = parsed;
  const store = { ...createDefaultStore(), ...rest, cards: parsed.cards || {} };
  store.rootOrder = format === 'instance'
    ? (Array.isArray(rootIds) ? rootIds.slice() : [])
    : (Array.isArray(parsed.rootOrder) ? parsed.rootOrder.slice() : []);
  for (const [id, card] of Object.entries(store.cards)) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
      throw new CliError(`Invalid card structure for ID: ${id}`, { code: 'invalid_file' });
    }
  }
  migrateStore(store);
  return { store, format, encrypted, pin: encrypted ? pin : null };
}

/** Serialize a store in the given file format. */
export function serializeDataset(store, format) {
  if (format === 'instance') {
    const { rootOrder, exportType: _e, formatVersion: _f, appVersion: _a, schemaVersion: _s, timestamp: _t, ...rest } = store;
    const metadata = { ...(store.metadata || {}) };
    delete metadata.pin;
    delete metadata.storageConfig;
    return {
      exportType: 'instance',
      formatVersion: 2,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      timestamp: Date.now(),
      ...rest,
      cards: store.cards,
      rootIds: rootOrder,
      metadata
    };
  }
  // Raw dataset payload (e.g. a local-file dataset). Bump persistedAt so the
  // app treats this copy as the newest revision on its next boot.
  const metadata = { ...(store.metadata || {}) };
  metadata.persistedAt = Math.max(Date.now(), (Number(metadata.persistedAt) || 0) + 1);
  return { ...store, metadata };
}

/** Write atomically (temp file + rename) so a crash never truncates data. */
export async function saveDataset(filePath, dataset) {
  const data = serializeDataset(dataset.store, dataset.format);
  let text = JSON.stringify(data, null, 2) + '\n';
  if (dataset.encrypted) text = await encryptStorePayload(JSON.stringify(data), dataset.pin);
  const tmp = resolve(dirname(filePath), `.${basename(filePath)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, filePath);
  } catch (err) {
    try { unlinkSync(tmp); } catch (_ignored) { /* nothing to clean up */ }
    throw new CliError(`Could not write ${filePath}: ${err.message}`, { code: 'write_failed' });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function kernelFor(store) {
  return new Kernel({ cards: store.cards, rootOrder: store.rootOrder });
}

function commitKernel(store, kernel) {
  const snap = kernel.snapshot();
  store.cards = snap.cards;
  store.rootOrder = snap.rootOrder;
  // Keep bookmarks / recents pointing only at cards that still exist.
  store.bookmarks = (store.bookmarks || []).filter(id => Object.hasOwn(store.cards, id));
  store.recentCards = (store.recentCards || []).filter(id => Object.hasOwn(store.cards, id));
}

/**
 * Resolve a card reference: an exact ID, else a unique (case-insensitive)
 * title. "root" resolves to null where allowRoot is set.
 */
function resolveCard(store, ref, { allowRoot = false, label = 'card' } = {}) {
  if (ref === undefined || ref === null || ref === '' || ref === true) throw usageError(`Missing ${label} ID or title`);
  ref = String(ref);
  if (allowRoot && ref.toLowerCase() === 'root') return null;
  if (Object.hasOwn(store.cards, ref)) return ref;
  const target = normalizeCardName(ref);
  const matches = Object.values(store.cards).filter(c => normalizeCardName(c.title) === target);
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    throw new CliError(`"${ref}" matches ${matches.length} cards by title; use an ID instead.`, {
      code: 'ambiguous', details: { matches: matches.map(c => ({ id: c.id, title: c.title, path: pathOf(store, c.id) })) }
    });
  }
  throw new CliError(`No ${label} found with ID or title "${ref}"`, { code: 'not_found' });
}

function pathOf(store, id) {
  const titles = [];
  const seen = new Set();
  let current = store.cards[id];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    titles.unshift(current.title || '(Untitled)');
    current = current.parentId ? store.cards[current.parentId] : null;
  }
  return titles.join(' / ');
}

function summarize(store, card, { includeBody = false } = {}) {
  const out = {
    id: card.id,
    title: card.title || '',
    parentId: card.parentId || null,
    path: pathOf(store, card.id),
    tags: card.tags || [],
    childCount: (card.children || []).length,
    createdAt: card.createdAt || null,
    updatedAt: card.updatedAt || null
  };
  if (includeBody) out.body = card.body || '';
  return out;
}

function readBody(flags, io) {
  if (flags['body-file'] !== undefined) {
    const file = flags['body-file'] === '-' ? 0 : resolve(io.cwd, flags['body-file']);
    try { return readFileSync(file, 'utf8'); } catch (err) {
      throw new CliError(`Could not read body file: ${err.message}`, { code: 'read_failed' });
    }
  }
  if (flags['body-stdin']) return readFileSync(0, 'utf8');
  if (flags.body !== undefined) return String(flags.body);
  return undefined;
}

function tagList(flags) {
  return (flags.tag || []).flatMap(t => String(t).split(',')).map(t => t.trim()).filter(Boolean);
}

function parseIntFlag(value, name, { min = 0 } = {}) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw usageError(`--${name} must be an integer >= ${min}`);
  return n;
}

function walk(store, ids, visit, depth = 0, seen = new Set()) {
  for (const id of ids) {
    const card = store.cards[id];
    if (!card || seen.has(id)) continue;
    seen.add(id);
    if (visit(card, depth) === false) continue;
    walk(store, card.children || [], visit, depth + 1, seen);
  }
}

function buildTree(store, ids, maxDepth, depth = 0, seen = new Set()) {
  const nodes = [];
  for (const id of ids) {
    const card = store.cards[id];
    if (!card || seen.has(id)) continue;
    seen.add(id);
    const node = { id: card.id, title: card.title || '', tags: card.tags || [] };
    if (maxDepth === undefined || depth < maxDepth) {
      node.children = buildTree(store, card.children || [], maxDepth, depth + 1, seen);
    } else {
      node.childCount = (card.children || []).length;
    }
    nodes.push(node);
  }
  return nodes;
}

function renderTree(nodes, prefix = '') {
  const lines = [];
  nodes.forEach((node, i) => {
    const last = i === nodes.length - 1;
    const tags = node.tags.length ? '  ' + node.tags.map(t => '#' + t).join(' ') : '';
    const more = node.childCount ? `  (+${node.childCount})` : '';
    lines.push(`${prefix}${last ? '└─ ' : '├─ '}${node.title || '(Untitled)'}  [${node.id}]${tags}${more}`);
    if (node.children) lines.push(...renderTree(node.children, prefix + (last ? '   ' : '│  ')));
  });
  return lines;
}

function cardLine(c) {
  const tags = c.tags && c.tags.length ? '  ' + c.tags.map(t => '#' + t).join(' ') : '';
  return `${c.id}  ${c.path || c.title || '(Untitled)'}${tags}`;
}

/** Integrity check over the hierarchy. Returns a list of issues. */
function findIssues(store) {
  const issues = [];
  const cards = store.cards;
  for (const [id, card] of Object.entries(cards)) {
    if (card.id !== id) issues.push({ type: 'id_mismatch', id, message: `Card key ${id} has id ${card.id}` });
    if (card.parentId && !Object.hasOwn(cards, card.parentId)) {
      issues.push({ type: 'missing_parent', id, message: `Parent ${card.parentId} does not exist` });
    } else if (card.parentId && !(cards[card.parentId].children || []).includes(id)) {
      issues.push({ type: 'not_in_parent_children', id, message: `Not listed in parent ${card.parentId}'s children` });
    }
    if (!card.parentId && !store.rootOrder.includes(id)) {
      issues.push({ type: 'not_in_root_order', id, message: 'Root card missing from root order' });
    }
    for (const childId of card.children || []) {
      if (!Object.hasOwn(cards, childId)) issues.push({ type: 'missing_child', id, message: `Child ${childId} does not exist` });
      else if (cards[childId].parentId !== id) issues.push({ type: 'child_parent_mismatch', id, message: `Child ${childId} names a different parent` });
    }
  }
  for (const id of store.rootOrder) {
    if (!Object.hasOwn(cards, id)) issues.push({ type: 'missing_root', id, message: `Root order lists missing card ${id}` });
    else if (cards[id].parentId && Object.hasOwn(cards, cards[id].parentId)) {
      issues.push({ type: 'root_has_parent', id, message: 'Listed at root but has a parent' });
    }
  }
  // Cycles in the parent chain.
  for (const id of Object.keys(cards)) {
    const seen = new Set();
    let current = cards[id];
    while (current && current.parentId) {
      if (seen.has(current.id)) { issues.push({ type: 'cycle', id, message: 'Parent chain contains a cycle' }); break; }
      seen.add(current.id);
      current = cards[current.parentId];
    }
  }
  return issues;
}

/** Repair the hierarchy so parentId, children and rootOrder agree. */
function repairHierarchy(store) {
  const cards = store.cards;
  for (const [id, card] of Object.entries(cards)) card.id = id;
  // Break cycles by detaching the card that closes the loop.
  for (const id of Object.keys(cards)) {
    const seen = new Set([id]);
    let current = cards[id];
    while (current && current.parentId && Object.hasOwn(cards, current.parentId)) {
      if (seen.has(current.parentId)) { current.parentId = null; break; }
      seen.add(current.parentId);
      current = cards[current.parentId];
    }
  }
  for (const card of Object.values(cards)) {
    if (card.parentId && !Object.hasOwn(cards, card.parentId)) card.parentId = null;
  }
  // Children: keep declared order for valid children, then append any
  // card that names this parent but was not listed.
  for (const [id, card] of Object.entries(cards)) {
    const kept = [];
    for (const childId of card.children || []) {
      if (Object.hasOwn(cards, childId) && cards[childId].parentId === id && !kept.includes(childId)) kept.push(childId);
    }
    card.children = kept;
  }
  for (const [id, card] of Object.entries(cards)) {
    if (card.parentId && !cards[card.parentId].children.includes(id)) cards[card.parentId].children.push(id);
  }
  const root = [];
  for (const id of store.rootOrder) {
    if (Object.hasOwn(cards, id) && !cards[id].parentId && !root.includes(id)) root.push(id);
  }
  for (const [id, card] of Object.entries(cards)) if (!card.parentId && !root.includes(id)) root.push(id);
  store.rootOrder = root;
}

function csvCell(value) {
  let text = String(value == null ? '' : value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function exportText(store, format, rootIds) {
  if (format === 'json') {
    const sub = rootIds === store.rootOrder ? store : subsetStore(store, rootIds);
    return JSON.stringify(serializeDataset(sub, 'instance'), null, 2) + '\n';
  }
  if (format === 'csv') {
    let csv = 'ID,Title,Body,Parent ID,Tags,Children Count,Created,Updated\n';
    walk(store, rootIds, card => {
      csv += [card.id, card.title || '', card.body || '', card.parentId || '', (card.tags || []).join(';'),
        (card.children || []).length, card.createdAt || '', card.updatedAt || ''].map(csvCell).join(',') + '\n';
    });
    return csv;
  }
  if (format === 'md' || format === 'markdown') {
    let md = '# CardSpoke Export\n\n';
    walk(store, rootIds, (card, depth) => {
      md += `${'#'.repeat(Math.min(depth + 1, 6))} ${card.title || '(Untitled)'}\n\n`;
      if (card.tags && card.tags.length) md += `*Tags: ${card.tags.map(t => '`' + t + '`').join(', ')}*\n\n`;
      if (card.body) md += `${card.body}\n\n`;
    });
    return md;
  }
  if (format === 'txt' || format === 'outline') {
    let txt = '';
    walk(store, rootIds, (card, depth) => {
      const indent = '  '.repeat(depth);
      txt += `${indent}${card.title || '(Untitled)'}\n`;
      if (format === 'txt' && card.body) txt += `${indent}  ${card.body.replace(/\n/g, '\n' + indent + '  ')}\n`;
    });
    return txt;
  }
  throw usageError(`Unknown export format "${format}" (use json, md, txt, outline or csv)`);
}

function subsetStore(store, rootIds) {
  const cards = {};
  walk(store, rootIds, card => { cards[card.id] = card; });
  const rootOrder = rootIds.filter(id => cards[id]);
  const sub = { ...store, cards: {}, rootOrder, bookmarks: [], recentCards: [], plugins: {} };
  for (const [id, card] of Object.entries(cards)) {
    sub.cards[id] = { ...card, parentId: rootOrder.includes(id) ? null : card.parentId };
  }
  return sub;
}

/**
 * Merge cards from another CardSpoke JSON package under parentId, remapping
 * every ID (same rules as the app's Import JSON). Returns the new root IDs.
 */
function importPackage(store, pkg, parentId) {
  const idMap = Object.create(null);
  const remapped = {};
  for (const [oldId, card] of Object.entries(pkg.cards || {})) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) continue;
    const newId = uid();
    idMap[oldId] = newId;
    remapped[newId] = { ...card, id: newId };
  }
  for (const card of Object.values(remapped)) {
    card.children = (Array.isArray(card.children) ? card.children : []).map(c => idMap[c]).filter(Boolean);
    card.parentId = (card.parentId && idMap[card.parentId]) || null;
  }
  const declared = Array.isArray(pkg.rootIds) ? pkg.rootIds : (Array.isArray(pkg.rootOrder) ? pkg.rootOrder : []);
  const roots = declared.map(id => idMap[id]).filter(id => id && !remapped[id].parentId);
  for (const [id, card] of Object.entries(remapped)) if (!card.parentId && !roots.includes(id)) roots.push(id);
  Object.assign(store.cards, remapped);
  for (const id of roots) {
    store.cards[id].parentId = parentId;
    if (parentId) store.cards[parentId].children.push(id);
    else store.rootOrder.push(id);
  }
  migrateStore(store);
  return { rootIds: roots, count: Object.keys(remapped).length };
}

/** Build cards from an indented outline (2 spaces per level). */
function importOutline(kernel, text, parentId) {
  const created = [];
  const stack = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const indent = line.replace(/\t/g, '  ').search(/\S/);
    let depth = Math.floor(indent / 2);
    depth = Math.min(depth, stack.length);
    const title = line.trim().replace(/^[-*+]\s+/, '');
    const parent = depth > 0 ? stack[depth - 1] : parentId;
    const { id } = kernel.createCard(title, '', parent);
    stack[depth] = id;
    stack.length = depth + 1;
    created.push(id);
  }
  return created;
}

function searchCards(store, query, { tags = [], limit, includeBody }) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  for (const card of Object.values(store.cards)) {
    const cardTags = card.tags || [];
    if (!tags.every(t => cardTags.includes(t))) continue;
    const title = (card.title || '').toLowerCase();
    const body = (card.body || '').toLowerCase();
    let score = 0;
    let ok = true;
    for (const term of terms) {
      const bare = term.replace(/^#/, '');
      let s = 0;
      if (title === term) s += 10;
      else if (title.startsWith(term)) s += 6;
      else if (title.includes(term)) s += 4;
      if (cardTags.includes(bare)) s += 3;
      if (body.includes(term)) s += 1;
      if (!s) { ok = false; break; }
      score += s;
    }
    if (!ok) continue;
    const result = { ...summarize(store, card, { includeBody }), score };
    if (terms.length && !includeBody) {
      const idx = body.indexOf(terms[0]);
      if (idx !== -1) {
        const start = Math.max(0, idx - 40);
        result.snippet = (start > 0 ? '…' : '') + (card.body || '').slice(start, idx + 80).replace(/\s+/g, ' ').trim() + '…';
      }
    }
    results.push(result);
  }
  results.sort((a, b) => b.score - a.score || (b.updatedAt || 0) - (a.updatedAt || 0));
  return limit !== undefined ? results.slice(0, limit) : results;
}

// ── Commands ─────────────────────────────────────────────────────────────────
//
// Each command returns { data, text, write }. `data` is what --json prints,
// `text` is the human rendering, and `write` asks the runner to save.

const COMMANDS = {};

function command(name, spec) { COMMANDS[name] = spec; }

command('init', {
  summary: 'Create a new, empty dataset file',
  usage: 'init [--force] [--format instance|store] [--pin PIN]',
  needsDataset: false,
  async run({ flags, filePath, pin }) {
    if (existsSync(filePath) && !flags.force) {
      throw new CliError(`${filePath} already exists (pass --force to overwrite)`, { code: 'exists' });
    }
    const format = flags.format || 'instance';
    if (!['instance', 'store'].includes(format)) throw usageError('--format must be "instance" or "store"');
    const dataset = { store: { ...createDefaultStore(), metadata: {} }, format, encrypted: !!pin, pin: pin || null };
    return { dataset, write: true, data: { file: filePath, format, encrypted: !!pin }, text: `Created ${filePath}` };
  }
});

command('info', {
  summary: 'Show dataset statistics',
  usage: 'info',
  run({ store, dataset, filePath }) {
    const cards = Object.values(store.cards);
    let maxDepth = 0;
    walk(store, store.rootOrder, (_c, depth) => { maxDepth = Math.max(maxDepth, depth + 1); });
    const data = {
      file: filePath,
      format: dataset.format,
      encrypted: dataset.encrypted,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      cardCount: cards.length,
      rootCount: store.rootOrder.length,
      maxDepth,
      tagCount: new Set(cards.flatMap(c => c.tags || [])).size,
      bookmarkCount: (store.bookmarks || []).length,
      pluginCount: Object.keys(store.plugins || {}).length,
      lastUpdated: cards.reduce((m, c) => Math.max(m, c.updatedAt || 0), 0) || null
    };
    const text = [
      `File:       ${data.file} (${data.format}${data.encrypted ? ', encrypted' : ''})`,
      `Cards:      ${data.cardCount} (${data.rootCount} at root, max depth ${data.maxDepth})`,
      `Tags:       ${data.tagCount}`,
      `Bookmarks:  ${data.bookmarkCount}`,
      `Plugins:    ${data.pluginCount}`,
      `Updated:    ${data.lastUpdated ? new Date(data.lastUpdated).toISOString() : 'never'}`
    ].join('\n');
    return { data, text };
  }
});

command('list', {
  summary: 'List the direct children of a card (default: root cards)',
  usage: 'list [--parent ID|root] [--tag TAG] [--include-body]',
  run({ store, flags }) {
    const parentId = flags.parent !== undefined ? resolveCard(store, flags.parent, { allowRoot: true, label: 'parent' }) : null;
    const tags = tagList(flags);
    const ids = parentId ? store.cards[parentId].children : store.rootOrder;
    const cards = ids.map(id => store.cards[id]).filter(Boolean)
      .filter(c => tags.every(t => (c.tags || []).includes(t)))
      .map(c => summarize(store, c, { includeBody: flags['include-body'] }));
    return { data: { parentId, cards }, text: cards.length ? cards.map(cardLine).join('\n') : '(no cards)' };
  }
});

command('tree', {
  summary: 'Show the card hierarchy (whole dataset or one subtree)',
  usage: 'tree [ID] [--depth N]',
  run({ store, positionals, flags }) {
    const depth = parseIntFlag(flags.depth, 'depth', { min: 1 });
    const rootId = positionals[0] !== undefined ? resolveCard(store, positionals[0], { allowRoot: true }) : null;
    const ids = rootId ? [rootId] : store.rootOrder;
    const tree = buildTree(store, ids, depth);
    return { data: { rootId, tree }, text: tree.length ? renderTree(tree).join('\n') : '(empty dataset)' };
  }
});

command('show', {
  summary: 'Show one card with its body, children, links and backlinks',
  usage: 'show ID',
  run({ store, positionals }) {
    const id = resolveCard(store, positionals[0]);
    const card = store.cards[id];
    const kernel = kernelFor(store);
    const links = kernel.resolveCardLinks(card.body || '').map(l => ({ title: l.link.cardName, id: l.cardId }));
    const data = {
      ...summarize(store, card, { includeBody: true }),
      isRichText: !!card.isRichText,
      bookmarked: (store.bookmarks || []).includes(id),
      children: (card.children || []).map(cid => store.cards[cid]).filter(Boolean).map(c => ({ id: c.id, title: c.title || '' })),
      links,
      backlinks: kernel.getBacklinks(id),
      related: kernel.getRelatedCards(id, 5).map(r => ({ id: r.id, title: r.title, matchedTags: r.matchedTags }))
    };
    const lines = [
      `# ${data.title || '(Untitled)'}`,
      `ID:       ${data.id}`,
      `Path:     ${data.path}`,
      `Tags:     ${data.tags.length ? data.tags.map(t => '#' + t).join(' ') : '-'}`,
      `Updated:  ${data.updatedAt ? new Date(data.updatedAt).toISOString() : '-'}`,
      '',
      data.body || '(no body)'
    ];
    if (data.children.length) lines.push('', 'Children:', ...data.children.map(c => `  ${c.id}  ${c.title}`));
    if (links.length) lines.push('', 'Links:', ...links.map(l => `  [[${l.title}]] → ${l.id || '(unresolved)'}`));
    if (data.backlinks.length) lines.push('', 'Backlinks:', ...data.backlinks.map(b => `  ${b.id}  ${b.title}`));
    return { data, text: lines.join('\n') };
  }
});

command('create', {
  summary: 'Create a card',
  usage: 'create TITLE [--body TEXT | --body-file FILE | --body-stdin] [--parent ID] [--tag TAG]... [--index N]',
  run({ store, positionals, flags, io }) {
    const title = flags.title !== undefined ? String(flags.title) : positionals.join(' ');
    if (!title.trim()) throw usageError('A title is required: cardspoke create "My card"');
    const parentId = flags.parent !== undefined ? resolveCard(store, flags.parent, { allowRoot: true, label: 'parent' }) : null;
    const body = readBody(flags, io) || '';
    const kernel = kernelFor(store);
    const { id } = kernel.createCard(title, body, parentId);
    const tags = tagList(flags);
    if (tags.length) kernel.setTags(id, tags);
    const index = parseIntFlag(flags.index, 'index');
    if (index !== undefined) kernel.reorder(id, index);
    commitKernel(store, kernel);
    const card = summarize(store, store.cards[id]);
    return { write: true, data: card, text: `Created ${id}  ${card.path}` };
  }
});

command('update', {
  summary: 'Update a card\'s title and/or body (renames rewrite [[links]])',
  usage: 'update ID [--title TITLE] [--body TEXT | --body-file FILE | --body-stdin] [--append] [--rich-text true|false]',
  run({ store, positionals, flags, io }) {
    const id = resolveCard(store, positionals[0]);
    const before = store.cards[id];
    const updates = {};
    if (flags.title !== undefined) updates.title = String(flags.title);
    const body = readBody(flags, io);
    if (body !== undefined) {
      updates.body = flags.append && before.body ? before.body.replace(/\s+$/, '') + '\n\n' + body : body;
    }
    if (flags['rich-text'] !== undefined) updates.isRichText = /^(true|1|yes)$/i.test(String(flags['rich-text']));
    if (!Object.keys(updates).length) throw usageError('Nothing to update: pass --title, --body, --body-file, --body-stdin or --rich-text');
    const kernel = kernelFor(store);
    // Same rule as the app: a rename rewrites [[Old Title]] links only when
    // the old title identified this card alone.
    let rewritten = [];
    const renaming = updates.title !== undefined && before.title &&
      normalizeCardName(updates.title) && normalizeCardName(updates.title) !== normalizeCardName(before.title) &&
      kernel.findCardsByName(before.title).length === 1 && !/[[\]]/.test(updates.title);
    kernel.updateCard(id, updates);
    if (renaming) rewritten = kernel.rewriteCardLinks(before.title, updates.title).map(c => ({ id: c.id, count: c.count }));
    commitKernel(store, kernel);
    const card = summarize(store, store.cards[id]);
    const text = `Updated ${id}  ${card.path}` + (rewritten.length ? `\nRewrote links in ${rewritten.length} card(s)` : '');
    return { write: true, data: { ...card, rewrittenLinks: rewritten }, text };
  }
});

command('delete', {
  summary: 'Permanently delete a card and all of its descendants',
  usage: 'delete ID',
  run({ store, positionals }) {
    const id = resolveCard(store, positionals[0]);
    const kernel = kernelFor(store);
    const { affectedChildIds } = kernel.deleteCard(id);
    commitKernel(store, kernel);
    return { write: true, data: { deleted: affectedChildIds }, text: `Deleted ${affectedChildIds.length} card(s)` };
  }
});

command('move', {
  summary: 'Move a card under a new parent (or to root) and/or reorder it',
  usage: 'move ID [--parent ID|root] [--index N]',
  run({ store, positionals, flags }) {
    const id = resolveCard(store, positionals[0]);
    const index = parseIntFlag(flags.index, 'index');
    if (flags.parent === undefined && index === undefined) throw usageError('Pass --parent and/or --index');
    const kernel = kernelFor(store);
    if (flags.parent !== undefined) {
      const parentId = resolveCard(store, flags.parent, { allowRoot: true, label: 'parent' });
      if ((store.cards[id].parentId || null) !== parentId) {
        const { success } = kernel.reparent(id, parentId);
        if (!success) throw new CliError('Cannot move a card into itself or its own descendants', { code: 'invalid_move' });
      }
    }
    if (index !== undefined) kernel.reorder(id, index);
    commitKernel(store, kernel);
    const card = summarize(store, store.cards[id]);
    return { write: true, data: card, text: `Moved ${id}  ${card.path}` };
  }
});

command('duplicate', {
  summary: 'Duplicate a card (optionally with its whole subtree)',
  usage: 'duplicate ID [--with-children]',
  run({ store, positionals, flags }) {
    const id = resolveCard(store, positionals[0]);
    const kernel = kernelFor(store);
    const { newId, allNewIds } = kernel.duplicateHierarchy(id, !!flags['with-children']);
    commitKernel(store, kernel);
    return { write: true, data: { id: newId, created: allNewIds }, text: `Duplicated as ${newId} (${allNewIds.length} card(s))` };
  }
});

command('search', {
  summary: 'Search card titles, bodies and tags (all terms must match)',
  usage: 'search QUERY [--tag TAG]... [--limit N] [--include-body]',
  run({ store, positionals, flags }) {
    const tags = tagList(flags).map(t => t.replace(/^#/, '').toLowerCase());
    const query = positionals.join(' ');
    if (!query.trim() && !tags.length) throw usageError('Pass a query and/or --tag');
    const limit = parseIntFlag(flags.limit, 'limit', { min: 1 }) ?? 20;
    const results = searchCards(store, query, { tags, limit, includeBody: flags['include-body'] });
    const text = results.length
      ? results.map(r => cardLine(r) + (r.snippet ? `\n    ${r.snippet}` : '')).join('\n')
      : '(no matches)';
    return { data: { query, tags, results }, text };
  }
});

command('tag', {
  summary: 'Add, remove, set or list a card\'s tags',
  usage: 'tag add|remove|set|list ID [TAG...]',
  run({ store, positionals }) {
    const [action, ref, ...tags] = positionals;
    if (!['add', 'remove', 'set', 'list'].includes(action)) throw usageError('Usage: tag add|remove|set|list ID [TAG...]');
    const id = resolveCard(store, ref);
    const kernel = kernelFor(store);
    const list = tags.flatMap(t => t.split(',')).map(t => t.trim()).filter(Boolean);
    if (action === 'list') return { data: { id, tags: kernel.getTags(id) }, text: kernel.getTags(id).map(t => '#' + t).join(' ') || '(no tags)' };
    if (action !== 'set' && !list.length) throw usageError(`tag ${action} needs at least one tag`);
    if (action === 'add') list.forEach(t => kernel.addTag(id, t));
    if (action === 'remove') list.forEach(t => kernel.removeTag(id, t));
    if (action === 'set') kernel.setTags(id, list);
    commitKernel(store, kernel);
    const result = store.cards[id].tags;
    return { write: true, data: { id, tags: result }, text: `${id}: ${result.map(t => '#' + t).join(' ') || '(no tags)'}` };
  }
});

command('tags', {
  summary: 'List every tag with its card count',
  usage: 'tags',
  run({ store }) {
    const counts = {};
    for (const card of Object.values(store.cards)) for (const t of card.tags || []) counts[t] = (counts[t] || 0) + 1;
    const tags = Object.entries(counts).map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    return { data: { tags }, text: tags.length ? tags.map(t => `#${t.tag}  ${t.count}`).join('\n') : '(no tags)' };
  }
});

command('links', {
  summary: 'Show a card\'s outgoing [[links]], backlinks and tag-related cards',
  usage: 'links ID',
  run({ store, positionals }) {
    const id = resolveCard(store, positionals[0]);
    const kernel = kernelFor(store);
    const outgoing = parseCardLinks(store.cards[id].body || '').map(l => ({ title: l.cardName, id: kernel.findCardByName(l.cardName) }));
    const backlinks = kernel.getBacklinks(id);
    const related = kernel.getRelatedCards(id, 10);
    const text = [
      'Outgoing:', ...(outgoing.length ? outgoing.map(l => `  [[${l.title}]] → ${l.id || '(unresolved)'}`) : ['  -']),
      'Backlinks:', ...(backlinks.length ? backlinks.map(b => `  ${b.id}  ${b.title}`) : ['  -']),
      'Related:', ...(related.length ? related.map(r => `  ${r.id}  ${r.title}  (${r.matchedTags.join(', ')})`) : ['  -'])
    ].join('\n');
    return { data: { id, outgoing, backlinks, related }, text };
  }
});

command('bookmark', {
  summary: 'Add, remove or list bookmarks',
  usage: 'bookmark add|remove ID | bookmark list',
  run({ store, positionals }) {
    const [action, ref] = positionals;
    store.bookmarks = Array.isArray(store.bookmarks) ? store.bookmarks : [];
    if (action === 'list' || action === undefined) {
      const cards = store.bookmarks.map(id => store.cards[id]).filter(Boolean).map(c => summarize(store, c));
      return { data: { bookmarks: cards }, text: cards.length ? cards.map(cardLine).join('\n') : '(no bookmarks)' };
    }
    if (!['add', 'remove'].includes(action)) throw usageError('Usage: bookmark add|remove ID | bookmark list');
    const id = resolveCard(store, ref);
    if (action === 'add' && !store.bookmarks.includes(id)) store.bookmarks.push(id);
    if (action === 'remove') store.bookmarks = store.bookmarks.filter(b => b !== id);
    return { write: true, data: { id, bookmarked: store.bookmarks.includes(id) }, text: `${action === 'add' ? 'Bookmarked' : 'Unbookmarked'} ${id}` };
  }
});

command('export', {
  summary: 'Export the dataset (or one subtree) as json, md, txt, outline or csv',
  usage: 'export [--format json|md|txt|outline|csv] [--card ID] [--out FILE]',
  run({ store, flags, io }) {
    const format = String(flags.format || 'json').toLowerCase();
    const rootIds = flags.card !== undefined ? [resolveCard(store, flags.card)] : store.rootOrder;
    const content = exportText(store, format, rootIds);
    if (flags.out) {
      const out = resolve(io.cwd, flags.out);
      writeFileSync(out, content, 'utf8');
      return { data: { file: out, format, bytes: Buffer.byteLength(content) }, text: `Wrote ${out}` };
    }
    return { data: { format, content }, text: content.replace(/\n$/, ''), raw: true };
  }
});

command('import', {
  summary: 'Import a CardSpoke JSON backup or an indented text outline',
  usage: 'import FILE|- [--parent ID|root] [--format json|outline]',
  async run({ store, positionals, flags, io, pin }) {
    const source = positionals[0];
    if (!source) throw usageError('Usage: import FILE|- [--parent ID]');
    const parentId = flags.parent !== undefined ? resolveCard(store, flags.parent, { allowRoot: true, label: 'parent' }) : null;
    let text;
    try { text = readFileSync(source === '-' ? 0 : resolve(io.cwd, source), 'utf8'); } catch (err) {
      throw new CliError(`Could not read ${source}: ${err.message}`, { code: 'read_failed' });
    }
    let format = flags.format;
    if (!format) format = /^\s*[{]/.test(text) ? 'json' : 'outline';
    if (format === 'json') {
      let pkg;
      try { pkg = JSON.parse(text); } catch (err) { throw new CliError(`Invalid JSON: ${err.message}`, { code: 'invalid_file' }); }
      if (isEncryptedEnvelope(pkg)) {
        if (!pin) throw new CliError('The import file is PIN-encrypted. Pass --pin.', { code: 'pin_required' });
        try { pkg = JSON.parse(await decryptStorePayload(text, pin)); } catch (_err) {
          throw new CliError('Could not decrypt the import file: wrong PIN.', { code: 'pin_invalid' });
        }
      }
      if (!pkg || typeof pkg !== 'object' || !pkg.cards || typeof pkg.cards !== 'object' || Array.isArray(pkg.cards)) {
        throw new CliError('Import file has no "cards" object', { code: 'invalid_file' });
      }
      const { rootIds, count } = importPackage(store, pkg, parentId);
      return { write: true, data: { imported: count, rootIds }, text: `Imported ${count} card(s)` };
    }
    if (format === 'outline' || format === 'txt') {
      const kernel = kernelFor(store);
      const created = importOutline(kernel, text, parentId);
      commitKernel(store, kernel);
      return { write: true, data: { imported: created.length, ids: created }, text: `Imported ${created.length} card(s)` };
    }
    throw usageError('--format must be json or outline');
  }
});

command('validate', {
  summary: 'Check hierarchy integrity (use --fix to repair)',
  usage: 'validate [--fix]',
  run({ store, flags }) {
    const issues = findIssues(store);
    if (flags.fix && issues.length) {
      repairHierarchy(store);
      const remaining = findIssues(store);
      return { write: true, data: { fixed: issues.length - remaining.length, issues, remaining }, text: `Repaired ${issues.length - remaining.length} issue(s)` };
    }
    const data = { ok: issues.length === 0, issues };
    const text = issues.length ? issues.map(i => `${i.type}  ${i.id}  ${i.message}`).join('\n') : 'OK: no integrity issues';
    return { data, text, exitCode: issues.length ? 1 : 0 };
  }
});

command('commands', {
  summary: 'Describe every command (use with --json for a machine-readable schema)',
  usage: 'commands',
  needsDataset: false,
  run() {
    const list = Object.entries(COMMANDS).map(([name, c]) => ({ name, summary: c.summary, usage: `cardspoke ${c.usage}` }));
    return { data: { globalFlags: GLOBAL_FLAGS, commands: list }, text: list.map(c => `${c.usage}\n    ${c.summary}`).join('\n') };
  }
});

const GLOBAL_FLAGS = [
  { flag: '--file, -f FILE', description: 'Dataset file (default: $CARDSPOKE_FILE or ./cardspoke.json)' },
  { flag: '--json', description: 'Print machine-readable JSON ({ ok, data } or { ok: false, error })' },
  { flag: '--pin PIN', description: 'PIN for an encrypted dataset (or set $CARDSPOKE_PIN)' },
  { flag: '--dry-run', description: 'Run the command but do not write any changes' },
  { flag: '--help, -h', description: 'Show help' }
];

function helpText(name) {
  if (name && COMMANDS[name]) return `Usage: cardspoke ${COMMANDS[name].usage}\n\n${COMMANDS[name].summary}`;
  const width = Math.max(...Object.keys(COMMANDS).map(n => n.length));
  return [
    'CardSpoke CLI — edit CardSpoke datasets from the command line',
    '',
    'Usage: cardspoke <command> [args] [--file FILE] [--json]',
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([n, c]) => `  ${n.padEnd(width)}  ${c.summary}`),
    '',
    'Global flags:',
    ...GLOBAL_FLAGS.map(f => `  ${f.flag.padEnd(18)}  ${f.description}`),
    '',
    'Cards can be referenced by ID or by exact (case-insensitive) title.',
    'Run "cardspoke help <command>" for details. See docs/guides/CLI.md.'
  ].join('\n');
}

// ── Runner ───────────────────────────────────────────────────────────────────

/**
 * Run the CLI. Returns the exit code; never calls process.exit, so tests
 * can drive it in-process.
 */
export async function main(argv, io = {}) {
  io = {
    cwd: io.cwd || process.cwd(),
    env: io.env || process.env,
    stdout: io.stdout || (s => process.stdout.write(s)),
    stderr: io.stderr || (s => process.stderr.write(s))
  };
  let json = argv.includes('--json');
  try {
    const { positionals, flags } = parseArgs(argv);
    json = !!flags.json;
    let [name, ...rest] = positionals;
    if (name === 'help' || (!name && flags.help) || !name) {
      io.stdout(helpText(rest[0]) + '\n');
      return name || flags.help ? 0 : 2;
    }
    const cmd = COMMANDS[name];
    if (!cmd) throw usageError(`Unknown command "${name}". Run "cardspoke help".`);
    if (flags.help) { io.stdout(helpText(name) + '\n'); return 0; }

    const filePath = resolve(io.cwd, flags.file || io.env.CARDSPOKE_FILE || 'cardspoke.json');
    const pin = flags.pin !== undefined ? String(flags.pin) : (io.env.CARDSPOKE_PIN || null);
    let dataset = null;
    if (cmd.needsDataset !== false) dataset = await loadDataset(filePath, { pin });

    const result = await cmd.run({
      positionals: rest, flags, io, filePath, pin,
      dataset, store: dataset && dataset.store
    });
    if (result.dataset) dataset = result.dataset;
    const dryRun = !!flags['dry-run'];
    if (result.write && !dryRun) await saveDataset(filePath, dataset);

    if (json) {
      const payload = { ok: true, command: name, data: result.data };
      if (result.write) payload.saved = !dryRun;
      io.stdout(JSON.stringify(payload, null, 2) + '\n');
    } else {
      io.stdout(result.text + (dryRun && result.write ? '\n(dry run: no changes written)' : '') + '\n');
    }
    return result.exitCode || 0;
  } catch (err) {
    const known = err instanceof CliError;
    const code = known ? err.code : 'internal';
    const message = known ? err.message : (err && err.stack) || String(err);
    if (json) {
      io.stdout(JSON.stringify({ ok: false, error: { code, message, ...(known && err.details ? { details: err.details } : {}) } }, null, 2) + '\n');
    } else {
      io.stderr(`cardspoke: ${message}\n`);
      if (known && err.details && err.details.matches) {
        io.stderr(err.details.matches.map(m => `  ${m.id}  ${m.path}`).join('\n') + '\n');
      }
    }
    return known ? err.exitCode : 1;
  }
}

function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (_err) {
    return false;
  }
}
if (isInvokedDirectly()) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
