import type { MapId } from '../maps/types';
import { AmbienceBed } from './ambience';
import {
  arpTones,
  BASS_CALM,
  bassRoot,
  LAYERS,
  parsePhrase,
  prepareTheme,
  SCENES,
  SOUNDTRACKS,
  STEPS_PER_BAR,
  stepSeconds,
  themeFor,
  THEMES,
  transposeFor,
  type AmbienceId,
  type Band,
  type Kit,
  type LayerId,
  type MusicScene,
  type ParsedTheme,
  type Phrase,
  type ThemeId,
} from './score';
import { anvil, clap, crash, createInstruments, createReverb, hat, kick, playVoice, rim, snare, tom, woodblock, type Instruments } from './synth';

/**
 * Loudness of each layer at full mix; scenes scale these by 0..1 and each theme's band trims
 * them. Balanced by measurement (bass weighted down to match hearing): the lead on top, bass and
 * drums 3 dB under it, harmony 6, arpeggio 9 and hats 14.
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
/** The toll bell's level before trims (it rings whenever a bass plays). */
const TOLL_LEVEL = 0.05;
/** Each ambient bed at full scene level, set by measurement to sit about 11 dB under the calm arrangement. */
const AMBIENCE_LEVEL: Record<AmbienceId, number> = { cave: 0.19, wind: 0.12, lava: 0.14 };

/** How quickly layers fade when a scene changes (time constant, seconds). */
const LAYER_FADE = 0.35;
/** Seconds a faded-out layer keeps being scheduled while its gain ramps down. */
const LAYER_TAIL = 2;
/** Time constant of the fade-out when one theme hands over to another. */
const CROSSFADE = 0.45;
/** Time constant of the ambience following the scene or the map. */
const AMBIENCE_FADE = 0.8;

interface Track {
  id: ThemeId;
  /** Semitones up (deeper loops); the same theme in another key is another track. */
  transpose: number;
  score: ParsedTheme;
  band: Band;
  stepDur: number;
  /** The track's volume, applied to its dry signal and to its echo and room sends alike. */
  fades: AudioParam[];
  layers: Record<LayerId, GainNode>;
  toll: GainNode;
  /** One-shot stings play here, outside the fades, so they ring on through a crossfade. */
  sting: GainNode;
  stingLead: GainNode;
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
 * Plays the adaptive soundtrack. Each theme (in each key) is a track with one gain per layer: a
 * scene sets those gains on the next bar line, and moving to another theme (the boss arriving, a
 * new map) crossfades on the next beat. Each map also has an ambient bed under its music.
 * `pump(until)` schedules every note that starts before a time, so the same code drives the live
 * player (from a timer with a short lookahead) and offline renders.
 */
export class MusicPlayer {
  private readonly ins: Instruments;
  /** Everything the music produces comes out of this node. */
  readonly output: GainNode;
  private readonly tracks = new Map<string, Track>();
  private readonly beds = new Map<AmbienceId, AmbienceBed>();
  private readonly stings = new Map<MapId, Phrase>();
  private current: Track;
  private sceneName: MusicScene = 'calm';
  private mapId: MapId = 'ruins';
  private loopN = 0;
  /** Notes scheduled so far, for tests. */
  scheduled = 0;
  /** When set, only this layer is heard (for measuring the mix). */
  solo: LayerId | null = null;
  /** Whether the ambient beds are heard (off when measuring the music alone). */
  ambienceOn = true;
  /** Whether the music is heard (off when measuring the ambience alone). */
  musicOn = true;

  constructor(private readonly ctx: BaseAudioContext) {
    this.ins = createInstruments(ctx);
    this.output = ctx.createGain();
    this.current = this.track('ruins', 0);
  }

  get scene(): MusicScene {
    return this.sceneName;
  }

  get map(): MapId {
    return this.mapId;
  }

  get theme(): ThemeId {
    return this.current.id;
  }

  get transpose(): number {
    return this.current.transpose;
  }

  /** Seconds of music played on the current theme. */
  get position(): number {
    return this.current.step * this.current.stepDur;
  }

  private track(id: ThemeId, transpose: number): Track {
    const key = `${id}@${transpose}`;
    let t = this.tracks.get(key);
    if (!t) {
      t = this.makeTrack(id, transpose);
      this.tracks.set(key, t);
    }
    return t;
  }

