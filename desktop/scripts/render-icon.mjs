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
 * Regenerates desktop/build/icon.png (1024x1024) and the Linux icon set
 * desktop/build/icons/<N>x<N>.png from desktop/build/icon.svg
 * (the linked-cards glyph of CardSpoke.svg on a square tile) using the root devDependency Playwright. electron-builder
 * derives the Windows .ico and macOS .icns from icon.png; Linux packages
 * install the size-specific PNGs. Only needed when the logo changes; the
 * PNGs are committed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(desktopDir, '..');
const { chromium } = createRequire(path.join(rootDir, 'package.json'))('playwright');

// Same browser lookup as scripts/browser-qa.mjs (pre-installed Chromium).
const executablePath = process.env.CHROMIUM_PATH ||
  [process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'), '/opt/pw-browsers/chromium']
    .find((p) => p && fs.existsSync(p));

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const svgSource = fs.readFileSync(path.join(desktopDir, 'build', 'icon.svg'), 'utf8');
const browser = await chromium.launch({ executablePath });
fs.mkdirSync(path.join(desktopDir, 'build', 'icons'), { recursive: true });

async function render(size, outFile) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // Inline the SVG (about:blank cannot load file:// images) at the target size.
  const svg = svgSource
    .replace(/<svg\b([^>]*?)\swidth="[^"]*"/, '<svg$1')
    .replace(/<svg\b([^>]*?)\sheight="[^"]*"/, '<svg$1')
    .replace(/<svg\b/, `<svg width="${size}" height="${size}" style="display:block"`);
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: outFile, omitBackground: true });
  await page.close();
}

await render(1024, path.join(desktopDir, 'build', 'icon.png'));
for (const size of SIZES) {
  await render(size, path.join(desktopDir, 'build', 'icons', `${size}x${size}.png`));
}
await browser.close();
console.log('[render-icon] wrote desktop/build/icon.png and desktop/build/icons/*.png');
