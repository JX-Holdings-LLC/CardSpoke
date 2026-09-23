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
 * Application entry point loader.
 * Loads the bundled app.js. If the bundle is missing or throws before the app
 * has booted, shows a plain boot-error message instead of a blank page.
 *
 * (Earlier versions fell back to the ESM entry src/main.js. That fallback
 * could never succeed in a browser: the app-layer sources rely on the fused
 * single-scope build and on @core/ import aliases, so it only buried the
 * original error under a second one.)
 *
 * This is an external script file so it can be served under the 'self' CSP
 * source without requiring 'unsafe-inline'.
 */
(function() {
  var shown = false;
  var firstError = null;

  function showBootError(detail) {
    if (shown) return;
    shown = true;
    var main = document.getElementById('main') || document.body;
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.className = 'boot-error';
    box.style.cssText = 'max-width:40rem;margin:3rem auto;padding:1.5rem;border:1px solid currentColor;border-radius:8px;';
    var title = document.createElement('h2');
    title.textContent = 'CardSpoke could not start';
    var text = document.createElement('p');
    text.textContent = 'Your cards are still stored on this device. Try reloading the page. ' +
      'If you are running from source, run "npm run build" to generate app.js.';
    box.appendChild(title);
    box.appendChild(text);
    if (detail) {
      var pre = document.createElement('pre');
      pre.style.cssText = 'white-space:pre-wrap;font-size:0.85em;opacity:0.8;';
      pre.textContent = String(detail);
      box.appendChild(pre);
    }
    main.appendChild(box);
  }

  // Record the first uncaught error raised by the bundle while it executes;
  // the script's onerror event only fires for network failures (404).
  function onBundleError(event) {
    if (!firstError && event && /(^|\/)app\.js(\?|#|$)/.test(event.filename || '')) {
      firstError = event.message || 'Unknown error';
    }
  }
  window.addEventListener('error', onBundleError);

  var bundle = document.createElement('script');
  bundle.src = './app.js';
  bundle.defer = true;
  bundle.onload = function() {
    window.removeEventListener('error', onBundleError);
    // A non-fatal error during boot is only logged; the page is replaced
    // with a message only when the app state never came up.
    if (firstError && typeof window.store === 'undefined') {
      console.error('[app-loader] CardSpoke failed to boot:', firstError);
      showBootError(firstError);
    }
  };
  bundle.onerror = function() {
    window.removeEventListener('error', onBundleError);
    console.error('[app-loader] Could not load app.js');
    showBootError('app.js could not be loaded.');
  };
  document.body.appendChild(bundle);
})();
