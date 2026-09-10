import type { Track, Sector } from '@/world/Track';
import type { ZonePlan, ZoneId } from '@/world/Zones';

export interface MapState {
  /** Позиция и курс того, за кем следим (машина или персонаж). */
  x: number;
  z: number;
  heading: number;
  driving: boolean;
  /** Персонаж отдельно (когда идёт пешком, а машина стоит). */
  carX: number;
  carZ: number;
  carHeading: number;
}

export interface Poi {
  id: ZoneId;
  x: number;
  z: number;
  s: number;
  label: string;
  jp: string;
  color: string;
  glyph: string;
}

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const SECTOR_LABELS: Record<Sector, { jp: string; ru: string }> = {
  city: { jp: '渋谷', ru: 'Сибуя' },
  bridge: { jp: '湾岸', ru: 'Мост' },
  touge: { jp: '峠', ru: 'Тогэ' },
  overlook: { jp: '展望台', ru: 'Смотровая' },
  industrial: { jp: '工場', ru: 'Промзона' },
  docks: { jp: '港', ru: 'Порт' },
};

/**
 * Мини-карта в углу и большая карта по Tab. Рисует петлю трассы, точки интереса,
 * машину/персонажа и подсвечивает кратчайший (по дороге) путь до текущей цели.
 */
export class MiniMap {
  readonly root: HTMLElement;
  readonly bigRoot: HTMLElement;
  objective: ZoneId | null = null;
  /** Расстояние по дороге до цели (м) и в ту ли сторону смотрит нос. */
  distance = 0;
  ahead = true;

  private canvas: HTMLCanvasElement;
  private bigCanvas: HTMLCanvasElement;
  private head: HTMLElement;
  private bigHead: HTMLElement;
  private bounds: Bounds;
  private pois: Poi[];
  private sectorCenters: Array<{ sector: Sector; x: number; z: number }> = [];
  private time = 0;
  private bigOpen = false;
  private routeFrom = 0;
  private routeTo = 0;
  private routeForward = true;

  constructor(
    parent: HTMLElement,
    bigParent: HTMLElement,
    private track: Track,
    plan: ZonePlan,
  ) {
    this.pois = [
      { id: 'quest', x: plan.quest.x, z: plan.quest.z, s: plan.quest.sample.s, label: 'Смотровая · квест', jp: '展望台', color: '#ff2d95', glyph: '⛩' },
      { id: 'garage', x: plan.garage.x, z: plan.garage.z, s: plan.garage.sample.s, label: 'Мастерская', jp: 'ガレージ', color: '#ffe45c', glyph: '🔧' },
      { id: 'boss', x: plan.boss.x, z: plan.boss.z, s: plan.boss.sample.s, label: 'База Ваисова', jp: '拠点', color: '#ff4b4b', glyph: '💀' },
    ];

    // Границы карты по трассе с запасом
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of track.samples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    const pad = 60;
    this.bounds = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };

    // Центры секторов для подписей на большой карте
    const acc = new Map<Sector, { x: number; z: number; n: number }>();
    for (const s of track.samples) {
      const a = acc.get(s.sector) ?? { x: 0, z: 0, n: 0 };
      a.x += s.x;
      a.z += s.z;
      a.n++;
      acc.set(s.sector, a);
    }
    for (const [sector, a] of acc) this.sectorCenters.push({ sector, x: a.x / a.n, z: a.z / a.n });

    // ── Мини-карта ──
    this.root = document.createElement('div');
    this.root.className = 'panel minimap';
    this.root.innerHTML = `<div class="mm-head"></div><canvas width="210" height="240"></canvas><div class="mm-hint"><kbd>Tab</kbd> большая карта</div>`;
    this.canvas = this.root.querySelector('canvas')!;
    this.head = this.root.querySelector('.mm-head')!;
    parent.appendChild(this.root);

