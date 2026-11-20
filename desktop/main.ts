/**
 * Serpent Sorcery for the desktop: the web game (the root project's `dist/`) in one Electron
 * window, with its save in a file, fullscreen by default, and Steam's achievements and overlay.
 *
 * The game is served from `app://serpent/`, a scheme of its own, rather than from file://, so the
 * build's absolute paths work and the page counts as secure (the clipboard, for Copy code).
 *
 * For the checks only: SERPENT_USER_DATA points the data folder elsewhere (a test never touches a
 * real save), SERPENT_DEV_URL loads the Vite dev server instead, and SERPENT_STEAM_LOG stands in
 * for Steam (steam.ts).
 */

import { app, BrowserWindow, ipcMain, Menu, net, protocol, screen, session, type IpcMainEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSaveFile, saveDir, writeSaveFile } from './saveFile';
import { startSteam, type Steam } from './steam';
import { readWindowState, writeWindowState, type Bounds } from './windowState';

if (process.env.SERPENT_USER_DATA) app.setPath('userData', path.resolve(process.env.SERPENT_USER_DATA));

const SCHEME = 'app';
const ORIGIN = 'app://serpent';
const DEV_URL = process.env.SERPENT_DEV_URL;
/** The built web game: copied into the program's resources when packaged, the root's dist/ otherwise. */
const WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.resolve(__dirname, '..', '..', 'dist');

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// One copy at a time, so two can't overwrite each other's save: a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Before the app is ready: the overlay needs Chromium's switches set first.
  const steam = startSteam();
  let win: BrowserWindow | null = null;
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(() => {
    serveGame();
    lockDown();
    win = openWindow(steam);
  });
}

/** Serves dist/ at app://serpent/, refusing anything outside it. */
function serveGame(): void {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname);
    const file = path.resolve(WEB, `.${rel === '/' ? '/index.html' : rel}`);
    const inside = file.startsWith(WEB + path.sep);
    if (url.host !== 'serpent' || !inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

/** Only the game's own pages may talk to the program. */
function fromGame(e: IpcMainEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith(`${ORIGIN}/`) || (!!DEV_URL && url.startsWith(DEV_URL));
}

/** No permissions but writing to the clipboard (Copy code). */
function lockDown(): void {
  const allowed = (permission: string) => permission === 'clipboard-sanitized-write';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed(permission));
}

/** Whether a window there would show on a screen now: a monitor may have been unplugged since. */
function onAScreen(b: Bounds): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width - 64 && b.x + b.width > a.x + 64 && b.y >= a.y - 8 && b.y < a.y + a.height - 64);
}

function openWindow(steam: Steam): BrowserWindow {
  const userData = app.getPath('userData');
  const saves = saveDir(userData);
  const state = readWindowState(userData);
  const b = state.bounds;
  // Where it was when last windowed, or centred if that's now off every screen.
  const place = b && onAScreen(b) ? { x: b.x, y: b.y } : {};

  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    title: 'Serpent Sorcery',
    backgroundColor: '#1d0f33',
    show: false,
    width: b?.width ?? 1280,
    height: b?.height ?? 720,
    ...place,
    minWidth: 800,
    minHeight: 450,
    fullscreen: state.fullscreen,
    icon: path.join(WEB, 'icons', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  if (state.maximized && !state.fullscreen) win.maximize();
  win.once('ready-to-show', () => win.show());

  // The window as it's left, for the next launch.
  const remember = () => {
    if (win.isDestroyed()) return;
    state.fullscreen = win.isFullScreen();
    if (!state.fullscreen) {
      state.maximized = win.isMaximized();
      if (!state.maximized && !win.isMinimized()) state.bounds = win.getBounds();
    }
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', () => {
    remember();
    writeWindowState(userData, state);
  });
  const fullscreenChanged = () => {
    remember();
    writeWindowState(userData, state);
    win.webContents.send('fullscreen:changed', win.isFullScreen());
  };
  win.on('enter-full-screen', fullscreenChanged);
  win.on('leave-full-screen', fullscreenChanged);

  const contents = win.webContents;
  contents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    } else if ((input.control || input.meta) && ['+', '=', '-', '_', '0'].includes(input.key)) {
      // No zooming the page.
      event.preventDefault();
    } else if (!app.isPackaged && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      contents.toggleDevTools();
    }
  });
  // Nowhere to go but the game.
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`) && !(DEV_URL && url.startsWith(DEV_URL))) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // The save: read once, then written as the game changes it.
  let saveText = readSaveFile(saves);
  ipcMain.on('desktop:start', (e) => {
    e.returnValue = fromGame(e) ? { save: saveText, fullscreen: win.isFullScreen(), cloud: steam.cloud } : null;
  });
  ipcMain.on('save:write', (e, text: unknown) => {
    if (!fromGame(e) || typeof text !== 'string') return;
    const ok = writeSaveFile(saves, text);
    if (ok) saveText = text;
    e.sender.send('save:result', ok);
  });
  ipcMain.on('fullscreen:set', (e, on: unknown) => {
    if (fromGame(e)) win.setFullScreen(on === true);
  });
  ipcMain.on('steam:unlock', (e, ids: unknown) => {
    if (fromGame(e) && Array.isArray(ids)) steam.unlock(ids.filter((id): id is string => typeof id === 'string'));
  });
  ipcMain.on('quit', (e) => {
    if (fromGame(e)) app.quit();
  });

  void win.loadURL(DEV_URL ?? `${ORIGIN}/index.html`);
  return win;
}
