import { buffDuration, BUFF_INFO, grantBuff } from './breakables';
import { gainXp } from './combat';
import { burst, floater } from './effects';
import { ringPoint, spawnElite } from './enemies';
import { clamp, dist, mulberry32, TAU, type Vec } from './math';
import { COLORS } from './palette';
import { computeReward, xpToNext, type RunMods } from './progression';
import { RELICS, takeRelic, type RelicId } from './relics';
import { shardMultiplier } from './curses';
import { clearanceAt } from './terrain';
import { refreshStats, type TimedBuff, type World } from './world';

/**
 * Places on the map worth a detour (E1): at two or three of each map's landmarks, a shrine, a
 * rift, a cursed chest or a merchant. Steering into one is a choice: a shrine offers pacts (a
 * boon with a price), a rift calls elites for a relic, a chest pays at once and curses, and a
 * merchant sells for the shards the run will bank.
 */

export type SiteKind = 'shrine' | 'rift' | 'chest' | 'merchant';
export const SITE_KINDS: SiteKind[] = ['shrine', 'rift', 'chest', 'merchant'];

export const SITE_INFO: Record<SiteKind, { name: string; color: string; blurb: string }> = {
  shrine: { name: 'Shrine of Pacts', color: '#ff6a7a', blurb: 'A boon, at a price' },
  rift: { name: 'Elite Rift', color: '#b48cff', blurb: 'Defeat its elites in time for a relic' },
  chest: { name: 'Cursed Chest', color: '#c070ff', blurb: 'A relic now, and a curse' },
  merchant: { name: 'Wandering Merchant', color: '#ffd45e', blurb: 'Trades for this run’s shards' },
};

export const SITES = {
  /** How close the head must come to use one. */
  radius: 50,
  /** Sites on each map, more from the third map on. */
  perMap: 2,
  perMapDeep: 3,
  deepFrom: 3,
  /** Kept at least this far from where the serpent arrives. */
  awayFromStart: 650,
  rift: {
    /** Seconds to defeat its elites, how many (plus one per depth), and how often one comes. */
    time: 35,
    need: 6,
    perDepth: 1,
    every: 2.4,
    /** XP if no relic is left to give. */
    xp: 120,
  },
  chest: {
    /** Seconds foes hit harder, by how much, and the elites that guard it. */
    curseTime: 45,
    curseDamage: 1.4,
    guards: 3,
    /** Shards if no relic is left to give. */
    shards: 40,
  },
};

/** A pact: what a shrine's choice does to the run, for good and ill. */
export type PactId = 'blood' | 'haste' | 'plenty' | 'glass' | 'stone';
export const PACTS: Record<PactId, { name: string; boon: string; bane: string; mods: Partial<RunMods> }> = {
  blood: { name: 'Blood Pact', boon: '+18% spell damage', bane: '−20% max health', mods: { damageMult: 1.18, maxHpMult: 0.8 } },
  haste: { name: 'Pact of Haste', boon: '−12% cooldowns', bane: 'Foes hit 15% harder', mods: { cooldownMult: 0.88, damageTakenMult: 1.15 } },
  plenty: { name: 'Pact of Plenty', boon: '+25% XP and +30% pickup reach', bane: '−10% max health', mods: { xpMult: 1.25, pickupMult: 1.3, maxHpMult: 0.9 } },
  glass: { name: 'Pact of Glass', boon: '+30% spell damage', bane: 'Foes hit 30% harder', mods: { damageMult: 1.3, damageTakenMult: 1.3 } },
  stone: { name: 'Pact of Stone', boon: '+25% max health and foes hit 15% softer', bane: '+10% cooldowns', mods: { maxHpMult: 1.25, damageTakenMult: 0.85, cooldownMult: 1.1 } },
};
export const PACT_IDS = Object.keys(PACTS) as PactId[];

/** What a merchant sells, and for how many of the run's shards (more each depth). */
export type WareId = 'draught' | 'tome' | 'relic' | TimedBuff;
const WARES: Record<Exclude<WareId, 'relic' | TimedBuff>, { name: string; blurb: string; cost: number }> = {
  draught: { name: 'Healing Draught', blurb: 'Heals 60% of your health', cost: 30 },
  tome: { name: 'Tome of Insight', blurb: 'Gain a level at once', cost: 60 },
};
const RELIC_COST = 90;
const BUFF_COST = 25;
const COST_PER_DEPTH = 0.15;

