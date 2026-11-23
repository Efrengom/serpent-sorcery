import type { BuffId } from './world';

/**
 * Buff icons as SVG path data in a 24×24 box, for the HUD's buff chips. On the floor, each pickup is
 * drawn by hand in pixels instead (pixel/draw.ts).
 */
export const ICON_PATHS: Record<BuffId | 'heal', string> = {
  // An hourglass: cooldowns run faster.
  quickening: 'M5 2h14v3l-5 7 5 7v3H5v-3l5-7-5-7z',
  // A four-pointed star: more power.
  empower: 'M12 1l3 8 8 3-8 3-3 8-3-8-8-3 8-3z',
  // Two chevrons: more speed.
  swiftscale: 'M2 4h5l8 8-8 8H2l8-8zM10 4h5l8 8-8 8h-5l8-8z',
  // A shield.
  stoneskin: 'M12 1l9 3.5v6.5c0 5.5-4 10-9 12-5-2-9-6.5-9-12V4.5z',
  // A horseshoe magnet.
  lodestone: 'M3 2h6v10a3 3 0 006 0V2h6v10a9 9 0 01-18 0z',
  // A cut gem.
  shardCache: 'M6 3h12l5 6-11 13L1 9z',
  // A heart.
  heal: 'M12 22C5 16 1 12.5 1 8a5.5 5.5 0 0111-1.5A5.5 5.5 0 0123 8c0 4.5-4 8-11 14z',
};

