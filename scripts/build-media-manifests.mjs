/**
 * Собирает манифесты медиа по содержимому папок.
 *
 * Кидаешь файлы — и всё:
 *   public/audio/tracks/      → public/audio/tracks.json
 *   public/media/billboards/  → public/media/billboards.json   (широкие экраны 16:9)
 *   public/media/posters/     → public/media/posters.json      (вертикальные щиты 1:2)
 *
 * Запускается автоматически перед npm run dev и npm run build.
 *
 * Порядок: по имени файла. Хочешь задать очередь — начинай имена с номера (01-, 02-, …).
 * Название трека берётся из имени файла: «01 - Teriyaki Boyz - Tokyo Drift.mp3» →
 * «Teriyaki Boyz — Tokyo Drift». Файл с именем, начинающимся на finale, становится
 * финальной темой (играет на рассвете после победы).
 */
import { readdirSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const AUDIO_EXT = new Set(['.mp3', '.ogg', '.m4a', '.wav', '.opus', '.flac']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);

/** Файлы папки с нужными расширениями, отсортированные по имени. */
function listFiles(dir, allowed) {
  const abs = join(root, dir);
  if (!existsSync(abs)) {
    mkdirSync(abs, { recursive: true });
    return [];
  }
  return readdirSync(abs)
    .filter((f) => !f.startsWith('.') && allowed.has(extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' }));
}

/** «01 - Some Artist - Track Name.mp3» → «Some Artist — Track Name» */
function prettyName(file) {
  let name = basename(file, extname(file));
  name = name.replace(/^\s*\d{1,3}\s*[-_.)]?\s*/, '');
  name = name.replace(/[_]+/g, ' ');
  // Только дефис, окружённый пробелами: «Круг - Жиган-лимон» → «Круг — Жиган-лимон».
  name = name.replace(/\s+-\s+/g, ' — ');
  return name.trim() || basename(file, extname(file));
}

/** Пишет JSON, только если содержимое изменилось (чтобы не дёргать вотчер Vite). */
function writeIfChanged(relPath, data) {
  const abs = join(root, relPath);
  const next = JSON.stringify(data, null, 2) + '\n';
  if (existsSync(abs) && readFileSync(abs, 'utf8') === next) return false;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, next);
  return true;
}

// ── Музыка ────────────────────────────────────────────────────────────────
const audioFiles = listFiles('public/audio/tracks', AUDIO_EXT);
const finaleFile = audioFiles.find((f) => /^finale/i.test(basename(f, extname(f))));
const trackFiles = audioFiles.filter((f) => f !== finaleFile);
const audio = {
  _comment:
    'Собирается автоматически из public/audio/tracks/. Файл с именем finale.* становится финальной темой. Не редактируй вручную — правь имена файлов.',
  tracks: trackFiles.map((f) => ({ title: prettyName(f), src: `/audio/tracks/${f}` })),
  finale: finaleFile ? { title: prettyName(finaleFile), src: `/audio/tracks/${finaleFile}` } : null,
};

// ── Стенды с мемами (16:9) ────────────────────────────────────────────────
const billboardFiles = listFiles('public/media/billboards', new Set([...IMAGE_EXT, ...VIDEO_EXT]));
const billboards = {
  _comment: 'Собирается автоматически из public/media/billboards/. Не редактируй вручную — правь имена файлов.',
  items: billboardFiles.map((f) => ({
    type: VIDEO_EXT.has(extname(f).toLowerCase()) ? 'video' : 'image',
    src: `/media/billboards/${f}`,
    label: prettyName(f),
  })),
};

// ── Вертикальные плакаты (1:2) ────────────────────────────────────────────
const posterFiles = listFiles('public/media/posters', IMAGE_EXT);
const posters = {
  _comment:
    'Собирается автоматически из public/media/posters/. Пусто — на щитах рисуются процедурные плакаты. Не редактируй вручную — правь имена файлов.',
  items: posterFiles.map((f) => ({ src: `/media/posters/${f}`, label: prettyName(f) })),
};

const changed = [
  writeIfChanged('public/audio/tracks.json', audio) && 'tracks.json',
  writeIfChanged('public/media/billboards.json', billboards) && 'billboards.json',
  writeIfChanged('public/media/posters.json', posters) && 'posters.json',
].filter(Boolean);

const summary = `медиа: треков ${audio.tracks.length}${audio.finale ? ' + финал' : ''}, стендов ${billboards.items.length}, плакатов ${posters.items.length}`;
console.log(changed.length ? `${summary} — обновлено: ${changed.join(', ')}` : `${summary} — без изменений`);
