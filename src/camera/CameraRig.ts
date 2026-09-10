import * as THREE from 'three';
import { CAMERA } from '@/config';
import { damp, clamp } from '@/world/noise';

export type CameraMode = 'intro' | 'walk' | 'chase' | 'showroom' | 'cinematic';

export interface CameraTarget {
  /** Персонаж */
  playerPos: THREE.Vector3;
  playerHeading: number;
  /** Машина */
  carPos: THREE.Vector3;
  carForward: THREE.Vector3;
  carRight: THREE.Vector3;
  carSpeed: number;
  carMaxSpeed: number;
  carYawRate: number;
  carSlip: number;
  carImpact: number;
  /** Высота земли под точкой (чтобы не проваливаться сквозь холм) */
  groundHeight: (x: number, z: number) => number;
}

/**
 * Одна камера, несколько режимов, плавные перелёты между ними.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'intro';
  chaseVariant = 0; // 0 — обычная, 1 — дальняя, 2 — капот
  /** Текущий yaw камеры (для управления персонажем относительно камеры). */
  yaw = 0;

  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private desiredPos = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();
  private fov = CAMERA.fov;
  private shakeAmt = 0;
  private time = 0;
  private walkYaw = 0;
  private cinFrom = new THREE.Vector3();
  private cinTo = new THREE.Vector3();
  private cinLookFrom = new THREE.Vector3();
  private cinLookTo = new THREE.Vector3();
  private cinT = 0;
  private cinDur = 1;
  private orbitAngle = 0;
  private snapNext = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
  }

  setMode(mode: CameraMode, snap = false): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.snapNext = snap;
  }

  nextChaseVariant(): void {
    this.chaseVariant = (this.chaseVariant + 1) % 3;
  }

  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  /** Кинематографический пролёт между двумя точками. */
  cinematic(from: THREE.Vector3, to: THREE.Vector3, lookFrom: THREE.Vector3, lookTo: THREE.Vector3, duration: number): void {
    this.mode = 'cinematic';
    this.cinFrom.copy(from);
    this.cinTo.copy(to);
    this.cinLookFrom.copy(lookFrom);
    this.cinLookTo.copy(lookTo);
    this.cinT = 0;
    this.cinDur = Math.max(0.01, duration);
    this.snapNext = true;
  }

  update(dt: number, t: CameraTarget): void {
    this.time += dt;
    let posLambda = 6;
    let lookLambda = 12;
    let fovT = CAMERA.fov;

    switch (this.mode) {
      case 'intro': {
        this.orbitAngle += dt * 0.12;
        const r = 9.5;
        this.desiredPos.set(
          t.carPos.x + Math.sin(this.orbitAngle) * r,
          t.carPos.y + 2.2 + Math.sin(this.orbitAngle * 0.7) * 0.6,
          t.carPos.z + Math.cos(this.orbitAngle) * r,
        );
        this.desiredLook.set(t.carPos.x, t.carPos.y + 0.8, t.carPos.z);
        posLambda = 3;
        fovT = 48;
        break;
      }
      case 'walk': {
        // Камера сзади персонажа, yaw догоняет направление взгляда
        this.walkYaw = dampAngle(this.walkYaw, t.playerHeading, 2.2, dt);
        const back = 4.4;
        const bx = -Math.sin(this.walkYaw);
        const bz = -Math.cos(this.walkYaw);
        this.desiredPos.set(t.playerPos.x - bx * back, t.playerPos.y + 2.1, t.playerPos.z - bz * back);
        const gh = t.groundHeight(this.desiredPos.x, this.desiredPos.z);
        this.desiredPos.y = Math.max(this.desiredPos.y, gh + 0.9);
        this.desiredLook.set(t.playerPos.x + bx * 1.5, t.playerPos.y + 1.35, t.playerPos.z + bz * 1.5);
        posLambda = 5;
        fovT = 58;
        break;
      }
      case 'chase': {
        const speedN = clamp(Math.abs(t.carSpeed) / t.carMaxSpeed, 0, 1);
        const variants = [
          { back: 6.6, up: 2.5, ahead: 4.5, lookUp: 0.9 },
          { back: 9.5, up: 3.6, ahead: 6, lookUp: 1.0 },
          { back: -0.2, up: 1.05, ahead: 12, lookUp: 0.7 },
        ];
        const v = variants[this.chaseVariant];
        const back = v.back + speedN * 1.6;
        // Камера смотрит чуть в сторону заноса — видно, как машина едет боком
        const drift = clamp(t.carSlip * 0.9, -0.55, 0.55);
        const fx = t.carForward.x;
        const fz = t.carForward.z;
        const rx = t.carRight.x;
        const rz = t.carRight.z;
        const dirX = fx * Math.cos(drift) + rx * Math.sin(drift);
        const dirZ = fz * Math.cos(drift) + rz * Math.sin(drift);
        this.desiredPos.set(t.carPos.x - dirX * back, t.carPos.y + v.up, t.carPos.z - dirZ * back);
        if (this.chaseVariant !== 2) {
          const gh = t.groundHeight(this.desiredPos.x, this.desiredPos.z);
          this.desiredPos.y = Math.max(this.desiredPos.y, gh + 1.2);
        }
        this.desiredLook.set(t.carPos.x + fx * v.ahead, t.carPos.y + v.lookUp, t.carPos.z + fz * v.ahead);
        posLambda = this.chaseVariant === 2 ? 40 : 7 + speedN * 3;
        lookLambda = this.chaseVariant === 2 ? 40 : 14;
        fovT = CAMERA.fov + speedN * 14;
        if (Math.abs(t.carSpeed) < 0.3) fovT = CAMERA.fov;
        break;
      }
      case 'showroom': {
        this.orbitAngle += dt * 0.25;
        const r = 6.2;
        this.desiredPos.set(
          t.carPos.x + Math.sin(this.orbitAngle) * r,
          t.carPos.y + 1.7,
          t.carPos.z + Math.cos(this.orbitAngle) * r,
        );
        this.desiredLook.set(t.carPos.x, t.carPos.y + 0.7, t.carPos.z);
        posLambda = 2.5;
        fovT = 46;
        break;
      }
      case 'cinematic': {
        this.cinT = Math.min(1, this.cinT + dt / this.cinDur);
        const e = easeInOut(this.cinT);
        this.desiredPos.copy(this.cinFrom).lerp(this.cinTo, e);
        this.desiredLook.copy(this.cinLookFrom).lerp(this.cinLookTo, e);
        posLambda = 30;
        lookLambda = 30;
        fovT = 50;
        break;
      }
    }

    if (this.snapNext) {
      this.pos.copy(this.desiredPos);
      this.look.copy(this.desiredLook);
      this.snapNext = false;
    } else {
      const k1 = 1 - Math.exp(-posLambda * dt);
      const k2 = 1 - Math.exp(-lookLambda * dt);
      this.pos.lerp(this.desiredPos, k1);
      this.look.lerp(this.desiredLook, k2);
    }

    // Тряска
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    const sh = this.shakeAmt * 0.25 + t.carImpact * 0.35;
    const ox = sh * (Math.sin(this.time * 41) + Math.sin(this.time * 23.7)) * 0.5;
    const oy = sh * (Math.sin(this.time * 37.3) + Math.sin(this.time * 29.1)) * 0.5;

    this.camera.position.set(this.pos.x + ox, this.pos.y + oy, this.pos.z);
    this.camera.lookAt(this.look);
    this.fov = damp(this.fov, fovT, 4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    // yaw камеры по направлению взгляда (для управления персонажем)
    const dx = this.look.x - this.pos.x;
    const dz = this.look.z - this.pos.z;
    this.yaw = Math.atan2(-dx, -dz);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

function dampAngle(a: number, b: number, lambda: number, dt: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-lambda * dt));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
