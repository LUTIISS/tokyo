/**
 * Полноэкранные оверлеи: интро, диалоги (квест, босс), пауза, затемнение, субтитры, финал.
 */
export interface DialogAction {
  label: string;
  primary?: boolean;
  /** Код клавиши, которая нажимает кнопку (Enter — для primary по умолчанию). */
  key?: string;
  disabled?: boolean;
  onClick: () => void;
}

export interface DialogOpts {
  kicker?: string;
  title: string;
  body: string;
  actions: DialogAction[];
  closeOnEsc?: boolean;
  onClose?: () => void;
}

export class Overlays {
  private fadeEl: HTMLElement;
  private introEl: HTMLElement | null = null;
  private dialogEl: HTMLElement | null = null;
  private dialogKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private subtitleEl: HTMLElement;
  private finaleEl: HTMLElement | null = null;
  private barsEl: HTMLElement;

  constructor(private root: HTMLElement) {
    this.fadeEl = document.createElement('div');
    this.fadeEl.id = 'fade';
    root.appendChild(this.fadeEl);
    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'subtitle';
    root.appendChild(this.subtitleEl);
    this.barsEl = document.createElement('div');
    this.barsEl.className = 'cutscene-bars hidden';
    this.barsEl.style.position = 'absolute';
    this.barsEl.style.inset = '0';
    this.barsEl.style.pointerEvents = 'none';
    root.appendChild(this.barsEl);
  }

  get dialogOpen(): boolean {
    return this.dialogEl !== null;
  }

  // ── Интро ──────────────────────────────────────────────────────────────
  showIntro(onStart: () => void): void {
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `
      <div class="intro">
        <div class="intro-kicker">東京 · ナイトドリフト</div>
        <div class="intro-title">TOKYO NIGHT DRIFT</div>
        <div class="intro-sub">Toyota Mark II · неон · сакура · один босс</div>
        <div class="intro-cta loading">СТРОИМ ТОКИО…</div>
        <div class="intro-controls">
          <div><span>Ходить / ехать</span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></div>
          <div><span>Ручник (дрифт)</span><span><kbd>Space</kbd></span></div>
          <div><span>Сесть / действие</span><span><kbd>E</kbd></span></div>
          <div><span>Бег / нитро</span><span><kbd>Shift</kbd></span></div>
          <div><span>Камера</span><span><kbd>C</kbd></span></div>
          <div><span>Карта</span><span><kbd>Tab</kbd></span></div>
          <div><span>Поставить на трассу</span><span><kbd>R</kbd></span></div>
          <div><span>Следующий трек / звук</span><span><kbd>N</kbd> <kbd>M</kbd></span></div>
          <div><span>Пауза / помощь</span><span><kbd>Esc</kbd> <kbd>H</kbd></span></div>
        </div>
        <div class="intro-note">Музыка и мемы: положи файлы в public/audio и public/media — подробности в README.</div>
      </div>`;
    this.root.appendChild(el);
    this.introEl = el;
    let ready = false;
    el.addEventListener('click', () => {
      if (!ready) return;
      onStart();
    });
    (el as HTMLElement & { _setReady?: () => void })._setReady = () => {
      ready = true;
    };
  }

  setIntroStatus(text: string, ready = false): void {
    if (!this.introEl) return;
    const cta = this.introEl.querySelector('.intro-cta') as HTMLElement | null;
    if (cta) {
      cta.textContent = text;
      cta.classList.toggle('loading', !ready);
    }
    if (ready) (this.introEl as HTMLElement & { _setReady?: () => void })._setReady?.();
  }

  hideIntro(): void {
    if (!this.introEl) return;
    const el = this.introEl;
    this.introEl = null;
    el.style.transition = 'opacity 0.7s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 750);
  }

  // ── Диалог ─────────────────────────────────────────────────────────────
  showDialog(opts: DialogOpts): void {
    this.closeDialog();
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `
      <div class="dialog">
        ${opts.kicker ? `<div class="dialog-kicker">${opts.kicker}</div>` : ''}
        <div class="dialog-title">${opts.title}</div>
        <div class="dialog-body">${opts.body}</div>
        <div class="dialog-actions"></div>
      </div>`;
    const actions = el.querySelector('.dialog-actions')!;
    opts.actions.forEach((a) => {
      const b = document.createElement('button');
      b.className = `btn ${a.primary ? 'primary' : 'ghost'}`;
      b.disabled = !!a.disabled;
      const keyLabel = a.key ? a.key.replace('Key', '').replace('Enter', '⏎').replace('Escape', 'Esc') : a.primary ? '⏎' : '';
      b.innerHTML = `${keyLabel ? `<kbd>${keyLabel}</kbd>` : ''}${a.label}`;
      b.addEventListener('click', () => a.onClick());
      actions.appendChild(b);
    });
    this.root.appendChild(el);
    this.dialogEl = el;

    this.dialogKeyHandler = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && opts.closeOnEsc !== false) {
        e.preventDefault();
        opts.onClose?.();
        this.closeDialog();
        return;
      }
      for (const a of opts.actions) {
        const key = a.key ?? (a.primary ? 'Enter' : null);
        if (key && e.code === key && !a.disabled) {
          e.preventDefault();
          a.onClick();
          return;
        }
      }
    };
    window.addEventListener('keydown', this.dialogKeyHandler);
  }

  closeDialog(): void {
    if (this.dialogKeyHandler) {
      window.removeEventListener('keydown', this.dialogKeyHandler);
      this.dialogKeyHandler = null;
    }
    if (this.dialogEl) {
      this.dialogEl.remove();
      this.dialogEl = null;
    }
  }

  // ── Затемнение ─────────────────────────────────────────────────────────
  fade(opacity: number, ms = 800): Promise<void> {
    this.fadeEl.style.transition = `opacity ${ms}ms ease`;
    this.fadeEl.style.opacity = String(opacity);
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── Субтитры и рамки ───────────────────────────────────────────────────
  subtitle(text: string | null, who?: string): void {
    if (!text) {
      this.subtitleEl.classList.remove('visible');
      return;
    }
    this.subtitleEl.innerHTML = `${who ? `<span class="who">${who}</span>` : ''}${text}`;
    this.subtitleEl.classList.add('visible');
  }

  cutsceneBars(on: boolean): void {
    this.barsEl.classList.toggle('hidden', !on);
  }

  // ── Финал ──────────────────────────────────────────────────────────────
  showFinale(title: string, sub: string): void {
    this.hideFinale();
    const el = document.createElement('div');
    el.className = 'overlay';
    el.style.background = 'transparent';
    el.style.backdropFilter = 'none';
    el.style.pointerEvents = 'none';
    el.innerHTML = `<div class="finale"><div class="finale-title">${title}</div><div class="finale-sub">${sub}</div></div>`;
    this.root.appendChild(el);
    this.finaleEl = el;
  }

  hideFinale(): void {
    if (!this.finaleEl) return;
    const el = this.finaleEl;
    this.finaleEl = null;
    el.style.transition = 'opacity 1.2s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 1300);
  }
}
