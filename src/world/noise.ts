/**
 * 2D simplex noise + fbm + маленький детерминированный PRNG.
 * Всё процедурное в игре сидится от этих функций, чтобы мир был одинаковым при каждом запуске.
 */

const GRAD3: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

function buildPerm(seed: number): Uint8Array {
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  const rnd = mulberry32(seed);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = base[i];
    base[i] = base[j];
    base[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
}

const PERM = buildPerm(1988);

export function noise2(xin: number, yin: number): number {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;

  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const g = GRAD3[PERM[ii + PERM[jj]] & 7];
    t0 *= t0;
    n += t0 * t0 * (g[0] * x0 + g[1] * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const g = GRAD3[PERM[ii + i1 + PERM[jj + j1]] & 7];
    t1 *= t1;
    n += t1 * t1 * (g[0] * x1 + g[1] * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const g = GRAD3[PERM[ii + 1 + PERM[jj + 1]] & 7];
    t2 *= t2;
    n += t2 * t2 * (g[0] * x2 + g[1] * y2);
  }
  return 70 * n; // ≈ [-1, 1]
}

/** Фрактальный шум, результат ≈ [-1, 1]. */
export function fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * freq + o * 17.3, y * freq - o * 9.1);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Детерминированный PRNG, [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Экспоненциальное сглаживание, независимое от FPS. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
