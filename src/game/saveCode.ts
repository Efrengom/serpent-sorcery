/**
 * Backup codes: the whole save as one line of text, to copy, paste, send to another device or
 * keep in a file. A code is `SS1:`, then the save and the day it was made as base64url, a dot and
 * a checksum, then `~`. base64url survives messaging apps and smart quotes (which would break raw
 * JSON); the checksum catches a code that was changed, and the `~` one that was cut off.
 */

import { ACHIEVEMENT_IDS } from './achievements';
import { sanitizeSave, SAVE_VERSION, type SaveData } from './persistence';

const PREFIX = 'SS1:';
const END = '~';
/** The code's own format, separate from the save's version. */
const CODE_VERSION = 1;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Why a code couldn't be read: none in the text, cut off, damaged, or from a newer game. */
export type CodeProblem = 'none' | 'cut' | 'bad' | 'newer';
export type Decoded = { ok: true; save: SaveData; made: string } | { ok: false; why: CodeProblem };

/** The local day of a date, as YYYY-MM-DD. */
export function dayOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A YYYY-MM-DD day as "19 Nov 2026" ('' stays ''). */
export function formatDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1]}` : '';
}

/** FNV-1a over the code's body, in base 36. */
function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(body: string): string {
  const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** The save as a backup code, marked with the day it was made. */
export function encodeSave(save: SaveData, made: Date): string {
  const body = toBase64Url(JSON.stringify({ v: CODE_VERSION, made: dayOf(made), save }));
  return `${PREFIX}${body}.${checksum(body)}${END}`;
}

/**
 * Reads a backup code from text: the code may sit inside a message or a file, and may be broken
 * across lines. What it holds is cleaned like a save loaded from storage, field by field.
 */
export function decodeSave(text: string): Decoded {
  const at = text.indexOf(PREFIX);
  if (at < 0) return { ok: false, why: 'none' };
  const rest = text.slice(at + PREFIX.length);
  const end = rest.indexOf(END);
  if (end < 0) return { ok: false, why: 'cut' };
  const whole = rest.slice(0, end).replace(/\s+/g, '');
  const dot = whole.lastIndexOf('.');
  const body = whole.slice(0, dot);
  if (dot < 0 || !/^[A-Za-z0-9_-]+$/.test(body) || checksum(body) !== whole.slice(dot + 1)) return { ok: false, why: 'bad' };
  let env: unknown;
  try {
    env = JSON.parse(fromBase64Url(body));
  } catch {
    return { ok: false, why: 'bad' };
  }
  if (!env || typeof env !== 'object' || Array.isArray(env)) return { ok: false, why: 'bad' };
  const { v, made, save } = env as { v?: unknown; made?: unknown; save?: unknown };
  if (typeof v !== 'number') return { ok: false, why: 'bad' };
  if (v > CODE_VERSION) return { ok: false, why: 'newer' };
  if (!save || typeof save !== 'object' || Array.isArray(save)) return { ok: false, why: 'bad' };
  const s = save as { version?: unknown; records?: unknown };
  if (!s.records || typeof s.records !== 'object') return { ok: false, why: 'bad' };
  if (typeof s.version === 'number' && s.version > SAVE_VERSION) return { ok: false, why: 'newer' };
  return { ok: true, save: sanitizeSave(save), made: typeof made === 'string' && formatDay(made) ? made : '' };
}

/**
 * A backup's progress (shards, upgrades, the Grimoire, records, achievements and the run setup)
 * with this device's options (display, controls, keys and sound) and its own backup history, so
 * a phone's save restored on a desktop doesn't bring the phone's auto-aim and vibration with it.
 */
export function restoreFrom(device: SaveData, backup: SaveData): SaveData {
  const { wizard, curses, heat, startMap } = backup.settings;
  return { ...backup, settings: { ...device.settings, wizard, curses, heat, startMap }, backup: device.backup };
}

export interface SaveSummary {
  shards: number;
  runs: number;
  wins: number;
  achievements: number;
  /** Achievements there are. */
  of: number;
}

/** What a save holds, to compare two before replacing one. */
export function saveSummary(save: SaveData): SaveSummary {
  return { shards: save.currency, runs: save.records.totalRuns, wins: save.records.wins, achievements: save.achievements.length, of: ACHIEVEMENT_IDS.length };
}

/** The summary in words: "1,240 shards, 37 runs, 2 wins, 14 of 20 achievements". */
export function summaryText(s: SaveSummary): string {
  const n = (v: number, one: string, many: string) => `${v.toLocaleString('en-US')} ${v === 1 ? one : many}`;
  return [n(s.shards, 'shard', 'shards'), n(s.runs, 'run', 'runs'), n(s.wins, 'win', 'wins'), `${s.achievements} of ${s.of} achievements`].join(', ');
}

/** A backup file's name and text: a sentence on what it holds and how to use it, then the code. */
export function backupFile(save: SaveData, made: Date): { name: string; text: string } {
  const day = dayOf(made);
  return {
    name: `serpent-sorcery-save-${day}.txt`,
    text: [
      `Serpent Sorcery save, backed up ${formatDay(day)}: ${summaryText(saveSummary(save))}.`,
      'To restore it, open Options, then Backup & Restore, and choose this file or paste the code below.',
      '',
      encodeSave(save, made),
      '',
    ].join('\n'),
  };
}
