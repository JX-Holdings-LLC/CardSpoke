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
  APP_VERSION,
  MAX_UNDO_STACK, MAX_TRASH_SIZE,
  store, setStore, createDefaultStore,
  navState, navHistory,
  instanceKey,
  dirty,
  undoStack, redoStack, trashBin,
  draggedCardId, setDraggedCardId,
  dragOverCardId, setDragOverCardId
} from './state.js';


      // Source Part 5/5: Advanced systems (undo/redo, tags, search) and boot
      // Concatenated via `npm run build` in lexical order of www/src/*.js
      // --- UNDO/REDO SYSTEM (v0.12.0) ---
      // =============================================================
      
      /**
       * Push a state to the undo stack
       * @param {string} action - Description of the action
       * @param {Object} data - Data needed to undo
       */
      function pushUndo(action, data) {
        if (undoGroupState.active) {
          undoGroupState.actions.push({ action, data, timestamp: Date.now() });
          redoStack.length = 0;
          return;
        }
        undoStack.push({
          action,
          data,
          timestamp: Date.now()
        });
        if (undoStack.length > MAX_UNDO_STACK) {
          undoStack.shift();
        }
        redoStack.length = 0;
      }

      const undoGroupState = {
        active: false,
        label: null,
        actions: []
      };

      function startUndoGroup(label) {
        if (undoGroupState.active) return false;
        undoGroupState.active = true;
        undoGroupState.label = label || 'group';
        undoGroupState.actions = [];
        return true;
      }

      function endUndoGroup() {
        if (!undoGroupState.active) return false;
        const groupedActions = undoGroupState.actions.slice();
        const label = undoGroupState.label || 'group';
        undoGroupState.active = false;
        undoGroupState.label = null;
        undoGroupState.actions = [];
        if (!groupedActions.length) return true;
        undoStack.push({
          action: 'undoGroup',
          data: { label, actions: groupedActions },
          timestamp: Date.now()
        });
        if (undoStack.length > MAX_UNDO_STACK) undoStack.shift();
        redoStack.length = 0;
        return true;
      }
      
      /**
       * Undo the last action
       */
      function undo() {
        if (undoStack.length === 0) {
          showToast('Nothing to undo', 'info');
          return false;
        }
        
        const action = undoStack.pop();
        
        try {
          if (action.action === 'undoGroup') {
            const grouped = action.data.actions || [];
            for (let i = grouped.length - 1; i >= 0; i--) {
              applyUndoAction(grouped[i]);
            }
            redoStack.push(action);
            save();
            render();
            showToast('Undo: ' + (action.data.label || 'bulk operation'), 'info');
            return true;
          }
          applyUndoAction(action);
          
          redoStack.push(action);
          save();
          render();
          showToast('Undo: ' + action.action, 'info');
          return true;
        } catch (err) {
          console.error('Undo failed:', err);
          showToast('Undo failed', 'error');
          return false;
        }
      }

      function applyUndoAction(action) {
        switch (action.action) {
            case 'deleteCard':
              const cardData = action.data.card;
              store.cards[cardData.id] = cardData;
              const undelParent = cardData.parentId ? store.cards[cardData.parentId] : null;
              if (undelParent) {
                if (Array.isArray(undelParent.children) && !undelParent.children.includes(cardData.id)) {
                  undelParent.children.push(cardData.id);
                }
              } else {
                // Root card, OR the parent no longer exists (e.g. restoring a
                // child before its still-deleted parent): keep the card
                // reachable at root instead of leaving it an invisible orphan.
                if (!store.rootOrder.includes(cardData.id)) {
                  store.rootOrder.push(cardData.id);
                }
              }
              const trashIndex = trashBin.findIndex(t => t.card.id === cardData.id);
              if (trashIndex > -1) trashBin.splice(trashIndex, 1);
              break;
              
            case 'updateCard':
              Object.assign(store.cards[action.data.cardId], action.data.previousState);
              break;
              
            case 'createCard':
              const card = store.cards[action.data.cardId];
              if (card) {
                if (card.parentId) {
                  const parent = store.cards[card.parentId];
                  if (parent) parent.children = parent.children.filter(c => c !== card.id);
                } else {
                  store.rootOrder = store.rootOrder.filter(c => c !== card.id);
                }
                delete store.cards[action.data.cardId];
              }
              break;
              
            case 'addTag':
              removeTag(action.data.cardId, action.data.tag, true, true);
              break;

            case 'removeTag':
              addTag(action.data.cardId, action.data.tag, true, true);
              break;

            case 'moveCard':
              const movedCard = store.cards[action.data.cardId];
              if (movedCard) {
                const currentParent = store.cards[movedCard.parentId];
                if (currentParent) {
                  currentParent.children = currentParent.children.filter(c => c !== movedCard.id);
                } else {
                  store.rootOrder = store.rootOrder.filter(c => c !== movedCard.id);
                }
                movedCard.parentId = action.data.originalParentId;
                if (action.data.originalParentId) {
                  const origParent = store.cards[action.data.originalParentId];
                  if (origParent && !origParent.children.includes(movedCard.id)) {
                    origParent.children.push(movedCard.id);
                  }
                } else {
                  if (!store.rootOrder.includes(movedCard.id)) {
                    store.rootOrder.push(movedCard.id);
                  }
                }
              }
              break;
        }
      }
      
      /**
       * Redo the last undone action
       */
      function redo() {
        if (redoStack.length === 0) {
          showToast('Nothing to redo', 'info');
          return false;
        }
        
        const action = redoStack.pop();
        
        try {
          if (action.action === 'undoGroup') {
            const grouped = action.data.actions || [];
            grouped.forEach(applyRedoAction);
            undoStack.push(action);
            save();
            render();
            showToast('Redo: ' + (action.data.label || 'bulk operation'), 'info');
            return true;
          }

          applyRedoAction(action);
          
          undoStack.push(action);
          save();
          render();
          showToast('Redo: ' + action.action, 'info');
          return true;
        } catch (err) {
          console.error('Redo failed:', err);
          showToast('Redo failed', 'error');
          return false;
        }
      }

      function applyRedoAction(action) {
        switch (action.action) {
            case 'deleteCard':
              const cardId = action.data.card.id;
              const card = store.cards[cardId];
              if (card) {
                if (card.parentId) {
                  const parent = store.cards[card.parentId];
                  if (parent) parent.children = parent.children.filter(c => c !== cardId);
                } else {
                  store.rootOrder = store.rootOrder.filter(c => c !== cardId);
                }
                trashBin.unshift({ card: cloneCard(card), deletedAt: Date.now() });
                if (trashBin.length > MAX_TRASH_SIZE) trashBin.pop();
                delete store.cards[cardId];
              }
              break;
              
            case 'updateCard':
              Object.assign(store.cards[action.data.cardId], action.data.newState);
              break;
              
            case 'createCard':
              const newCard = action.data.card;
              store.cards[newCard.id] = newCard;
              if (newCard.parentId) {
                const parent = store.cards[newCard.parentId];
                if (parent && !parent.children.includes(newCard.id)) {
                  parent.children.push(newCard.id);
                }
              } else {
                if (!store.rootOrder.includes(newCard.id)) {
                  store.rootOrder.push(newCard.id);
                }
              }
              break;
              
            case 'addTag':
              addTag(action.data.cardId, action.data.tag, true, true);
              break;

            case 'removeTag':
              removeTag(action.data.cardId, action.data.tag, true, true);
              break;

            case 'moveCard':
              const mvCard = store.cards[action.data.cardId];
              if (mvCard) {
                const oldParent = store.cards[mvCard.parentId];
                if (oldParent) {
                  oldParent.children = oldParent.children.filter(c => c !== mvCard.id);
                } else {
                  store.rootOrder = store.rootOrder.filter(c => c !== mvCard.id);
                }
                mvCard.parentId = action.data.newParentId;
                if (action.data.newParentId) {
                  const newParent = store.cards[action.data.newParentId];
                  if (newParent && !newParent.children.includes(mvCard.id)) {
                    newParent.children.push(mvCard.id);
                  }
                } else {
                  if (!store.rootOrder.includes(mvCard.id)) {
                    store.rootOrder.push(mvCard.id);
                  }
                }
              }
              break;
        }
      }

      window.startUndoGroup = startUndoGroup;
      window.endUndoGroup = endUndoGroup;
      
      /**
       * Show trash bin modal
       */
      function showTrashBin() {
        const overlay = h('div', { className: 'modal-overlay show' });
        const modal = h('div', { className: 'modal', style: 'max-width: 600px;' });
        const modalHeader = h('div', { className: 'modal-header' });
        modalHeader.appendChild(h('div', { className: 'modal-title' }, 'Trash Bin'));
        const closeBtn = h('button', { className: 'modal-close', 'aria-label': 'Close trash bin', onclick: () => overlay.remove() }, '✕');
        modalHeader.appendChild(closeBtn);
        modal.appendChild(modalHeader);

        const modalBody = h('div', { className: 'modal-body' });
        
        if (trashBin.length === 0) {
          modalBody.appendChild(h('div', { className: 'empty' }, 'Trash bin is empty'));
        } else {
          const description = h('p', { style: 'margin-bottom: var(--space-lg); color: var(--text-secondary);' },
            trashBin.length + ' item(s) in trash. Restore or permanently delete items.');
          modalBody.appendChild(description);
          
          trashBin.forEach((item, index) => {
            const itemDiv = h('div', {
              style: 'background: var(--bg-secondary); padding: var(--space-lg); border-radius: var(--radius); border: 1px solid var(--border); margin-bottom: var(--space-md); display: flex; justify-content: space-between; align-items: center;'
            });
            
            const info = h('div', { style: 'flex: 1;' });
            info.appendChild(h('div', { style: 'font-weight: 700;' }, item.card.title || '(Untitled)'));
            info.appendChild(h('div', { style: 'font-size: 0.875rem; color: var(--text-secondary);' },
              'Deleted: ' + new Date(item.deletedAt).toLocaleString()));
            itemDiv.appendChild(info);
            
            const actions = h('div', { style: 'display: flex; gap: var(--space-sm);' });
            
            const restoreBtn = h('button', {
              className: 'btn btn-primary',
              onclick: () => {
                store.cards[item.card.id] = item.card;
                if (item.card.parentId) {
                  const parent = store.cards[item.card.parentId];
                  if (parent && !parent.children.includes(item.card.id)) {
                    parent.children.push(item.card.id);
                  }
                } else {
                  if (!store.rootOrder.includes(item.card.id)) {
                    store.rootOrder.push(item.card.id);
                  }
                }
                trashBin.splice(index, 1);
                save();
                overlay.remove();
                showTrashBin();
                showToast('Card restored: ' + (item.card.title || '(Untitled)'));
                render();
              }
            }, 'Restore');
            actions.appendChild(restoreBtn);
            
            const deleteBtn = h('button', {
              className: 'btn btn-danger',
              onclick: async () => {
                if (await showConfirmDialog('Permanently delete this card?', {
                  title: 'Delete Card',
                  confirmLabel: 'Delete',
                  cancelLabel: 'Cancel',
                  confirmClassName: 'btn btn-danger'
                })) {
                  trashBin.splice(index, 1);
                  overlay.remove();
                  showTrashBin();
                  showToast('Card permanently deleted');
                }
              }
            }, 'Delete');
            actions.appendChild(deleteBtn);
            
            itemDiv.appendChild(actions);
            modalBody.appendChild(itemDiv);
          });
          
          const emptyBtn = h('button', {
            className: 'btn btn-danger',
            style: 'width: 100%; margin-top: var(--space-lg);',
            onclick: async () => {
              if (await showConfirmDialog('Permanently delete all items in trash?', {
                title: 'Empty Trash',
                confirmLabel: 'Empty Trash',
                cancelLabel: 'Cancel',
                confirmClassName: 'btn btn-danger'
              })) {
                trashBin.length = 0;
                overlay.remove();
                showToast('Trash emptied');
              }
            }
          }, 'Empty Trash');
          modalBody.appendChild(emptyBtn);
        }
        
        modal.appendChild(modalBody);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        overlay.onclick = (e) => {
          if (e.target === overlay) overlay.remove();
        };
      }

      // =============================================================
      // --- TAG MANAGEMENT SYSTEM (v0.12.0) ---
      // =============================================================
      
      /**
       * Rename a tag across all cards
       */
      function renameTag(oldTag, newTag) {
        const normalizedOld = oldTag.replace(/^#/, '').toLowerCase().trim();
        const normalizedNew = newTag.replace(/^#/, '').toLowerCase().trim();
        
        if (!normalizedOld || !normalizedNew) return 0;
        if (normalizedOld === normalizedNew) return 0;
        
        let count = 0;
        Object.values(store.cards).forEach(card => {
          if (card.tags && card.tags.includes(normalizedOld)) {
            card.tags = card.tags.map(t => t === normalizedOld ? normalizedNew : t);
            card.tags = [...new Set(card.tags)];
            card.updatedAt = Date.now();
            count++;
          }
        });
        
        if (count > 0) save();
        return count;
      }
      
      /**
       * Merge two tags
       */
      function mergeTags(tag1, tag2) {
        return renameTag(tag1, tag2);
      }
      
      /**
       * Delete a tag from all cards
       */
      function deleteTagGlobal(tag) {
        const normalizedTag = tag.replace(/^#/, '').toLowerCase().trim();
        if (!normalizedTag) return 0;
        
        let count = 0;
        Object.values(store.cards).forEach(card => {
          if (card.tags && card.tags.includes(normalizedTag)) {
            card.tags = card.tags.filter(t => t !== normalizedTag);
            card.updatedAt = Date.now();
            count++;
          }
        });
        
        if (count > 0) save();
        return count;
      }
      
      /**
       * Get tag statistics
       */
      function getTagStats() {
        const tagCounts = {};
        Object.values(store.cards).forEach(card => {
          if (card.tags) {
            card.tags.forEach(tag => {
              tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
          }
        });
        return Object.entries(tagCounts)
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count);
      }
      
      /**
       * Show tag manager modal
       */
      function showTagManager() {
        const overlay = h('div', { className: 'modal-overlay show' });
        const modal = h('div', { className: 'modal', style: 'max-width: 700px;' });
        const modalHeader = h('div', { className: 'modal-header' });
        modalHeader.appendChild(h('div', { className: 'modal-title' }, 'Tag Manager'));
        const closeBtn = h('button', { 
          className: 'modal-close', 
          'aria-label': 'Close tag manager',
          onclick: () => overlay.remove() 
        }, 'X');
        modalHeader.appendChild(closeBtn);
        modal.appendChild(modalHeader);
        
        const modalBody = h('div', { className: 'modal-body' });
        const tagStats = getTagStats();
        
        if (tagStats.length === 0) {
          modalBody.appendChild(h('div', { className: 'empty' }, 'No tags found. Add tags to your cards to manage them here.'));
        } else {
          const summary = h('div', { style: 'background: var(--bg-secondary); padding: var(--space-lg); border-radius: var(--radius); margin-bottom: var(--space-xl);' });
          summary.appendChild(h('div', { style: 'font-weight: 700; margin-bottom: var(--space-sm);' }, 
            tagStats.length + ' unique tags across ' + Object.keys(store.cards).length + ' cards'));
          modalBody.appendChild(summary);
          
          tagStats.forEach(function(tagStat) {
            const tag = tagStat.tag;
            const count = tagStat.count;
            const tagItem = h('div', {
              style: 'background: var(--bg-secondary); padding: var(--space-lg); border-radius: var(--radius); border: 1px solid var(--border); margin-bottom: var(--space-md); display: flex; justify-content: space-between; align-items: center;'
            });
            
            const tagInfo = h('div', { style: 'display: flex; align-items: center; gap: var(--space-md);' });
            const tagChip = h('span', { 
              className: 'card-tag',
              style: 'cursor: pointer;',
              onclick: function() {
                overlay.remove();
                goTo('search', { searchQuery: '#' + tag });
              }
            }, tag);
            tagInfo.appendChild(tagChip);
            tagInfo.appendChild(h('span', { style: 'color: var(--text-secondary);' }, '(' + count + ' card' + (count !== 1 ? 's' : '') + ')'));
            tagItem.appendChild(tagInfo);
            
            const actions = h('div', { style: 'display: flex; gap: var(--space-sm);' });
            
            const renameBtn = h('button', {
              className: 'btn',
              style: 'font-size: var(--text-sm);',
              onclick: async function() {
                const newName = await showPromptDialog({
                  title: 'Rename Tag',
                  message: `Rename tag "${tag}" to:`,
                  label: 'Tag name',
                  defaultValue: tag,
                  confirmLabel: 'Rename',
                  cancelLabel: 'Cancel'
                });
                if (newName && newName.trim() !== tag) {
                  const affected = renameTag(tag, newName.trim());
                  if (affected > 0) {
                    showToast('Renamed "' + tag + '" to "' + newName.trim() + '" in ' + affected + ' card(s)');
                    overlay.remove();
                    showTagManager();
                  }
                }
              }
            }, 'Rename');
            actions.appendChild(renameBtn);
            
            const mergeBtn = h('button', {
              className: 'btn',
              style: 'font-size: var(--text-sm);',
              onclick: async function() {
                const otherTags = tagStats.map(function(t) { return t.tag; }).filter(function(t) { return t !== tag; });
                if (otherTags.length === 0) {
                  showToast('No other tags to merge with', 'info');
                  return;
                }
                const targetTag = await showPromptDialog({
                  title: 'Merge Tags',
                  message: 'Merge "' + tag + '" into which tag?\n\nAvailable: ' + otherTags.join(', '),
                  label: 'Target tag',
                  placeholder: 'Enter existing tag name',
                  suggestions: otherTags,
                  confirmLabel: 'Merge',
                  cancelLabel: 'Cancel'
                });
                if (targetTag && otherTags.includes(targetTag.trim().toLowerCase())) {
                  const affected = mergeTags(tag, targetTag.trim());
                  if (affected > 0) {
                    showToast('Merged "' + tag + '" into "' + targetTag.trim() + '" (' + affected + ' card(s))');
                    overlay.remove();
                    showTagManager();
                  }
                }
              }
            }, 'Merge');
            actions.appendChild(mergeBtn);
            
            const deleteBtn = h('button', {
              className: 'btn btn-danger',
              style: 'font-size: var(--text-sm);',
              onclick: async function() {
                if (await showConfirmDialog('Delete tag "' + tag + '" from all ' + count + ' card(s)?', {
                  title: 'Delete Tag',
                  confirmLabel: 'Delete Tag',
                  cancelLabel: 'Cancel',
                  confirmClassName: 'btn btn-danger'
                })) {
                  const affected = deleteTagGlobal(tag);
                  showToast('Deleted tag "' + tag + '" from ' + affected + ' card(s)');
                  overlay.remove();
                  showTagManager();
                }
              }
            }, 'Delete');
            actions.appendChild(deleteBtn);
            
            tagItem.appendChild(actions);
            modalBody.appendChild(tagItem);
          });
        }
        
        modal.appendChild(modalBody);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        overlay.onclick = function(e) {
          if (e.target === overlay) overlay.remove();
        };
      }

      // =============================================================
      // --- ADVANCED SEARCH (v0.12.0) ---
      // =============================================================
      
      /**
       * Show advanced search modal with filters
       */
      function showAdvancedSearch() {
        const overlay = h('div', { className: 'modal-overlay show' });
        const modal = h('div', { className: 'modal', style: 'max-width: 600px;' });
        const modalHeader = h('div', { className: 'modal-header' });
        modalHeader.appendChild(h('div', { className: 'modal-title' }, 'Advanced Search'));
        const closeBtn = h('button', { 
          className: 'modal-close', 
          'aria-label': 'Close advanced search',
          onclick: () => overlay.remove() 
        }, 'X');
        modalHeader.appendChild(closeBtn);
        modal.appendChild(modalHeader);
        
        // Use a real form so pressing Enter in the query field submits search.
        const modalBody = h('form', { className: 'modal-body' });
        const submitSearch = function() {
          const query = queryInput.value.trim();
          const tagFilter = tagSelect.value;
          const bookmarkOnly = bookmarkInput.checked;
          const dateFilter = dateSelect.value;
          
          sessionStorage.setItem('searchFilters', JSON.stringify({
            query: query, tagFilter: tagFilter, bookmarkOnly: bookmarkOnly, dateFilter: dateFilter
          }));
          
          overlay.remove();
          goTo('search', { searchQuery: query || '*' });
        };
        modalBody.onsubmit = function(e) {
          e.preventDefault();
          submitSearch();
        };
        
        // Add help text at the top
        const helpText = h('div', { 
          style: 'background: var(--bg-secondary); padding: var(--space-md); border-radius: var(--radius); margin-bottom: var(--space-lg); font-size: 14px; color: var(--text-secondary);'
        }, '💡 Tip: Use advanced filters to narrow down your search results by tag, bookmark status, or date.');
        modalBody.appendChild(helpText);
        
        // Search query
        const queryGroup = h('div', { style: 'margin-bottom: var(--space-lg);' });
        queryGroup.appendChild(h('label', { style: 'display: block; margin-bottom: var(--space-xs); font-weight: 600;' }, 'Search Text'));
        const queryInput = h('input', {
          type: 'text',
          placeholder: 'Search in titles and content...',
          'aria-label': 'Search text input',
          style: 'width: 100%; padding: var(--space-md); border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-primary); color: var(--text-primary); font-size: 1rem;'
        });
        queryInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitSearch();
          }
        });
        queryGroup.appendChild(queryInput);
        modalBody.appendChild(queryGroup);
        
        // Filter by tag
        const tagGroup = h('div', { style: 'margin-bottom: var(--space-lg);' });
        tagGroup.appendChild(h('label', { style: 'display: block; margin-bottom: var(--space-xs); font-weight: 600;' }, 'Filter by Tag'));
        const tagSelect = h('select', {
          'aria-label': 'Filter by tag',
          style: 'width: 100%; padding: var(--space-md); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 1rem;'
        });
        tagSelect.appendChild(h('option', { value: '' }, 'Any tag'));
        getAllTags().forEach(function(tag) {
          tagSelect.appendChild(h('option', { value: tag }, tag));
        });
        tagGroup.appendChild(tagSelect);
        modalBody.appendChild(tagGroup);
        
        // Filter by bookmarked
        const bookmarkGroup = h('div', { style: 'margin-bottom: var(--space-lg);' });
        const bookmarkCheck = h('label', { style: 'display: flex; align-items: center; gap: var(--space-sm); cursor: pointer;' });
        const bookmarkInput = h('input', { type: 'checkbox', 'aria-label': 'Only show bookmarked cards' });
        bookmarkCheck.appendChild(bookmarkInput);
        bookmarkCheck.appendChild(document.createTextNode('Only show bookmarked cards'));
        bookmarkGroup.appendChild(bookmarkCheck);
        modalBody.appendChild(bookmarkGroup);
        
        // Filter by date
        const dateGroup = h('div', { style: 'margin-bottom: var(--space-lg);' });
        dateGroup.appendChild(h('label', { style: 'display: block; margin-bottom: var(--space-xs); font-weight: 600;' }, 'Created/Modified'));
        const dateSelect = h('select', {
          'aria-label': 'Filter by date',
          style: 'width: 100%; padding: var(--space-md); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 1rem;'
        });
        dateSelect.appendChild(h('option', { value: '' }, 'Any time'));
        dateSelect.appendChild(h('option', { value: 'today' }, 'Today'));
        dateSelect.appendChild(h('option', { value: 'week' }, 'Past 7 days'));
        dateSelect.appendChild(h('option', { value: 'month' }, 'Past 30 days'));
        dateGroup.appendChild(dateSelect);
        modalBody.appendChild(dateGroup);
        
        // Search button
        const searchBtn = h('button', {
          type: 'submit',
          className: 'btn btn-primary',
          style: 'width: 100%;'
        }, 'Search');
        modalBody.appendChild(searchBtn);
        
        modal.appendChild(modalBody);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        overlay.onclick = function(e) {
          if (e.target === overlay) overlay.remove();
        };
        
        setTimeout(function() { queryInput.focus(); }, 100);
      }

      // =============================================================
      // --- MARKDOWN PREVIEW (v0.12.0) ---
      // =============================================================
      
      /**
       * Simple markdown to HTML conversion
       */
      function simpleMarkdown(text) {
        if (!text) return '';
        
        var html = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        
        // Headers
        html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
        
        // Bold and italic
        html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        
        // Code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Lists
        html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        
        // Blockquotes
        html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
        
        // Line breaks
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';
        
        return html;
      }

      // =============================================================
      // --- EXTENSIONS STORE PLACEHOLDER (v0.12.0) ---
      // =============================================================
      
      /**
       * Show plugin store modal (coming soon)
       */
      function showPluginStore() {
        showPluginManager('install');
      }

      // =============================================================
      // --- BULK IMPORT/EXPORT (v0.12.0) ---
      // =============================================================
      
      /**
       * Bulk export cards
       */
      function bulkExportCards(cardIds, format) {
        format = format || 'json';
        if (!cardIds || cardIds.length === 0) {
          showToast('No cards selected for export', 'error');
          return;
        }
        
        const exportCards = {};
        function includeChildren(id) {
          const card = store.cards[id];
          if (!card) return;
          exportCards[id] = cloneCard(card);
          card.children.forEach(function(childId) { includeChildren(childId); });
        }
        
        cardIds.forEach(function(id) { includeChildren(id); });
        
        var content, filename, mimeType;
        
        if (format === 'markdown') {
          content = Object.values(exportCards).map(function(card) {
            var md = '# ' + (card.title || '(Untitled)') + '\n\n';
            if (card.tags && card.tags.length) {
              md += 'Tags: ' + card.tags.map(function(t) { return '#' + t; }).join(' ') + '\n\n';
            }
            md += card.body || '';
            return md;
          }).join('\n\n---\n\n');
          filename = 'cardspoke-export-' + Date.now() + '.md';
          mimeType = 'text/markdown';
        } else if (format === 'txt') {
          content = Object.values(exportCards).map(function(card) {
            var txt = '=== ' + (card.title || '(Untitled)') + ' ===\n\n';
            if (card.tags && card.tags.length) {
              txt += 'Tags: ' + card.tags.join(', ') + '\n\n';
            }
            txt += card.body || '';
            return txt;
          }).join('\n\n' + '='.repeat(50) + '\n\n');
          filename = 'cardspoke-export-' + Date.now() + '.txt';
          mimeType = 'text/plain';
        } else {
          content = JSON.stringify({
            exportedAt: new Date().toISOString(),
            cardCount: Object.keys(exportCards).length,
            cards: exportCards
          }, null, 2);
          filename = 'cardspoke-export-' + Date.now() + '.json';
          mimeType = 'application/json';
        }
        
        downloadWithFeedback(content, filename, mimeType);
        showToast('Exported ' + Object.keys(exportCards).length + ' card(s)');
      }
      
      /**
       * Bulk import cards from JSON
       */
      function bulkImportCards(importData, targetParentId) {
        try {
          var cards = {};
          
          if (importData.cards) {
            cards = importData.cards;
          } else if (Array.isArray(importData)) {
            importData.forEach(function(card) {
              cards[card.id || uid()] = card;
            });
          } else if (importData.id) {
            cards[importData.id] = importData;
          }
          
          var idMap = {};
          
          Object.keys(cards).forEach(function(oldId) {
            idMap[oldId] = uid();
          });
          
          Object.values(cards).forEach(function(card) {
            var newId = idMap[card.id];
            var newCard = {
              id: newId,
              title: card.title || '',
              body: card.body || '',
              parentId: card.parentId ? (idMap[card.parentId] || targetParentId) : targetParentId,
              children: card.children ? card.children.map(function(cid) { return idMap[cid]; }).filter(Boolean) : [],
              tags: card.tags || [],
              createdAt: Date.now(),
              updatedAt: Date.now()
            };
            
            store.cards[newId] = newCard;
            
            if (newCard.parentId) {
              var parent = store.cards[newCard.parentId];
              if (parent && !parent.children.includes(newId)) {
                parent.children.push(newId);
              }
            } else {
              if (!store.rootOrder.includes(newId)) {
                store.rootOrder.push(newId);
              }
            }
          });
          
          save();
          return Object.keys(cards).length;
        } catch (err) {
          console.error('Bulk import failed:', err);
          showToast('Import failed: ' + err.message, 'error');
          return 0;
        }
      }

      // =============================================================
      // --- DRAG AND DROP (v0.12.0) ---
      // =============================================================
      
      /**
       * Handle drag start
       */
      function handleDragStart(e, cardId) {
        setDraggedCardId(cardId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', cardId);
        e.target.style.opacity = '0.5';
      }
      
      /**
       * Handle drag end
       */
      function handleDragEnd(e) {
        e.target.style.opacity = '1';
        setDraggedCardId(null);
        setDragOverCardId(null);
        document.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
      }
      
      /**
       * Handle drag over
       */
      function handleDragOver(e, cardId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        if (dragOverCardId !== cardId) {
          document.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
          if (cardId !== draggedCardId) {
            var tile = e.target.closest('.card-tile');
            if (tile) tile.classList.add('drag-over');
          }
          setDragOverCardId(cardId);
        }
      }
      
      /**
       * Handle drop
       */
      function handleDrop(e, targetCardId) {
        e.preventDefault();
        var tile = e.target.closest('.card-tile');
        if (tile) tile.classList.remove('drag-over');
        
        if (!draggedCardId || draggedCardId === targetCardId) return;
        
        var draggedCard = store.cards[draggedCardId];
        var targetCard = store.cards[targetCardId];
        
        if (!draggedCard || !targetCard) return;
        
        if (isDescendant(targetCardId, draggedCardId)) {
          showToast('Cannot move a card into its own child', 'error');
          return;
        }
        
        pushUndo('moveCard', {
          cardId: draggedCardId,
          originalParentId: draggedCard.parentId,
          newParentId: targetCardId
        });
        
        if (draggedCard.parentId) {
          var oldParent = store.cards[draggedCard.parentId];
          if (oldParent) {
            oldParent.children = oldParent.children.filter(function(c) { return c !== draggedCardId; });
          }
        } else {
          store.rootOrder = store.rootOrder.filter(function(c) { return c !== draggedCardId; });
        }
        
        draggedCard.parentId = targetCardId;
        if (!targetCard.children.includes(draggedCardId)) {
          targetCard.children.push(draggedCardId);
        }
        
        draggedCard.updatedAt = Date.now();
        save();
        render();
        
        showToast('Moved "' + (draggedCard.title || '(Untitled)') + '" to "' + (targetCard.title || '(Untitled)') + '"');
      }
      
      /**
       * Check if a card is a descendant of another
       */
      function isDescendant(cardId, ancestorId) {
        var ancestor = store.cards[ancestorId];
        if (!ancestor) return false;
        if (ancestor.children.includes(cardId)) return true;
        return ancestor.children.some(function(childId) { return isDescendant(cardId, childId); });
      }
      
      /**
       * Reorder cards within a parent
       */
      function reorderCard(parentId, cardId, newIndex) {
        if (parentId) {
          var parent = store.cards[parentId];
          if (!parent || !parent.children.includes(cardId)) return;
          parent.children = parent.children.filter(function(c) { return c !== cardId; });
          parent.children.splice(newIndex, 0, cardId);
        } else {
          if (!store.rootOrder.includes(cardId)) return;
          store.rootOrder = store.rootOrder.filter(function(c) { return c !== cardId; });
          store.rootOrder.splice(newIndex, 0, cardId);
        }
        save();
        render();
      }

      /**
       * Edit dataset name
       */
      async function editDatasetName() {
        var currentName = (store.metadata && store.metadata.name) || instanceKey;
        var newName = await showPromptDialog({
          title: 'Rename Dataset',
          message: 'Enter new dataset name:',
          label: 'Dataset name',
          defaultValue: currentName,
          confirmLabel: 'Rename',
          cancelLabel: 'Cancel'
        });
        if (newName && newName.trim() && newName.trim() !== currentName) {
          if (!store.metadata) store.metadata = {};
          store.metadata.name = newName.trim();
          store.metadata.updatedAt = Date.now();
          // Update the datasets registry
          const datasets = JSON.parse(localStorage.getItem('cardspoke_datasets') || '{}');
          if (datasets[instanceKey]) {
            datasets[instanceKey].name = newName.trim();
            localStorage.setItem('cardspoke_datasets', JSON.stringify(datasets));
          }
          save();
          showToast('Dataset renamed to: ' + newName.trim());
          render();
        }
      }


      // =============================================================
      // --- KEYBOARD SHORTCUTS ---
      // Global keyboard shortcuts for navigation and actions
      // =============================================================
      
      const shortcuts = {
        'ctrl+h': { action: () => goTo('list'), description: 'Go to Home (card list)' },
        'ctrl+n': { action: () => { menu.newCard.click(); }, description: 'New card' },
        'ctrl+f': { action: () => { searchInput.focus(); }, description: 'Focus search' },
        'ctrl+b': { action: () => { menu.bookmarks.click(); closeMenu(); }, description: 'Show bookmarks' },
        'ctrl+r': { action: () => { menu.recentCards.click(); closeMenu(); }, description: 'Show recent cards' },
        'ctrl+e': { action: () => { showPluginManager('installed'); closeMenu(); }, description: 'Show plugin manager' },
        'ctrl+u': { action: () => { menu.upload.click(); closeMenu(); }, description: 'Upload data' },
        'ctrl+/': { action: () => showKeyboardHelp(), description: 'Show this help' },
        'ctrl+z': { action: () => undo(), description: 'Undo last action' },
        'ctrl+y': { action: () => redo(), description: 'Redo last action' },
        'escape': { action: () => handleEscape(), description: 'Close modals/go back' },
        'alt+t': { action: () => { header.themeToggle.click(); }, description: 'Toggle theme' },
        'alt+c': { action: () => toggleViewMode(), description: 'Toggle compact view' },
        'ctrl+d': { action: async () => { 
          if (navState.page === 'read' && navState.cardId) {
            const card = store.cards[navState.cardId];
            if (card) {
              const choice = await showConfirmDialog('Duplicate this card with all of its children?', {
                title: 'Duplicate Card',
                confirmLabel: 'With Children',
                cancelLabel: 'Only This Card',
                confirmClassName: 'btn btn-primary'
              });
              const newId = duplicateCard(navState.cardId, choice);
              if (newId) {
                showToast('Card duplicated successfully');
                goTo('read', { cardId: newId });
              }
            }
          }
        }, description: 'Duplicate current card' },
        'ctrl+t': { action: () => {
          if (navState.page === 'edit') {
            const tagsInput = document.getElementById('cardTags');
            if (tagsInput) tagsInput.focus();
          }
        }, description: 'Focus tags input (when editing)' },
        'ctrl+[': { action: () => {
          if (navState.page === 'read' && navState.cardId) {
            const card = store.cards[navState.cardId];
            if (card && card.parentId) {
              goTo('read', { cardId: card.parentId });
            } else {
              goTo('list');
            }
          }
        }, description: 'Navigate to parent card' },
        'ctrl+]': { action: () => {
          if (navState.page === 'read' && navState.cardId) {
            const card = store.cards[navState.cardId];
            if (card && card.children.length > 0) {
              goTo('read', { cardId: card.children[0] });
            }
          }
        }, description: 'Navigate to first child card' },
        'ctrl+g': { action: () => {
          // Toggle between list and grid view
          const gridModeEnabled = localStorage.getItem('cardspoke_gridView') === 'true';
          localStorage.setItem('cardspoke_gridView', (!gridModeEnabled).toString());
          showToast(gridModeEnabled ? 'List view enabled' : 'Grid view enabled');
          render();
        }, description: 'Toggle grid/list view' },
      };
      
      function handleEscape() {
        // Overlays that install their own Escape handler — shared dialogs
        // (data-a11y-managed), observer-enhanced modals (data-a11y-enhanced),
        // and the plugin permission dialog — manage their own dismissal. If
        // one is open, do nothing here, or the global handler would ALSO run
        // (e.g. goBack()) and navigate the app out from under the dialog.
        // The static upload modal is intentionally NOT in this set: it has no
        // self-handler and is dismissed by the branch below.
        if (document.querySelector(
          '.modal-overlay.show[data-a11y-managed="true"], ' +
          '.modal-overlay.show[data-a11y-enhanced="true"], ' +
          '.permission-modal')) {
          return;
        }
        // Close menu if open
        if (menu.overlay.classList.contains('show')) {
          closeMenu();
          return;
        }
        // Close upload modal if open
        if (uploadModal.overlay.classList.contains('show')) {
          // Shared close path: releases scroll lock + focus trap and
          // restores focus to the opener.
          if (typeof closeUploadModal === 'function') {
            closeUploadModal();
          } else {
            uploadModal.overlay.classList.remove('show');
            if (typeof unlockBodyScroll === 'function') unlockBodyScroll();
          }
          return;
        }
        // Close help if open
        const helpModal = document.getElementById('keyboardHelpModal');
        if (helpModal && helpModal.classList.contains('show')) {
          helpModal.classList.remove('show');
          return;
        }
        // Otherwise go back if we can
        if (navHistory.length > 0) {
          goBack();
        }
      }
      
      function closeMenu() {
        // Delegate to the shared close path so the menu focus trap is
        // released on Escape too (QA A11Y-4).
        if (typeof closeMenuOverlay === 'function') {
          closeMenuOverlay();
          return;
        }
        menu.overlay.classList.remove('show');
        if (typeof unlockBodyScroll === 'function') unlockBodyScroll();
      }
      
      
      /**
       * Show typography preset selector modal
       */
      function showTypographySelector() {
        const currentTypography = localStorage.getItem('cardspoke_typography') || 'default';
        
        const modal = h('div', { 
          id: 'typographyModal', 
          className: 'menu-overlay show',
          onclick: (e) => { if (e.target === modal) modal.remove(); }
        },
          h('div', { className: 'menu-panel' },
            h('div', { className: 'menu-header' },
              h('div', { className: 'menu-title' }, 'Typography'),
              h('button', { 
                className: 'menu-close',
                onclick: () => modal.remove()
              }, '✕')
            ),
            h('div', { className: 'typography-presets' },
              h('div', { className: 'preset-description' }, 'Choose a reading mode that suits your preference:'),
              ...[
                { id: 'default', name: 'Default', desc: '16px, comfortable line height' },
                { id: 'comfortable', name: 'Comfortable', desc: '18px, extra line height for relaxed reading' },
                { id: 'compact', name: 'Compact', desc: '14px, tighter spacing for more content' },
                { id: 'dyslexia', name: 'Dyslexia-Friendly', desc: '18px, wider spacing, readable font' }
              ].map(preset => 
                h('div', { 
                  className: `preset-option ${currentTypography === preset.id ? 'active' : ''}`,
                  onclick: () => {
                    localStorage.setItem('cardspoke_typography', preset.id);
                    document.documentElement.setAttribute('data-typography', preset.id);
                    showToast(`Typography: ${preset.name}`);
                    modal.remove();
                  }
                },
                  h('div', { className: 'preset-name' }, preset.name),
                  h('div', { className: 'preset-desc' }, preset.desc)
                )
              )
            )
          )
        );
        
        document.body.appendChild(modal);
      }

      /**
       * Generate smart tag suggestions for a card based on content
       * @param {string} cardId - Card ID to analyze
       * @param {number} limit - Maximum number of suggestions (default: 5)
       * @returns {Array<{tag: string, score: number}>} Suggested tags with relevance scores
       */
      function suggestTags(cardId, limit = 5) {
        const card = store.cards[cardId];
        if (!card) return [];
        
        const existingTags = getTags(cardId);
        const allExistingTags = getAllTags();
        const suggestions = [];
        
        // Combine title and body for analysis
        const content = ((card.title || '') + ' ' + (card.body || '')).toLowerCase();
        
        // Get tags from other cards with similar content
        for (const tag of allExistingTags) {
          if (existingTags.includes(tag)) continue; // Skip already applied tags
          
          // Find cards with this tag
          const cardsWithTag = Object.values(store.cards).filter(c => 
            c.tags && c.tags.includes(tag)
          );
          
          // Calculate relevance based on content similarity
          let totalScore = 0;
          for (const otherCard of cardsWithTag) {
            const otherContent = ((otherCard.title || '') + ' ' + (otherCard.body || '')).toLowerCase();
            
            // Simple word overlap scoring
            const contentWords = new Set(content.split(/\s+/).filter(w => w.length > 3));
            const otherWords = new Set(otherContent.split(/\s+/).filter(w => w.length > 3));
            const commonWords = [...contentWords].filter(w => otherWords.has(w));
            
            if (commonWords.length > 0) {
              totalScore += commonWords.length / Math.max(contentWords.size, otherWords.size);
            }
          }
          
          if (totalScore > 0) {
            suggestions.push({
              tag,
              score: totalScore / cardsWithTag.length
            });
          }
        }
        
        // Sort by score and return top suggestions
        suggestions.sort((a, b) => b.score - a.score);
        return suggestions.slice(0, limit);
      }
      
      /**
       * Show smart tag suggestions modal
       * @param {string} cardId - Card ID to suggest tags for
       */
      function showTagSuggestions(cardId) {
        const card = store.cards[cardId];
        if (!card) return;
        
        const suggestions = suggestTags(cardId, 8);
        
        if (suggestions.length === 0) {
          showToast('No tag suggestions available', 'info');
          return;
        }
        
        const modal = h('div', { 
          id: 'tagSuggestionsModal', 
          className: 'menu-overlay show',
          onclick: (e) => { if (e.target === modal) modal.remove(); }
        },
          h('div', { className: 'menu-panel' },
            h('div', { className: 'menu-header' },
              h('div', { className: 'menu-title' }, 'Suggested Tags'),
              h('button', { 
                className: 'menu-close',
                onclick: () => modal.remove()
              }, '✕')
            ),
            h('div', { className: 'tag-suggestions' },
              h('div', { className: 'suggestion-description' }, 
                `Based on similar cards, you might want to add these tags:`
              ),
              ...suggestions.map(({ tag, score }) => 
                h('button', { 
                  className: 'suggestion-tag',
                  onclick: () => {
                    addTag(cardId, tag);
                    showToast(`✓ Tag "${tag}" added`);
                    modal.remove();
                    render();
                  }
                },
                  h('span', { className: 'tag-name' }, tag),
                  h('span', { className: 'tag-score' }, `${Math.round(score * 100)}% match`)
                )
              ),
              h('button', {
                className: 'btn btn-primary',
                onclick: () => {
                  // Apply all suggestions
                  suggestions.forEach(({ tag }) => addTag(cardId, tag, true));
                  save();
                  showToast(`✓ ${suggestions.length} tags added`);
                  modal.remove();
                  render();
                }
              }, `Apply All ${suggestions.length} Tags`)
            )
          )
        );
        
        document.body.appendChild(modal);
      }

      // =========================================================
      // Share Card Feature (v1.0.0)
      // =========================================================

      /**
       * Get card and all descendants as an object
       */
      function getCardWithDescendants(cardId) {
        const card = store.cards[cardId];
        if (!card) return null;

        const result = {
          id: card.id,
          title: card.title,
          body: card.body,
          tags: card.tags || [],
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
          children: []
        };

        if (card.children && card.children.length > 0) {
          card.children.forEach(childId => {
            const childData = getCardWithDescendants(childId);
            if (childData) result.children.push(childData);
          });
        }

        return result;
      }

      /**
       * Convert card tree to Markdown
       */
      function cardToMarkdown(cardData, depth = 0) {
        let md = '';
        const indent = '  '.repeat(depth);
        const headingLevel = Math.min(depth + 1, 6);
        const heading = '#'.repeat(headingLevel);

        md += `${heading} ${cardData.title || '(Untitled)'}\n\n`;

        if (cardData.tags && cardData.tags.length > 0) {
          md += `*Tags: ${cardData.tags.map(t => '#' + t).join(', ')}*\n\n`;
        }

        if (cardData.body) {
          md += `${cardData.body}\n\n`;
        }

        if (cardData.children && cardData.children.length > 0) {
          cardData.children.forEach(child => {
            md += cardToMarkdown(child, depth + 1);
          });
        }

        return md;
      }

      /**
       * Show share options for a card
       */
      function showShareCard(cardId) {
        const card = store.cards[cardId];
        if (!card) {
          showToast('Card not found', 'error');
          return;
        }

        const modal = h('div', {
          className: 'modal-overlay show',
          onclick: (e) => { if (e.target === modal) modal.remove(); }
        },
          h('div', { className: 'modal', style: 'max-width: 600px;' },
            h('div', { className: 'modal-header' },
              h('div', { className: 'modal-title' }, 'Share Card'),
              h('button', {
                className: 'modal-close',
                'aria-label': 'Close',
                onclick: () => modal.remove()
              }, '✕')
            ),
            h('div', { className: 'modal-body' },
              h('p', { style: 'margin-bottom: var(--space-xl); color: var(--text-secondary);' },
                'Copy this card in different formats to share with others.'
              ),

              // Card only - JSON
              h('div', { style: 'margin-bottom: var(--space-lg);' },
                h('h3', { style: 'margin-bottom: var(--space-md);' }, 'Card Only'),
                h('button', {
                  className: 'btn btn-primary',
                  style: 'width: 100%; margin-bottom: var(--space-sm);',
                  onclick: () => {
                    const cardData = {
                      id: card.id,
                      title: card.title,
                      body: card.body,
                      tags: card.tags || []
                    };
                    navigator.clipboard.writeText(JSON.stringify(cardData, null, 2))
                      .then(() => {
                        showToast('Card copied as JSON');
                        modal.remove();
                      })
                      .catch(() => showToast('Failed to copy', 'error'));
                  }
                }, 'Copy as JSON'),
                h('button', {
                  className: 'btn',
                  style: 'width: 100%;',
                  onclick: () => {
                    let md = `# ${card.title || '(Untitled)'}\n\n`;
                    if (card.tags && card.tags.length > 0) {
                      md += `*Tags: ${card.tags.map(t => '#' + t).join(', ')}*\n\n`;
                    }
                    md += card.body || '';
                    navigator.clipboard.writeText(md)
                      .then(() => {
                        showToast('Card copied as Markdown');
                        modal.remove();
                      })
                      .catch(() => showToast('Failed to copy', 'error'));
                  }
                }, 'Copy as Markdown')
              ),

              // Card + Children
              h('div', { style: 'margin-bottom: var(--space-lg);' },
                h('h3', { style: 'margin-bottom: var(--space-md);' }, 'Card + Children'),
                h('button', {
                  className: 'btn btn-primary',
                  style: 'width: 100%; margin-bottom: var(--space-sm);',
                  onclick: () => {
                    const cardData = getCardWithDescendants(card.id);
                    navigator.clipboard.writeText(JSON.stringify(cardData, null, 2))
                      .then(() => {
                        showToast('Card tree copied as JSON');
                        modal.remove();
                      })
                      .catch(() => showToast('Failed to copy', 'error'));
                  }
                }, 'Copy Tree as JSON'),
                h('button', {
                  className: 'btn',
                  style: 'width: 100%;',
                  onclick: () => {
                    const cardData = getCardWithDescendants(card.id);
                    const md = cardToMarkdown(cardData);
                    navigator.clipboard.writeText(md)
                      .then(() => {
                        showToast('Card tree copied as Markdown');
                        modal.remove();
                      })
                      .catch(() => showToast('Failed to copy', 'error'));
                  }
                }, 'Copy Tree as Markdown')
              ),

              h('div', { style: 'font-size: var(--text-sm); color: var(--text-secondary); padding: var(--space-md); background: var(--bg-secondary); border-radius: var(--radius);' },
                'Tip: Use JSON format to import the card into another CardSpoke instance. Use Markdown to share in documents or emails.'
              )
            )
          )
        );

        document.body.appendChild(modal);
      }

      // =========================================================
      // Getting Started Guide (v1.0.0)
      // =========================================================
      function showGettingStarted() {
        let modal = document.getElementById('gettingStartedModal');

        if (!modal) {
          modal = h('div', {
            id: 'gettingStartedModal',
            className: 'menu-overlay',
            onclick: (e) => { if (e.target === modal) modal.classList.remove('show'); }
          },
            h('div', { className: 'menu-panel', style: 'max-width: 700px; max-height: 85vh; overflow-y: auto;' },
              h('div', { className: 'menu-header' },
                h('div', { className: 'menu-title' }, 'Getting Started with CardSpoke'),
                h('button', {
                  className: 'menu-close',
                  'aria-label': 'Close',
                  onclick: () => modal.classList.remove('show')
                }, '✕')
              ),
              h('div', { style: 'padding: var(--space-lg);' },
                // Welcome
                h('div', { style: 'margin-bottom: var(--space-xl); text-align: center;' },
                  h('h2', { style: 'margin-bottom: var(--space-sm); color: var(--primary);' }, 'Welcome to CardSpoke!'),
                  h('p', { style: 'color: var(--text-secondary);' }, 'A local-first, lightweight hierarchical note-taking app')
                ),

                // What are Cards?
                h('div', { style: 'margin-bottom: var(--space-xl);' },
                  h('h3', { style: 'margin-bottom: var(--space-md); color: var(--primary);' }, 'What are Cards?'),
                  h('p', { style: 'margin-bottom: var(--space-sm);' },
                    'Cards are the building blocks of CardSpoke. Think of them as notes or ideas that can be organized hierarchically.'
                  ),
                  h('ul', { style: 'margin-left: var(--space-lg); margin-bottom: var(--space-sm);' },
                    h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Each card has a title and body content'),
                    h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Cards can have child cards to create nested structures'),
                    h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Organize your thoughts in a hierarchy that makes sense to you')
                  )
                ),

                // Creating Cards
                h('div', { style: 'margin-bottom: var(--space-xl);' },
                  h('h3', { style: 'margin-bottom: var(--space-md); color: var(--primary);' }, 'Creating Cards'),
                  h('div', { style: 'background: var(--bg-secondary); padding: var(--space-md); border-radius: var(--radius); border-left: 3px solid var(--primary); margin-bottom: var(--space-md);' },
                    h('p', { style: 'font-weight: 600; margin-bottom: var(--space-xs);' }, 'To create your first card:'),
                    h('ol', { style: 'margin-left: var(--space-lg);' },
                      h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Click the menu button (☰) in the top right'),
                      h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Select "New Card" or press Ctrl+N'),
                      h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Add a title and body text'),
                      h('li', {}, 'Click "Save Card"')
                    )
                  ),
                  h('p', { style: 'margin-bottom: var(--space-sm);' },
                    'To create a child card, open any existing card and click the "Add Child Card" button. Child cards appear nested under their parent.'
                  )
                ),

                // Tags
                h('div', { style: 'margin-bottom: var(--space-xl);' },
                  h('h3', { style: 'margin-bottom: var(--space-md); color: var(--primary);' }, 'Using Tags'),
                  h('p', { style: 'margin-bottom: var(--space-sm);' },
                    'Tags help you categorize and find cards quickly:'
                  ),
                  h('ul', { style: 'margin-left: var(--space-lg); margin-bottom: var(--space-sm);' },
                    h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Add tags when creating or editing a card'),
                    h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Click on a tag to see all cards with that tag'),
                    h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Use Tag Manager (in menu) to rename, merge, or delete tags')
                  )
                ),

                // Search
                h('div', { style: 'margin-bottom: var(--space-xl);' },
                  h('h3', { style: 'margin-bottom: var(--space-md); color: var(--primary);' }, 'Finding Cards with Search'),
                  h('p', { style: 'margin-bottom: var(--space-sm);' },
                    'CardSpoke has powerful search capabilities:'
                  ),
                  h('ul', { style: 'margin-left: var(--space-lg); margin-bottom: var(--space-sm);' },
                    h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Press Ctrl+F or click the search icon to search'),
                    h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Use ↑/↓ arrow keys to navigate results'),
                    h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Press Enter to open the selected card'),
                    h('li', { style: 'margin-bottom: var(--space-xs);' }, 'Search works across titles, content, and tags')
                  )
                ),

                // Other Features
                h('div', { style: 'margin-bottom: var(--space-xl);' },
                  h('h3', { style: 'margin-bottom: var(--space-md); color: var(--primary);' }, 'More Features'),
                  h('div', { style: 'display: grid; gap: var(--space-md);' },
                    h('div', {},
                      h('strong', {}, 'Bookmarks'), ' — Click the star icon on any card to bookmark it for quick access'
                    ),
                    h('div', {},
                      h('strong', {}, 'Undo/Redo'), ' — Press Ctrl+Z to undo and Ctrl+Y to redo changes'
                    ),
                    h('div', {},
                      h('strong', {}, 'Export'), ' — Save your data in JSON, Markdown, or CSV formats (Data & Export menu)'
                    ),
                    h('div', {},
                      h('strong', {}, 'Backups'), ' — Create manual backups anytime from the Data & Export menu'
                    ),
                    h('div', {},
                      h('strong', {}, 'Plugins'), ' — Customize CardSpoke with themes and plugins (Plugin Manager)'
                    ),
                    h('div', {},
                      h('strong', {}, 'Dark Mode'), ' — Toggle dark mode with the moon icon in the header'
                    )
                  )
                ),

                // Privacy Note
                h('div', { style: 'margin-bottom: var(--space-lg);' },
                  h('div', { style: 'background: var(--bg-secondary); padding: var(--space-md); border-radius: var(--radius);' },
                    h('p', { style: 'margin-bottom: var(--space-xs); font-weight: 600;' }, 'Your Privacy Matters'),
                    h('p', { style: 'color: var(--text-secondary); font-size: 0.9rem;' },
                      'All your data is stored locally on your device. CardSpoke never sends your data to any server. You have complete control and ownership of your information.'
                    )
                  )
                ),

                // Get Started Button
                h('div', { style: 'text-align: center;' },
                  h('button', {
                    className: 'btn btn-primary',
                    style: 'padding: var(--space-md) var(--space-xl);',
                    onclick: () => {
                      modal.classList.remove('show');
                      // Mark as seen
                      localStorage.setItem('cardspoke_hasSeenGettingStarted', 'true');
                      // Open new card creation
                      goTo('edit', { cardId: null, parentId: null });
                    }
                  }, 'Create Your First Card')
                )
              )
            )
          );
          document.body.appendChild(modal);
        }

        modal.classList.add('show');
      }

      // =========================================================
      // In-app Help Modal (v0.12.1)
      // =========================================================
      function showHelp() {
        let helpModal = document.getElementById('inAppHelpModal');
        
        if (!helpModal) {
          helpModal = h('div', { 
            id: 'inAppHelpModal', 
            className: 'menu-overlay',
            onclick: (e) => { if (e.target === helpModal) helpModal.classList.remove('show'); }
          },
            h('div', { className: 'menu-panel', style: 'max-width: 600px; max-height: 80vh; overflow-y: auto;' },
              h('div', { className: 'menu-header' },
                h('div', { className: 'menu-title' }, 'Help & Documentation'),
                h('button', { 
                  className: 'menu-close',
                  onclick: () => helpModal.classList.remove('show')
                }, '✕')
              ),
              h('div', { style: 'padding: var(--space-md);' },
                // Quick Start Section
                h('div', { style: 'margin-bottom: var(--space-lg);' },
                  h('h3', { style: 'margin-bottom: var(--space-sm); color: var(--primary);' }, 'Quick Start'),
                  h('p', { style: 'margin-bottom: var(--space-xs);' }, '1. Click "New Card" to create your first card'),
                  h('p', { style: 'margin-bottom: var(--space-xs);' }, '2. Add content, tags, and child cards'),
                  h('p', { style: 'margin-bottom: var(--space-xs);' }, '3. Use search to find cards quickly'),
                  h('p', {}, '4. Organize with bookmarks and recent cards')
                ),
                
                // Features Section
                h('div', { style: 'margin-bottom: var(--space-lg);' },
                  h('h3', { style: 'margin-bottom: var(--space-sm); color: var(--primary);' }, 'Key Features'),
                  h('div', { style: 'display: grid; gap: var(--space-sm);' },
                    h('div', {}, h('strong', {}, 'Cards'), ' — Hierarchical notes with parent-child relationships'),
                    h('div', {}, h('strong', {}, 'Tags'), ' — Organize and filter cards with tags'),
                    h('div', {}, h('strong', {}, 'Links'), ' — Reference other cards with [[Card Name]]'),
                    h('div', {}, h('strong', {}, 'Search'), ' — Fuzzy search across all cards'),
                    h('div', {}, h('strong', {}, 'Bookmarks'), ' — Star important cards for quick access'),
                    h('div', {}, h('strong', {}, 'Undo/Redo'), ' — Ctrl+Z / Ctrl+Y for changes'),
                    h('div', {}, h('strong', {}, 'Trash Bin'), ' — Recover deleted cards'),
                    h('div', {}, h('strong', {}, 'Plugins'), ' — Customize with themes and plugins')
                  )
                ),
                
                // Keyboard Shortcuts Section
                h('div', { style: 'margin-bottom: var(--space-lg);' },
                  h('h3', { style: 'margin-bottom: var(--space-sm); color: var(--primary);' }, 'Keyboard Shortcuts'),
                  h('div', { style: 'display: grid; grid-template-columns: auto 1fr; gap: var(--space-xs) var(--space-md);' },
                    h('kbd', { style: 'background: var(--bg-alt); padding: 2px 6px; border-radius: 4px;' }, 'Ctrl+N'),
                    h('span', {}, 'New card'),
                    h('kbd', { style: 'background: var(--bg-alt); padding: 2px 6px; border-radius: 4px;' }, 'Ctrl+F'),
                    h('span', {}, 'Search'),
                    h('kbd', { style: 'background: var(--bg-alt); padding: 2px 6px; border-radius: 4px;' }, 'Ctrl+Z'),
                    h('span', {}, 'Undo'),
                    h('kbd', { style: 'background: var(--bg-alt); padding: 2px 6px; border-radius: 4px;' }, 'Ctrl+Y'),
                    h('span', {}, 'Redo'),
                    h('kbd', { style: 'background: var(--bg-alt); padding: 2px 6px; border-radius: 4px;' }, 'Ctrl+/'),
                    h('span', {}, 'All shortcuts')
                  )
                ),
                
                // Plugins Section
                h('div', { style: 'margin-bottom: var(--space-lg);' },
                  h('h3', { style: 'margin-bottom: var(--space-sm); color: var(--primary);' }, 'Plugins'),
                  h('p', { style: 'margin-bottom: var(--space-xs);' }, 'CardSpoke supports JSON-based plugins in three layers:'),
                  h('ul', { style: 'margin-left: var(--space-md); margin-bottom: var(--space-sm);' },
                    h('li', {}, 'Theme plugins: CSS-only visual changes (auto-enabled)'),
                    h('li', {}, 'Feature plugins: Add new functionality with the plugin API'),
                    h('li', {}, 'App plugins: Deep transformations (middleware, components, app rename) — enabled manually')
                  ),
                  h('p', { style: 'font-size: var(--text-sm); color: var(--text-secondary);' },
                    'Access Plugin Manager from the menu to install and manage plugins.'
                  )
                ),
                
                // Advanced Features Section
                h('div', { style: 'margin-bottom: var(--space-lg);' },
                  h('h3', { style: 'margin-bottom: var(--space-sm); color: var(--primary);' }, 'Advanced Features'),
                  h('div', { style: 'display: grid; gap: var(--space-sm);' },
                    h('div', {}, 
                      h('strong', {}, 'Tag Manager'), 
                      ' — Rename, merge, or delete tags across all cards. Access from the menu.'
                    ),
                    h('div', {}, 
                      h('strong', {}, 'Advanced Search'), 
                      ' — Filter cards by tag, bookmark status, or date range. Access from the menu.'
                    ),
                    h('div', {}, 
                      h('strong', {}, 'Datasets'), 
                      ' — Create multiple isolated data vaults. Access from Data & Export menu.'
                    ),
                    h('div', {}, 
                      h('strong', {}, 'Developer Mode'), 
                      ' — Enable in Appearance settings to access debugging tools and system information.'
                    )
                  )
                ),
                
                // Data & Privacy Section
                h('div', { style: 'margin-bottom: var(--space-lg);' },
                  h('h3', { style: 'margin-bottom: var(--space-sm); color: var(--primary);' }, 'Data & Privacy'),
                  h('p', {}, 'Your data is stored locally on your device. CardSpoke never sends your data to external servers. Export anytime to JSON, Markdown, or CSV.')
                ),

                // Language & Localization Section (v1.0.0)
                h('div', { style: 'margin-bottom: var(--space-lg);' },
                  h('h3', { style: 'margin-bottom: var(--space-sm); color: var(--primary);' }, 'Language & Localization'),
                  h('p', { style: 'margin-bottom: var(--space-sm);' },
                    'CardSpoke supports community language packs. Visit the CardSpoke website to download language packs for your preferred language.'
                  ),
                  h('p', { style: 'font-size: var(--text-sm); color: var(--text-secondary);' },
                    'Coming soon: Download language packs from ',
                    h('a', {
                      href: 'https://github.com/jxburros/CardSpoke/wiki/Language-Packs',
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      style: 'color: var(--primary);'
                    }, 'CardSpoke Language Packs')
                  )
                ),

                // Version Info
                h('div', { style: 'padding-top: var(--space-md); border-top: 1px solid var(--border); text-align: center; color: var(--text-secondary);' },
                  h('p', {}, `CardSpoke v${APP_VERSION}`),
                  h('p', { style: 'font-size: var(--text-sm);' },
                    h('a', { href: 'https://github.com/jxburros/CardSpoke', target: '_blank', rel: 'noopener noreferrer', style: 'color: var(--primary);' }, 'GitHub'),
                    ' · ',
                    h('a', { href: 'https://github.com/jxburros/CardSpoke/blob/main/README.md', target: '_blank', rel: 'noopener noreferrer', style: 'color: var(--primary);' }, 'Documentation')
                  )
                )
              )
            )
          );
          document.body.appendChild(helpModal);
        }
        
        helpModal.classList.add('show');
      }

      function showKeyboardHelp() {
        let helpModal = document.getElementById('keyboardHelpModal');
        
        if (!helpModal) {
          // Create help modal
          helpModal = h('div', { 
            id: 'keyboardHelpModal', 
            className: 'menu-overlay',
            onclick: (e) => { if (e.target === helpModal) helpModal.classList.remove('show'); }
          },
            h('div', { className: 'menu-panel' },
              h('div', { className: 'menu-header' },
                h('div', { className: 'menu-title' }, 'Keyboard Shortcuts'),
                h('button', { 
                  className: 'menu-close',
                  onclick: () => helpModal.classList.remove('show')
                }, '✕')
              ),
              h('div', { className: 'keyboard-shortcuts' },
                h('div', { className: 'shortcuts-section' },
                  h('div', { className: 'shortcuts-section-title' }, 'Navigation'),
                  ...Object.entries(shortcuts)
                    .filter(([key]) => ['ctrl+h', 'ctrl+b', 'ctrl+r', 'escape'].includes(key))
                    .map(([key, { description }]) => 
                      h('div', { className: 'shortcut-item' },
                        h('kbd', {}, key.replace('ctrl+', 'Ctrl+')),
                        h('span', {}, description)
                      )
                    )
                ),
                h('div', { className: 'shortcuts-section' },
                  h('div', { className: 'shortcuts-section-title' }, 'Actions'),
                  ...Object.entries(shortcuts)
                    .filter(([key]) => ['ctrl+n', 'ctrl+f', 'ctrl+u', 'ctrl+e'].includes(key))
                    .map(([key, { description }]) => 
                      h('div', { className: 'shortcut-item' },
                        h('kbd', {}, key.replace('ctrl+', 'Ctrl+')),
                        h('span', {}, description)
                      )
                    )
                ),
                h('div', { className: 'shortcuts-section' },
                  h('div', { className: 'shortcuts-section-title' }, 'View'),
                  ...Object.entries(shortcuts)
                    .filter(([key]) => ['alt+t', 'alt+c'].includes(key))
                    .map(([key, { description }]) => 
                      h('div', { className: 'shortcut-item' },
                        h('kbd', {}, key.replace('alt+', 'Alt+')),
                        h('span', {}, description)
                      )
                    )
                ),
                h('div', { className: 'shortcuts-section' },
                  h('div', { className: 'shortcuts-section-title' }, 'Help'),
                  h('div', { className: 'shortcut-item' },
                    h('kbd', {}, 'Ctrl+/'),
                    h('span', {}, 'Show this help')
                  )
                )
              )
            )
          );
          document.body.appendChild(helpModal);
        }
        
        helpModal.classList.add('show');
      }
      
      // Global keyboard event handler
      document.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
          // Allow Escape to work in inputs
          if (e.key === 'Escape') {
            e.target.blur();
            handleEscape();
          }
          return;
        }
        
        // Build shortcut key string
        let key = (e.key || '').toLowerCase();
        // On macOS, Option+<letter> produces a composed character in e.key
        // (Option+T => '†'), so Alt/Option shortcuts would never match.
        // Derive the letter from the physical key code instead (only when
        // e.key is not already a plain letter, so non-QWERTY layouts that
        // report the real letter keep working).
        if (e.altKey && !/^[a-z]$/.test(key)) {
          const codeMatch = /^Key([A-Z])$/.exec(e.code || '');
          if (codeMatch) key = codeMatch[1].toLowerCase();
        }
        if (e.ctrlKey || e.metaKey) key = 'ctrl+' + key;
        if (e.altKey) key = 'alt+' + key;
        
        // Execute shortcut if it exists
        const shortcut = shortcuts[key];
        if (shortcut) {
          e.preventDefault();
          try {
            shortcut.action();
          } catch (error) {
            console.error('Keyboard shortcut error:', error);
            showToast('Shortcut failed: ' + key, 'error');
          }
        }
      });

      // =============================================================
      // --- DEVELOPER CONSOLE (v0.16.1) ---
      // Show debugging information when developer mode is enabled
      // =============================================================
      
      /**
       * Show developer console with debugging information
       */
      function showDeveloperConsole() {
        const overlay = h('div', { className: 'modal-overlay show' });
        const modal = h('div', { className: 'modal', style: 'max-width: 800px;' });
        const modalHeader = h('div', { className: 'modal-header' });
        modalHeader.appendChild(h('div', { className: 'modal-title' }, '🔧 Developer Console'));
        const closeBtn = h('button', { 
          className: 'modal-close', 
          'aria-label': 'Close developer console',
          onclick: () => overlay.remove() 
        }, 'X');
        modalHeader.appendChild(closeBtn);
        modal.appendChild(modalHeader);
        
        const modalBody = h('div', { className: 'modal-body', style: 'max-height: 70vh; overflow-y: auto;' });
        
        // System Information
        const sysSection = h('div', { style: 'margin-bottom: var(--space-xl); padding: var(--space-lg); background: var(--bg-secondary); border-radius: var(--radius);' });
        sysSection.appendChild(h('div', { style: 'font-weight: 700; margin-bottom: var(--space-md); font-size: var(--text-lg);' }, '📊 System Information'));
        
        const sysInfo = [
          { label: 'App Version', value: APP_VERSION },
          { label: 'Schema Version', value: store.schemaVersion || 'N/A' },
          { label: 'Active Dataset', value: datasetManager ? datasetManager.getActiveDataset().name : 'Default' },
          { label: 'Total Cards', value: Object.keys(store.cards).length },
          { label: 'Root Cards', value: store.rootOrder.length },
          { label: 'Total Tags', value: getAllTags().length },
          { label: 'Active Plugins', value: store.plugins ? Object.keys(store.plugins).length : 0 },
          { label: 'Developer Mode', value: isDeveloperMode() ? '✓ Enabled' : '✗ Disabled' }
        ];
        
        sysInfo.forEach(info => {
          const row = h('div', { style: 'display: flex; justify-content: space-between; padding: var(--space-sm) 0; border-bottom: 1px solid var(--border);' });
          row.appendChild(h('span', { style: 'font-weight: 600;' }, info.label + ':'));
          row.appendChild(h('span', { style: 'font-family: monospace; color: var(--text-secondary);' }, String(info.value)));
          sysSection.appendChild(row);
        });
        modalBody.appendChild(sysSection);
        
        // Card Statistics
        const statsSection = h('div', { style: 'margin-bottom: var(--space-xl); padding: var(--space-lg); background: var(--bg-secondary); border-radius: var(--radius);' });
        statsSection.appendChild(h('div', { style: 'font-weight: 700; margin-bottom: var(--space-md); font-size: var(--text-lg);' }, '📈 Card Statistics'));
        
        const bookmarkedCount = Object.values(store.cards).filter(c => c.bookmarked).length;
        const withTagsCount = Object.values(store.cards).filter(c => c.tags && c.tags.length > 0).length;
        const withChildrenCount = Object.values(store.cards).filter(c => c.children && c.children.length > 0).length;
        
        const stats = [
          { label: 'Bookmarked Cards', value: bookmarkedCount },
          { label: 'Cards with Tags', value: withTagsCount },
          { label: 'Cards with Children', value: withChildrenCount },
          { label: 'Orphaned Cards', value: Object.values(store.cards).filter(c => !c.parentId && !store.rootOrder.includes(c.id)).length }
        ];
        
        stats.forEach(stat => {
          const row = h('div', { style: 'display: flex; justify-content: space-between; padding: var(--space-sm) 0; border-bottom: 1px solid var(--border);' });
          row.appendChild(h('span', { style: 'font-weight: 600;' }, stat.label + ':'));
          row.appendChild(h('span', { style: 'font-family: monospace; color: var(--text-secondary);' }, String(stat.value)));
          statsSection.appendChild(row);
        });
        modalBody.appendChild(statsSection);
        
        // Recent Activity
        const activitySection = h('div', { style: 'margin-bottom: var(--space-xl); padding: var(--space-lg); background: var(--bg-secondary); border-radius: var(--radius);' });
        activitySection.appendChild(h('div', { style: 'font-weight: 700; margin-bottom: var(--space-md); font-size: var(--text-lg);' }, '🕐 Recent Activity'));
        
        const recentCards = Object.values(store.cards)
          .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
          .slice(0, 5);
        
        if (recentCards.length > 0) {
          recentCards.forEach(card => {
            const row = h('div', { 
              style: 'padding: var(--space-sm); border-bottom: 1px solid var(--border); cursor: pointer;',
              onclick: () => {
                overlay.remove();
                goTo('read', { cardId: card.id });
              }
            });
            row.appendChild(h('div', { style: 'font-weight: 600; margin-bottom: var(--space-xs);' }, card.title || '(Untitled)'));
            const timestamp = new Date(card.updatedAt || card.createdAt).toLocaleString();
            row.appendChild(h('div', { style: 'font-size: var(--text-sm); color: var(--text-secondary); font-family: monospace;' }, 
              `ID: ${card.id.slice(0, 8)}... • Updated: ${timestamp}`));
            activitySection.appendChild(row);
          });
        } else {
          activitySection.appendChild(h('div', { style: 'color: var(--text-secondary); font-style: italic;' }, 'No recent activity'));
        }
        modalBody.appendChild(activitySection);
        
        // Storage Information
        const storageSection = h('div', { style: 'margin-bottom: var(--space-xl); padding: var(--space-lg); background: var(--bg-secondary); border-radius: var(--radius);' });
        storageSection.appendChild(h('div', { style: 'font-weight: 700; margin-bottom: var(--space-md); font-size: var(--text-lg);' }, '💾 Storage Information'));
        
        let storageUsed = 0;
        try {
          // Estimate localStorage usage
          let total = 0;
          for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
              total += localStorage[key].length + key.length;
            }
          }
          storageUsed = (total / 1024).toFixed(2);
        } catch (e) {
          storageUsed = 'N/A';
        }
        
        const storageInfo = [
          { label: 'LocalStorage Used', value: storageUsed + ' KB' },
          { label: 'Storage Keys', value: Object.keys(localStorage).filter(k => k.startsWith('cardspoke_')).length }
        ];
        
        storageInfo.forEach(info => {
          const row = h('div', { style: 'display: flex; justify-content: space-between; padding: var(--space-sm) 0; border-bottom: 1px solid var(--border);' });
          row.appendChild(h('span', { style: 'font-weight: 600;' }, info.label + ':'));
          row.appendChild(h('span', { style: 'font-family: monospace; color: var(--text-secondary);' }, String(info.value)));
          storageSection.appendChild(row);
        });
        modalBody.appendChild(storageSection);
        
        // Actions
        const actionsSection = h('div', { style: 'padding: var(--space-lg); background: var(--bg-secondary); border-radius: var(--radius);' });
        actionsSection.appendChild(h('div', { style: 'font-weight: 700; margin-bottom: var(--space-md); font-size: var(--text-lg);' }, '⚡ Quick Actions'));
        
        const actionsRow = h('div', { style: 'display: flex; gap: var(--space-sm); flex-wrap: wrap;' });
        
        const exportBtn = h('button', { 
          className: 'btn btn-primary',
          onclick: () => {
            overlay.remove();
            exportJSON('instance');
          }
        }, 'Export Data');
        actionsRow.appendChild(exportBtn);
        
        const consoleBtn = h('button', { 
          className: 'btn',
          onclick: () => {
            console.log('[Developer Console] Store:', store);
            console.log('[Developer Console] NavState:', navState);
            showToast('Store logged to browser console', 'info');
          }
        }, 'Log to Console');
        actionsRow.appendChild(consoleBtn);
        
        const refreshBtn = h('button', { 
          className: 'btn',
          onclick: () => {
            overlay.remove();
            showDeveloperConsole();
          }
        }, 'Refresh');
        actionsRow.appendChild(refreshBtn);
        
        actionsSection.appendChild(actionsRow);
        modalBody.appendChild(actionsSection);
        
        modal.appendChild(modalBody);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        overlay.onclick = function(e) {
          if (e.target === overlay) overlay.remove();
        };
      }

      // =============================================================
      // --- HOST BRIDGE ---
      // The plugin runtime (www/src/core/plugin-api.js) is deliberately
      // decoupled from the app layer: it reaches the host app exclusively
      // through the window globals assigned here (plus window.store /
      // window.save, kept in sync by state.js). This block must run before
      // the boot sequence below so that plugins restored at startup find a
      // complete host API. The set of names is a STABILITY CONTRACT —
      // see docs/architecture/PLUGIN_INVARIANTS.md before renaming or removing any.
      // =============================================================

      window.save = save;
      window.createCard = createCard;
      window.updateCard = updateCard;
      window.deleteCard = deleteCard;
      window.cloneCard = cloneCard;
      window.getTags = getTags;
      window.addTag = addTag;
      window.removeTag = removeTag;
      window.setTags = setTags;
      window.getAllTags = getAllTags;
      window.showToast = showToast;

      // =============================================================
      // --- APPLICATION BOOT ---
      // Initialize and start the application
      // =============================================================

      (async function() {
        initToast();                       // Initialize toast container
        initModalA11yObserver();           // Dialog a11y contract for dynamic overlays (CS-008)

        // Check for safe mode URL parameter before any plugin work
        const urlParams = new URLSearchParams(window.location.search);
        let safeMode = urlParams.has('safemode');

        if (safeMode) {
          console.warn('[Safe Mode] Plugins disabled via ?safemode parameter');
          showToast('Safe Mode Active - Plugins Disabled', 'warning');
        }

        // Load data from the active storage driver. A rejection here (e.g.
        // a PIN-decrypt failure on an encrypted dataset) must NOT abort boot,
        // or the app would render nothing and offer no recovery UI. Keep the
        // last-good/default store and continue so the user can still switch
        // datasets or reset. The relevant error toast is shown by load().
        try {
          await load();
        } catch (err) {
          console.error('[Boot] load() failed; continuing with a usable store:', err);
          if (!store || typeof store !== 'object' || !store.cards) {
            setStore(createDefaultStore());
          }
        }
        populateFooter();                // Populate footer with metadata
        updateDatasetSelector();         // Update dataset selector options

        // Apply saved typography preset
        const savedTypography = localStorage.getItem('cardspoke_typography') || 'default';
        document.documentElement.setAttribute('data-typography', savedTypography);

        // Restore installed plugins after load() but before render().
        // (IndexedDB / local-file datasets may replace the store again once
        // their async payload arrives; storage.js re-runs syncFromStore —
        // which is idempotent — when that happens.)
        if (window.CardSpoke && window.CardSpoke.Plugin && window.CardSpoke.Plugin.syncFromStore) {
          await window.CardSpoke.Plugin.syncFromStore(safeMode);
        }

        // Task 2.5: Apply custom components from ComponentRegistry (Header, Sidebar, SearchBar).
        // A custom component's render() is an async RPC call into its sandboxed
        // worker; this is boot-time-only (never a per-frame hot path), so
        // awaiting it here is fine.
        if (typeof applyRegistryComponents === 'function') {
          await applyRegistryComponents();
        }

        render();                        // Initial render
        populateFooter();                // Re-populate footer to ensure it displays

        // First-run detection (v1.0.0) - Show Getting Started guide if no cards exist
        setTimeout(() => {
          const hasSeenGettingStarted = localStorage.getItem('cardspoke_hasSeenGettingStarted');
          const hasCards = Object.keys(store.cards || {}).length > 0;

          if (!hasSeenGettingStarted && !hasCards) {
            showGettingStarted();
          }
        }, 500);

        // Warn user about unsaved changes before leaving
        window.addEventListener('beforeunload', (e) => {
          if (dirty) {
            e.preventDefault();
            e.returnValue = '';
          }
        });
      })();