    // ── Большая карта ──
    this.bigRoot = document.createElement('div');
    this.bigRoot.className = 'overlay bigmap hidden';
    this.bigRoot.innerHTML = `
      <div class="bigmap-panel">
        <div class="bigmap-head"><div class="bigmap-title">東京 · КАРТА ТРАССЫ</div><div class="mm-head big"></div></div>
        <canvas width="640" height="760"></canvas>
        <div class="bigmap-legend">
          <span><i style="background:#ff2d95"></i> смотровая · квест</span>
          <span><i style="background:#ffe45c"></i> мастерская</span>
          <span><i style="background:#ff4b4b"></i> база Ваисова</span>
          <span><i style="background:#22e5ff"></i> ты</span>
          <span class="bigmap-close"><kbd>Tab</kbd> / <kbd>Esc</kbd> закрыть</span>
        </div>
      </div>`;
    this.bigCanvas = this.bigRoot.querySelector('canvas')!;
    this.bigHead = this.bigRoot.querySelector('.mm-head.big')!;
    this.bigRoot.addEventListener('click', (e) => {
      if (e.target === this.bigRoot) this.toggleBig();
    });
    bigParent.appendChild(this.bigRoot);
  }

  setObjective(id: ZoneId | null): void {
    this.objective = id;
  }

  get isBigOpen(): boolean {
    return this.bigOpen;
  }

  toggleBig(force?: boolean): boolean {
    this.bigOpen = force ?? !this.bigOpen;
    this.bigRoot.classList.toggle('hidden', !this.bigOpen);
    return this.bigOpen;
  }

  /** Мировая позиция текущей цели (для маркера на экране). */
  objectivePoi(): Poi | null {
    return this.pois.find((p) => p.id === this.objective) ?? null;
  }

  /** Текст расстояния: «1,8 км» / «340 м» / «рядом». */
  distanceText(): string {
    if (!this.objective) return '';
    const d = this.distance;
    if (d < 35) return 'рядом';
    if (d < 1000) return `${Math.round(d / 10) * 10} м`;
    return `${(d / 1000).toFixed(1).replace('.', ',')} км`;
  }

  update(dt: number, st: MapState): void {
    this.time += dt;
    const poi = this.objectivePoi();
    if (poi) {
      const near = this.track.nearest(st.x, st.z);
      const L = this.track.length;
      const dF = (((poi.s - near.s) % L) + L) % L;
      const dB = L - dF;
      const goForward = dF <= dB;
      this.distance = goForward ? dF : dB;
      // Смотрит ли нос по направлению трассы
      const fx = -Math.sin(st.heading);
      const fz = -Math.cos(st.heading);
      const facingForward = fx * near.sample.tx + fz * near.sample.tz >= 0;
      this.ahead = goForward === facingForward;
      this.routeFrom = near.index;
      this.routeTo = this.track.nearest(poi.x, poi.z).index;
      this.routeForward = goForward;
      const arrow = this.distance < 35 ? '' : this.ahead ? ' ↑' : ' ↻';
      const html = `<span class="mm-glyph" style="color:${poi.color}">${poi.glyph}</span><span class="mm-name">${poi.label}</span><span class="mm-dist">${this.distanceText()}${arrow}</span>`;
      this.head.innerHTML = html;
      this.bigHead.innerHTML = html;
    } else {
      this.distance = 0;
      const html = `<span class="mm-glyph">🌸</span><span class="mm-name">Свободная езда</span>`;
      this.head.innerHTML = html;
      this.bigHead.innerHTML = html;
    }
    this.draw(this.canvas, st, false);
    if (this.bigOpen) this.draw(this.bigCanvas, st, true);
  }

  // ─────────────────────────────────────────────────────────────────────
  private draw(canvas: HTMLCanvasElement, st: MapState, big: boolean): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const b = this.bounds;
    const padPx = big ? 46 : 12;
    const k = Math.min((w - padPx * 2) / (b.maxX - b.minX), (h - padPx * 2) / (b.maxZ - b.minZ));
    const ox = (w - (b.maxX - b.minX) * k) / 2;
    const oy = (h - (b.maxZ - b.minZ) * k) / 2;
    const mx = (x: number) => ox + (x - b.minX) * k;
    const mz = (z: number) => oy + (z - b.minZ) * k;

    ctx.clearRect(0, 0, w, h);

    const samples = this.track.samples;
    const n = samples.length;

    // Залив — лёгкая подложка на севере
    ctx.fillStyle = 'rgba(34, 120, 229, 0.10)';
    const bayTop = mz(b.minZ);
    const bayBottom = mz(-1085);
    ctx.fillRect(0, bayTop, w, Math.max(0, bayBottom - bayTop));

    // Трасса
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = big ? 5 : 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const s = samples[i % n];
      if (i === 0) ctx.moveTo(mx(s.x), mz(s.z));
      else ctx.lineTo(mx(s.x), mz(s.z));
    }
    ctx.stroke();

    // Маршрут до цели
    const poi = this.objectivePoi();
    if (poi && this.distance > 20) {
      ctx.lineWidth = big ? 6 : 4;
      ctx.strokeStyle = poi.color;
      ctx.shadowColor = poi.color;
      ctx.shadowBlur = big ? 14 : 8;
      ctx.beginPath();
      let i = this.routeFrom;
      const step = this.routeForward ? 1 : -1;
      let guard = 0;
      ctx.moveTo(mx(samples[i].x), mz(samples[i].z));
      while (i !== this.routeTo && guard++ < n) {
        i = (i + step + n) % n;
        ctx.lineTo(mx(samples[i].x), mz(samples[i].z));
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Подписи секторов (только на большой)
    if (big) {
      ctx.font = '700 15px "Noto Sans JP", "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const c of this.sectorCenters) {
        const lab = SECTOR_LABELS[c.sector];
        if (c.sector === 'overlook' || c.sector === 'docks') continue; // там и так стоят точки
        const x = mx(c.x);
        const y = mz(c.z);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText(lab.jp, x, y - 10);
        ctx.font = '600 11px "Inter", sans-serif';
        ctx.fillText(lab.ru.toUpperCase(), x, y + 8);
        ctx.font = '700 15px "Noto Sans JP", "Inter", sans-serif';
      }
    }

    // Старт
    const start = this.track.at(30);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(mx(start.x), mz(start.z), big ? 5 : 3, 0, Math.PI * 2);
    ctx.fill();

    // Точки интереса
    for (const p of this.pois) {
      const x = mx(p.x);
      const y = mz(p.z);
      const isObj = p.id === this.objective;
      const pulse = isObj ? 1 + 0.25 * Math.sin(this.time * 5) : 1;
      const r = (big ? 13 : 8) * pulse;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = isObj ? (big ? 22 : 12) : 4;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#08061a';
      ctx.font = `${big ? 15 : 10}px "Noto Sans JP", "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.glyph, x, y + 1);
      if (big) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 12px "Inter", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(p.label, x + 18, y);
      }
    }

    // Машина
    const drawCar = (x: number, z: number, heading: number, color: string, size: number) => {
      const cx = mx(x);
      const cy = mz(z);
      const fx = -Math.sin(heading);
      const fz = -Math.cos(heading);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(fz, fx));
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.8, size * 0.7);
      ctx.lineTo(-size * 0.4, 0);
      ctx.lineTo(-size * 0.8, -size * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    if (st.driving) {
      drawCar(st.x, st.z, st.heading, '#22e5ff', big ? 12 : 8);
    } else {
      drawCar(st.carX, st.carZ, st.carHeading, 'rgba(255,255,255,0.75)', big ? 9 : 6);
      ctx.fillStyle = '#22e5ff';
      ctx.shadowColor = '#22e5ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(mx(st.x), mz(st.z), big ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Компас
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `700 ${big ? 13 : 10}px "Inter", sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('N ↑', w - 6, 6);
  }
}
