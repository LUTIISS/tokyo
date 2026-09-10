import { ECONOMY, NEON_COLORS } from '@/config';
import { formatYen, type GameState, type Upgrades } from '@/core/GameState';
import type { SfxName } from '@/audio/AudioManager';

type CatId = 'engine' | 'turbo' | 'tires' | 'aero' | 'neon' | 'big';

interface Option {
  value: number | boolean;
  name: string;
  desc: string;
  swatch?: number;
}

interface Cat {
  id: CatId;
  icon: string;
  label: string;
  sub: string;
  title: string;
  desc: string;
  key: keyof Upgrades | null;
  options: Option[];
}

const CATS: Cat[] = [
  {
    id: 'engine',
    icon: '機',
    label: 'Двигатель',
    sub: '1JZ-GTE',
    title: 'ДВИГАТЕЛЬ · エンジン',
    desc: 'Рядная шестёрка под капотом. Чем злее — тем быстрее разгон и выше максималка.',
    key: 'engine',
    options: [
      { value: 0, name: 'Сток 1JZ-GTE', desc: '280 л.с. — заводская честность.' },
      { value: 1, name: 'Стрит-тюн', desc: 'Прошивка, прямоток, интеркулер. Разгон +28%, максималка +12%.' },
      { value: 2, name: 'Полный фарш', desc: 'Кованые поршни, большой турбо, метанол. Разгон +60%, максималка +30%.' },
    ],
  },
  {
    id: 'turbo',
    icon: '渦',
    label: 'Турбина',
    sub: 'Хлопки в выхлоп',
    title: 'ТУРБО-КИТ · ターボ',
    desc: 'Больше давления — больше огня из выхлопа при сбросе газа.',
    key: 'turbo',
    options: [
      { value: false, name: 'Без турбо-кита', desc: 'Тихо и скромно.' },
      { value: true, name: 'Турбо-кит + blow-off', desc: 'Разгон +15%, максималка +6%, пламя из трубы.' },
    ],
  },
  {
    id: 'tires',
    icon: '輪',
    label: 'Шины',
    sub: 'Сцепление vs занос',
    title: 'ШИНЫ · タイヤ',
    desc: 'Главный выбор дрифтера: цепкие для тогэ или скользкие для красивых заносов.',
    key: 'tires',
    options: [
      { value: 0, name: 'Стрит', desc: 'Баланс. Едет и дрифтит без сюрпризов.' },
      { value: 1, name: 'Полуслики', desc: 'Сцепление +25%. Держит траекторию, срывается неохотно.' },
      { value: 2, name: 'Дрифт-резина', desc: 'Легко срывается, долго держит занос, ручник почти невесомый.' },
    ],
  },
  {
    id: 'aero',
    icon: '翼',
    label: 'Аэродинамика',
    sub: 'Спойлер',
    title: 'АЭРО · エアロ',
    desc: 'Прижимная сила и, главное, вид.',
    key: 'spoiler',
    options: [
      { value: false, name: 'Чистый багажник', desc: 'Классический силуэт Mark II.' },
      { value: true, name: 'Спойлер GT', desc: 'Сцепление +6%, руль острее. И он просто красивый.' },
    ],
  },
  {
    id: 'neon',
    icon: '光',
    label: 'Неон',
    sub: 'Подсветка днища',
    title: 'НЕОН · ネオン',
    desc: 'Цвет подсветки днища, полос по порогам и дыма из-под колёс.',
    key: 'neon',
    options: NEON_COLORS.map((c, i) => ({ value: i, name: c.name, desc: '#' + c.hex.toString(16).padStart(6, '0'), swatch: c.hex })),
  },
  {
    id: 'big',
    icon: '雷',
    label: 'Флюгегехаймен',
    sub: 'Главный апгрейд',
    title: 'ФЛЮГЕГЕХАЙМЕН · 雷',
    desc: '',
    key: 'bigUpgrade',
    options: [],
  },
];

export interface GarageCallbacks {
  onChange(): void;
  onClose(): void;
  sfx(name: SfxName): void;
}

/**
 * Меню тюнинга в духе Gran Turismo: слева категории, справа варианты.
 * Всё бесплатно, кроме одного большого апгрейда — за него платим иенами с квеста.
 */
export class GarageMenu {
  private el: HTMLElement;
  private active: CatId = 'engine';
  isOpen = false;

  constructor(
    private parent: HTMLElement,
    private state: GameState,
    private cb: GarageCallbacks,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'overlay hidden';
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    parent.appendChild(this.el);
  }

  open(): void {
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.render();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hidden');
    this.cb.onClose();
  }

  private stats(): { accel: number; top: number; grip: number; drift: number } {
    const u = this.state.upgrades;
    let accel = [1, 1.28, 1.6][u.engine] ?? 1;
    let top = [1, 1.12, 1.3][u.engine] ?? 1;
    if (u.turbo) {
      accel *= 1.15;
      top *= 1.06;
    }
    if (u.bigUpgrade) {
      accel *= 1.1;
      top *= 1.08;
    }
    let grip = 1;
    let drift = 1;
    if (u.tires === 1) {
      grip *= 1.25;
      drift *= 0.85;
    } else if (u.tires === 2) {
      grip *= 0.92;
      drift *= 1.4;
    }
    if (u.spoiler) grip *= 1.06;
    return { accel: accel / 2.1, top: top / 1.5, grip: grip / 1.35, drift: drift / 1.45 };
  }

