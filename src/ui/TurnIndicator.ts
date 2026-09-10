import type { Track } from '@/world/Track';

export type TurnKind = 'straight' | 'left' | 'right' | 'hairpin-left' | 'hairpin-right';

export interface TurnInfo {
  kind: TurnKind;
  /** Расстояние до начала поворота (м). */
  distance: number;
  /** Крутизна 0..1. */
  severity: number;
}

const LABEL: Record<TurnKind, string> = {
  straight: 'прямо',
  left: 'налево',
  right: 'направо',
  'hairpin-left': 'шпилька влево',
  'hairpin-right': 'шпилька вправо',
};

/**
 * Стрелка следующего поворота: смотрит вперёд по трассе, находит ближайший участок
 * со значимой кривизной и показывает, куда крутить и через сколько метров.
 */
export class TurnIndicator {
  readonly root: HTMLElement;
  private arrow: HTMLElement;
  private dist: HTMLElement;
  private label: HTMLElement;
  private current: TurnKind = 'straight';

  constructor(parent: HTMLElement, private track: Track) {
    this.root = document.createElement('div');
    this.root.className = 'turnhint';
    this.root.innerHTML = `<svg class="turn-arrow" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 92 L50 46 Q50 28 68 28 L84 28 M84 28 L70 14 M84 28 L70 42" /></svg><div class="turn-text"><div class="turn-dist"></div><div class="turn-label"></div></div>`;
    this.arrow = this.root.querySelector('.turn-arrow')!;
    this.dist = this.root.querySelector('.turn-dist')!;
    this.label = this.root.querySelector('.turn-label')!;
    parent.appendChild(this.root);
  }

  /**
   * Ищет поворот впереди. forward — едем ли по направлению трассы.
   */
  lookAhead(x: number, z: number, forward: boolean, lookMeters = 220): TurnInfo {
    const near = this.track.nearest(x, z);
    const samples = this.track.samples;
    const n = samples.length;
    const stepLen = this.track.length / n;
    const steps = Math.max(1, Math.round(lookMeters / stepLen));
    const dir = forward ? 1 : -1;

    // Сглаженная кривизна по ходу движения; знак приводим к «право = +»
    let best = 0;
    let bestAt = -1;
    let firstAt = -1;
    let firstCurv = 0;
    for (let k = 3; k < steps; k++) {
      const idx = (((near.index + dir * k) % n) + n) % n;
      const c = samples[idx].curvature * dir;
      const a = Math.abs(c);
      if (a > 0.006 && firstAt < 0) {
        firstAt = k;
        firstCurv = c;
      }
      if (a > Math.abs(best)) {
        best = c;
        bestAt = k;
      }
    }

    if (firstAt < 0 || Math.abs(best) < 0.006) {
      return { kind: 'straight', distance: 0, severity: 0 };
    }
    // Расстояние — до начала поворота, крутизна — по самому крутому месту в нём
    const distance = firstAt * stepLen;
    const severity = Math.min(1, Math.abs(best) / 0.045);
    const right = (Math.abs(best) > 0.006 ? best : firstCurv) > 0;
    const hairpin = Math.abs(best) > 0.028;
    const kind: TurnKind = hairpin ? (right ? 'hairpin-right' : 'hairpin-left') : right ? 'right' : 'left';
    void bestAt;
    return { kind, distance, severity };
  }

  update(info: TurnInfo, visible: boolean): void {
    if (!visible || info.kind === 'straight' || info.distance > 200) {
      this.root.classList.remove('visible');
      return;
    }
    this.root.classList.add('visible');
    const left = info.kind === 'left' || info.kind === 'hairpin-left';
    const hairpin = info.kind.startsWith('hairpin');
    if (info.kind !== this.current) {
      this.current = info.kind;
      this.arrow.classList.toggle('flip', left);
      this.arrow.classList.toggle('hairpin', hairpin);
      this.label.textContent = LABEL[info.kind];
    }
    // Близко — стрелка ярче и крупнее
    const near = info.distance < 60;
    this.root.classList.toggle('near', near);
    this.dist.textContent = info.distance < 25 ? 'сейчас' : `${Math.round(info.distance / 10) * 10} м`;
  }
}
