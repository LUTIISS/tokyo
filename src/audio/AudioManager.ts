import { damp } from '@/world/noise';
import { assetUrl } from '@/core/paths';

/**
 * Манифест public/audio/tracks.json:
 * {
 *   "tracks": [
 *     { "title": "Teriyaki Boyz — Tokyo Drift", "src": "/audio/tracks/tokyo-drift.mp3" }
 *   ],
 *   "finale": { "title": "Сакура", "src": "/audio/tracks/finale.mp3" }
 * }
 * Файлы кладём в public/audio/tracks/. Всё остальное (двигатель, шины, SFX) синтезируется.
 */
export interface TrackInfo {
  title: string;
  src: string;
}

export type SfxName =
  | 'door'
  | 'doorClose'
  | 'coin'
  | 'ui'
  | 'confirm'
  | 'deny'
  | 'engineStart'
  | 'gate'
  | 'hit'
  | 'nitro'
  | 'drift'
  | 'clank'
  | 'fanfare';

export class AudioManager {
  playlist: TrackInfo[] = [];
  finale: TrackInfo | null = null;
  musicVolume = 0.55;
  muted = false;
  unlocked = false;
  onTrackChange: ((t: TrackInfo | null, finale: boolean) => void) | null = null;

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music = new Audio();
  private index = -1;
  private finaleMode = false;
  private manifestLoaded = false;

  private eng?: {
    o1: OscillatorNode;
    o2: OscillatorNode;
    o3: OscillatorNode;
    lp: BiquadFilterNode;
    g: GainNode;
  };
  private scr?: { bp: BiquadFilterNode; g: GainNode };
  private engineGainT = 0;
  private engineGain = 0;
  private engineFreqT = 50;
  private engineFreq = 50;
  private engineLpT = 400;
  private engineLp = 400;
  private screechT = 0;
  private screech = 0;

  constructor() {
    this.music.loop = false;
    this.music.preload = 'auto';
    this.music.volume = this.musicVolume;
    this.music.addEventListener('ended', () => {
      if (this.finaleMode) {
        this.music.currentTime = 0;
        this.music.play().catch(() => {});
      } else this.next();
    });
    this.music.addEventListener('error', () => {
      // Файл не нашёлся — идём дальше, но не зацикливаемся.
      if (!this.finaleMode && this.playlist.length > 1) setTimeout(() => this.next(), 500);
    });
  }

  async loadManifest(url = '/audio/tracks.json'): Promise<void> {
    try {
      const res = await fetch(assetUrl(url), { cache: 'no-cache' });
      if (res.ok) {
        const json = (await res.json()) as { tracks?: TrackInfo[]; finale?: TrackInfo };
        this.playlist = (json.tracks ?? []).filter((t) => t && t.src);
        this.finale = json.finale && json.finale.src ? json.finale : null;
      }
    } catch {
      this.playlist = [];
    }
    this.manifestLoaded = true;
    if (this.unlocked && this.index < 0 && this.playlist.length) this.play(0);
    if (!this.playlist.length) this.onTrackChange?.(null, false);
  }

