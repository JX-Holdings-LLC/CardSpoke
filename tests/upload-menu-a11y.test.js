/**
 * Upload modal, header menu and theme-toggle accessibility regressions.
 *
 * Covers: scroll unlock + input reset after upload, keyboard-operable and
 * real drag-and-drop upload areas, theme toggle labelling (#371), upload
 * modal focus management, tab semantics, label association, macOS
 * Option+T shortcut, menu aria-expanded/focus return, and rel on
 * target=_blank links. Browser-level behaviour is exercised end to end in
 * scripts/browser-qa.mjs (scenario "header-menu-upload-a11y").
 */
import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { readFileSync } from 'fs';

const rendering = readFileSync('./www/src/rendering.js', 'utf8');
const systems = readFileSync('./www/src/systems.js', 'utf8');
const data = readFileSync('./www/src/data.js', 'utf8');
const html = readFileSync('./www/index.html', 'utf8');
const styles = readFileSync('./www/styles.css', 'utf8');
const bundle = readFileSync('./www/app.js', 'utf8');

const between = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i !== -1, `missing marker: ${start}`);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j !== -1, `missing marker: ${end}`);
  return src.slice(i, j);
};

test('successful JSON/TXT uploads close via closeUploadModal (unlocks scroll)', () => {
  const jsonHandler = between(rendering, 'function handleJSONUploadFile(file)', 'function handleTXTUploadFile(file)');
  const txtHandler = between(rendering, 'function handleTXTUploadFile(file)', 'function bindUploadArea(');
  assert.ok(jsonHandler.includes('closeUploadModal();'), 'JSON success must use the shared close path');
  assert.ok(txtHandler.includes('closeUploadModal();'), 'TXT success must use the shared close path');
  const close = between(rendering, 'function closeUploadModal()', 'if (menu.upload) menu.upload.onclick');
  assert.ok(close.includes('unlockBodyScroll();'), 'closeUploadModal must unlock body scroll');
  assert.not.ok(
    /uploadModal\.overlay\.classList\.remove\('show'\)/.test(rendering.replace(close, '')),
    'No upload close path may bypass closeUploadModal()'
  );
});

test('file inputs are reset after change so the same file can be re-picked', () => {
  const bind = between(rendering, 'function bindUploadArea(', 'bindUploadArea(uploadModal.fileUploadAreaJSON');
  assert.ok(bind.includes("e.target.value = '';"), 'change handler must clear the input value');
});

test('upload areas are keyboard operable buttons', () => {
  assert.match(html, /id="fileUploadAreaJSON" role="button" tabindex="0"/);
  assert.match(html, /id="fileUploadAreaTXT" role="button" tabindex="0"/);
  const bind = between(rendering, 'function bindUploadArea(', 'bindUploadArea(uploadModal.fileUploadAreaJSON');
  assert.ok(bind.includes("area.addEventListener('keydown'"), 'Enter must activate the drop zone');
  assert.ok(bind.includes("area.addEventListener('keyup'"), 'Space must activate the drop zone on keyup');
  assert.ok(bind.includes("e.key === 'Enter'"), 'Enter handled');
  assert.ok(bind.includes("e.key === ' '"), 'Space handled');
  assert.ok(styles.includes('.file-upload-area:focus-visible'), 'drop zone needs a visible focus style');
});

test('drag and drop is implemented and shares the file-input code path', () => {
  const bind = between(rendering, 'function bindUploadArea(', 'bindUploadArea(uploadModal.fileUploadAreaJSON');
  for (const evt of ['dragover', 'dragleave', 'drop']) {
    assert.ok(bind.includes(`area.addEventListener('${evt}'`), `${evt} handler must exist`);
  }
  assert.ok(bind.includes('handleFile(files[0])'), 'drop must feed the shared handler');
  assert.ok(bind.includes('handleFile(file)'), 'file input change must feed the same handler');
  assert.ok(bind.includes("classList.add('drag-over')"), 'drag-over state must be applied');
  assert.ok(bind.includes("classList.remove('drag-over')"), 'drag-over state must be cleared');
  assert.ok(rendering.includes('bindUploadArea(uploadModal.fileUploadAreaJSON, uploadModal.fileInputJSON, handleJSONUploadFile);'));
  assert.ok(rendering.includes('bindUploadArea(uploadModal.fileUploadAreaTXT, uploadModal.fileInputTXT, handleTXTUploadFile);'));
  assert.ok(styles.includes('.file-upload-area.drag-over'), 'drag-over visual state must be styled');
});

