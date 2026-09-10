import * as THREE from 'three';
import type { Track } from './Track';
import type { Terrain } from './Terrain';
import type { Colliders } from './Colliders';
import { mergeGeometries } from './Track';
import { mulberry32, lerp } from './noise';

/** Яркость одного уличного фонаря. */
const LAMP_INTENSITY = 130;

/**
 * Фонари, деревья сакуры, пул реальных источников света у ближайших фонарей,
 * и маленькие «строительные блоки» для зон (тории, фонарики, автоматы, контейнеры).
 */
export class Props {
  readonly group = new THREE.Group();
  readonly lampPositions: THREE.Vector3[] = [];
  private lampHeadMat!: THREE.MeshStandardMaterial;
  private canopyMat!: THREE.MeshStandardMaterial;
  private lampPool: THREE.PointLight[] = [];
  private poolTimer = 0;
  private blossom = 0;
  private dayness = 0;

  constructor(
    private track: Track,
    private terrain: Terrain,
    private colliders: Colliders,
  ) {
    this.group.name = 'props';
  }

  build(): void {
    this.buildLamps();
    this.buildTrees();
    // Пул точечных источников: подсвечивают дорогу под ближайшими фонарями.
    for (let i = 0; i < 14; i++) {
      const l = new THREE.PointLight(0xffd9a6, 0, 60, 1.5);
      l.visible = false;
      this.group.add(l);
      this.lampPool.push(l);
    }
  }

