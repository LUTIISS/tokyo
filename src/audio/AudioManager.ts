import { assetUrl } from '@/core/paths';

/**
 * Радио. Ничего не синтезирует: играет только треки из public/audio/tracks/.
 *
 * Манифест public/audio/tracks.json собирается скриптом scripts/build-media-manifests.mjs
 * по содержимому папки. Порядок — по имени файла, поэтому первым идёт «01 - …».
 */
export interface TrackInfo {
  title: string;
  src: string;
}

/** Громкость радио: фоном, чтобы не перекрикивало игру. */
const DEFAULT_VOLUME = 0.3;

export class AudioManager {
  playlist: TrackInfo[] = [];
  finale: TrackInfo | null = null;
  muted = false;
  unlocked = false;
  onTrackChange: ((t: TrackInfo | null, finale: boolean) => void) | null = null;

  private music = new Audio();
  private index = -1;
  private finaleMode = false;
  private manifestLoaded = false;

  constructor() {
    this.music.loop = false;
    this.music.preload = 'auto';
    this.music.volume = DEFAULT_VOLUME;
    this.music.addEventListener('ended', () => {
      if (this.finaleMode) {
        this.music.currentTime = 0;
        this.music.play().catch(() => {});
      } else this.next();
    });
    this.music.addEventListener('error', () => {
      // Файл не открылся — идём дальше, но не зацикливаемся на пустом плейлисте.
      if (!this.finaleMode && this.playlist.length > 1) setTimeout(() => this.next(), 500);
    });
  }

  get volume(): number {
    return this.music.volume;
  }

  set volume(v: number) {
    this.music.volume = Math.max(0, Math.min(1, v));
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

  /** Вызывать по первому клику: без жеста браузер не даст запустить звук. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.manifestLoaded && this.playlist.length && this.index < 0) this.play(0);
  }

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

  /** Финальная тема, если в папке есть файл finale.*; иначе радио просто играет дальше. */
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
    return this.muted;
  }

  get currentTrack(): TrackInfo | null {
    if (this.finaleMode) return this.finale;
    return this.index >= 0 ? this.playlist[this.index] : null;
  }
}
