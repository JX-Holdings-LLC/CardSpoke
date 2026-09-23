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
 * Builds the web app (root `npm run build`) and copies the production site
 * from dist/ into desktop/web/, which electron-builder packages. Also keeps
 * desktop/package.json's version in lockstep with the root package.json so
 * installers are always labelled with the app version.
 *
 *   node scripts/prepare-web.mjs            # build + copy
 *   node scripts/prepare-web.mjs --no-build # copy an existing dist/
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(desktopDir, '..');
const distDir = path.join(rootDir, 'dist');
const webDir = path.join(desktopDir, 'web');

// Development/diagnostic pages and source maps are not shipped in installers.
const EXCLUDE = new Set(['test.html', 'diagnostic.html']);
const shouldCopy = (name) => !EXCLUDE.has(name) && !name.endsWith('.map');

if (!process.argv.includes('--no-build')) {
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
}

if (!fs.existsSync(path.join(distDir, 'index.html')) || !fs.existsSync(path.join(distDir, 'app.js'))) {
  console.error('[prepare-web] dist/ is missing index.html or app.js — run `npm run build` in the repo root.');
  process.exit(1);
}

fs.rmSync(webDir, { recursive: true, force: true });
fs.mkdirSync(webDir, { recursive: true });
let copied = 0;
for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
  if (!entry.isFile() || !shouldCopy(entry.name)) continue;
  fs.copyFileSync(path.join(distDir, entry.name), path.join(webDir, entry.name));
  copied++;
}

// Sync the desktop package (and lockfile) version with the app version.
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
for (const file of ['package.json', 'package-lock.json']) {
  const filePath = path.join(desktopDir, file);
  if (!fs.existsSync(filePath)) continue;
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let changed = json.version !== rootPkg.version;
  json.version = rootPkg.version;
  if (json.packages && json.packages[''] && json.packages[''].version !== rootPkg.version) {
    json.packages[''].version = rootPkg.version;
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
    console.log(`[prepare-web] desktop/${file} version set to ${rootPkg.version}`);
  }
}

console.log(`[prepare-web] copied ${copied} files into desktop/web/`);