  /** Вызывать по первому клику — AudioContext и autoplay требуют жеста. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.buildEngine();
      this.buildScreech();
      this.ctx.resume().catch(() => {});
    }
    if (this.manifestLoaded && this.playlist.length && this.index < 0) this.play(0);
  }

  // ── Музыка ─────────────────────────────────────────────────────────────
  play(i: number): void {
    if (!this.playlist.length) return;
    this.finaleMode = false;
    this.index = ((i % this.playlist.length) + this.playlist.length) % this.playlist.length;
    const t = this.playlist[this.index];
    this.music.src = assetUrl(t.src);
    this.music.loop = false;
    this.music.play().catch(() => {});
    this.onTrackChange?.(t, false);
  }

  next(): void {
    if (this.finaleMode) return;
    this.play(this.index + 1);
  }

  prev(): void {
    if (this.finaleMode) return;
    this.play(this.index - 1);
  }

  playFinale(): void {
    if (!this.finale) return;
    this.finaleMode = true;
    this.music.src = assetUrl(this.finale.src);
    this.music.loop = true;
    this.music.play().catch(() => {});
    this.onTrackChange?.(this.finale, true);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.music.muted = this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    return this.muted;
  }

  get currentTrack(): TrackInfo | null {
    if (this.finaleMode) return this.finale;
    return this.index >= 0 ? this.playlist[this.index] : null;
  }

  // ── Двигатель ──────────────────────────────────────────────────────────
  private buildEngine(): void {
    const ctx = this.ctx!;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    const o3 = ctx.createOscillator();
    o3.type = 'sawtooth';
    o3.detune.value = 9;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    lp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.value = 0;
    const mix2 = ctx.createGain();
    mix2.gain.value = 0.45;
    const mix3 = ctx.createGain();
    mix3.gain.value = 0.35;
    o1.connect(lp);
    o2.connect(mix2).connect(lp);
    o3.connect(mix3).connect(lp);
    lp.connect(g).connect(this.master);
    o1.start();
    o2.start();
    o3.start();
    this.eng = { o1, o2, o3, lp, g };
  }

  private buildScreech(): void {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp).connect(g).connect(this.master);
    src.start();
    this.scr = { bp, g };
  }

  setEngine(rpm: number, throttle: number, on: boolean): void {
    if (!on) {
      this.engineGainT = 0;
      return;
    }
    this.engineFreqT = 42 + rpm * 165;
    this.engineLpT = 320 + rpm * 2400 + throttle * 500;
    this.engineGainT = 0.05 + rpm * 0.07 + throttle * 0.04;
  }

  setScreech(amount: number): void {
    this.screechT = Math.max(0, Math.min(1, amount));
  }

  update(dt: number): void {
    if (!this.ctx || !this.eng || !this.scr) return;
    this.engineGain = damp(this.engineGain, this.engineGainT, 8, dt);
    this.engineFreq = damp(this.engineFreq, this.engineFreqT, 6, dt);
    this.engineLp = damp(this.engineLp, this.engineLpT, 6, dt);
    const t = this.ctx.currentTime;
    this.eng.o1.frequency.setTargetAtTime(this.engineFreq, t, 0.02);
    this.eng.o2.frequency.setTargetAtTime(this.engineFreq * 0.5, t, 0.02);
    this.eng.o3.frequency.setTargetAtTime(this.engineFreq * 1.5, t, 0.02);
    this.eng.lp.frequency.setTargetAtTime(this.engineLp, t, 0.03);
    this.eng.g.gain.setTargetAtTime(this.engineGain, t, 0.03);

    this.screech = damp(this.screech, this.screechT, this.screechT > this.screech ? 14 : 5, dt);
    this.scr.g.gain.setTargetAtTime(this.screech * 0.16, t, 0.02);
    this.scr.bp.frequency.setTargetAtTime(900 + this.screech * 500, t, 0.05);
  }

  // ── SFX ────────────────────────────────────────────────────────────────
  sfx(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime;
    const tone = (type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      o.frequency.setValueAtTime(f0, t0 + delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + delay + dur);
      g.gain.setValueAtTime(0.0001, t0 + delay);
      g.gain.exponentialRampToValueAtTime(vol, t0 + delay + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
      o.connect(g).connect(this.master);
      o.start(t0 + delay);
      o.stop(t0 + delay + dur + 0.05);
    };
    const noise = (dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, delay = 0) => {
      const len = Math.ceil(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(f0, t0 + delay);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + delay + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t0 + delay);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t0 + delay);
    };

    switch (name) {
      case 'door':
        noise(0.12, 0.25, 'lowpass', 900, 200);
        tone('sine', 140, 70, 0.18, 0.35);
        break;
      case 'doorClose':
        tone('sine', 95, 45, 0.16, 0.5);
        noise(0.06, 0.3, 'highpass', 2000, 1500);
        break;
      case 'coin':
        tone('square', 880, 880, 0.09, 0.08);
        tone('square', 1108, 1108, 0.09, 0.08, 0.08);
        tone('square', 1318, 1318, 0.16, 0.08, 0.16);
        tone('sine', 1760, 1760, 0.3, 0.06, 0.24);
        break;
      case 'ui':
        tone('sine', 620, 720, 0.06, 0.08);
        break;
      case 'confirm':
        tone('triangle', 660, 660, 0.08, 0.1);
        tone('triangle', 990, 990, 0.14, 0.1, 0.08);
        break;
      case 'deny':
        tone('sawtooth', 220, 160, 0.16, 0.08);
        break;
      case 'engineStart':
        noise(0.5, 0.18, 'lowpass', 300, 900);
        tone('sawtooth', 40, 130, 0.9, 0.12);
        break;
      case 'gate':
        noise(1.4, 0.35, 'lowpass', 160, 60);
        tone('sine', 55, 35, 1.4, 0.4);
        break;
      case 'hit':
        noise(0.14, 0.4, 'lowpass', 1200, 200);
        tone('sine', 90, 40, 0.2, 0.4);
        break;
      case 'nitro':
        noise(0.6, 0.25, 'bandpass', 400, 3200);
        break;
      case 'drift':
        tone('sine', 1320, 1760, 0.12, 0.07);
        break;
      case 'clank':
        // Металлический стук флюгегехаймена
        noise(0.05, 0.16, 'bandpass', 2600, 900);
        tone('square', 180, 90, 0.06, 0.05);
        break;
      case 'fanfare':
        [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.25, 0.12, i * 0.12));
        tone('triangle', 1318, 1318, 0.7, 0.12, 0.5);
        break;
    }
  }
}
