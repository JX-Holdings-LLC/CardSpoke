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
  APP_CREATOR, APP_VERSION, APP_RELEASE_DATE, APP_UPDATER,
  store,
  navState,
  dirty, setDirty,
  searchResultsState, setSearchResultsState,
  trashBin
} from './state.js';
import { vnodeToDOM, applyPatch } from '@core/plugin-vnode.js';


      // Source Part 4/5: Rendering, themes, footer, and initialization
      // Concatenated via `npm run build` in lexical order of www/src/*.js
      // =============================================================
      // --- RENDERING ---
      // Functions for rendering UI components and pages
      // =============================================================

      /**
       * Render breadcrumb navigation
       */
      function getEditPageLabel() {
        if (navState.cardId) return 'Edit Card';
        return navState.parentId ? 'Add Child Card' : 'New Card';
      }

      function renderBreadcrumbs() {
        breadcrumbs.innerHTML = '';
        if (navState.page === 'search') {
          breadcrumbs.appendChild(h('span', { className: 'breadcrumb current', 'aria-current': 'page' }, 'Search Results'));
          return;
        }
        if (navState.page === 'edit') {
          breadcrumbs.appendChild(h('span', { className: 'breadcrumb current', 'aria-current': 'page' }, getEditPageLabel()));
          return;
        }
        let current = navState.cardId;
        const path = [];
        const seenCrumb = new Set();
        while (current) {
          // Guard against a cyclic parent chain (e.g. from a hand-crafted
          // import) so breadcrumb rendering can never spin forever.
          if (seenCrumb.has(current)) break;
          seenCrumb.add(current);
          const c = store.cards[current];
          if (!c) break;
          path.unshift(c);
          current = c.parentId;
        }
        if (path.length === 0) {
          breadcrumbs.appendChild(h('span', { className: 'breadcrumb current', 'aria-current': 'page' }, 'All Cards'));
        } else {
          const home = h('button', { className: 'breadcrumb', onclick: () => goTo('list', { cardId: null }), 'aria-label': 'Go to All Cards' }, 'All Cards');
          breadcrumbs.appendChild(home);
          path.forEach((c, i) => {
            const isCurrent = (i === path.length - 1 && navState.page === 'list');
            const cls = isCurrent ? 'breadcrumb current' : 'breadcrumb';
            const chip = isCurrent 
              ? h('span', { className: cls, 'aria-current': 'page' }, c.title || '(Untitled)')
              : h('button', { className: cls, onclick: () => goTo('list', { cardId: c.id }), 'aria-label': 'Go to ' + (c.title || 'Untitled') }, c.title || '(Untitled)');
            breadcrumbs.appendChild(chip);
          });
        }
      }

      /**
       * Render the list of cards (root level or children)
       */
      function renderCardList() {
        const parentId = navState.cardId;
        let kids = [];
        if (!parentId) {
          kids = store.rootOrder.map(id => store.cards[id]).filter(c => c);
        } else {
          const parent = store.cards[parentId];
          if (!parent) {
            main.appendChild(h('div', { className: 'empty' }, 'Card not found.'));
            return;
          }
          kids = parent.children.map(id => store.cards[id]).filter(c => c);
        }
        searchContainer.style.display = 'block';
        const title = parentId ? (store.cards[parentId]?.title || 'Card') : 'Top Level Cards';
        main.appendChild(h('div', { className: 'page-title' }, title));
        
        kids.sort((a, b) => (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase()));
        
        if (kids.length === 0) {
          const emptyEl = h('div', { className: 'empty empty-state' });
          emptyEl.appendChild(h('p', {}, 'No cards yet. Create one to get started!'));
          emptyEl.appendChild(h('button', {
            className: 'empty-new-card-btn',
            onclick: () => goTo('edit', { cardId: null, parentId: parentId || null })
          }, parentId ? '+ Add Child Card' : '+ New Card'));
          main.appendChild(emptyEl);
        } else {
          const gridViewEnabled = localStorage.getItem('cardspoke_gridView') === 'true';
          const isCompactMode = store.viewMode === 'compact';

          // Density picker bar
          const densityBar = h('div', { className: 'density-bar', 'aria-label': 'Card density' });
          const densityOptions = [
            { key: 'default', label: 'Default', active: !gridViewEnabled && !isCompactMode },
            { key: 'compact', label: 'Compact', active: !gridViewEnabled && isCompactMode },
            { key: 'grid', label: 'Grid', active: gridViewEnabled },
          ];
          densityOptions.forEach(opt => {
            const btn = h('button', {
              className: 'density-btn' + (opt.active ? ' active' : ''),
              'aria-pressed': opt.active ? 'true' : 'false',
              onclick: () => {
                if (opt.key === 'grid') {
                  localStorage.setItem('cardspoke_gridView', 'true');
                  if (store.viewMode === 'compact') toggleViewMode();
                } else if (opt.key === 'compact') {
                  localStorage.removeItem('cardspoke_gridView');
                  if (store.viewMode !== 'compact') toggleViewMode();
                } else {
                  localStorage.removeItem('cardspoke_gridView');
                  if (store.viewMode === 'compact') toggleViewMode();
                }
                render();
              }
            }, opt.label);
            densityBar.appendChild(btn);
          });
          main.appendChild(densityBar);

          const gridClass = gridViewEnabled ? 'card-grid grid-view' : 'card-grid';
          const grid = h('div', { className: gridClass, role: 'list' });
          let renderIndex = 0;
          const batchSize = 60;
          const renderBatch = () => {
            const frag = document.createDocumentFragment();
            const start = renderIndex;
            const upgradeEntries = [];
            for (let i = start; i < Math.min(start + batchSize, kids.length); i++) {
              const card = kids[i];
              const cardEl = renderCardTile(card, { lazyBody: true });
              frag.appendChild(cardEl);
              upgradeEntries.push({ card: card, tileEl: cardEl });
            }
            grid.appendChild(frag);
            renderIndex += batchSize;
            scheduleCardRenderUpgrade(upgradeEntries);
          };
          const onScroll = () => {
            if (renderIndex >= kids.length) return;
            const threshold = grid.offsetTop + grid.offsetHeight - window.innerHeight * 2;
            if (window.scrollY + window.innerHeight > threshold) {
              requestAnimationFrame(renderBatch);
            }
          };
          renderBatch();
          window.addEventListener('scroll', onScroll, { passive: true });
          registerRenderCleanup(() => window.removeEventListener('scroll', onScroll));
          main.appendChild(grid);
        }
      }

      /**
       * Render a single card tile in list view
       * @param {Object} card - Card to render
       * @returns {HTMLElement} Card tile element
       */
      function renderCardTile(card, opts = {}) {
        // A plugin-registered custom Card component (or a card.render
        // decorator) is no longer applied here, synchronously and per-tile —
        // plugin JS runs in a sandboxed Worker, so producing a custom render
        // is an async RPC round trip. The default tile below is always built
        // first so rendering is never blocked on a plugin; callers that
        // batch tiles (renderBatch in the list and search views) schedule an
        // async upgrade pass afterward via scheduleCardRenderUpgrade(). See
        // docs/architecture/PLUGIN_SYSTEM.md "The Card render hot path".
        const isCompact = store.viewMode === 'compact';
        const cardClasses = isCompact ? 'card card-compact' : 'card';
        const cardEl = h('button', { className: cardClasses + ' card-tile', onclick: () => goTo('read', { cardId: card.id }), 'aria-label': 'Open card: ' + (card.title || 'Untitled'), role: 'listitem' });
        cardEl.dataset.cardId = card.id;
        cardEl.dataset.renderType = 'list';

        // Left side content
        const contentEl = h('div', { className: 'card-content' });
        
        // Add bookmark indicator if bookmarked
        const titleWrapper = h('div', { style: 'display: flex; align-items: center; gap: 8px; min-width: 0;' });
        if (isBookmarked(card.id)) {
          titleWrapper.appendChild(h('span', { 
            style: 'color: gold; font-size: 18px;',
            title: 'Bookmarked'
          }, '★'));
        }
        const titleContent = opts.highlightQuery ? highlightText(card.title || '(Untitled)', opts.highlightQuery) : document.createTextNode(card.title || '(Untitled)');
        const titleDiv = h('div', { className: 'card-title' });
        titleDiv.appendChild(titleContent);
        titleWrapper.appendChild(titleDiv);
        contentEl.appendChild(titleWrapper);

        if (card.body && !isCompact) {
          const previewText = card.body.substring(0, 140) + (card.body.length > 140 ? '...' : '');
          const desc = h('div', { className: 'card-description' });
          if (opts.highlightQuery) {
            desc.appendChild(highlightText(previewText, opts.highlightQuery));
          } else if (opts.lazyBody) {
            desc.dataset.preview = previewText;
          } else {
            desc.textContent = previewText;
          }
          contentEl.appendChild(desc);
        }
        
        const tags = (card.tags && card.tags.length ? card.tags : extractTags(card.body));
        if (tags.length > 0 && !isCompact) {
          const tagsEl = h('div', { className: 'card-tags' });
          tags.forEach(tag => {
            tagsEl.appendChild(h('span', { className: 'card-tag' }, tag));
          });
          contentEl.appendChild(tagsEl);
        }
        
        cardEl.appendChild(contentEl);

        // Right side count
        if (card.children && card.children.length > 0) {
          cardEl.appendChild(h('div', { className: 'card-count' }, String(card.children.length)));
        }

        if (opts.lazyBody) {
          if (!previewObserver) {
            previewObserver = new IntersectionObserver(entries => {
              entries.forEach(entry => {
                if (entry.isIntersecting) {
                  const previewEl = entry.target.querySelector('.card-description[data-preview]');
                  if (previewEl && previewEl.dataset.preview) {
                    previewEl.textContent = previewEl.dataset.preview;
                    delete previewEl.dataset.preview;
                  }
                  previewObserver.unobserve(entry.target);
                }
              });
            }, { rootMargin: '200px' });
          }
          previewObserver.observe(cardEl);
        }

        return cardEl;
      }

      // --- Plugin Card-render upgrade pass (async, batched, best-effort) ---
      //
      // Zero plugins registered on 'Card'/'card.render' → getCardRenderPluginIds()
      // is empty and this is a no-op check, unconditionally. Otherwise, one
      // RPC round trip per plugin per batch (not per tile) asks that
      // plugin's sandboxed worker for an optional replacement vnode (a
      // custom 'Card' component) and/or an optional decorator patch
      // (card.render), racing a short deadline inside Plugin.renderBatch()
      // so a slow or hung plugin can never stall/stutter rendering — the
      // default tiles already on screen simply stand for that pass.
      const cardRenderCache = new Map();
      const CARD_RENDER_CACHE_LIMIT = 1000;

      function buildTileSnapshot(tileEl) {
        const tagEls = tileEl.querySelectorAll('.card-tag');
        return {
          classList: Array.from(tileEl.classList),
          hasBody: !!tileEl.querySelector('.card-description'),
          hasTags: tagEls.length > 0,
          tagTexts: Array.from(tagEls).map(el => el.textContent),
          isCompact: tileEl.classList.contains('card-compact')
        };
      }

      function applyCardRenderResults(results, byCardId) {
        (results || []).forEach(r => {
          const entry = byCardId.get(r.cardId);
          if (!entry || !entry.tileEl || !entry.tileEl.isConnected) return;
          if (r.vnode) {
            try {
              const newEl = vnodeToDOM(r.vnode);
              newEl.dataset.cardId = String(r.cardId);
              newEl.dataset.renderType = entry.tileEl.dataset.renderType || 'list';
              entry.tileEl.replaceWith(newEl);
              entry.tileEl = newEl;
            } catch (err) {
              console.warn('[Plugin] Card component render failed:', err);
            }
          }
          if (r.patch) {
            try { applyPatch(entry.tileEl, r.patch); } catch (err) { console.warn('[Plugin] card.render patch failed:', err); }
          }
        });
      }

      /**
       * @param {{card: object, tileEl: HTMLElement, isSelected?: boolean}[]} entries
       */
      async function scheduleCardRenderUpgrade(entries) {
        const Plugin = window.CardSpoke && window.CardSpoke.Plugin;
        if (!Plugin) return;
        const pluginIds = Plugin.getCardRenderPluginIds();
        if (!pluginIds.length) return;

        const byCardId = new Map();
        entries.forEach(e => { if (e.tileEl && e.tileEl.isConnected) byCardId.set(e.card.id, e); });
        if (!byCardId.size) return;

        for (const pluginId of pluginIds) {
          const toFetch = [];
          const cachedResults = [];
          byCardId.forEach((entry, cardId) => {
            const cacheKey = pluginId + '|' + cardId + '|' + (entry.card.updatedAt || 0);
            const cached = cardRenderCache.get(cacheKey);
            if (cached) {
              cachedResults.push({ cardId: cardId, vnode: cached.vnode, patch: cached.patch });
            } else {
              toFetch.push({ card: entry.card, isSelected: !!entry.isSelected, tileSnapshot: buildTileSnapshot(entry.tileEl) });
            }
          });

          if (cachedResults.length) applyCardRenderResults(cachedResults, byCardId);

          if (toFetch.length) {
            const results = await Plugin.renderBatch(pluginId, toFetch, {});
            if (results) {
              results.forEach(r => {
                const entry = byCardId.get(r.cardId);
                const key = pluginId + '|' + r.cardId + '|' + (entry ? (entry.card.updatedAt || 0) : 0);
                cardRenderCache.set(key, { vnode: r.vnode, patch: r.patch });
              });
              if (cardRenderCache.size > CARD_RENDER_CACHE_LIMIT) {
                const excess = cardRenderCache.size - CARD_RENDER_CACHE_LIMIT;
                const it = cardRenderCache.keys();
                for (let i = 0; i < excess; i++) cardRenderCache.delete(it.next().value);
              }
              applyCardRenderResults(results, byCardId);
            }
          }
        }
      }

      /**
       * Render card body text with clickable card links
       * Converts [[Card Name]] to clickable links
       * @param {string} text - Card body text
       * @returns {HTMLElement} Div element with rendered content
       */
      function renderCardBody(text) {
        const container = h('div', { className: 'card-detail-body' });

        if (!text) return container;
        
        const links = parseCardLinks(text);
        
        if (links.length === 0) {
          // No links, just return plain text
          container.textContent = text;
          return container;
        }
        
        // Sort links by start index to process in order
        links.sort((a, b) => a.startIndex - b.startIndex);
        
        let lastIndex = 0;
        
        links.forEach(link => {
          // Add text before the link
          if (link.startIndex > lastIndex) {
            const textBefore = text.substring(lastIndex, link.startIndex);
            container.appendChild(document.createTextNode(textBefore));
          }
          
          // Find the card ID
          const cardId = findCardByName(link.cardName);
          
          // Create clickable link
          const linkEl = h('span', { 
            className: cardId ? 'card-link' : 'card-link-missing',
            style: 'cursor: pointer;',
            title: cardId ? `Go to: ${link.cardName}` : `Card not found: ${link.cardName} (click to create)`
          }, link.cardName);
          
          // Add click handler
          linkEl.addEventListener('click', async e => {
            e.stopPropagation();
            if (cardId) {
              // Card exists, navigate to it
              goTo('read', { cardId });
            } else {
              // Card doesn't exist, offer to create it
              if (await showConfirmDialog(`Card "${link.cardName}" doesn't exist. Create it?`, {
                title: 'Create Linked Card',
                confirmLabel: 'Create Card',
                cancelLabel: 'Cancel',
                confirmClassName: 'btn btn-primary'
              })) {
                const newId = createCard(link.cardName, '', null);
                goTo('edit', { cardId: newId });
              }
            }
          });
          
          container.appendChild(linkEl);
          lastIndex = link.endIndex;
        });
        
        // Add remaining text after the last link
        if (lastIndex < text.length) {
          const textAfter = text.substring(lastIndex);
          container.appendChild(document.createTextNode(textAfter));
        }
        
        return container;
      }

      function renderRichTextBody(text) {
        const container = h('div', { className: 'card-detail-body rich-body', role: 'article' });
        if (!text) return container;
        const lines = text.split(/\n/);
        let listEl = null;
        lines.forEach(line => {
          if (/^#{1,3} /.test(line)) {
            if (listEl) { container.appendChild(listEl); listEl = null; }
            const level = line.match(/^#+/)[0].length;
            const title = line.replace(/^#{1,3} /, '');
            const header = h(`h${level}`, {}, title);
            container.appendChild(header);
            return;
          }
          if (/^-\s+/.test(line)) {
            if (!listEl) listEl = document.createElement('ul');
            const li = document.createElement('li');
            li.textContent = line.replace(/^-\s+/, '');
            listEl.appendChild(li);
            return;
          }
          if (listEl) { container.appendChild(listEl); listEl = null; }
          const para = document.createElement('p');
          let html = escapeHtml(line)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/_(.+?)_/g, '<em>$1</em>');
          para.innerHTML = html;
          container.appendChild(para);
        });
        if (listEl) container.appendChild(listEl);
        return container;
      }

      /**
       * Render a card in read-only/detail view
       */
      function renderReadOnlyCard() {
        searchContainer.style.display = 'none';
        const card = store.cards[navState.cardId];
        if (!card) {
          main.appendChild(h('div', { className: 'empty' }, 'Card not found.'));
          return;
        }
        const detail = h('div', { className: 'card-detail' });
        detail.appendChild(h('div', { className: 'card-detail-title' }, card.title || '(Untitled)'));
        if (card.body) {
          // Check global Rich Text setting OR per-card setting
          const globalRichText = localStorage.getItem('cardspoke_richtext') === 'true';
          const useRichText = globalRichText || card.isRichText;
          detail.appendChild(useRichText ? renderRichTextBody(card.body) : renderCardBody(card.body));
        }
        // Tags display
        const _tags = (card.tags && card.tags.length ? card.tags : extractTags(card.body));
        if (_tags.length) {
          const tagsWrap = h('div', { className: 'card-tags' });
          _tags.forEach(t => tagsWrap.appendChild(h('span', { className: 'card-tag' }, t)));
          detail.appendChild(tagsWrap);
        }
        const actions = h('div', { className: 'card-detail-actions' });
        actions.appendChild(h('button', { className: 'btn btn-primary', onclick: () => goTo('edit', { cardId: card.id }) }, 'Edit'));
        
        // Bookmark button
        const bookmarkBtnText = isBookmarked(card.id) ? '★ Unbookmark' : '☆ Bookmark';
        actions.appendChild(h('button', { 
          className: 'btn', 
          onclick: (e) => {
            e.stopPropagation();
            toggleBookmark(card.id);
          }
        }, bookmarkBtnText));
        
        // Duplicate button with dropdown-like behavior
        actions.appendChild(h('button', {
          className: 'btn',
          onclick: async () => {
            const choice = await showConfirmDialog('Duplicate this card with all of its children?', {
              title: 'Duplicate Card',
              confirmLabel: 'With Children',
              cancelLabel: 'Only This Card',
              confirmClassName: 'btn btn-primary'
            });
            const newId = duplicateCard(card.id, choice);
            if (newId) {
              showToast('Card duplicated successfully');
              goTo('read', { cardId: newId });
            }
          }
        }, 'Duplicate'));

        // Share button (v1.0.0)
        actions.appendChild(h('button', {
          className: 'btn',
          onclick: () => showShareCard(card.id)
        }, 'Share'));

        actions.appendChild(h('button', { className: 'btn', onclick: () => {
          goTo('edit', { parentId: card.id });
        } }, 'Add Child'));
        
        actions.appendChild(h('button', { className: 'btn', onclick: () => openUploadModalForCard(card.id, 'txt') }, 'Import TXT'));
        
        actions.appendChild(h('button', { className: 'btn btn-danger', onclick: async () => {
          if (await showConfirmDialog('Delete this card and all of its children?', {
            title: 'Delete Card',
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            confirmClassName: 'btn btn-danger'
          })) {
            deleteCard(card.id);
            goTo('list', { cardId: card.parentId });
          }
        } }, 'Delete'));
        detail.appendChild(actions);
        if (card.children && card.children.length > 0) {
          const childrenSection = h('div', { className: 'children-section' });
          childrenSection.appendChild(h('div', { className: 'children-title' }, `Children (${card.children.length})`));
          const childrenGrid = h('div', { className: 'card-grid' });
          const childUpgradeEntries = [];
          card.children.forEach(cid => {
            const childCard = store.cards[cid];
            if (childCard) {
              const childEl = renderCardTile(childCard);
              childrenGrid.appendChild(childEl);
              childUpgradeEntries.push({ card: childCard, tileEl: childEl });
            }
          });
          scheduleCardRenderUpgrade(childUpgradeEntries);
          childrenSection.appendChild(childrenGrid);
          detail.appendChild(childrenSection);
        }
        // Backlinks section
        const backlinks = getBacklinks(card.id);
        if (backlinks.length > 0) {
          const backlinksSection = h('div', { className: 'backlinks-section' });
          backlinksSection.appendChild(h('div', { className: 'section-title' }, `← Referenced By (${backlinks.length})`));
          const backlinksGrid = h('div', { className: 'card-grid' });
          backlinks.forEach(backlink => {
            const backlinkTile = h('div', { 
              className: 'card-tile', 
              onclick: () => goTo('read', { cardId: backlink.id }) 
            });
            backlinkTile.appendChild(h('div', { className: 'card-tile-title' }, backlink.title));
            backlinksGrid.appendChild(backlinkTile);
          });
          backlinksSection.appendChild(backlinksGrid);
          detail.appendChild(backlinksSection);
        }
        
        // Related cards section (based on tags)
        const relatedCards = getRelatedCards(card.id, 5);
        if (relatedCards.length > 0) {
          const relatedSection = h('div', { className: 'related-section' });
          relatedSection.appendChild(h('div', { className: 'section-title' }, `Related Cards (${relatedCards.length})`));
          const relatedGrid = h('div', { className: 'card-grid' });
          relatedCards.forEach(related => {
            const relatedTile = h('div', { 
              className: 'card-tile', 
              onclick: () => goTo('read', { cardId: related.id }) 
            });
            const titleDiv = h('div', { className: 'card-tile-title' }, related.title);
            relatedTile.appendChild(titleDiv);
            // Show matched tags
            const tagsDiv = h('div', { className: 'card-tags' });
            related.matchedTags.forEach(tag => {
              tagsDiv.appendChild(h('span', { className: 'card-tag' }, tag));
            });
            relatedTile.appendChild(tagsDiv);
            relatedGrid.appendChild(relatedTile);
          });
          relatedSection.appendChild(relatedGrid);
          detail.appendChild(relatedSection);
        }
        main.appendChild(detail);
      }

      /**
       * Render card edit form
       */
      function renderEditCard() {
        searchContainer.style.display = 'none';
        const editing = !!navState.cardId;
        const card = editing ? store.cards[navState.cardId] : {
          id: null,
          title: '',
          body: '',
          parentId: navState.parentId,
          children: []
        };
        if (editing && !card) {
          main.appendChild(h('div', { className: 'empty' }, 'Card not found.'));
          return;
        }
        const form = h('form', {
          onsubmit: (e) => {
            e.preventDefault();
            const titleVal = form.querySelector('#cardTitle').value.trim();
            const bodyVal = form.querySelector('#cardBody').value.trim();
            const parentVal = form.querySelector('#cardParent').value || null;
            const tagsVal = (tagEditor.getTags && tagEditor.getTags()) || [];
            if (editing) {
              const oldParentId = card.parentId;
              if (oldParentId !== parentVal) {
                if (oldParentId) {
                  const oldParent = store.cards[oldParentId];
                  if (oldParent) oldParent.children = oldParent.children.filter(c => c !== card.id);
                } else {
                  store.rootOrder = store.rootOrder.filter(c => c !== card.id);
                }
                if (parentVal) {
                  const newParent = store.cards[parentVal];
                  if (newParent && !newParent.children.includes(card.id)) newParent.children.push(card.id);
                } else {
                  if (!store.rootOrder.includes(card.id)) store.rootOrder.push(card.id);
                }
                card.parentId = parentVal;
              }
              updateCard(card.id, { title: titleVal, body: bodyVal, tags: tagsVal, isRichText: richToggle.checked }, true, true);
              card.children.forEach(cid => {
                const inp = childrenInpMap[cid];
                if (inp) updateCard(cid, { title: inp.value.trim() }, true, true);
              });
              const newKidRows = form.querySelectorAll('#addChildList .form-child-row input');
              newKidRows.forEach(inp => {
                const t = inp.value.trim();
                if (t) createCard(t, '', card.id, true, true);
              });
              save();
              goTo('read', { cardId: card.id });
            } else {
              const newId = createCard(titleVal, bodyVal, parentVal, true, true);
              // Persist tags and formatting through the same update path as
              // edit mode so first-save tags are never dropped (QA FUNC-1).
              updateCard(newId, { tags: tagsVal, isRichText: richToggle.checked }, true, true);
              const newKidRows = form.querySelectorAll('#addChildList .form-child-row input');
              newKidRows.forEach(inp => {
                const t = inp.value.trim();
                if (t) createCard(t, '', newId, true, true);
              });
              save();
              goTo('read', { cardId: newId });
            }
          }
        });
        const formGroup1 = h('div', { className: 'form-group' });
        formGroup1.appendChild(h('label', { className: 'form-label', for: 'cardTitle' }, 'Title'));
        formGroup1.appendChild(h('input', { type: 'text', id: 'cardTitle', className: 'form-input', value: card.title, oninput: () => { setDirty(true); } }));
        form.appendChild(formGroup1);
        const formGroup2 = h('div', { className: 'form-group' });
        const bodyLabelRow = h('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-sm);' });
        bodyLabelRow.appendChild(h('label', { className: 'form-label', style: 'margin-bottom: 0;' }, 'Body'));
        
        // Add upload button for importing text from files (v0.12.3)
        const importBodyBtn = h('button', {
          type: 'button',
          className: 'btn',
          style: 'font-size: var(--text-sm);',
          onclick: function() {
            const fileInput = h('input', { type: 'file', accept: '.txt,.md,.text', style: 'display: none' });
            fileInput.onchange = function(e) {
              const file = e.target.files[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = async function(ev) {
                  const currentBody = document.getElementById('cardBody');
                  const importAction = !currentBody.value ? 'replace' : await showChoiceDialog(
                    'How would you like to apply the imported file contents to this card body?',
                    {
                      title: 'Import Text File',
                      dismissValue: 'cancel',
                      actions: [
                        { label: 'Cancel', value: 'cancel', className: 'btn' },
                        { label: 'Append', value: 'append', className: 'btn' },
                        { label: 'Replace', value: 'replace', className: 'btn btn-primary' }
                      ]
                    }
                  );
                  if (importAction === 'cancel') {
                    return;
                  }
                  if (importAction === 'append') {
                    currentBody.value += '\n\n' + ev.target.result;
                  } else {
                    currentBody.value = ev.target.result;
                  }
                  setDirty(true);
                  showToast('Content imported from ' + file.name);
                };
                reader.onerror = function() {
                  showToast('Failed to read file', 'error');
                };
                reader.readAsText(file);
              }
            };
            fileInput.click();
          }
        }, 'Import from File');
        bodyLabelRow.appendChild(importBodyBtn);
        formGroup2.appendChild(bodyLabelRow);
        
        const richToggleRow = h('div', { className: 'form-row' });
        const richToggle = h('input', { type: 'checkbox', id: 'cardRich', checked: card.isRichText });
        const richLabel = h('label', { for: 'cardRich', style: 'margin-left: 6px;' }, 'Enable formatting (Markdown)');
        richToggle.addEventListener('change', () => { setDirty(true); });
        richToggleRow.appendChild(richToggle);
        richToggleRow.appendChild(richLabel);
        formGroup2.appendChild(richToggleRow);

        const bodyTextarea = h('textarea', { id: 'cardBody', className: 'form-textarea', 'aria-label': 'Card body' });
        bodyTextarea.value = card.body;
        bodyTextarea.addEventListener('input', () => { setDirty(true); });

        const toolbar = h('div', { className: 'rich-toolbar', role: 'toolbar', 'aria-label': 'Formatting toolbar' });
        const applyWrap = (before, after = before) => {
          const start = bodyTextarea.selectionStart;
          const end = bodyTextarea.selectionEnd;
          const selected = bodyTextarea.value.substring(start, end) || 'text';
          const newValue = bodyTextarea.value.slice(0, start) + before + selected + after + bodyTextarea.value.slice(end);
          bodyTextarea.value = newValue;
          bodyTextarea.focus();
          bodyTextarea.selectionStart = start + before.length;
          bodyTextarea.selectionEnd = start + before.length + selected.length;
          setDirty(true);
        };
        const addBlockPrefix = (prefix) => {
          const cursor = bodyTextarea.selectionStart;
          const value = bodyTextarea.value;
          const before = value.slice(0, cursor);
          const after = value.slice(cursor);
          const newText = before + `\n${prefix}`;
          bodyTextarea.value = newText + after;
          bodyTextarea.focus();
          setDirty(true);
        };
        const buttonGroups = [
          [
            { label: 'B', action: () => applyWrap('**', '**'), aria: 'Bold' },
            { label: 'I', action: () => applyWrap('_', '_'), aria: 'Italic' },
          ],
          [
            { label: 'H1', action: () => addBlockPrefix('# '), aria: 'Heading 1' },
            { label: 'H2', action: () => addBlockPrefix('## '), aria: 'Heading 2' },
            { label: 'H3', action: () => addBlockPrefix('### '), aria: 'Heading 3' },
            { label: '• List', action: () => addBlockPrefix('- '), aria: 'Bullet list' },
          ]
        ];
        buttonGroups.forEach((grp, gi) => {
          if (gi > 0) toolbar.appendChild(h('span', { className: 'toolbar-sep', 'aria-hidden': 'true' }));
          grp.forEach(btn => {
            const el = h('button', { type: 'button', className: 'btn btn-ghost', 'aria-label': btn.aria, title: btn.aria, onclick: btn.action });
            el.textContent = btn.label;
            toolbar.appendChild(el);
          });
        });

        formGroup2.appendChild(toolbar);
        formGroup2.appendChild(bodyTextarea);
        form.appendChild(formGroup2);
        // Tags input with autocomplete
        const formGroupTags = h('div', { className: 'form-group' });
        formGroupTags.appendChild(h('label', { className: 'form-label' }, 'Tags (comma-separated)'));
        
        // Create datalist with all existing tags for autocomplete
        const tagsDatalistId = 'tags-datalist-' + Date.now();
        const tagsDatalist = h('datalist', { id: tagsDatalistId });
        const existingTags = getAllTags();
        existingTags.forEach(tag => {
          tagsDatalist.appendChild(h('option', { value: tag }));
        });

        const tagEditor = createTagEditor(card.tags || [], tagsDatalistId);
        tagEditor.addEventListener('focusin', () => { setDirty(true); });

        formGroupTags.appendChild(tagEditor);
        formGroupTags.appendChild(tagsDatalist);
        form.appendChild(formGroupTags);
        
        // Add "Suggest Tags" button
        if (editing && card.id) {
          const suggestBtn = h('button', {
            type: 'button',
            className: 'btn btn-secondary',
            onclick: () => showTagSuggestions(card.id),
            style: 'margin-top: var(--space-sm);'
          }, 'Suggest Tags');
          formGroupTags.appendChild(suggestBtn);
        }
    
        const formGroup3 = h('div', { className: 'form-group' });
        formGroup3.appendChild(h('label', { className: 'form-label', for: 'cardParent' }, 'Parent Card'));
        const parentFilter = h('input', {
          type: 'text',
          className: 'form-input parent-filter-input',
          placeholder: 'Filter parent cards…',
          'aria-label': 'Filter parent cards',
        });
        const parentSel = h('select', { id: 'cardParent', className: 'form-select' });
        const parVal = card.parentId || '';
        parentSel.appendChild(h('option', { value: '', selected: !parVal }, '(Root Level)'));
        // Exclude the card itself AND all of its descendants from the parent
        // options: reparenting a card into its own subtree would create a
        // cycle that hangs breadcrumb/ancestor traversal. Walk is cycle-safe.
        const excludedParentIds = new Set([card.id]);
        if (editing && card.id) {
          const descStack = [card.id];
          const seenDesc = new Set();
          while (descStack.length) {
            const curId = descStack.pop();
            if (seenDesc.has(curId)) continue;
            seenDesc.add(curId);
            const cur = store.cards[curId];
            if (cur && Array.isArray(cur.children)) {
              for (const kid of cur.children) { excludedParentIds.add(kid); descStack.push(kid); }
            }
          }
        }
        const parentCards = Object.values(store.cards)
          .filter(c => !excludedParentIds.has(c.id))
          .sort((a, b) => (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase()));
        parentCards.forEach(c => {
          parentSel.appendChild(h('option', { value: c.id, selected: parVal === c.id }, c.title || '(Untitled)'));
        });
        parentFilter.addEventListener('input', () => {
          const val = parentFilter.value.toLowerCase();
          Array.from(parentSel.options).forEach(opt => {
            if (opt.value === '') return;
            opt.hidden = val.length > 0 && !opt.text.toLowerCase().includes(val);
          });
        });
        parentSel.addEventListener('change', () => { setDirty(true); });
        formGroup3.appendChild(parentFilter);
        formGroup3.appendChild(parentSel);
        form.appendChild(formGroup3);
        let childrenInpMap = {};
        if (editing) {
          const formGroup4 = h('div', { className: 'form-group' });
          formGroup4.appendChild(h('label', { className: 'form-label form-section-title' }, 'Children'));
          const kidsWrap = h('div', { className: 'form-children' });
          card.children.forEach(cid => {
            const c = store.cards[cid];
            const row = h('div', { className: 'form-child-row' });
            const chInp = h('input', { type: 'text', value: c.title, className: 'form-input form-child-input', 'aria-label': 'Child card title' });
            chInp.addEventListener('input', () => { setDirty(true); });
            row.appendChild(chInp);
            const delBtn = h('button', {
              type: 'button',
              className: 'form-child-delete',
              'aria-label': 'Delete child card',
              title: 'Delete child card',
              onclick: async () => {
                if (await showConfirmDialog('Delete this child card and all of its children?', {
                  title: 'Delete Child Card',
                  confirmLabel: 'Delete',
                  cancelLabel: 'Cancel',
                  confirmClassName: 'btn btn-danger'
                })) {
                  deleteCard(cid);
                  save();
                  render();
                }
              }
            }, '✕');
            row.appendChild(delBtn);
            childrenInpMap[cid] = chInp;
            kidsWrap.appendChild(row);
          });
          formGroup4.appendChild(kidsWrap);
          form.appendChild(formGroup4);
          const formGroup5 = h('div', { className: 'form-group' });
          formGroup5.appendChild(h('label', { className: 'form-label form-section-title' }, 'Add New Children'));
          const newKidsWrap = h('div', { className: 'form-children', id: 'addChildList' });
          const addChildRow = (title = '') => {
            const r = h('div', { className: 'form-child-row' });
            const t = h('input', { type: 'text', value: title, placeholder: 'Child title...', className: 'form-input form-child-input', 'aria-label': 'New child card title' });
            t.addEventListener('input', () => { setDirty(true); });
            const d = h('button', { type: 'button', className: 'form-child-delete', 'aria-label': 'Remove child row', title: 'Remove child row', onclick: () => { r.remove(); } }, '✕');
            r.appendChild(t);
            r.appendChild(d);
            newKidsWrap.appendChild(r);
          };
          addChildRow();
          formGroup5.appendChild(newKidsWrap);
          formGroup5.appendChild(h('button', { type: 'button', className: 'btn', onclick: () => addChildRow() }, '+ Add Another Child'));
          form.appendChild(formGroup5);
        } else {
          const formGroup4 = h('div', { className: 'form-group' });
          formGroup4.appendChild(h('label', { className: 'form-label form-section-title' }, 'Add Children Now (title only)'));
          const kidsWrap = h('div', { className: 'form-children', id: 'addChildList' });
          const addChildRow = (title = '') => {
            const r = h('div', { className: 'form-child-row' });
            const t = h('input', { type: 'text', value: title, placeholder: 'Child title...', className: 'form-input form-child-input', 'aria-label': 'New child card title' });
            t.addEventListener('input', () => { setDirty(true); });
            const d = h('button', { type: 'button', className: 'form-child-delete', 'aria-label': 'Remove child row', title: 'Remove child row', onclick: () => { r.remove(); } }, '✕');
            r.appendChild(t);
            r.appendChild(d);
            kidsWrap.appendChild(r);
          };
          addChildRow();
          formGroup4.appendChild(kidsWrap);
          formGroup4.appendChild(h('button', { type: 'button', className: 'btn', onclick: () => addChildRow() }, '+ Add Another Child'));
          form.appendChild(formGroup4);
        }
        const formActions = h('div', { className: 'form-actions' });
        formActions.appendChild(h('button', { type: 'submit', className: 'btn btn-primary' }, 'Save'));
        formActions.appendChild(h('button', { type: 'button', className: 'btn', onclick: () => editing ? goTo('read', { cardId: card.id }) : goBack() }, 'Cancel'));
        if (editing) {
          formActions.appendChild(h('button', {
            type: 'button',
            className: 'btn btn-danger',
            onclick: async () => {
              if (await showConfirmDialog('Delete this card and all of its children?', {
                title: 'Delete Card',
                confirmLabel: 'Delete',
                cancelLabel: 'Cancel',
                confirmClassName: 'btn btn-danger'
              })) {
                deleteCard(card.id);
                save();
                goTo('list', { cardId: card.parentId ?? null });
              }
            }
          }, 'Delete'));
        }
        form.appendChild(formActions);
        const editWrapper = h('div', { className: 'card-edit-form' });
        main.appendChild(h('div', { className: 'page-title' }, editing ? 'Edit Card' : getEditPageLabel()));
        editWrapper.appendChild(form);
        main.appendChild(editWrapper);
      }

      /**
       * Render search results page
       */
      function renderSearchResults() {
        // Keep the search bar visible on the results page so keyboard users
        // can refine the query and the Arrow/Enter hint stays honest (QA UX-1).
        searchContainer.style.display = 'block';
        if (searchInput && searchInput.value.trim() !== navState.searchQuery.trim()) {
          searchInput.value = navState.searchQuery;
        }
        const query = navState.searchQuery.trim();
        if (!query) {
          main.appendChild(h('div', { className: 'empty' }, 'Please enter a search term.'));
          return;
        }
        
        // Get selected dataset scope
        const scope = datasetSelector ? datasetSelector.value : 'current';
        
        // Show loading indicator
        main.appendChild(h('div', { className: 'page-title' }, `Search: "${navState.searchQuery}"`));
        const loadingDiv = h('div', { 
          className: 'search-info',
          style: 'padding: 12px; margin-bottom: 12px; background: var(--bg-secondary); border-radius: 8px; font-size: 14px; color: var(--text-secondary);'
        }, 'Searching...');
        main.appendChild(loadingDiv);
        
        // Use multi-dataset fuzzy search for typo-tolerant results
        fuzzySearchMultiDataset(query, scope).then(fuzzyResults => {
          // Remove loading indicator
          loadingDiv.remove();

          // Apply advanced search filters if present
          try {
            const filtersStr = sessionStorage.getItem('searchFilters');
            if (filtersStr) {
              const filters = JSON.parse(filtersStr);
              
              // Filter by tag
              if (filters.tagFilter) {
                const tagFilterLower = filters.tagFilter.toLowerCase();
                fuzzyResults = fuzzyResults.filter(result => {
                  const card = result.card;
                  return card.tags && card.tags.some(tag => tag.toLowerCase() === tagFilterLower);
                });
              }
              
              // Filter by bookmark status
              if (filters.bookmarkOnly) {
                fuzzyResults = fuzzyResults.filter(result => result.card.bookmarked === true);
              }
              
              // Filter by date
              if (filters.dateFilter) {
                const now = Date.now();
                let startTime = 0;
                
                if (filters.dateFilter === 'today') {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  startTime = today.getTime();
                } else if (filters.dateFilter === 'week') {
                  startTime = now - (7 * 24 * 60 * 60 * 1000);
                } else if (filters.dateFilter === 'month') {
                  startTime = now - (30 * 24 * 60 * 60 * 1000);
                }
                
                fuzzyResults = fuzzyResults.filter(result => {
                  const card = result.card;
                  return (card.createdAt && card.createdAt >= startTime) || 
                         (card.updatedAt && card.updatedAt >= startTime);
                });
              }
              
              // Clear filters after use
              sessionStorage.removeItem('searchFilters');
            }
          } catch (err) {
            console.error('Error applying search filters:', err);
          }

          const hookResults = fuzzyResults.map(result => ({
            ...result,
            card: cloneCard(result.card)
          }));

          if (fuzzyResults.length === 0) {
            main.appendChild(h('div', { className: 'empty' }, 'No results found. Try different keywords.'));
          } else {
            // Show result count with fuzzy indicator
            const scopeText = scope === 'all' ? ' across all datasets' : '';
            const resultInfo = h('div', {
              className: 'search-info',
              style: 'padding: 12px; margin-bottom: 8px; background: var(--bg-secondary); border-radius: 8px; font-size: 14px; color: var(--text-secondary);'
            }, `Found ${fuzzyResults.length} result${fuzzyResults.length === 1 ? '' : 's'}${scopeText}${fuzzyResults.some(result => result.approximate) ? ' (approximate matches marked with ~)' : ''}`);
            main.appendChild(resultInfo);

            // Sort bar
            let currentSortMode = 'relevance';
            const sortBar = h('div', { className: 'sort-bar', 'aria-label': 'Sort results' });
            sortBar.appendChild(h('span', { className: 'sort-bar-label' }, 'Sort:'));
            const sortOptions = [
              { key: 'relevance', label: 'Relevance' },
              { key: 'title', label: 'Title' },
              { key: 'newest', label: 'Newest' },
              { key: 'updated', label: 'Updated' },
            ];
            const applySortMode = (mode) => {
              currentSortMode = mode;
              sortBar.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sortKey === mode));
              const grid = main.querySelector('#searchResultGrid');
              if (!grid) return;
              const sorted = fuzzyResults.slice().sort((a, b) => {
                if (mode === 'title') return (a.card.title || '').toLowerCase().localeCompare((b.card.title || '').toLowerCase());
                if (mode === 'newest') return ((b.card.createdAt || 0) - (a.card.createdAt || 0));
                if (mode === 'updated') return ((b.card.updatedAt || b.card.createdAt || 0) - (a.card.updatedAt || a.card.createdAt || 0));
                return 0;
              });
              const frag = document.createDocumentFragment();
              sorted.forEach((result, i) => {
                const el = grid.querySelector(`[data-result-index="${fuzzyResults.indexOf(result)}"]`);
                if (el) frag.appendChild(el);
              });
              grid.appendChild(frag);
            };
            sortOptions.forEach(opt => {
              const btn = h('button', {
                className: 'sort-btn' + (opt.key === 'relevance' ? ' active' : ''),
                'data-sort-key': opt.key,
                onclick: () => applySortMode(opt.key)
              }, opt.label);
              sortBar.appendChild(btn);
            });
            main.appendChild(sortBar);

            // Keyboard navigation hint (v1.0.0)
            const keyboardHint = h('div', {
              className: 'search-keyboard-hint',
              style: 'padding: 8px 12px; margin-bottom: 12px; background: var(--bg-alt, var(--bg-secondary)); border: 1px solid var(--border); border-radius: 6px; font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 12px;'
            },
              h('span', { style: 'opacity: 0.7;' }, '💡'),
              h('span', {},
                h('kbd', { style: 'background: var(--bg-primary); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border); font-size: 12px; font-family: monospace;' }, '↑'),
                ' / ',
                h('kbd', { style: 'background: var(--bg-primary); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border); font-size: 12px; font-family: monospace;' }, '↓'),
                ' to navigate • ',
                h('kbd', { style: 'background: var(--bg-primary); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border); font-size: 12px; font-family: monospace;' }, 'Enter'),
                ' to open'
              )
            );
            main.appendChild(keyboardHint);
            
            const gridViewEnabled = localStorage.getItem('cardspoke_gridView') === 'true';
            const gridClass = gridViewEnabled ? 'card-grid grid-view' : 'card-grid';
            const grid = h('div', { className: gridClass, role: 'list', id: 'searchResultGrid' });
            setSearchResultsState({ items: fuzzyResults, elements: [], selectedIndex: 0 });
            const batchSize = 50;
            let renderIndex = 0;
            const renderBatch = () => {
              const frag = document.createDocumentFragment();
              const upgradeEntries = [];
              for (let i = renderIndex; i < Math.min(renderIndex + batchSize, fuzzyResults.length); i++) {
                const result = fuzzyResults[i];
                const card = result.card;
                const cardEl = renderCardTile(card, { highlightQuery: query, lazyBody: true });
                upgradeEntries.push({ card: card, tileEl: cardEl });
                cardEl.classList.add('search-result');
                cardEl.dataset.resultIndex = i;
                cardEl.addEventListener('click', () => {
                  searchResultsState.selectedIndex = i;
                  updateSearchSelection(0);
                });

                // Add dataset badge for multi-dataset search
                if (scope === 'all' && result.datasetName) {
                  const datasetBadge = h('span', {
                    style: 'position: absolute; top: 8px; left: 8px; background: #3b82f6; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;'
                  }, result.datasetName);
                  cardEl.style.position = 'relative';
                  cardEl.appendChild(datasetBadge);

                  // Results from another dataset must switch to it before
                  // opening — the card does not exist in the current store.
                  const activeKey = instanceKey || 'nested_cards_store';
                  if (result.datasetId && result.datasetId !== activeKey) {
                    cardEl.onclick = async () => {
                      // Flush the current dataset's pending save to ITS key
                      // before switching, so a stale timer can't misfile it.
                      await flushPendingSave();
                      localStorage.setItem('activeInstance', result.datasetId);
                      setInstanceKey(result.datasetId);
                      await load();
                      if (typeof reconcilePluginsAfterDatasetSwitch === 'function') {
                        await reconcilePluginsAfterDatasetSwitch();
                      }
                      if (store.cards && store.cards[card.id]) {
                        goTo('read', { cardId: card.id });
                      } else {
                        render();
                      }
                      showToast('Switched to dataset: ' + result.datasetName);
                    };
                  }
                }

                // Add match quality indicator
                if (result.approximate) {
                  const matchBadge = h('span', {
                    style: 'position: absolute; top: 8px; right: 8px; background: #fbbf24; color: #000; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;'
                  }, '~');
                  cardEl.style.position = 'relative';
                  cardEl.appendChild(matchBadge);
                }

                frag.appendChild(cardEl);
                searchResultsState.elements.push(cardEl);
              }
              grid.appendChild(frag);
              renderIndex += batchSize;
              updateSearchSelection(0);
              scheduleCardRenderUpgrade(upgradeEntries);
            };
            const onScroll = () => {
              if (renderIndex >= fuzzyResults.length) return;
              const threshold = grid.offsetTop + grid.offsetHeight - window.innerHeight * 2;
              if (window.scrollY + window.innerHeight > threshold) {
                requestAnimationFrame(renderBatch);
              }
            };
            renderBatch();
            window.addEventListener('scroll', onScroll, { passive: true });
            registerRenderCleanup(() => window.removeEventListener('scroll', onScroll));
            main.appendChild(grid);
          }
        }).catch(err => {
          loadingDiv.remove();
          main.appendChild(h('div', { className: 'empty' }, 'Search error: ' + err.message));
        });
      }


      /**
       * Main render function - orchestrates page rendering
       */
      function render() {
        try {
          runRenderCleanup();
          renderBreadcrumbs();
          main.innerHTML = '';
          switch (navState.page) {
            case 'read':
              renderReadOnlyCard();
              break;
            case 'list':
              renderCardList();
              break;
            case 'search':
              renderSearchResults();
              break;
            case 'edit':
              renderEditCard();
              break;
            default:
              renderCardList();
          }
        } catch (e) {
          bootError('Render failed: ' + (e.message || e));
        }
      }

      /**
       * Apply custom components from the ComponentRegistry to core UI areas.
       * Task 2.5: Expand Component Registry to Sidebar, Header, and SearchBar.
       * Called once after plugins are synced from store.
       */
      // Boot-time only (called once from the boot IIFE, before the first
      // render()) — a custom Header/Sidebar/SearchBar component's render()
      // is now an async RPC call into that plugin's sandboxed worker, which
      // is fine here since this never runs in a per-frame hot path the way
      // the Card component does.
      async function applyRegistryComponents() {
        if (!window.CardSpoke || !window.CardSpoke.ComponentRegistry) {
          return;
        }
        const registry = window.CardSpoke.ComponentRegistry;

        // Replace Header if a custom component is registered
        const CustomHeader = registry.get('Header');
        if (CustomHeader && typeof CustomHeader.render === 'function') {
          try {
            const headerEl = document.querySelector('.header');
            if (headerEl) {
              const customEl = await CustomHeader.render({ header: headerEl });
              if (customEl instanceof HTMLElement) {
                headerEl.parentNode.replaceChild(customEl, headerEl);
                console.log('[ComponentRegistry] Custom Header component applied');
              }
            }
          } catch (err) {
            console.warn('[ComponentRegistry] Custom Header render failed, using default:', err);
          }
        }

        // Replace Sidebar (menu panel) if a custom component is registered
        const CustomSidebar = registry.get('Sidebar');
        if (CustomSidebar && typeof CustomSidebar.render === 'function') {
          try {
            const menuPanel = document.querySelector('.menu-panel');
            if (menuPanel) {
              const customEl = await CustomSidebar.render({ panel: menuPanel });
              if (customEl instanceof HTMLElement) {
                menuPanel.parentNode.replaceChild(customEl, menuPanel);
                console.log('[ComponentRegistry] Custom Sidebar component applied');
              }
            }
          } catch (err) {
            console.warn('[ComponentRegistry] Custom Sidebar render failed, using default:', err);
          }
        }

        // Replace SearchBar if a custom component is registered
        const CustomSearchBar = registry.get('SearchBar');
        if (CustomSearchBar && typeof CustomSearchBar.render === 'function') {
          try {
            const searchWrapper = document.querySelector('.search-input-wrapper');
            if (searchWrapper) {
              const customEl = await CustomSearchBar.render({ wrapper: searchWrapper });
              if (customEl instanceof HTMLElement) {
                searchWrapper.parentNode.replaceChild(customEl, searchWrapper);
                console.log('[ComponentRegistry] Custom SearchBar component applied');
              }
            }
          } catch (err) {
            console.warn('[ComponentRegistry] Custom SearchBar render failed, using default:', err);
          }
        }
      }

      // =============================================================
      // --- THEME MANAGEMENT ---
      // Handle dark/light theme switching
      // =============================================================

      /**
       * Apply theme (light or dark mode)
       * @param {'light'|'dark'} theme - Theme to apply
       */
      function applyTheme(theme) {
        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
        
        // Save to store for persistence across dataset switches
        store.activeTheme = theme;
        save();
        
        try {
          localStorage.setItem('cardspoke_theme', theme);
        } catch { }
        
        // Update the header theme toggle: its icon shows the mode a click
        // switches TO (moon while light, sun while dark), and its accessible
        // name/tooltip describe that action rather than a generic "toggle"
        // (issue #371). The SVGs are decorative — the label carries meaning.
        const moonIcon = '<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
        const sunIcon = '<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
        if (header.themeToggle) {
          header.themeToggle.innerHTML = theme === 'dark' ? sunIcon : moonIcon;
          const themeActionLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
          header.themeToggle.setAttribute('aria-label', themeActionLabel);
          header.themeToggle.setAttribute('title', themeActionLabel + ' (Alt+T)');
        }
        
      }
      
      // =============================================================
      // --- APP FOOTER ---
      // Populate footer with version and attribution information
      // =============================================================
      
      /**
       * Populate footer with app metadata
       * Enhanced with error handling and logging for debugging
       */
      function populateFooter() {
        try {
          const creatorEl = document.getElementById('app-creator');
          const versionEl = document.getElementById('app-version');
          const dateEl = document.getElementById('app-release-date');
          const updaterEl = document.getElementById('app-updater');

          // Verify all elements exist
          if (!creatorEl || !versionEl || !dateEl || !updaterEl) {
            console.error('[Footer] Missing footer elements:', {
              creator: !!creatorEl,
              version: !!versionEl,
              date: !!dateEl,
              updater: !!updaterEl
            });
            return;
          }

          // Populate elements
          creatorEl.textContent = APP_CREATOR;
          versionEl.textContent = APP_VERSION;
          dateEl.textContent = APP_RELEASE_DATE;
          updaterEl.textContent = APP_UPDATER;

          if (isDeveloperMode()) {
            console.log('[Footer] Populated successfully:', {
              creator: APP_CREATOR,
              version: APP_VERSION,
              date: APP_RELEASE_DATE,
              updater: APP_UPDATER
            });
          }
        } catch (error) {
          console.error('[Footer] Error populating footer:', error);
        }
      }

      /**
       * Update dataset selector options
       */
      function updateDatasetSelector() {
        if (!datasetSelector) return;

        // Clear existing options
        datasetSelector.innerHTML = '';

        // Add "Current Dataset" option
        const currentOption = document.createElement('option');
        currentOption.value = 'current';
        currentOption.textContent = 'Current Dataset';
        datasetSelector.appendChild(currentOption);

        // Datasets are LocalStorage-backed; enumerate them directly.
        const datasetKeys = typeof getAllDatasetKeys === 'function' ? getAllDatasetKeys() : [];
        const currentKey = instanceKey || 'nested_cards_store';
        const datasets = datasetKeys.map(key => {
          let name = key;
          try {
            const parsed = JSON.parse(localStorage.getItem(key));
            if (parsed && parsed.encrypted === true) {
              name = key + ' (encrypted)';
            } else if (parsed && parsed.metadata && parsed.metadata.name) {
              name = parsed.metadata.name;
            }
          } catch (_e) { /* keep raw key as label */ }
          return { id: key, name, isActive: key === currentKey };
        });

        // Add "All Datasets" option if there are multiple datasets
        if (datasets.length > 1) {
          const allOption = document.createElement('option');
          allOption.value = 'all';
          allOption.textContent = 'All Datasets';
          datasetSelector.appendChild(allOption);

          // Add separator
          const separator = document.createElement('option');
          separator.disabled = true;
          separator.textContent = '───────────';
          datasetSelector.appendChild(separator);
          
          // Add individual dataset options
          datasets.forEach(dataset => {
            const option = document.createElement('option');
            option.value = dataset.id;
            option.textContent = dataset.name + (dataset.isActive ? ' (active)' : '');
            datasetSelector.appendChild(option);
          });
        }
      }

      // =============================================================
      // --- INITIALIZATION & EVENT LISTENERS ---
      // Set up event handlers for user interactions
      // =============================================================

      // Initialize theme
      const savedTheme = store.activeTheme || localStorage.getItem('cardspoke_theme') || 'light';
      applyTheme(savedTheme);

      // --- Header Button Handlers ---
      
      if (header.themeToggle) header.themeToggle.onclick = () => {
        const isDark = document.documentElement.classList.contains('dark');
        applyTheme(isDark ? 'light' : 'dark');
      };
      
      // Apply saved high contrast mode on startup
      const savedHC = localStorage.getItem('cardspoke_highcontrast') === 'true';
      if (savedHC) document.documentElement.classList.add('high-contrast');
      
      // --- Menu Handlers ---
      
      // Focus trap cleanup function
      let menuFocusTrapCleanup = null;
      
      function lockBodyScroll() {
        document.body.classList.add('scroll-locked');
      }

      function unlockBodyScroll() {
        document.body.classList.remove('scroll-locked');
      }

      /**
       * Close the menu overlay. Every close path (close button, overlay
       * click, Escape in systems.js) must go through here so the focus-trap
       * listener is always removed and never accumulates (QA A11Y-4).
       */
      function closeMenuOverlay() {
        const wasOpen = !!(menu.overlay && menu.overlay.classList.contains('show'));
        if (menu.overlay) menu.overlay.classList.remove('show');
        if (header.menuBtn) header.menuBtn.setAttribute('aria-expanded', 'false');
        if (menuFocusTrapCleanup) {
          menuFocusTrapCleanup();
          menuFocusTrapCleanup = null;
        }
        // Only undo the open-side effects when the menu was actually open:
        // shortcuts such as Ctrl+U call closeMenu() right after opening the
        // upload modal, and must not unlock its scroll or steal its focus.
        if (!wasOpen) return;
        unlockBodyScroll();
        // Return focus to the opener so keyboard users are not dropped at
        // the top of the document (menu items that navigate or open another
        // dialog move focus again afterwards, which is fine).
        if (header.menuBtn && typeof header.menuBtn.focus === 'function' &&
            document.contains(header.menuBtn)) {
          header.menuBtn.focus();
        }
      }

      if (header.menuBtn && menu.overlay) header.menuBtn.onclick = () => {
        menu.overlay.classList.add('show');
        header.menuBtn.setAttribute('aria-expanded', 'true');
        lockBodyScroll();
        // Show/hide developer section based on developer mode
        if (menu.developerSection) {
          menu.developerSection.style.display = isDeveloperMode() ? 'block' : 'none';
        }
        // Set up focus trap for accessibility (release any previous trap first)
        if (menuFocusTrapCleanup) {
          menuFocusTrapCleanup();
          menuFocusTrapCleanup = null;
        }
        const panel = menu.overlay.querySelector('.menu-panel');
        if (panel) menuFocusTrapCleanup = trapFocus(panel);
      };

      if (menu.closeBtn) menu.closeBtn.onclick = () => {
        closeMenuOverlay();
      };

      if (menu.overlay) menu.overlay.onclick = (e) => {
        if (e.target === menu.overlay) {
          closeMenuOverlay();
        }
      };

      if (menu.newCard) menu.newCard.onclick = () => {
        closeMenuOverlay();
        goTo('edit', { cardId: null, parentId: null });
      };

      // --- Upload modal: tabs, open/close, focus management ---

      /**
       * Activate one upload-modal tab ('json' | 'txt'): toggles the visual
       * state, keeps aria-selected and the roving tabindex in sync, and shows
       * the matching panel. Every tab switch (click, arrow keys, opening the
       * modal from the menu or from a card) must go through here.
       * @param {string} tabName
       * @param {boolean} [focusTab=false] - move focus to the tab button
       */
      function activateUploadTab(tabName, focusTab = false) {
        const tabs = uploadModal.tabs ? Array.from(uploadModal.tabs) : [];
        let target = tabs.find(t => t.getAttribute('data-tab') === tabName);
        if (!target) target = tabs.find(t => t.getAttribute('data-tab') === 'json') || tabs[0];
        if (!target) return;
        const activeName = target.getAttribute('data-tab');
        tabs.forEach(t => {
          const selected = t === target;
          t.classList.toggle('active', selected);
          t.setAttribute('aria-selected', selected ? 'true' : 'false');
          t.setAttribute('tabindex', selected ? '0' : '-1');
        });
        if (uploadModal.tabContents) uploadModal.tabContents.forEach(content => {
          content.classList.toggle('active', content.id === `tab-${activeName}`);
        });
        if (focusTab) target.focus();
      }

      // Focus bookkeeping for the static upload modal (it is not observer-
      // enhanced like generated modals, so it manages its own contract).
      let uploadModalReleaseFocus = null;
      let uploadModalOpener = null;

      /**
       * Trap Tab/Shift+Tab inside the upload dialog. Unlike the generic
       * trapFocus(), focusables are recomputed on every Tab so the inactive
       * tab panel (display:none) and roving tabindex=-1 tabs are skipped.
       */
      function trapUploadModalFocus(modalEl) {
        const selector = 'button, [href], input, select, textarea, [tabindex]';
        const focusables = () => Array.from(modalEl.querySelectorAll(selector)).filter(el =>
          !el.disabled && el.getAttribute('tabindex') !== '-1' &&
          el.getClientRects().length > 0 &&
          !(el.type === 'radio' && !el.checked && modalEl.querySelector(`input[type="radio"][name="${el.name}"]:checked`)));
        const onKeyDown = (e) => {
          if (e.key !== 'Tab') return;
          const list = focusables();
          if (!list.length) return;
          const first = list[0];
          const last = list[list.length - 1];
          if (e.shiftKey && (document.activeElement === first || !modalEl.contains(document.activeElement))) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && (document.activeElement === last || !modalEl.contains(document.activeElement))) {
            e.preventDefault();
            first.focus();
          }
        };
        modalEl.addEventListener('keydown', onKeyDown);
        return () => modalEl.removeEventListener('keydown', onKeyDown);
      }

      /**
       * Show the upload modal and move focus into it. Callers set up the
       * tab/select/radio state first (see menu.upload and
       * openUploadModalForCard in data.js).
       */
      function openUploadModal() {
        if (!uploadModal.overlay) return;
        const wasOpen = uploadModal.overlay.classList.contains('show');
        if (!wasOpen) {
          const active = document.activeElement;
          uploadModalOpener = active && active !== document.body ? active : null;
        }
        uploadModal.overlay.classList.add('show');
        lockBodyScroll();
        if (uploadModalReleaseFocus) uploadModalReleaseFocus();
        const dialog = uploadModal.overlay.querySelector('.modal');
        uploadModalReleaseFocus = dialog ? trapUploadModalFocus(dialog) : null;
        const activeTab = uploadModal.overlay.querySelector('.modal-tab.active') ||
          uploadModal.overlay.querySelector('.modal-tab');
        if (activeTab) activeTab.focus();
      }

      /**
       * Hide the upload modal. Every close path (close button, backdrop,
       * Escape in systems.js, successful import) goes through here so the
       * body scroll lock and focus trap are always released and focus
       * returns to whatever opened the modal.
       */
      function closeUploadModal() {
        if (!uploadModal.overlay) return;
        const wasOpen = uploadModal.overlay.classList.contains('show');
        uploadModal.overlay.classList.remove('show');
        [uploadModal.fileUploadAreaJSON, uploadModal.fileUploadAreaTXT].forEach(area => {
          if (area) area.classList.remove('drag-over');
        });
        unlockBodyScroll();
        if (uploadModalReleaseFocus) {
          uploadModalReleaseFocus();
          uploadModalReleaseFocus = null;
        }
        const opener = uploadModalOpener;
        uploadModalOpener = null;
        if (!wasOpen) return;
        // If a follow-up dialog (e.g. an import confirm) already took focus,
        // leave it there.
        const active = document.activeElement;
        const focusIsFree = !active || active === document.body || uploadModal.overlay.contains(active);
        if (focusIsFree && opener && typeof opener.focus === 'function' && document.contains(opener)) {
          opener.focus();
        }
      }

      if (menu.upload) menu.upload.onclick = () => {
        closeMenuOverlay();
        updateImportLocationOptions();
        
        // Reset JSON import to root
        if (uploadModal.importLocationSelectJSON) {
          uploadModal.importLocationSelectJSON.value = 'root';
        }
        
        // Reset TXT import to root and outline
        if (uploadModal.importLocationSelectTXT) {
          uploadModal.importLocationSelectTXT.value = 'root';
        }
        const txtOutlineRadio = document.querySelector('input[name="txtImportMode"][value="outline"]');
        if (txtOutlineRadio) txtOutlineRadio.checked = true;

        // Restore last used tab or default to json
        let lastTab = 'json';
        try { lastTab = localStorage.getItem('cardspoke_lastUploadTab') || 'json'; } catch { }
        activateUploadTab(lastTab);
        
        // Show modal
        openUploadModal();
      };

      if (menu.pluginManager) menu.pluginManager.onclick = () => {
        closeMenuOverlay();
        showPluginManager('installed');
      };

      if (menu.tagManager) {
        menu.tagManager.onclick = () => {
          closeMenuOverlay();
          showTagManager();
        };
      }

      if (menu.advancedSearch) {
        menu.advancedSearch.onclick = () => {
          closeMenuOverlay();
          showAdvancedSearch();
        };
      }

      if (menu.trashBin) {
        menu.trashBin.onclick = () => {
          closeMenuOverlay();
          showTrashBin();
        };
      }

      if (menu.appearance) menu.appearance.onclick = () => {
        closeMenuOverlay();
        showAppearanceSettings();
      };

      if (menu.bookmarks) menu.bookmarks.onclick = () => {
        closeMenuOverlay();
        showBookmarks();
      };

      if (menu.recentCards) menu.recentCards.onclick = () => {
        closeMenuOverlay();
        showRecentCards();
      };

      if (menu.typography) {
        menu.typography.onclick = () => {
          closeMenuOverlay();
          showTypographySelector();
        };
      }

      if (menu.dataHub) menu.dataHub.onclick = () => {
        closeMenuOverlay();
        showDatasetInfo();
      };

      if (menu.clearAll) menu.clearAll.onclick = () => {
        closeMenuOverlay();
        clearAllData();
      };

      if (menu.gettingStarted) menu.gettingStarted.onclick = () => {
        closeMenuOverlay();
        showGettingStarted();
      };

      if (menu.help) menu.help.onclick = () => {
        closeMenuOverlay();
        showHelp();
      };

      if (menu.keyboardShortcuts) menu.keyboardShortcuts.onclick = () => {
        closeMenuOverlay();
        showKeyboardHelp();
      };

      if (menu.developerConsole) {
        menu.developerConsole.onclick = () => {
          closeMenuOverlay();
          showDeveloperConsole();
        };
      }

      const debouncedNavigateSearch = debounce((query) => {
        if (query) {
          goTo('search', { searchQuery: query });
        }
      }, 180);

      function updateSearchSelection(delta = 0) {
        if (!searchResultsState.items.length) return;
        // Navigate only within results actually rendered so far (results render
        // in batches); otherwise the selection can advance past the last
        // rendered element and highlight nothing.
        const rendered = searchResultsState.elements.length;
        const max = (rendered > 0 ? rendered : searchResultsState.items.length) - 1;
        const next = Math.min(max, Math.max(0, searchResultsState.selectedIndex + delta));
        searchResultsState.selectedIndex = next;
        searchResultsState.elements.forEach((el, idx) => {
          if (idx === next) el.classList.add('search-result-selected');
          else el.classList.remove('search-result-selected');
        });
        const active = searchResultsState.elements[next];
        if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }

      function openSelectedSearchResult() {
        if (!searchResultsState.items.length) return;
        const target = searchResultsState.items[searchResultsState.selectedIndex];
        if (target?.card?.id) goTo('read', { cardId: target.card.id });
      }

      if (header.homeBtn) header.homeBtn.onclick = () => {
        goTo('list', { cardId: null });
      };

      if (header.brandBtn) header.brandBtn.onclick = () => {
        goTo('list', { cardId: null });
      };

      if (header.undoBtn) header.undoBtn.onclick = () => {
        undo();
      };

      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          if (e.target.value.trim()) {
            if (searchClear) searchClear.style.display = 'block';
          } else {
            if (searchClear) searchClear.style.display = 'none';
          }
          if (navState.page === 'search') {
            debouncedNavigateSearch(e.target.value.trim());
          }
        });

        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && searchInput.value.trim()) {
            if (navState.page === 'search' && searchResultsState.items.length) {
              e.preventDefault();
              openSelectedSearchResult();
              return;
            }
            // preventDefault marks this Enter as handled so the document-level
            // results handler never treats the submitting keypress as "open
            // the first result".
            e.preventDefault();
            goTo('search', { searchQuery: searchInput.value.trim() });
          }
          if (navState.page === 'search' && searchResultsState.items.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); updateSearchSelection(1); }
            if (e.key === 'ArrowUp') { e.preventDefault(); updateSearchSelection(-1); }
          }
        });
      }

      // Search-results keyboard navigation must work even after focus has
      // left the search input (QA UX-1). Handled at the document level; the
      // search input's own handler runs first and marks the event handled.
      document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented) return;
        if (navState.page !== 'search' || !searchResultsState.items.length) return;
        const t = e.target;
        const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
        if (t !== searchInput &&
            (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable))) {
          return;
        }
        if (document.querySelector('.modal-overlay.show, .menu-overlay.show')) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); updateSearchSelection(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); updateSearchSelection(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); openSelectedSearchResult(); }
      });

      if (searchClear) searchClear.onclick = () => {
        if (searchInput) searchInput.value = '';
        searchClear.style.display = 'none';
        if (navState.page === 'search') goBack();
      };

      const searchSubmit = document.getElementById('searchSubmit');
      if (searchSubmit && searchInput) {
        searchSubmit.onclick = () => {
          const q = searchInput.value.trim();
          if (q) goTo('search', { searchQuery: q });
          else searchInput.focus();
        };
      }

      if (uploadModal.tabs) uploadModal.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const tabName = tab.getAttribute('data-tab');
          activateUploadTab(tabName);
          // Remember last used tab
          try { localStorage.setItem('cardspoke_lastUploadTab', tabName); } catch { }
        });
        // WAI-ARIA tabs pattern: arrows/Home/End move between tabs.
        tab.addEventListener('keydown', (e) => {
          const tabs = Array.from(uploadModal.tabs);
          const idx = tabs.indexOf(tab);
          let next = null;
          if (e.key === 'ArrowRight') next = tabs[(idx + 1) % tabs.length];
          else if (e.key === 'ArrowLeft') next = tabs[(idx - 1 + tabs.length) % tabs.length];
          else if (e.key === 'Home') next = tabs[0];
          else if (e.key === 'End') next = tabs[tabs.length - 1];
          if (!next) return;
          e.preventDefault();
          next.click();
          next.focus();
        });
      });

      if (uploadModal.closeBtn) uploadModal.closeBtn.onclick = () => {
        closeUploadModal();
      };

      if (uploadModal.overlay) {
        uploadModal.overlay.onclick = (e) => {
          if (e.target === uploadModal.overlay) {
            closeUploadModal();
          }
        };
        // A file dropped anywhere on the modal outside a drop zone must not
        // make the browser navigate away to the file.
        uploadModal.overlay.addEventListener('dragover', (e) => e.preventDefault());
        uploadModal.overlay.addEventListener('drop', (e) => e.preventDefault());
      }

      /** True when `file` looks like the expected upload type. */
      function isUploadFileType(file, extension, mimeTypes) {
        if (!file) return false;
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.' + extension)) return true;
        return mimeTypes.includes(file.type);
      }

      /**
       * Import a JSON file picked via the file input or dropped on the
       * upload area — both paths share this function.
       */
      function handleJSONUploadFile(file) {
        if (!file) return;
        if (!isUploadFileType(file, 'json', ['application/json'])) {
          showToast('Please choose a .json file', 'error');
          return;
        }
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const data = JSON.parse(reader.result);
            const mode = uploadModal.importLocationSelectJSON ? uploadModal.importLocationSelectJSON.value || 'root' : 'root';
            await importJSON(data, mode);
            closeUploadModal();
          } catch (err) {
            showToast('Failed to parse JSON: ' + err.message, 'error');
          }
        };
        reader.onerror = () => showToast('Could not read file', 'error');
        reader.readAsText(file);
      }

      /** Import a TXT file from the file input or a drop (shared path). */
      function handleTXTUploadFile(file) {
        if (!file) return;
        if (!isUploadFileType(file, 'txt', ['text/plain'])) {
          showToast('Please choose a .txt file', 'error');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result;
          const modeRadio = document.querySelector('input[name="txtImportMode"]:checked');
          const mode = modeRadio ? modeRadio.value : 'outline';
          const location = uploadModal.importLocationSelectTXT ? uploadModal.importLocationSelectTXT.value || 'root' : 'root';
          importTXT(text, mode, location);
          closeUploadModal();
        };
        reader.onerror = () => showToast('Could not read file', 'error');
        reader.readAsText(file);
      }

      /**
       * Wire a .file-upload-area as a keyboard-operable button (Enter/Space
       * open the picker) and as a real drag-and-drop target that feeds the
       * dropped file through the same handler as the file input.
       */
      function bindUploadArea(area, input, handleFile) {
        if (!area) return;
        area.onclick = () => {
          if (input) input.click();
        };
        // Mirror native <button> semantics: Enter activates on keydown,
        // Space on keyup (its keydown is cancelled only to stop scrolling).
        // Enter's keydown is deliberately NOT preventDefault()ed — Chromium
        // refuses to open a file picker from a cancelled keydown.
        const isSpace = (e) => e.key === ' ' || e.key === 'Spacebar';
        area.addEventListener('keydown', (e) => {
          if (e.target !== area) return;
          if (e.key === 'Enter' && !e.repeat) {
            if (input) input.click();
          } else if (isSpace(e)) {
            e.preventDefault();
          }
        });
        area.addEventListener('keyup', (e) => {
          if (e.target !== area) return;
          if (isSpace(e) && input) input.click();
        });
        area.addEventListener('dragenter', (e) => {
          e.preventDefault();
          area.classList.add('drag-over');
        });
        area.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          area.classList.add('drag-over');
        });
        area.addEventListener('dragleave', (e) => {
          // Ignore leave events fired when moving between child elements.
          if (e.relatedTarget && area.contains(e.relatedTarget)) return;
          area.classList.remove('drag-over');
        });
        area.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          area.classList.remove('drag-over');
          const files = e.dataTransfer && e.dataTransfer.files;
          if (files && files.length) handleFile(files[0]);
        });
        if (input) input.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          // Reset so picking the same file again still fires 'change'.
          e.target.value = '';
          handleFile(file);
        });
      }

      bindUploadArea(uploadModal.fileUploadAreaJSON, uploadModal.fileInputJSON, handleJSONUploadFile);
      bindUploadArea(uploadModal.fileUploadAreaTXT, uploadModal.fileInputTXT, handleTXTUploadFile);


      // =============================================================
