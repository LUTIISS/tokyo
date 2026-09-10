import * as THREE from 'three';
import { mulberry32 } from './noise';

/** Канвас-текстуры, чтобы ничего не грузить с диска. */

export type WindowTint = 'warm' | 'cool' | 'mixed';

export interface WindowTextures {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
}

/**
 * Плитка 4×4 окон (256×256 px, повтор каждые 8 м). Левый верхний угол (0..8 px) — гарантированно стена,
 * чтобы крыши можно было мапить на uv≈(0,0).
 */
export function makeWindowTextures(seed: number, tint: WindowTint, litChance = 0.38): WindowTextures {
  const size = 256;
  const cell = 64;
  const rnd = mulberry32(seed);

  const mapC = document.createElement('canvas');
  const emiC = document.createElement('canvas');
  mapC.width = mapC.height = emiC.width = emiC.height = size;
  const m = mapC.getContext('2d')!;
  const e = emiC.getContext('2d')!;

  m.fillStyle = '#20222c';
  m.fillRect(0, 0, size, size);
  // лёгкая фактура бетона
  for (let i = 0; i < 400; i++) {
    m.fillStyle = `rgba(255,255,255,${(rnd() * 0.05).toFixed(3)})`;
    m.fillRect(rnd() * size, rnd() * size, 2 + rnd() * 6, 1 + rnd() * 3);
  }
  e.fillStyle = '#000';
  e.fillRect(0, 0, size, size);

  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      const x = cx * cell + 12;
      const y = cy * cell + 10;
      const w = 40;
      const h = 44;
      const lit = rnd() < litChance;
      // Стекло в диффузе — тёмное, слегка синее
      m.fillStyle = lit ? '#3a3f55' : '#0c0e15';
      m.fillRect(x, y, w, h);
      // рама
      m.strokeStyle = 'rgba(0,0,0,0.6)';
      m.lineWidth = 2;
      m.strokeRect(x + 1, y + 1, w - 2, h - 2);
      if (lit) {
        let color: string;
        if (tint === 'warm') color = rnd() < 0.8 ? '#ffd7a3' : '#ffe9c9';
        else if (tint === 'cool') color = rnd() < 0.8 ? '#cfe6ff' : '#e6f3ff';
        else color = rnd() < 0.5 ? '#ffd7a3' : rnd() < 0.5 ? '#cfe6ff' : '#ffc6e0';
        const b = 0.3 + rnd() * 0.55;
        e.fillStyle = color;
        e.globalAlpha = b;
        e.fillRect(x + 2, y + 2, w - 4, h - 4);
        e.globalAlpha = 1;
        // «шторка» — иногда окно наполовину
        if (rnd() < 0.25) {
          e.fillStyle = '#000';
          e.fillRect(x, y, w, h * (0.3 + rnd() * 0.4));
        }
      }
    }
  }

  const map = new THREE.CanvasTexture(mapC);
  const emissive = new THREE.CanvasTexture(emiC);
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
  }
  return { map, emissive };
}

