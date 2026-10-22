import { describe, expect, it } from 'vitest';
import { clampCamera } from '../camera';
import { killEnemy } from '../combat';
import { BOSSES, HEAT, REWARDS } from '../config';
import { bossHp, spawnEnemy, updateDirector, updateEnemies } from '../enemies';
import { FINALE, finaleDue, updateFinale, victoryReady } from '../finale';
import { MAP_ORDER } from '../maps';
import { musicCue } from '../music/mood';
import { commitRunResult, defaultSave, parseSave, type RunResult } from '../persistence';
import { computeReward, emptyMetaLevels } from '../progression';
import { refreshFlowField } from '../nav';
import { createWorld, DEFAULT_SETUP, type World } from '../world';

const DT = 1 / 120;
const LAST = MAP_ORDER.length;
const newWorld = (depth = 1, seed = 5): World => createWorld(emptyMetaLevels(), () => undefined, seed, { ...DEFAULT_SETUP, startDepth: depth });

function place(w: World, x: number, y: number): void {
  w.snake.reset(x, y, 0);
  w.camera.x = x;
  w.camera.y = y;
  clampCamera(w.camera, w.map.width, w.map.height);
  refreshFlowField(w.flow, x, y);
}

/** The last map with its Archmage just defeated, the Ascendant risen: returns the Ascendant. */
function riseAscendant(w: World) {
  place(w, w.map.start.x, w.map.start.y);
  w.invuln = 1e9;
  killEnemy(w, spawnEnemy(w, 'boss', w.snake.x + 300, w.snake.y));
  for (let t = 0; t < FINALE.rise + 0.1; t += DT) updateFinale(w, DT);
  return w.boss!;
}

describe('the run’s ending', () => {
  it('raises the Ascendant only after the last map’s Archmage, on the first pass', () => {
    expect(finaleDue(newWorld(1))).toBe(false);
    const w = newWorld(LAST);
    expect(w.map.def.id).toBe(MAP_ORDER[LAST - 1]);
    expect(finaleDue(w)).toBe(true);
    w.won = true;
    expect(finaleDue(w)).toBe(false);
    // The second pass's last map just goes on down.
    expect(finaleDue(newWorld(LAST * 2))).toBe(false);
  });

  it('clears the field and rumbles instead of opening a way down, then the Ascendant rises there', () => {
    const w = newWorld(LAST);
    place(w, w.map.start.x, w.map.start.y);
    spawnEnemy(w, 'imp', w.snake.x + 400, w.snake.y);
    killEnemy(w, spawnEnemy(w, 'boss', w.snake.x + 300, w.snake.y));
    expect(w.descent).toBeNull();
    expect(w.finale).toMatchObject({ stage: 'rising' });
    expect(w.enemies.every((e) => e.dead)).toBe(true);
    // Nothing arrives while it rises.
    w.time = w.nextBossTime + 10;
    const before = w.portals.length;
    for (let i = 0; i < 2 / DT; i++) updateDirector(w, DT);
    expect(w.portals.length).toBe(before);
    for (let t = 0; t < FINALE.rise + 0.1; t += DT) updateFinale(w, DT);
    const a = w.boss!;
    expect(a.bossId).toBe('ascendant');
    expect(w.finale!.stage).toBe('fight');
    expect(a.maxHp).toBeCloseTo(bossHp(w.bossIndex, w.depth, w.heat) * FINALE.hpMult, 3);
    expect(Math.hypot(a.x - w.finale!.x, a.y - w.finale!.y)).toBeLessThan(1);
  });

  it('fights in three phases, taking up each map’s magic as its health falls', () => {
    const w = newWorld(LAST);
    const a = riseAscendant(w);
    const phases = BOSSES.ascendant.phases!;
    expect(a.phase).toBe(0);
    a.hp = a.maxHp * 0.6;
    updateEnemies(w, DT);
    expect(a.phase).toBe(1);
    expect(w.banner?.text).toBe(phases[1].banner[0]);
    a.hp = a.maxHp * 0.3;
    updateEnemies(w, DT);
    expect(a.phase).toBe(2);
    // Its next move comes from the phase it is in.
    a.state = 'move';
    a.attackTimer = 0;
    w.enemies.forEach((e) => (e.nav.next = 1e9));
    for (let i = 0; i < 120 && a.state === 'move'; i++) updateEnemies(w, DT);
    expect(phases[2].moves).toContain(a.bossMove);
  });

  it('wins the run when it falls: the field clears, and after a moment the choice is offered', () => {
    const w = newWorld(LAST);
    const a = riseAscendant(w);
    w.time = 1500;
    killEnemy(w, a);
    expect(w.won).toBe(true);
    expect(w.wonAt).toBe(1500);
    expect(w.finale!.stage).toBe('won');
    expect(w.descent).toBeNull();
    expect(victoryReady(w)).toBe(false);
    for (let t = 0; t < FINALE.victoryDelay + 0.05; t += DT) updateFinale(w, DT);
    expect(victoryReady(w)).toBe(true);
    // A victory sting, then a calm arrangement of the finale over the victory screen.
    w.finale!.t = 0;
    expect(musicCue(w, 'playing', 0)).toMatchObject({ scene: 'victory', finale: true });
    w.finale!.t = 10;
    expect(musicCue(w, 'victory', 0)).toMatchObject({ scene: 'calm', finale: true });
  });

  it('plays the Ascendant’s theme while it rises and fights', () => {
    const w = newWorld(LAST);
    place(w, w.map.start.x, w.map.start.y);
    killEnemy(w, spawnEnemy(w, 'boss', w.snake.x + 300, w.snake.y));
    expect(musicCue(w, 'playing', 2)).toMatchObject({ scene: 'warning', finale: true });
    for (let t = 0; t < FINALE.rise + 0.1; t += DT) updateFinale(w, DT);
    expect(musicCue(w, 'playing', 2)).toMatchObject({ scene: 'boss1', finale: true });
  });
});

describe('winning in the records', () => {
  const run = (over: Partial<RunResult> = {}): RunResult => ({ runId: `r${Math.random()}`, time: 1600, kills: 900, level: 30, bossKills: 5, reward: 0, ...over });

  it('pays a victory bonus', () => {
    const base = computeReward(run());
    expect(computeReward(run({ won: true }))).toBe(base + REWARDS.victory);
    expect(FINALE.reward).toBe(REWARDS.victory);
  });

  it('counts wins, keeps the fastest, and remembers each winning wizard and heat', () => {
    let save = defaultSave();
    save = commitRunResult(save, run({ won: true, wonAt: 1550, wizard: 'frostcoil', heat: 2 })).save;
    save = commitRunResult(save, run({ won: true, wonAt: 1500, wizard: 'arcanist', heat: 0 })).save;
    save = commitRunResult(save, run({ won: false, wizard: 'stormtongue' })).save;
    expect(save.records).toMatchObject({ wins: 2, fastestWin: 1500, wonHeat: 2 });
    expect(save.records.winners).toEqual(['arcanist', 'frostcoil']);
    // A win clears its heat even without reaching the loop.
    expect(save.records.heatCleared).toBe(2);
    expect(save.records.heatUnlocked).toBe(Math.min(HEAT.max, 3));
    const again = parseSave(JSON.stringify(save));
    expect(again.records).toMatchObject({ wins: 2, fastestWin: 1500, winners: ['arcanist', 'frostcoil'] });
    expect(parseSave(JSON.stringify({ records: { wins: 'lots', winners: ['nobody'] } })).records).toMatchObject({ wins: 0, winners: [] });
  });
});
