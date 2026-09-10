/**
 * Клавиатура. Используем event.code, чтобы WASD работали и в русской раскладке.
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();

  /** Пока true — игра не реагирует на клавиши (открыт оверлей и т.п.). */
  public captured = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Не даём странице скроллиться стрелками/пробелом.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    target.addEventListener('blur', () => {
      this.down.clear();
    });
  }

  isDown(code: string): boolean {
    return !this.captured && this.down.has(code);
  }

  /** Нажата в этом кадре. */
  justPressed(code: string): boolean {
    return !this.captured && this.pressed.has(code);
  }

  /** Как justPressed, но игнорирует captured (для закрытия меню по Esc). */
  justPressedRaw(code: string): boolean {
    return this.pressed.has(code);
  }

  any(...codes: string[]): boolean {
    return codes.some((c) => this.isDown(c));
  }

  // ── Оси ──────────────────────────────────────────────────────────────────
  get steer(): number {
    let s = 0;
    if (this.any('KeyA', 'ArrowLeft')) s -= 1;
    if (this.any('KeyD', 'ArrowRight')) s += 1;
    return s;
  }
  get throttle(): number {
    return this.any('KeyW', 'ArrowUp') ? 1 : 0;
  }
  get brake(): number {
    return this.any('KeyS', 'ArrowDown') ? 1 : 0;
  }
  get handbrake(): boolean {
    return this.isDown('Space');
  }
  get run(): boolean {
    return this.any('ShiftLeft', 'ShiftRight');
  }
  get moveX(): number {
    return this.steer;
  }
  get moveY(): number {
    return this.throttle - this.brake;
  }
  get interact(): boolean {
    return this.justPressed('KeyE');
  }

  /** Вызывать в конце кадра. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
  }
}
