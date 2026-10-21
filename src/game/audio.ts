import { MusicPlayer } from './music/player';
import type { LayerId, MusicScene, ThemeId } from './music/score';
import { pickupRate, playSynth, SFX_FILES, SFX_SAMPLES, type SampleLayer } from './sfx';
import type { SfxName } from './world';

/**
 * All game audio on one WebAudio context: sampled sound effects (with a synthesized fallback)
 * and the adaptive chiptune soundtrack from music/. Each effect is throttled so dense combat
 * stays pleasant instead of noisy.
 */

/**
 * Music gain at a 100% slider, and how far the music drops while paused. At the default 55%
 * the busy arrangement measures about as loud as the old "Pixel Kingdom" track did (-24 dB RMS).
 */
const MUSIC_MAX = 1.4;
const MUSIC_DUCKED = 0.35;
/** The music scheduler wakes every TICK_MS and books notes this many seconds ahead. */
const LOOKAHEAD = 0.25;
const TICK_MS = 30;

const MIN_GAP: Partial<Record<SfxName, number>> = {
  hit: 0.045,
  kill: 0.05,
  pickup: 0.035,
  enemyShot: 0.08,
  telegraph: 0.15,
  portal: 0.2,
  wall: 0.2,
};

const SAMPLE_URLS: Record<string, string> = {};
for (const [file, url] of Object.entries(
  import.meta.glob('../assets/sfx/*.ogg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
)) {
  SAMPLE_URLS[file.slice(file.lastIndexOf('/') + 1, -'.ogg'.length)] = url;
}

/** Plays one layer of a sampled effect at `now` into `dest`. */
function playLayer(
  ctx: BaseAudioContext,
  dest: AudioNode,
  buffer: AudioBuffer,
  layer: SampleLayer,
  now: number,
  rateScale: number,
  rand: () => number,
): void {
  const t = now + (layer.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const [lo, hi] = layer.rate ?? [1, 1];
  src.playbackRate.value = (lo + (hi - lo) * rand()) * rateScale;
  const g = ctx.createGain();
  g.gain.setValueAtTime(layer.gain, t);
  src.connect(g).connect(dest);
  src.start(t);
  if (layer.maxDur) {
    g.gain.setTargetAtTime(0, t + layer.maxDur * 0.7, layer.maxDur * 0.1);
    src.stop(t + layer.maxDur);
  }
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** Final safety limiter shared by effects and music. */
  private limiter: DynamicsCompressorNode | null = null;
  private last = new Map<SfxName, number>();
  private muted = false;
  private volume = 0.7;
  private unlocked = false;
  private readonly buffers = new Map<string, AudioBuffer>();
  private loading = false;
  private failedFiles = 0;
  // Soundtrack
  private music: MusicPlayer | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicOn = false;
  private scene: MusicScene = 'calm';
  /** 0..1 from the Music slider; 0 means the music is off. */
  private musicLevel = 0.55;
  private ducked = false;
  private hidden = false;

  /** Must be called from a user gesture so browsers allow audio. */
  unlock(): void {
    this.unlocked = true;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      const ctx = this.ctx;
      // A fast limiter on the final mix only catches peaks when many sounds stack up.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      limiter.connect(ctx.destination);
      this.limiter = limiter;
      this.master = ctx.createGain();
      this.master.connect(limiter);
      this.applyVolume();
      const len = Math.floor(ctx.sampleRate * 0.5);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      // Music: peak control, then the slider volume.
      this.music = new MusicPlayer(ctx);
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0;
      this.music.output.connect(musicGlue(ctx)).connect(this.musicGain).connect(this.limiter);
      this.music.setScene(this.scene, ctx.currentTime);
      document.addEventListener('visibilitychange', () => {
        this.hidden = document.visibilityState === 'hidden';
        this.applyMusic();
      });
      void this.loadSamples();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    this.applyMusic();
  }

  private async loadSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.loading) return;
    this.loading = true;
    await Promise.all(
      SFX_FILES.map(async (name) => {
        try {
          const res = await fetch(SAMPLE_URLS[name]);
          this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          // Leave it out; that effect keeps using its synthesized version.
          this.failedFiles++;
        }
      }),
    );
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
    this.applyMusic();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  setMusicVolume(v: number): void {
    this.musicLevel = Math.max(0, Math.min(1, v));
    this.applyMusic();
  }

  /** Quieter music while the game is paused. */
  duckMusic(on: boolean): void {
    this.ducked = on;
    this.applyMusic();
  }

  /** Which arrangement plays: calm on menus, layered by danger in a run, the boss theme in a fight. */
  setMusicScene(scene: MusicScene): void {
    this.scene = scene;
    if (this.music && this.ctx) this.music.setScene(scene, this.ctx.currentTime);
  }

  // Music and sample state for the play-test.
  get musicPlaying(): boolean {
    return this.musicOn;
  }

  get musicVolume(): number {
    return this.musicTarget();
  }

  get musicTime(): number {
    return this.music?.position ?? 0;
  }

  get musicTheme(): ThemeId {
    return this.music?.theme ?? 'main';
  }

  get musicScene(): MusicScene {
    return this.scene;
  }

  get samplesLoaded(): number {
    return this.buffers.size;
  }

  get samplesFailed(): number {
    return this.failedFiles;
  }

  private applyVolume(): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.5, this.ctx.currentTime, 0.02);
    }
  }

  private musicTarget(): number {
    return this.musicLevel * MUSIC_MAX * (this.ducked ? MUSIC_DUCKED : 1);
  }

  /**
   * Plays the music only when allowed and wanted: after a user gesture, with sound on, the
   * music slider above zero and the tab visible. Stopping keeps the place in the song.
   */
  private applyMusic(): void {
    const ctx = this.ctx;
    const music = this.music;
    if (!ctx || !music || !this.musicGain) return;
    const shouldPlay = this.unlocked && this.musicLevel > 0 && !this.muted && !this.hidden;
    const now = ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(shouldPlay ? this.musicTarget() : 0, now, shouldPlay ? 0.08 : 0.03);
    if (shouldPlay && !this.musicOn) {
      this.musicOn = true;
      music.start(now + 0.05);
      music.resumeAt(now + 0.05);
      this.musicTimer = window.setInterval(() => {
        const t = ctx.currentTime;
        music.catchUp(t);
        music.pump(t + LOOKAHEAD);
      }, TICK_MS);
      music.pump(now + LOOKAHEAD);
    } else if (!shouldPlay && this.musicOn) {
      this.musicOn = false;
      if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  play(name: SfxName, pitch = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const gap = MIN_GAP[name];
    if (gap !== undefined) {
      const prev = this.last.get(name) ?? -1;
      if (now - prev < gap) return;
    }
    this.last.set(name, now);
    if (!this.playSample(ctx, this.master, name, pitch, now, Math.random)) {
      playSynth(ctx, this.master, this.noise, name, pitch, now);
    }
  }

  /** Plays the sampled version if all of its files are loaded. */
  private playSample(
    ctx: BaseAudioContext,
    dest: AudioNode,
    name: SfxName,
    pitch: number,
    now: number,
    rand: () => number,
  ): boolean {
    const layers = SFX_SAMPLES[name];
    const picks = layers.map((l) => this.buffers.get(l.files[Math.floor(rand() * l.files.length) % l.files.length]));
    if (picks.some((b) => !b)) return false;
    const rateScale = name === 'pickup' ? pickupRate(pitch) : 1;
    layers.forEach((l, i) => playLayer(ctx, dest, picks[i]!, l, now, rateScale, rand));
    return true;
  }

  // ---------------------------------------------------------------- development measurements

  /** Renders every effect both ways offline and reports loudness (dB) for balancing gains. */
  async measureEffects(): Promise<Record<string, { synth: number; sample: number; synthPeak: number; samplePeak: number }>> {
    const out: Record<string, { synth: number; sample: number; synthPeak: number; samplePeak: number }> = {};
    for (const name of Object.keys(SFX_SAMPLES) as SfxName[]) {
      const render = async (sampled: boolean) => {
        const octx = new OfflineAudioContext(1, 44100 * 3, 44100);
        const noise = octx.createBuffer(1, 22050, 44100);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 12.9898) * 43758.5453 % 1;
        const g = octx.createGain();
        g.gain.value = 0.5 * 0.7;
        g.connect(octx.destination);
        if (sampled) this.playSample(octx, g, name, 0, 0, () => 0.5);
        else playSynth(octx, g, noise, name, 0, 0, () => 0.5);
        return loudness((await octx.startRendering()).getChannelData(0));
      };
      const a = await render(false);
      const b = await render(true);
      out[name] = { synth: a.rms, sample: b.rms, synthPeak: a.peak, samplePeak: b.peak };
    }
    return out;
  }

  /**
   * Renders a stretch of the soundtrack offline at the default music volume. `solo` isolates
   * one layer and `weighted` roughly models hearing (bass counts less) for balancing layers.
   */
  async renderMusic(
    scene: MusicScene,
    seconds: number,
    solo: LayerId | null = null,
    weighted = false,
  ): Promise<{ rms: number; peak: number; perSecond: number[] }> {
    const octx = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
    const player = new MusicPlayer(octx);
    player.solo = solo;
    const vol = octx.createGain();
    vol.gain.value = 0.55 * MUSIC_MAX;
    player.output.connect(musicGlue(octx)).connect(vol);
    if (weighted) {
      const hp = octx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 150;
      hp.Q.value = 0.6;
      const shelf = octx.createBiquadFilter();
      shelf.type = 'highshelf';
      shelf.frequency.value = 2000;
      shelf.gain.value = 4;
      vol.connect(hp).connect(shelf).connect(octx.destination);
    } else {
      vol.connect(octx.destination);
    }
    player.setScene(scene, 0);
    player.start(0.05);
    player.pump(seconds);
    const data = (await octx.startRendering()).getChannelData(0);
    const perSecond: number[] = [];
    for (let s = 0; s + 44100 <= data.length; s += 44100) perSecond.push(loudness(data.subarray(s, s + 44100)).rms);
    return { ...loudness(data), perSecond };
  }
}

/** A compressor that only touches the music's loudest peaks, so layers keep their dynamics. */
function musicGlue(ctx: BaseAudioContext): DynamicsCompressorNode {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -8;
  c.knee.value = 6;
  c.ratio.value = 4;
  c.attack.value = 0.004;
  c.release.value = 0.15;
  return c;
}

/** RMS over the audible part of a signal and its peak, both in dBFS. */
function loudness(x: Float32Array): { rms: number; peak: number } {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const thr = peak * 0.01;
  let first = 0;
  let last = x.length - 1;
  while (first < x.length && Math.abs(x[first]) < thr) first++;
  while (last > first && Math.abs(x[last]) < thr) last--;
  let s = 0;
  for (let i = first; i <= last; i++) s += x[i] * x[i];
  const rms = Math.sqrt(s / Math.max(1, last - first + 1));
  return { rms: +(20 * Math.log10(rms || 1e-9)).toFixed(1), peak: +(20 * Math.log10(peak || 1e-9)).toFixed(1) };
}

export const audio = new AudioEngine();

// Console handle for play-testing in development builds only.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __serpentAudio?: AudioEngine }).__serpentAudio = audio;
}