  private render(): void {
    const u = this.state.upgrades;
    const cat = CATS.find((c) => c.id === this.active)!;
    const st = this.stats();
    const bar = (label: string, v: number, text: string) =>
      `<span>${label}</span><div class="bar"><i style="width:${Math.round(Math.min(1, v) * 100)}%"></i></div><span class="val">${text}</span>`;

    let options = '';
    if (cat.id === 'big') {
      const owned = u.bigUpgrade;
      const cost = ECONOMY.bigUpgradeCost;
      const enough = this.state.canAfford(cost);
      const questDone = this.state.data.questDone;
      options = `
        <div class="big-card">
          <h4>⚡ ФЛЮГЕГЕХАЙМЕН</h4>
          <p>Единственная вещь в этой мастерской, за которую берут иены. Чёрная продолговатая штука ставится
          в капот: по кнопке <kbd>Shift</kbd> она выезжает наружу и начинает очень быстро долбить вперёд-назад.
          Ей и сносят ворота базы, и достают самого Ваисова. В комплекте — закись азота, чтобы успеть разогнаться.</p>
          <div class="req">
            ${questDone ? '<span class="ok">✓ Квест на смотровой пройден</span>' : '<span class="no">✗ Сначала пройди квест на смотровой площадке</span>'}<br/>
            ${enough || owned ? `<span class="ok">✓ Иен достаточно (${formatYen(this.state.yen)})</span>` : `<span class="no">✗ Нужно ${formatYen(cost)}, есть ${formatYen(this.state.yen)}</span>`}
          </div>
          ${
            owned
              ? '<button class="btn" disabled>Флюгегехаймен установлен ✓</button>'
              : `<button class="btn primary" data-buy="big" ${enough ? '' : 'disabled'}>Поставить за ${formatYen(cost)}</button>`
          }
        </div>`;
    } else {
      const current = u[cat.key as keyof Upgrades];
      options = cat.options
        .map((o) => {
          const selected = current === o.value;
          const swatch = o.swatch !== undefined ? `<span class="swatch" style="background:#${o.swatch.toString(16).padStart(6, '0')};color:#${o.swatch.toString(16).padStart(6, '0')}"></span>` : '';
          return `
            <div class="opt ${selected ? 'selected' : ''}" data-cat="${cat.id}" data-value="${String(o.value)}">
              ${swatch}
              <div class="opt-main">
                <div class="opt-name">${o.name}</div>
                <div class="opt-desc">${o.desc}</div>
              </div>
              <div class="opt-price ${selected ? 'owned' : 'free'}">${selected ? 'Стоит' : 'Бесплатно'}</div>
            </div>`;
        })
        .join('');
    }

    this.el.innerHTML = `
      <div class="garage">
        <div class="garage-header">
          <div class="name">МАСТЕРСКАЯ «ДЗЕН-ТЮНИНГ»<small>ガレージ · TOYOTA MARK II JZX100</small></div>
          <div class="garage-yen">${formatYen(this.state.yen)}</div>
        </div>
        <div class="garage-body">
          <div class="garage-cats">
            ${CATS.map(
              (c) => `
              <div class="cat ${c.id === this.active ? 'active' : ''} ${c.id === 'big' ? 'big' : ''}" data-cat-id="${c.id}">
                <span class="icon">${c.icon}</span>
                <span class="label">${c.label}<small>${c.sub}</small></span>
              </div>`,
            ).join('')}
          </div>
          <div class="garage-options">
            <h3>${cat.title}</h3>
            <p class="desc">${cat.desc}</p>
            <div class="stat-bars">
              ${bar('Разгон', st.accel, `${Math.round(st.accel * 100)}`)}
              ${bar('Максималка', st.top, `${Math.round(st.top * 100)}`)}
              ${bar('Сцепление', st.grip, `${Math.round(st.grip * 100)}`)}
              ${bar('Дрифт', st.drift, `${Math.round(st.drift * 100)}`)}
            </div>
            ${options}
          </div>
        </div>
        <div class="garage-footer">
          <span><kbd>Esc</kbd> выехать из мастерской</span>
          <span>Обычный тюнинг бесплатный. Иены — только на большой апгрейд.</span>
        </div>
      </div>`;

    this.el.querySelectorAll<HTMLElement>('.cat').forEach((c) => {
      c.addEventListener('click', () => {
        this.active = c.dataset.catId as CatId;
        this.cb.sfx('ui');
        this.render();
      });
    });
    this.el.querySelectorAll<HTMLElement>('.opt').forEach((o) => {
      o.addEventListener('click', () => {
        const c = CATS.find((x) => x.id === o.dataset.cat)!;
        const raw = o.dataset.value!;
        const first = c.options[0].value;
        const value: number | boolean = typeof first === 'boolean' ? raw === 'true' : Number(raw);
        this.state.setUpgrade(c.key as keyof Upgrades, value as never);
        this.cb.sfx('confirm');
        this.cb.onChange();
        this.render();
      });
    });
    const buy = this.el.querySelector<HTMLButtonElement>('[data-buy="big"]');
    buy?.addEventListener('click', () => {
      if (this.state.spend(ECONOMY.bigUpgradeCost)) {
        this.state.setUpgrade('bigUpgrade', true);
        this.cb.sfx('fanfare');
        this.cb.onChange();
        this.render();
      } else {
        this.cb.sfx('deny');
      }
    });
  }
}
