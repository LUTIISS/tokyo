import * as THREE from 'three';
import { WORLD, ROAD } from '@/config';
import { fbm, smoothstep, lerp, clamp } from './noise';
import type { RoadSample } from './Track';

/**
 * Ландшафт: аналитическая базовая высота (шум + маски регионов),
 * затем «прижатие» сетки к дороге, чтобы трасса лежала в рельефе, а не висела над ним.
 *
 * Регионы (x — восток, z — юг):
 *  • север (z < -1100)   — залив, вода. Дорога идёт по мосту.
 *  • восток (x > 560)     — горы, тогэ.
 *  • край карты           — высокие горы-задник.
 *  • остальное            — почти плоский город.
 */
export class Terrain {
  readonly size = WORLD.size;
  readonly step = WORLD.gridStep;
  readonly n: number;
  readonly half: number;
  /** Итоговые высоты вершин сетки, row-major (z, затем x). */
  readonly heights: Float32Array;
  private readonly baseHeights: Float32Array;

  constructor() {
    this.n = Math.floor(this.size / this.step) + 1;
    this.half = this.size / 2;
    this.heights = new Float32Array(this.n * this.n);
    this.baseHeights = new Float32Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) {
      const z = -this.half + j * this.step;
      for (let i = 0; i < this.n; i++) {
        const x = -this.half + i * this.step;
        const h = this.base(x, z);
        this.baseHeights[j * this.n + i] = h;
        this.heights[j * this.n + i] = h;
      }
    }
  }

  /** Насколько точка «в заливе» (0..1). */
  bayMask(x: number, z: number): number {
    // Залив — на севере, но берег слегка изогнут шумом.
    const wobble = fbm(x * 0.0015, 0.3, 2) * 60;
    return smoothstep(-1080 + wobble, -1160 + wobble, z);
  }

  hillMask(x: number, z: number): number {
    const wobble = fbm(0.7, z * 0.0012, 2) * 70;
    return smoothstep(560 + wobble, 780 + wobble, x);
  }

  farMask(x: number, z: number): number {
    const r = Math.max(Math.abs(x), Math.abs(z));
    return smoothstep(1150, 1500, r);
  }

  /** Базовая (доисторическая) высота без дороги. */
  base(x: number, z: number): number {
    const big = fbm(x * 0.0009 + 3.1, z * 0.0009 - 1.7, 4);
    const mid = fbm(x * 0.0032 - 5.2, z * 0.0032 + 2.4, 3);
    const detail = fbm(x * 0.012, z * 0.012, 2);

    let h = 1.5 + detail * 1.2 + mid * 1.0;

    const hills = this.hillMask(x, z);
    h += hills * (30 + big * 26 + mid * 12 + detail * 3);

    const far = this.farMask(x, z);
    h += far * (70 + big * 50 + mid * 18);

    const bay = this.bayMask(x, z);
    h = lerp(h, -14 + mid * 2, bay);
    return h;
  }

  isWater(x: number, z: number): boolean {
    return this.base(x, z) < WORLD.waterLevel - 0.5;
  }

  /**
   * Прижимаем сетку к дороге. Для каждого сэмпла дороги «штампуем» его высоту
   * в радиусе flattenRadius с плавным спадом. Мостовые сэмплы пропускаем.
   */
  flattenAlong(samples: RoadSample[]): void {
    const n = this.n;
    const wMax = new Float32Array(n * n);
    const wSum = new Float32Array(n * n);
    const hSum = new Float32Array(n * n);

    const R = ROAD.flattenRadius;
    const inner = ROAD.width / 2 + 5;
    const cells = Math.ceil(R / this.step);

    for (const s of samples) {
      if (s.bridge) continue;
      const target = s.y - 0.12;
      const ci = Math.round((s.x + this.half) / this.step);
      const cj = Math.round((s.z + this.half) / this.step);
      for (let j = cj - cells; j <= cj + cells; j++) {
        if (j < 0 || j >= n) continue;
        const vz = -this.half + j * this.step;
        for (let i = ci - cells; i <= ci + cells; i++) {
          if (i < 0 || i >= n) continue;
          const vx = -this.half + i * this.step;
          const d = Math.hypot(vx - s.x, vz - s.z);
          if (d > R) continue;
          const w = d < inner ? 1 : 1 - smoothstep(inner, R, d);
          const idx = j * n + i;
          if (w > wMax[idx]) wMax[idx] = w;
          wSum[idx] += w;
          hSum[idx] += w * target;
        }
      }
    }

    for (let idx = 0; idx < n * n; idx++) {
      const w = wMax[idx];
      if (w <= 0) continue;
      const target = hSum[idx] / wSum[idx];
      this.heights[idx] = lerp(this.baseHeights[idx], target, w);
    }
  }

  /** Выровнять круглую площадку (для гаража, базы, смотровой). Вызывать до buildMesh. */
  flattenDisc(x: number, z: number, r: number, y: number, falloff = 16): void {
    const n = this.n;
    const R = r + falloff;
    const ci = Math.round((x + this.half) / this.step);
    const cj = Math.round((z + this.half) / this.step);
    const cells = Math.ceil(R / this.step);
    for (let j = cj - cells; j <= cj + cells; j++) {
      if (j < 0 || j >= n) continue;
      const vz = -this.half + j * this.step;
      for (let i = ci - cells; i <= ci + cells; i++) {
        if (i < 0 || i >= n) continue;
        const vx = -this.half + i * this.step;
        const d = Math.hypot(vx - x, vz - z);
        if (d > R) continue;
        const w = d < r ? 1 : 1 - smoothstep(r, R, d);
        const idx = j * n + i;
        this.heights[idx] = lerp(this.heights[idx], y, w);
      }
    }
  }

  /** Билинейная высота по сетке. */
  heightAt(x: number, z: number): number {
    const fx = clamp((x + this.half) / this.step, 0, this.n - 1.001);
    const fz = clamp((z + this.half) / this.step, 0, this.n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const n = this.n;
    const h00 = this.heights[j * n + i];
    const h10 = this.heights[j * n + i + 1];
    const h01 = this.heights[(j + 1) * n + i];
    const h11 = this.heights[(j + 1) * n + i + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /** Нормаль поверхности (приближённо, по конечным разностям). */
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = 1.5;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  buildMesh(): THREE.Mesh {
    const n = this.n;
    const geo = new THREE.PlaneGeometry(this.size, this.size, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);

    const grass = new THREE.Color(0x22361f);
    const grassDry = new THREE.Color(0x3a4426);
    const rock = new THREE.Color(0x46433f);
    const sand = new THREE.Color(0x504c42);
    const snow = new THREE.Color(0x8d939c);
    const concrete = new THREE.Color(0x2a2b31);
    const concrete2 = new THREE.Color(0x35363d);
    const tmp = new THREE.Color();

    // PlaneGeometry после rotateX: x идёт по столбцам, z — по строкам, но z инвертирован.
    // Поэтому высоту берём по реальным координатам вершины.
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      const h = this.heightAt(x, z);
      pos.setY(v, h);
      const slope = 1 - this.normalAt(x, z).y; // 0 — плоско
      const wet = smoothstep(WORLD.waterLevel + 3, WORLD.waterLevel - 2, h);
      const n = clamp(fbm(x * 0.01, z * 0.01, 2) * 0.5 + 0.5, 0, 1);
      tmp.copy(grass).lerp(grassDry, n);
      // Город и промзона стоят на бетоне/асфальте, а не на газоне
      const urban = (1 - this.hillMask(x, z)) * (1 - this.farMask(x, z)) * (1 - this.bayMask(x, z));
      tmp.lerp(n < 0.5 ? concrete : concrete2, urban * 0.92);
      tmp.lerp(rock, smoothstep(0.12, 0.35, slope));
      tmp.lerp(snow, smoothstep(95, 150, h));
      tmp.lerp(sand, wet);
      colors[v * 3] = tmp.r;
      colors[v * 3 + 1] = tmp.g;
      colors[v * 3 + 2] = tmp.b;
    }
    pos.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    mesh.receiveShadow = false;
    return mesh;
  }

  buildWater(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(this.size * 1.5, this.size * 0.8, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x06111f,
      roughness: 0.18,
      metalness: 0.85,
      transparent: true,
      opacity: 0.94,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, WORLD.waterLevel, -this.half - 200);
    mesh.name = 'water';
    return mesh;
  }
}
