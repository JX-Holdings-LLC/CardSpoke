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
 * Card Migration Layer (CardSpoke Core)
 *
 * Migration rules:
 *   - Migrations must be idempotent.
 *   - Unknown metadata fields must be preserved.
 *   - Failed migrations must not delete data and must leave cards readable.
 *
 * This layer repairs baseline card structure (children/tags arrays and the
 * plugin metadata object) when loading or importing data.
 */

/**
 * Migrate one card: ensures baseline card fields exist. Never removes fields.
 * @param {Object} card
 * @returns {{ card: Object, changed: boolean, warnings: string[] }}
 */
export function migrateCard(card) {
  if (!card || typeof card !== 'object') return { card, changed: false, warnings: [] };
  let changed = false;
  if (!Array.isArray(card.children)) { card.children = []; changed = true; }
  if (!Array.isArray(card.tags)) { card.tags = []; changed = true; }
  // Tags are canonically lowercase strings without a leading '#'. Imported
  // or legacy data can carry mixed case, '#'-prefixed, duplicate, empty or
  // non-string tags that the Tag Manager / kernel tag ops cannot match (or
  // that throw). Normalize them in place; order of first occurrence is kept.
  const normalizedTags = [];
  for (const t of card.tags) {
    if (t == null || typeof t === 'object' || typeof t === 'function') continue;
    const tag = String(t).trim().replace(/^#/, '').trim().toLowerCase();
    if (tag && !normalizedTags.includes(tag)) normalizedTags.push(tag);
  }
  if (normalizedTags.length !== card.tags.length ||
      normalizedTags.some((tag, i) => tag !== card.tags[i])) {
    card.tags = normalizedTags;
    changed = true;
  }
  if (card.modsData == null || typeof card.modsData !== 'object') {
    card.modsData = {};
    changed = true;
  }
  return { card, changed, warnings: [] };
}

/**
 * Migrate every card in a store. Idempotent: running twice produces no
 * further changes. Failures on individual cards are collected as warnings
 * and never delete data.
 * @param {{cards: Object}} store
 * @returns {{ store: Object, changed: boolean, migratedCount: number, warnings: string[] }}
 */
export function migrateStore(store) {
  const warnings = [];
  let changed = false;
  let migratedCount = 0;
  if (!store || !store.cards || typeof store.cards !== 'object') {
    return { store, changed, migratedCount, warnings };
  }
  for (const [id, card] of Object.entries(store.cards)) {
    try {
      const result = migrateCard(card);
      if (result.changed) {
        changed = true;
        migratedCount++;
      }
      for (const w of result.warnings) warnings.push(`[${id}] ${w}`);
    } catch (err) {
      // A failed migration leaves the card exactly as it was — readable.
      warnings.push(`[${id}] Migration failed: ${err && err.message}`);
    }
  }
  return { store, changed, migratedCount, warnings };
}
