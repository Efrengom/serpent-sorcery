/**
 * The bridge between the game and the program: `window.serpentDesktop` (its shape is
 * `DesktopBridge` in src/desktop.ts). It runs sandboxed, before the page's own scripts, so the
 * save is there when the game first loads it.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../src/desktop';

interface Start {
  save: string | null;
  fullscreen: boolean;
  cloud: boolean;
}

const start = (ipcRenderer.sendSync('desktop:start') as Start | null) ?? { save: null, fullscreen: false, cloud: false };
let save = start.save;
/** The last write didn't reach the file. */
let failed = false;
let fullscreen = start.fullscreen;
const watchers = new Set<(on: boolean) => void>();

ipcRenderer.on('save:result', (_e, ok: boolean) => {
  failed = !ok;
});
ipcRenderer.on('fullscreen:changed', (_e, on: boolean) => {
  fullscreen = on;
  for (const f of watchers) f(on);
});

const bridge: DesktopBridge = {
  // The store holds the save and nothing else, so the key isn't needed.
  store: {
    getItem: () => save,
    setItem(_key, value) {
      save = value;
      ipcRenderer.send('save:write', value);
      if (failed) throw new Error('The last save didn’t reach the file.');
    },
  },
  fullscreen: {
    get: () => fullscreen,
    set: (on) => ipcRenderer.send('fullscreen:set', on),
    onChange(f) {
      watchers.add(f);
      return () => {
        watchers.delete(f);
      };
    },
  },
  steam: {
    unlock: (ids) => ipcRenderer.send('steam:unlock', [...ids]),
    cloud: start.cloud,
  },
  quit: () => ipcRenderer.send('quit'),
};

contextBridge.exposeInMainWorld('serpentDesktop', bridge);
