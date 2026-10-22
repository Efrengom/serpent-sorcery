import { CURSE_IDS, type CurseId } from './curses';
import type { RunSummary } from './progression';
import { WIZARD_IDS, type WizardId } from './wizards';

/**
 * The daily run (D1): one seed a day, shared by everyone who plays it that day (the maps, the
 * foes and every level-up offer follow from it), with the day's wizard and one curse. A score
 * from how far and how well the run went; the save keeps the day's best and a streak of days.
 */

/** Today's date in UTC, as YYYY-MM-DD (the daily changes at midnight UTC everywhere). */
export function dailyDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The day before a YYYY-MM-DD date. */
export function previousDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return dailyDate(d);
}

/** A stable 32-bit seed from the date. */
function hashDate(date: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // A final mix, so neighbouring days aren't neighbouring seeds.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

export interface DailySetup {
  date: string;
  seed: number;
  wizard: WizardId;
  curse: CurseId;
}

/** The day's seed, wizard (every wizard takes a turn, locked or not) and curse. */
export function dailySetup(date: string): DailySetup {
  const seed = hashDate(date);
  return { date, seed, wizard: WIZARD_IDS[seed % WIZARD_IDS.length], curse: CURSE_IDS[(seed >>> 8) % CURSE_IDS.length] };
}

/** A daily run's score: time, foes, levels and Archmages, and a great deal for a win. */
export function dailyScore(run: RunSummary): number {
  return Math.max(
    0,
    Math.floor(Math.max(0, run.time)) + Math.max(0, run.kills) * 2 + Math.max(0, run.level) * 15 + Math.max(0, run.bossKills) * 300 + (run.won ? 3000 : 0),
  );
}
