/**
 * The desktop save: one JSON file, `saves/save.json` in the program's data folder (on Windows,
 * `%APPDATA%\Serpent Sorcery\saves`), which Steam Cloud syncs (Auto-Cloud, see docs/steam.md).
 *
 * A write goes to a temporary file first and is then renamed over the save, so a crash or a power
 * cut mid-write never leaves half a save. The save it replaces is kept as `save.json.bak`, and a
 * save that won't parse gives way to it.
 */

import fs from 'node:fs';
import path from 'node:path';

export const SAVE_FILE = 'save.json';
const BACKUP = `${SAVE_FILE}.bak`;
const TEMP = `${SAVE_FILE}.tmp`;

/** The folder the save lives in, inside the program's data folder. */
export function saveDir(userData: string): string {
  return path.join(userData, 'saves');
}

function readJson(file: string): string | null {
  try {
    const text = fs.readFileSync(file, 'utf8');
    JSON.parse(text);
    return text;
  } catch {
    return null;
  }
}

/** The save's text, or null when there is none. A damaged save gives way to the one before it. */
export function readSaveFile(dir: string): string | null {
  return readJson(path.join(dir, SAVE_FILE)) ?? readJson(path.join(dir, BACKUP));
}

/** Writes the save; whether it worked. */
export function writeSaveFile(dir: string, text: string): boolean {
  const file = path.join(dir, SAVE_FILE);
  const temp = path.join(dir, TEMP);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(temp, 'w');
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // The save being replaced becomes the backup, unless it's damaged: then the backup is better.
    if (readJson(file) !== null) fs.copyFileSync(file, path.join(dir, BACKUP));
    try {
      fs.renameSync(temp, file);
    } catch {
      // Windows refuses a rename while something (a virus scanner, Steam syncing) has the save
      // open; copying over it still works.
      fs.copyFileSync(temp, file);
      fs.rmSync(temp, { force: true });
    }
    return true;
  } catch {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Nothing to tidy.
    }
    return false;
  }
}
