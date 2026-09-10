import * as THREE from 'three';
import { PLAYER } from '@/config';
import type { Input } from '@/core/Input';
import { circleVsObb, type Colliders, type OBB } from '@/world/Colliders';
import { angleLerp, damp } from '@/world/noise';

export interface PlayerWorld {
  groundHeight(x: number, z: number): number;
  colliders: Colliders;
}

/**
 * Стилизованный персонаж: чёрная куртка с неоновой полосой, тёмные волосы, белые кроссовки.
 * Процедурная походка. Умеет «садиться» — переезжает на якорь сиденья в машине.
 */
export class Player {
  readonly group = new THREE.Group();
  x = 0;
  y = 0;
  z = 0;
  heading = 0;
  speed = 0;
  seated = false;

  private legL: THREE.Group;
  private legR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private torso: THREE.Group;
  private head: THREE.Group;
  private phase = 0;
  private moveAmount = 0;
  private autoTarget: THREE.Vector3 | null = null;
  private autoHeading = 0;
  private autoDone: (() => void) | null = null;

  constructor() {
    this.group.name = 'player';
    const skin = new THREE.MeshStandardMaterial({ color: 0xf1d2c0, roughness: 0.8 });
    const jacket = new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.7 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xff2d95, emissive: 0xff2d95, emissiveIntensity: 1.2 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x1d2130, roughness: 0.9 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0xf4f4f6, roughness: 0.5 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x1a1230, roughness: 0.6 });

    const makeLeg = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.86, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.36, 4, 8), pants);
      upper.position.y = -0.24;
      g.add(upper);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 4, 8), pants);
      lower.position.y = -0.62;
      g.add(lower);
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.28), shoe);
      sh.position.set(0, -0.82, -0.05);
      g.add(sh);
      return g;
    };
    this.legL = makeLeg(-0.11);
    this.legR = makeLeg(0.11);
    this.group.add(this.legL, this.legR);

    this.torso = new THREE.Group();
    this.torso.position.y = 0.86;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), jacket);
    body.position.y = 0.34;
    body.scale.set(1, 1, 0.75);
    this.torso.add(body);
    // Неоновая полоса на куртке
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.02), stripe);
    line.position.set(0, 0.42, -0.16);
    this.torso.add(line);
    const line2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.4, 0.02), stripe);
    line2.position.set(0.12, 0.3, -0.165);
    this.torso.add(line2);
    this.group.add(this.torso);

    const makeArm = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 1.48, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.3, 4, 8), jacket);
      upper.position.y = -0.2;
      g.add(upper);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), skin);
      hand.position.y = -0.46;
      g.add(hand);
      return g;
    };
    this.armL = makeArm(-0.28);
    this.armR = makeArm(0.28);
    this.torso.add(this.armL, this.armR);
    this.armL.position.y = 0.62;
    this.armR.position.y = 0.62;

    this.head = new THREE.Group();
    this.head.position.y = 0.78;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin);
    neck.position.y = -0.02;
    this.head.add(neck);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), skin);
    face.position.y = 0.16;
    face.scale.set(0.95, 1.05, 0.95);
    this.head.add(face);
    const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.185, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairTop.position.y = 0.19;
    this.head.add(hairTop);
    // Чёлка — пара клиньев
    for (const [x, r] of [
      [-0.06, 0.3],
      [0.05, -0.2],
      [0.12, 0.5],
    ]) {
      const bang = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), hair);
      bang.position.set(x, 0.2, -0.13);
      bang.rotation.x = Math.PI + 0.5;
      bang.rotation.z = r;
      this.head.add(bang);
    }
    // Глаза
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2a, roughness: 0.3 });
    for (const x of [-0.06, 0.06]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.02), eyeMat);
      eye.position.set(x, 0.16, -0.16);
      this.head.add(eye);
    }
    this.torso.add(this.head);
  }

  placeAt(x: number, z: number, heading: number, y: number): void {
    this.x = x;
    this.z = z;
    this.y = y;
    this.heading = heading;
    this.group.position.set(x, y, z);
    this.group.rotation.set(0, heading, 0);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
  }

  /** Автоматически дойти до точки (для посадки в машину). */
  walkTo(target: THREE.Vector3, faceHeading: number, done: () => void): void {
    this.autoTarget = target.clone();
    this.autoHeading = faceHeading;
    this.autoDone = done;
  }

  cancelAuto(): void {
    this.autoTarget = null;
    this.autoDone = null;
  }

  get isAuto(): boolean {
    return this.autoTarget !== null;
  }

  /** Посадить/высадить. При посадке группа переезжает под якорь. */
  setSeated(seated: boolean, anchor?: THREE.Object3D): void {
    this.seated = seated;
    if (seated && anchor) {
      anchor.add(this.group);
      // Якорь сиденья на высоте 0.9 в кузове; сажаем так, чтобы макушка была под крышей (~1.35).
      this.group.scale.setScalar(0.8);
      this.group.position.set(0, -1.14, 0);
      this.group.rotation.set(0, 0, 0);
      this.legL.visible = false;
      this.legR.visible = false;
      this.torso.rotation.set(-0.08, 0, 0);
      this.armL.rotation.set(-1.0, 0, 0.3);
      this.armR.rotation.set(-1.0, 0, -0.3);
    } else {
      this.group.scale.setScalar(1);
      this.legL.visible = true;
      this.legR.visible = true;
      this.torso.rotation.set(0, 0, 0);
      this.armL.rotation.set(0, 0, 0);
      this.armR.rotation.set(0, 0, 0);
    }
  }

  update(dt: number, input: Input | null, camYaw: number, world: PlayerWorld, extra: OBB[]): void {
    if (this.seated) return;

    let dirX = 0;
    let dirZ = 0;
    let want = 0;
    let run = false;

    if (this.autoTarget) {
      const dx = this.autoTarget.x - this.x;
      const dz = this.autoTarget.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.12) {
        this.heading = angleLerp(this.heading, this.autoHeading, 1 - Math.exp(-10 * dt));
        if (Math.abs(((this.heading - this.autoHeading + Math.PI) % (Math.PI * 2)) - Math.PI) < 0.08) {
          const cb = this.autoDone;
          this.autoTarget = null;
          this.autoDone = null;
          cb?.();
        }
      } else {
        dirX = dx / d;
        dirZ = dz / d;
        want = Math.min(1, d / 0.6);
      }
    } else if (input) {
      const mx = input.moveX;
      const my = input.moveY;
      if (mx !== 0 || my !== 0) {
        // Направление относительно камеры
        const fx = -Math.sin(camYaw);
        const fz = -Math.cos(camYaw);
        const rx = Math.cos(camYaw);
        const rz = -Math.sin(camYaw);
        dirX = fx * my + rx * mx;
        dirZ = fz * my + rz * mx;
        const l = Math.hypot(dirX, dirZ) || 1;
        dirX /= l;
        dirZ /= l;
        want = 1;
        run = input.run;
      }
    }

    const targetSpeed = want > 0 ? (run ? PLAYER.runSpeed : PLAYER.walkSpeed) * want : 0;
    this.speed = damp(this.speed, targetSpeed, 9, dt);
    if (want > 0) {
      const targetHeading = Math.atan2(-dirX, -dirZ);
      this.heading = angleLerp(this.heading, targetHeading, 1 - Math.exp(-11 * dt));
    }
    if (this.speed > 0.01) {
      const mvx = (want > 0 ? dirX : -Math.sin(this.heading)) * this.speed * dt;
      const mvz = (want > 0 ? dirZ : -Math.cos(this.heading)) * this.speed * dt;
      let nx = this.x + mvx;
      let nz = this.z + mvz;
      const hit = world.colliders.resolveCircle(nx, nz, 0.38);
      nx = hit.x;
      nz = hit.z;
      for (const o of extra) {
        const push = circleVsObb(nx, nz, 0.42, o);
        if (push) {
          nx += push.nx * push.depth;
          nz += push.nz * push.depth;
        }
      }
      this.x = nx;
      this.z = nz;
    }
    const gy = world.groundHeight(this.x, this.z);
    this.y = damp(this.y, gy, 14, dt);

    // Анимация
    const moving = this.speed / PLAYER.runSpeed;
    this.moveAmount = damp(this.moveAmount, Math.min(1, this.speed / PLAYER.walkSpeed), 8, dt);
    this.phase += dt * (5.5 + moving * 6) * (this.speed > 0.05 ? 1 : 0);
    const swing = Math.sin(this.phase) * 0.75 * this.moveAmount;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;
    this.armR.rotation.x = swing * 0.8;
    this.torso.position.y = 0.86 + Math.abs(Math.sin(this.phase)) * 0.04 * this.moveAmount;
    this.torso.rotation.x = 0.06 * this.moveAmount;
    // Дыхание в покое
    const idle = 1 - this.moveAmount;
    this.head.position.y = 0.78 + Math.sin(performance.now() * 0.0015) * 0.006 * idle;

    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(0, this.heading, 0);
  }
}
