import * as THREE from 'three';
import type { Track } from './Track';
import type { Terrain } from './Terrain';
import type { Colliders } from './Colliders';
import { mulberry32, lerp } from './noise';
import { makeWindowTextures, makeNeonSignTexture, type WindowTint } from './textures';
import { mergeGeometries } from './Track';

export interface Exclusion {
  x: number;
  z: number;
  r: number;
}

/** Место на фасаде, куда можно повесить большой экран. */
export interface FacadeSlot {
  x: number;
  y: number;
  z: number;
  /** Направление нормали экрана (в сторону дороги), рад. */
  yaw: number;
  w: number;
  h: number;
}

const NEON_WORDS = [
  'ラーメン',
  '居酒屋',
  'カラオケ',
  'ドリフト',
  '東京',
  '夜',
  '寿司',
  'パチンコ',
  'ホテル',
  '焼肉',
  '喫茶',
  '薬',
  '走り屋',
  'ネオン',
  // Ради именинника весь квартал перевесил вывески.
  '誕生日',
  '祝',
  'АНДРЮХА',
  'С ДР!',
  'ИМЕНИННИК',
];

/** Кириллицу вертикально не читают — такие вывески вешаем горизонтально. */
const CYRILLIC = /[А-Яа-яЁё]/;
const NEON_COLORS = ['#ff2d95', '#22e5ff', '#ffe45c', '#9b5cff', '#ff7a1a', '#6dff3c', '#ff4b4b'];

interface BuildingSpec {
  cx: number;
  cz: number;
  baseY: number;
  w: number;
  d: number;
  h: number;
  yaw: number;
  variant: number;
  tint: THREE.Color;
}

/**
 * Процедурный город вдоль трассы + фоновый скайлайн и башня.
 */
export class City {
  readonly group = new THREE.Group();
  readonly facadeSlots: FacadeSlot[] = [];
  private emissiveMats: THREE.MeshStandardMaterial[] = [];
  private signMats: THREE.MeshStandardMaterial[] = [];
  private towerMat?: THREE.MeshStandardMaterial;

  constructor(
    private track: Track,
    private terrain: Terrain,
    private colliders: Colliders,
    private exclusions: Exclusion[],
  ) {
    this.group.name = 'city';
  }

  build(): void {
    const rnd = mulberry32(4242);
    const specs: BuildingSpec[] = [];
    const specsBackdrop: BuildingSpec[] = [];

    this.placeAlongRoad(rnd, specs);
    this.placeBackdrop(rnd, specsBackdrop);

    const variants: Array<{ tint: WindowTint; seed: number }> = [
      { tint: 'warm', seed: 11 },
      { tint: 'cool', seed: 23 },
      { tint: 'mixed', seed: 37 },
    ];
    for (let v = 0; v < variants.length; v++) {
      const tex = makeWindowTextures(variants[v].seed, variants[v].tint);
      const mat = new THREE.MeshStandardMaterial({
        map: tex.map,
        emissiveMap: tex.emissive,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.0,
        roughness: 0.85,
        metalness: 0.1,
        vertexColors: true,
      });
      this.emissiveMats.push(mat);
      const list = specs.filter((s) => s.variant === v);
      const listBd = specsBackdrop.filter((s) => s.variant === v);
      if (list.length) {
        const mesh = new THREE.Mesh(buildMergedBuildings(list), mat);
        mesh.name = `buildings-${v}`;
        this.group.add(mesh);
      }
      if (listBd.length) {
        const mesh = new THREE.Mesh(buildMergedBuildings(listBd), mat);
        mesh.name = `skyline-${v}`;
        this.group.add(mesh);
      }
    }

    this.buildNeonSigns(rnd, specs);
    this.buildTower();
  }