export interface Site {
  id: number;
  kind: SiteKind;
  x: number;
  y: number;
  /** Used up: a shrine's pact taken, a chest opened, a rift fought. A merchant never is. */
  spent: boolean;
  /** The head is inside its circle now (a panel opens again only after leaving and coming back). */
  inside: boolean;
  /** A shrine's three pacts, or a merchant's wares, rolled when the site is placed. */
  offer: string[];
  /** Wares bought from this merchant. */
  sold: string[];
}

/** A rift being fought: where, how long it has been open, and the elites slain since it opened. */
export interface RiftState {
  siteId: number;
  t: number;
  need: number;
  /** Elites slain in the run when it opened, so its count is the difference. */
  base: number;
  spawnAcc: number;
}

/** A shrine's or merchant's panel, open while play waits. */
export interface SiteOffer {
  siteId: number;
  kind: 'shrine' | 'merchant';
  title: string;
  sub: string;
  /** Shards the run would bank now, less what has been spent (the merchant's purse). */
  shards: number;
  choices: { id: string; name: string; description: string; cost: number; affordable: boolean; relic?: RelicId }[];
}

function shuffle<T>(list: T[], rng: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Open, dry ground near (x, y): free of stone and hazards, and inside the map. */
function openGround(world: World, x: number, y: number): Vec | null {
  const b = world.map.bounds;
  const hz = world.map.hazardIndex;
  const fits = (px: number, py: number) =>
    px > b.minX + 120 && px < b.maxX - 120 && py > b.minY + 120 && py < b.maxY - 120 && clearanceAt(world.map.index, px, py) >= 70 && (!hz || clearanceAt(hz, px, py) >= SITES.radius + 20);
  for (let r = 0; r <= 600; r += 40) {
    const n = r === 0 ? 1 : 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (fits(px, py)) return { x: px, y: py };
    }
  }
  return null;
}

/** Development only: `?nosites` leaves the maps without sites (the play-test's older parts use it). */
function sitesOff(): boolean {
  return import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('nosites');
}

/** Puts this map's sites at some of its landmarks, away from where the serpent arrives. */
export function placeSites(world: World): void {
  const rng = mulberry32((world.seed ^ Math.imul(world.mapIndex + 1, 0x9e3779b1)) >>> 0);
  world.sites = [];
  world.rift = null;
  if (sitesOff()) return;
  const map = world.map;
  const marks = shuffle(
    map.landmarks.filter((l) => dist(l.x, l.y, map.start.x, map.start.y) > SITES.awayFromStart),
    rng,
  );
  const n = world.depth >= SITES.deepFrom ? SITES.perMapDeep : SITES.perMap;
  const kinds = shuffle([...SITE_KINDS], rng);
  for (const mark of marks) {
    if (world.sites.length >= n) break;
    // Beside the landmark, not on it: its centrepiece is often solid.
    const a = rng() * TAU;
    const at = openGround(world, mark.x + Math.cos(a) * 170, mark.y + Math.sin(a) * 170);
    if (!at || world.sites.some((s) => dist(s.x, s.y, at.x, at.y) < 500)) continue;
    const kind = kinds[world.sites.length % kinds.length];
    world.sites.push({ id: world.sites.length + 1, kind, x: at.x, y: at.y, spent: false, inside: false, offer: rollOffer(world, kind, rng), sold: [] });
  }
}

function rollOffer(world: World, kind: SiteKind, rng: () => number): string[] {
  if (kind === 'shrine') return shuffle([...PACT_IDS], rng).slice(0, 3);
  if (kind !== 'merchant') return [];
  const pool = world.relicPool.filter((id) => !world.relics.includes(id));
  const relic = pool.length > 0 ? `relic:${pool[Math.floor(rng() * pool.length)]}` : 'tome';
  const buff = (['quickening', 'empower', 'swiftscale'] as const)[Math.floor(rng() * 3)];
  return ['draught', relic, buff].filter((v, i, a) => a.indexOf(v) === i);
}

/** Shards the run would bank if it ended now, less what it has spent at merchants. */
export function runShards(world: World): number {
  const reward = computeReward({
    time: world.time,
    kills: world.kills,
    level: world.level,
    bossKills: world.bossKills,
    shardMult: shardMultiplier(world.curses),
    bonusShards: world.bonusShards,
    heat: world.heat,
    won: world.won,
  });
  return Math.max(0, reward - world.spentShards);
}

