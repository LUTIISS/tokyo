import { CAR } from '@/config';
import type { Colliders } from '@/world/Colliders';
import { clamp, damp, lerp } from '@/world/noise';

export interface CarParams {
  accel: number;
  maxSpeed: number;
  maxReverse: number;
  brakeDecel: number;
  drag: number;
  rolling: number;
  steerMax: number;
  steerSpeed: number;
  grip: number;
  handbrakeGrip: number;
  driftGrip: number;
  driftAngle: number;
  yawResponse: number;
  driftYawBoost: number;
  /** Предел бокового ускорения на сцеплении (м/с²) — «круг трения». */
  latAccelMax: number;
  /** Максимальная угловая скорость в скольжении (рад/с). */
  driftYawMax: number;
  wheelbase: number;
  offroadGrip: number;
  offroadSpeedFactor: number;
  /** Есть ли нитро (большой апгрейд). */
  nitro: boolean;
}

export function baseParams(): CarParams {
  return {
    accel: CAR.accel,
    maxSpeed: CAR.maxSpeed,
    maxReverse: CAR.maxReverse,
    brakeDecel: CAR.brakeDecel,
    drag: CAR.drag,
    rolling: CAR.rolling,
    steerMax: CAR.steerMax,
    steerSpeed: CAR.steerSpeed,
    grip: CAR.grip,
    handbrakeGrip: CAR.handbrakeGrip,
    driftGrip: CAR.driftGrip,
    driftAngle: CAR.driftAngle,
    yawResponse: CAR.yawResponse,
    driftYawBoost: CAR.driftYawBoost,
    latAccelMax: CAR.latAccelMax,
    driftYawMax: CAR.driftYawMax,
    wheelbase: CAR.wheelbase,
    offroadGrip: CAR.offroadGrip,
    offroadSpeedFactor: CAR.offroadSpeedFactor,
    nitro: false,
  };
}

export interface CarInput {
  throttle: number;
  brake: number;
  /** -1 — влево, +1 — вправо. */
  steer: number;
  handbrake: boolean;
  nitro: boolean;
}

export const IDLE_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };

/** Что мир знает о точке под машиной. */
export interface GroundQuery {
  y: number;
  onRoad: boolean;
  /** Боковое смещение от оси дороги (+ вправо по ходу трассы). */
  lateral: number;
  halfWidth: number;
  /** Есть ли отбойники (тогэ, мост) — тогда с дороги не съехать. */
  rails: boolean;
  /** Нормаль дороги вправо. */
  nx: number;
  nz: number;
}

/**
 * Аркадная физика. Скорость живёт в мировых координатах, курс — отдельно:
 * когда курс поворачивается быстрее, чем шины успевают развернуть скорость, появляется занос.
 * На сцеплении боковое ускорение ограничено «кругом трения», в скольжении машина крутится свободнее,
 * газ с рулём докручивают, контрруление и сброс руля — выравнивают.
 */
export class CarPhysics {
  x = 0;
  y = 0;
  z = 0;
  heading = 0;
  vx = 0;
  vz = 0;
  yawRate = 0;
  steerAngle = 0;

  /** Продольная скорость (м/с, со знаком). */
  speed = 0;
  /** Боковая скорость (м/с). */
  lateral = 0;
  /** Угол скольжения (рад, + — скорость правее носа). */
  slip = 0;
  /** Доля сцепления 0..1 (1 — полное). */
  gripFactor = 1;
  drifting = false;
  onRoad = true;
  scraping = false;

  /** Псевдо-обороты 0..1 и передача для звука/HUD. */
  rpm = 0;
  gear = 1;

  nitroCharge = 1;
  nitroActive = false;

  accelLong = 0;
  accelLat = 0;
  /** Сила последнего удара (для звука/тряски), гаснет сама. */
  impact = 0;

  driftScore = 0;
  driftCombo = 1;
  private driftHold = 0;
  onDriftEnd: ((score: number) => void) | null = null;

  /** Наклон кузова от рельефа (визуальный). */
  pitch = 0;
  roll = 0;

  reset(x: number, z: number, heading: number, y = 0): void {
    this.x = x;
    this.z = z;
    this.y = y;
    this.heading = heading;
    this.vx = this.vz = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.speed = 0;
    this.lateral = 0;
    this.slip = 0;
    this.pitch = 0;
    this.roll = 0;
    this.drifting = false;
    this.endDrift();
  }