  /** Здания в 1–3 ряда по обе стороны дороги в городских секторах. */
  private placeAlongRoad(rnd: () => number, out: BuildingSpec[]): void {
    const hw = this.track.halfWidth;
    const sidewalk = 2.6;
    const rows = 3;
    const nextS: Record<number, number[]> = { [-1]: [0, 0, 0], [1]: [0, 0, 0] };
    const samples = this.track.samples;

    for (let i = 0; i < samples.length; i++) {
      const smp = samples[i];
      const urban = smp.sector === 'city' || smp.sector === 'industrial' || smp.sector === 'docks';
      if (!urban) continue;
      for (const side of [-1, 1] as const) {
        for (let row = 0; row < rows; row++) {
          if (smp.s < nextS[side][row]) continue;
          const isCity = smp.sector === 'city';
          const isInd = smp.sector === 'industrial';
          // Промзона и доки — только один-два ряда
          if (!isCity && row > 1) continue;

          const w = isCity ? 10 + rnd() * 12 : 14 + rnd() * 16;
          const d = isCity ? 12 + rnd() * 12 : 14 + rnd() * 14;
          const gap = isCity ? 1.5 + rnd() * 4 : 4 + rnd() * 10;
          nextS[side][row] = smp.s + w + gap;

          // Центр здания — по сэмплу на полдлины вперёд
          const mid = this.track.at(smp.s + w / 2);
          const rowDepthBase = hw + 0.9 + sidewalk + 1.2;
          const lateral = rowDepthBase + row * 26 + d / 2 + (row > 0 ? rnd() * 6 : 0);
          const cx = mid.x + mid.nx * lateral * side;
          const cz = mid.z + mid.nz * lateral * side;
          const yaw = Math.atan2(mid.tx, mid.tz);

          if (!this.spotIsFree(cx, cz, w, d, yaw)) continue;

          // Высота
          let h: number;
          if (isCity) {
            const r = rnd();
            h = 12 + r * r * 55;
            if (rnd() < 0.08) h = 70 + rnd() * 60; // башня
          } else if (isInd) {
            h = 6 + rnd() * 9;
          } else {
            h = 5 + rnd() * 6;
          }

          const baseY = this.baseHeight(cx, cz, w, d, yaw);
          const tint = new THREE.Color().setHSL(
            isCity ? 0.62 + rnd() * 0.08 : isInd ? 0.08 + rnd() * 0.05 : 0.55 + rnd() * 0.05,
            isCity ? 0.12 + rnd() * 0.1 : 0.08,
            isCity ? 0.28 + rnd() * 0.18 : 0.3 + rnd() * 0.12,
          );
          const variant = Math.floor(rnd() * 3);
          out.push({ cx, cz, baseY, w, d, h, yaw, variant, tint });
          this.colliders.add({ x: cx, z: cz, hw: w / 2, hd: d / 2, yaw, tag: 'building' });

          // Слоты под экраны — первый ряд в городе, высокие здания
          if (isCity && row === 0 && h > 22 && w > 14 && rnd() < 0.5) {
            // Фасад, обращённый к дороге: нормаль = -side * normal
            const faceX = cx - mid.nx * (d / 2) * side;
            const faceZ = cz - mid.nz * (d / 2) * side;
            const facing = Math.atan2(-mid.nx * side, -mid.nz * side);
            const sw = Math.min(w - 2, 14);
            const sh = sw * 0.5625;
            this.facadeSlots.push({
              x: faceX,
              y: baseY + 7 + sh / 2 + rnd() * Math.max(0, h - sh - 12),
              z: faceZ,
              yaw: facing,
              w: sw,
              h: sh,
            });
          }
        }
      }
    }
  }

