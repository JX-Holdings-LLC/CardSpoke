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
 * CardSpoke Kernel (Layer 0)
 *
 * Pure data and hierarchy engine. This is the bare essentials of the app:
 * card CRUD, parent-child hierarchy, tags, duplication, and card-link queries.
 *
 * Design constraints:
 *   - Zero side effects: no window, document, save(), showToast(), Middleware.
 *   - Zero global state: every Kernel instance owns its own data.
 *   - Data integrity: uid() for IDs, cloneCard() on every return.
 *   - Headless portability: runs in Node.js without any browser APIs.
 *   - Communication by return value: callers (the Shell / Layer 2) decide
 *     what to do with the results (undo logging, UI toasts, persistence).
 */

// ── Pure utilities (no browser deps) ─────────────────────────────────────────

/**
 * Generate a unique ID from timestamp + random component.
 * @returns {string}
 */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Deep-clone a card object to prevent reference leaks.
 * @param {Object|null} card
 * @returns {Object|null}
 */
function cloneCard(card) {
  if (!card) return null;
  // Clone all JSON metadata, not only modsData: undo snapshots and callers
  // must not retain writable references to meta/attributes/custom fields.
  card = typeof structuredClone === 'function' ? structuredClone(card) : JSON.parse(JSON.stringify(card));
  let modsData = {};
  if (card.modsData) {
    try {
      modsData = JSON.parse(JSON.stringify(card.modsData));
    } catch (_err) {
      modsData = { ...card.modsData };
    }
  }
  return {
    ...card,
    children: Array.isArray(card.children) ? card.children.slice() : [],
    tags: Array.isArray(card.tags) ? card.tags.slice() : [],
    modsData,
  };
}

/**
 * Normalize a card name for comparison (lowercase, trimmed, collapsed spaces).
 * @param {string} name
 * @returns {string}
 */
function normalizeCardName(name) {
  if (!name) return '';
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Parse [[Card Name]] link tokens from text.
 * @param {string} text
 * @returns {Array<{match: string, cardName: string, startIndex: number, endIndex: number}>}
 */
function parseCardLinks(text) {
  if (!text) return [];
  const regex = /\[\[([^\]]+)\]\]/g;
  const matches = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    matches.push({
      match: m[0],
      cardName: m[1].trim(),
      startIndex: m.index,
      endIndex: m.index + m[0].length,
    });
  }
  return matches;
}

/**
 * Check whether text contains a [[cardName]] link.
 * @param {string} text
 * @param {string} cardName
 * @returns {boolean}
 */
function hasCardLink(text, cardName) {
  if (!text || !cardName) return false;
  const links = parseCardLinks(text);
  const normalized = normalizeCardName(cardName);
  return links.some(link => normalizeCardName(link.cardName) === normalized);
}

/**
 * Rewrite every [[Old Name]] link token in text so it points at newName.
 * Matching uses the same normalization as link resolution (case- and
 * whitespace-insensitive), so exactly the tokens that currently resolve to
 * the old title are rewritten. parseCardLinks has no alias syntax
 * ([[Name|label]] is not a link to "Name"), so only the plain form exists.
 * @param {string} text
 * @param {string} oldName
 * @param {string} newName - Must not contain '[' or ']' (not expressible as a link).
 * @returns {{ text: string, count: number }}
 */
function replaceCardLinks(text, oldName, newName) {
  if (!text || typeof text !== 'string' || !oldName || !newName) return { text, count: 0 };
  const replacementName = String(newName).trim();
  if (!replacementName || /[[\]]/.test(replacementName)) return { text, count: 0 };
  const target = normalizeCardName(String(oldName));
  if (!target) return { text, count: 0 };
  let count = 0;
  const out = text.replace(/\[\[([^\]]+)\]\]/g, (match, inner) => {
    if (normalizeCardName(inner) !== target) return match;
    count++;
    return '[[' + replacementName + ']]';
  });
  return { text: out, count };
}

/**
 * Normalize one tag value: strip a leading '#', lowercase, trim. Non-string
 * primitives are stringified; null/undefined/objects yield '' (dropped).
 * @param {*} tag
 * @returns {string}
 */
