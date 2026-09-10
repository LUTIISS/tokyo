import { ECONOMY } from '@/config';

/**
 * Интерфейс квеста. Сейчас на смотровой площадке вручают подарок,
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
  /** Обновление во время активного квеста (мгновенным не нужно). */
  update(dt: number): void;
  /** Текст прогресса для HUD. */
  progressText(): string;
}

/**
 * Подарок на смотровой: доехал — получил иены на тюнинг, сразу и без условий.
 * Чтобы сделать здесь настоящее испытание, реализуй Quest и подставь в Game.
 */
export class OverlookGiftQuest implements Quest {
  readonly id = 'overlook-gift';
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
    // Подарок вручается сразу, следить не за чем.
  }

  progressText(): string {
    return this.done ? 'Подарок получен' : 'Доехать до смотровой площадки';
  }
}