  private spotIsFree(cx: number, cz: number, w: number, d: number, yaw: number): boolean {
    const halfDiag = Math.hypot(w, d) / 2;
    // Не залезаем на другие участки дороги
    const near = this.track.nearest(cx, cz);
    if (near.dist < this.track.halfWidth + 3.5 + halfDiag * 0.75) return false;
    for (const ex of this.exclusions) {
      if (Math.hypot(cx - ex.x, cz - ex.z) < ex.r + halfDiag * 0.7) return false;
    }
    if (this.terrain.isWater(cx, cz)) return false;
    // Слишком крутой склон
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const corners = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ];
    let minH = Infinity;
    let maxH = -Infinity;
    for (const [lx, lz] of corners) {
      const x = cx + lx * c + lz * s;
      const z = cz - lx * s + lz * c;
      const h = this.terrain.heightAt(x, z);
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
    }
    if (maxH - minH > 6) return false;
    // Не пересекаем уже поставленные
    if (this.colliders.test(cx, cz, halfDiag * 0.9)) return false;
    return true;
  }

  private baseHeight(cx: number, cz: number, w: number, d: number, yaw: number): number {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let minH = Infinity;
    for (const [lx, lz] of [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
      [0, 0],
    ]) {
      const x = cx + lx * c + lz * s;
      const z = cz - lx * s + lz * c;
      minH = Math.min(minH, this.terrain.heightAt(x, z));
    }
    return minH - 0.6;
  }

  /** Фоновые небоскрёбы к западу и югу от проспекта. */
  private placeBackdrop(rnd: () => number, out: BuildingSpec[]): void {
    const tryPlace = (x: number, z: number, minH: number, maxH: number) => {
      const w = 22 + rnd() * 30;
      const d = 22 + rnd() * 30;
      const yaw = rnd() < 0.5 ? 0 : (rnd() - 0.5) * 0.4;
      if (this.terrain.isWater(x, z)) return;
      const near = this.track.nearest(x, z);
      if (near.dist < 60) return;
      for (const ex of this.exclusions) if (Math.hypot(x - ex.x, z - ex.z) < ex.r + 40) return;
      if (this.colliders.test(x, z, Math.hypot(w, d) / 2)) return;
      const h = minH + rnd() * (maxH - minH);
      const baseY = this.baseHeight(x, z, w, d, yaw);
      const tint = new THREE.Color().setHSL(0.63 + rnd() * 0.06, 0.15, 0.22 + rnd() * 0.15);
      out.push({ cx: x, cz: z, baseY, w, d, h, yaw, variant: Math.floor(rnd() * 3), tint });
      this.colliders.add({ x, z, hw: w / 2, hd: d / 2, yaw, tag: 'skyline' });
    };
    // Западный массив
    for (let i = 0; i < 90; i++) {
      tryPlace(-260 - rnd() * 520, -950 + rnd() * 1150, 40, 170);
    }
    // Южный массив
    for (let i = 0; i < 60; i++) {
      tryPlace(-350 + rnd() * 750, 420 + rnd() * 420, 30, 120);
    }
    // Ближе к проспекту, средней высоты (заполняем пустоты между проспектом и массивом)
    for (let i = 0; i < 70; i++) {
      tryPlace(-120 - rnd() * 150, -950 + rnd() * 1000, 18, 60);
      tryPlace(60 + rnd() * 200, -950 + rnd() * 900, 18, 60);
    }
  }

  /** Неоновые вывески на фасадах первого ряда. */
  private buildNeonSigns(rnd: () => number, specs: BuildingSpec[]): void {
    const byTex = new Map<string, { tex: THREE.CanvasTexture; geoms: THREE.BufferGeometry[] }>();
    const getEntry = (word: string, color: string, vertical: boolean) => {
      const key = `${word}|${color}|${vertical ? 'v' : 'h'}`;
      let e = byTex.get(key);
      if (!e) {
        e = { tex: makeNeonSignTexture(word, color, vertical), geoms: [] };
        byTex.set(key, e);
      }
      return e;
    };

    const hw = this.track.halfWidth;
    for (const b of specs) {
      // Только здания, стоящие близко к дороге (первый ряд)
      const near = this.track.nearest(b.cx, b.cz);
      if (near.dist > hw + 30) continue;
      if (rnd() > 0.6) continue;
      const side = Math.sign(near.lateral) || 1;
      const smp = near.sample;
      // Точка на фасаде, обращённом к дороге
      const fx = b.cx - smp.nx * (b.d / 2 + 0.25) * side;
      const fz = b.cz - smp.nz * (b.d / 2 + 0.25) * side;
      const facing = Math.atan2(-smp.nx * side, -smp.nz * side);
      const word = NEON_WORDS[Math.floor(rnd() * NEON_WORDS.length)];
      const color = NEON_COLORS[Math.floor(rnd() * NEON_COLORS.length)];
      const vertical = !CYRILLIC.test(word) && rnd() < 0.65;
      const entry = getEntry(word, color, vertical);
      const chars = Array.from(word).length;
      const sw = vertical ? 1.4 : Math.min(b.w - 1, chars * 1.2 + 0.6);
      const sh = vertical ? Math.min(b.h - 4, chars * 1.1 + 0.6) : 1.6;
      const y = vertical ? b.baseY + 3 + sh / 2 + rnd() * Math.max(0, b.h - sh - 5) : b.baseY + 3.6 + rnd() * 2;
      // Сдвиг вдоль фасада
      const along = (rnd() - 0.5) * (b.w - sw - 1);
      const px = fx + smp.tx * along;
      const pz = fz + smp.tz * along;
      const g = new THREE.PlaneGeometry(sw, sh);
      const m = new THREE.Matrix4().makeRotationY(facing);
      m.setPosition(px, y, pz);
      g.applyMatrix4(m);
      entry.geoms.push(g);
    }

    for (const { tex, geoms } of byTex.values()) {
      if (!geoms.length) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissiveMap: tex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.7,
        side: THREE.DoubleSide,
        roughness: 0.6,
      });
      this.signMats.push(mat);
      const mesh = new THREE.Mesh(mergeGeometries(geoms), mat);
      mesh.name = 'neon-signs';
      this.group.add(mesh);
    }
  }

  /** Стилизованная телебашня (решётчатый конус) к западу от проспекта. */
  private buildTower(): void {
    const x = -470;
    const z = -520;
    const base = this.terrain.heightAt(x, z);
    const h = 300;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff5a1f,
      emissive: new THREE.Color(0xff3d0f),
      emissiveIntensity: 0.9,
      wireframe: true,
    });
    this.towerMat = mat;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(48, h, 4, 10, true), mat);
    cone.position.set(x, base + h / 2, z);
    cone.rotation.y = Math.PI / 4;
    this.group.add(cone);
    const solidMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 1.2 });
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(22, 26, 7, 12), solidMat);
    deck.position.set(x, base + h * 0.42, z);
    this.group.add(deck);
    const deck2 = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 5, 10), solidMat);
    deck2.position.set(x, base + h * 0.78, z);
    this.group.add(deck2);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.6, 60, 6), solidMat);
    spire.position.set(x, base + h + 28, z);
    this.group.add(spire);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(3, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xff2d2d, emissive: 0xff1010, emissiveIntensity: 3 }),
    );
    beacon.position.set(x, base + h + 60, z);
    beacon.name = 'tower-beacon';
    this.group.add(beacon);
    this.colliders.add({ x, z, hw: 30, hd: 30, yaw: 0, tag: 'tower' });
  }

  setDayness(t: number): void {
    const night = 1 - t;
    for (const m of this.emissiveMats) m.emissiveIntensity = lerp(0.05, 1.0, night);
    for (const m of this.signMats) m.emissiveIntensity = lerp(0.35, 1.7, night);
    if (this.towerMat) this.towerMat.emissiveIntensity = lerp(0.1, 0.9, night);
  }

  update(time: number): void {
    const beacon = this.group.getObjectByName('tower-beacon') as THREE.Mesh | null;
    if (beacon) {
      (beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 + 2.5 * (0.5 + 0.5 * Math.sin(time * 2.2));
    }
  }
}

