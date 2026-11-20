/**
 * Asking the browser to keep the save for good. Without that, a browser may clear a site's
 * storage on its own: when it's short of space or, in Safari, after a week without a visit.
 * Chrome, Edge and Safari answer by themselves (Chrome grants it to installed apps and sites
 * used a lot); Firefox asks the player once. So it's asked after a run is banked, never on load.
 */

import { useEffect, useState } from 'react';
import type { SaveData } from '../game/persistence';
import { desktop } from '../desktop';

type Keeper = { persisted?(): Promise<boolean>; persist?(): Promise<boolean> };

function manager(): Keeper | null {
  try {
    return (typeof navigator !== 'undefined' && (navigator.storage as Keeper | undefined)) || null;
  } catch {
    return null;
  }
}

/** Whether the browser has agreed to keep the save (false when it can't say). */
export async function isKept(): Promise<boolean> {
  // The desktop program keeps the save in a file of its own, which nothing clears: no reminder,
  // and nothing to ask.
  if (desktop()) return true;
  try {
    return (await manager()?.persisted?.()) === true;
  } catch {
    return false;
  }
}

/** Asks the browser to keep the save, unless it already does; resolves to whether it does now. */
export async function askToKeep(): Promise<boolean> {
  if (await isKept()) return true;
  try {
    return (await manager()?.persist?.()) === true;
  } catch {
    return false;
  }
}

/** Runs a save needs before the backup reminder shows: by then there's progress worth keeping. */
export const REMIND_AFTER_RUNS = 5;

/**
 * Whether to point at Backup & Restore: there's real progress, the browser hasn't agreed to keep
 * it, and the screen has never been opened (opening it once ends the reminder for good).
 */
export function useBackupReminder(save: SaveData): boolean {
  const kept = useKept();
  return save.records.totalRuns >= REMIND_AFTER_RUNS && kept === false && !save.backup.seen;
}

/** Whether the browser keeps the save: null while it checks. Checked when the screen opens. */
export function useKept(): boolean | null {
  const [kept, setKept] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void isKept().then((k) => live && setKept(k));
    return () => {
      live = false;
    };
  }, []);
  return kept;
}
