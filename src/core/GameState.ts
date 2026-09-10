import { NEON_COLORS, SAVE_KEY } from '@/config';

export interface Upgrades {
  /** 0 — сток, 1 — стрит, 2 — 1JZ-GTE полный фарш. */
  engine: 0 | 1 | 2;
  /** 0 — стрит, 1 — полуслики, 2 — дрифт-резина. */
  tires: 0 | 1 | 2;
  turbo: boolean;
  /** Индекс в NEON_COLORS. */
  neon: number;
  spoiler: boolean;
  /**
   * Тот самый большой апгрейд за иены. Открывает штурм базы Ваисова.
   */
  bigUpgrade: boolean;
}

export interface SaveData {
  version: 1;
  yen: number;
  upgrades: Upgrades;
  questDone: boolean;
  bossDefeated: boolean;
  driftBest: number;
  driftTotal: number;
  /** 0 — ночь, 1 — день. После финала остаётся день. */
  dayness: number;
}

const DEFAULTS: SaveData = {
  version: 1,
  yen: 0,
  upgrades: {
    engine: 0,
    tires: 0,
    turbo: false,
    neon: 0,
    spoiler: false,
    bigUpgrade: false,
  },
  questDone: false,
  bossDefeated: false,
  driftBest: 0,
  driftTotal: 0,
  dayness: 0,
};

type Listener = (state: GameState) => void;

/**
 * Прогресс игрока: иены, апгрейды, флаги сюжета. Сохраняется в localStorage.
 */
export class GameState {
  data: SaveData;
  private listeners = new Set<Listener>();

  constructor() {
    this.data = GameState.load();
  }

  static load(): SaveData {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return structuredClone(DEFAULTS);
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      const merged: SaveData = {
        ...structuredClone(DEFAULTS),
        ...parsed,
        upgrades: { ...DEFAULTS.upgrades, ...(parsed.upgrades ?? {}) },
      };
      merged.upgrades.neon = Math.min(Math.max(0, merged.upgrades.neon | 0), NEON_COLORS.length - 1);
      return merged;
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      /* приватный режим — просто не сохраняем */
    }
    this.emit();
  }

  reset(): void {
    this.data = structuredClone(DEFAULTS);
    this.save();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this);
  }

  // ── Удобные операции ─────────────────────────────────────────────────────
  get yen(): number {
    return this.data.yen;
  }

  addYen(amount: number): void {
    this.data.yen = Math.max(0, Math.round(this.data.yen + amount));
    this.save();
  }

  canAfford(cost: number): boolean {
    return this.data.yen >= cost;
  }

  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.data.yen -= cost;
    this.save();
    return true;
  }

  get upgrades(): Upgrades {
    return this.data.upgrades;
  }

  setUpgrade<K extends keyof Upgrades>(key: K, value: Upgrades[K]): void {
    this.data.upgrades[key] = value;
    this.save();
  }

  completeQuest(reward: number): void {
    this.data.questDone = true;
    this.data.yen += reward;
    this.save();
  }

  defeatBoss(): void {
    this.data.bossDefeated = true;
    this.data.dayness = 1;
    this.save();
  }

  recordDrift(score: number): void {
    if (score <= 0) return;
    this.data.driftTotal += score;
    if (score > this.data.driftBest) this.data.driftBest = score;
    this.save();
  }
}

export function formatYen(n: number): string {
  return '¥' + Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
}
