import { describe, expect, it } from 'vitest';
import { killEnemy } from '../combat';
import { enterNextMap } from '../descent';
import { dist } from '../math';
import { computeReward, emptyMetaLevels } from '../progression';
import { chooseAtSite, PACTS, placeSites, riftKills, runShards, siteOffer, SITES, updateSites, type PactId, type Site } from '../sites';
import { clearanceAt } from '../terrain';
import { createWorld, DEFAULT_SETUP, type World } from '../world';

const DT = 1 / 120;
const newWorld = (depth = 1, seed = 11): World => createWorld(emptyMetaLevels(), () => undefined, seed, { ...DEFAULT_SETUP, startDepth: depth });

/** A world with one site of a kind, at its first site's spot. */
function withSite(kind: Site['kind'], depth = 1): { w: World; site: Site } {
  const w = newWorld(depth);
  const site = w.sites[0];
  site.kind = kind;
  site.offer = [];
  if (kind === 'shrine') site.offer = ['blood', 'haste', 'glass'];
  if (kind === 'merchant') site.offer = ['draught', 'tome', 'empower'];
  w.sites = [site];
  w.snake.reset(site.x - 300, site.y, 0);
  return { w, site };
}

const enter = (w: World, site: Site) => {
  w.snake.reset(site.x, site.y, 0);
  return updateSites(w, DT);
};

describe('map sites', () => {
  it('stand at landmarks on open, dry ground, away from the start: two a map, three from the third', () => {
    for (const depth of [1, 2, 3, 4]) {
      const w = newWorld(depth);
      expect(w.sites).toHaveLength(depth >= SITES.deepFrom ? SITES.perMapDeep : SITES.perMap);
      for (const s of w.sites) {
        expect(clearanceAt(w.map.index, s.x, s.y)).toBeGreaterThanOrEqual(70);
        expect(dist(s.x, s.y, w.map.start.x, w.map.start.y)).toBeGreaterThan(400);
      }
      expect(new Set(w.sites.map((s) => s.kind)).size).toBe(w.sites.length);
    }
    // The same run and map give the same sites; the next map gets its own.
    expect(newWorld(1, 7).sites.map((s) => [s.kind, Math.round(s.x)])).toEqual(newWorld(1, 7).sites.map((s) => [s.kind, Math.round(s.x)]));
    const w = newWorld(1, 7);
    const first = w.sites.map((s) => s.x).join();
    enterNextMap(w);
    expect(w.sites.map((s) => s.x).join()).not.toBe(first);
  });

  it('a shrine opens its pacts on entering; a pact changes the run for good and ill, and only once', () => {
    const { w, site } = withSite('shrine');
    const dmg = w.stats.damageMult;
    const hp = w.stats.maxHp;
    expect(enter(w, site)).toBe(site);
    const offer = siteOffer(w, site);
    expect(offer.choices.map((c) => c.id)).toEqual(['blood', 'haste', 'glass']);
    expect(chooseAtSite(w, site.id, 'blood')).toBe(true);
    expect(w.pacts).toEqual(['blood']);
    expect(w.stats.damageMult).toBeCloseTo(dmg * PACTS.blood.mods.damageMult!, 6);
    expect(w.stats.maxHp).toBeLessThan(hp);
    expect(site.spent).toBe(true);
    expect(chooseAtSite(w, site.id, 'haste')).toBe(false);
    // Leaving and coming back doesn't open a spent shrine.
    w.snake.reset(site.x - 300, site.y, 0);
    updateSites(w, DT);
    expect(enter(w, site)).toBeNull();
    for (const id of Object.keys(PACTS) as PactId[]) expect(PACTS[id].boon.length * PACTS[id].bane.length).toBeGreaterThan(0);
  });

  it('a cursed chest pays a relic at once, curses the foes’ blows for a while, and calls elite guards', () => {
    const { w, site } = withSite('chest', 2);
    const relics = w.relics.length;
    const taken = w.mods.damageTakenMult;
    expect(enter(w, site)).toBeNull();
    expect(site.spent).toBe(true);
    expect(w.relics.length).toBe(relics + 1);
    expect(w.mods.damageTakenMult).toBeCloseTo(taken * SITES.chest.curseDamage, 6);
    expect(w.enemies.filter((e) => e.elite).length).toBeGreaterThan(0);
    for (let t = 0; t < SITES.chest.curseTime + 0.1; t += 0.05) updateSites(w, 0.05);
    expect(w.chestCurse).toBe(0);
    expect(w.mods.damageTakenMult).toBeCloseTo(taken, 6);
  });

  it('a rift calls elites; slaying enough in time earns its relic, too few lets it close', () => {
    const { w, site } = withSite('rift', 2);
    enter(w, site);
    expect(w.rift).not.toBeNull();
    for (let t = 0; t < 10; t += DT) updateSites(w, DT);
    const elites = w.enemies.filter((e) => e.elite && !e.dead);
    expect(elites.length).toBeGreaterThan(1);
    for (const e of w.enemies.filter((e) => e.elite)) killEnemy(w, e);
    while (riftKills(w) < w.rift!.need) {
      const e = w.enemies.find((x) => !x.dead) ?? w.enemies[0];
      e.dead = false;
      e.elite = 'swift';
      killEnemy(w, e);
    }
    updateSites(w, DT);
    expect(w.rift).toBeNull();
    expect(w.riftReward).toBe(true);
    expect(w.recap.rifts).toBe(1);

    const other = withSite('rift', 2);
    enter(other.w, other.site);
    for (let t = 0; t < SITES.rift.time + 0.1; t += 0.05) updateSites(other.w, 0.05);
    expect(other.w.rift).toBeNull();
    expect(other.w.riftReward).toBe(false);
  });

  it('a merchant sells for the run’s shards, which come off what the run banks', () => {
    const { w, site } = withSite('merchant', 2);
    w.time = 600;
    w.kills = 400;
    w.level = 18;
    const purse = runShards(w);
    expect(purse).toBeGreaterThan(60);
    enter(w, site);
    const offer = siteOffer(w, site);
    const draught = offer.choices.find((c) => c.id === 'draught')!;
    expect(draught.affordable).toBe(true);
    w.hp = 10;
    expect(chooseAtSite(w, site.id, 'draught')).toBe(true);
    expect(w.hp).toBeGreaterThan(10);
    expect(w.spentShards).toBe(draught.cost);
    expect(runShards(w)).toBe(purse - draught.cost);
    // Sold once; the merchant itself stays open.
    expect(chooseAtSite(w, site.id, 'draught')).toBe(false);
    expect(site.spent).toBe(false);
    const summary = { time: w.time, kills: w.kills, level: w.level, bossKills: 0 };
    expect(computeReward({ ...summary, spent: w.spentShards })).toBe(computeReward(summary) - w.spentShards);
    // Too dear: refused, and shown as such.
    w.spentShards = 1e6;
    expect(siteOffer(w, site).choices.every((c) => !c.affordable)).toBe(true);
    expect(chooseAtSite(w, site.id, 'tome')).toBe(false);
  });

  it('places fresh sites when the run moves on, and a fight in a rift ends if the map does', () => {
    const w = newWorld(1);
    placeSites(w);
    const n = w.sites.length;
    expect(n).toBeGreaterThan(0);
    w.rift = { siteId: 1, t: 0, need: 5, base: 0, spawnAcc: 0 };
    enterNextMap(w);
    expect(w.rift).toBeNull();
  });
});
