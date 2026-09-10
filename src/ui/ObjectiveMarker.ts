import * as THREE from 'three';

/**
 * Маркер цели на экране: висит над объектом, а если цель вне кадра — прижимается к краю
 * экрана стрелкой в её сторону. Рядом — расстояние по дороге.
 */
export class ObjectiveMarker {
  readonly el: HTMLElement;
  private pin: HTMLElement;
  private dist: HTMLElement;
  private arrow: HTMLElement;
  private tmp = new THREE.Vector3();
  private camSpace = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'objective hidden';
    this.el.innerHTML = `<div class="obj-arrow">▲</div><div class="obj-pin"><span class="obj-glyph"></span></div><div class="obj-dist"></div>`;
    this.pin = this.el.querySelector('.obj-pin')!;
    this.dist = this.el.querySelector('.obj-dist')!;
    this.arrow = this.el.querySelector('.obj-arrow')!;
    parent.appendChild(this.el);
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  update(
    camera: THREE.PerspectiveCamera,
    world: THREE.Vector3 | null,
    glyph: string,
    color: string,
    distanceText: string,
    width: number,
    height: number,
  ): void {
    if (!world) {
      this.hide();
      return;
    }
    this.el.classList.remove('hidden');
    (this.pin.firstElementChild as HTMLElement).textContent = glyph;
    this.pin.style.borderColor = color;
    this.pin.style.boxShadow = `0 0 18px ${color}`;
    this.arrow.style.color = color;
    this.dist.textContent = distanceText;

    // В пространство камеры: z < 0 — перед камерой
    this.camSpace.copy(world).applyMatrix4(camera.matrixWorldInverse);
    const inFront = this.camSpace.z < 0;
    this.tmp.copy(world).project(camera);
    let sx = ((this.tmp.x + 1) / 2) * width;
    let sy = ((1 - this.tmp.y) / 2) * height;
    const margin = 56;
    const onScreen = inFront && sx > margin && sx < width - margin && sy > margin && sy < height - margin;

    if (!onScreen) {
      // Направление от центра экрана к цели (для точек сзади — инвертируем)
      let dx = sx - width / 2;
      let dy = sy - height / 2;
      if (!inFront) {
        dx = -dx;
        dy = -dy;
      }
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      // Прижать к прямоугольнику с полями
      const hw = width / 2 - margin;
      const hh = height / 2 - margin;
      const t = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
      sx = width / 2 + dx * t;
      sy = height / 2 + dy * t;
      this.el.classList.add('edge');
      this.arrow.style.transform = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI + 90}deg)`;
    } else {
      this.el.classList.remove('edge');
    }
    this.el.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) translate(-50%, -100%)`;
  }
}
