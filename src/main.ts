import './style.css';
import { Game } from '@/core/Game';

const app = document.getElementById('app');
const ui = document.getElementById('ui');
if (!app || !ui) throw new Error('Не найден #app / #ui в index.html');

const game = new Game(app, ui);
game.init().catch((err) => {
  console.error(err);
  ui.innerHTML = `<div class="fatal"><h1>Что-то сломалось</h1><pre>${String(err?.stack ?? err)}</pre></div>`;
});

// Для отладки из консоли: window.game.state.addYen(100000) и т.п.
declare global {
  interface Window {
    game: Game;
  }
}
window.game = game;
