/**
 * Validated localStorage persistence. Any missing, malformed or out-of-range data
 * falls back to safe defaults field by field rather than discarding the whole save.
 */

import {
  META_IDS,
  computeReward,
  emptyMetaLevels,
  metaMaxLevel,
  metaNextCost,
  type MetaId,
  type MetaLevels,
  type RunSummary,
} from './progression';
import type { RunRecap } from './recap';

export const SAVE_KEY = 'serpent-sorcery-save-v1';
export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  currency: number;
  meta: MetaLevels;
  records: {
    bestTime: number;
    bestKills: number;
    bestLevel: number;
    totalRuns: number;
  };
  settings: {
    muted: boolean;
    volume: number;
    /** Pixel-art style for the arena, HUD and menus. */
    pixelArt: boolean;
    /** Music slider, 0..1 (0 = off). `volume` above is the sound-effects slider. */
    musicVolume: number;
  };
  /** Id of the last run whose reward was banked; guarantees one award per run. */
  lastRunId: string;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    currency: 0,
    meta: emptyMetaLevels(),
    records: { bestTime: 0, bestKills: 0, bestLevel: 0, totalRuns: 0 },
    settings: { muted: false, volume: 0.7, pixelArt: false, musicVolume: 0.55 },
    lastRunId: '',
  };
}

function num(v: unknown, fallback: number, lo: number, hi: number, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const c = Math.min(hi, Math.max(lo, v));
  return integer ? Math.floor(c) : c;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function sanitizeSave(input: unknown): SaveData {
  const d = defaultSave();
  const o = obj(input);
  const meta = obj(o.meta);
  const records = obj(o.records);
  const settings = obj(o.settings);
  const cleanMeta = emptyMetaLevels();
  for (const id of META_IDS) cleanMeta[id] = num(meta[id], 0, 0, metaMaxLevel(id), true);
  return {
    version: SAVE_VERSION,
    currency: num(o.currency, d.currency, 0, 1e9, true),
    meta: cleanMeta,
    records: {
      bestTime: num(records.bestTime, 0, 0, 1e7),
      bestKills: num(records.bestKills, 0, 0, 1e9, true),
      bestLevel: num(records.bestLevel, 0, 0, 1e5, true),
      totalRuns: num(records.totalRuns, 0, 0, 1e9, true),
    },
    settings: {
      muted: typeof settings.muted === 'boolean' ? settings.muted : d.settings.muted,
      volume: num(settings.volume, d.settings.volume, 0, 1),
      pixelArt: typeof settings.pixelArt === 'boolean' ? settings.pixelArt : d.settings.pixelArt,
      // Saves from before the slider stored an on/off flag; "off" becomes a silent slider.
      musicVolume: num(settings.musicVolume, settings.music === false ? 0 : d.settings.musicVolume, 0, 1),
    },
    lastRunId: typeof o.lastRunId === 'string' ? o.lastRunId.slice(0, 64) : '',
  };
}

export function parseSave(raw: string | null | undefined): SaveData {
  if (!raw) return defaultSave();
  try {
    return sanitizeSave(JSON.parse(raw));
  } catch {
    return defaultSave();
  }
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSave(store: StorageLike | null = storage()): SaveData {
  try {
    return parseSave(store?.getItem(SAVE_KEY));
  } catch {
    return defaultSave();
  }
}

export function writeSave(save: SaveData, store: StorageLike | null = storage()): boolean {
  try {
    store?.setItem(SAVE_KEY, JSON.stringify(save));
    return !!store;
  } catch {
    return false;
  }
}

export interface RunResult extends RunSummary {
  runId: string;
  reward: number;
  /** Spell and damage statistics for the game-over screen; not saved. */
  recap?: RunRecap;
}

export interface CommitOutcome {
  save: SaveData;
  awarded: boolean;
  newBestTime: boolean;
}

/** Banks a finished run exactly once (idempotent per runId). */
export function commitRunResult(save: SaveData, run: RunResult): CommitOutcome {
  if (!run.runId || save.lastRunId === run.runId) {
    return { save, awarded: false, newBestTime: false };
  }
  const reward = computeReward(run);
  const newBestTime = run.time > save.records.bestTime;
  return {
    awarded: true,
    newBestTime,
    save: {
      ...save,
      currency: save.currency + reward,
      records: {
        bestTime: Math.max(save.records.bestTime, run.time),
        bestKills: Math.max(save.records.bestKills, run.kills),
        bestLevel: Math.max(save.records.bestLevel, run.level),
        totalRuns: save.records.totalRuns + 1,
      },
      lastRunId: run.runId,
    },
  };
}

export function buyMeta(save: SaveData, id: MetaId): SaveData | null {
  const cost = metaNextCost(id, save.meta[id]);
  if (cost === null || save.currency < cost) return null;
  return { ...save, currency: save.currency - cost, meta: { ...save.meta, [id]: save.meta[id] + 1 } };
}
