import { audio } from './audio';
import { ARENA, ENEMIES, GESTURE, SIM, SPELLS, type SpellId } from './config';
import { gainXp, hurtPlayer, updateContacts, updateCrystals, updateShots } from './combat';
import { updateDirector, updateEnemies, updatePortals } from './enemies';
import { burst, floater, updateEffects } from './effects';
import { recognize, type Pt } from './gesture';
import { InputManager } from './input';
import { clamp, type Vec } from './math';
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
import { castSpell, SIGIL_TO_SPELL, SPELL_COLORS, updateBolts, updateNovas } from './spells';
import { createWorld, type GestureView, type World } from './world';

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
  private readonly gesture: GestureView = { active: false, points: [], target: null, fade: null };

  constructor(
    canvas: HTMLCanvasElement,
    private meta: MetaLevels,
    private readonly events: GameEvents,
    pixelArt = false,
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
    return createWorld(this.meta, (name) => audio.play(name, name === 'pickup' ? this.world.pickupPitch : 0));
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

  restart(meta: MetaLevels = this.meta): void {
    this.meta = meta;
    this.world = this.makeWorld();
    this.runId = newRunId();
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
    if (choice.id === 'restore') {
      w.hp = Math.min(w.stats.maxHp, w.hp + RESTORE_HEAL);
    } else {
      const prevMax = w.stats.maxHp;
      w.upgrades = applyUpgrade(w.upgrades, choice.id);
      w.stats = computeStats(w.upgrades, w.meta);
      if (choice.id === 'vitality') w.hp += w.stats.maxHp - prevMax + 30;
      w.hp = Math.min(w.stats.maxHp, w.hp);
      // Refresh cooldown totals so HUD sweeps match the new cooldowns.
      for (const id of Object.keys(w.cooldowns) as SpellId[]) {
        w.cooldowns[id] = Math.min(w.cooldowns[id], spellCooldown(id, w.stats));
      }
    }
    audio.play('select');
    const s = w.snake;
    burst(w, s.x, s.y, COLORS.nova, 24, 260, { kind: 'glow', size: 8, life: 0.5 });
    floater(w, s.x, s.y - 30, choice.name, COLORS.nova, { size: 18, life: 1.2 });
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
    const choices = rollUpgradeChoices(w.upgrades, w.meta, Math.random);
    const levelShown = w.level - this.pendingLevelUps + 1;
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
    const name = SPELLS[spell].name;
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
      const scale = this.phase === 'dying' ? SIM.dyingTimeScale : 1;
      this.acc += dt * scale;
      let steps = 0;
      while (this.acc >= SIM.step && steps < SIM.maxSubSteps) {
        this.step(SIM.step);
        this.acc -= SIM.step;
        steps++;
        if (this.phase !== 'playing' && this.phase !== 'dying') break;
      }
      if (steps >= SIM.maxSubSteps) this.acc = 0;
    }

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
    if (!hurtPlayer(w, ARENA.wallDamage)) audio.play('wall');
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
    const summary = { time: w.time, kills: w.kills, level: w.level, bossKills: w.bossKills };
    const result: RunResult = { ...summary, runId: this.runId, reward: computeReward(summary) };
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