// ─── Геометрия зданий ────────────────────────────────────────────────────────

/**
 * Собирает все здания в одну BufferGeometry: 5 граней (без низа), UV в масштабе 8 м/тайл,
 * крыша — на uv≈(0,0) (гарантированно стена без окон), цвет фасада — в vertex color.
 */
export function buildMergedBuildings(specs: BuildingSpec[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const tile = 5.2; // метров на плитку 4×4 окон → окна ~1.3 м
  const rot = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();

  for (const b of specs) {
    rot.makeRotationY(b.yaw);
    const hw = b.w / 2;
    const hd = b.d / 2;
    const h = b.h;
    const roofTint = b.tint.clone().multiplyScalar(0.55);
    // Крыша с небольшим случайным наклоном цвета
    const faces: Array<{
      pts: number[][];
      n: number[];
      uv: number[][];
      col: THREE.Color;
    }> = [
      {
        pts: [
          [-hw, 0, hd],
          [hw, 0, hd],
          [hw, h, hd],
          [-hw, h, hd],
        ],
        n: [0, 0, 1],
        uv: [
          [0, 0],
          [b.w / tile, 0],
          [b.w / tile, h / tile],
          [0, h / tile],
        ],
        col: b.tint,
      },
      {
        pts: [
          [hw, 0, -hd],
          [-hw, 0, -hd],
          [-hw, h, -hd],
          [hw, h, -hd],
        ],
        n: [0, 0, -1],
        uv: [
          [0, 0],
          [b.w / tile, 0],
          [b.w / tile, h / tile],
          [0, h / tile],
        ],
        col: b.tint,
      },
      {
        pts: [
          [hw, 0, hd],
          [hw, 0, -hd],
          [hw, h, -hd],
          [hw, h, hd],
        ],
        n: [1, 0, 0],
        uv: [
          [0, 0],
          [b.d / tile, 0],
          [b.d / tile, h / tile],
          [0, h / tile],
        ],
        col: b.tint,
      },
      {
        pts: [
          [-hw, 0, -hd],
          [-hw, 0, hd],
          [-hw, h, hd],
          [-hw, h, -hd],
        ],
        n: [-1, 0, 0],
        uv: [
          [0, 0],
          [b.d / tile, 0],
          [b.d / tile, h / tile],
          [0, h / tile],
        ],
        col: b.tint,
      },
      {
        pts: [
          [-hw, h, hd],
          [hw, h, hd],
          [hw, h, -hd],
          [-hw, h, -hd],
        ],
        n: [0, 1, 0],
        uv: [
          [0.005, 0.005],
          [0.02, 0.005],
          [0.02, 0.02],
          [0.005, 0.02],
        ],
        col: roofTint,
      },
    ];
    for (const f of faces) {
      const base = positions.length / 3;
      nv.set(f.n[0], f.n[1], f.n[2]).applyMatrix4(rot);
      for (let i = 0; i < 4; i++) {
        v.set(f.pts[i][0], f.pts[i][1], f.pts[i][2]).applyMatrix4(rot);
        positions.push(v.x + b.cx, v.y + b.baseY, v.z + b.cz);
        normals.push(nv.x, nv.y, nv.z);
        uvs.push(f.uv[i][0], f.uv[i][1]);
        colors.push(f.col.r, f.col.g, f.col.b);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

export type { BuildingSpec };
