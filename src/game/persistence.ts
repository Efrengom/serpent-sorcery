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
import { CURSE_IDS, type CurseId } from './curses';
import { HEAT } from './config';
import { UNLOCK_IDS, unlockBlocker, unlockDef, type UnlockId } from './grimoire';
import { ACHIEVEMENT_IDS, ACHIEVEMENTS, newAchievements, RENAMED_ACHIEVEMENTS, type AchievementId } from './achievements';
import { BEAST_IDS } from './bestiary';
import { previousDay } from './daily';
import { MAP_ORDER } from './maps';
import type { MapId } from './maps/types';
import { sanitizeBindings, type KeyBindings } from './keys';
import { clampSpeed, defaultOptions, type GameOptions } from './options';
import type { RunRecap } from './recap';
import type { RelicId } from './relics';
import { WIZARD_IDS, type WizardId } from './wizards';

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
    /** Lifetime Archmages defeated (unlocks a wizard). */
    bossKills: number;
    /** Deepest depth ever reached (1 = the first map). */
    deepest: number;
    /** Maps reached at least once, in the order they come in a run (for the atlas). */
    maps: MapId[];
    /** Lifetime urns, reliquaries and the like smashed. */
    breakables: number;
    /** Highest heat unlocked (0 = none yet), and the highest at which the loop was reached (-1 = never). */
    heatUnlocked: number;
    heatCleared: number;
    /** Runs won (the Archmage Ascendant defeated), the fastest win's time, the wizards who have won and the highest heat won at (-1 = none). */
    wins: number;
    fastestWin: number;
    winners: WizardId[];
    wonHeat: number;
    /** Lifetime foes defeated, rifts won and merchant wares bought, and foes defeated by kind (the bestiary). */
    totalKills: number;
    rifts: number;
    bought: number;
    bestiary: Record<string, number>;
    /** The daily run: the day last played, its best score and tries, and the run of days played in a row. */
    dailyDate: string;
    dailyBest: number;
    dailyPlays: number;
    dailyStreak: number;
  };
  /** Achievements earned (D2). */
  achievements: AchievementId[];
  /** Grimoire unlocks bought (M1). */
  grimoire: UnlockId[];
  settings: {
    muted: boolean;
    volume: number;
    /** Music slider, 0..1 (0 = off). `volume` above is the sound-effects slider. */
    musicVolume: number;
    /** Run setup, kept between runs. A locked wizard falls back to the Arcanist at run start. */
    wizard: WizardId;
    curses: CurseId[];
    /** Heat chosen for the next run, and the map it starts on (a waystone's; the first otherwise). */
    heat: number;
    startMap: MapId;
    /** Screen-shake strength, 0 (off) to 1 (full). */
    shake: number;
    reduceFlashing: boolean;
    /** Charge warnings as yellow-and-black hazard stripes instead of red. */
    safeWarnings: boolean;
    minimap: boolean;
    steadyCamera: boolean;
    /** Simulation speed, 0.5 to 1. */
    gameSpeed: number;
    bindings: KeyBindings;
    /** Touch screens: the right thumb steers. */
    steerRight: boolean;
  };
  /** Id of the last run whose reward was banked; guarantees one award per run. */
  lastRunId: string;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    currency: 0,
    meta: emptyMetaLevels(),
    records: {
      bestTime: 0,
      bestKills: 0,
      bestLevel: 0,
      totalRuns: 0,
      bossKills: 0,
      deepest: 1,
      maps: ['ruins'],
      breakables: 0,
      heatUnlocked: 0,
      heatCleared: -1,
      wins: 0,
      fastestWin: 0,
      winners: [],
      wonHeat: -1,
      totalKills: 0,
      rifts: 0,
      bought: 0,
      bestiary: {},
      dailyDate: '',
      dailyBest: 0,
      dailyPlays: 0,
      dailyStreak: 0,
    },
    achievements: [],
    grimoire: [],
    settings: { muted: false, volume: 0.7, musicVolume: 0.55, wizard: 'arcanist', curses: [], heat: 0, startMap: 'ruins', ...defaultOptions() },
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
      bossKills: num(records.bossKills, 0, 0, 1e9, true),
      deepest: num(records.deepest, 1, 1, 1e5, true),
      // The first map is always known; saves from before the atlas start with just it.
      maps: Array.isArray(records.maps) ? MAP_ORDER.filter((id) => id === 'ruins' || (records.maps as unknown[]).includes(id)) : ['ruins'],
      breakables: num(records.breakables, 0, 0, 1e9, true),
      heatUnlocked: num(records.heatUnlocked, 0, 0, HEAT.max, true),
      heatCleared: num(records.heatCleared, -1, -1, HEAT.max, true),
      wins: num(records.wins, 0, 0, 1e9, true),
      fastestWin: num(records.fastestWin, 0, 0, 1e7),
      winners: Array.isArray(records.winners) ? WIZARD_IDS.filter((id) => (records.winners as unknown[]).includes(id)) : [],
      wonHeat: num(records.wonHeat, -1, -1, HEAT.max, true),
      totalKills: num(records.totalKills, 0, 0, 1e12, true),
      rifts: num(records.rifts, 0, 0, 1e9, true),
      bought: num(records.bought, 0, 0, 1e9, true),
      bestiary: Object.fromEntries(
        BEAST_IDS.filter((id) => num(obj(records.bestiary)[id], 0, 0, 1e12, true) > 0).map((id) => [id, num(obj(records.bestiary)[id], 0, 0, 1e12, true)]),
      ),
      dailyDate: typeof records.dailyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(records.dailyDate) ? records.dailyDate : '',
      dailyBest: num(records.dailyBest, 0, 0, 1e9, true),
      dailyPlays: num(records.dailyPlays, 0, 0, 1e6, true),
      dailyStreak: num(records.dailyStreak, 0, 0, 1e5, true),
    },
    achievements: Array.isArray(o.achievements)
      ? ACHIEVEMENT_IDS.filter((id) => (o.achievements as unknown[]).some((v) => v === id || (typeof v === 'string' && RENAMED_ACHIEVEMENTS[v] === id)))
      : [],
    grimoire: Array.isArray(o.grimoire) ? UNLOCK_IDS.filter((id) => (o.grimoire as unknown[]).includes(id)) : [],
    settings: {
      muted: typeof settings.muted === 'boolean' ? settings.muted : d.settings.muted,
      volume: num(settings.volume, d.settings.volume, 0, 1),
      // Saves from before the slider stored an on/off flag; "off" becomes a silent slider.
      musicVolume: num(settings.musicVolume, settings.music === false ? 0 : d.settings.musicVolume, 0, 1),
      wizard: WIZARD_IDS.includes(settings.wizard as WizardId) ? (settings.wizard as WizardId) : d.settings.wizard,
      curses: Array.isArray(settings.curses)
        ? CURSE_IDS.filter((id) => (settings.curses as unknown[]).includes(id))
        : d.settings.curses,
      heat: num(settings.heat, 0, 0, HEAT.max, true),
      startMap: MAP_ORDER.includes(settings.startMap as MapId) ? (settings.startMap as MapId) : d.settings.startMap,
      shake: num(settings.shake, d.settings.shake, 0, 1),
      reduceFlashing: typeof settings.reduceFlashing === 'boolean' ? settings.reduceFlashing : d.settings.reduceFlashing,
      safeWarnings: typeof settings.safeWarnings === 'boolean' ? settings.safeWarnings : d.settings.safeWarnings,
      minimap: typeof settings.minimap === 'boolean' ? settings.minimap : d.settings.minimap,
      steadyCamera: typeof settings.steadyCamera === 'boolean' ? settings.steadyCamera : d.settings.steadyCamera,
      gameSpeed: clampSpeed(num(settings.gameSpeed, d.settings.gameSpeed, 0, 1)),
      bindings: sanitizeBindings(settings.bindings),
      steerRight: typeof settings.steerRight === 'boolean' ? settings.steerRight : d.settings.steerRight,
    },
    lastRunId: typeof o.lastRunId === 'string' ? o.lastRunId.slice(0, 64) : '',
  };
}

