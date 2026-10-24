// Источник фильмов: серверная функция /api/films (Wikidata + Википедия, без ключей),
// а «Классика» и запасной режим — встроенный каталог.
import { MOVIES } from './movies.js';

const ENDPOINT = '/api/films';

export const COLLECTIONS = [
  { id: 'new', name: '🆕 Новинки' },
  { id: 'popular', name: '🔥 Популярное' },
  { id: 'series', name: '📺 Сериалы' },
  { id: 'classic', name: '🏆 Классика', local: true },
];

// Настроения → жанры
export const MOOD_GENRES = {
  laugh: ['комедия'],
  think: ['драма', 'биография', 'история'],
  thrill: ['триллер', 'ужасы', 'детектив'],
  action: ['боевик', 'фантастика', 'приключения'],
  cozy: ['семейный', 'мультфильм', 'фэнтези', 'мюзикл'],
  love: ['мелодрама'],
};

function fromLocal(m, i) {
  return { id: `local:${i}`, t: m.t, orig: '', y: m.y, g: m.g, country: '', r: m.r, d: m.d, s: m.s, poster: '', posterBig: '', url: '', moods: m.m };
}
const LOCAL = MOVIES.map(fromLocal);

async function api(params) {
  const res = await fetch(`${ENDPOINT}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(58000) });
  if (!res.ok) throw new Error(`films ${res.status}`);
  return res.json();
}

/** Весь список подборки. При ошибке — встроенный каталог с пометкой local. */
export async function loadCollection(id) {
  if (COLLECTIONS.find((c) => c.id === id)?.local) return { items: LOCAL, local: true };
  try {
    const { items } = await api({ list: id });
    if (!items?.length) throw new Error('empty');
    return { items };
  } catch {
    return { items: LOCAL, local: true, failed: true };
  }
}

/** Поиск по названию во всей базе. */
export async function search(keyword) {
  try {
    const { items } = await api({ q: keyword });
    return { items: items ?? [] };
  } catch {
    const q = keyword.toLowerCase();
    return { items: LOCAL.filter((m) => m.t.toLowerCase().includes(q)), local: true, failed: true };
  }
}

/** Подробное описание из Википедии. */
export async function details(film) {
  if (!film.wiki) return film;
  try {
    const info = await api({ wiki: film.wiki });
    return { ...film, s: info.s || film.s, posterBig: info.poster || film.posterBig };
  } catch {
    return film;
  }
}

export const matchesMood = (film, mood) => {
  if (!mood) return true;
  if (film.moods) return film.moods.includes(mood);
  return film.g.some((g) => MOOD_GENRES[mood].includes(g));
};
