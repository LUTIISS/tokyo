import * as THREE from 'three';
import { ROAD, TRACK_POINTS, WORLD } from '@/config';
import { clamp, lerp } from './noise';
import type { Terrain } from './Terrain';

export interface RoadSample {
  x: number;
  y: number;
  z: number;
  /** Единичная касательная (направление движения). */
  tx: number;
  tz: number;
  /** Единичная нормаль вправо от движения. */
  nx: number;
  nz: number;
  /** Пройденное расстояние от старта (м). */
  s: number;
  /** Кривизна (1/м), знак: + — поворот направо. */
  curvature: number;
  bridge: boolean;
  /** Сектор для декора. */
  sector: Sector;
}

export type Sector = 'city' | 'bridge' | 'touge' | 'overlook' | 'industrial' | 'docks';

export interface NearestResult {
  index: number;
  sample: RoadSample;
  /** Подписанное боковое смещение (+ вправо от движения). */
  lateral: number;
  /** Расстояние до оси дороги. */
  dist: number;
  /** Высота дороги в этой точке. */
  y: number;
  /** Продольная позиция вдоль трассы (м). */
  s: number;
}

const BRIDGE_HEIGHT = 9;

/**
 * Замкнутая трасса-петля: сплайн по контрольным точкам, дискретизация по длине дуги,
 * высоты из ландшафта со сглаживанием, пространственный хэш для быстрого поиска.
 */
export class Track {
  samples: RoadSample[] = [];
  length = 0;
  readonly halfWidth = ROAD.width / 2;
  private hash = new Map<number, number[]>();
  private readonly cell = 24;
  private curve: THREE.CatmullRomCurve3;

  constructor(private terrain: Terrain) {
    const pts = TRACK_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.build();
  }

  private build(): void {
    const approxLen = this.curve.getLength();
    const count = Math.ceil(approxLen / ROAD.sampleStep);
    const pts = this.curve.getSpacedPoints(count); // count+1 точек, последняя == первой
    pts.pop();

    // Сырые высоты.
    const raw: number[] = [];
    const bridge: boolean[] = [];
    for (const p of pts) {
      const base = this.terrain.base(p.x, p.z);
      const isBay = base < WORLD.waterLevel - 1.5;
      bridge.push(isBay);
      raw.push(isBay ? BRIDGE_HEIGHT : Math.max(base, 1.0));
    }

    // Сглаживание высот (циклическое, два прохода разного окна).
    const smoothed = smoothCyclic(smoothCyclic(raw, 45), 20);

    const n = pts.length;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      if (i > 0) s += Math.hypot(p.x - prev.x, p.z - prev.z);
      this.samples.push({
        x: p.x,
        y: smoothed[i],
        z: p.z,
        tx,
        tz,
        nx: -tz,
        nz: tx,
        s,
        curvature: 0,
        bridge: bridge[i],
        sector: classifySector(p.x, p.z, bridge[i]),
      });
    }
    this.length = s + Math.hypot(pts[0].x - pts[n - 1].x, pts[0].z - pts[n - 1].z);

    // Кривизна: изменение угла касательной на метр (сглаженная).
    for (let i = 0; i < n; i++) {
      const a = this.samples[(i - 3 + n) % n];
      const b = this.samples[(i + 3) % n];
      const cross = a.tx * b.tz - a.tz * b.tx;
      const dot = a.tx * b.tx + a.tz * b.tz;
      const dAng = Math.atan2(cross, dot);
      this.samples[i].curvature = dAng / (6 * ROAD.sampleStep);
    }

