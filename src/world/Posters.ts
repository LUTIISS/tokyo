import * as THREE from 'three';
import type { Track } from './Track';
import type { Terrain } from './Terrain';
import type { Colliders } from './Colliders';
import { POSTERS, makePosterTexture } from './posterArt';
import { assetUrl } from '@/core/paths';
import { lerp } from './noise';

/**
 * Вертикальные плакаты (1:2) вдоль дороги: на щитах у тротуара и на стенах.
 * По умолчанию рисуются процедурно; если в public/media/posters.json есть картинки —
 * они подменяют рисованные один в один.
 */
export interface PosterItem {
  src: string;
  label?: string;
}

interface Board {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  index: number;
}

const POSTER_W = 2.6;
const POSTER_H = POSTER_W * 2;

export class Posters {
  readonly group = new THREE.Group();
  private boards: Board[] = [];
  private frameMats: THREE.MeshStandardMaterial[] = [];
  private lights: THREE.SpotLight[] = [];

  constructor(
    private track: Track,
    private terrain: Terrain,
    private colliders: Colliders,
  ) {
    this.group.name = 'posters';
  }

  build(): void {
    const textures = POSTERS.map((p, i) => makePosterTexture(p, i + 1));
    const hw = this.track.halfWidth;
    let last = -1000;
    let side = 1;
    let n = 0;

    for (const smp of this.track.samples) {
      // Плакаты висят там, где есть тротуар и люди: город, промзона, порт.
      const urban = smp.sector === 'city' || smp.sector === 'industrial' || smp.sector === 'docks';
      if (!urban) continue;
      if (smp.s - last < 62) continue;
      last = smp.s;
      side = -side;

      const off = hw + 0.9 + 2.2;
      const x = smp.x + smp.nx * off * side;
      const z = smp.z + smp.nz * off * side;
      if (this.colliders.test(x, z, 1.4)) continue;
      const ground = this.terrain.heightAt(x, z) + 0.16;
      // Лицом к дороге
      const facing = Math.atan2(-smp.nx * side, -smp.nz * side);
      this.addBoard(x, ground, z, facing, textures[n % textures.length], n);
      n++;
    }

    // Пара плакатов у стартовой парковки — чтобы их было видно сразу.
    const start = this.track.at(30);
    for (const [along, s] of [
      [14, 1],
      [26, -1],
    ] as Array<[number, number]>) {
      const smp = this.track.at(30 + along);
      const off = hw + 0.9 + 2.2;
      const x = smp.x + smp.nx * off * s;
      const z = smp.z + smp.nz * off * s;
      if (this.colliders.test(x, z, 1.4)) continue;
      const facing = Math.atan2(-smp.nx * s, -smp.nz * s);
      this.addBoard(x, this.terrain.heightAt(x, z) + 0.16, z, facing, textures[n % textures.length], n);
      n++;
    }
    void start;
  }

  private addBoard(x: number, groundY: number, z: number, yaw: number, tex: THREE.CanvasTexture, index: number): void {
    const holder = new THREE.Group();
    const baseY = groundY;
    holder.position.set(x, baseY, z);
    holder.rotation.y = yaw;

    // Опоры
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2b2d36, metalness: 0.6, roughness: 0.5 });
    const bottom = 1.0;
    for (const px of [-POSTER_W / 2 + 0.16, POSTER_W / 2 - 0.16]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, bottom + 0.3, 8), postMat);
      post.position.set(px, (bottom + 0.3) / 2, -0.12);
      holder.add(post);
    }

    // Задник и неоновая рамка
    const back = new THREE.Mesh(new THREE.BoxGeometry(POSTER_W + 0.22, POSTER_H + 0.22, 0.14), postMat);
    back.position.set(0, bottom + POSTER_H / 2, -0.09);
    holder.add(back);

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: index % 2 ? 0x22e5ff : 0xff2d95,
      emissiveIntensity: 2,
    });
    this.frameMats.push(frameMat);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(POSTER_W + 0.34, POSTER_H + 0.34, 0.07), frameMat);
    frame.position.set(0, bottom + POSTER_H / 2, -0.15);
    holder.add(frame);

    // Само полотно — светится, чтобы читалось ночью
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: 0.75,
      roughness: 0.75,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(POSTER_W, POSTER_H), mat);
    mesh.position.set(0, bottom + POSTER_H / 2, 0.01);
    holder.add(mesh);

    // Козырёк с лампой над плакатом
    const hood = new THREE.Mesh(new THREE.BoxGeometry(POSTER_W + 0.3, 0.08, 0.5), postMat);
    hood.position.set(0, bottom + POSTER_H + 0.28, 0.2);
    holder.add(hood);
    const bulb = new THREE.Mesh(
      new THREE.BoxGeometry(POSTER_W - 0.4, 0.06, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d0, emissiveIntensity: 2.5 }),
    );
    bulb.position.set(0, bottom + POSTER_H + 0.22, 0.32);
    holder.add(bulb);

    this.group.add(holder);
    this.boards.push({ mesh, index });
  }

  /** Подменяет процедурные плакаты настоящими картинками из манифеста. */
  async loadManifest(url = '/media/posters.json'): Promise<void> {
    let items: PosterItem[] = [];
    try {
      const res = await fetch(assetUrl(url), { cache: 'no-cache' });
      if (!res.ok) return;
      const json = (await res.json()) as { items?: PosterItem[] };
      items = (json.items ?? []).filter((i) => i && i.src);
    } catch {
      return;
    }
    if (!items.length) return;
    const loader = new THREE.TextureLoader();
    this.boards.forEach((b, i) => {
      const item = items[i % items.length];
      loader.load(assetUrl(item.src), (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        b.mesh.material.map = tex;
        b.mesh.material.emissiveMap = tex;
        b.mesh.material.needsUpdate = true;
      });
    });
  }

  setDayness(t: number): void {
    for (const m of this.frameMats) m.emissiveIntensity = lerp(0.4, 2, 1 - t);
    for (const b of this.boards) b.mesh.material.emissiveIntensity = lerp(0.15, 0.75, 1 - t);
    for (const l of this.lights) l.intensity = lerp(0, 30, 1 - t);
  }

  get count(): number {
    return this.boards.length;
  }
}
