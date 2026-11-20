import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_IDS, ACHIEVEMENTS } from '../../src/game/achievements';

const doc = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'docs', 'steam.md'), 'utf8');

describe('docs/steam.md', () => {
  it('lists every achievement with its API name, name and description, for Steamworks', () => {
    const rows = new Map<string, string[]>();
    for (const line of doc.split(/\r?\n/)) {
      const m = /^\| `(\w+)` \| (.+) \| (.+) \|$/.exec(line);
      if (m) rows.set(m[1], [m[2], m[3]]);
    }
    expect([...rows.keys()].sort()).toEqual([...ACHIEVEMENT_IDS].sort());
    for (const id of ACHIEVEMENT_IDS) expect(rows.get(id)).toEqual([ACHIEVEMENTS[id].name, ACHIEVEMENTS[id].description]);
  });
});