  private buildLamps(): void {
    const poleGeoms: THREE.BufferGeometry[] = [];
    const headGeoms: THREE.BufferGeometry[] = [];
    const pole = new THREE.CylinderGeometry(0.1, 0.14, 9, 8);
    const arm = new THREE.BoxGeometry(0.16, 0.16, 2.6);
    const head = new THREE.BoxGeometry(0.5, 0.22, 1.3);
    const m4 = new THREE.Matrix4();
    const hw = this.track.halfWidth;
    let side = 1;
    let last = -1000;
    for (const smp of this.track.samples) {
      // Фонари стоят вдоль всей трассы: в горах и на смотровой они реже, в городе — чаще.
      const wild = smp.sector === 'touge' || smp.sector === 'overlook';
      const gap = wild ? 34 : 22;
      if (smp.s - last < gap) continue;
      last = smp.s;
      side = -side;
      const off = smp.sector === 'bridge' ? hw + 1.6 : hw + 0.9 + 0.7;
      const x = smp.x + smp.nx * off * side;
      const z = smp.z + smp.nz * off * side;
      const y = smp.bridge ? smp.y + 0.3 : this.terrain.heightAt(x, z);
      const yaw = Math.atan2(smp.tx, smp.tz);
      // столб
      m4.makeRotationY(yaw);
      m4.setPosition(x, y + 4.5, z);
      poleGeoms.push(pole.clone().applyMatrix4(m4));
      // кронштейн к дороге
      const armLen = 2.6;
      const ax = x - smp.nx * (armLen / 2) * side;
      const az = z - smp.nz * (armLen / 2) * side;
      m4.makeRotationY(yaw + Math.PI / 2);
      m4.setPosition(ax, y + 8.9, az);
      poleGeoms.push(arm.clone().applyMatrix4(m4));
      const hx = x - smp.nx * armLen * side;
      const hz = z - smp.nz * armLen * side;
      m4.makeRotationY(yaw + Math.PI / 2);
      m4.setPosition(hx, y + 8.75, hz);
      headGeoms.push(head.clone().applyMatrix4(m4));
      this.lampPositions.push(new THREE.Vector3(hx, y + 8.4, hz));
    }
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3b3d45, metalness: 0.6, roughness: 0.5 });
    this.lampHeadMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffd9a6,
      emissiveIntensity: 3.2,
    });
    if (poleGeoms.length) {
      const poles = new THREE.Mesh(mergeGeometries(poleGeoms), poleMat);
      poles.name = 'lamp-poles';
      this.group.add(poles);
      const heads = new THREE.Mesh(mergeGeometries(headGeoms), this.lampHeadMat);
      heads.name = 'lamp-heads';
      this.group.add(heads);
    }
  }

  private buildTrees(): void {
    const rnd = mulberry32(777);
    const positions: Array<{ x: number; y: number; z: number; s: number; yaw: number }> = [];
    const hw = this.track.halfWidth;
    for (const smp of this.track.samples) {
      const wild = smp.sector === 'touge' || smp.sector === 'overlook';
      const park = smp.sector === 'city' && rnd() < 0.15;
      if (!wild && !park) continue;
      if (rnd() > 0.08) continue;
      for (const side of [-1, 1]) {
        if (rnd() < 0.4) continue;
        const off = hw + 4 + rnd() * (wild ? 22 : 3);
        const x = smp.x + smp.nx * off * side + (rnd() - 0.5) * 4;
        const z = smp.z + smp.nz * off * side + (rnd() - 0.5) * 4;
        if (this.terrain.isWater(x, z)) continue;
        if (this.colliders.test(x, z, 2)) continue;
        const near = this.track.nearest(x, z);
        if (near.dist < hw + 2.5) continue;
        const y = this.terrain.heightAt(x, z);
        positions.push({ x, y, z, s: 0.8 + rnd() * 0.7, yaw: rnd() * Math.PI * 2 });
      }
    }
    // Роща на смотровой площадке — плотнее
    const ov = this.track.atControl(14);
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 14 + rnd() * 40;
      const x = ov.x + Math.cos(a) * r;
      const z = ov.z + Math.sin(a) * r;
      const near = this.track.nearest(x, z);
      if (near.dist < hw + 3) continue;
      if (this.colliders.test(x, z, 2)) continue;
      positions.push({ x, y: this.terrain.heightAt(x, z), z, s: 0.9 + rnd() * 0.6, yaw: rnd() * 6.28 });
    }

    const count = positions.length;
    if (!count) return;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 3.2, 6);
    trunkGeo.translate(0, 1.6, 0);
    const canopyParts: THREE.BufferGeometry[] = [];
    const blobs = [
      [0, 4.2, 0, 2.3],
      [1.3, 3.6, 0.6, 1.6],
      [-1.2, 3.8, -0.4, 1.7],
      [0.3, 3.4, -1.3, 1.5],
      [0, 5.2, 0.4, 1.4],
    ];
    for (const [x, y, z, r] of blobs) {
      const s = new THREE.SphereGeometry(r, 9, 7);
      s.translate(x, y, z);
      canopyParts.push(s);
    }
    const canopyGeo = mergeGeometries(canopyParts);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3328, roughness: 0.95 });
    this.canopyMat = new THREE.MeshStandardMaterial({ color: 0x2b3f2a, roughness: 0.9 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const canopies = new THREE.InstancedMesh(canopyGeo, this.canopyMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    positions.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw);
      p.set(t.x, t.y - 0.2, t.z);
      sc.set(t.s, t.s, t.s);
      m.compose(p, q, sc);
      trunks.setMatrixAt(i, m);
      canopies.setMatrixAt(i, m);
      this.colliders.add({ x: t.x, z: t.z, hw: 0.35, hd: 0.35, yaw: 0, tag: 'tree' });
    });
    trunks.name = 'tree-trunks';
    canopies.name = 'tree-canopies';
    this.group.add(trunks, canopies);
    this.applyBlossom();
  }

  /** 0 — зелёная ночь, 1 — цветущая сакура. */
  setBlossom(t: number): void {
    this.blossom = t;
    this.applyBlossom();
  }

  setDayness(t: number): void {
    this.dayness = t;
    if (this.lampHeadMat) this.lampHeadMat.emissiveIntensity = lerp(0.15, 3.2, 1 - t);
    for (const l of this.lampPool) l.intensity = l.visible ? lerp(0, LAMP_INTENSITY, 1 - t) : 0;
    this.applyBlossom();
  }

  private applyBlossom(): void {
    if (!this.canopyMat) return;
    const green = new THREE.Color(0x2b3f2a);
    const pink = new THREE.Color(0xf6a6c8);
    this.canopyMat.color.copy(green).lerp(pink, this.blossom);
    this.canopyMat.emissive.set(0xff8fc0);
    this.canopyMat.emissiveIntensity = this.blossom * lerp(0.35, 0.12, this.dayness);
  }

  /** Пул точечных светильников — прикрепляем к ближайшим к камере фонарям. */
  update(dt: number, focus: THREE.Vector3): void {
    this.poolTimer -= dt;
    if (this.poolTimer > 0) return;
    this.poolTimer = 0.3;
    if (this.dayness > 0.7) {
      for (const l of this.lampPool) l.visible = false;
      return;
    }
    // Ближайшие N фонарей
    const near = this.lampPositions
      .map((p, i) => ({ i, d: p.distanceToSquared(focus) }))
      .filter((e) => e.d < 180 * 180)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.lampPool.length);
    this.lampPool.forEach((l, k) => {
      const e = near[k];
      if (!e) {
        l.visible = false;
        return;
      }
      l.visible = true;
      l.position.copy(this.lampPositions[e.i]);
      l.intensity = lerp(LAMP_INTENSITY, 0, this.dayness);
    });
  }
}

