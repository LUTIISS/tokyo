import * as THREE from 'three';
import { CAR, NEON_COLORS } from '@/config';
import type { Upgrades } from '@/core/GameState';
import type { Colliders, OBB } from '@/world/Colliders';
import { damp, lerp } from '@/world/noise';
import { buildCarModel, type CarModel } from './CarModel';
import { CarPhysics, baseParams, type CarInput, type CarParams, type GroundQuery, IDLE_INPUT } from './CarPhysics';
import { Skidmarks, Smoke } from './Effects';

export interface CarWorld {
  queryGround(x: number, z: number): GroundQuery;
  colliders: Colliders;
  dayness: number;
  fog: THREE.Fog;
}

/**
 * Машина целиком: модель + физика + эффекты + апгрейды.
 */
export class Car {
  readonly model: CarModel;
  readonly physics = new CarPhysics();
  readonly skid = new Skidmarks();
  readonly smoke = new Smoke();
  params: CarParams = baseParams();

  engineOn = false;
  private doorTarget = 0;
  private doorAngle = 0;
  private wheelSpin = 0;
  private neonHex = NEON_COLORS[0].hex;
  private flameTimer = 0;
  private prevThrottle = 0;
  private bodyRoll = 0;
  private bodyPitch = 0;
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private tmpV = new THREE.Vector3();

  constructor(scene: THREE.Scene, envMap: THREE.Texture | null) {
    this.model = buildCarModel(envMap);
    scene.add(this.model.root, this.skid.mesh, this.smoke.points);
  }

  get root(): THREE.Group {
    return this.model.root;
  }

  get position(): THREE.Vector3 {
    return this.model.root.position;
  }

