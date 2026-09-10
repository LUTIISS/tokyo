import * as THREE from 'three';
import { mulberry32 } from './noise';

/**
 * Процедурные винтажные плакаты в духе «облачных» мем-постеров:
 * тёмно-синее небо сверху, золотые облака, тяжёлый гротеск, потёртая кремовая рамка.
 *
 * Это заглушки на случай, если настоящие картинки ещё не положили в public/media/posters/.
 * Реальные файлы из posters.json подменяют их один в один.
 */
export interface PosterSpec {
  /** Верхние строки (кремовые, на фоне неба). */
  top: string[];
  /** Нижние строки (тёмно-коричневые, на фоне облаков). */
  bottom: string[];
  /** Что нарисовать силуэтом в центре. */
  figure: 'runner' | 'hand' | 'sitting' | 'sun' | 'duo' | 'rainbow';
}

export const POSTERS: PosterSpec[] = [
  { top: ['пусть', 'deep dark', 'fantasies'], bottom: ['будут', 'so stunning'], figure: 'runner' },
  { top: ['Протягиваю', 'тебе'], bottom: ['много много', 'здоровья'], figure: 'hand' },
  { top: ['Летящий в даль', 'mAsstep'], bottom: ['поздравляет', 'тебя'], figure: 'sitting' },
  { top: ['Это', 'солнце'], bottom: ['будет тебя', 'по утрам'], figure: 'sun' },
  { top: ['Двойной', 'respect!'], bottom: ['Поздравляем тебя,', 'legendary bro!'], figure: 'duo' },
  { top: ['Поздравляем,', 'bro!'], bottom: ['Пусть каждый day', 'будет', 'legendary!'], figure: 'rainbow' },
];

const W = 512;
const H = 1024;

