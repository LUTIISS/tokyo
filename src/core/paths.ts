/**
 * База приложения. Локально — '/', на GitHub Pages — '/tokyo/'.
 * Все пути из манифестов вида '/audio/...' и '/media/...' прогоняем через assetUrl.
 */
export const BASE_URL: string = import.meta.env.BASE_URL || '/';

export function assetUrl(path: string): string {
  if (/^(https?:)?\/\//.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
  const base = BASE_URL.endsWith('/') ? BASE_URL : BASE_URL + '/';
  return path.startsWith('/') ? base + path.slice(1) : base + path;
}