  get heading(): number {
    return this.physics.heading;
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.physics.forwardX, 0, this.physics.forwardZ);
  }

  right(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.physics.rightX, 0, this.physics.rightZ);
  }

  placeAt(x: number, z: number, heading: number, y: number): void {
    this.physics.reset(x, z, heading, y);
    this.model.root.position.set(x, y, z);
    this.model.root.rotation.set(0, heading, 0);
    for (let w = 0; w < 4; w++) this.skid.lift(w);
  }

  /** OBB машины для коллизий персонажа. */
  obb(): OBB {
    return { x: this.physics.x, z: this.physics.z, hw: CAR.width / 2 + 0.15, hd: CAR.length / 2 + 0.1, yaw: this.physics.heading, tag: 'car' };
  }

  /** Точка снаружи у водительской двери (правой), где встаёт персонаж. */
  doorPoint(out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.physics;
    return out.set(p.x + p.rightX * 1.9 - p.forwardX * 0.25, p.y, p.z + p.rightZ * 1.9 - p.forwardZ * 0.25);
  }

  openDoor(): void {
    this.doorTarget = 1.05;
  }
  closeDoor(): void {
    this.doorTarget = 0;
  }
  get doorOpenness(): number {
    return this.doorAngle / 1.05;
  }

  // ── Апгрейды ──
  applyUpgrades(u: Upgrades): void {
    const p = baseParams();
    const engineMul = [1, 1.28, 1.6][u.engine] ?? 1;
    const topMul = [1, 1.12, 1.3][u.engine] ?? 1;
    p.accel *= engineMul;
    p.maxSpeed *= topMul;
    if (u.turbo) {
      p.accel *= 1.15;
      p.maxSpeed *= 1.06;
    }
    // Шины: 0 стрит, 1 полуслики (цепче), 2 дрифт (легче срыв, длиннее занос)
    if (u.tires === 1) {
      p.grip *= 1.25;
      p.latAccelMax *= 1.2;
      p.driftGrip *= 1.1;
    } else if (u.tires === 2) {
      p.grip *= 0.92;
      p.latAccelMax *= 0.92;
      p.driftGrip *= 0.8;
      p.handbrakeGrip *= 0.75;
      p.driftYawBoost *= 1.2;
      p.driftYawMax *= 1.15;
    }
    if (u.spoiler) {
      p.grip *= 1.06;
      p.latAccelMax *= 1.08;
      p.steerSpeed *= 1.1;
    }
    if (u.bigUpgrade) {
      p.nitro = true;
      p.accel *= 1.1;
      p.maxSpeed *= 1.08;
    }
    this.params = p;
    this.model.spoiler.visible = u.spoiler;
    this.setNeon(NEON_COLORS[u.neon]?.hex ?? NEON_COLORS[0].hex);
  }

  setNeon(hex: number): void {
    this.neonHex = hex;
    this.model.neonLight.color.set(hex);
    this.model.neonGlowMat.color.set(hex);
    this.model.neonStripMat.emissive.set(hex);
    this.smoke.setTint(hex);
  }

  setEngine(on: boolean): void {
    this.engineOn = on;
  }

  update(dt: number, input: CarInput | null, world: CarWorld, time: number): void {
    const inp = input ?? IDLE_INPUT;
    const ph = this.physics;
    ph.update(dt, this.engineOn ? inp : IDLE_INPUT, this.params, (x, z) => world.queryGround(x, z), world.colliders);

    // ── Положение и наклон ──
    const root = this.model.root;
    root.position.set(ph.x, ph.y, ph.z);
    this.tmpE.set(ph.pitch, ph.heading, ph.roll, 'YXZ');
    this.tmpQ.setFromEuler(this.tmpE);
    root.quaternion.copy(this.tmpQ);

    // Динамический крен кузова
    const rollT = THREE.MathUtils.clamp(ph.accelLat * 0.012, -0.09, 0.09);
    const pitchT = THREE.MathUtils.clamp(-ph.accelLong * 0.01, -0.06, 0.06);
    this.bodyRoll = damp(this.bodyRoll, rollT, 6, dt);
    this.bodyPitch = damp(this.bodyPitch, pitchT, 6, dt);
    this.model.body.rotation.set(this.bodyPitch, 0, this.bodyRoll);

    // ── Колёса ──
    this.wheelSpin += (ph.speed / CAR.wheelRadius) * dt;
    const spinQ = this.wheelSpin;
    this.model.wheelPivots.forEach((pivot, i) => {
      if (i < 2) pivot.rotation.y = ph.steerAngle;
      this.model.wheelMeshes[i].rotation.x = spinQ;
    });

    // ── Дверь ──
    this.doorAngle = damp(this.doorAngle, this.doorTarget, 5, dt);
    this.model.door.rotation.y = this.doorAngle;

    // ── Свет ──
    const night = 1 - world.dayness;
    const lightsOn = this.engineOn;
    for (const hl of this.model.headlights) {
      hl.intensity = lightsOn ? lerp(40, 150, night) : 0;
    }
    this.model.headlightMat.emissiveIntensity = lightsOn ? 3.2 : 0.15;
    const braking = inp.brake > 0 && ph.speed > 0.5;
    this.model.tailMat.emissiveIntensity = lightsOn ? (braking ? 5 : 1.4) : 0.1;
    // Неон чуть дышит
    const breathe = 0.85 + 0.15 * Math.sin(time * 3.1) + (ph.nitroActive ? 0.5 : 0);
    this.model.neonLight.intensity = lerp(8, 38, night) * breathe;
    this.model.neonStripMat.emissiveIntensity = lerp(1.2, 3.2, night) * breathe;
    this.model.neonGlowMat.opacity = lerp(0.12, 0.42, night) * breathe;

    // ── Выхлоп (турбо-хлопки при сбросе газа, нитро — постоянно) ──
    const flame = this.model.exhaustFlame;
    if (this.params.nitro && ph.nitroActive) {
      flame.visible = true;
      this.model.exhaustFlameMat.color.set(0x5ec8ff);
      flame.scale.set(1.3, 1 + Math.random() * 0.6, 1.3);
    } else {
      if (this.prevThrottle > 0.5 && inp.throttle < 0.5 && ph.rpm > 0.6) this.flameTimer = 0.18;
      this.flameTimer -= dt;
      flame.visible = this.flameTimer > 0;
      this.model.exhaustFlameMat.color.set(0xff8a1f);
      flame.scale.set(1, 0.6 + Math.random() * 0.8, 1);
    }
    this.prevThrottle = inp.throttle;

    // ── Следы и дым ──
    const slipAmt = Math.min(1, Math.abs(ph.slip) / 0.5);
    const handbrake = inp.handbrake && Math.abs(ph.speed) > 2;
    const marking = (slipAmt > 0.3 || handbrake) && Math.abs(ph.speed) > 3;
    const intensity = Math.min(1, Math.max(slipAmt, handbrake ? 0.8 : 0));
    const rx = ph.rightX;
    const rz = ph.rightZ;
    const fx = ph.forwardX;
    const fz = ph.forwardZ;
    const half = CAR.wheelbase / 2;
    const tr = CAR.track / 2 + 0.04;
    const wheels: Array<[number, number]> = [
      [-tr, half], // rl (offset: right, forward)
      [tr, half],
      [-tr, -half],
      [tr, -half],
    ];
    for (let i = 0; i < 4; i++) {
      const [r, f] = wheels[i];
      // i<2 — задние колёса (смещение назад по forward), i>=2 — передние
      const px = ph.x + rx * r - fx * f;
      const pz = ph.z + rz * r - fz * f;
      const rearWheel = i < 2;
      const active = marking && (rearWheel || handbrake);
      if (active) {
        const gy = world.queryGround(px, pz).y;
        // ширина следа — поперёк вектора скорости
        const vl = Math.hypot(ph.vx, ph.vz) || 1;
        const pxv = -ph.vz / vl;
        const pzv = ph.vx / vl;
        this.skid.add(i, px, gy, pz, pxv, pzv, intensity);
        if (rearWheel && Math.random() < intensity * 0.9) {
          this.smoke.emit(px, gy + 0.2, pz, -ph.vx * 0.15, -ph.vz * 0.15, 1.2 + intensity * 1.4);
        }
      } else {
        this.skid.lift(i);
      }
    }
    // Дым от пробуксовки на старте
    if (this.engineOn && inp.throttle > 0.8 && Math.abs(ph.speed) < 6 && ph.rpm > 0.5 && Math.random() < 0.35) {
      for (const r of [-tr, tr]) {
        const px = ph.x + rx * r - fx * half;
        const pz = ph.z + rz * r - fz * half;
        this.smoke.emit(px, world.queryGround(px, pz).y + 0.2, pz, -fx * 0.8, -fz * 0.8, 1.1, 1.1);
      }
    }
    this.skid.flush();
    this.smoke.update(dt, world.fog);
  }

  /** Мировая позиция сиденья водителя. */
  seatWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.model.seatAnchor.getWorldPosition(out);
    return out;
  }

  get neonColor(): number {
    return this.neonHex;
  }

  get tmp(): THREE.Vector3 {
    return this.tmpV;
  }
}