/** The options a run and its renderer use, taken from the settings. */
export function optionsOf(settings: SaveData['settings']): GameOptions {
  const { shake, reduceFlashing, safeWarnings, minimap, steadyCamera, gameSpeed, bindings, steerRight } = settings;
  return { shake, reduceFlashing, safeWarnings, minimap, steadyCamera, gameSpeed, bindings, steerRight };
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
  wizard?: WizardId;
  curses?: CurseId[];
  /** Game speed the run was played at, when slowed. */
  gameSpeed?: number;
  /** Deepest depth the run reached, the maps it saw, and what it smashed (for the records). */
  depth?: number;
  maps?: MapId[];
  breakables?: number;
  /** Relics carried at the end (for the game-over screen; not saved). */
  relics?: RelicId[];
  /** Game time the Archmage Ascendant fell, when the run was won. */
  wonAt?: number;
  /** A daily run's date, and its score. */
  daily?: string;
  score?: number;
}

export interface CommitOutcome {
  save: SaveData;
  awarded: boolean;
  newBestTime: boolean;
  /** Achievements the run earned, and the shards they paid. */
  achievements: AchievementId[];
  achievementShards: number;
  /** A daily run beat the day's best. */
  dailyBest: boolean;
}

/** Banks a finished run exactly once (idempotent per runId). */
export function commitRunResult(save: SaveData, run: RunResult): CommitOutcome {
  if (!run.runId || save.lastRunId === run.runId) {
    return { save, awarded: false, newBestTime: false, achievements: [], achievementShards: 0, dailyBest: false };
  }
  const reward = computeReward(run);
  const newBestTime = run.time > save.records.bestTime;
  const daily = dailyRecords(save.records, run);
  const records: SaveData['records'] = {
    bestTime: Math.max(save.records.bestTime, run.time),
    bestKills: Math.max(save.records.bestKills, run.kills),
    bestLevel: Math.max(save.records.bestLevel, run.level),
    totalRuns: save.records.totalRuns + 1,
    bossKills: save.records.bossKills + Math.max(0, Math.floor(run.bossKills)),
    deepest: Math.max(save.records.deepest, Math.floor(run.depth ?? 1)),
    maps: MAP_ORDER.filter((id) => save.records.maps.includes(id) || (run.maps ?? []).includes(id)),
    breakables: save.records.breakables + Math.max(0, Math.floor(run.breakables ?? 0)),
    ...heatRecords(save.records, run),
    ...winRecords(save.records, run),
    totalKills: save.records.totalKills + Math.max(0, Math.floor(run.kills)),
    rifts: save.records.rifts + Math.max(0, run.recap?.rifts ?? 0),
    bought: save.records.bought + Math.max(0, run.recap?.bought ?? 0),
    bestiary: addSlain(save.records.bestiary, run.recap?.slain ?? {}),
    ...daily.records,
  };
  const earned = newAchievements(records, run, save.achievements);
  const achievementShards = earned.reduce((sum, id) => sum + ACHIEVEMENTS[id].reward, 0);
  return {
    awarded: true,
    newBestTime,
    achievements: earned,
    achievementShards,
    dailyBest: daily.best,
    save: {
      ...save,
      currency: save.currency + reward + achievementShards,
      records,
      achievements: [...save.achievements, ...earned],
      lastRunId: run.runId,
    },
  };
}

