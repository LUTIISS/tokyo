import * as THREE from 'three';
import { damp } from '@/world/noise';

/**
 * Флюгегехаймен — главный апгрейд.
 *
 * Чёрная продолговатая штука, которая выезжает из капота и очень быстро ходит
 * вперёд-назад, как поршень. Именно ей мы и въезжаем в Ваисова.
 *
 * Локальные оси машины: нос = -Z, поэтому «вперёд» для штока — это -Z.
 */
export const FLUEGEL_REACH = 3.4; // насколько далеко от носа достаёт кончик (м)

export class Fluegel {
  readonly group = new THREE.Group();
  /** 0 — убран в капот, 1 — полностью выехал наружу. */
  deployed = 0;
  /** 0..1 — фаза удара (1 = шток выброшен до упора). */
  stroke = 0;
  /** Включён ли режим долбёжки. */
  active = false;

  private rod: THREE.Group;
  private housing: THREE.Group;
  private tipMat: THREE.MeshStandardMaterial;
  private glow: THREE.PointLight;
  private phase = 0;
  /** Сколько полных ударов сделано и сколько из них уже засчитано. */
  private cycles = 0;
  private consumed = 0;

  constructor() {
    this.group.name = 'fluegel';
    this.group.visible = false;

    const black = new THREE.MeshStandardMaterial({ color: 0x0d0d10, metalness: 0.85, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a20, metalness: 0.7, roughness: 0.5 });

    // Корпус на капоте
    this.housing = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 1.5), dark);
    box.position.set(0, 0, 0.2);
    this.housing.add(box);
    for (const x of [-0.28, 0.28]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.7), black);
      rail.position.set(x, 0.12, 0.1);
      this.housing.add(rail);
    }
    // Кожух-«гармошка» у выхода штока
    const bellows = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.4, 12), dark);
    bellows.rotation.x = Math.PI / 2;
    bellows.position.set(0, 0, -0.6);
    this.housing.add(bellows);
    this.group.add(this.housing);

    // Шток: длинная чёрная штука с гранёным наконечником
    this.rod = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 2.4, 14), black);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0, -1.2);
    this.rod.add(shaft);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.025, 6, 16), dark);
      ring.position.set(0, 0, -0.5 - i * 0.6);
      this.rod.add(ring);
    }
    this.tipMat = new THREE.MeshStandardMaterial({
      color: 0x101014,
      metalness: 0.9,
      roughness: 0.25,
      emissive: new THREE.Color(0xff2d2d),
      emissiveIntensity: 0.2,
    });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 10), this.tipMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 0, -2.6);
    this.rod.add(tip);
    this.group.add(this.rod);

    this.glow = new THREE.PointLight(0xff3020, 0, 7, 2);
    this.glow.position.set(0, 0, -2.6);
    this.group.add(this.glow);
  }

  /** Ставит механизм на капот машины. */
  attachTo(carRoot: THREE.Object3D): void {
    this.group.position.set(0, 1.02, -1.5);
    carRoot.add(this.group);
  }

  setInstalled(installed: boolean): void {
    this.group.visible = installed;
  }

  get installed(): boolean {
    return this.group.visible;
  }

  /** Кончик штока в мировых координатах. */
  tipWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.group.updateWorldMatrix(true, false);
    out.set(0, 0, -2.85 - this.stroke * 1.5);
    return this.group.localToWorld(out);
  }

  /** Насколько далеко кончик от носа машины сейчас (м). */
  get currentReach(): number {
    return 1.35 + this.deployed * (0.6 + this.stroke * 1.5);
  }

  /** Максимальный вылет при текущей выдвинутости (м) — по нему считаем попадания. */
  get maxReach(): number {
    return 1.35 + this.deployed * 2.1;
  }

  /**
   * true ровно один раз на каждый полный удар штока.
   * Считаем по завершённым циклам, а не по мгновенной фазе: при низком FPS
   * момент полного выброса может прийтись между кадрами.
   */
  consumeStrike(): boolean {
    if (this.cycles > this.consumed) {
      this.consumed = this.cycles;
      return true;
    }
    return false;
  }

  update(dt: number, active: boolean): void {
    if (!this.installed) {
      this.deployed = 0;
      this.stroke = 0;
      this.active = false;
      return;
    }
    this.active = active;
    this.deployed = damp(this.deployed, active ? 1 : 0, 7, dt);

    if (active) {
      // Очень быстро: примерно 9 ударов в секунду
      this.phase += dt * Math.PI * 2 * 9;
      this.cycles = Math.floor(this.phase / (Math.PI * 2));
      this.stroke = (1 - Math.cos(this.phase)) * 0.5;
    } else {
      this.phase = 0;
      this.cycles = 0;
      this.consumed = 0;
      this.stroke = damp(this.stroke, 0, 10, dt);
    }

    // Корпус приподнимается из капота
    this.housing.position.y = -0.28 + this.deployed * 0.28;
    this.housing.scale.z = 0.6 + this.deployed * 0.4;
    // Шток выезжает
    this.rod.position.z = -this.deployed * (0.4 + this.stroke * 1.5);
    this.rod.visible = this.deployed > 0.02;

    const heat = this.deployed * (0.25 + this.stroke * 2.2);
    this.tipMat.emissiveIntensity = heat;
    this.glow.intensity = heat * 12;
    this.glow.position.z = -2.6 - this.stroke * 1.5;
  }
}
