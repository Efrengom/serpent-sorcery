import { audio } from './audio';
import { ARENA, ENEMIES, EVOLUTIONS, GESTURE, HIT_STOP, SIM, SPELL_IDS, SPELL_INFO, SPELLS, type SpellId } from './config';
import { gainXp, hurtPlayer, updateContacts, updateCrystals, updateShots } from './combat';
import { updateDirector, updateEnemies, updatePortals } from './enemies';
import { burst, floater, updateEffects } from './effects';
import { recognize, type Pt } from './gesture';
import { InputManager } from './input';
import { clamp, type Vec } from './math';
import { arenaPressure, IntensityTracker } from './music/mood';
import type { MusicScene } from './music/score';
import { COLORS } from './palette';
import type { RunResult } from './persistence';
import {
  applyUpgrade,
  computeReward,
  computeStats,
  RESTORE_HEAL,
  rollUpgradeChoices,
  segmentsForLevel,
  spellCooldown,
  survivalXpRate,
  xpToNext,
  type MetaLevels,
  type UpgradeChoice,
} from './progression';
import { Renderer } from './render';
import { PLAY_AREA } from './snake';
import { shardMultiplier } from './curses';
import {
  castSpell,
  SIGIL_TO_SPELL,
  SPELL_COLORS,
  spellName,
  updateBeams,
  updateBolts,
  updateEchoes,
  updateFrost,
  updateNovas,
  updateWard,
} from './spells';
import { createWorld, DEFAULT_SETUP, type GestureView, type RunSetup, type World } from './world';

export type Phase = 'playing' | 'paused' | 'levelup' | 'dying' | 'gameover';

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
  boss: { name: string; hp: number; maxHp: number; enraged: boolean } | null;
  bossIncoming: number | null;
}

export interface GameEvents {
  onPhase(phase: Phase): void;
  onLevelUp(level: number, choices: UpgradeChoice[]): void;
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
  private finished = false;
  private destroyed = false;
  private runId = newRunId();
  private intensity = new IntensityTracker();
  private readonly gesture: GestureView = { active: false, points: [], target: null, fade: null };

  constructor(
    canvas: HTMLCanvasElement,
    private meta: MetaLevels,
    private readonly events: GameEvents,
    pixelArt = false,
    private setup: RunSetup = DEFAULT_SETUP,
  ) {
    this.world = this.makeWorld();
    this.renderer = new Renderer(canvas, pixelArt);
    this.input = new InputManager(canvas, {
      onEscape: () => this.togglePause(),
      onToggleMute: () => this.events.onToggleMute(),
      onToggleArt: () => this.events.onToggleArt(),
      onGestureStart: (p) => this.beginGesture(p),
      onGestureEnd: (pts) => this.endGesture(pts),
      onGestureCancel: () => this.cancelGestureView(),
      onFocusLost: () => this.pause(),
      onResize: () => this.renderer.resize(),
      onUserGesture: () => audio.unlock(),
    });
  }

  private makeWorld(): World {
    return createWorld(this.meta, (name) => audio.play(name, name === 'pickup' ? this.world.pickupPitch : 0), Date.now(), this.setup);
  }

  start(): void {
    this.input.attach();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.events.onPhase(this.phase);
    this.emitHud();
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
  }

  /** Ends the run from the pause menu; rewards are still banked. */
  endRun(): void {
    if (this.phase === 'paused' || this.phase === 'playing') this.finishRun();
  }

