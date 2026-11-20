import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSaveFile, saveDir, SAVE_FILE, writeSaveFile } from '../saveFile';
import { defaultWindowState, readWindowState, writeWindowState } from '../windowState';

const made: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-savefile-'));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the desktop save file', () => {
  it('lives in saves/ inside the data folder', () => {
    expect(saveDir(path.join('data', 'Serpent Sorcery'))).toBe(path.join('data', 'Serpent Sorcery', 'saves'));
  });

  it('reads as nothing when there is no save yet', () => {
    expect(readSaveFile(path.join(tempDir(), 'saves'))).toBeNull();
  });

  it('reads back what was written, making the folder on the way', () => {
    const dir = path.join(tempDir(), 'saves');
    expect(writeSaveFile(dir, '{"currency":5}')).toBe(true);
    expect(readSaveFile(dir)).toBe('{"currency":5}');
  });

  it('keeps the save it replaces as save.json.bak, and leaves no temporary file', () => {
    const dir = tempDir();
    writeSaveFile(dir, '{"currency":1}');
    writeSaveFile(dir, '{"currency":2}');
    expect(fs.readFileSync(path.join(dir, `${SAVE_FILE}.bak`), 'utf8')).toBe('{"currency":1}');
    expect(fs.readdirSync(dir).sort()).toEqual([SAVE_FILE, `${SAVE_FILE}.bak`]);
  });

  it('falls back to the backup when the save is damaged', () => {
    const dir = tempDir();
    writeSaveFile(dir, '{"currency":1}');
    writeSaveFile(dir, '{"currency":2}');
    fs.writeFileSync(path.join(dir, SAVE_FILE), '{"currency":2');
    expect(readSaveFile(dir)).toBe('{"currency":1}');
  });

  it('doesn’t copy a damaged save over a good backup', () => {
    const dir = tempDir();
    writeSaveFile(dir, '{"currency":1}');
    writeSaveFile(dir, '{"currency":2}');
    fs.writeFileSync(path.join(dir, SAVE_FILE), 'garbage');
    expect(writeSaveFile(dir, '{"currency":3}')).toBe(true);
    expect(readSaveFile(dir)).toBe('{"currency":3}');
    expect(fs.readFileSync(path.join(dir, `${SAVE_FILE}.bak`), 'utf8')).toBe('{"currency":1}');
  });

  it('reports a write that fails', () => {
    // A file where the folder should be.
    const blocker = path.join(tempDir(), 'saves');
    fs.writeFileSync(blocker, '');
    expect(writeSaveFile(blocker, '{}')).toBe(false);
  });
});

describe('the window as it was left', () => {
  it('opens fullscreen the first time', () => {
    expect(readWindowState(tempDir())).toEqual(defaultWindowState());
    expect(defaultWindowState().fullscreen).toBe(true);
  });

  it('remembers windowed, with its size and place', () => {
    const dir = tempDir();
    writeWindowState(dir, { fullscreen: false, bounds: { x: 40, y: 30, width: 1280, height: 720 }, maximized: false });
    expect(readWindowState(dir)).toEqual({ fullscreen: false, bounds: { x: 40, y: 30, width: 1280, height: 720 }, maximized: false });
  });

  it('ignores a garbled file or nonsense sizes', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'window.json'), '{"fullscreen":false,"bounds":{"x":0,"y":0,"width":-5,"height":"big"}}');
    expect(readWindowState(dir)).toEqual({ fullscreen: false, bounds: null, maximized: false });
    fs.writeFileSync(path.join(dir, 'window.json'), 'nope');
    expect(readWindowState(dir)).toEqual(defaultWindowState());
  });
});
