import * as THREE from 'three';
import type { Track } from './Track';
import type { Terrain } from './Terrain';
import type { FacadeSlot } from './City';
import { makeBillboardGreeting } from './textures';
import { mulberry32, lerp } from './noise';
import { assetUrl } from '@/core/paths';

/**
 * Манифест public/media/billboards.json:
 * {
 *   "items": [
 *     { "type": "image", "src": "/media/billboards/meme1.jpg", "label": "Мем про кота" },
 *     { "type": "video", "src": "/media/billboards/clip1.mp4" }
 *   ]
 * }
 * Если файла нет или список пуст — на стендах рисуется поздравление.
 */
export interface BillboardItem {
  type: 'image' | 'video';
  src: string;
  label?: string;
}

interface Screen {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  frameMat: THREE.MeshStandardMaterial;
  index: number;
  video?: HTMLVideoElement;
}

export class Billboards {
  readonly group = new THREE.Group();
  private screens: Screen[] = [];
  private items: BillboardItem[] = [];
  private started = false;

  constructor(
    private track: Track,
    private terrain: Terrain,
  ) {
    this.group.name = 'billboards';
  }

  build(facadeSlots: FacadeSlot[]): void {
    const rnd = mulberry32(99);
    let n = 0;
    // 1) Экраны на фасадах в городе (как в Сибуе) — берём каждый, но не больше 10.
    const slots = facadeSlots.slice().sort((a, b) => a.z - b.z);
    let picked = 0;
    for (let i = 0; i < slots.length && picked < 10; i++) {
      const s = slots[i];
      if (rnd() < 0.35) continue;
      this.addScreen(s.x, s.y, s.z, s.yaw, s.w, s.h, n++, false);
      picked++;
    }
    // 2) Стенды на столбах вдоль моста и промзоны
    const hw = this.track.halfWidth;
    let last = -1000;
    let side = 1;
    for (const smp of this.track.samples) {
      const ok = smp.sector === 'bridge' || smp.sector === 'industrial';
      if (!ok) continue;
      if (smp.s - last < 140) continue;
      last = smp.s;
      side = -side;
      const off = smp.bridge ? hw + 2.4 : hw + 9;
      const x = smp.x + smp.nx * off * side;
      const z = smp.z + smp.nz * off * side;
      const ground = smp.bridge ? smp.y + 0.3 : this.terrain.heightAt(x, z);
      const w = 12;
      const h = w * 0.5625;
      const y = ground + 8 + h / 2;
      // Экран повёрнут чуть навстречу движению
      const facing = Math.atan2(-smp.nx * side, -smp.nz * side) + side * 0.35;
      this.addScreen(x, y, z, facing, w, h, n++, true, ground);
    }
  }

  private addScreen(
    x: number,
    y: number,
    z: number,
    yaw: number,
    w: number,
    h: number,
    index: number,
    withPole: boolean,
    ground = 0,
  ): void {
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.rotation.y = yaw;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x15161c, metalness: 0.5, roughness: 0.6 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, h + 0.6, 0.5), frameMat);
    frame.position.z = -0.3;
    holder.add(frame);

    const neonMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: index % 2 ? 0x22e5ff : 0xff2d95,
      emissiveIntensity: 2.2,
    });
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.9, h + 0.9, 0.12), neonMat);
    edge.position.z = -0.48;
    holder.add(edge);

    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: makeBillboardGreeting(index),
      emissiveIntensity: 1.0,
      roughness: 0.4,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat);
    screen.position.z = 0.02;
    holder.add(screen);

    if (withPole) {
      const poleH = y - h / 2 - ground;
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.45, poleH, 10),
        new THREE.MeshStandardMaterial({ color: 0x2b2d36, metalness: 0.6, roughness: 0.5 }),
      );
      pole.position.set(0, -h / 2 - poleH / 2, -0.3);
      holder.add(pole);
    }
    this.group.add(holder);
    this.screens.push({ mesh: screen, frameMat: neonMat, index });
  }

  /** Загружает манифест и раздаёт медиа по экранам. */
  async loadManifest(url = '/media/billboards.json'): Promise<void> {
    try {
      const res = await fetch(assetUrl(url), { cache: 'no-cache' });
      if (!res.ok) return;
      const json = (await res.json()) as { items?: BillboardItem[] };
      this.items = (json.items ?? []).filter((i) => i && i.src);
    } catch {
      this.items = [];
    }
    if (!this.items.length) return;
    const loader = new THREE.TextureLoader();
    this.screens.forEach((scr, i) => {
      const item = this.items[i % this.items.length];
      if (item.type === 'video') {
        const v = document.createElement('video');
        v.src = assetUrl(item.src);
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.crossOrigin = 'anonymous';
        v.preload = 'auto';
        const tex = new THREE.VideoTexture(v);
        tex.colorSpace = THREE.SRGBColorSpace;
        scr.mesh.material.emissiveMap = tex;
        scr.mesh.material.needsUpdate = true;
        scr.video = v;
        if (this.started) v.play().catch(() => {});
      } else {
        loader.load(assetUrl(item.src), (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          scr.mesh.material.emissiveMap = tex;
          scr.mesh.material.needsUpdate = true;
        });
      }
    });
  }

  /** Вызвать после первого клика — браузеры не дают играть видео без жеста. */
  start(): void {
    this.started = true;
    for (const s of this.screens) s.video?.play().catch(() => {});
  }

  setDayness(t: number): void {
    for (const s of this.screens) {
      s.frameMat.emissiveIntensity = lerp(0.5, 2.2, 1 - t);
      s.mesh.material.emissiveIntensity = lerp(0.7, 1.0, 1 - t);
    }
  }

  get count(): number {
    return this.screens.length;
  }
}
