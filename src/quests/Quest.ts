import { ECONOMY } from '@/config';

/**
 * Интерфейс квеста. Сейчас есть только заглушка на смотровой площадке,
 * но сюда можно подключить что угодно: доставку, гонку на время, сбор предметов.
 */
export interface Quest {
  readonly id: string;
  readonly title: string;
  /** Короткий кикер над заголовком (японский для вайба). */
  readonly kicker: string;
  /** HTML-описание для диалога. */
  readonly description: string;
  readonly reward: number;
  readonly done: boolean;
  /** Запуск. Для мгновенных квестов может сразу выставить done. */
  start(): void;
  /** Обновление во время активного квеста (пока не используется заглушкой). */
  update(dt: number): void;
  /** Текст прогресса для HUD. */
  progressText(): string;
}

/**
 * Квест-заглушка: место зарезервировано, награда начисляется сразу.
 * Заменить на настоящий квест — реализовать Quest и подставить в Game.
 */
export class PlaceholderQuest implements Quest {
  readonly id = 'overlook-placeholder';
  readonly title = 'Испытание на смотровой';
  readonly kicker = '展望台 · КВЕСТ';
  readonly reward = ECONOMY.questReward;
  done = false;

  get description(): string {
    return `
      <p>Это место для настоящего квеста — он будет здесь позже.</p>
      <p>Пока что: ты доехал до смотровой площадки над ночным Токио, а значит — заслужил награду.</p>
      <span class="reward">+¥${this.reward.toLocaleString('ru-RU')}</span>
    `;
  }

  start(): void {
    this.done = true;
  }

  update(): void {
    /* заглушка */
  }

  progressText(): string {
    return this.done ? 'Выполнен' : 'Доехать до смотровой площадки';
  }
}
