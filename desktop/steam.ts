/**
 * Steam: achievements, the overlay, and whether Steam Cloud is on (the save itself is synced by
 * Auto-Cloud, with no code; see docs/steam.md). Without Steam running, or outside Steam
 * altogether, the game plays as usual, just without them.
 */

import fs from 'node:fs';
import type * as Steamworks from 'steamworks.js';

/** The game's Steam app ID: 480 is Valve's test app (Spacewar) until the real one is issued. */
export const STEAM_APP_ID = 480;

export interface Steam {
  /** Unlocks these achievements (their Steam API names are the game's own ids). */
  unlock(ids: readonly string[]): void;
  /** Whether Steam Cloud is on for this account and game. */
  cloud: boolean;
}

/**
 * Starts Steam. Called before the app is ready, since the overlay needs a few of Chromium's
 * switches set first. `SERPENT_STEAM_LOG` swaps in a stand-in that writes each unlock to that file,
 * for the desktop check.
 */
export function startSteam(): Steam {
  const log = process.env.SERPENT_STEAM_LOG;
  if (log) return stub(log);
  try {
    // Loaded here, not imported: it throws on a system it has no build for.
    const steamworks = require('steamworks.js') as typeof Steamworks;
    const client = steamworks.init(STEAM_APP_ID);
    steamworks.electronEnableSteamOverlay();
    let cloud = false;
    try {
      cloud = client.cloud.isEnabledForAccount() && client.cloud.isEnabledForApp();
    } catch {
      // Steam didn't say: count it as off.
    }
    const sent = new Set<string>();
    return {
      cloud,
      unlock(ids) {
        let changed = false;
        for (const id of ids) {
          if (sent.has(id)) continue;
          sent.add(id);
          try {
            if (!client.achievement.isActivated(id) && client.achievement.activate(id)) changed = true;
          } catch {
            // Not one of the app's achievements (the test app has none of the game's).
          }
        }
        if (changed) {
          try {
            client.stats.store();
          } catch {
            // Steam stores them on exit anyway.
          }
        }
      },
    };
  } catch (e) {
    console.log(`Playing without Steam: ${e instanceof Error ? e.message : String(e)}`);
    return { cloud: false, unlock() {} };
  }
}

/** The stand-in: each achievement, the first time it's sent, as a line in the file. */
function stub(file: string): Steam {
  const sent = new Set<string>();
  return {
    cloud: false,
    unlock(ids) {
      const fresh = ids.filter((id) => !sent.has(id));
      for (const id of fresh) sent.add(id);
      if (fresh.length) fs.appendFileSync(file, fresh.map((id) => `${id}\n`).join(''));
    },
  };
}