  chooseUpgrade(choice: UpgradeChoice): void {
    if (this.phase !== 'levelup') return;
    const w = this.world;
    const s = w.snake;
    let label = choice.name;
    let color: string = COLORS.nova;
    if (choice.kind === 'restore') {
      w.hp = Math.min(w.stats.maxHp, w.hp + RESTORE_HEAL);
      audio.play('select');
    } else if (choice.kind === 'learn' && choice.spell) {
      if (!w.known.includes(choice.spell)) w.known.push(choice.spell);
      w.cooldowns[choice.spell] = 0;
      label = `New sigil: ${SPELLS[choice.spell].name}`;
      color = SPELL_COLORS[choice.spell];
      audio.play('evolve');
    } else if (choice.kind === 'evolve' && choice.spell) {
      w.evolved[choice.spell] = true;
      w.cooldowns[choice.spell] = 0;
      label = `${SPELLS[choice.spell].name} → ${EVOLUTIONS[choice.spell].name}`;
      color = SPELL_COLORS[choice.spell];
      burst(w, s.x, s.y, '#ffffff', 30, 340, { kind: 'shard', size: 4, life: 0.7 });
      audio.play('evolve');
    } else if (choice.upgrade) {
      const prevMax = w.stats.maxHp;
      w.upgrades = applyUpgrade(w.upgrades, choice.upgrade);
      w.stats = computeStats(w.upgrades, w.meta, w.mods);
      if (choice.upgrade === 'vitality') w.hp += w.stats.maxHp - prevMax + 30;
      w.hp = Math.min(w.stats.maxHp, w.hp);
      // Refresh cooldown totals so HUD sweeps match the new cooldowns.
      for (const id of SPELL_IDS) w.cooldowns[id] = Math.min(w.cooldowns[id], spellCooldown(id, w.stats));
      audio.play('select');
    }
    burst(w, s.x, s.y, color, 24, 260, { kind: 'glow', size: 8, life: 0.5 });
    floater(w, s.x, s.y - 30, label, color, { size: 18, life: 1.4 });
    this.pendingLevelUps--;
    if (this.pendingLevelUps > 0) {
      this.offerLevelUp();
    } else {
      this.last = performance.now();
      this.setPhase('playing');
    }
  }

  private offerLevelUp(): void {
    const w = this.world;
    const levelShown = w.level - this.pendingLevelUps + 1;
    const choices = rollUpgradeChoices(
      w.upgrades,
      w.meta,
      Math.random,
      3,
      { known: w.known, evolved: w.evolved, level: levelShown },
      w.mods,
    );
    this.setPhase('levelup');
    this.events.onLevelUp(levelShown, choices);
  }

  // ------------------------------------------------------------ gestures

  private beginGesture(p: Pt): boolean {
    if (this.phase !== 'playing') return false;
    const t = this.renderer.screenToWorld(p);
    this.gesture.target = {
      x: clamp(t.x, PLAY_AREA.minX, PLAY_AREA.maxX),
      y: clamp(t.y, PLAY_AREA.minY, PLAY_AREA.maxY),
    };
    this.gesture.active = true;
    return true;
  }

  private cancelGestureView(): void {
    this.gesture.active = false;
    this.gesture.target = null;
    this.gesture.points = [];
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
    castSpell(w, spell, target);
    const cd = spellCooldown(spell, w.stats);
    w.cooldowns[spell] = cd;
    w.cooldownTotals[spell] = cd;
    w.castFlash[spell] = 1;
    floater(w, c.x, fy, `${name}!`, SPELL_COLORS[spell], { size: 24, life: 0.9, screen: true });
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
      let scale = this.phase === 'dying' ? SIM.dyingTimeScale : 1;
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
      if (w.snake.update(dt, dir.x, dir.y)) this.onWallHit();
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
      updateCrystals(w, dt);
    }

    for (const id of Object.keys(w.cooldowns) as SpellId[]) {
      w.cooldowns[id] = Math.max(0, w.cooldowns[id] - dt);
      w.castFlash[id] = Math.max(0, w.castFlash[id] - dt * 3);
      w.denyFlash[id] = Math.max(0, w.denyFlash[id] - dt * 3);
    }
    w.invuln = Math.max(0, w.invuln - dt);
    if (w.stats.regenPerSec > 0 && w.hp > 0 && w.hp < w.stats.maxHp) {
      w.hp = Math.min(w.stats.maxHp, w.hp + w.stats.regenPerSec * dt);
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
      this.pendingLevelUps += gained;
      audio.play('levelup');
      this.offerLevelUp();
    }
  }

  private onWallHit(): void {
    const w = this.world;
    const s = w.snake;
    burst(w, s.x, s.y, '#c9b8ff', 10, 200, { size: 3, life: 0.35 });
    if (!hurtPlayer(w, ARENA.wallDamage, { kind: 'wall', attack: 'wall' })) audio.play('wall');
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
    const summary = { time: w.time, kills: w.kills, level: w.level, bossKills: w.bossKills, shardMult: shardMultiplier(w.curses) };
    const result: RunResult = {
      ...summary,
      runId: this.runId,
      reward: computeReward(summary),
      recap: w.recap,
      wizard: w.wizard,
      curses: [...w.curses],
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
      boss: w.boss
        ? { name: ENEMIES.boss.name, hp: Math.max(0, w.boss.hp), maxHp: w.boss.maxHp, enraged: w.boss.enraged }
        : null,
      bossIncoming: !w.boss && incoming <= 30 && incoming > 0 ? incoming : null,
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