// ─── Строительные блоки для зон ───────────────────────────────────────────────

export function makeTorii(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1a1414, roughness: 0.7 });
  const pillar = new THREE.CylinderGeometry(0.28, 0.32, 6, 10);
  for (const x of [-2.2, 2.2]) {
    const p = new THREE.Mesh(pillar, red);
    p.position.set(x, 3, 0);
    g.add(p);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.4, 10), black);
    base.position.set(x, 0.2, 0);
    g.add(base);
  }
  const kasagi = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.42, 0.6), black);
  kasagi.position.y = 6.2;
  g.add(kasagi);
  const shimaki = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.32, 0.5), red);
  shimaki.position.y = 5.8;
  g.add(shimaki);
  const nuki = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.3, 0.4), red);
  nuki.position.y = 4.7;
  g.add(nuki);
  const gakuzuka = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.36), red);
  gakuzuka.position.y = 5.25;
  g.add(gakuzuka);
  g.scale.setScalar(scale);
  return g;
}

export function makeLantern(color = 0xffb066): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x6f6a66, roughness: 0.95 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.6, 8), stone);
  post.position.y = 0.8;
  g.add(post);
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.6, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: color, emissiveIntensity: 0.9 }),
  );
  box.position.y = 1.9;
  g.add(box);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.4, 4), stone);
  roof.position.y = 2.4;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  return g;
}

export function makeVendingMachine(color = 0x22e5ff): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.9, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.5, metalness: 0.2 }),
  );
  body.position.y = 0.95;
  g.add(body);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 1.6 }),
  );
  screen.position.set(0, 1.25, 0.41);
  g.add(screen);
  return g;
}

export function makeContainer(color: number, len = 12): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 2.6, len),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.35 }),
  );
  m.position.y = 1.3;
  return m;
}

export function makeSearchlight(color = 0xff2020): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.6, 0.6, 10),
    new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.6, roughness: 0.4 }),
  );
  base.position.y = 0.3;
  g.add(base);
  const head = new THREE.Group();
  head.position.y = 0.9;
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 0.8, 12),
    new THREE.MeshStandardMaterial({ color: 0x333338, metalness: 0.7, roughness: 0.3 }),
  );
  lamp.rotation.x = Math.PI / 2;
  head.add(lamp);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(4.5, 60, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  beam.rotation.x = -Math.PI / 2;
  beam.position.z = 30;
  beam.name = 'beam';
  head.add(beam);
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 4 }),
  );
  lens.position.z = 0.41;
  head.add(lens);
  head.name = 'head';
  g.add(head);
  return g;
}
