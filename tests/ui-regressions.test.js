import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync } from 'fs';

const rendering = readFileSync('./www/src/rendering.js', 'utf8');
const systems = readFileSync('./www/src/systems.js', 'utf8');
const metadata = readFileSync('./www/src/metadata.js', 'utf8');
const data = readFileSync('./www/src/data.js', 'utf8');
const storage = readFileSync('./www/src/storage.js', 'utf8');
const styles = readFileSync('./www/styles.css', 'utf8');

test('add child opens create flow with child-specific title', () => {
  assert.ok(
    rendering.includes("goTo('edit', { parentId: card.id });"),
    'Add Child should open the create-child flow'
  );
  assert.ok(
    rendering.includes("navState.parentId ? 'Add Child Card' : 'New Card'"),
    'Child creation should use an Add Child Card title'
  );
});

test('advanced search modal submits from Enter', () => {
  assert.ok(
    systems.includes("const modalBody = h('form', { className: 'modal-body' });"),
    'Advanced search should use a form body'
  );
  assert.ok(
    systems.includes("type: 'submit'"),
    'Advanced search should expose a submit button'
  );
});

test('app source uses in-app dialogs instead of native confirm/prompt', () => {
  assert.ok(metadata.includes('function showConfirmDialog('), 'Confirm dialog helper should exist');
  assert.ok(metadata.includes('function showPromptDialog('), 'Prompt dialog helper should exist');
  const appSources = rendering + systems + data + storage;
  assert.not.ok(/\bconfirm\(/.test(appSources), 'App sources should not use native confirm()');
  assert.not.ok(/\bprompt\(/.test(appSources), 'App sources should not use native prompt()');
});

test('long titles and breadcrumbs wrap instead of overflowing', () => {
  assert.ok(styles.includes('overflow-wrap: anywhere;'), 'Styles should allow long text to wrap anywhere');
  assert.ok(styles.includes('word-break: break-word;'), 'Styles should break long words when needed');
});

test('new-card creation persists tags entered before first save (QA FUNC-1)', () => {
  const createBranch = rendering.slice(
    rendering.indexOf('const newId = createCard(titleVal, bodyVal, parentVal, true, true);')
  );
  assert.ok(
    createBranch.includes('updateCard(newId, { tags: tagsVal, isRichText: richToggle.checked }, true, true);'),
    'The non-editing save branch must apply the tag editor value to the new card'
  );
});

test('search results keep keyboard navigation honest (QA UX-1)', () => {
  const renderSearch = rendering.slice(rendering.indexOf('function renderSearchResults()'));
  assert.ok(
    renderSearch.slice(0, 600).includes("searchContainer.style.display = 'block';"),
    'Search results page must keep the search input visible'
  );
  assert.ok(
    rendering.includes("document.addEventListener('keydown'"),
    'Arrow/Enter must be handled at the document level on the results page'
  );
  assert.ok(
    rendering.includes('openSelectedSearchResult();'),
    'Enter must open the selected result'
  );
});

test('edit form controls have programmatic labels (QA A11Y-2)', () => {
  assert.ok(
    rendering.includes("h('label', { className: 'form-label', for: 'cardTitle' }, 'Title')"),
    'Title label must reference the title input'
  );
  assert.ok(
    rendering.includes("h('label', { className: 'form-label', for: 'cardParent' }, 'Parent Card')"),
    'Parent label must reference the parent select'
  );
  assert.ok(
    rendering.includes("'aria-label': 'Child card title'"),
    'Existing child inputs must carry an accessible name'
  );
  assert.ok(
    rendering.includes("'aria-label': 'New child card title'"),
    'New child inputs must carry an accessible name'
  );
});

test('menu and Plugin Manager overlays expose dialog semantics (QA A11Y-3)', () => {
  const index = readFileSync('./www/index.html', 'utf8');
  assert.ok(
    /class="menu-panel" role="dialog" aria-modal="true" aria-labelledby="menuTitle"/.test(index),
    'Menu panel must be exposed as a modal dialog'
  );
  assert.ok(
    data.includes("'aria-labelledby': 'pluginManagerTitle'"),
    'Plugin Manager modal must be labelled by its title'
  );
  assert.ok(
    data.includes("'aria-label': 'Close Plugin Manager'"),
    'Plugin Manager close button must have an accessible name'
  );
});

test('every menu close path releases the focus trap (QA A11Y-4)', () => {
  assert.ok(
    rendering.includes('function closeMenuOverlay()'),
    'A single close helper must exist'
  );
  const rawCloses = (rendering.match(/menu\.overlay\.classList\.remove\('show'\)/g) || []).length;
  assert.is(rawCloses, 1, 'Only closeMenuOverlay() itself may remove the show class');
  assert.ok(
    systems.includes('closeMenuOverlay();'),
    'The Escape close path in systems.js must delegate to closeMenuOverlay()'
  );
});

test('active tab styling uses the WCAG-AA accent token (QA A11Y-5)', () => {
  assert.ok(data.includes('var(--accent-strong, #1d4ed8)'), 'Tabs must use the accessible accent');
  assert.ok(styles.includes('--accent-strong: #1d4ed8;'), 'Light theme accent token must exist');
  assert.ok(styles.includes('--accent-strong: #60a5fa;'), 'Dark theme accent token must exist');
});

test('index.html ships a hardened CSP without cloud endpoints (QA SEC-1)', () => {
  const index = readFileSync('./www/index.html', 'utf8');
  assert.ok(index.includes("connect-src 'self' https://raw.githubusercontent.com;"),
    'connect-src must be limited to self plus the curated plugin gallery');
  assert.not.ok(index.includes('connect-src') && /connect-src[^;]*\*/.test(index),
    'connect-src must not include a wildcard');
  assert.ok(index.includes("frame-src 'none';"), 'frames are not used and must be blocked');
});

test('index.html div tags are balanced (QA HTML-1)', () => {
  const index = readFileSync('./www/index.html', 'utf8');
  const opens = (index.match(/<div\b/g) || []).length;
  const closes = (index.match(/<\/div>/g) || []).length;
  assert.is(opens, closes, 'Opening and closing div counts must match');
});

test('fuzzy search requires stronger approximate matches', () => {
  assert.ok(
    metadata.includes('const MULTI_TERM_APPROX_THRESHOLD = 62;'),
    'Approximate fuzzy thresholds should be explicit constants'
  );
  assert.ok(
    metadata.includes('queryTerms.length > 1 && !queryTerms.some(term => textLower.includes(term))'),
    'Multi-term fuzzy search should require some term overlap'
  );
  assert.ok(
    metadata.includes('approximate: !hasDirectMatch'),
    'Approximate results should be explicitly labeled'
  );
});

test('focus outlines appear instantly instead of animating with transition: all', () => {
  // `transition: all` would animate the focus outline in from 0px, leaving
  // keyboard users without a visible ring for the first frames after Tab.
  const transitions = styles.match(/transition:\s*all\b[^;]*;/g) || [];
  assert.ok(transitions.length > 0, 'Expected app controls to use transition: all');
  for (const rule of transitions) {
    assert.ok(
      /\boutline 0s\b/.test(rule) && /\boutline-offset 0s\b/.test(rule),
      `"${rule}" must exempt outline and outline-offset (append ", outline 0s, outline-offset 0s")`
    );
  }
});

test.run();