/** Adds a run's foes defeated, by kind, to the bestiary's counts. */
function addSlain(bestiary: Record<string, number>, slain: Record<string, number>): Record<string, number> {
  const out = { ...bestiary };
  for (const id of BEAST_IDS) {
    const n = Math.max(0, Math.floor(slain[id] ?? 0));
    if (n > 0) out[id] = (out[id] ?? 0) + n;
  }
  return out;
}

/** A daily run updates the day's best and tries, and the streak of days played in a row. */
function dailyRecords(
  records: SaveData['records'],
  run: RunResult,
): { records: Pick<SaveData['records'], 'dailyDate' | 'dailyBest' | 'dailyPlays' | 'dailyStreak'>; best: boolean } {
  const { dailyDate, dailyBest, dailyPlays, dailyStreak } = records;
  if (!run.daily) return { records: { dailyDate, dailyBest, dailyPlays, dailyStreak }, best: false };
  const score = Math.max(0, Math.floor(run.score ?? 0));
  if (run.daily === dailyDate) {
    return { records: { dailyDate, dailyBest: Math.max(dailyBest, score), dailyPlays: dailyPlays + 1, dailyStreak }, best: score > dailyBest };
  }
  const streak = dailyDate === previousDay(run.daily) ? dailyStreak + 1 : 1;
  return { records: { dailyDate: run.daily, dailyBest: score, dailyPlays: 1, dailyStreak: streak }, best: true };
}

/** Winning, or reaching the loop, at heat h clears it and unlocks h + 1 (M3). */
function heatRecords(records: SaveData['records'], run: RunResult): Pick<SaveData['records'], 'heatUnlocked' | 'heatCleared'> {
  const heat = Math.max(0, Math.floor(run.heat ?? 0));
  if (!run.won && (run.depth ?? 1) < HEAT.clearDepth) return { heatUnlocked: records.heatUnlocked, heatCleared: records.heatCleared };
  return {
    heatUnlocked: Math.min(HEAT.max, Math.max(records.heatUnlocked, heat + 1)),
    heatCleared: Math.max(records.heatCleared, heat),
  };
}

/** A won run counts once, keeps the fastest time, and adds its wizard and heat (V1). */
function winRecords(records: SaveData['records'], run: RunResult): Pick<SaveData['records'], 'wins' | 'fastestWin' | 'winners' | 'wonHeat'> {
  const { wins, fastestWin, winners, wonHeat } = records;
  if (!run.won) return { wins, fastestWin, winners, wonHeat };
  const at = Math.max(0, run.wonAt ?? run.time);
  const wizard = run.wizard;
  return {
    wins: wins + 1,
    fastestWin: fastestWin > 0 ? Math.min(fastestWin, at) : at,
    winners: wizard && !winners.includes(wizard) ? WIZARD_IDS.filter((id) => winners.includes(id) || id === wizard) : winners,
    wonHeat: Math.max(wonHeat, Math.max(0, Math.floor(run.heat ?? 0))),
  };
}

/** Buys a Grimoire unlock, or returns null if it's owned, blocked or too dear. */
export function buyUnlock(save: SaveData, id: UnlockId): SaveData | null {
  if (!UNLOCK_IDS.includes(id) || unlockBlocker(id, save.grimoire, save.records.maps)) return null;
  const cost = unlockDef(id).cost;
  if (save.currency < cost) return null;
  return { ...save, currency: save.currency - cost, grimoire: [...save.grimoire, id] };
}

export function buyMeta(save: SaveData, id: MetaId): SaveData | null {
  const cost = metaNextCost(id, save.meta[id]);
  if (cost === null || save.currency < cost) return null;
  return { ...save, currency: save.currency - cost, meta: { ...save.meta, [id]: save.meta[id] + 1 } };
}
