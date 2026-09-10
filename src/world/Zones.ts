import * as THREE from 'three';
import { POI_INDEX } from '@/config';
import type { Track, RoadSample } from './Track';
import type { Terrain } from './Terrain';
import type { Colliders, OBB } from './Colliders';
import type { Exclusion } from './City';
import { makeTorii, makeLantern, makeVendingMachine, makeContainer, makeSearchlight } from './Props';
import { makeLabelTexture } from './textures';
import { lerp, mulberry32, damp } from './noise';

export type ZoneId = 'quest' | 'garage' | 'boss';

export interface Placement {
  /** Центр зоны (триггера). */
  x: number;
  z: number;
  y: number;
  /** Сторона от дороги (+1 вправо по ходу). */
  side: number;
  sample: RoadSample;
  /** Направление «внутрь» зоны от дороги (единичный вектор). */
  inX: number;
  inZ: number;
  /** Радиус триггера. */
  r: number;
}

export interface ZonePlan {
  quest: Placement;
  garage: Placement;
  boss: Placement;
  exclusions: Exclusion[];
}

/** Расстояние от точки триггера до центра двора базы (м). Передняя стена двора — на BOSS_YARD_OFFSET − 30. */
const BOSS_YARD_OFFSET = 41;

function place(track: Track, control: number, side: number, lateral: number, r: number): Placement {
  const smp = track.atControl(control);
  const inX = smp.nx * side;
  const inZ = smp.nz * side;
  return {
    x: smp.x + inX * lateral,
    z: smp.z + inZ * lateral,
    y: smp.y,
    side,
    sample: smp,
    inX,
    inZ,
    r,
  };
}

/** Где стоят зоны — считается до города, чтобы здания их не заняли. */
export function planZones(track: Track): ZonePlan {
  const quest = place(track, POI_INDEX.quest, 1, 15, 10);
  const garage = place(track, POI_INDEX.garage, -1, 19, 7.5);
  // Триггер базы — на дороге перед воротами; сам двор начинается за тротуаром.
  const boss = place(track, POI_INDEX.boss, 1, 2.5, 8.5);
  return {
    quest,
    garage,
    boss,
    exclusions: [
      { x: quest.x, z: quest.z, r: 40 },
      { x: garage.x, z: garage.z, r: 36 },
      { x: boss.x + boss.inX * BOSS_YARD_OFFSET, z: boss.z + boss.inZ * BOSS_YARD_OFFSET, r: 72 },
    ],
  };
}

/**
 * Три точки интереса: смотровая площадка (квест), мастерская, база Ваисова.
 */
export class Zones {
  readonly group = new THREE.Group();
  private garageDoor!: THREE.Mesh;
  private garageDoorH = 5;
  private garageOpen = 0;
  private gateL!: THREE.Mesh;
  private gateR!: THREE.Mesh;
  private gateOpen = 0;
  private gateTarget = 0;
  private gateCollider!: OBB;
  private searchlights: THREE.Group[] = [];
  private cageBars!: THREE.Group;
  private girls: THREE.Group[] = [];
  private celebrate = 0;
  private beaconMat!: THREE.MeshBasicMaterial;
  private questBeacon!: THREE.Mesh;
  private bossSignMat!: THREE.MeshStandardMaterial;
  private nightMats: THREE.MeshStandardMaterial[] = [];
  private time = 0;

  constructor(
    private track: Track,
    private terrain: Terrain,
    private colliders: Colliders,
    readonly plan: ZonePlan,
  ) {
    this.group.name = 'zones';
  }

  /** Вызвать до построения меша ландшафта. */
  flattenTerrain(): void {
    const { quest, garage, boss } = this.plan;
    this.terrain.flattenDisc(quest.x, quest.z, 18, quest.y - 0.15);
    this.terrain.flattenDisc(garage.x, garage.z, 22, garage.y - 0.15);
    this.terrain.flattenDisc(
      boss.x + boss.inX * BOSS_YARD_OFFSET,
      boss.z + boss.inZ * BOSS_YARD_OFFSET,
      48,
      boss.y - 0.15,
      22,
    );
  }

  build(): void {
    this.buildOverlook();
    this.buildGarage();
    this.buildBossBase();
  }