function wareCost(world: World, id: string): number {
  const base = id.startsWith('relic:') ? RELIC_COST : id in WARES ? WARES[id as keyof typeof WARES].cost : BUFF_COST;
  return Math.round(base * (1 + COST_PER_DEPTH * (world.depth - 1)));
}

/** The panel a shrine or merchant opens. */
export function siteOffer(world: World, site: Site): SiteOffer {
  if (site.kind === 'shrine') {
    return {
      siteId: site.id,
      kind: 'shrine',
      title: SITE_INFO.shrine.name,
      sub: 'Choose a pact for the rest of the run — or leave it be',
      shards: runShards(world),
      choices: site.offer.map((id) => {
        const p = PACTS[id as PactId];
        return { id, name: p.name, description: `${p.boon}. ${p.bane}.`, cost: 0, affordable: true };
      }),
    };
  }
  const shards = runShards(world);
  return {
    siteId: site.id,
    kind: 'merchant',
    title: SITE_INFO.merchant.name,
    sub: 'Pays in the shards this run will bank',
    shards,
    choices: site.offer
      .filter((id) => !site.sold.includes(id))
      .map((id) => {
        const cost = wareCost(world, id);
        if (id.startsWith('relic:')) {
          const relic = id.slice(6) as RelicId;
          return { id, name: RELICS[relic].name, description: RELICS[relic].description, cost, affordable: cost <= shards && !world.relics.includes(relic), relic };
        }
        if (id in WARES) {
          const w = WARES[id as keyof typeof WARES];
          return { id, name: w.name, description: w.blurb, cost, affordable: cost <= shards };
        }
        const b = BUFF_INFO[id as TimedBuff];
        return { id, name: `Elixir of ${b.name}`, description: `${b.blurb} for ${Math.round(buffDuration(id as TimedBuff))}s`, cost, affordable: cost <= shards };
      }),
  };
}

/** What the pacts taken, and a cursed chest's curse while it lasts, do to the run's stats. */
export function siteMods(world: World): Partial<RunMods>[] {
  const out: Partial<RunMods>[] = world.pacts.map((id) => PACTS[id].mods);
  if (world.chestCurse > 0) out.push({ damageTakenMult: SITES.chest.curseDamage });
  return out;
}

/**
 * Per step: entering a site (a shrine or merchant opens its panel via `siteOffer`; a rift starts;
 * a chest opens), the rift's elites and clock, and the chest's curse wearing off. Returns the
 * site whose panel should open, if any.
 */
export function updateSites(world: World, dt: number): Site | null {
  const s = world.snake;
  let open: Site | null = null;
  for (const site of world.sites) {
    const inside = dist(s.x, s.y, site.x, site.y) <= SITES.radius;
    const entered = inside && !site.inside;
    site.inside = inside;
    if (!entered || site.spent) continue;
    if (site.kind === 'shrine' || site.kind === 'merchant') open = site;
    else if (site.kind === 'chest') openChest(world, site);
    else if (site.kind === 'rift' && !world.rift && !world.boss && !world.descent && !world.finale) openRift(world, site);
  }
  updateRift(world, dt);
  if (world.chestCurse > 0) {
    world.chestCurse = Math.max(0, world.chestCurse - dt);
    if (world.chestCurse === 0) {
      refreshStats(world);
      floater(world, s.x, s.y - 30, 'The curse lifts', COLORS.unclear, { size: 16, life: 1 });
    }
  }
  return open;
}

/** Takes a shrine's pact or buys a merchant's ware. Returns false if it can't be had. */
export function chooseAtSite(world: World, siteId: number, choice: string): boolean {
  const site = world.sites.find((x) => x.id === siteId);
  if (!site || site.spent || !site.offer.includes(choice)) return false;
  const s = world.snake;
  if (site.kind === 'shrine') {
    const pact = choice as PactId;
    world.pacts.push(pact);
    site.spent = true;
    refreshStats(world);
    world.recap.pacts++;
    floater(world, s.x, s.y - 34, PACTS[pact].name, SITE_INFO.shrine.color, { size: 20, life: 1.4 });
    burst(world, site.x, site.y, SITE_INFO.shrine.color, 24, 260, { kind: 'glow', size: 8, life: 0.6 });
    world.sfx('evolve');
    return true;
  }
  if (site.kind !== 'merchant' || site.sold.includes(choice)) return false;
  const cost = wareCost(world, choice);
  if (cost > runShards(world)) return false;
  if (choice.startsWith('relic:')) {
    if (!takeRelic(world, choice.slice(6) as RelicId)) return false;
    refreshStats(world);
  } else if (choice === 'draught') {
    world.hp = Math.min(world.stats.maxHp, world.hp + world.stats.maxHp * 0.6);
  } else if (choice === 'tome') {
    gainXp(world, Math.max(0, xpToNext(world.level) - world.xp));
  } else {
    grantBuff(world, choice as TimedBuff);
  }
  world.spentShards += cost;
  site.sold.push(choice);
  world.recap.bought++;
  floater(world, s.x, s.y - 34, `Bought for ${cost} shards`, SITE_INFO.merchant.color, { size: 16, life: 1.2 });
  world.sfx('pickup');
  return true;
}