  private makeTrack(id: ThemeId, transpose: number): Track {
    const ctx = this.ctx;
    const theme = THEMES[id];
    const band = theme.band;
    const stepDur = stepSeconds(theme);
    const dry = ctx.createGain();
    dry.gain.value = 0;
    dry.connect(this.output);
    // Echo on the lead and arpeggio, timed to this theme's tempo.
    const echoIn = ctx.createGain();
    echoIn.gain.value = band.echo.send;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = stepDur * band.echo.steps;
    const feedback = ctx.createGain();
    feedback.gain.value = band.echo.feedback;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = band.echo.tone;
    echoIn.connect(delay).connect(tone).connect(feedback).connect(delay);
    tone.connect(this.output);
    const wet = ctx.createGain();
    wet.gain.value = 0;
    wet.connect(echoIn);
    const fades = [dry.gain, wet.gain];
    // The band's room, if it plays in one.
    let room: GainNode | null = null;
    let roomIn: GainNode | null = null;
    if (band.reverb) {
      roomIn = ctx.createGain();
      roomIn.gain.value = band.reverb.send;
      roomIn.connect(createReverb(ctx, band.reverb.seconds)).connect(this.output);
      room = ctx.createGain();
      room.gain.value = 0;
      room.connect(roomIn);
      fades.push(room.gain);
    }
    const trim = band.trim ?? {};
    const layers = {} as Record<LayerId, GainNode>;
    const target = {} as Record<LayerId, number>;
    const audibleUntil = {} as Record<LayerId, number>;
    for (const l of LAYERS) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(dry);
      if (l === 'lead' || l === 'arp') g.connect(wet);
      if (room && (l === 'lead' || l === 'arp' || l === 'harmony')) g.connect(room);
      layers[l] = g;
      target[l] = 0;
      audibleUntil[l] = 0;
    }
    const toll = ctx.createGain();
    toll.gain.value = TOLL_LEVEL * (trim.toll ?? 1);
    toll.connect(dry);
    if (room) toll.connect(room);
    const sting = ctx.createGain();
    sting.connect(this.output);
    if (roomIn) sting.connect(roomIn);
    const stingLead = ctx.createGain();
    stingLead.connect(sting);
    stingLead.connect(echoIn);
    return {
      id,
      transpose,
      score: prepareTheme(theme),
      band,
      stepDur,
      fades,
      layers,
      toll,
      sting,
      stingLead,
      target,
      audibleUntil,
      step: 0,
      nextTime: 0,
      running: false,
      stopAt: null,
      busy: false,
    };
  }

  /** Starts the current theme at `time` if nothing is playing yet. */
  start(time: number): void {
    const t = this.current;
    this.applyAmbience(time);
    if (t.running) return;
    this.startTrack(t, time);
    this.applyMix(t, time, true);
  }

