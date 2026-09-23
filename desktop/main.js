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
 * CardSpoke desktop shell (Electron main process).
 *
 * The desktop app is a thin, locked-down window around the same web bundle
 * that ships in www/. Assets are served from a privileged custom scheme
 * (cardspoke://app/) instead of file:// so that:
 *   - the app has a stable, dedicated origin, which keeps localStorage and
 *     IndexedDB data isolated and persistent across launches and updates;
 *   - the page's CSP ('self') and the plugin Worker sandbox behave exactly
 *     as they do on the web build;
 *   - no path outside the bundled web directory can ever be read.
 *
 * The renderer has no Node.js access (contextIsolation + sandbox), cannot
 * navigate away from the app origin, and cannot open new windows; external
 * http(s)/mailto links are handed to the operating system instead.
 */

'use strict';

const { app, BrowserWindow, Menu, dialog, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolveAssetPath, isAppUrl, isExternalUrl, APP_SCHEME, APP_ORIGIN } = require('./lib/url-policy');
const { loadWindowState, trackWindowState } = require('./lib/window-state');

const REPO_URL = 'https://github.com/JX-Holdings-LLC/CardSpoke';
const isDev = !app.isPackaged;

// Web assets: bundled next to main.js in packaged builds (see
// scripts/prepare-web.mjs), or read straight from the repo's www/ in dev.
const WEB_ROOT = fs.existsSync(path.join(__dirname, 'web', 'index.html'))
  ? path.join(__dirname, 'web')
  : path.join(__dirname, '..', 'www');

// Must run before the app is ready. `standard` + `secure` give the scheme a
// real origin (storage, Workers, fetch) and a secure context.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true
    }
  }
]);

// One running instance per user profile: two windows writing the same
// localStorage would race each other.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    lockDownSession(session.defaultSession);
    Menu.setApplicationMenu(buildMenu());
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// On Linux, Chromium fetches Hunspell dictionaries from Google as soon as a
// session starts. A local-first app must not phone out unasked, so point the
// downloader at the app's own origin (which has no dictionaries) and turn
// the spellchecker off. macOS/Windows use the OS spellchecker instead.
app.on('session-created', (ses) => {
  if (process.platform !== 'linux') return;
  ses.setSpellCheckerDictionaryDownloadURL(APP_ORIGIN + '/dictionaries/');
  ses.setSpellCheckerEnabled(false);
});

// Defence in depth for every web contents the app ever creates.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isExternalUrl(url)) shell.openExternal(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, (request) => {
    const filePath = resolveAssetPath(WEB_ROOT, request.url);
    if (!filePath) {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function lockDownSession(ses) {
  // CardSpoke needs no camera, microphone, geolocation, notifications, etc.
  // Clipboard writes (card "copy as markdown/JSON") are the one exception.
  const allowed = new Set(['clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(allowed.has(permission) && isAppUrl(details.requestingUrl || webContents.getURL()));
  });
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return allowed.has(permission) && requestingOrigin === APP_ORIGIN;
  });
}

function createWindow() {
  const state = loadWindowState(app.getPath('userData'));
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'CardSpoke',
    backgroundColor: '#111111',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Off on Linux: see the 'session-created' handler.
      spellcheck: process.platform !== 'linux',
      devTools: isDev || process.env.CARDSPOKE_DEVTOOLS === '1'
    }
  });

  if (state.isMaximized) win.maximize();
  trackWindowState(win, app.getPath('userData'));

  win.once('ready-to-show', () => win.show());

  // The web app sets a beforeunload guard while a save is pending. Browsers
  // show their own prompt for that; Electron silently cancels the close, so
  // ask the user explicitly instead of leaving the window unclosable.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep Editing', 'Close Anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'Unsaved changes',
      message: 'CardSpoke is still saving your latest changes.',
      detail: 'Closing now may lose the most recent edit.'
    });
    if (choice === 1) event.preventDefault();
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'error',
      buttons: ['Reload', 'Quit'],
      defaultId: 0,
      title: 'CardSpoke stopped unexpectedly',
      message: 'The CardSpoke window stopped responding (' + details.reason + ').',
      detail: 'Your saved cards are kept in local storage. Reload to continue.'
    });
    if (choice === 0) win.reload();
    else app.quit();
  });

  win.loadURL(APP_ORIGIN + '/index.html');
  return win;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'CardSpoke on GitHub', click: () => shell.openExternal(REPO_URL) },
        { label: 'Report an Issue', click: () => shell.openExternal(REPO_URL + '/issues') },
        ...(isMac ? [] : [
          { type: 'separator' },
          {
            label: 'About CardSpoke',
            click: () => dialog.showMessageBox({
              type: 'info',
              title: 'About CardSpoke',
              message: 'CardSpoke ' + app.getVersion(),
              detail: 'A lightweight, local-first card-based knowledge app.\n' +
                'Created by Jeffrey Guntly · Maintained by JX Holdings, LLC\n' +
                'Licensed under the Apache License 2.0.'
            })
          }
        ])
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}