  // ── Смотровая площадка ─────────────────────────────────────────────────
  private buildOverlook(): void {
    const p = this.plan.quest;
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    const yaw = Math.atan2(-p.inX, -p.inZ); // «вперёд» группы смотрит к дороге
    g.rotation.y = yaw;

    const plaza = new THREE.Mesh(
      new THREE.CylinderGeometry(13, 13.5, 0.3, 28),
      new THREE.MeshStandardMaterial({ color: 0x35363d, roughness: 0.9 }),
    );
    plaza.position.y = 0.02;
    g.add(plaza);
    // Ограда по внешнему краю (смотровая над обрывом)
    const railMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.7, roughness: 0.35 });
    for (let i = 0; i < 14; i++) {
      const a = Math.PI * 0.55 + (i / 13) * Math.PI * 0.9;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), railMat);
      post.position.set(Math.sin(a) * 12.4, 0.7, Math.cos(a) * 12.4);
      g.add(post);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(12.4, 0.04, 6, 60, Math.PI * 0.9), railMat);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = -Math.PI * 0.55 + Math.PI / 2;
    ring.position.y = 1.2;
    g.add(ring);

    const torii = makeTorii(1.15);
    torii.position.set(0, 0.15, -8.5);
    torii.rotation.y = Math.PI / 2;
    g.add(torii);
    for (const [x, z] of [
      [-4, -2],
      [4, -2],
      [-6, 5],
      [6, 5],
    ]) {
      const l = makeLantern();
      l.position.set(x, 0.15, z);
      g.add(l);
      this.colliders.add({ x: p.x + x, z: p.z + z, hw: 0.3, hd: 0.3, yaw: 0, tag: 'lantern' });
    }
    // Автоматы с напитками — иконка Японии
    const vend = [0x22e5ff, 0xff2d95, 0xffe45c];
    vend.forEach((c, i) => {
      const v = makeVendingMachine(c);
      v.position.set(-9 + i * 1.4, 0.15, 8.5);
      v.rotation.y = Math.PI;
      g.add(v);
    });
    // Скамейка
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x6b4b34 }));
    bench.position.set(7, 0.6, -6);
    g.add(bench);

    // Маяк квеста — светящийся столб, видно издалека
    this.beaconMat = new THREE.MeshBasicMaterial({
      color: 0xff2d95,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.questBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 60, 12, 1, true), this.beaconMat);
    this.questBeacon.position.set(0, 30, 0);
    g.add(this.questBeacon);
    const pad = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.0, 32),
      new THREE.MeshBasicMaterial({ color: 0xff2d95, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.2;
    pad.name = 'quest-pad';
    g.add(pad);

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.3),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: makeLabelTexture(['展望台 · СМОТРОВАЯ'], { color: '#22e5ff', width: 1400 }),
        emissiveIntensity: 1.5,
        side: THREE.DoubleSide,
      }),
    );
    sign.position.set(0, 7.6, -8.5);
    sign.rotation.y = 0;
    g.add(sign);
    this.nightMats.push(sign.material as THREE.MeshStandardMaterial);

    this.group.add(g);
  }

  // ── Мастерская ─────────────────────────────────────────────────────────
  private buildGarage(): void {
    const p = this.plan.garage;
    const g = new THREE.Group();
    g.position.set(p.x, p.y - 0.1, p.z);
    // Локальные оси: +z смотрит к дороге (ворота на +z стене)
    const yaw = Math.atan2(-p.inX, -p.inZ);
    g.rotation.y = yaw;
    const W = 26;
    const D = 20;
    const H = 8;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3d47, roughness: 0.85 });
    const wallThick = 0.5;

    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, D), new THREE.MeshStandardMaterial({ color: 0x2d2f36, roughness: 0.6, metalness: 0.2 }));
    floor.position.y = 0.0;
    g.add(floor);
    // Стены: задняя, левая, правая; передняя — две части вокруг ворот
    const doorW = 9;
    const mk = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z);
      g.add(m);
    };
    mk(W, H, wallThick, 0, H / 2, -D / 2);
    mk(wallThick, H, D, -W / 2, H / 2, 0);
    mk(wallThick, H, D, W / 2, H / 2, 0);
    const sideW = (W - doorW) / 2;
    mk(sideW, H, wallThick, -W / 2 + sideW / 2, H / 2, D / 2);
    mk(sideW, H, wallThick, W / 2 - sideW / 2, H / 2, D / 2);
    mk(doorW, H - this.garageDoorH, wallThick, 0, this.garageDoorH + (H - this.garageDoorH) / 2, D / 2);
    // Крыша
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.4, D + 0.6), wallMat);
    roof.position.y = H + 0.2;
    g.add(roof);

    // Ворота (роллета) — поднимаются
    this.garageDoor = new THREE.Mesh(
      new THREE.BoxGeometry(doorW - 0.2, this.garageDoorH, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x8a8f9a, metalness: 0.6, roughness: 0.4 }),
    );
    this.garageDoor.position.set(0, this.garageDoorH / 2, D / 2);
    g.add(this.garageDoor);

    // Интерьер: лампы, стеллажи, шины, подъёмник
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdff4ff, emissiveIntensity: 2.6 });
    for (const x of [-7, 0, 7]) {
      for (const z of [-5, 3]) {
        const tube = new THREE.Mesh(new THREE.BoxGeometry(4, 0.12, 0.3), tubeMat);
        tube.position.set(x, H - 0.3, z);
        g.add(tube);
      }
    }
    const light = new THREE.PointLight(0xdff4ff, 90, 40, 1.6);
    light.position.set(0, H - 1, 0);
    g.add(light);
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x5a3b1e, roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 0.8), shelfMat);
      shelf.position.set(-W / 2 + 1.2, 1.2, -6 + i * 4);
      g.add(shelf);
    }
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.9 });
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 3; k++) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), tireMat);
        t.position.set(W / 2 - 1.5 - i * 0.8, 0.27 + k * 0.25, -D / 2 + 2);
        g.add(t);
      }
    }
    const toolWall = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 3),
      new THREE.MeshStandardMaterial({ color: 0x1c2027, emissive: 0x22e5ff, emissiveIntensity: 0.25 }),
    );
    toolWall.position.set(2, 3, -D / 2 + 0.3);
    g.add(toolWall);

    // Вывеска
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 2.6),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: makeLabelTexture(['ガレージ · ТЮНИНГ'], { color: '#ffe45c', width: 1600 }),
        emissiveIntensity: 1.6,
      }),
    );
    sign.position.set(0, H + 1.8, D / 2 + 0.05);
    g.add(sign);
    this.nightMats.push(sign.material as THREE.MeshStandardMaterial);
    const signBack = new THREE.Mesh(new THREE.BoxGeometry(14.4, 3, 0.3), wallMat);
    signBack.position.set(0, H + 1.8, D / 2 - 0.15);
    g.add(signBack);

    // Коллайдеры стен (в мире): три стены + две части фасада
    const addWall = (lx: number, lz: number, hw: number, hd: number) => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const wx = p.x + lx * c + lz * s;
      const wz = p.z - lx * s + lz * c;
      this.colliders.add({ x: wx, z: wz, hw, hd, yaw, tag: 'garage-wall' });
    };
    addWall(0, -D / 2, W / 2, 0.4);
    addWall(-W / 2, 0, 0.4, D / 2);
    addWall(W / 2, 0, 0.4, D / 2);
    addWall(-W / 2 + sideW / 2, D / 2, sideW / 2, 0.4);
    addWall(W / 2 - sideW / 2, D / 2, sideW / 2, 0.4);
    for (let i = 0; i < 4; i++) {
      const lx = -W / 2 + 1.2;
      const lz = -6 + i * 4;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      this.colliders.add({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c, hw: 1.5, hd: 0.5, yaw, tag: 'shelf' });
    }

    this.group.add(g);
  }

  // ── База Ваисова ───────────────────────────────────────────────────────
  private buildBossBase(): void {
    const p = this.plan.boss;
    const rnd = mulberry32(31337);
    const g = new THREE.Group();
    // Центр двора — вглубь от дороги, передняя стена сразу за тротуаром
    const cx = p.x + p.inX * BOSS_YARD_OFFSET;
    const cz = p.z + p.inZ * BOSS_YARD_OFFSET;
    g.position.set(cx, p.y - 0.1, cz);
    const yaw = Math.atan2(-p.inX, -p.inZ); // +z локальный → к дороге
    g.rotation.y = yaw;
    const W = 76;
    const D = 60;
    const wallH = 6;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2226, roughness: 0.9 });
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const toWorld = (lx: number, lz: number) => ({ x: cx + lx * c + lz * s, z: cz - lx * s + lz * c });
    const addCol = (lx: number, lz: number, hw: number, hd: number, tag: string): OBB => {
      const w = toWorld(lx, lz);
      return this.colliders.add({ x: w.x, z: w.z, hw, hd, yaw, tag });
    };
    const wall = (w: number, d: number, lx: number, lz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      m.position.set(lx, wallH / 2, lz);
      g.add(m);
      addCol(lx, lz, w / 2, d / 2, 'base-wall');
      // Колючка сверху — тонкий тёмный брус
      const wire = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.25, d + 0.2), new THREE.MeshStandardMaterial({ color: 0x151313 }));
      wire.position.set(lx, wallH + 0.15, lz);
      g.add(wire);
    };
    const gateW = 11;
    wall(W, 1, 0, -D / 2);
    wall(1, D, -W / 2, 0);
    wall(1, D, W / 2, 0);
    const front = (W - gateW) / 2;
    wall(front, 1, -W / 2 + front / 2, D / 2);
    wall(front, 1, W / 2 - front / 2, D / 2);
    // Арка над воротами
    const arch = new THREE.Mesh(new THREE.BoxGeometry(gateW + 2, 1.4, 1.6), wallMat);
    arch.position.set(0, wallH + 0.7, D / 2);
    g.add(arch);

    // Ворота — две створки, разъезжаются в стороны
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x3b0f14, metalness: 0.7, roughness: 0.35 });
    this.gateL = new THREE.Mesh(new THREE.BoxGeometry(gateW / 2, wallH - 0.4, 0.4), gateMat);
    this.gateL.position.set(-gateW / 4, (wallH - 0.4) / 2, D / 2);
    this.gateR = this.gateL.clone();
    this.gateR.position.x = gateW / 4;
    g.add(this.gateL, this.gateR);
    for (const m of [this.gateL, this.gateR]) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(gateW / 2 - 0.6, 0.3, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2020, emissiveIntensity: 2.5 }),
      );
      stripe.position.set(0, 1.2, 0.25);
      m.add(stripe);
      this.nightMats.push(stripe.material as THREE.MeshStandardMaterial);
    }
    this.gateCollider = addCol(0, D / 2, gateW / 2, 0.4, 'gate');

    // Главный бункер с вывеской
    const bunker = new THREE.Mesh(new THREE.BoxGeometry(26, 11, 16), new THREE.MeshStandardMaterial({ color: 0x1f1a1d, roughness: 0.8 }));
    bunker.position.set(0, 5.5, -D / 2 + 12);
    g.add(bunker);
    addCol(0, -D / 2 + 12, 13, 8, 'bunker');
    this.bossSignMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: makeLabelTexture(['ВАИСОВ CORP', '拠点 · БАЗА'], { color: '#ff2020', width: 1400 }),
      emissiveIntensity: 1.8,
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(18, 5.2), this.bossSignMat);
    sign.position.set(0, 12.5, -D / 2 + 12 + 8.05);
    g.add(sign);
    const signBack = new THREE.Mesh(new THREE.BoxGeometry(18.4, 5.6, 0.3), wallMat);
    signBack.position.set(0, 12.5, -D / 2 + 12 + 7.9);
    g.add(signBack);

    // Контейнеры по двору
    const colors = [0x8c1d1d, 0x1d3a8c, 0x6b6b6b, 0x8c6d1d];
    for (let i = 0; i < 9; i++) {
      const cont = makeContainer(colors[i % colors.length], 10 + rnd() * 4);
      const lx = -W / 2 + 6 + rnd() * (W - 12);
      const lz = -D / 2 + 22 + rnd() * (D - 34);
      if (Math.abs(lx) < 10 && lz > 0) continue; // проезд к клетке
      cont.position.set(lx, 1.3, lz);
      cont.rotation.y = rnd() < 0.5 ? 0 : Math.PI / 2;
      g.add(cont);
      addCol(lx, lz, cont.rotation.y ? 6 : 1.2, cont.rotation.y ? 1.2 : 6, 'container');
    }

    // Прожекторы на башнях по углам
    for (const [lx, lz] of [
      [-W / 2 + 1, D / 2 - 1],
      [W / 2 - 1, D / 2 - 1],
      [-W / 2 + 1, -D / 2 + 1],
      [W / 2 - 1, -D / 2 + 1],
    ]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.4, 10, 2.4), wallMat);
      tower.position.set(lx, 5, lz);
      g.add(tower);
      const sl = makeSearchlight(0xff2020);
      sl.position.set(lx, 10, lz);
      g.add(sl);
      this.searchlights.push(sl);
    }

    // Клетка с аниме-девочками
    this.cageBars = new THREE.Group();
    this.cageBars.position.set(0, 0, 6);
    const barMat = new THREE.MeshStandardMaterial({ color: 0x6d6d78, metalness: 0.8, roughness: 0.3 });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), barMat);
      bar.position.set(Math.sin(a) * 3.2, 2, Math.cos(a) * 3.2);
      this.cageBars.add(bar);
    }
    const cageTop = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.08, 6, 30), barMat);
    cageTop.rotation.x = Math.PI / 2;
    cageTop.position.y = 4;
    this.cageBars.add(cageTop);
    g.add(this.cageBars);
    addCol(0, 6, 3.4, 3.4, 'cage');
    const girlColors: Array<[number, number]> = [
      [0xff9ad5, 0xffe3f3],
      [0x9ad5ff, 0xe9f6ff],
      [0xffd29a, 0xfff4e0],
      [0xc9a0ff, 0xf1e6ff],
      [0xa0ffc9, 0xe8fff1],
    ];
    girlColors.forEach(([hair, dress], i) => {
      const a = (i / girlColors.length) * Math.PI * 2;
      const girl = makeChibi(hair, dress);
      girl.position.set(Math.sin(a) * 1.6, 0, 6 + Math.cos(a) * 1.6);
      girl.rotation.y = a + Math.PI;
      g.add(girl);
      this.girls.push(girl);
    });

    this.group.add(g);
  }

  // ── Логика ─────────────────────────────────────────────────────────────

  /** В какой зоне находится точка (машина). */
  zoneAt(x: number, z: number): { id: ZoneId; dist: number } | null {
    let best: { id: ZoneId; dist: number } | null = null;
    for (const id of ['quest', 'garage', 'boss'] as ZoneId[]) {
      const p = this.plan[id];
      const d = Math.hypot(x - p.x, z - p.z);
      if (d <= p.r && (!best || d < best.dist)) best = { id, dist: d };
    }
    return best;
  }

  openGate(): void {
    this.gateTarget = 1;
    this.gateCollider.disabled = true;
  }

  captureBase(): void {
    this.celebrate = 1;
    this.openGate();
  }

  get bossCaptured(): boolean {
    return this.celebrate > 0;
  }

  /** Опорные точки для камеры во время штурма. */
  bossFocus(): { yard: THREE.Vector3; cage: THREE.Vector3; gate: THREE.Vector3; inward: THREE.Vector3; along: THREE.Vector3 } {
    const p = this.plan.boss;
    const off = BOSS_YARD_OFFSET;
    const yard = new THREE.Vector3(p.x + p.inX * off, p.y, p.z + p.inZ * off);
    // Клетка стоит на local z=+6 от центра двора, т.е. на 6 м ближе к дороге
    const cage = new THREE.Vector3(p.x + p.inX * (off - 6), p.y + 1.5, p.z + p.inZ * (off - 6));
    const gate = new THREE.Vector3(p.x + p.inX * (off - 30), p.y + 2, p.z + p.inZ * (off - 30));
    const inward = new THREE.Vector3(p.inX, 0, p.inZ);
    const along = new THREE.Vector3(p.sample.tx, 0, p.sample.tz);
    return { yard, cage, gate, inward, along };
  }

  setDayness(t: number): void {
    for (const m of this.nightMats) m.emissiveIntensity = lerp(0.4, 1.8, 1 - t);
    if (this.bossSignMat) this.bossSignMat.emissiveIntensity = lerp(0.5, 1.8, 1 - t);
    if (this.beaconMat) this.beaconMat.opacity = lerp(0.12, 0.45, 1 - t);
  }

  update(dt: number, carPos: THREE.Vector3, questDone: boolean): void {
    this.time += dt;
    // Гараж: ворота открываются, когда машина рядом
    const gp = this.plan.garage;
    const gd = Math.hypot(carPos.x - gp.x, carPos.z - gp.z);
    const gTarget = gd < 34 ? 1 : 0;
    this.garageOpen = damp(this.garageOpen, gTarget, 2.2, dt);
    this.garageDoor.position.y = this.garageDoorH / 2 + this.garageOpen * (this.garageDoorH - 0.3);

    // Ворота базы
    this.gateOpen = damp(this.gateOpen, this.gateTarget, 1.1, dt);
    const gateW = 11;
    this.gateL.position.x = -gateW / 4 - this.gateOpen * (gateW / 2 + 0.3);
    this.gateR.position.x = gateW / 4 + this.gateOpen * (gateW / 2 + 0.3);

    // Прожекторы крутятся, пока база не взята
    this.searchlights.forEach((sl, i) => {
      const head = sl.getObjectByName('head');
      if (!head) return;
      const speed = this.celebrate > 0 ? 0.15 : 0.7;
      head.rotation.y = Math.sin(this.time * speed + i * 1.7) * 1.2 + (i % 2 ? Math.PI : 0);
      head.rotation.x = -0.35 + Math.sin(this.time * 0.5 + i) * 0.15;
      const beam = head.getObjectByName('beam') as THREE.Mesh | undefined;
      if (beam) (beam.material as THREE.MeshBasicMaterial).opacity = this.celebrate > 0 ? 0.03 : 0.12;
    });

    // Маяк квеста
    if (this.questBeacon) {
      this.questBeacon.visible = !questDone;
      this.questBeacon.rotation.y += dt * 0.4;
      this.beaconMat.opacity = 0.22 + 0.1 * Math.sin(this.time * 2);
    }

    // Клетка и девочки
    if (this.celebrate > 0) {
      this.celebrate = Math.min(1, this.celebrate + dt * 0.2);
      this.cageBars.scale.y = Math.max(0.001, 1 - this.celebrate * 1.2);
      this.cageBars.position.y = -4 * Math.min(1, this.celebrate * 1.2);
      this.girls.forEach((girl, i) => {
        const bounce = Math.abs(Math.sin(this.time * 4 + i)) * 0.5;
        girl.position.y = bounce;
        girl.rotation.y += dt * 1.5;
        const arms = girl.getObjectByName('arms');
        if (arms) arms.rotation.z = Math.sin(this.time * 8 + i) * 0.4;
      });
    } else {
      this.girls.forEach((girl, i) => {
        girl.position.y = Math.sin(this.time * 1.5 + i) * 0.02;
      });
    }
  }
}

