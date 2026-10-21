import {
  ARP_ORDER,
  arpTones,
  BASS_CALM,
  bassRoot,
  LAYERS,
  prepareTheme,
  SCENES,
  STEPS_PER_BAR,
  stepSeconds,
  THEMES,
  type LayerId,
  type MusicScene,
  type ParsedTheme,
  type ThemeId,
} from './score';
import { crash, createInstruments, hat, kick, pulseNote, snare, triNote, type Instruments } from './synth';

/**
 * Loudness of each layer at full mix; scenes scale these by 0..1. Balanced by measurement
 * (bass weighted down to match hearing): the lead on top, bass and drums 3 dB under it,
 * harmony 6, arpeggio 9 and hats 14.
 */
const LAYER_LEVEL: Record<LayerId, number> = {
  bassCalm: 0.071,
  bass: 0.057,
  arp: 0.049,
  lead: 0.098,
  harmony: 0.031,
  drums: 0.153,
  hats: 0.067,
};

/** How quickly layers fade when a scene changes (time constant, seconds). */
const LAYER_FADE = 0.35;
/** Seconds a faded-out layer keeps being scheduled while its gain ramps down. */
const LAYER_TAIL = 2;
/** Time constant of the fade-out when one theme hands over to the other. */
const CROSSFADE = 0.45;

interface Track {
  id: ThemeId;
  score: ParsedTheme;
  stepDur: number;
  /** The track's volume, applied to its dry signal and to its echo send alike. */
  fades: AudioParam[];
  layers: Record<LayerId, GainNode>;
  target: Record<LayerId, number>;
  audibleUntil: Record<LayerId, number>;
  step: number;
  nextTime: number;
  running: boolean;
  /** Set while the track fades out; it stops being scheduled after this time. */
  stopAt: number | null;
  busy: boolean;
}

/**
 * Plays the adaptive soundtrack. Each theme is a track with one gain per layer: a scene sets
 * those gains on the next bar line, and switching themes crossfades on the next beat.
 * `pump(until)` schedules every note that starts before a time, so the same code drives the
 * live player (from a timer with a short lookahead) and offline renders.
 */
export class MusicPlayer {
  private readonly ins: Instruments;
  /** Everything the music produces comes out of this node. */
  readonly output: GainNode;
  private readonly echoIn: GainNode;
  private readonly tracks: Record<ThemeId, Track>;
  private sceneName: MusicScene = 'calm';
  private themeId: ThemeId = 'main';
  /** Notes scheduled so far, for tests. */
  scheduled = 0;
  /** When set, only this layer is heard (for measuring the mix). */
  solo: LayerId | null = null;

  constructor(private readonly ctx: BaseAudioContext) {
    this.ins = createInstruments(ctx);
    this.output = ctx.createGain();
    // A soft dotted-eighth echo on the lead and arpeggio gives the pulse waves some space.
    this.echoIn = ctx.createGain();
    this.echoIn.gain.value = 0.22;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = stepSeconds(THEMES.main) * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    this.echoIn.connect(delay).connect(tone).connect(feedback).connect(delay);
    tone.connect(this.output);
    this.tracks = { main: this.makeTrack('main'), boss: this.makeTrack('boss') };
  }

