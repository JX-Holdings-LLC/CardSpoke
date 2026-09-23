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
 * URL and path policy for the desktop shell. Kept free of Electron imports
 * so it can be unit-tested with plain Node (see desktop/test/).
 */

'use strict';

const path = require('node:path');

const APP_SCHEME = 'cardspoke';
const APP_HOST = 'app';
const APP_ORIGIN = APP_SCHEME + '://' + APP_HOST;

// Files that exist in www/ for development only and are never served.
const BLOCKED_FILES = new Set(['test.html']);

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** True for URLs that belong to the bundled app itself. */
function isAppUrl(url) {
  const u = parse(url);
  return !!u && u.protocol === APP_SCHEME + ':' && u.host === APP_HOST;
}

/** True for links that may be handed to the OS browser / mail client. */
function isExternalUrl(url) {
  const u = parse(url);
  return !!u && (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:');
}

/**
 * Map an app URL to a file inside webRoot. Returns null for anything that
 * is not an app URL, escapes webRoot, is blocked, or does not exist as a
 * regular file.
 */
function resolveAssetPath(webRoot, url, fsImpl = require('node:fs')) {
  if (!isAppUrl(url)) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const root = path.resolve(webRoot);
  const resolved = path.resolve(root, '.' + pathname);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  if (BLOCKED_FILES.has(path.relative(root, resolved))) return null;

  try {
    if (!fsImpl.statSync(resolved).isFile()) return null;
  } catch {
    return null;
  }
  return resolved;
}

module.exports = { APP_SCHEME, APP_HOST, APP_ORIGIN, isAppUrl, isExternalUrl, resolveAssetPath };