/** Маленькая чиби-фигурка: голова-шарик, платье, большие глаза, хвостики. */
function makeChibi(hair: number, dress: number): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xffe0d0, roughness: 0.8 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.6, emissive: hair, emissiveIntensity: 0.15 });
  const dressMat = new THREE.MeshStandardMaterial({ color: dress, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.8, 12), dressMat);
  body.position.y = 0.4;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), skin);
  head.position.y = 1.05;
  g.add(head);
  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.33, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat);
  hairTop.position.y = 1.08;
  g.add(hairTop);
  for (const x of [-0.36, 0.36]) {
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.35, 4, 8), hairMat);
    tail.position.set(x, 0.85, 0.05);
    tail.rotation.z = x > 0 ? -0.35 : 0.35;
    g.add(tail);
  }
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x25143a, roughness: 0.2, emissive: 0x6a3fa0, emissiveIntensity: 0.3 });
  for (const x of [-0.11, 0.11]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), eyeMat);
    eye.position.set(x, 1.05, 0.26);
    eye.scale.set(1, 1.4, 0.5);
    g.add(eye);
  }
  const arms = new THREE.Group();
  arms.name = 'arms';
  for (const x of [-0.36, 0.36]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 4, 8), skin);
    arm.position.set(x, 0.55, 0);
    arm.rotation.z = x > 0 ? -0.5 : 0.5;
    arms.add(arm);
  }
  g.add(arms);
  return g;
}