test('theme toggle has an action label, hidden icons and an honest comment (#371)', () => {
  const apply = between(rendering, 'function applyTheme(theme)', 'APP FOOTER');
  assert.not.ok(apply.includes('// Sync header button'), 'misleading comment removed');
  const svgs = apply.match(/<svg[^>]*>/g) || [];
  assert.is(svgs.length, 2, 'sun and moon icons');
  svgs.forEach(svg => assert.ok(svg.includes('aria-hidden="true"'), 'injected SVG must be aria-hidden'));
  assert.ok(apply.includes("'Switch to light mode'") && apply.includes("'Switch to dark mode'"));
  assert.ok(apply.includes("setAttribute('aria-label', themeActionLabel)"));
  assert.ok(apply.includes("setAttribute('title', themeActionLabel + ' (Alt+T)')"));
  assert.ok(systems.includes("'alt+t': { action: () => { header.themeToggle.click(); }"),
    'Alt+T must be the real theme shortcut advertised in the title');
  assert.match(html, /id="themeToggle" title="Switch to dark mode \(Alt\+T\)" aria-label="Switch to dark mode"/);
});

test('upload modal traps focus on open and restores it on close', () => {
  const open = between(rendering, 'function openUploadModal()', 'function closeUploadModal()');
  assert.ok(open.includes('uploadModalOpener ='), 'opener must be remembered');
  assert.ok(open.includes('trapUploadModalFocus(dialog)'), 'focus must be trapped');
  assert.ok(open.includes('activeTab.focus()'), 'focus must move into the dialog');
  const close = between(rendering, 'function closeUploadModal()', 'if (menu.upload) menu.upload.onclick');
  assert.ok(close.includes('uploadModalReleaseFocus()'), 'trap must be released');
  assert.ok(close.includes('opener.focus()'), 'focus must return to the opener');
  // Both open paths go through the helper.
  assert.ok(between(rendering, 'if (menu.upload) menu.upload.onclick', 'if (menu.pluginManager)').includes('openUploadModal();'));
  const forCard = between(data, 'function openUploadModalForCard(', 'function updateImportLocationOptions()');
  assert.ok(forCard.includes('openUploadModal();'), 'openUploadModalForCard must use openUploadModal()');
  assert.ok(forCard.includes('activateUploadTab(tabName);'), 'openUploadModalForCard must use activateUploadTab()');
  // Escape uses the shared close path.
  assert.ok(systems.includes('closeUploadModal();'), 'Escape must use closeUploadModal()');
});

test('upload tabs expose tab semantics and keep aria-selected in sync', () => {
  assert.match(html, /id="tab-btn-json" data-tab="json" role="tab" aria-selected="true" aria-controls="tab-json"/);
  assert.match(html, /id="tab-btn-txt" data-tab="txt" role="tab" aria-selected="false" aria-controls="tab-txt"/);
  assert.match(html, /id="tab-json" role="tabpanel" aria-labelledby="tab-btn-json"/);
  assert.match(html, /id="tab-txt" role="tabpanel" aria-labelledby="tab-btn-txt"/);
  assert.not.ok(/aria-labelledby="tab-(json|txt)"/.test(html), 'panels must not label themselves');
  const activate = between(rendering, 'function activateUploadTab(', '// Focus bookkeeping');
  assert.ok(activate.includes("t.setAttribute('aria-selected', selected ? 'true' : 'false')"));
  assert.ok(activate.includes("t.setAttribute('tabindex', selected ? '0' : '-1')"), 'roving tabindex');
  const clickHandler = between(rendering, 'if (uploadModal.tabs) uploadModal.tabs.forEach(tab => {', 'if (uploadModal.closeBtn)');
  assert.ok(clickHandler.includes('activateUploadTab(tabName)'), 'tab clicks must use activateUploadTab');
  assert.ok(clickHandler.includes("'ArrowRight'") && clickHandler.includes("'ArrowLeft'"), 'arrow keys switch tabs');
});

