import { audio } from './audio';
import { buffDuration, TIMED_BUFFS, updateBreakables, updateBuffs, updatePickups } from './breakables';
import { clampCamera, updateCamera } from './camera';
import { castPower, castTier, tierBonusLabel } from './cast';
import { ARENA, ASPECTS, BOSSES, BUFFS, CLEAN_CAST, DUOS, HAZARDS, EVOLUTIONS, GESTURE, HIT_STOP, SIM, SPELL_IDS, SPELL_INFO, SPELLS, type SpellId } from './config';
import { updateConstrict } from './constrict';
import { gainXp, hurtPlayer, updateContacts, updateCrystals, updateShots } from './combat';
import { leaveForNextMap, updateDescent } from './descent';
import { updateDirector, updateEnemies, updatePortals } from './enemies';
import { onIce, updateHazards } from './hazards';
import { burst, floater, updateEffects } from './effects';
import { recognize, type Pt } from './gesture';
import { InputManager } from './input';
import { defaultOptions, type GameOptions } from './options';
import { clamp, type Vec } from './math';
import { arenaPressure, IntensityTracker } from './music/mood';
import type { MusicScene } from './music/score';
import { COLORS } from './palette';
import type { RunResult } from './persistence';
import { applyChoice, banishFromOffer, rerollOffer, rollOffer, skipLevelUp } from './levelup';
import {
  computeReward,
  segmentsForLevel,
  spellCooldown,
  survivalXpRate,
  xpToNext,
  type MetaLevels,
  type UpgradeChoice,
} from './progression';
import { mapForIndex } from './maps';
import type { SolidName } from './maps/types';
import { Renderer } from './render';
import { afterSigil, hasRelic, offerRelics, takeRelic, updateRelics, type RelicId } from './relics';
import { shardMultiplier } from './curses';
import {
  castSpell,
  regenPerSecond,
  SIGIL_TO_SPELL,
  spawnBolt,
  tickCooldowns,
  SPELL_COLORS,
  spellName,
  updateBeams,
  updateBolts,
  updateEchoes,
  updateFrost,
  updateNovas,
  updateWard,
} from './spells';
import { castUltimate, ULTIMATES, ultimateCooldown, updateUltimate } from './ultimates';
import { createWorld, DEFAULT_SETUP, refreshStats, type GestureView, type RunSetup, type SigilReading, type TimedBuff, type World } from './world';

export type Phase = 'playing' | 'paused' | 'levelup' | 'relic' | 'dying' | 'gameover';

export interface HudSnapshot {
  hp: number;
  maxHp: number;
  xp: number;
  xpNext: number;
  level: number;
  time: number;
  kills: number;
  cooldowns: Record<SpellId, { remaining: number; total: number; cast: number; deny: number }>;
  /** Spells known this run, in HUD order, with their current (possibly evolved) names. */
  known: SpellId[];
  spellNames: Record<SpellId, string>;
  evolved: Record<SpellId, boolean>;
  depth: number;
  /** The map's name, as its look suggests (the Ember Depths below depth 1). */
  mapName: string;
  boss: { name: string; hp: number; maxHp: number; enraged: boolean } | null;
  bossIncoming: number | null;
  /** Timed buffs running now, with seconds left out of their full length. */
  buffs: { id: TimedBuff; left: number; total: number }[];
  /** Relics carried, in the order they were taken. */
  relics: RelicId[];
  /** The wizard's ultimate: its name, colour, cooldown and whether it's running. */
  ultimate: { name: string; color: string; remaining: number; total: number; active: number; flash: number };
}

/** The relics on the threshold of the way down (or at a waystone start), and where it leads. */
export interface RelicOffer {
  relics: RelicId[];
  nextMap: string;
  depth: number;
  /** A waystone start's catch-up: which of its relic choices this is. */
  draft: { n: number; total: number } | null;
}

/** A level-up's cards, and the tools left for an offer you don't like. */
export interface LevelUpOffer {
  level: number;
  choices: UpgradeChoice[];
  rerolls: number;
  banishes: number;
  /** A waystone start's catch-up draft: which of its level-ups this is. */
  draft: { n: number; total: number } | null;
}

export interface GameEvents {
  onPhase(phase: Phase): void;
  onLevelUp(offer: LevelUpOffer): void;
  /** The way down offers relics; answer with chooseRelic. */
  onRelicOffer(offer: RelicOffer): void;
  onGameOver(result: RunResult): void;
  onHud(hud: HudSnapshot): void;
  onToggleMute(): void;
  onToggleArt(): void;
}