/** Вертикальная или горизонтальная неоновая вывеска с японским текстом. */
export function makeNeonSignTexture(text: string, color: string, vertical: boolean): THREE.CanvasTexture {
  const chars = Array.from(text);
  const cellPx = 96;
  const pad = 24;
  const c = document.createElement('canvas');
  if (vertical) {
    c.width = 128;
    c.height = cellPx * chars.length + pad * 2;
  } else {
    c.width = cellPx * chars.length + pad * 2;
    c.height = 128;
  }
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#07070d';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.strokeRect(8, 8, c.width - 16, c.height - 16);

  ctx.fillStyle = color;
  ctx.font = `900 64px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowBlur = 26;
  chars.forEach((ch, i) => {
    if (vertical) ctx.fillText(ch, c.width / 2, pad + cellPx * i + cellPx / 2);
    else ctx.fillText(ch, pad + cellPx * i + cellPx / 2, c.height / 2);
  });
  // второй проход — ярче ядро
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.75;
  chars.forEach((ch, i) => {
    if (vertical) ctx.fillText(ch, c.width / 2, pad + cellPx * i + cellPx / 2);
    else ctx.fillText(ch, pad + cellPx * i + cellPx / 2, c.height / 2);
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Заглушка для стенда: «сюда мем». */
export function makeBillboardPlaceholder(n: number): THREE.CanvasTexture {
  const w = 768;
  const h = 432;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const palette = [
    ['#ff2d95', '#22e5ff'],
    ['#9b5cff', '#ffe45c'],
    ['#22e5ff', '#ff7a1a'],
    ['#ff2d95', '#6dff3c'],
  ];
  const [a, b] = palette[n % palette.length];
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#12081f');
  g.addColorStop(1, '#061420');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // диагональные полосы
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = a;
  ctx.lineWidth = 18;
  for (let i = -h; i < w + h; i += 70) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i - h, h);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = b;
  ctx.lineWidth = 8;
  ctx.shadowColor = b;
  ctx.shadowBlur = 24;
  ctx.strokeRect(18, 18, w - 36, h - 36);

  // Пока в public/media/billboards/ нет своих картинок, экраны поздравляют именинника.
  const GREETINGS = [
    'ТЫ ЛЕГЕНДА, БРАТ',
    'ГОРОД ГУЛЯЕТ ЗА ТЕБЯ',
    'ЖЕЛАЕМ RIGHT VERSION',
    'ДРИФТУЙ И НЕ СТАРЕЙ',
  ];

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `900 34px "Noto Sans JP", sans-serif`;
  ctx.fillStyle = b;
  ctx.shadowColor = b;
  ctx.shadowBlur = 16;
  ctx.fillText('誕生日おめでとう', w / 2, 62);

  ctx.fillStyle = a;
  ctx.shadowColor = a;
  ctx.shadowBlur = 30;
  ctx.font = `900 96px "Orbitron", "Inter", sans-serif`;
  ctx.fillText('АНДРЮХА', w / 2, h / 2 - 30);

  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 12;
  ctx.font = `800 52px "Inter", "Noto Sans JP", sans-serif`;
  ctx.fillText('С ДНЁМ РОЖДЕНИЯ!', w / 2, h / 2 + 48);

  ctx.font = `600 30px "Inter", "Noto Sans JP", sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.shadowBlur = 0;
  ctx.fillText(GREETINGS[n % GREETINGS.length], w / 2, h / 2 + 112);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Мягкий лепесток сакуры для частиц. */
export function makePetalTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.translate(s / 2, s / 2);
  ctx.rotate(0.4);
  const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
  g.addColorStop(0, 'rgba(255,240,248,1)');
  g.addColorStop(0.6, 'rgba(255,182,214,0.95)');
  g.addColorStop(1, 'rgba(255,140,190,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, 24, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  // выемка лепестка
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.ellipse(22, 0, 8, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Текстура плоского «спрайта» дыма. */
export function makeSmokeTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Текстура для текстовой таблички (название зоны и т.п.). */
export function makeLabelTexture(
  lines: string[],
  opts: { color?: string; bg?: string; font?: string; width?: number; glow?: boolean } = {},
): THREE.CanvasTexture {
  const width = opts.width ?? 1024;
  const lineH = 150;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = lineH * lines.length + 60;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = opts.bg ?? '#07070d';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const color = opts.color ?? '#ff2d95';
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.shadowColor = color;
  ctx.shadowBlur = opts.glow === false ? 0 : 22;
  ctx.strokeRect(12, 12, c.width - 24, c.height - 24);
  lines.forEach((line, i) => {
    ctx.font = opts.font ?? `900 96px "Noto Sans JP", "Orbitron", "Inter", sans-serif`;
    ctx.fillStyle = color;
    ctx.shadowBlur = opts.glow === false ? 0 : 30;
    ctx.fillText(line, c.width / 2, 30 + lineH * i + lineH / 2);
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.7;
    ctx.shadowBlur = 0;
    ctx.fillText(line, c.width / 2, 30 + lineH * i + lineH / 2);
    ctx.globalAlpha = 1;
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
