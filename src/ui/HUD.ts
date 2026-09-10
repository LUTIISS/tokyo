import { formatYen } from '@/core/GameState';

export type ToastKind = 'info' | 'warn' | 'good';

/**
 * Игровой интерфейс поверх 3D: иены, спидометр, дрифт, трек, подсказки, тосты, название локации.
 */
export class HUD {
  readonly root: HTMLElement;
  private yenValue: HTMLElement;
  private yenDelta: HTMLElement;
  private questDot: HTMLElement;
  private questText: HTMLElement;
  private trackTitle: HTMLElement;
  private trackNote: HTMLElement;
  private speedValue: HTMLElement;
  private gear: HTMLElement;
  private rpmBar: HTMLElement;
  private nitroWrap: HTMLElement;
  private nitroBar: HTMLElement;
  private drift: HTMLElement;
  private driftScore: HTMLElement;
  private driftCombo: HTMLElement;
  private prompt: HTMLElement;
  private promptKey: HTMLElement;
  private promptText: HTMLElement;
  private toasts: HTMLElement;
  private help: HTMLElement;
  private bossBar: HTMLElement;
  private bossFill: HTMLElement;
  private bossHint: HTMLElement;
  private location: HTMLElement;
  private locationJp: HTMLElement;
  private locationRu: HTMLElement;
  private locationTimer = 0;
  private lastYen = 0;
  private lastSpeed = -1;

  constructor(parent: HTMLElement) {
    this.root = el('div', { id: 'hud' });
    this.root.innerHTML = `
      <div class="vignette"></div>
      <div class="hud-corner tl">
        <div class="panel yen-panel">
          <span class="yen-kanji">円</span>
          <span class="yen-value">¥0</span>
          <span class="yen-delta"></span>
        </div>
        <div class="panel quest-line"><span class="dot"></span><span class="quest-text">—</span></div>
      </div>
      <div class="hud-corner tr">
        <div class="panel track-panel">
          <div class="track-note">♪ сейчас играет</div>
          <div class="track-title">—</div>
          <div class="track-hint"><kbd>N</kbd> следующий трек · <kbd>M</kbd> звук</div>
        </div>
      </div>
      <div class="hud-corner bl">
        <div class="panel help-panel"></div>
      </div>
      <div class="hud-corner br">
        <div class="panel speed-panel">
          <div class="speed-wrap">
            <div style="display:flex;align-items:flex-end;gap:14px">
              <div class="speed-value">0</div>
              <div class="speed-unit">км/ч</div>
              <div class="gear">N</div>
            </div>
            <div class="rpm"><i></i></div>
            <div class="nitro hidden"><span>NITRO</span><div class="rpm nitro-bar"><i></i></div></div>
          </div>
        </div>
      </div>
      <div class="drift-panel">
        <div class="drift-label">DRIFT<small>ドリフト</small></div>
        <div class="drift-score">0</div>
        <div class="drift-combo">×1.0</div>
      </div>
      <div class="bossbar hidden">
        <div class="boss-name">ВАИСОВ<small>拠点のボス</small></div>
        <div class="boss-track"><i></i></div>
        <div class="boss-hint"></div>
      </div>
      <div class="prompt panel"><kbd>E</kbd><span class="prompt-text"></span></div>
      <div class="toasts"></div>
      <div class="location"><div class="jp"></div><div class="ru"></div></div>
    `;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.yenValue = q('.yen-value');
    this.yenDelta = q('.yen-delta');
    this.questDot = q('.quest-line .dot');
    this.questText = q('.quest-text');
    this.trackTitle = q('.track-title');
    this.trackNote = q('.track-note');
    this.speedValue = q('.speed-value');
    this.gear = q('.gear');
    this.rpmBar = q('.rpm > i');
    this.nitroWrap = q('.nitro');
    this.nitroBar = q('.nitro-bar > i');
    this.drift = q('.drift-panel');
    this.driftScore = q('.drift-score');
    this.driftCombo = q('.drift-combo');
    this.prompt = q('.prompt');
    this.promptKey = q('.prompt kbd');
    this.promptText = q('.prompt-text');
    this.toasts = q('.toasts');
    this.help = q('.help-panel');
    this.bossBar = q('.bossbar');
    this.bossFill = q('.boss-track > i');
    this.bossHint = q('.boss-hint');
    this.location = q('.location');
    this.locationJp = q('.location .jp');
    this.locationRu = q('.location .ru');
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('visible', v);
  }