test('import labels are associated and the mode radios are a fieldset', () => {
  assert.ok(html.includes('<label class="form-label" for="importLocationSelectJSON">Import Location</label>'));
  assert.ok(html.includes('<label class="form-label" for="importLocationSelectTXT">Import Location</label>'));
  assert.match(html, /<fieldset class="form-group form-fieldset">\s*<legend class="form-label">Import Mode<\/legend>/);
  const opens = (html.match(/<fieldset\b/g) || []).length;
  const closes = (html.match(/<\/fieldset>/g) || []).length;
  assert.is(opens, closes, 'fieldset tags must be balanced');
  assert.ok(styles.includes('.form-fieldset {'), 'fieldset UA chrome must be reset');
});

test('Alt/Option shortcuts derive the letter from e.code (macOS Option+T)', () => {
  const snippet = between(systems, '// Build shortcut key string', '// Execute shortcut if it exists');
  // Execute the real key-building snippet against synthetic events.
  // eslint-disable-next-line no-new-func
  const buildKey = new Function('e', snippet + '\nreturn key;');
  assert.is(buildKey({ key: '†', code: 'KeyT', altKey: true }), 'alt+t', 'Option+T on macOS');
  assert.is(buildKey({ key: 'ç', code: 'KeyC', altKey: true }), 'alt+c', 'Option+C on macOS');
  assert.is(buildKey({ key: 't', code: 'KeyT', altKey: true }), 'alt+t', 'Alt+T elsewhere');
  assert.is(buildKey({ key: 'z', code: 'KeyZ', ctrlKey: true }), 'ctrl+z', 'Ctrl shortcuts unchanged');
  assert.is(buildKey({ key: 'Escape', code: 'Escape' }), 'escape', 'plain keys unchanged');
  // A non-QWERTY layout that reports a real letter keeps that letter.
  assert.is(buildKey({ key: 'y', code: 'KeyT', altKey: true }), 'alt+y');
});

test('menu button exposes aria-expanded/aria-controls and close restores focus', () => {
  assert.match(html, /id="menuBtn"[^>]*aria-expanded="false"/);
  assert.match(html, /id="menuBtn"[^>]*aria-controls="menuOverlay"/);
  assert.ok(html.includes('id="menuOverlay"'), 'aria-controls target must exist');
  const close = between(rendering, 'function closeMenuOverlay()', 'if (header.menuBtn && menu.overlay) header.menuBtn.onclick');
  assert.ok(close.includes("header.menuBtn.setAttribute('aria-expanded', 'false')"));
  assert.ok(close.includes('header.menuBtn.focus()'), 'focus returns to the menu button');
  assert.ok(close.includes('if (!wasOpen) return;'), 'closing an already-closed menu must not steal focus');
  const open = between(rendering, 'if (header.menuBtn && menu.overlay) header.menuBtn.onclick', 'if (menu.closeBtn)');
  assert.ok(open.includes("header.menuBtn.setAttribute('aria-expanded', 'true')"));
});

test('target=_blank links in settings/about carry rel="noopener noreferrer"', () => {
  const blanks = systems.match(/target: '_blank'[^}]*/g) || [];
  assert.ok(blanks.length >= 3, 'expected the settings/about links');
  blanks.forEach(b => assert.ok(b.includes("rel: 'noopener noreferrer'"), `missing rel: ${b}`));
  assert.ok(systems.includes("href: 'https://github.com/jxburros/CardSpoke'"), 'URLs unchanged');
});

test('built bundle includes the upload/menu a11y fixes', () => {
  for (const name of ['closeUploadModal', 'openUploadModal', 'activateUploadTab', 'bindUploadArea']) {
    assert.ok(bundle.includes(name), `www/app.js must include ${name} (run npm run build)`);
  }
  assert.ok(bundle.includes('Switch to light mode'), 'bundle must include the theme label');
});

test.run();
