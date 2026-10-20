import musicUrl from '../assets/music/pixel-kingdom.mp3';
import type { SfxName } from './world';

/**
 * Tiny synthesized sound effects via WebAudio, plus one looping music track.
 * Each effect is throttled so dense combat stays pleasant instead of noisy.
 */

/** Element volume at a 100% music slider, and how far the music drops while paused. */
const MUSIC_MAX = 0.6;
const MUSIC_DUCKED = 0.35;

const MIN_GAP: Partial<Record<SfxName, number>> = {
  hit: 0.045,
  kill: 0.05,
  pickup: 0.035,
  enemyShot: 0.08,
  telegraph: 0.15,
  portal: 0.2,
  wall: 0.2,
};

type Wave = OscillatorType;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<SfxName, number>();
  private muted = false;
  private volume = 0.7;
  private unlocked = false;
  // Background music ("Pixel Kingdom"), streamed by an <audio> element and looped.
  private music: HTMLAudioElement | null = null;
  /** 0..1 from the Music slider; 0 means the track is off. */
  private musicLevel = 0.55;
  private ducked = false;
  private hidden = false;

  /** Must be called from a user gesture so browsers allow audio. */
  unlock(): void {
    this.unlocked = true;
    this.applyMusic();
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyVolume();
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
    this.applyMusic();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
    this.applyMusic();
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

  /** Music state for the play-test: playing, current volume and position. */
  get musicPlaying(): boolean {
    return !!this.music && !this.music.paused;
  }

  get musicVolume(): number {
    return this.music?.volume ?? 0;
  }

  get musicTime(): number {
    return this.music?.currentTime ?? 0;
  }

  private applyVolume(): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.5, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Plays the track only when allowed and wanted: after a user gesture, with sound on and the
   * music slider above zero, and while the tab is visible. Muting pauses it so it resumes where
   * it left off.
   */
  private applyMusic(): void {
    const shouldPlay = this.unlocked && this.musicLevel > 0 && !this.muted && !this.hidden;
    if (!this.music) {
      if (!shouldPlay) return;
      this.music = new Audio(musicUrl);
      this.music.loop = true;
      this.music.preload = 'auto';
      document.addEventListener('visibilitychange', () => {
        this.hidden = document.visibilityState === 'hidden';
        this.applyMusic();
      });
    }
    const m = this.music;
    m.volume = Math.max(0, Math.min(1, this.musicLevel * MUSIC_MAX * (this.ducked ? MUSIC_DUCKED : 1)));
    if (shouldPlay && m.paused) void m.play().catch(() => undefined);
    else if (!shouldPlay && !m.paused) m.pause();
  }

  private tone(freq: number, endFreq: number, dur: number, wave: Wave, gain: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.015, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private hiss(dur: number, gain: number, filterFreq: number, type: BiquadFilterType = 'bandpass', delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t);
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.2);
    src.stop(t + dur + 0.02);
  }

  play(name: SfxName, pitch = 0): void {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const gap = MIN_GAP[name];
    if (gap !== undefined) {
      const prev = this.last.get(name) ?? -1;
      if (now - prev < gap) return;
    }
    this.last.set(name, now);
    switch (name) {
      case 'bolt':
        this.tone(1100, 380, 0.13, 'triangle', 0.22);
        this.tone(2200, 900, 0.07, 'sine', 0.08);
        break;
      case 'lightning':
        this.hiss(0.28, 0.4, 3200, 'highpass');
        this.tone(180, 60, 0.25, 'sawtooth', 0.12);
        this.hiss(0.12, 0.3, 1500, 'bandpass', 0.06);
        break;
      case 'nova':
        this.tone(220, 55, 0.5, 'sine', 0.45);
        this.tone(660, 330, 0.35, 'triangle', 0.12);
        this.hiss(0.35, 0.18, 900, 'lowpass');
        break;
      case 'hit':
        this.tone(520 + Math.random() * 80, 260, 0.05, 'square', 0.06);
        break;
      case 'kill':
        this.tone(340, 120, 0.12, 'triangle', 0.16);
        this.hiss(0.08, 0.12, 2400);
        break;
      case 'pickup': {
        const f = 880 * Math.pow(2, Math.min(pitch, 14) / 24);
        this.tone(f, f * 1.5, 0.07, 'sine', 0.12);
        break;
      }
      case 'levelup':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.18, i * 0.07));
        break;
      case 'hurt':
        this.tone(160, 70, 0.25, 'sawtooth', 0.28);
        this.hiss(0.15, 0.25, 600, 'lowpass');
        break;
      case 'wall':
        this.tone(120, 60, 0.15, 'square', 0.15);
        break;
      case 'unclear':
        this.tone(200, 150, 0.16, 'square', 0.08);
        this.tone(190, 140, 0.16, 'square', 0.06, 0.08);
        break;
      case 'cooldown':
        this.tone(420, 400, 0.06, 'sine', 0.1);
        this.tone(320, 300, 0.08, 'sine', 0.08, 0.06);
        break;
      case 'enemyShot':
        this.tone(300, 520, 0.12, 'sine', 0.07);
        break;
      case 'telegraph':
        this.tone(240, 300, 0.18, 'triangle', 0.05);
        break;
      case 'charge':
        this.hiss(0.3, 0.2, 400, 'lowpass');
        this.tone(90, 60, 0.3, 'sawtooth', 0.1);
        break;
      case 'portal':
        this.tone(140, 280, 0.25, 'sine', 0.05);
        break;
      case 'bossWarn':
        this.tone(110, 80, 0.8, 'sawtooth', 0.18);
        this.tone(165, 120, 0.8, 'sawtooth', 0.12, 0.1);
        break;
      case 'bossDie':
        this.tone(300, 40, 1.2, 'sawtooth', 0.3);
        this.hiss(1.0, 0.35, 800, 'lowpass');
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, f, 0.3, 'triangle', 0.12, 0.4 + i * 0.09));
        break;
      case 'death':
        this.tone(440, 55, 1.1, 'triangle', 0.3);
        this.tone(330, 41, 1.1, 'sine', 0.2, 0.05);
        break;
      case 'select':
        this.tone(660, 990, 0.1, 'triangle', 0.14);
        break;
    }
  }
}

export const audio = new AudioEngine();

// Console handle for play-testing in development builds only.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __serpentAudio?: AudioEngine }).__serpentAudio = audio;
}