  /** Вставить элемент в левый нижний угол (мини-карта — над подсказками). */
  mountBottomLeft(el: HTMLElement): void {
    const corner = this.root.querySelector('.hud-corner.bl') as HTMLElement;
    corner.insertBefore(el, corner.firstChild);
  }

  setHelpVisible(v: boolean): void {
    this.help.classList.toggle('hidden', !v);
  }

  /** Полоса здоровья босса. hp/max в долях; hint — подсказка под полосой. */
  setBoss(visible: boolean, hp = 1, max = 1, hint = ''): void {
    this.bossBar.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.bossFill.style.width = `${Math.max(0, (hp / max) * 100)}%`;
    this.bossHint.innerHTML = hint;
  }

  setYen(n: number): void {
    if (n !== this.lastYen) {
      const delta = n - this.lastYen;
      if (this.lastYen !== 0 || n !== 0) this.popYen(delta);
      this.lastYen = n;
    }
    this.yenValue.textContent = formatYen(n);
  }

  private popYen(delta: number): void {
    if (delta === 0) return;
    this.yenDelta.textContent = (delta > 0 ? '+' : '−') + formatYen(Math.abs(delta));
    this.yenDelta.style.color = delta > 0 ? 'var(--neon-yellow)' : 'var(--neon-pink)';
    this.yenDelta.classList.remove('pop');
    void this.yenDelta.offsetWidth;
    this.yenDelta.classList.add('pop');
  }

  setQuestLine(text: string, done: boolean): void {
    this.questText.innerHTML = text;
    this.questDot.classList.toggle('done', done);
  }

  setTrack(title: string | null, finale = false): void {
    this.trackNote.textContent = finale ? '♪ финальная тема' : '♪ сейчас играет';
    this.trackTitle.textContent = title ?? 'Треков нет — положи mp3 в public/audio/tracks/';
    this.trackTitle.style.opacity = title ? '1' : '0.55';
  }

  setSpeed(kmh: number, gear: number, rpm: number, reverse: boolean): void {
    const v = Math.round(kmh);
    if (v !== this.lastSpeed) {
      this.speedValue.textContent = String(v);
      this.lastSpeed = v;
    }
    this.gear.textContent = reverse ? 'R' : v < 1 ? 'N' : String(gear);
    this.rpmBar.style.width = `${Math.round(rpm * 100)}%`;
  }

  setNitro(charge: number | null): void {
    if (charge === null) {
      this.nitroWrap.classList.add('hidden');
      return;
    }
    this.nitroWrap.classList.remove('hidden');
    this.nitroBar.style.width = `${Math.round(charge * 100)}%`;
  }

  setDrift(active: boolean, score: number, combo: number): void {
    this.drift.classList.toggle('active', active);
    if (active) {
      this.driftScore.textContent = Math.floor(score).toLocaleString('ru-RU');
      this.driftCombo.textContent = `×${combo.toFixed(1)}`;
    }
  }

  setPrompt(text: string | null, key = 'E'): void {
    if (!text) {
      this.prompt.classList.remove('visible');
      return;
    }
    this.promptKey.textContent = key;
    this.promptText.textContent = text;
    this.prompt.classList.add('visible');
  }

  toast(message: string, kind: ToastKind = 'info', ms = 2800): void {
    const t = el('div', { className: `panel toast ${kind}` });
    t.innerHTML = message;
    this.toasts.appendChild(t);
    setTimeout(() => {
      t.classList.add('leave');
      setTimeout(() => t.remove(), 380);
    }, ms);
  }

  showLocation(jp: string, ru: string): void {
    this.locationJp.textContent = jp;
    this.locationRu.textContent = ru;
    this.location.classList.add('visible');
    this.locationTimer = 3.2;
  }

  setHelp(rows: Array<[string, string]>): void {
    this.help.innerHTML =
      `<div class="title">Управление</div>` +
      rows.map(([k, a]) => `<div class="row"><span>${a}</span><span>${k}</span></div>`).join('');
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }

  update(dt: number): void {
    if (this.locationTimer > 0) {
      this.locationTimer -= dt;
      if (this.locationTimer <= 0) this.location.classList.remove('visible');
    }
  }
}

function el(tag: string, props: Partial<HTMLElement> & { className?: string } = {}): HTMLElement {
  const e = document.createElement(tag);
  Object.assign(e, props);
  return e;
}