  private makeTrack(id: ThemeId): Track {
    const ctx = this.ctx;
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    dry.gain.value = 0;
    wet.gain.value = 0;
    dry.connect(this.output);
    wet.connect(this.echoIn);
    const layers = {} as Record<LayerId, GainNode>;
    const target = {} as Record<LayerId, number>;
    const audibleUntil = {} as Record<LayerId, number>;
    for (const l of LAYERS) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(dry);
      if (l === 'lead' || l === 'arp') g.connect(wet);
      layers[l] = g;
      target[l] = 0;
      audibleUntil[l] = 0;
    }
    const theme = THEMES[id];
    return {
      id,
      score: prepareTheme(theme),
      stepDur: stepSeconds(theme),
      fades: [dry.gain, wet.gain],
      layers,
      target,
      audibleUntil,
      step: 0,
      nextTime: 0,
      running: false,
      stopAt: null,
      busy: false,
    };
  }

  get scene(): MusicScene {
    return this.sceneName;
  }

  get theme(): ThemeId {
    return this.themeId;
  }

  /** Seconds of music played on the current theme. */
  get position(): number {
    const t = this.tracks[this.themeId];
    return t.step * t.stepDur;
  }

  /** Starts the current scene's theme at `time` if nothing is playing yet. */
  start(time: number): void {
    const t = this.tracks[this.themeId];
    if (t.running) return;
    this.startTrack(t, time);
    this.applyMix(t, time, true);
  }

  /** Moves every running track's next note to `time`, after the music was paused. */
  resumeAt(time: number): void {
    for (const t of Object.values(this.tracks)) {
      if (!t.running) continue;
      // A theme that was fading out while paused is simply finished.
      if (t.stopAt !== null) {
        t.running = false;
        t.stopAt = null;
        continue;
      }
      t.nextTime = time;
    }
  }

  setScene(scene: MusicScene, now: number): void {
    if (scene === this.sceneName) return;
    this.sceneName = scene;
    const mix = SCENES[scene];
    const cur = this.tracks[this.themeId];
    if (!cur.running) {
      // Nothing is playing yet; start() applies the scene.
      this.themeId = mix.theme;
      return;
    }
    if (mix.theme !== this.themeId) {
      // Enter on the outgoing theme's next beat so the switch lands in time.
      const beat = this.nextBoundary(cur, 4, now);
      for (const p of cur.fades) {
        p.cancelScheduledValues(beat);
        p.setTargetAtTime(0, beat, CROSSFADE);
      }
      cur.stopAt = beat + CROSSFADE * 6;
      const next = this.tracks[mix.theme];
      this.themeId = mix.theme;
      this.startTrack(next, beat);
      this.applyMix(next, beat, true);
      return;
    }
    // Silence (the player died) cuts at once; anything else changes on the bar line.
    const silent = scene === 'silent';
    this.applyMix(cur, silent ? now : this.nextBoundary(cur, STEPS_PER_BAR, now), silent);
  }

  /** Schedules every note that starts before `until`. */
  pump(until: number): void {
    for (const t of Object.values(this.tracks)) {
      while (t.running && t.nextTime < until) {
        if (t.stopAt !== null && t.nextTime >= t.stopAt) {
          t.running = false;
          t.stopAt = null;
          break;
        }
        this.playStep(t, t.step, t.nextTime);
        t.step++;
        t.nextTime += t.stepDur;
      }
    }
  }

  /** Skips ahead silently if the scheduler fell more than `slack` seconds behind `now`. */
  catchUp(now: number, slack = 0.08): void {
    for (const t of Object.values(this.tracks)) {
      if (!t.running || t.nextTime >= now - slack) continue;
      const missed = Math.ceil((now - t.nextTime) / t.stepDur);
      t.step += missed;
      t.nextTime += missed * t.stepDur;
    }
  }

  private startTrack(t: Track, time: number): void {
    if (!t.running) {
      t.step = 0;
      t.nextTime = time;
      t.running = true;
    }
    t.stopAt = null;
    for (const p of t.fades) {
      p.cancelScheduledValues(time);
      p.setValueAtTime(p.value, Math.max(0, time - 0.01));
      p.linearRampToValueAtTime(1, time + 0.12);
    }
  }

  private applyMix(t: Track, time: number, immediate: boolean): void {
    const mix = SCENES[this.sceneName];
    t.busy = mix.busy;
    for (const l of LAYERS) {
      const heard = mix.theme === t.id && (this.solo === null || this.solo === l);
      const v = (heard ? (mix.layers[l] ?? 0) : 0) * LAYER_LEVEL[l];
      const g = t.layers[l].gain;
      g.cancelScheduledValues(time);
      if (immediate && v > 0) g.setValueAtTime(v, time);
      else g.setTargetAtTime(v, time, immediate ? 0.06 : LAYER_FADE);
      if (v > 0) t.audibleUntil[l] = Infinity;
      else if (t.target[l] > 0) t.audibleUntil[l] = time + LAYER_TAIL;
      t.target[l] = v;
    }
  }

  /** Time of the first step at or after `now` that falls on a multiple of `every` steps. */
  private nextBoundary(t: Track, every: number, now: number): number {
    let step = t.step;
    let time = t.nextTime;
    while (step % every !== 0 || time < now) {
      step++;
      time += t.stepDur;
    }
    return time;
  }

  private on(t: Track, l: LayerId, time: number): boolean {
    return t.target[l] > 0 || time < t.audibleUntil[l];
  }

  private playStep(t: Track, step: number, time: number): void {
    const { score, stepDur } = t;
    const bar = Math.floor(step / STEPS_PER_BAR) % score.bars;
    const st = step % STEPS_PER_BAR;
    const chord = score.chords[bar];
    const ins = this.ins;
    const L = t.layers;
    // The boss theme's square lead is brighter, its galloping bass shorter and its hats busier,
    // so they're trimmed to sit in the same balance as the main theme.
    const boss = t.id === 'boss';

    if (this.on(t, 'lead', time)) {
      for (const n of score.lead[bar]) {
        if (n.step !== st) continue;
        pulseNote(ins, L.lead, time, n.len * stepDur, n.midi, boss ? 0.6 : 1, boss ? 0.5 : 0.25, true);
        this.scheduled++;
      }
    }
    if (this.on(t, 'harmony', time)) {
      for (const n of score.harmony[bar]) {
        if (n.step !== st) continue;
        pulseNote(ins, L.harmony, time, n.len * stepDur, n.midi, 1, 0.5);
        this.scheduled++;
      }
    }
    if (this.on(t, 'arp', time)) {
      const tones = arpTones(chord);
      pulseNote(ins, L.arp, time, stepDur * 0.9, tones[ARP_ORDER[step % ARP_ORDER.length]], 1, 0.125);
      this.scheduled++;
    }
    const root = bassRoot(chord);
    for (const [layer, pattern] of [
      ['bass', score.theme.bass],
      ['bassCalm', BASS_CALM],
    ] as const) {
      if (!this.on(t, layer, time)) continue;
      for (const [s, len, off] of pattern) {
        if (s !== st) continue;
        triNote(ins, L[layer], time, len * stepDur, root + off, boss && layer === 'bass' ? 1.25 : 1);
        this.scheduled++;
      }
    }
    if (this.on(t, 'drums', time)) {
      // A rising snare roll closes each phrase (every bar's last beat in the boss theme's case).
      const fill = (bar + 1) % score.theme.fillEvery === 0 && st >= 12 && (t.busy || t.id === 'boss');
      if (fill) snare(ins, L.drums, time, 0.55 + (st - 12) * 0.12);
      else {
        if (score.theme.kick[st] === 'x') kick(ins, L.drums, time, 1);
        if (score.theme.snare[st] === 'x') snare(ins, L.drums, time, 0.8);
      }
      if (st === 0 && bar % 8 === 0) crash(ins, L.drums, time, 0.22);
      this.scheduled++;
    }
    if (this.on(t, 'hats', time)) {
      const pattern = t.busy ? score.theme.busyHats : score.theme.hats;
      if (pattern[st] === 'x') {
        hat(ins, L.hats, time, (st % 4 === 0 ? 1 : 0.7) * (boss ? 0.5 : 1), boss && st % 4 === 2);
        this.scheduled++;
      }
    }
  }
}
