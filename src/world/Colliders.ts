/**
 * Простые повёрнутые прямоугольники (OBB) для зданий и стен + пространственный хэш.
 * Машина и персонаж считаются кругом.
 */
export interface OBB {
  x: number;
  z: number;
  hw: number;
  hd: number;
  yaw: number;
  /** Необязательная метка (для отладки/логики). */
  tag?: string;
  /** Отключённый коллайдер (например, открытые ворота). */
  disabled?: boolean;
}

export interface CircleHit {
  x: number;
  z: number;
  hit: boolean;
  /** Нормаль выталкивания (единичная), если hit. */
  nx: number;
  nz: number;
  obb: OBB | null;
}

export class Colliders {
  private cell = 40;
  private hash = new Map<number, OBB[]>();
  readonly all: OBB[] = [];

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  add(obb: OBB): OBB {
    this.all.push(obb);
    const r = Math.hypot(obb.hw, obb.hd) + 4;
    const minX = Math.floor((obb.x - r) / this.cell);
    const maxX = Math.floor((obb.x + r) / this.cell);
    const minZ = Math.floor((obb.z - r) / this.cell);
    const maxZ = Math.floor((obb.z + r) / this.cell);
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const k = this.key(cx, cz);
        let list = this.hash.get(k);
        if (!list) this.hash.set(k, (list = []));
        list.push(obb);
      }
    }
    return obb;
  }

  candidates(x: number, z: number): OBB[] {
    return this.hash.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? [];
  }

  /** Есть ли пересечение круга с каким-либо OBB. */
  test(x: number, z: number, r: number): boolean {
    for (const o of this.candidates(x, z)) {
      if (o.disabled) continue;
      if (circleVsObb(x, z, r, o) !== null) return true;
    }
    return false;
  }

  /** Выталкивает круг из всех пересекаемых OBB (до 3 итераций). */
  resolveCircle(x: number, z: number, r: number): CircleHit {
    const res: CircleHit = { x, z, hit: false, nx: 0, nz: 0, obb: null };
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const o of this.candidates(res.x, res.z)) {
        if (o.disabled) continue;
        const push = circleVsObb(res.x, res.z, r, o);
        if (!push) continue;
        res.x += push.nx * push.depth;
        res.z += push.nz * push.depth;
        res.hit = true;
        res.nx = push.nx;
        res.nz = push.nz;
        res.obb = o;
        moved = true;
      }
      if (!moved) break;
    }
    return res;
  }
}

/** Возвращает нормаль и глубину проникновения круга в OBB либо null. */
export function circleVsObb(
  px: number,
  pz: number,
  r: number,
  o: OBB,
): { nx: number; nz: number; depth: number } | null {
  // В локальные координаты бокса
  const dx = px - o.x;
  const dz = pz - o.z;
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  // Локальная ось X бокса в мире: (c, -s); ось Z: (s, c)  (поворот вокруг Y на yaw)
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  // Ближайшая точка на прямоугольнике
  const cx = Math.max(-o.hw, Math.min(o.hw, lx));
  const cz = Math.max(-o.hd, Math.min(o.hd, lz));
  let nx = lx - cx;
  let nz = lz - cz;
  let d = Math.hypot(nx, nz);
  let depth: number;
  if (d > 1e-6) {
    if (d >= r) return null;
    nx /= d;
    nz /= d;
    depth = r - d;
  } else {
    // Центр внутри бокса — выталкиваем по ближайшей грани
    const toRight = o.hw - lx;
    const toLeft = lx + o.hw;
    const toFront = o.hd - lz;
    const toBack = lz + o.hd;
    const m = Math.min(toRight, toLeft, toFront, toBack);
    if (m === toRight) {
      nx = 1;
      nz = 0;
    } else if (m === toLeft) {
      nx = -1;
      nz = 0;
    } else if (m === toFront) {
      nx = 0;
      nz = 1;
    } else {
      nx = 0;
      nz = -1;
    }
    depth = m + r;
    d = 0;
  }
  // Обратно в мир
  const wx = nx * c + nz * s;
  const wz = -nx * s + nz * c;
  return { nx: wx, nz: wz, depth };
}