  /** Moves every running track's next note to `time`, after the music was paused. */
  resumeAt(time: number): void {
    for (const t of this.tracks.values()) {
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

  /**
   * What should play: a map's music (`loop` deeper loops of the map order raise its key) in an
   * arrangement. A new theme crossfades in on the beat; a new arrangement of the same theme
   * changes on the bar line; silence (the player died) cuts at once.
   */
  cue(map: MapId, loop: number, scene: MusicScene, now: number): void {
    if (map === this.mapId && loop === this.loopN && scene === this.sceneName) return;
    const victory = scene === 'victory' && this.sceneName !== 'victory';
    this.mapId = map;
    this.loopN = loop;
    this.sceneName = scene;
    this.applyAmbience(now);
    const next = this.track(themeFor(map, scene), transposeFor(loop));
    const cur = this.current;
    if (!cur.running) {
      // Nothing is playing yet; start() applies the scene.
      this.current = next;
      return;
    }
    if (next !== cur) {
      // Enter on the outgoing theme's next beat so the switch lands in time.
      const beat = this.nextBoundary(cur, 4, now);
      for (const p of cur.fades) {
        p.cancelScheduledValues(beat);
        p.setTargetAtTime(0, beat, CROSSFADE);
      }
      cur.stopAt = beat + CROSSFADE * 6;
      this.current = next;
      this.startTrack(next, beat);
      this.applyMix(next, beat, true);
      if (victory) this.playSting(next, beat);
      return;
    }
    const silent = scene === 'silent';
    this.applyMix(cur, silent ? now : this.nextBoundary(cur, STEPS_PER_BAR, now), silent);
    if (victory) this.playSting(cur, this.nextBoundary(cur, 4, now));
  }

  /** Schedules every note that starts before `until`. */
  pump(until: number): void {
    for (const t of this.tracks.values()) {
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
    const now = this.ctx.currentTime;
    for (const bed of this.beds.values()) if (bed.audibleUntil > now) bed.pump(now, until);
  }

  /** Skips ahead silently if the scheduler fell more than `slack` seconds behind `now`. */
  catchUp(now: number, slack = 0.08): void {
    for (const t of this.tracks.values()) {
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
    const trim = t.band.trim ?? {};
    t.busy = mix.busy;
    for (const l of LAYERS) {
      const heard = this.musicOn && t === this.current && (this.solo === null || this.solo === l);
      const v = (heard ? (mix.layers[l] ?? 0) : 0) * LAYER_LEVEL[l] * (trim[l] ?? 1);
      const g = t.layers[l].gain;
      g.cancelScheduledValues(time);
      if (immediate && v > 0) g.setValueAtTime(v, time);
      else g.setTargetAtTime(v, time, immediate ? 0.06 : LAYER_FADE);
      if (v > 0) t.audibleUntil[l] = Infinity;
      else if (t.target[l] > 0) t.audibleUntil[l] = time + LAYER_TAIL;
      t.target[l] = v;
    }
  }

  /** Fades the map's ambient bed toward the scene's level, and any other bed out. */
  private applyAmbience(now: number): void {
    const id = SOUNDTRACKS[this.mapId].ambience;
    const level = this.ambienceOn ? SCENES[this.sceneName].ambience : 0;
    if (id && level > 0 && !this.beds.has(id)) {
      const bed = new AmbienceBed(this.ins, id, now);
      bed.output.connect(this.output);
      this.beds.set(id, bed);
    }
    for (const [bid, bed] of this.beds) {
      const v = bid === id ? level * AMBIENCE_LEVEL[bid] : 0;
      const g = bed.output.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(v, now, this.sceneName === 'silent' ? 0.05 : AMBIENCE_FADE);
      bed.audibleUntil = v > 0 ? Infinity : Math.min(bed.audibleUntil, now + AMBIENCE_FADE * 5);
      if (bid === id) bed.transpose = transposeFor(this.loopN);
    }
  }

  /** The map's two-bar victory sting, played once at `time` with the track's band and key. */
  private playSting(t: Track, time: number): void {
    if (!this.musicOn) return;
    let phrase = this.stings.get(this.mapId);
    if (!phrase) {
      const s = SOUNDTRACKS[this.mapId].sting;
      phrase = parsePhrase(s.chords, s.lead);
      this.stings.set(this.mapId, phrase);
    }
    const { band, stepDur, transpose: tr } = t;
    const theme = t.score.theme;
    const trim = band.trim ?? {};
    const level = (l: LayerId) => LAYER_LEVEL[l] * (trim[l] ?? 1);
    const ins = this.ins;
    for (let bar = 0; bar < phrase.bars; bar++) {
      const t0 = time + bar * STEPS_PER_BAR * stepDur;
      for (const n of phrase.lead[bar]) {
        playVoice(ins, t.stingLead, t0 + n.step * stepDur, n.len * stepDur, n.midi + tr, band.lead, level('lead'));
        this.scheduled++;
      }
      for (const n of phrase.harmony[bar]) {
        playVoice(ins, t.sting, t0 + n.step * stepDur, n.len * stepDur, n.midi + tr, band.harmony, level('harmony'));
        this.scheduled++;
      }
      const root = bassRoot(phrase.chords[bar], theme.bassFloor) + tr;
      for (const [s, len, off] of BASS_CALM) {
        playVoice(ins, t.sting, t0 + s * stepDur, len * stepDur, root + off, band.bassCalm, level('bassCalm'));
        this.scheduled++;
      }
      const k = band.kit.kick;
      kick(ins, t.sting, t0, k.gain * level('drums'), k.from, k.to);
      crash(ins, t.sting, t0, 0.22 * level('drums'));
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

  private hitSnare(kit: Kit, dest: AudioNode, time: number, gain: number): void {
    if (kit.snare === 'rim') rim(this.ins, dest, time, gain);
    else if (kit.snare === 'clap') clap(this.ins, dest, time, gain);
    else snare(this.ins, dest, time, gain);
  }

  private playStep(t: Track, step: number, time: number): void {
    const { score, stepDur, band, transpose: tr } = t;
    const theme = score.theme;
    const bar = Math.floor(step / STEPS_PER_BAR) % score.bars;
    const st = step % STEPS_PER_BAR;
    // Swing pushes the off-beat sixteenths late.
    const at = st % 2 === 1 ? time + (theme.swing ?? 0) * stepDur : time;
    const chord = score.chords[bar];
    const ins = this.ins;
    const L = t.layers;
    const kit = band.kit;

    if (this.on(t, 'lead', time)) {
      for (const n of score.lead[bar]) {
        if (n.step !== st) continue;
        playVoice(ins, L.lead, at, n.len * stepDur, n.midi + tr, band.lead);
        this.scheduled++;
      }
    }
    if (this.on(t, 'harmony', time)) {
      for (const n of score.harmony[bar]) {
        if (n.step !== st) continue;
        playVoice(ins, L.harmony, at, n.len * stepDur, n.midi + tr, band.harmony);
        this.scheduled++;
      }
    }
    const arp = band.arp;
    if (this.on(t, 'arp', time) && step % arp.every === 0) {
      const tones = arpTones(chord);
      const i = Math.floor(step / arp.every) % arp.order.length;
      playVoice(ins, L.arp, at, stepDur * arp.every * arp.gate, tones[arp.order[i]] + arp.octave + tr, arp.voice);
      this.scheduled++;
    }
    const root = bassRoot(chord, theme.bassFloor) + tr;
    for (const [layer, pattern, voice] of [
      ['bass', theme.bass, band.bass],
      ['bassCalm', theme.bassCalm ?? BASS_CALM, band.bassCalm],
    ] as const) {
      if (!this.on(t, layer, time)) continue;
      for (const [s, len, off] of pattern) {
        if (s !== st) continue;
        playVoice(ins, L[layer], at, len * stepDur, root + off, voice);
        this.scheduled++;
      }
    }
    // The toll rings with whichever bass is playing, on the first beat of its bars.
    if (theme.toll && st === 0 && bar % theme.toll.every === 0 && (t.target.bass > 0 || t.target.bassCalm > 0)) {
      const bell = bassRoot(chord, theme.toll.floor) + tr;
      playVoice(ins, t.toll, time, theme.toll.every * STEPS_PER_BAR * stepDur, bell, theme.toll.voice);
      this.scheduled++;
    }
    if (this.on(t, 'drums', time)) {
      // A rising roll closes each phrase (every Nth bar's last beat).
      const fill = (bar + 1) % theme.fillEvery === 0 && st >= 12 && (t.busy || kit.alwaysFill);
      if (fill) {
        const g = 0.55 + (st - 12) * 0.12;
        if (kit.fill === 'tom') tom(ins, L.drums, at, g * 1.1, st < 14);
        else if (kit.fill === 'woodblock') woodblock(ins, L.drums, at, g, st % 2 === 0);
        else this.hitSnare(kit, L.drums, at, g);
      } else {
        if (theme.kick[st] === 'x') kick(ins, L.drums, at, kit.kick.gain, kit.kick.from, kit.kick.to);
        if (theme.snare[st] === 'x') this.hitSnare(kit, L.drums, at, kit.snareGain);
        const p = theme.perc?.[st];
        if (kit.perc && (p === 'h' || p === 'l')) {
          const g = kit.percGain ?? 1;
          if (kit.perc === 'anvil') anvil(ins, L.drums, at, g);
          else if (kit.perc === 'tom') tom(ins, L.drums, at, g, p === 'h');
          else woodblock(ins, L.drums, at, g, p === 'h');
        }
      }
      if (kit.crash && st === 0 && bar % 8 === 0) crash(ins, L.drums, time, 0.22);
      this.scheduled++;
    }
    if (this.on(t, 'hats', time)) {
      const pattern = t.busy ? theme.busyHats : theme.hats;
      if (pattern[st] === 'x') {
        hat(ins, L.hats, at, (st % 4 === 0 ? 1 : 0.7) * kit.hat.gain, kit.hat.open && st % 4 === 2, kit.hat.cutoff);
        this.scheduled++;
      }
    }
  }
}
