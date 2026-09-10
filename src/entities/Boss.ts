import * as THREE from 'three';
import { damp, clamp, angleLerp } from '@/world/noise';

export type BossPhase = 'idle' | 'taunt' | 'fight' | 'stagger' | 'defeated';

const MAX_HP = 5;

/**
 * Ваисов — босс. Большая фигура в кожанке, бегает по двору базы,
 * уворачивается и наскакивает. Бьётся только флюгегехайменом.
 */
export class Boss {
  readonly group = new THREE.Group();
  hp = MAX_HP;
  readonly maxHp = MAX_HP;
  phase: BossPhase = 'idle';

  x = 0;
  z = 0;
  y = 0;
  heading = 0;

  private vx = 0;
  private vz = 0;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private torso: THREE.Group;
  private aura: THREE.Mesh;
  private auraMat: THREE.MeshBasicMaterial;
  private light: THREE.PointLight;
  private walk = 0;
  private staggerT = 0;
  private invuln = 0;
  private time = 0;
  private homeX = 0;
  private homeZ = 0;
  private hurtFlash = 0;
  private bodyMats: THREE.MeshStandardMaterial[] = [];

  constructor() {
    this.group.name = 'boss';
    this.group.visible = false;

    const leather = new THREE.MeshStandardMaterial({ color: 0x14100f, roughness: 0.45, metalness: 0.25 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe8bb99, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.9 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x0c0c0f, roughness: 0.6 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x120c08, roughness: 0.7 });
    this.bodyMats.push(leather, skin);

    const makeLeg = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 1.15, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.5, 4, 8), pants);
      upper.position.y = -0.32;
      g.add(upper);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.46, 4, 8), pants);
      lower.position.y = -0.82;
      g.add(lower);
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.42), boot);
      sh.position.set(0, -1.1, -0.06);
      g.add(sh);
      return g;
    };
    this.legL = makeLeg(-0.19);
    this.legR = makeLeg(0.19);
    this.group.add(this.legL, this.legR);

    this.torso = new THREE.Group();
    this.torso.position.y = 1.15;
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.6, 4, 12), leather);
    chest.position.y = 0.42;
    chest.scale.set(1.25, 1, 0.8);
    this.torso.add(chest);
    // Воротник кожанки
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.18, 12), leather);
    collar.position.y = 0.82;
    this.torso.add(collar);
    this.group.add(this.torso);

    const makeArm = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.66, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.42, 4, 8), leather);
      upper.position.y = -0.28;
      g.add(upper);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.36, 4, 8), leather);
      fore.position.y = -0.66;
      g.add(fore);
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), skin);
      fist.position.y = -0.9;
      g.add(fist);
      return g;
    };
    this.armL = makeArm(-0.5);
    this.armR = makeArm(0.5);
    this.torso.add(this.armL, this.armR);

    const head = new THREE.Group();
    head.position.y = 1.02;
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), skin);
    face.scale.set(1, 1.1, 1);
    head.add(face);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
    head.add(cap);
    // Усы — фирменный знак
    const mous = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.045, 0.05), hair);
    mous.position.set(0, -0.04, -0.22);
    head.add(mous);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 2.5 });
    for (const x of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMat);
      eye.position.set(x, 0.05, -0.21);
      head.add(eye);
    }
    this.torso.add(head);

    // Аура под ногами
    this.auraMat = new THREE.MeshBasicMaterial({
      color: 0xff2020,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.aura = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.6, 28), this.auraMat);
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.position.y = 0.05;
    this.group.add(this.aura);

    this.light = new THREE.PointLight(0xff2020, 20, 14, 2);
    this.light.position.y = 1.8;
    this.group.add(this.light);

    this.group.scale.setScalar(1.35); // Ваисов крупный
  }

  spawn(x: number, z: number, y: number, heading: number): void {
    this.x = this.homeX = x;
    this.z = this.homeZ = z;
    this.y = y;
    this.heading = heading;
    this.hp = MAX_HP;
    this.phase = 'taunt';
    this.vx = this.vz = 0;
    this.group.visible = true;
    this.group.position.set(x, y, z);
  }

  hide(): void {
    this.group.visible = false;
    this.phase = 'idle';
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  /** Радиус тела для попаданий. */
  get radius(): number {
    return 1.5;
  }

  /** Наносит урон, отталкивает от точки удара. Возвращает true, если попадание засчитано. */
  takeHit(fromX: number, fromZ: number, power = 1): boolean {
    if (this.invuln > 0 || this.phase === 'defeated') return false;
    this.hp = Math.max(0, this.hp - 1);
    this.invuln = 0.55;
    this.staggerT = 0.75;
    this.hurtFlash = 1;
    const dx = this.x - fromX;
    const dz = this.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const push = 13 * power;
    this.vx = (dx / d) * push;
    this.vz = (dz / d) * push;
    this.phase = this.hp <= 0 ? 'defeated' : 'stagger';
    return true;
  }

  update(dt: number, targetX: number, targetZ: number, groundY: (x: number, z: number) => number): void {
    if (!this.group.visible) return;
    this.time += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);

    const dx = targetX - this.x;
    const dz = targetZ - this.z;
    const dist = Math.hypot(dx, dz) || 1;

    let speed = 0;
    if (this.phase === 'stagger') {
      this.staggerT -= dt;
      if (this.staggerT <= 0) this.phase = 'fight';
    } else if (this.phase === 'fight') {
      // Держит дистанцию, потом бросается
      const charge = Math.sin(this.time * 0.9) > 0.35;
      const want = charge ? 0 : 11;
      const err = dist - want;
      speed = clamp(err * 0.9, -6, charge ? 12 : 7);
      this.vx = damp(this.vx, (dx / dist) * speed, 4, dt);
      this.vz = damp(this.vz, (dz / dist) * speed, 4, dt);
      // Немного вбок, чтобы не бегал строго по прямой
      const side = Math.sin(this.time * 1.7) * 4;
      this.vx += (-dz / dist) * side * dt * 4;
      this.vz += (dx / dist) * side * dt * 4;
    } else if (this.phase === 'taunt') {
      this.vx = damp(this.vx, 0, 6, dt);
      this.vz = damp(this.vz, 0, 6, dt);
    } else if (this.phase === 'defeated') {
      this.vx = damp(this.vx, 0, 2.5, dt);
      this.vz = damp(this.vz, 0, 2.5, dt);
    }

    // Трение при отлёте
    if (this.phase === 'stagger' || this.phase === 'defeated') {
      this.vx = damp(this.vx, 0, 3.5, dt);
      this.vz = damp(this.vz, 0, 3.5, dt);
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    // Не убегает со двора
    const homeDist = Math.hypot(this.x - this.homeX, this.z - this.homeZ);
    if (homeDist > 26) {
      const k = 26 / homeDist;
      this.x = this.homeX + (this.x - this.homeX) * k;
      this.z = this.homeZ + (this.z - this.homeZ) * k;
    }
    this.y = damp(this.y, groundY(this.x, this.z), 12, dt);

    if (this.phase !== 'defeated') {
      this.heading = angleLerp(this.heading, Math.atan2(-dx, -dz), 1 - Math.exp(-6 * dt));
    }

    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.heading;

    // Анимация
    const moving = Math.min(1, Math.hypot(this.vx, this.vz) / 6);
    this.walk += dt * (4 + moving * 8);
    const swing = Math.sin(this.walk) * 0.7 * moving;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.7;
    this.armR.rotation.x = swing * 0.7;

    if (this.phase === 'defeated') {
      // Падает на спину
      this.group.rotation.x = damp(this.group.rotation.x, -1.35, 3, dt);
      this.torso.rotation.x = damp(this.torso.rotation.x, 0.3, 3, dt);
      this.auraMat.opacity = damp(this.auraMat.opacity, 0, 2, dt);
      this.light.intensity = damp(this.light.intensity, 0, 2, dt);
    } else if (this.phase === 'taunt') {
      // Потрясает кулаками
      const t = Math.sin(this.time * 6);
      this.armL.rotation.x = -1.6 + t * 0.3;
      this.armR.rotation.x = -1.6 - t * 0.3;
      this.torso.rotation.y = t * 0.15;
    } else {
      this.torso.rotation.y = 0;
      const pulse = 0.28 + 0.12 * Math.sin(this.time * 4);
      this.auraMat.opacity = pulse + this.hurtFlash * 0.5;
      this.light.intensity = 20 + this.hurtFlash * 60;
      this.group.position.y += this.hurtFlash * 0.15 * Math.sin(this.time * 40);
    }

    // Мигание при уроне
    const flash = this.invuln > 0 && Math.sin(this.time * 40) > 0;
    for (const m of this.bodyMats) {
      m.emissive.set(0xff0000);
      m.emissiveIntensity = flash ? 0.6 : 0;
    }
  }
}