  get forwardX(): number {
    return -Math.sin(this.heading);
  }
  get forwardZ(): number {
    return -Math.cos(this.heading);
  }
  get rightX(): number {
    return Math.cos(this.heading);
  }
  get rightZ(): number {
    return -Math.sin(this.heading);
  }
  get speedKmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  update(
    dt: number,
    input: CarInput,
    p: CarParams,
    ground: (x: number, z: number) => GroundQuery,
    colliders: Colliders,
  ): void {
    dt = Math.min(dt, 1 / 30);
    if (!(dt > 1e-5)) return; // первый кадр / пауза: нечего интегрировать (и никаких делений на ноль)

    // Старый (текущий) базис
    const fx = this.forwardX;
    const fz = this.forwardZ;
    const rx = this.rightX;
    const rz = this.rightZ;

    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;
    const absV = Math.abs(vF);
    const throttle = clamp(input.throttle, 0, 1);
    const brake = clamp(input.brake, 0, 1);

    // ── Руль ──
    const falloff = clamp(1 - (absV / p.maxSpeed) * 0.5, 0.4, 1);
    const steerTarget = -input.steer * p.steerMax * falloff;
    this.steerAngle = damp(this.steerAngle, steerTarget, p.steerSpeed, dt);

    // ── Покрытие ──
    const g0 = ground(this.x, this.z);
    this.onRoad = g0.onRoad;
    const offroad = !g0.onRoad;

    // ── Нитро ──
    this.nitroActive = false;
    if (p.nitro && input.nitro && this.nitroCharge > 0.02 && throttle > 0) {
      this.nitroActive = true;
      this.nitroCharge = Math.max(0, this.nitroCharge - dt / 4);
    } else {
      this.nitroCharge = Math.min(1, this.nitroCharge + dt / 9);
    }
    const nitroMul = this.nitroActive ? 1.9 : 1;
    const topMul = this.nitroActive ? 1.25 : 1;

    // ── Продольные силы ──
    const maxSpeed = p.maxSpeed * (offroad ? p.offroadSpeedFactor : 1) * topMul;
    let a = 0;
    if (throttle > 0) {
      if (vF >= -0.5) {
        const ratio = clamp(vF / maxSpeed, 0, 1);
        a += p.accel * nitroMul * throttle * (1 - ratio * ratio) * (offroad ? 0.7 : 1);
      } else {
        a += p.brakeDecel * 0.8; // едем назад, газ = тормоз
      }
    }
    if (brake > 0) {
      if (vF > 0.5) a -= p.brakeDecel * brake;
      else if (vF > -p.maxReverse) a -= p.accel * 0.55 * brake;
    }
    a -= p.drag * vF * absV;
    if (absV > 0.05) a -= Math.sign(vF) * p.rolling * (offroad ? 3 : 1);
    if (input.handbrake && absV > 0.05) a -= Math.sign(vF) * 6.5;

    const vFPrev = vF;
    vF += a * dt;
    if (throttle === 0 && brake === 0 && Math.sign(vF) !== Math.sign(vFPrev) && Math.abs(vFPrev) < 0.5) vF = 0;

    // ── Боковое сцепление ──
    this.slip = Math.atan2(vR, absV + 0.4);
    const absSlip = Math.abs(this.slip);
    let grip = p.grip;
    if (input.handbrake) grip *= p.handbrakeGrip;
    else if (absSlip > p.driftAngle && absV > 6) grip *= p.driftGrip;
    if (!input.handbrake && this.drifting && throttle > 0.5) grip *= 0.85;
    if (offroad) grip = Math.min(grip, p.offroadGrip);
    this.gripFactor = clamp(grip / p.grip, 0, 1);
    // Боковая сила шин ограничена: на сцеплении — кругом трения, в скольжении — трением скольжения.
    // Иначе занос сжигал бы скорость за секунду.
    const latCap = this.gripFactor > 0.9 ? p.latAccelMax * 1.05 : p.latAccelMax * 0.75;
    const latDecel = Math.min(Math.abs(vR) * grip, latCap) * dt;
    vR = Math.abs(vR) <= latDecel ? 0 : vR - Math.sign(vR) * latDecel;

    // ── Рысканье ──
    const kinRaw = (vF * Math.tan(this.steerAngle)) / p.wheelbase;
    const aMax = offroad ? p.latAccelMax * 0.55 : p.latAccelMax;
    const kinClamped = absV > 0.5 ? clamp(kinRaw, -aMax / absV, aMax / absV) : kinRaw;
    const free = clamp(kinRaw, -p.driftYawMax, p.driftYawMax);
    const sliding = 1 - this.gripFactor;
    const speedFactor = clamp(absV / 12, 0, 1);
    let target = lerp(free, kinClamped, this.gripFactor);
    // Восстанавливающий момент: в заносе машина стремится догнать вектор скорости (∝ slip²)
    target += -this.slip * absSlip * 1.4 * sliding * speedFactor;
    // Газ с рулём докручивают, пока угол не слишком большой
    const boostFade = clamp(1 - absSlip / 1.0, 0, 1);
    target += -input.steer * p.driftYawBoost * throttle * sliding * speedFactor * boostFade * Math.sign(vF || 1);
    const response = p.yawResponse * lerp(0.45, 1, this.gripFactor);
    this.yawRate = damp(this.yawRate, target, response, dt);
    this.heading += this.yawRate * dt;

    // ── Интеграция: скорость собираем в СТАРОМ базисе — в мире она не крутится вместе с носом ──
    this.vx = fx * vF + rx * vR;
    this.vz = fz * vF + rz * vR;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.accelLong = (vF - vFPrev) / dt;
    this.accelLat = vF * this.yawRate;

    // ── Отбойники ──
    const g = ground(this.x, this.z);
    this.scraping = false;
    if (g.rails) {
      const limit = g.halfWidth + 0.35;
      if (Math.abs(g.lateral) > limit) {
        const over = Math.abs(g.lateral) - limit;
        const sgn = Math.sign(g.lateral);
        this.x -= g.nx * over * sgn;
        this.z -= g.nz * over * sgn;
        const vn = this.vx * g.nx + this.vz * g.nz;
        if (vn * sgn > 0) {
          this.vx -= g.nx * vn * 1.25;
          this.vz -= g.nz * vn * 1.25;
          this.impact = Math.max(this.impact, Math.min(1, Math.abs(vn) / 12));
        }
        this.vx *= 0.985;
        this.vz *= 0.985;
        this.scraping = true;
        this.yawRate += -sgn * 6 * dt;
      }
    }

    // ── Здания ──
    const hit = colliders.resolveCircle(this.x, this.z, 1.15);
    if (hit.hit) {
      this.x = hit.x;
      this.z = hit.z;
      const vn = this.vx * hit.nx + this.vz * hit.nz;
      if (vn < 0) {
        this.vx -= hit.nx * vn * 1.35;
        this.vz -= hit.nz * vn * 1.35;
        this.impact = Math.max(this.impact, Math.min(1, -vn / 10));
      }
      this.vx *= 0.9;
      this.vz *= 0.9;
    }

    // ── Новый базис ──
    const nfx = -Math.sin(this.heading);
    const nfz = -Math.cos(this.heading);
    const nrx = Math.cos(this.heading);
    const nrz = -Math.sin(this.heading);
    this.speed = this.vx * nfx + this.vz * nfz;
    this.lateral = this.vx * nrx + this.vz * nrz;
    this.impact = Math.max(0, this.impact - dt * 2.5);

    // ── Высота и наклон ──
    const gy = ground(this.x, this.z).y;
    this.y = damp(this.y, gy, 18, dt);
    const half = p.wheelbase / 2;
    const yF = ground(this.x + nfx * half, this.z + nfz * half).y;
    const yB = ground(this.x - nfx * half, this.z - nfz * half).y;
    const yL = ground(this.x - nrx * 0.75, this.z - nrz * 0.75).y;
    const yR = ground(this.x + nrx * 0.75, this.z + nrz * 0.75).y;
    const pitchT = Math.atan2(yF - yB, p.wheelbase);
    const rollT = Math.atan2(yR - yL, 1.5);
    this.pitch = damp(this.pitch, pitchT, 10, dt);
    this.roll = damp(this.roll, rollT, 10, dt);

    // ── Дрифт-счёт ──
    const absSpeed = Math.abs(this.speed);
    const inDrift = Math.abs(this.slip) > p.driftAngle && absSpeed > 7;
    if (inDrift) {
      this.drifting = true;
      this.driftHold = 0.9;
      const gain = absSpeed * Math.min(Math.abs(this.slip), 1.2) * dt * 14 * this.driftCombo;
      this.driftScore += gain;
      this.driftCombo = Math.min(5, this.driftCombo + dt * 0.25);
    } else if (this.drifting) {
      this.driftHold -= dt;
      if (this.driftHold <= 0) this.endDrift();
    }
    if (this.impact > 0.6 && this.driftScore > 0) this.endDrift(true);

    // ── Псевдо-обороты ──
    const gearSpan = p.maxSpeed / 5.5;
    this.gear = Math.max(1, Math.min(6, 1 + Math.floor(absSpeed / gearSpan)));
    const frac = (absSpeed - (this.gear - 1) * gearSpan) / gearSpan;
    let rpmT = 0.15 + 0.8 * clamp(frac, 0, 1);
    if (absSpeed < 1) rpmT = 0.12 + 0.55 * throttle;
    else if (throttle < 0.1) rpmT *= 0.8;
    if (this.drifting && throttle > 0) rpmT = Math.max(rpmT, 0.85);
    this.rpm = damp(this.rpm, rpmT, 6, dt);
  }

  private endDrift(crash = false): void {
    if (this.driftScore > 0 && this.onDriftEnd) this.onDriftEnd(crash ? Math.floor(this.driftScore * 0.25) : Math.floor(this.driftScore));
    this.drifting = false;
    this.driftScore = 0;
    this.driftCombo = 1;
    this.driftHold = 0;
  }
}