    // Пространственный хэш.
    for (let i = 0; i < n; i++) {
      const k = this.key(this.samples[i].x, this.samples[i].z);
      let list = this.hash.get(k);
      if (!list) this.hash.set(k, (list = []));
      list.push(i);
    }
  }

  private key(x: number, z: number): number {
    const cx = Math.floor(x / this.cell) + 4096;
    const cz = Math.floor(z / this.cell) + 4096;
    return cx * 8192 + cz;
  }

  /** Ближайший сэмпл к точке. Радиус поиска ~ cell. Если далеко — грубый перебор. */
  nearest(x: number, z: number): NearestResult {
    let best = -1;
    let bestD2 = Infinity;
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.hash.get((cx + dx + 4096) * 8192 + (cz + dz + 4096));
        if (!list) continue;
        for (const i of list) {
          const s = this.samples[i];
          const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = i;
          }
        }
      }
    }
    if (best < 0) {
      // Далеко от дороги — грубый поиск с шагом.
      for (let i = 0; i < this.samples.length; i += 8) {
        const s = this.samples[i];
        const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
      for (let i = Math.max(0, best - 8); i < Math.min(this.samples.length, best + 8); i++) {
        const s = this.samples[i];
        const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
    }
    const smp = this.samples[best];
    // Проецируем на отрезок к следующему/предыдущему сэмплу для гладкой высоты.
    const n = this.samples.length;
    const dx = x - smp.x;
    const dz = z - smp.z;
    const along = dx * smp.tx + dz * smp.tz;
    const lateral = dx * smp.nx + dz * smp.nz;
    const nb = this.samples[(best + (along >= 0 ? 1 : -1) + n) % n];
    const t = clamp(Math.abs(along) / ROAD.sampleStep, 0, 1);
    const y = lerp(smp.y, nb.y, t) + WORLD.roadLift;
    return {
      index: best,
      sample: smp,
      lateral,
      dist: Math.abs(lateral),
      y,
      s: smp.s + along,
    };
  }

  /** Точка на трассе по продольной координате s. */
  at(s: number): RoadSample {
    const n = this.samples.length;
    const stepLen = this.length / n;
    let idx = Math.round((((s % this.length) + this.length) % this.length) / stepLen);
    idx = ((idx % n) + n) % n;
    return this.samples[idx];
  }

  /** Сэмпл, ближайший к контрольной точке с индексом i. */
  atControl(i: number): RoadSample {
    const [x, z] = TRACK_POINTS[i];
    return this.samples[this.nearest(x, z).index];
  }

  /** Средняя длина дуги между сэмплами: удобно для расстановки объектов. */
  forEachAlong(step: number, fn: (s: RoadSample, i: number, dist: number) => void, start = 0): void {
    const n = this.samples.length;
    let next = start;
    for (let i = 0; i < n; i++) {
      const smp = this.samples[i];
      if (smp.s >= next) {
        fn(smp, i, smp.s);
        next += step;
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Геометрия
  // ───────────────────────────────────────────────────────────────────────

  buildMeshes(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'track';
    group.add(this.buildRoad());
    group.add(this.buildSidewalksAndRails());
    group.add(this.buildBridgeStructure());
    return group;
  }

  private buildRoad(): THREE.Mesh {
    const n = this.samples.length;
    const w = this.halfWidth + 0.9; // с обочиной, бордюр рисуется в текстуре
    const positions = new Float32Array((n + 1) * 2 * 3);
    const uvs = new Float32Array((n + 1) * 2 * 2);
    const normals = new Float32Array((n + 1) * 2 * 3);
    const indices: number[] = [];
    const texLen = 12; // длина повтора текстуры вдоль дороги (м)

    for (let i = 0; i <= n; i++) {
      const smp = this.samples[i % n];
      const s = i === n ? this.length : smp.s;
      const y = smp.y + WORLD.roadLift;
      const lx = smp.x - smp.nx * w;
      const lz = smp.z - smp.nz * w;
      const rx = smp.x + smp.nx * w;
      const rz = smp.z + smp.nz * w;
      positions.set([lx, y, lz], i * 6);
      positions.set([rx, y, rz], i * 6 + 3);
      uvs.set([0, s / texLen], i * 4);
      uvs.set([1, s / texLen], i * 4 + 2);
      normals.set([0, 1, 0], i * 6);
      normals.set([0, 1, 0], i * 6 + 3);
      if (i < n) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(indices);

    const tex = makeRoadTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.82,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'road';
    return mesh;
  }

  /** Тротуары в городе/промзоне, отбойники на тогэ и мосту. */
  private buildSidewalksAndRails(): THREE.Group {
    const g = new THREE.Group();
    const n = this.samples.length;

    // ── Тротуары ──
    const swPos: number[] = [];
    const swIdx: number[] = [];
    const swCol: number[] = [];
    const sidewalkW = 2.6;
    const sidewalkH = 0.16;
    const concrete = new THREE.Color(0x6a6a72);
    const curb = new THREE.Color(0x8a8a90);

    const pushQuadStrip = (
      arrPos: number[],
      arrIdx: number[],
      arrCol: number[] | null,
      color: THREE.Color | null,
      a: THREE.Vector3,
      b: THREE.Vector3,
      first: boolean,
    ) => {
      const base = arrPos.length / 3;
      arrPos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      if (arrCol && color) arrCol.push(color.r, color.g, color.b, color.r, color.g, color.b);
      if (!first) arrIdx.push(base - 2, base, base - 1, base - 1, base, base + 1);
    };

    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    for (const side of [-1, 1]) {
      let first = true;
      for (let i = 0; i <= n; i++) {
        const smp = this.samples[i % n];
        const urban = smp.sector === 'city' || smp.sector === 'industrial' || smp.sector === 'docks';
        if (!urban) {
          first = true;
          continue;
        }
        const inner = this.halfWidth + 0.9;
        const outer = inner + sidewalkW;
        const y = smp.y + WORLD.roadLift + sidewalkH;
        // верхняя плоскость тротуара: 2 вершины (внутренняя, внешняя)
        va.set(smp.x + smp.nx * inner * side, y, smp.z + smp.nz * inner * side);
        vb.set(smp.x + smp.nx * outer * side, y - 0.05, smp.z + smp.nz * outer * side);
        pushQuadStrip(swPos, swIdx, swCol, concrete, va, vb, first);
        first = false;
      }
      // Вертикальная стенка бордюра
      first = true;
      for (let i = 0; i <= n; i++) {
        const smp = this.samples[i % n];
        const urban = smp.sector === 'city' || smp.sector === 'industrial' || smp.sector === 'docks';
        if (!urban) {
          first = true;
          continue;
        }
        const inner = this.halfWidth + 0.9;
        const yTop = smp.y + WORLD.roadLift + sidewalkH;
        va.set(smp.x + smp.nx * inner * side, smp.y - 0.1, smp.z + smp.nz * inner * side);
        vb.set(smp.x + smp.nx * inner * side, yTop, smp.z + smp.nz * inner * side);
        pushQuadStrip(swPos, swIdx, swCol, curb, va, vb, first);
        first = false;
      }
    }
    const swGeo = new THREE.BufferGeometry();
    swGeo.setAttribute('position', new THREE.Float32BufferAttribute(swPos, 3));
    swGeo.setAttribute('color', new THREE.Float32BufferAttribute(swCol, 3));
    swGeo.setIndex(swIdx);
    swGeo.computeVertexNormals();
    const sidewalk = new THREE.Mesh(
      swGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    );
    sidewalk.name = 'sidewalks';
    g.add(sidewalk);

    // ── Отбойники ──
    const railPos: number[] = [];
    const railIdx: number[] = [];
    const railH0 = 0.45;
    const railH1 = 0.78;
    const railOff = this.halfWidth + 1.1;
    const postGeoms: THREE.BufferGeometry[] = [];
    const post = new THREE.BoxGeometry(0.14, 0.9, 0.14);
    const m4 = new THREE.Matrix4();

    for (const side of [-1, 1]) {
      let first = true;
      let lastPostS = -100;
      for (let i = 0; i <= n; i++) {
        const smp = this.samples[i % n];
        const rails = smp.sector === 'touge' || smp.sector === 'bridge';
        if (!rails) {
          first = true;
          continue;
        }
        const x = smp.x + smp.nx * railOff * side;
        const z = smp.z + smp.nz * railOff * side;
        va.set(x, smp.y + railH0, z);
        vb.set(x, smp.y + railH1, z);
        pushQuadStrip(railPos, railIdx, null, null, va, vb, first);
        first = false;
        if (smp.s - lastPostS >= 4) {
          lastPostS = smp.s;
          m4.makeTranslation(x, smp.y + 0.45, z);
          const pg = post.clone().applyMatrix4(m4);
          postGeoms.push(pg);
        }
      }
    }
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
    railGeo.setIndex(railIdx);
    railGeo.computeVertexNormals();
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xb8bcc4,
      metalness: 0.75,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.name = 'guardrail';
    g.add(rail);
    if (postGeoms.length) {
      const posts = new THREE.Mesh(mergeGeometries(postGeoms), railMat);
      posts.name = 'guardrail-posts';
      g.add(posts);
    }
    return g;
  }

  /** Бетонная плита моста, боковины и опоры. */
  private buildBridgeStructure(): THREE.Group {
    const g = new THREE.Group();
    const n = this.samples.length;
    const pos: number[] = [];
    const idx: number[] = [];
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const w = this.halfWidth + 2.2;
    const deckDepth = 2.2;

    const push = (a: THREE.Vector3, b: THREE.Vector3, first: boolean) => {
      const base = pos.length / 3;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      if (!first) idx.push(base - 2, base, base - 1, base - 1, base, base + 1);
    };

    // Боковины и днище
    for (const side of [-1, 1]) {
      let first = true;
      for (let i = 0; i <= n; i++) {
        const smp = this.samples[i % n];
        if (!smp.bridge) {
          first = true;
          continue;
        }
        const x = smp.x + smp.nx * w * side;
        const z = smp.z + smp.nz * w * side;
        va.set(x, smp.y + 0.3, z);
        vb.set(x, smp.y - deckDepth, z);
        push(va, vb, first);
        first = false;
      }
    }
    // Верхняя полка (от края дороги до внешнего края)
    for (const side of [-1, 1]) {
      let first = true;
      for (let i = 0; i <= n; i++) {
        const smp = this.samples[i % n];
        if (!smp.bridge) {
          first = true;
          continue;
        }
        const inner = this.halfWidth + 0.9;
        va.set(smp.x + smp.nx * inner * side, smp.y + 0.3, smp.z + smp.nz * inner * side);
        vb.set(smp.x + smp.nx * w * side, smp.y + 0.3, smp.z + smp.nz * w * side);
        push(va, vb, first);
        first = false;
      }
    }
    // Днище
    {
      let first = true;
      for (let i = 0; i <= n; i++) {
        const smp = this.samples[i % n];
        if (!smp.bridge) {
          first = true;
          continue;
        }
        va.set(smp.x - smp.nx * w, smp.y - deckDepth, smp.z - smp.nz * w);
        vb.set(smp.x + smp.nx * w, smp.y - deckDepth, smp.z + smp.nz * w);
        push(va, vb, first);
        first = false;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6d6f78, roughness: 0.9, side: THREE.DoubleSide });
    const deck = new THREE.Mesh(geo, mat);
    deck.name = 'bridge-deck';
    g.add(deck);

    // Опоры каждые 36 м
    const pillars: THREE.BufferGeometry[] = [];
    const m4 = new THREE.Matrix4();
    let last = -1000;
    for (const smp of this.samples) {
      if (!smp.bridge) continue;
      if (smp.s - last < 36) continue;
      last = smp.s;
      const bottom = -16;
      const h = smp.y - deckDepth - bottom;
      const box = new THREE.BoxGeometry(3.2, h, 2.2);
      const yaw = Math.atan2(smp.tx, smp.tz);
      m4.makeRotationY(yaw);
      m4.setPosition(smp.x, bottom + h / 2, smp.z);
      pillars.push(box.applyMatrix4(m4));
    }
    if (pillars.length) {
      const pm = new THREE.Mesh(mergeGeometries(pillars), mat);
      pm.name = 'bridge-pillars';
      g.add(pm);
    }
    return g;
  }
}

// ─── Вспомогательное ────────────────────────────────────────────────────────

function classifySector(x: number, z: number, bridge: boolean): Sector {
  if (bridge) return 'bridge';
  if (z < -1030) return 'bridge';
  if (x > 700 && z >= -250 && z < 100) return 'overlook';
  if (x > 640 && z < -250) return 'touge';
  if (z > 60 && x > 300) return 'industrial';
  if (z > 60 && x <= 300) return 'docks';
  return 'city';
}

function smoothCyclic(arr: number[], radius: number): number[] {
  const n = arr.length;
  const out = new Array<number>(n);
  const win = radius * 2 + 1;
  let sum = 0;
  for (let k = -radius; k <= radius; k++) sum += arr[((k % n) + n) % n];
  for (let i = 0; i < n; i++) {
    out[i] = sum / win;
    sum -= arr[(((i - radius) % n) + n) % n];
    sum += arr[(((i + radius + 1) % n) + n) % n];
  }
  return out;
}

/** Объединение геометрий без индексов/с индексами (только position). */
export function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const g of geoms) {
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.attributes.position;
    const nrm = src.attributes.normal;
    const uv = src.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      if (nrm) normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
      indices.push(offset + i);
    }
    offset += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (uvs.length === (positions.length / 3) * 2) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(indices);
  if (normals.length !== positions.length) out.computeVertexNormals();
  return out;
}

/** Текстура асфальта с разметкой: бордюр | линия | полоса | пунктир | полоса | линия | бордюр. */
function makeRoadTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;

  // Асфальт
  ctx.fillStyle = '#2b2b30';
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const nse = (Math.random() - 0.5) * 22;
    d[i] = clamp(d[i] + nse, 0, 255);
    d[i + 1] = clamp(d[i + 1] + nse, 0, 255);
    d[i + 2] = clamp(d[i + 2] + nse + 2, 0, 255);
  }
  ctx.putImageData(img, 0, 0);

  // Обочина (края текстуры) чуть светлее
  const shoulder = Math.round((w * 0.9) / (ROAD.width + 1.8) * 0.5);
  ctx.fillStyle = '#3a3a40';
  ctx.fillRect(0, 0, shoulder, h);
  ctx.fillRect(w - shoulder, 0, shoulder, h);

  // Краевые линии (сплошные белые)
  const lineW = Math.round(w * 0.012);
  ctx.fillStyle = '#e8e8e0';
  ctx.fillRect(shoulder + 6, 0, lineW, h);
  ctx.fillRect(w - shoulder - 6 - lineW, 0, lineW, h);

  // Центральный пунктир
  ctx.fillStyle = '#f0e6a0';
  const dashH = h * 0.32;
  ctx.fillRect(w / 2 - lineW / 2, h * 0.1, lineW, dashH);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
