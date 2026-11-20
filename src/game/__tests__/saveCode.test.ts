import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_IDS } from '../achievements';
import { BEAST_IDS } from '../bestiary';
import { UNLOCK_IDS } from '../grimoire';
import { defaultSave, parseSave, sanitizeSave, type SaveData } from '../persistence';
import { backupFile, dayOf, decodeSave, encodeSave, formatDay, restoreFrom, saveSummary, summaryText } from '../saveCode';

const MADE = new Date(2026, 10, 19, 23, 30);

/** A save with something in every part, and a run id that isn't plain ASCII. */
function fullSave(): SaveData {
  const s = defaultSave();
  s.currency = 12640;
  s.meta = { ...s.meta, [Object.keys(s.meta)[0]]: 2 };
  Object.assign(s.records, { totalRuns: 37, wins: 2, bestTime: 1234.5, bestKills: 999, deepest: 6, totalKills: 123456, dailyDate: '2026-11-18', dailyBest: 4321, dailyStreak: 3 });
  s.records.maps = ['ruins', 'hollows', 'catacombs'];
  s.records.winners = ['arcanist'];
  s.records.bestiary = Object.fromEntries(BEAST_IDS.map((id, i) => [id, 1000 + i]));
  s.achievements = ACHIEVEMENT_IDS.slice(0, 14);
  s.grimoire = UNLOCK_IDS.slice(0, 2);
  s.settings = { ...s.settings, wizard: 'arcanist', heat: 3, minimap: false, autoAim: true, vibration: true, volume: 0.4 };
  s.lastRunId = 'rún-ü-🐍-42';
  s.backup = { last: '2026-11-01', seen: true };
  return s;
}

describe('backup codes', () => {
  it('bring a whole save back as it was, with the day the code was made', () => {
    const save = fullSave();
    const code = encodeSave(save, MADE);
    expect(code).toMatch(/^SS1:[A-Za-z0-9_-]+\.[0-9a-z]+~$/);
    const got = decodeSave(code);
    expect(got).toEqual({ ok: true, save: sanitizeSave(save), made: '2026-11-19' });
  });

  it('are found inside other text and across line breaks', () => {
    const code = encodeSave(fullSave(), MADE);
    const wrapped = code.replace(/(.{60})/g, '$1\n  ');
    const message = `Here's my save!\n\n${wrapped}\n\nsee you`;
    const got = decodeSave(message);
    expect(got.ok && got.save.currency).toBe(12640);
    // A backup file holds one too, after its sentence.
    expect(decodeSave(backupFile(fullSave(), MADE).text).ok).toBe(true);
  });

  it('say why one can’t be read: none there, cut off, damaged, or from a newer game', () => {
    const code = encodeSave(fullSave(), MADE);
    expect(decodeSave('hello')).toEqual({ ok: false, why: 'none' });
    expect(decodeSave('')).toEqual({ ok: false, why: 'none' });
    expect(decodeSave(code.slice(0, code.length - 40))).toEqual({ ok: false, why: 'cut' });
    // One character changed in the middle.
    const mid = Math.floor(code.length / 2);
    const changed = code.slice(0, mid) + (code[mid] === 'A' ? 'B' : 'A') + code.slice(mid + 1);
    expect(decodeSave(changed)).toEqual({ ok: false, why: 'bad' });
    // No checksum at all.
    expect(decodeSave(code.replace(/\.[0-9a-z]+~$/, '~'))).toEqual({ ok: false, why: 'bad' });
    expect(decodeSave('SS1:not base64!~')).toEqual({ ok: false, why: 'bad' });
    // A save from a later version of the game.
    expect(decodeSave(encodeSave({ ...fullSave(), version: 99 }, MADE))).toEqual({ ok: false, why: 'newer' });
  });

  it('clean what they hold like a save loaded from storage', () => {
    const odd = { ...fullSave(), currency: -50, achievements: ['not-one', ACHIEVEMENT_IDS[0]] } as unknown as SaveData;
    const got = decodeSave(encodeSave(odd, MADE));
    expect(got.ok && got.save.currency).toBe(0);
    expect(got.ok && got.save.achievements).toEqual([ACHIEVEMENT_IDS[0]]);
  });
});

describe('restoring a backup', () => {
  it('takes its progress and run setup, and keeps this device’s options, sound and backup history', () => {
    const backup = fullSave();
    const device = defaultSave();
    device.settings = { ...device.settings, minimap: true, autoAim: false, vibration: false, volume: 0.9, muted: true, wizard: 'arcanist', heat: 0 };
    device.backup = { last: '', seen: true };
    const out = restoreFrom(device, backup);
    expect(out.currency).toBe(12640);
    expect(out.records).toEqual(backup.records);
    expect(out.achievements).toEqual(backup.achievements);
    expect(out.grimoire).toEqual(backup.grimoire);
    expect(out.meta).toEqual(backup.meta);
    expect(out.lastRunId).toBe(backup.lastRunId);
    expect(out.settings.heat).toBe(3);
    expect(out.settings).toMatchObject({ minimap: true, autoAim: false, vibration: false, volume: 0.9, muted: true });
    expect(out.backup).toEqual({ last: '', seen: true });
  });

  it('sums a save up to compare two', () => {
    const s = saveSummary(fullSave());
    expect(s).toEqual({ shards: 12640, runs: 37, wins: 2, achievements: 14, of: ACHIEVEMENT_IDS.length });
    expect(summaryText(s)).toBe(`12,640 shards, 37 runs, 2 wins, 14 of ${ACHIEVEMENT_IDS.length} achievements`);
    expect(summaryText({ shards: 1, runs: 1, wins: 1, achievements: 0, of: 20 })).toBe('1 shard, 1 run, 1 win, 0 of 20 achievements');
  });

  it('names the file by the day, and writes days the way people read them', () => {
    expect(dayOf(MADE)).toBe('2026-11-19');
    expect(formatDay('2026-11-19')).toBe('19 Nov 2026');
    expect(formatDay('nonsense')).toBe('');
    const f = backupFile(fullSave(), MADE);
    expect(f.name).toBe('serpent-sorcery-save-2026-11-19.txt');
    expect(f.text.split('\n')[0]).toBe(`Serpent Sorcery save, backed up 19 Nov 2026: 12,640 shards, 37 runs, 2 wins, 14 of ${ACHIEVEMENT_IDS.length} achievements.`);
  });
});

describe('the save’s backup history', () => {
  it('starts empty, and a missing or garbled one falls back to that', () => {
    expect(defaultSave().backup).toEqual({ last: '', seen: false });
    expect(parseSave(JSON.stringify({ currency: 5 })).backup).toEqual({ last: '', seen: false });
    expect(parseSave(JSON.stringify({ backup: { last: 'yesterday', seen: 'yes' } })).backup).toEqual({ last: '', seen: false });
    expect(parseSave(JSON.stringify({ backup: { last: '2026-11-19', seen: true } })).backup).toEqual({ last: '2026-11-19', seen: true });
  });
});