function normalizeTag(tag) {
  if (tag == null || typeof tag === 'object' || typeof tag === 'function') return '';
  return String(tag).trim().replace(/^#/, '').trim().toLowerCase();
}

/**
 * Fields a generic update may never change: identity, hierarchy (moves go
 * through reparent so both sides of the parent/child link stay consistent)
 * and creation time. Prototype-mutating keys are refused as well.
 */
const PROTECTED_UPDATE_FIELDS = new Set(['id', 'parentId', 'children', 'createdAt', '__proto__', 'constructor', 'prototype']);

/**
 * Extract inline #tags from body text.
 * @param {string} body
 * @returns {string[]}
 */
function extractTags(body) {
  if (!body) return [];
  const matches = body.match(/#\w+/g);
  return matches ? matches.slice(0, 5) : [];
}

// ── Kernel class ─────────────────────────────────────────────────────────────

export class Kernel {
  /**
   * Create a new Kernel instance with its own isolated data store.
   * @param {Object} [initialData] - Optional seed data { cards, rootOrder }
   */
  constructor(initialData) {
    this.cards = {};
    this.rootOrder = [];

    if (initialData) {
      if (initialData.cards && typeof initialData.cards === 'object') {
        // Deep-clone every card to isolate from caller
        for (const [id, card] of Object.entries(initialData.cards)) {
          this.cards[id] = cloneCard(card);
        }
      }
      if (Array.isArray(initialData.rootOrder)) {
        this.rootOrder = initialData.rootOrder.slice();
      }
    }
  }

  // ── Snapshot / hydration ──────────────────────────────────────────────────

  /**
   * Return a deep-cloned snapshot of the full data store.
   * Safe to serialize or hand to another layer.
   * @returns {{ cards: Object, rootOrder: string[] }}
   */
  snapshot() {
    const cards = {};
    for (const [id, card] of Object.entries(this.cards)) {
      cards[id] = cloneCard(card);
    }
    return { cards, rootOrder: this.rootOrder.slice() };
  }

  /**
   * Replace the entire internal store (e.g. after loading from storage).
   * Deep-clones incoming data.
   * @param {{ cards: Object, rootOrder: string[] }} data
   */
  hydrate(data) {
    this.cards = {};
    this.rootOrder = [];
    if (data.cards && typeof data.cards === 'object') {
      for (const [id, card] of Object.entries(data.cards)) {
        this.cards[id] = cloneCard(card);
      }
    }
    if (Array.isArray(data.rootOrder)) {
      this.rootOrder = data.rootOrder.slice();
    }
  }

  // ── Card CRUD ─────────────────────────────────────────────────────────────

  /**
   * Create a new card.
   * @param {string} title
   * @param {string} body
   * @param {string|null} [parentId=null]
   * @returns {{ id: string, card: Object }} The new card (cloned).
   */
  createCard(title, body, parentId = null) {
    if (parentId && !Object.hasOwn(this.cards, parentId)) throw new Error('Parent card not found');
    const id = uid();
    const now = Date.now();
    const card = {
      id,
      title: title || '',
      body: body || '',
      parentId: parentId || null,
      children: [],
      createdAt: now,
      updatedAt: now,
      modsData: {},
      tags: [],
      isRichText: false,
    };

    this.cards[id] = card;

    if (!parentId) {
      this.rootOrder.push(id);
    } else {
      const parent = this.cards[parentId];
      if (parent && !parent.children.includes(id)) {
        parent.children.push(id);
      }
    }

    return { id, card: cloneCard(card) };
  }

  /**
   * Update content fields on an existing card. Structural fields (id,
   * parentId, children, createdAt) are ignored — moves go through reparent()
   * so parent.children / rootOrder can never disagree with card.parentId.
   * @param {string} id
   * @param {Object} updates - Fields to merge onto the card.
   * @returns {{ previousState: Object|null, card: Object|null }} Cloned before/after.
   */
  updateCard(id, updates) {
    const card = this.cards[id];
    if (!card) return { previousState: null, card: null };

    const previousState = cloneCard(card);
    const updateTimestamp = Date.now();
    const safeUpdates = {};
    if (updates && typeof updates === 'object') {
      for (const key of Object.keys(updates)) {
        if (!PROTECTED_UPDATE_FIELDS.has(key)) safeUpdates[key] = updates[key];
      }
    }
    Object.assign(card, safeUpdates, { updatedAt: updateTimestamp });

    return { previousState, card: cloneCard(card) };
  }

  /**
   * Delete a card and all its descendants recursively.
   * @param {string} id
   * @returns {{ deleted: Object[], affectedChildIds: string[] }}
   *   deleted: array of cloned card snapshots (root first, then descendants).
   *   affectedChildIds: flat list of every removed ID (including root).
   */
  deleteCard(id) {
    const deleted = [];
    const affectedChildIds = [];
    const visited = new Set();

    const remove = (cardId) => {
      if (visited.has(cardId)) return;
      visited.add(cardId);
      const card = this.cards[cardId];
      if (!card) return;

      deleted.push(cloneCard(card));
      affectedChildIds.push(cardId);

      // Recurse into children first
      const children = (card.children || []).slice();
      children.forEach(cid => remove(cid));

      // Detach from parent or rootOrder
      if (card.parentId) {
        const parent = this.cards[card.parentId];
        if (parent) {
          parent.children = parent.children.filter(c => c !== cardId);
        }
      } else {
        this.rootOrder = this.rootOrder.filter(c => c !== cardId);
      }

      delete this.cards[cardId];
    };

    remove(id);
    return { deleted, affectedChildIds };
  }

  /**
   * Retrieve a single card by ID.
   * @param {string} id
   * @returns {Object|null} Cloned card or null.
   */
  getCard(id) {
    return cloneCard(this.cards[id] || null);
  }

  /**
   * Check whether a card exists.
   * @param {string} id
   * @returns {boolean}
   */
  hasCard(id) {
    return id in this.cards;
  }

  /**
   * Return cloned direct children of a card (or root cards if id is null).
   * @param {string|null} parentId
   * @returns {Object[]}
   */
  getChildren(parentId) {
    if (!parentId) {
      return this.rootOrder
        .map(id => cloneCard(this.cards[id]))
        .filter(Boolean);
    }
    const parent = this.cards[parentId];
    if (!parent) return [];
    return (parent.children || [])
      .map(id => cloneCard(this.cards[id]))
      .filter(Boolean);
  }

  /**
   * Return the ancestor chain from a card up to the root (inclusive).
   * @param {string} id
   * @returns {Object[]} Array of cloned cards, nearest parent first.
   */
  getAncestors(id) {
    const ancestors = [];
    let current = this.cards[id];
    const seen = new Set();
    while (current && current.parentId) {
      // Guard against a cyclic parent chain so this can't loop forever.
      if (seen.has(current.id)) break;
      seen.add(current.id);
      const parent = this.cards[current.parentId];
      if (!parent) break;
      ancestors.push(cloneCard(parent));
      current = parent;
    }
    return ancestors;
  }

  /**
   * Count all cards in the store.
   * @returns {number}
   */
  cardCount() {
    return Object.keys(this.cards).length;
  }

  /**
   * Collect every descendant ID under a card (not including the card itself).
   * @param {string} id
   * @returns {string[]}
   */
  getDescendantIds(id) {
    const ids = [];
    const seen = new Set();
    const walk = (cardId) => {
      // Guard against a cyclic children array (e.g. from a hand-crafted
      // import) so this can't recurse forever / overflow the stack.
      if (seen.has(cardId)) return;
      seen.add(cardId);
      const card = this.cards[cardId];
      if (!card) return;
      for (const childId of card.children || []) {
        ids.push(childId);
        walk(childId);
      }
    };
    walk(id);
    return ids;
  }

  // ── Hierarchy operations ──────────────────────────────────────────────────

  /**
   * Move a card to a new parent (or to root if newParentId is null).
   * Prevents moving a card into its own subtree.
   * @param {string} id
   * @param {string|null} newParentId
   * @returns {{ success: boolean, previousParentId: string|null }}
   */
  reparent(id, newParentId) {
    const card = this.cards[id];
    if (!card) return { success: false, previousParentId: null };
    if (newParentId && !Object.hasOwn(this.cards, newParentId)) return { success: false, previousParentId: card.parentId };

    // Guard: cannot reparent into own subtree
    if (newParentId) {
      const descendantIds = this.getDescendantIds(id);
      if (descendantIds.includes(newParentId) || newParentId === id) {
        return { success: false, previousParentId: card.parentId };
      }
    }

    const previousParentId = card.parentId;

    // Detach from current location
    if (card.parentId) {
      const oldParent = this.cards[card.parentId];
      if (oldParent) {
        oldParent.children = oldParent.children.filter(c => c !== id);
      }
    } else {
      this.rootOrder = this.rootOrder.filter(c => c !== id);
    }

    // Attach to new location
    card.parentId = newParentId || null;
    if (newParentId) {
      const newParent = this.cards[newParentId];
      if (newParent && !newParent.children.includes(id)) {
        newParent.children.push(id);
      }
    } else {
      if (!this.rootOrder.includes(id)) {
        this.rootOrder.push(id);
      }
    }

    card.updatedAt = Date.now();
    return { success: true, previousParentId };
  }

  /**
   * Reorder a card within its sibling list.
   * @param {string} id
   * @param {number} newIndex - Target index in the sibling array.
   * @returns {{ success: boolean, previousIndex: number }}
   */
  reorder(id, newIndex) {
    const card = this.cards[id];
    if (!card) return { success: false, previousIndex: -1 };

    const list = card.parentId
      ? (this.cards[card.parentId] ? this.cards[card.parentId].children : null)
      : this.rootOrder;

    if (!list) return { success: false, previousIndex: -1 };

    const previousIndex = list.indexOf(id);
    if (previousIndex === -1) return { success: false, previousIndex: -1 };

    // Remove from current position
    list.splice(previousIndex, 1);
    // Clamp and insert at new position
    const clamped = Math.max(0, Math.min(newIndex, list.length));
    list.splice(clamped, 0, id);

    return { success: true, previousIndex };
  }

  /**
   * Duplicate a card (and optionally its entire subtree).
   * @param {string} id
   * @param {boolean} [withChildren=false]
   * @returns {{ newId: string|null, allNewIds: string[] }} IDs of created cards.
   */
  duplicateHierarchy(id, withChildren = false) {
    const original = this.cards[id];
    if (!original) return { newId: null, allNewIds: [] };

    const allNewIds = [];
    const visited = new Set();

    const dup = (sourceId, targetParentId) => {
      if (visited.has(sourceId)) return null;
      visited.add(sourceId);
      const src = this.cards[sourceId];
      if (!src) return null;

      const newId = uid();
      const now = Date.now();
      this.cards[newId] = {
        ...cloneCard(src),
        id: newId,
        parentId: targetParentId,
        children: [],
        title: targetParentId === (original.parentId || null) && sourceId === id
          ? (src.title || 'Untitled') + ' (Copy)'
          : src.title || '',
        createdAt: now,
        updatedAt: now,
      };
      allNewIds.push(newId);

      // Attach to parent or root
      if (targetParentId) {
        const parent = this.cards[targetParentId];
        if (parent && !parent.children.includes(newId)) {
          parent.children.push(newId);
        }
      } else {
        this.rootOrder.push(newId);
      }

      // Recursively duplicate children
      if (withChildren) {
        for (const childId of src.children || []) {
          dup(childId, newId);
        }
      }

      return newId;
    };

    const newId = dup(id, original.parentId || null);
    return { newId, allNewIds };
  }

  // ── Tag operations ────────────────────────────────────────────────────────

  /**
   * Get all tags for a card.
   * @param {string} cardId
   * @returns {string[]}
   */
  getTags(cardId) {
    const card = this.cards[cardId];
    if (!card) return [];
    return (card.tags || []).slice();
  }

  /**
   * Add a tag to a card.
   * @param {string} cardId
   * @param {string} tag
   * @returns {boolean} True if the tag was added.
   */
  addTag(cardId, tag) {
    const card = this.cards[cardId];
    if (!card) return false;

    const normalized = normalizeTag(tag);
    if (!normalized) return false;

    if (!Array.isArray(card.tags)) card.tags = [];
    if (card.tags.some(t => normalizeTag(t) === normalized)) return false;

    card.tags.push(normalized);
    card.updatedAt = Date.now();
    return true;
  }

  /**
   * Remove a tag from a card.
   * @param {string} cardId
   * @param {string} tag
   * @returns {boolean} True if the tag was removed.
   */
  removeTag(cardId, tag) {
    const card = this.cards[cardId];
    if (!card || !Array.isArray(card.tags)) return false;

    const normalized = normalizeTag(tag);
    if (!normalized) return false;
    const before = card.tags.length;
    card.tags = card.tags.filter(t => normalizeTag(t) !== normalized);

    if (card.tags.length === before) return false;
    card.updatedAt = Date.now();
    return true;
  }

  /**
   * Replace all tags on a card.
   * @param {string} cardId
   * @param {string[]} tags
   * @returns {boolean}
   */
  setTags(cardId, tags) {
    const card = this.cards[cardId];
    if (!card) return false;

    const normalized = (Array.isArray(tags) ? tags : [])
      .map(normalizeTag)
      .filter(Boolean);

    card.tags = [...new Set(normalized)];
    card.updatedAt = Date.now();
    return true;
  }

  /**
   * Collect every unique tag across all cards.
   * @returns {string[]}
   */
  getAllTags() {
    const all = new Set();
    for (const card of Object.values(this.cards)) {
      if (card.tags) card.tags.forEach(t => all.add(t));
    }
    return Array.from(all).sort();
  }

  // ── Query helpers ─────────────────────────────────────────────────────────

  /**
   * Find a card by its title (case-insensitive, whitespace-normalized).
   * @param {string} cardName
   * @returns {string|null} Card ID or null.
   */
  findCardByName(cardName) {
    if (!cardName) return null;
    const normalized = normalizeCardName(cardName);
    for (const [id, card] of Object.entries(this.cards)) {
      if (normalizeCardName(card.title) === normalized) return id;
    }
    return null;
  }

  /**
   * Find all cards matching a name (exact or partial).
   * @param {string} cardName
   * @param {boolean} [exactMatch=true]
   * @returns {Array<{id: string, title: string, similarity: number}>}
   */
  findCardsByName(cardName, exactMatch = true) {
    if (!cardName) return [];
    const normalized = normalizeCardName(cardName);
    const results = [];

    for (const [id, card] of Object.entries(this.cards)) {
      const nt = normalizeCardName(card.title);
      if (exactMatch) {
        if (nt === normalized) {
          results.push({ id, title: card.title, similarity: 1.0 });
        }
      } else if (nt.includes(normalized)) {
        const similarity = Math.min(normalized.length, nt.length) / Math.max(normalized.length, nt.length);
        results.push({ id, title: card.title, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results;
  }

  /**
   * Resolve all [[Card Name]] links in text to card IDs.
   * @param {string} text
   * @returns {Array<{link: Object, cardId: string|null}>}
   */
  resolveCardLinks(text) {
    const links = parseCardLinks(text);
    return links.map(link => ({
      link,
      cardId: this.findCardByName(link.cardName),
    }));
  }

  /**
   * Rewrite [[oldName]] links to [[newName]] in every card body. Pure data
   * operation: returns cloned before/after snapshots so the Shell can record
   * undo entries and fire hooks.
   * @param {string} oldName
   * @param {string} newName
   * @returns {Array<{id: string, previousState: Object, card: Object, count: number}>}
   */
  rewriteCardLinks(oldName, newName) {
    const changes = [];
    for (const [id, card] of Object.entries(this.cards)) {
      if (!card || typeof card.body !== 'string' || !card.body.includes('[[')) continue;
      const { text, count } = replaceCardLinks(card.body, oldName, newName);
      if (!count) continue;
      const result = this.updateCard(id, { body: text });
      changes.push({ id, previousState: result.previousState, card: result.card, count });
    }
    return changes;
  }

  /**
   * Get all cards that link to a given card via [[Title]] references.
   * @param {string} cardId
   * @returns {Array<{id: string, title: string}>}
   */
  getBacklinks(cardId) {
    const card = this.cards[cardId];
    if (!card || !card.title) return [];

    const backlinks = [];
    for (const [id, other] of Object.entries(this.cards)) {
      if (id === cardId) continue;
      if (other.body && hasCardLink(other.body, card.title)) {
        backlinks.push({ id: other.id, title: other.title || '(Untitled)' });
      }
    }
    return backlinks;
  }

  /**
   * Get related cards based on shared tags.
   * @param {string} cardId
   * @param {number} [limit=10]
   * @returns {Array<{id: string, title: string, matchScore: number, matchedTags: string[]}>}
   */
  getRelatedCards(cardId, limit = 10) {
    const card = this.cards[cardId];
    if (!card) return [];

    const cardTags = this.getTags(cardId);
    if (cardTags.length === 0) return [];

    const related = [];
    for (const [id, other] of Object.entries(this.cards)) {
      if (id === cardId) continue;
      const otherTags = this.getTags(id);
      const matchedTags = cardTags.filter(t => otherTags.includes(t));
      if (matchedTags.length > 0) {
        related.push({
          id: other.id,
          title: other.title || '(Untitled)',
          matchScore: matchedTags.length / Math.max(cardTags.length, otherTags.length),
          matchedTags,
        });
      }
    }

    related.sort((a, b) => b.matchScore - a.matchScore);
    return related.slice(0, limit);
  }
}

// ── Standalone utility re-exports (useful for Shell / Layer 2) ───────────────

export { uid, cloneCard, normalizeCardName, parseCardLinks, hasCardLink, extractTags, replaceCardLinks, normalizeTag };
