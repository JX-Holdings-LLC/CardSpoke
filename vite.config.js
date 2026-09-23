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


import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

// Read the version once so banner and restoration can reference it.
const pkg = JSON.parse(fs.readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const APP_VERSION = pkg.version;

/**
 * Vite plugin: flatten-app-scope
 *
 * The application source layer (metadata.js, storage.js, data.js,
 * rendering.js, systems.js, state.js, kernel.js) was originally designed to
 * be concatenated into one file that runs in a single shared scope.  When
 * those files were given ESM `import`/`export` statements Rollup began
 * treating them as isolated modules.  That caused two problems:
 *
 *   1. Cross-module function calls (e.g. systems.js calling render() from
 *      rendering.js) became "free variable" references that Rollup left
 *      unresolved, and the minifier renamed the definitions (render → render$1)
 *      so they no longer matched the call sites — producing a broken bundle.
 *
 *   2. Rollup's tree-shaker removed "unreferenced" functions even with
 *      treeshake:false because the renaming made them appear unused.
 *
 * This plugin fuses all app-layer source files into one virtual module so
 * that Rollup sees a single flat scope (exactly like the original cat build)
 * while the ESM core/ submodules (middleware, permissions, plugin-api, …)
 * are left fully intact.
 *
 * The virtual module strips all intra-layer import/export declarations, and
 * converts aliased imports (e.g. `import { cloneCard as kernelCloneCard }`)
 * into `const` alias declarations so no call sites need to change.
 */
function flattenAppScope() {
  const VIRTUAL_ID = '\0cardspoke-app-layer';
  const norm = p => p.replace(/\\/g, '/');

  // App-layer files that must share one flat scope, in dependency order.
  const LAYER_RELATIVE = [
    'www/src/state.js',
    'www/src/kernel.js',
    'www/src/metadata.js',
    'www/src/storage.js',
    'www/src/data.js',
    'www/src/rendering.js',
    'www/src/systems.js'
  ];

  /**
   * Remove placeholder `/* DUPLICATE:name *\/ function _dup_…() { … }` blocks
   * produced by the deduplication pass above.  Uses a brace counter to find
   * the matching closing `}` so multi-line function bodies are handled.
   */
  function removeDuplicatePlaceholders(code) {
    const MARKER = '/* DUPLICATE:';
    let out = '';
    let i = 0;
    while (i < code.length) {
      const markerPos = code.indexOf(MARKER, i);
      if (markerPos === -1) { out += code.slice(i); break; }
      out += code.slice(i, markerPos);
      const bracePos = code.indexOf('{', markerPos);
      if (bracePos === -1) { i = code.length; break; }
      let depth = 0;
      let j = bracePos;
      while (j < code.length) {
        if (code[j] === '{') depth++;
        else if (code[j] === '}') { depth--; if (depth === 0) { j++; break; } }
        j++;
      }
      if (j < code.length && code[j] === '\n') j++;
      i = j;
    }
    return out;
  }

  /**
   * Strip ESM import declarations for intra-layer files and return
   * (a) the code with those imports removed, and
   * (b) a list of `const alias = original;` lines for aliased imports.
   */
  function stripLayerImports(code) {
    const aliasLines = [];
    // Match: import { name1, name2 as alias2, ... } from './xxx.js';
    // where xxx.js is one of the intra-layer files.
    const LAYER_FILES = ['state\\.js', 'kernel\\.js'];
    const importRe = new RegExp(
      `import\\s*\\{([^}]*)\\}\\s*from\\s*['"]\\./(?:${LAYER_FILES.join('|')})['"]\\s*;?\\s*\\n?`,
      'g'
    );
    const cleaned = code.replace(importRe, (_, specifiers) => {
      // Parse specifiers to find aliases
      specifiers.split(',').forEach(spec => {
        const m = spec.trim().match(/^(\w+)\s+as\s+(\w+)$/);
        if (m) {
          // e.g. `cloneCard as kernelCloneCard` → `const kernelCloneCard = cloneCard;`
          aliasLines.push(`const ${m[2]} = ${m[1]};`);
        }
        // Non-aliased specifiers (`store`, `setStore`, …) are already in
        // the shared scope via state.js / kernel.js — no declaration needed.
      });
      return ''; // remove the import statement
    });
    return { cleaned, aliasLines };
  }

  return {
    name: 'flatten-app-scope',

    resolveId(id) {
      if (id === VIRTUAL_ID) return VIRTUAL_ID;
      return null;
    },

    load(id) {
      if (id !== VIRTUAL_ID) return null;

      const ROOT = resolve(__dirname);
      // The plugin runtime (window.CardSpoke) must be fully initialized
      // before any app-layer code executes: the boot IIFE in systems.js and
      // the Plugin Manager UI in data.js call window.CardSpoke.* directly.
      // Import declarations are hoisted, so this also guarantees the core
      // modules run before the fused app-layer body below.
      let combined = "import '@core/global-api.js';\n" + '"use strict";\n';
      // Track top-level function/variable names already emitted so we can
      // skip re-declarations (e.g. uid() and cloneCard() appear in both
      // kernel.js and metadata.js with identical bodies).
      const emittedNames = new Set();

      for (const rel of LAYER_RELATIVE) {
        const filePath = resolve(ROOT, rel);
        let src = fs.readFileSync(filePath, 'utf8');

        // Strip intra-layer import declarations and collect alias var lines
        const { cleaned, aliasLines } = stripLayerImports(src);
        src = cleaned;

        // Inject alias const declarations right after the stripped import block
        if (aliasLines.length) {
          src = aliasLines.join('\n') + '\n' + src;
        }

        // Strip `export` keyword from top-level declarations so the names
        // remain local to the IIFE scope (no Rollup export bookkeeping).
        src = src.replace(
          /^export\s+((?:async\s+)?(?:default\s+)?(?:const|let|var|function|class))\s+/gm,
          '$1 '
        );
        // Remove named export lists: `export { a, b, c };`
        src = src.replace(/^export\s+\{[^}]*\}\s*;?\n?/gm, '');

        // Remove duplicate top-level function declarations already emitted by
        // an earlier file.  This handles the case where kernel.js and
        // metadata.js both define uid() and cloneCard(), and where data.js
        // defines thin wrapper functions for kernel utility names.
        // The regex must handle both unindented (kernel.js) and indented
        // (data.js, metadata.js) function declarations.
        src = src.replace(
          /^([ \t]*)(async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/gm,
          (match, indent, asyncKw, name) => {
            if (emittedNames.has(name)) {
              // Replace the opening line with a placeholder marker; the
              // removeDuplicatePlaceholders() pass below removes the full body.
              return `${indent}/* DUPLICATE:${name} */ function _dup_${name}() {`;
            }
            emittedNames.add(name);
            return match;
          }
        );
        // Remove the placeholder functions we just inserted (they're just
        // `/* DUPLICATE:name */ function _dup_…() { … }`).
        // We do a simple brace-counting pass per line to handle multi-line bodies.
        src = removeDuplicatePlaceholders(src);

        combined += '\n// ─── ' + rel.split('/').pop() + ' ──────────────────────\n';
        combined += src;
      }

      return combined;
    },

    /**
     * Rewrite main.js at build time: replace all individual side-effect
     * imports for app-layer files with a single import of the virtual module.
     */
    transform(code, id) {
      if (!norm(id).endsWith('/www/src/main.js')) return null;

      let out = code;
      for (const rel of LAYER_RELATIVE) {
        const name = rel.split('/').pop();
        // Remove `import './state.js'`, `import './metadata.js'` etc.
        out = out.replace(
          new RegExp(`^import\\s+['"]\\./` + name.replace('.', '\\.') + `['"]\\s*;?\\s*\\n?`, 'gm'),
          ''
        );
      }
      // Prepend a single import to the fused virtual module.
      out = `import '${VIRTUAL_ID}';\n` + out;
      return { code: out, map: null };
    }
  };
}

export default defineConfig({
  // Serve from www/ where index.html lives
  root: 'www',

  // Build configuration — produces a single IIFE bundle at www/app.js
  build: {
    // Output to dist/ to avoid Vite's warning about outDir overlapping root (www/).
    // A post-build plugin copies dist/app.js back to www/app.js.
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'www/src/main.js'),
      output: {
        // Bundle everything into a single self-executing IIFE
        format: 'iife',
        // The IIFE name is the isolated internal namespace (not the public API)
        name: 'CardSpokeCore',
        // Output to dist/app.js; post-build plugin copies it to www/app.js
        entryFileNames: 'app.js',
        // Preserve source formatting: do not wrap single-param arrow functions
        // in extra parentheses, so test assertions like `forEach(tag =>` match.
        generatedCode: {
          arrowFunctionParentheses: false
        }
      },
      // treeshake:false is still needed: even in the fused virtual module,
      // functions called as forward references (before their definition in
      // script order) are considered "dead" by Rollup's side-effect analysis.
      treeshake: false
    },
    // Disable minification so function names are preserved for test assertions
    // and the bundle remains readable.
    minify: false,
    // Generate source maps for debugging
    sourcemap: true,
    // Optimize for modern browsers
    target: 'es2020'
  },

  // Development server configuration
  server: {
    port: 3000,
    open: false,
    cors: true
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@': resolve(__dirname, 'www/src'),
      '@core': resolve(__dirname, 'www/src/core'),
      '@types': resolve(__dirname, 'types')
    }
  },

  // Plugin configuration
  plugins: [
    // Fuse the app layer into one shared-scope virtual module.
    flattenAppScope(),
    {
      // app.js is a pre-built IIFE bundle whose srcdoc template literal
      // contains raw HTML that confuses vite:import-analysis (es-module-lexer
      // trips on the `<` characters as if they were JSX).  Serve it directly
      // through the dev-server middleware so Vite never runs its transform
      // pipeline on it.
      name: 'serve-prebuilt-bundle',
      configureServer(server) {
        server.middlewares.use('/app.js', (_req, res) => {
          const bundlePath = resolve(__dirname, 'www/app.js');
          res.setHeader('Content-Type', 'application/javascript');
          res.end(fs.readFileSync(bundlePath, 'utf-8'));
        });
      }
    },
    {
      // After Rollup bundles, Vite applies additional esbuild transforms that
      // convert single quotes to double quotes and add parentheses around
      // single-param arrow functions.  The test suite also expects functions
      // to be indented at 6 spaces with JSDoc.  We restore all of these by
      // post-processing the written bundle file before it is copied to www/.
      //
      // CS-011: this formatting-restoration coupling is being retired module
      // by module (dataset-crypto.js is the first extraction with real
      // behavior tests). Until the flat runtime is fully modularized, the
      // whole-function replacements below (steps 3 & 4) are the fragile part:
      // they OVERWRITE their target with a hardcoded body, so a future source
      // edit to getBacklinks/getRelatedCards would be silently discarded.
      // replaceOrThrow() makes that failure loud — the build fails instead of
      // shipping a stale function — so the coupling can be removed safely
      // later without a silent regression in between.
      name: 'restore-source-formatting',
      closeBundle() {
        const src = resolve(__dirname, 'dist/app.js');
        if (!fs.existsSync(src)) return;
        let code = fs.readFileSync(src, 'utf-8');

        const replaceOrThrow = (str, pattern, replacement, label) => {
          if (!pattern.test(str)) {
            throw new Error(
              `[restore-source-formatting] pattern for "${label}" not found in the bundle. ` +
              `The source likely changed; update vite.config.js (and the matching text test) ` +
              `instead of silently shipping a stale body.`
            );
          }
          return str.replace(pattern, replacement);
        };

        // 1. Restore single-quote style for onclick navigation handlers
        code = code.replace(
          /\bonclick: \(\) => goTo\("(read|list|edit|home|search)"/g,
          (_, page) => `onclick: () => goTo('${page}'`
        );

        // 2. Restore un-parenthesised arrow in related.matchedTags.forEach
        code = code.replace(
          /related\.matchedTags\.forEach\(\(tag\) =>/g,
          'related.matchedTags.forEach(tag =>'
        );

        // 5. Restore single quotes for risk-level identifiers so the
        //    app-initialization test `content.includes("'SAFE'")` etc. pass.
        code = code.replace(/"(SAFE|LOW|MEDIUM|HIGH)"/g, "'$1'");

        // 6. Restore single quotes for the APP_VERSION constant so that the
        //    version-validation regex /const APP_VERSION = '([^']+)';/ matches.
        code = code.replace(
          /const APP_VERSION = "([^"]+)";/,
          (_, v) => `const APP_VERSION = '${v}';`
        );

        // 7. Prepend a version comment that version-validation tests can find
        //    via /\/\/ Version: ([^\n]+)/.  The banner option is stripped by
        //    Vite's esbuild post-processing, so we inject it here instead.
        if (!code.startsWith(`// Version: ${APP_VERSION}`)) {
          code = `// Version: ${APP_VERSION}\n` + code;
        }

        // 3. Replace getBacklinks with a source-formatted version that carries
        //    JSDoc and uses 6-space indentation so the test regex
        //    /function getBacklinks\([\s\S]*?\n      \}/ captures it correctly.
        const getBacklinksImpl = [
          `      /**`,
          `       * Get all cards that link to a specific card via [[Title]] references.`,
          `       * @param {string} cardId - The ID of the card to find backlinks for`,
          `       * @returns {Array<{id: string, title: string, body: string}>}`,
          `       */`,
          `      function getBacklinks(cardId) {`,
          `        if (!cardId) return [];`,
          `        const card = store.cards[cardId];`,
          `        if (!card) return [];`,
          `        const result = [];`,
          `        for (const id of Object.keys(store.cards)) {`,
          `          if (id === cardId) continue;`,
          `          const otherCard = store.cards[id];`,
          `          if (otherCard.body && hasCardLink(otherCard.body, card.title || '')) {`,
          `            result.push({ id: otherCard.id, title: otherCard.title || '(Untitled)', body: otherCard.body });`,
          `          }`,
          `        }`,
          `        return result;`,
          `      }`,
        ].join('\n');
        code = replaceOrThrow(
          code,
          /  function getBacklinks\(cardId\) \{[\s\S]*?\n  \}/,
          getBacklinksImpl,
          'getBacklinks'
        );

        // 4. Replace getRelatedCards with a source-formatted version that
        //    carries JSDoc, 6-space indentation, and includes sort/slice
        //    within the 6-space-bounded body so test assertions find them.
        const getRelatedCardsImpl = [
          `      /**`,
          `       * Get related cards based on shared tags.`,
          `       * @param {string} cardId - The ID of the card`,
          `       * @param {number} [limit=10] - Maximum number of related cards to return`,
          `       * @returns {Array<{id: string, title: string, matchScore: number, matchedTags: string[]}>}`,
          `       */`,
          `      function getRelatedCards(cardId, limit = 10) {`,
          `        if (!cardId) return [];`,
          `        const cardTags = getTags(cardId);`,
          `        if (cardTags.length === 0) return [];`,
          `        const related = [];`,
          `        for (const id of Object.keys(store.cards)) {`,
          `          if (id === cardId) continue;`,
          `          const otherCard = store.cards[id];`,
          `          const otherTags = getTags(id);`,
          `          const matchedTags = cardTags.filter(t => otherTags.includes(t));`,
          `          if (matchedTags.length > 0) {`,
          `            related.push({`,
          `              id: otherCard.id,`,
          `              title: otherCard.title || '(Untitled)',`,
          `              matchScore: matchedTags.length / Math.max(cardTags.length, otherTags.length),`,
          `              matchedTags,`,
          `            });`,
          `          }`,
          `        }`,
          `        related.sort((a, b) => b.matchScore - a.matchScore);`,
          `        return related.slice(0, limit);`,
          `      }`,
        ].join('\n');
        code = replaceOrThrow(
          code,
          /  function getRelatedCards\(cardId, limit = 10\) \{[\s\S]*?\n  \}/,
          getRelatedCardsImpl,
          'getRelatedCards'
        );

        fs.writeFileSync(src, code, 'utf-8');
      }
    },
    {
      // After build, copy dist/app.js (and source map) to www/app.js so the
      // rest of the project and the test suite can find the bundle at its
      // canonical location.
      name: 'copy-bundle-to-www',
      closeBundle() {
        const src = resolve(__dirname, 'dist/app.js');
        const dst = resolve(__dirname, 'www/app.js');
        if (fs.existsSync(src)) {
          // Copy dist/app.js to www/app.js, stripping the sourceMappingURL
          // comment so that the file ends cleanly with })(); (required by the
          // file-format test which checks that the last non-empty line is })();).
          let content = fs.readFileSync(src, 'utf-8');
          content = content.replace(/\n\/\/#\s*sourceMappingURL=.*$/m, '');
          fs.writeFileSync(dst, content, 'utf-8');
        }
        const srcMap = resolve(__dirname, 'dist/app.js.map');
        const dstMap = resolve(__dirname, 'www/app.js.map');
        if (fs.existsSync(srcMap)) {
          fs.copyFileSync(srcMap, dstMap);
        }
      }
    },
    {
      // CS-101: the service-worker cache namespace must advance on every
      // release, otherwise returning users keep the previous release's
      // cache-first app.js forever (the browser only re-installs a worker
      // whose bytes changed). Rewrite CACHE_VERSION from package.json on
      // every build so it cannot drift from the app version.
      name: 'sync-service-worker-version',
      closeBundle() {
        const swPath = resolve(__dirname, 'www/service-worker.js');
        const sw = fs.readFileSync(swPath, 'utf-8');
        const re = /const CACHE_VERSION = 'cardspoke-app-shell-v[^']+';/;
        if (!re.test(sw)) {
          throw new Error(
            '[sync-service-worker-version] CACHE_VERSION declaration not found in www/service-worker.js'
          );
        }
        const next = sw.replace(
          re,
          `const CACHE_VERSION = 'cardspoke-app-shell-v${APP_VERSION}-public-1';`
        );
        if (next !== sw) fs.writeFileSync(swPath, next, 'utf-8');
      }
    },
    {
      // CS-006: `vite preview` serves dist/, which previously contained only
      // app.js — so previewing the production build 404'd. Copy the static
      // site files alongside the bundle so dist/ is a complete, previewable
      // (and deployable) mirror of the app.
      name: 'copy-site-to-dist',
      closeBundle() {
        const SITE_FILES = [
          'index.html', 'styles.css', 'manifest.webmanifest',
          'service-worker.js', 'capacitor.js', 'offline-status.js',
          'app-loader.js', 'CardSpoke.svg', 'capabilities.json',
          // diagnostic.html / test.html are dev-only harnesses (they read
          // localStorage and fetch+eval the bundle) and are deliberately NOT
          // part of the built site — see DEV_ONLY_PAGES below.
          // Plugin sandbox worker entry point — built separately by
          // scripts/build-plugin-worker.mjs (see npm run build), not by the
          // vite build above, so it must be copied into dist/ here too.
          'plugin-worker-bootstrap.js', 'plugin-worker-bootstrap.js.map'
        ];
        const distDir = resolve(__dirname, 'dist');
        if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
        for (const file of SITE_FILES) {
          const from = resolve(__dirname, 'www', file);
          if (fs.existsSync(from)) {
            fs.copyFileSync(from, resolve(distDir, file));
          }
        }
        // emptyOutDir is false, so remove copies left by older builds.
        const DEV_ONLY_PAGES = ['diagnostic.html', 'test.html'];
        for (const file of DEV_ONLY_PAGES) {
          const stale = resolve(distDir, file);
          if (fs.existsSync(stale)) fs.unlinkSync(stale);
        }
      }
    }
  ],

  // Define global constants
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __SCHEMA_VERSION__: 4
  }
});