function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class Game {
  private world: World;
  private readonly renderer: Renderer;
  private readonly input: InputManager;
  private phase: Phase = 'playing';
  private raf = 0;
  private last = 0;
  private acc = 0;
  private realTime = 0;
  private hudTimer = 0;
  private dyingTime = 0;
  private pendingLevelUps = 0;
  /** The level-up offer on screen, and the level it's for. */
  private offer: UpgradeChoice[] = [];
  private offerLevel = 1;
  /** A waystone start's catch-up in progress: relic choices made so far, and level-ups drafted in all. */
  private draftRelics = { n: 0, total: 0 };
  private draftLevels = 0;
  private finished = false;
  private destroyed = false;
  private runId = newRunId();
  private intensity = new IntensityTracker();
  private readonly gesture: GestureView = { active: false, points: [], target: null, fade: null, reading: null };
  /** Seconds until the stroke being drawn is read again (live trail tint). */
  private readTimer = 0;
  private options: GameOptions = defaultOptions();

  constructor(
    canvas: HTMLCanvasElement,
    private meta: MetaLevels,
    private readonly events: GameEvents,
    pixelArt = false,
    private setup: RunSetup = DEFAULT_SETUP,
    options?: GameOptions,
  ) {
    this.world = this.makeWorld();
    this.renderer = new Renderer(canvas, pixelArt);
    this.input = new InputManager(canvas, {
      onPause: () => this.togglePause(),
      onUltimate: () => this.castUltimate(),
      onToggleMute: () => this.events.onToggleMute(),
      onToggleArt: () => this.events.onToggleArt(),
      onGestureStart: (p) => this.beginGesture(p),
      onGestureEnd: (pts) => this.endGesture(pts),
      onGestureCancel: () => this.cancelGestureView(),
      onFocusLost: () => this.pause(),
      onResize: () => {
        this.renderer.resize();
        this.syncView();
      },
      onUserGesture: () => audio.unlock(),
    });
    this.syncView();
    if (options) this.setOptions(options);
  }

  /** Gives the camera the view size the renderer fits to the window. */
  private syncView(): void {
    const cam = this.world.camera;
    cam.viewW = this.renderer.viewW;
    cam.viewH = this.renderer.viewH;
    clampCamera(cam, this.world.map.width, this.world.map.height);
  }

  /** Applies the player's options (shake, flashing, warnings, speed, keys); safe mid-run. */
  setOptions(options: GameOptions): void {
    if (options.bindings !== this.options.bindings) this.input.setBindings(options.bindings);
    this.options = options;
    this.renderer.view = options;
  }

  private makeWorld(): World {
    const setup = { ...this.setup, startDepth: this.setup.startDepth ?? devStartDepth() };
    return createWorld(this.meta, (name) => audio.play(name, name === 'pickup' ? this.world.pickupPitch : 0), Date.now(), setup);
  }

  start(): void {
    this.input.attach();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.events.onPhase(this.phase);
    this.emitHud();
    this.beginDraft();
  }

  /**
   * A waystone start catches up before play (M2): a relic choice for each map skipped, then a
   * draft of level-ups through the usual panel. The clock doesn't run until it's done.
   */
  private beginDraft(): void {
    const draft = this.world.draft;
    if (!draft) return;
    this.draftRelics = { n: 0, total: draft.relics };
    this.draftLevels = 0;
    this.nextDraftStep();
  }

  private nextDraftStep(): void {
    const w = this.world;
    const draft = w.draft;
    if (!draft) return;
    if (draft.relics > 0) {
      const offer = offerRelics(w, Math.random, w.mapIndex);
      if (offer.length > 0) {
        w.relicOffer = offer;
        this.draftRelics.n++;
        this.setPhase('relic');
        this.events.onRelicOffer({ relics: [...offer], nextMap: w.map.def.name, depth: w.depth, draft: { ...this.draftRelics } });
        return;
      }
      draft.relics = 0;
    }
    const levels = draft.levels;
    w.draft = null;
    if (levels <= 0) {
      this.setPhase('playing');
      return;
    }
    // Every level of the catch-up at once: the body grows to match, then each is drafted in turn.
    w.level += levels;
    w.snake.segmentTarget = w.snake.segmentCount = segmentsForLevel(w.level);
    w.snake.updateSegments();
    refreshStats(w);
    w.hp = w.stats.maxHp;
    this.draftLevels = levels;
    this.pendingLevelUps = levels;
    this.offerLevelUp();
  }

  /** Finishes a waystone draft at once, taking the first card of each offer. */
  autoDraft(): void {
    if (this.phase !== 'levelup' || this.draftLevels === 0) return;
    const w = this.world;
    while (this.pendingLevelUps > 0) {
      const pick = this.offer[0];
      if (pick) applyChoice(w, pick);
      this.pendingLevelUps--;
      if (this.pendingLevelUps > 0) {
        this.offerLevel = w.level - this.pendingLevelUps + 1;
        this.offer = rollOffer(w, this.offerLevel, Math.random);
      }
    }
    w.hp = w.stats.maxHp;
    audio.play('evolve');
    this.pendingLevelUps = 1;
    this.nextLevelUp();
  }

  destroy(): void {
    // The flag guarantees a destroyed game never steps, renders or banks a run,
    // even if a frame callback was already queued.
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.input.detach();
  }

  getPhase(): Phase {
    return this.phase;
  }

  /** Switches between the classic and pixel-art renderers; safe mid-run. */
  setPixelArt(on: boolean): void {
    if (on === this.renderer.pixelArt) return;
    // The view transform changes, so an in-progress stroke's screen points would no longer match.
    this.input.cancelGesture();
    this.renderer.setPixelArt(on);
    this.syncView();
  }

  private setPhase(p: Phase): void {
    if (this.phase === p) return;
    this.phase = p;
    // Any phase change abandons unfinished drawing and releases held keys.
    this.input.clearAll();
    this.acc = 0;
    this.events.onPhase(p);
    this.emitHud();
  }

  pause(): void {
    if (this.phase === 'playing') this.setPhase('paused');
  }

  resume(): void {
    if (this.phase === 'paused') {
      this.last = performance.now();
      this.setPhase('playing');
    }
  }

  togglePause(): void {
    if (this.phase === 'playing') this.pause();
    else if (this.phase === 'paused') this.resume();
  }

  restart(meta: MetaLevels = this.meta, setup: RunSetup = this.setup): void {
    this.meta = meta;
    this.setup = setup;
    this.world = this.makeWorld();
    this.syncView();
    this.runId = newRunId();
    this.intensity = new IntensityTracker();
    this.finished = false;
    this.pendingLevelUps = 0;
    this.dyingTime = 0;
    this.gesture.fade = null;
    this.gesture.target = null;
    this.last = performance.now();
    this.phase = 'gameover';
    this.setPhase('playing');
    this.beginDraft();
  }

  /** Ends the run from the pause menu; rewards are still banked. */
  endRun(): void {
    if (this.phase === 'paused' || this.phase === 'playing') this.finishRun();
  }

  chooseUpgrade(choice: UpgradeChoice): void {
    if (this.phase !== 'levelup' || !this.offer.some((c) => c.id === choice.id)) return;
    const w = this.world;
    const s = w.snake;
    applyChoice(w, choice);
    let label = choice.name;
    let color: string = COLORS.nova;
    let fanfare = false;
    if (choice.kind === 'learn' && choice.spell) {
      label = `New sigil: ${SPELLS[choice.spell].name}`;
      color = SPELL_COLORS[choice.spell];
      fanfare = true;
    } else if (choice.kind === 'evolve' && choice.spell) {
      label = `${SPELLS[choice.spell].name} → ${EVOLUTIONS[choice.spell].name}`;
      color = SPELL_COLORS[choice.spell];
      burst(w, s.x, s.y, '#ffffff', 30, 340, { kind: 'shard', size: 4, life: 0.7 });
      fanfare = true;
    } else if (choice.kind === 'aspect' && choice.aspect) {
      const spell = ASPECTS[choice.aspect].spell;
      label = `${SPELLS[spell].name}: ${choice.name}`;
      color = SPELL_COLORS[spell];
      fanfare = true;
    } else if (choice.kind === 'duo' && choice.duo) {
      label = `Duo: ${DUOS[choice.duo].name}`;
      color = COLORS.nova;
      burst(w, s.x, s.y, '#ffffff', 36, 380, { kind: 'shard', size: 4, life: 0.8 });
      fanfare = true;
    }
    audio.play(fanfare ? 'evolve' : 'select');
    burst(w, s.x, s.y, color, 24, 260, { kind: 'glow', size: 8, life: 0.5 });
    floater(w, s.x, s.y - 30, label, color, { size: 18, life: 1.4 });
    this.nextLevelUp();
  }

  /** Casts the wizard's ultimate, from its key or the HUD card. */
  castUltimate(): void {
    if (this.phase !== 'playing') return;
    const w = this.world;
    if (!castUltimate(w)) {
      const left = w.ult.active > 0 ? 0 : w.ult.cooldown;
      if (left > 0) floater(w, w.snake.x, w.snake.y - 40, `${ULTIMATES[w.ult.id].name} recharging ${Math.ceil(left)}s`, '#b9c4ff', { size: 16, life: 0.9 });
      audio.play('cooldown');
    }
    this.emitHud();
  }

  /** Takes a relic from the way down's offer (or none, to heal instead) and descends; at a waystone start, the draft goes on. */
  chooseRelic(relic: RelicId | null): void {
    if (this.phase !== 'relic') return;
    const w = this.world;
    audio.play(relic ? 'evolve' : 'select');
    this.last = performance.now();
    if (w.draft) {
      if (relic && w.relicOffer?.includes(relic)) {
        takeRelic(w, relic);
        refreshStats(w);
      }
      w.relicOffer = null;
      w.draft.relics--;
      this.nextDraftStep();
      return;
    }
    leaveForNextMap(w, relic);
    this.setPhase('playing');
  }

  /** Spends a reroll on a fresh offer. */
  rerollLevelUp(): void {
    if (this.phase !== 'levelup') return;
    const offer = rerollOffer(this.world, this.offerLevel, Math.random);
    if (!offer) return;
    this.offer = offer;
    audio.play('select');
    this.emitOffer();
  }

  /** Spends a banish: the card is gone for the run and a new one takes its place. */
  banishChoice(choice: UpgradeChoice): void {
    if (this.phase !== 'levelup') return;
    const offer = banishFromOffer(this.world, this.offer, choice, this.offerLevel, Math.random);
    if (!offer) return;
    this.offer = offer;
    audio.play('wall');
    this.emitOffer();
  }

  /** Takes no card and heals a little instead. */
  skipLevelUp(): void {
    if (this.phase !== 'levelup') return;
    const w = this.world;
    const healed = skipLevelUp(w);
    floater(w, w.snake.x, w.snake.y - 30, healed > 0 ? `Skipped · +${Math.round(healed)} health` : 'Skipped', '#9fe8a0', { size: 16, life: 1.2 });
    audio.play('select');
    this.nextLevelUp();
  }

  /** Moves on to the next waiting level-up, or back to play. */
  private nextLevelUp(): void {
    this.pendingLevelUps--;
    if (this.pendingLevelUps > 0) {
      this.offerLevelUp();
    } else {
      this.offer = [];
      this.draftLevels = 0;
      this.last = performance.now();
      this.setPhase('playing');
    }
  }

  private offerLevelUp(): void {
    const w = this.world;
    this.offerLevel = w.level - this.pendingLevelUps + 1;
    this.offer = rollOffer(w, this.offerLevel, Math.random);
    this.setPhase('levelup');
    this.emitOffer();
  }

  private emitOffer(): void {
    const w = this.world;
    const draft = this.draftLevels > 0 ? { n: this.draftLevels - this.pendingLevelUps + 1, total: this.draftLevels } : null;
    this.events.onLevelUp({ level: this.offerLevel, choices: this.offer, rerolls: w.rerolls, banishes: w.banishes, draft });
  }

  // ------------------------------------------------------------ gestures

  private beginGesture(p: Pt): boolean {
    if (this.phase !== 'playing') return false;
    const t = this.renderer.screenToWorld(p);
    const b = this.world.map.bounds;
    this.gesture.target = { x: clamp(t.x, b.minX, b.maxX), y: clamp(t.y, b.minY, b.maxY) };
    this.gesture.active = true;
    return true;
  }

  private cancelGestureView(): void {
    this.gesture.active = false;
    this.gesture.target = null;
    this.gesture.points = [];
    this.gesture.reading = null;
  }

  /** What the stroke so far reads as, for the live trail tint. */
  private readStroke(points: Pt[]): SigilReading | null {
    const r = recognize(points);
    if (!r.kind) return null;
    const spell = SIGIL_TO_SPELL[r.kind];
    return { kind: r.kind, spell, known: this.world.known.includes(spell), tier: castTier(r.kind, r.score) };
  }

  private endGesture(points: Pt[]): void {
    const target = this.gesture.target;
    this.cancelGestureView();
    if (this.phase !== 'playing') return;
    const w = this.world;
    const result = recognize(points);
    if (result.reason === 'tiny') return;
    const c = centroid(points);
    const fy = c.y - 40;
    if (!result.kind) {
      floater(w, c.x, fy, 'Sigil unclear', COLORS.unclear, { size: 22, life: 0.9, screen: true });
      this.gesture.fade = { points, color: COLORS.unclear, t: 0 };
      audio.play('unclear');
      return;
    }
    const spell = SIGIL_TO_SPELL[result.kind];
    const name = spellName(w, spell);
    if (!w.known.includes(spell)) {
      // A real sigil this serpent hasn't learned yet: say so, and that level-ups teach it.
      floater(w, c.x, fy, `${SPELL_INFO[spell].shape}: ${name} not learned yet`, COLORS.unclear, { size: 18, life: 1.1, screen: true });
      this.gesture.fade = { points, color: '#8090c0', t: 0 };
      audio.play('unclear');
      return;
    }
    if (w.cooldowns[spell] > 0) {
      floater(w, c.x, fy, `${name} recharging ${w.cooldowns[spell].toFixed(1)}s`, '#b9c4ff', {
        size: 18,
        life: 0.9,
        screen: true,
      });
      w.denyFlash[spell] = 1;
      this.gesture.fade = { points, color: '#8090c0', t: 0 };
      audio.play('cooldown');
      return;
    }
    // A cleanly drawn sigil is stronger.
    const tier = castTier(result.kind, result.score);
    castSpell(w, spell, target, castPower(tier));
    w.recap.casts[tier]++;
    const cd = spellCooldown(spell, w.stats);
    w.cooldowns[spell] = cd;
    w.cooldownTotals[spell] = cd;
    afterSigil(w, spell, tier === 'perfect', () => castSpell(w, spell, target, castPower(tier)));
    w.castFlash[spell] = 1;
    floater(w, c.x, fy, `${name}!`, SPELL_COLORS[spell], { size: 24, life: 0.9, screen: true });
    if (tier !== 'rough') {
      floater(w, c.x, fy + 26, `${tier === 'perfect' ? 'Perfect' : 'Clean'} ${tierBonusLabel(tier)}`, tier === 'perfect' ? COLORS.nova : '#dfe8ff', {
        size: tier === 'perfect' ? 18 : 15,
        life: 0.9,
        screen: true,
      });
      if (tier === 'perfect') audio.play('perfect');
    }
    this.gesture.fade = { points, color: SPELL_COLORS[spell], t: 0 };
  }

  // ------------------------------------------------------------ loop

  private frame = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(SIM.maxFrame, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.realTime += dt;

    if (this.phase === 'playing' || this.phase === 'dying') {
      const w = this.world;
      // The game-speed option slows the whole simulation; drawing stays in real time.
      let scale = (this.phase === 'dying' ? SIM.dyingTimeScale : 1) * this.options.gameSpeed;
      // Hit-stop and slow motion run on real time, so they last the same at any frame rate.
      w.hitStopGap = Math.max(0, w.hitStopGap - dt);
      if (w.hitStop > 0) {
        w.hitStop = Math.max(0, w.hitStop - dt);
        scale = 0;
      } else if (w.slowMo > 0) {
        w.slowMo = Math.max(0, w.slowMo - dt);
        scale *= HIT_STOP.slowMoScale;
      }
      this.acc += dt * scale;
      let steps = 0;
      while (this.acc >= SIM.step && steps < SIM.maxSubSteps) {
        this.step(SIM.step);
        this.acc -= SIM.step;
        steps++;
        if (this.phase !== 'playing' && this.phase !== 'dying') break;
        if (w.hitStop > 0) {
          // A big hit just landed: freeze from this exact step.
          this.acc = 0;
          break;
        }
      }
      if (steps >= SIM.maxSubSteps) this.acc = 0;
    }
    this.updateMusic(dt);

    if (this.phase === 'dying') {
      this.dyingTime += dt;
      if (this.dyingTime >= SIM.dyingDuration) this.finishRun();
    }

    if (this.gesture.fade) {
      this.gesture.fade.t += dt / GESTURE.trailFade;
      if (this.gesture.fade.t >= 1) this.gesture.fade = null;
    }
    this.gesture.active = this.input.isDrawing && this.phase === 'playing';
    this.gesture.points = this.input.points;
    if (this.gesture.active && this.gesture.points.length > 3) {
      this.readTimer -= dt;
      if (this.readTimer <= 0) {
        this.readTimer = CLEAN_CAST.liveInterval;
        this.gesture.reading = this.readStroke(this.gesture.points);
      }
    } else {
      this.gesture.reading = null;
      this.readTimer = 0;
    }

    const showSnake = this.phase !== 'dying' && this.phase !== 'gameover';
    this.renderer.render(this.world, this.gesture, this.realTime, showSnake);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 1 / SIM.hudHz;
      this.emitHud();
    }
  };

  private step(dt: number): void {
    const w = this.world;
    const dying = this.phase === 'dying';
    w.time += dying ? 0 : dt;

    if (!dying) {
      gainXp(w, survivalXpRate(w.time) * dt);
      const dir = this.input.direction();
      this.input.endStep();
      w.snake.speedMult = w.buffs.swiftscale > 0 ? BUFFS.swiftscale.speed : 1;
      w.snake.turnMult = onIce(w, w.snake.x, w.snake.y) && !hasRelic(w, 'rimewalker') ? HAZARDS.ice.turn : 1;
      const hit = w.snake.update(dt, dir.x, dir.y, w.map);
      if (hit) this.onWallHit(hit);
      updateBreakables(w, dt);
      updateCamera(w.camera, w.snake, w.map.width, w.map.height, dt, this.options.steadyCamera);
      updateConstrict(w, dt);
      updateRelics(w, dt, (x, y, a, damage) => spawnBolt(w, x, y, a, damage, 0, SPELLS.bolt.radius));
      updateUltimate(w, dt);
    }

    updateDirector(w, dying ? 0 : dt);
    updatePortals(w, dt);
    updateEnemies(w, dt);
    updateBolts(w, dt);
    updateNovas(w, dt);
    updateFrost(w, dt);
    updateBeams(w, dt);
    updateWard(w, dt);
    if (!dying) updateEchoes(w);
    if (!dying) {
      updateShots(w, dt);
      updateContacts(w);
      updateHazards(w, dt);
      updateCrystals(w, dt);
      updatePickups(w, dt);
      updateBuffs(w, dt);
      // Last: stepping into the way down offers relics, then swaps the whole map.
      updateDescent(w, dt);
      if (w.relicOffer) {
        this.setPhase('relic');
        this.events.onRelicOffer({ relics: [...w.relicOffer], nextMap: mapForIndex(w.mapIndex + 1).name, depth: w.depth + 1, draft: null });
        return;
      }
    }
    w.fade = Math.max(0, w.fade - dt);

    tickCooldowns(w, dt);
    w.invuln = Math.max(0, w.invuln - dt);
    const regen = regenPerSecond(w);
    if (regen > 0 && w.hp > 0 && w.hp < w.stats.maxHp) {
      w.hp = Math.min(w.stats.maxHp, w.hp + regen * dt);
    }
    updateEffects(w, dt);

    if (dying) return;

    if (w.hp <= 0) {
      this.die();
      return;
    }

    let gained = 0;
    while (w.xp >= xpToNext(w.level)) {
      w.xp -= xpToNext(w.level);
      w.level++;
      gained++;
    }
    if (gained > 0) {
      w.snake.segmentTarget = segmentsForLevel(w.level);
      // The Ouroboros Coil grows with the body.
      refreshStats(w);
      this.pendingLevelUps += gained;
      audio.play('levelup');
      this.offerLevelUp();
    }
  }

  private onWallHit(solid: SolidName): void {
    const w = this.world;
    const s = w.snake;
    burst(w, s.x, s.y, '#c9b8ff', 10, 200, { size: 3, life: 0.35 });
    // The map's own walls go by its name for them ("the catacomb walls").
    if (!hurtPlayer(w, ARENA.wallDamage, { kind: 'wall', attack: solid === 'wall' ? w.map.def.wallName : solid })) audio.play('wall');
  }

  /** Picks the soundtrack arrangement: layered by danger, a hush before the boss, its theme during the fight. */
  private updateMusic(dt: number): void {
    const w = this.world;
    if (this.phase === 'playing') this.intensity.update(arenaPressure(w), dt);
    let scene: MusicScene;
    if (this.phase === 'dying') scene = 'silent';
    else if (this.phase === 'gameover') scene = 'calm';
    else if (w.boss) scene = w.boss.enraged ? 'boss2' : 'boss1';
    else if (w.bossWarned || w.portals.some((p) => p.kind === 'boss')) scene = 'warning';
    else scene = (['run0', 'run1', 'run2'] as const)[this.intensity.level];
    audio.setMusicScene(scene);
  }

  private die(): void {
    const w = this.world;
    const s = w.snake;
    burst(w, s.x, s.y, COLORS.snakeBody, 40, 360, { size: 4, life: 0.9 });
    for (const seg of s.segments) burst(w, seg.x, seg.y, COLORS.snakeBody, 3, 200, { size: 3.5, life: 0.8 });
    burst(w, s.x, s.y, COLORS.hat, 20, 260, { kind: 'glow', size: 10, life: 0.8 });
    w.shake = 1;
    audio.play('death');
    this.dyingTime = 0;
    this.setPhase('dying');
  }

  private finishRun(): void {
    if (this.finished || this.destroyed) return;
    this.finished = true;
    const w = this.world;
    const summary = { time: w.time, kills: w.kills, level: w.level, bossKills: w.bossKills, shardMult: shardMultiplier(w.curses), bonusShards: w.bonusShards, heat: w.heat };
    const result: RunResult = {
      ...summary,
      runId: this.runId,
      reward: computeReward(summary),
      recap: w.recap,
      wizard: w.wizard,
      curses: [...w.curses],
      gameSpeed: this.options.gameSpeed < 1 ? this.options.gameSpeed : undefined,
      depth: w.recap.depth,
      maps: [...w.visited],
      breakables: w.recap.breakables,
      relics: [...w.relics],
    };
    this.setPhase('gameover');
    this.events.onGameOver(result);
  }

  private emitHud(): void {
    const w = this.world;
    const cds = {} as HudSnapshot['cooldowns'];
    for (const id of Object.keys(w.cooldowns) as SpellId[]) {
      cds[id] = {
        remaining: w.cooldowns[id],
        total: w.cooldownTotals[id],
        cast: w.castFlash[id],
        deny: w.denyFlash[id],
      };
    }
    const incoming = w.nextBossTime - w.time;
    this.events.onHud({
      hp: Math.ceil(w.hp),
      maxHp: w.stats.maxHp,
      xp: w.xp,
      xpNext: xpToNext(w.level),
      level: w.level,
      time: w.time,
      kills: w.kills,
      cooldowns: cds,
      known: [...w.known],
      spellNames: Object.fromEntries(SPELL_IDS.map((id) => [id, spellName(w, id)])) as Record<SpellId, string>,
      evolved: { ...w.evolved },
      depth: w.depth,
      mapName: w.map.def.name,
      boss: w.boss
        ? { name: BOSSES[w.boss.bossId].name, hp: Math.max(0, w.boss.hp), maxHp: w.boss.maxHp, enraged: w.boss.enraged }
        : null,
      bossIncoming: !w.boss && incoming <= 30 && incoming > 0 ? incoming : null,
      buffs: TIMED_BUFFS.filter((id) => w.buffs[id] > 0).map((id) => ({ id, left: w.buffs[id], total: buffDuration(id) })),
      relics: [...w.relics],
      ultimate: {
        name: ULTIMATES[w.ult.id].name,
        color: ULTIMATES[w.ult.id].color,
        remaining: w.ult.cooldown,
        total: w.ult.cooldown > 0 ? w.ult.total : ultimateCooldown(w),
        active: w.ult.active,
        flash: w.ult.flash,
      },
    });
  }

  /** Test/debug hook used by the play-test harness in the browser console. */
  debug(): { world: World; phase: Phase } {
    return { world: this.world, phase: this.phase };
  }
}

function centroid(points: Pt[]): Vec {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Development only: `?depth=N` starts each run N maps down, on that depth's map. */
function devStartDepth(): number | undefined {
  if (!import.meta.env.DEV || typeof location === 'undefined') return undefined;
  const n = Number(new URLSearchParams(location.search).get('depth'));
  return n >= 1 ? Math.floor(n) : undefined;
}