/** Подобрать размер шрифта, чтобы строка влезла по ширине. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, start: number, weight = 900): number {
  let size = start;
  for (let i = 0; i < 40; i++) {
    ctx.font = `${weight} ${size}px "Oswald", "Arial Narrow", "Inter", sans-serif`;
    if (ctx.measureText(text).width <= maxW || size <= 12) break;
    size -= 2;
  }
  return size;
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  yStart: number,
  maxW: number,
  base: number,
  color: string,
  shadow: string,
): number {
  let y = yStart;
  for (const line of lines) {
    const size = fitFont(ctx, line, maxW, base);
    ctx.font = `900 ${size}px "Oswald", "Arial Narrow", "Inter", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = shadow;
    ctx.fillText(line, W / 2 + 3, y + 3);
    ctx.fillStyle = color;
    ctx.fillText(line, W / 2, y);
    y += size * 0.92;
  }
  return y;
}

function drawFigure(ctx: CanvasRenderingContext2D, kind: PosterSpec['figure'], rnd: () => number): void {
  const cx = W / 2;
  const cy = H * 0.52;
  ctx.save();
  if (kind === 'sun') {
    // Солнце с лучами
    const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, 190);
    g.addColorStop(0, '#fff9c4');
    g.addColorStop(0.45, '#ffd54f');
    g.addColorStop(1, 'rgba(255, 193, 7, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 190, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffca28';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70);
      ctx.lineTo(cx + Math.cos(a + 0.09) * 150, cy + Math.sin(a + 0.09) * 150);
      ctx.lineTo(cx + Math.cos(a - 0.09) * 150, cy + Math.sin(a - 0.09) * 150);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#fff59d';
    ctx.beginPath();
    ctx.arc(cx, cy, 74, 0, Math.PI * 2);
    ctx.fill();
    // Лицо
    ctx.fillStyle = 'rgba(90, 60, 20, 0.55)';
    ctx.beginPath();
    ctx.ellipse(cx - 24, cy - 12, 9, 6, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 24, cy - 12, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90, 60, 20, 0.5)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy + 8, 30, 0.25, Math.PI - 0.25);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (kind === 'rainbow') {
    // Радуга над зелёным лугом и две плюшевые фигуры
    const colors = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#5e35b1'];
    ctx.lineWidth = 22;
    colors.forEach((col, i) => {
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(cx, cy + 130, 250 - i * 22, Math.PI, Math.PI * 2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#7cb342';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 300, 340, 150, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8bc34a';
    ctx.fillRect(cx - 260, cy + 168, 520, 200);
    ctx.fillStyle = '#5d4037';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * 88, cy + 96, 62, 84, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + s * 88, cy - 6, 52, 56, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + s * 30, cy + 84, 26, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fff9c4';
    for (let i = 0; i < 12; i++) {
      const x = cx - 300 + rnd() * 600;
      const y = cy + 190 + rnd() * 150;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  ctx.fillStyle = 'rgba(58, 34, 18, 0.82)';
  if (kind === 'duo') {
    // Двое в кожанках на фоне взрыва облаков
    const rays = ctx.createRadialGradient(cx, cy - 40, 20, cx, cy - 40, 300);
    rays.addColorStop(0, 'rgba(255, 224, 130, 0.85)');
    rays.addColorStop(1, 'rgba(255, 167, 38, 0)');
    ctx.fillStyle = rays;
    ctx.beginPath();
    ctx.arc(cx, cy - 40, 300, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(38, 26, 20, 0.9)';
    for (const s of [-1, 1]) {
      const hx = cx + s * 96;
      ctx.beginPath();
      ctx.ellipse(hx, cy - 76, 66, 78, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hx - 118, cy + 190);
      ctx.quadraticCurveTo(hx, cy - 20, hx + 118, cy + 190);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(70, 50, 40, 0.85)';
    ctx.beginPath();
    ctx.ellipse(cx + 96, cy - 118, 62, 36, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (kind === 'runner') {
    // Торс, руки, ноги — бегущая фигура
    ctx.beginPath();
    ctx.ellipse(cx, cy - 150, 46, 54, 0, 0, Math.PI * 2); // голова
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 96, cy - 70);
    ctx.quadraticCurveTo(cx, cy - 110, cx + 96, cy - 70);
    ctx.lineTo(cx + 60, cy + 90);
    ctx.lineTo(cx - 60, cy + 90);
    ctx.closePath();
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 88, cy - 66);
      ctx.quadraticCurveTo(cx + s * 130, cy + 10, cx + s * 70, cy + 40);
      ctx.lineTo(cx + s * 56, cy + 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#c62828';
    ctx.beginPath();
    ctx.moveTo(cx - 62, cy + 86);
    ctx.lineTo(cx + 62, cy + 86);
    ctx.lineTo(cx + 52, cy + 168);
    ctx.lineTo(cx - 52, cy + 168);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(58, 34, 18, 0.82)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 12, cy + 164);
      ctx.lineTo(cx + s * 50, cy + 164);
      ctx.lineTo(cx + s * 44, cy + 260);
      ctx.lineTo(cx + s * 14, cy + 260);
      ctx.closePath();
      ctx.fill();
    }
  } else if (kind === 'hand') {
    // Протянутая рука крупным планом
    ctx.beginPath();
    ctx.ellipse(cx + 30, cy - 170, 44, 52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b71c1c';
    ctx.beginPath();
    ctx.ellipse(cx + 30, cy - 200, 46, 26, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(245, 240, 230, 0.9)';
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy - 110);
    ctx.quadraticCurveTo(cx + 30, cy - 140, cx + 100, cy - 108);
    ctx.lineTo(cx + 96, cy + 130);
    ctx.lineTo(cx - 24, cy + 130);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(58, 34, 18, 0.86)';
    ctx.beginPath();
    ctx.ellipse(cx - 66, cy + 6, 78, 92, -0.3, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(cx - 128 + i * 6, cy - 44 + i * 30, 20, 40, -0.5 + i * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Фигура, сидящая на «руке», и шкафчик
    ctx.fillStyle = 'rgba(150, 150, 155, 0.9)';
    ctx.fillRect(cx - 190, cy - 210, 130, 250);
    ctx.strokeStyle = 'rgba(60, 60, 65, 0.8)';
    ctx.lineWidth = 4;
    ctx.strokeRect(cx - 190, cy - 210, 130, 250);
    ctx.beginPath();
    ctx.moveTo(cx - 125, cy - 210);
    ctx.lineTo(cx - 125, cy + 40);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120, 72, 30, 0.9)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 80, 210, 52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(58, 34, 18, 0.85)';
    ctx.beginPath();
    ctx.ellipse(cx + 40, cy - 112, 38, 44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(245, 240, 230, 0.9)';
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 64);
    ctx.quadraticCurveTo(cx + 40, cy - 90, cx + 92, cy - 64);
    ctx.lineTo(cx + 86, cy + 34);
    ctx.lineTo(cx - 2, cy + 34);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(90, 100, 120, 0.9)';
    ctx.fillRect(cx - 4, cy + 30, 92, 46);
    ctx.fillRect(cx + 60, cy + 60, 90, 28);
  }
  ctx.restore();
}

/** Рисует один плакат в canvas-текстуру. */
export function makePosterTexture(spec: PosterSpec, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(seed * 7919 + 13);

  // Кремовая подложка-рамка
  ctx.fillStyle = '#efe3c8';
  ctx.fillRect(0, 0, W, H);
  const pad = Math.round(W * 0.028);
  const iw = W - pad * 2;
  const ih = H - pad * 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, iw, ih);
  ctx.clip();

  // Небо: тёмно-синее сверху → золотое снизу
  const sky = ctx.createLinearGradient(0, pad, 0, pad + ih);
  if (spec.figure === 'sun') {
    sky.addColorStop(0, '#2f5d8f');
    sky.addColorStop(0.42, '#9dc4e0');
    sky.addColorStop(0.7, '#e8dfa8');
    sky.addColorStop(1, '#d9c98a');
  } else if (spec.figure === 'rainbow') {
    sky.addColorStop(0, '#1f3a63');
    sky.addColorStop(0.3, '#8fc0e8');
    sky.addColorStop(0.62, '#cfe6f7');
    sky.addColorStop(0.82, '#e6dfa4');
    sky.addColorStop(1, '#d8c477');
  } else {
    sky.addColorStop(0, '#1c2a4a');
    sky.addColorStop(0.3, '#42406a');
    sky.addColorStop(0.55, '#d98b3f');
    sky.addColorStop(0.78, '#f0b45e');
    sky.addColorStop(1, '#e39a45');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(pad, pad, iw, ih);

  // Облака — кучевые пятна из окружностей
  const cloud = (x: number, y: number, r: number, alpha: number, tint: string) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = tint;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const rr = r * (0.45 + rnd() * 0.55);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.65, y + Math.sin(a) * r * 0.32, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  const white = spec.figure === 'rainbow' || spec.figure === 'sun';
  for (let i = 0; i < 16; i++) {
    const y = pad + ih * (0.32 + rnd() * 0.66);
    const t = (y - pad) / ih;
    const tint = white ? '#ffffff' : t > 0.72 ? '#c97b2c' : '#ffcf7a';
    cloud(pad + rnd() * iw, y, 40 + rnd() * 90, white ? 0.4 : 0.35 + rnd() * 0.35, tint);
  }
  for (let i = 0; i < 8; i++) {
    cloud(pad + rnd() * iw, pad + ih * (0.28 + rnd() * 0.25), 50 + rnd() * 70, 0.22, white ? '#ffffff' : '#f6d9a0');
  }

  drawFigure(ctx, spec.figure, rnd);

  // Текст
  const maxW = iw * 0.92;
  const topBase = spec.top.length >= 3 ? 82 : 100;
  drawLines(ctx, spec.top, pad + ih * 0.02, maxW, topBase, '#f2e6c8', 'rgba(20, 16, 30, 0.55)');
  const bottomBase = spec.bottom.length >= 3 ? 76 : 96;
  let bh = 0;
  for (const line of spec.bottom) bh += fitFont(ctx, line, maxW, bottomBase) * 0.92;
  drawLines(ctx, spec.bottom, pad + ih - bh - ih * 0.02, maxW, bottomBase, '#3e2415', 'rgba(255, 235, 190, 0.45)');

  // Потёртости и зерно
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#000' : '#fff';
    ctx.fillRect(pad + rnd() * iw, pad + rnd() * ih, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#efe3c8';
  ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    const x = pad + rnd() * iw;
    ctx.moveTo(x, pad + rnd() * ih);
    ctx.lineTo(x + (rnd() - 0.5) * 40, pad + rnd() * ih);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // Затемнение по краям рамки — «состаренная» бумага
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = '#b9a882';
  ctx.lineWidth = 3;
  ctx.strokeRect(pad - 1.5, pad - 1.5, iw + 3, ih + 3);
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