/** A cursed chest: a relic (or shards) at once, and foes that hit harder for a while, with guards. */
function openChest(world: World, site: Site): void {
  site.spent = true;
  const pool = world.relicPool.filter((id) => !world.relics.includes(id));
  let gift: string;
  if (pool.length > 0) {
    const relic = pool[Math.floor(world.rng() * pool.length) % pool.length];
    takeRelic(world, relic);
    gift = RELICS[relic].name;
  } else {
    world.bonusShards += SITES.chest.shards;
    gift = `${SITES.chest.shards} Arcane Shards`;
  }
  world.chestCurse = SITES.chest.curseTime;
  refreshStats(world);
  const roster = world.map.def.roster;
  for (let i = 0; i < SITES.chest.guards; i++) {
    const p = ringPoint(world);
    if (p) spawnElite(world, roster[i % 3], p.x, p.y);
  }
  world.recap.chests++;
  world.banner = { text: 'A cursed chest!', sub: `${gift} — but foes hit ${Math.round((SITES.chest.curseDamage - 1) * 100)}% harder for ${SITES.chest.curseTime}s`, t: 0, max: 3, color: SITE_INFO.chest.color };
  burst(world, site.x, site.y, SITE_INFO.chest.color, 30, 280, { kind: 'glow', size: 8, life: 0.7 });
  world.sfx('bossWarn');
}

function openRift(world: World, site: Site): void {
  site.spent = true;
  const need = SITES.rift.need + SITES.rift.perDepth * (world.depth - 1);
  world.rift = { siteId: site.id, t: 0, need, base: world.recap.elitesSlain, spawnAcc: SITES.rift.every };
  world.banner = { text: 'The rift tears open!', sub: `Defeat ${need} elites in ${SITES.rift.time}s for a relic`, t: 0, max: 2.6, color: SITE_INFO.rift.color };
  world.sfx('portal');
}

/** Elites slain since the rift opened. */
export function riftKills(world: World): number {
  return world.rift ? world.recap.elitesSlain - world.rift.base : 0;
}

function updateRift(world: World, dt: number): void {
  const r = world.rift;
  if (!r) return;
  r.t += dt;
  const site = world.sites.find((x) => x.id === r.siteId);
  if (riftKills(world) >= r.need) {
    world.rift = null;
    world.recap.rifts++;
    world.riftReward = true;
    if (site) burst(world, site.x, site.y, SITE_INFO.rift.color, 30, 300, { kind: 'glow', size: 8, life: 0.7 });
    return;
  }
  if (r.t >= SITES.rift.time || world.boss || world.descent || world.finale) {
    world.rift = null;
    world.banner = { text: 'The rift closes', sub: 'Too few elites fell in time', t: 0, max: 2, color: COLORS.unclear };
    return;
  }
  r.spawnAcc += dt;
  if (r.spawnAcc >= SITES.rift.every && site) {
    r.spawnAcc = 0;
    // Elites pour out near the rift, or just outside the view when it's far.
    const roster = world.map.def.roster;
    const near = dist(world.snake.x, world.snake.y, site.x, site.y) < 900;
    const a = world.rng() * TAU;
    const p = near ? { x: site.x + Math.cos(a) * 90, y: site.y + Math.sin(a) * 90 } : ringPoint(world);
    if (p) spawnElite(world, roster[Math.floor(world.rng() * 3) % 3], p.x, p.y);
  }
}

/** Seconds a rift has left (for the HUD). */
export function riftLeft(world: World): number {
  return world.rift ? clamp(SITES.rift.time - world.rift.t, 0, SITES.rift.time) : 0;
}

