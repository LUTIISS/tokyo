# Музыка

1. Скопируй треки (mp3 / ogg / m4a) в папку `tracks/`.
2. Перечисли их в `tracks.json`:

```json
{
  "tracks": [
    { "title": "Teriyaki Boyz — Tokyo Drift", "src": "/audio/tracks/tokyo-drift.mp3" },
    { "title": "Initial D — Running in the 90s", "src": "/audio/tracks/running-90s.mp3" }
  ],
  "finale": { "title": "Сакура на рассвете", "src": "/audio/tracks/finale.mp3" }
}
```

- Плейлист крутится по кругу, `N` — следующий трек, `M` — выключить звук.
- `finale` включается, когда база Ваисова взята и наступает день. Можно оставить `null`.
- Сами файлы в git не попадают (см. `.gitignore`), только `tracks.json`.
