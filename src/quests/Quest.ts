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
  readonly title = 'Поздравление на смотровой';
  readonly kicker = '展望台 · ПОДАРОК';
  readonly reward = ECONOMY.questReward;
  done = false;

  get description(): string {
    return `
      <p>Андрюха, с днём рождения! Весь этот город собрали ради тебя.</p>
      <p>Ты доехал до смотровой над ночным Токио — держи подарок на тюнинг.</p>
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
    return this.done ? 'Подарок получен' : 'Доехать до смотровой площадки';
  }
}
