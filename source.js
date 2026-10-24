// Источник фильмов: API Кинопоиска через серверную функцию /api/kp,
// а если она недоступна (нет ключа, нет сети, локальный запуск) — встроенный каталог.
import { MOVIES } from './movies.js';

const ENDPOINT = '/api/kp';
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

export const COLLECTIONS = [
  { id: 'popular', name: '🔥 Популярное', type: 'TOP_POPULAR_MOVIES' },
  { id: 'top', name: '🏆 Топ-250', type: 'TOP_250_MOVIES' },
  { id: 'premieres', name: '🆕 Премьеры месяца' },
  { id: 'series', name: '📺 Сериалы', type: 'TOP_250_TV_SHOWS' },
];

// Настроения → жанры Кинопоиска
export const MOOD_GENRES = {
  laugh: ['комедия'],
  think: ['драма', 'биография', 'история'],
  thrill: ['триллер', 'ужасы', 'детектив'],
  action: ['боевик', 'фантастика', 'приключения'],
  cozy: ['семейный', 'мультфильм', 'фэнтези', 'мюзикл'],
  love: ['мелодрама'],
};

let online = null; // null — ещё не проверяли

async function kp(path, params = {}) {
  const qs = new URLSearchParams({ path, ...params });
  const res = await fetch(`${ENDPOINT}?${qs}`);
  if (!res.ok) throw new Error(`kp ${res.status}`);
  return res.json();
}

const rating = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Приводим ответ Кинопоиска к общему виду карточки. */
function fromKp(f) {
  const id = f.kinopoiskId ?? f.filmId;
  return {
    id: `kp:${id}`,
    kpId: id,
    t: f.nameRu || f.nameEn || f.nameOriginal || 'Без названия',
    orig: f.nameOriginal || f.nameEn || '',
    y: Number(f.year) || null,
    g: (f.genres ?? []).map((x) => x.genre).filter(Boolean),
    country: (f.countries ?? []).map((x) => x.country).slice(0, 2).join(', '),
    r: rating(f.ratingKinopoisk ?? f.rating),
    rImdb: rating(f.ratingImdb),
    d: f.filmLength || f.duration || null,
    s: f.shortDescription || f.description || '',
    poster: f.posterUrlPreview || f.posterUrl || '',
    posterBig: f.posterUrl || f.posterUrlPreview || '',
    url: f.webUrl || (id ? `https://www.kinopoisk.ru/film/${id}/` : ''),
    premiere: f.premiereRu || '',
  };
}

function fromLocal(m, i) {
  return { id: `local:${i}`, t: m.t, orig: '', y: m.y, g: m.g, country: '', r: m.r, rImdb: m.r, d: m.d, s: m.s, poster: '', posterBig: '', url: '', moods: m.m };
}
const LOCAL = MOVIES.map(fromLocal);

/** Есть ли связь с Кинопоиском. Проверяем один раз. */
export async function isOnline() {
  if (online !== null) return online;
  try {
    await kp('v2.2/films/filters');
    online = true;
  } catch {
    online = false;
  }
  return online;
}

/** Страница подборки. Возвращает { items, hasMore }. */
export async function loadCollection(id, page = 1) {
  if (!(await isOnline())) return { items: page === 1 ? LOCAL : [], hasMore: false, local: true };
  if (id === 'premieres') {
    const now = new Date();
    const data = await kp('v2.2/films/premieres', { year: String(now.getFullYear()), month: MONTHS[now.getMonth()] });
    return { items: (data.items ?? []).map(fromKp), hasMore: false };
  }
  const col = COLLECTIONS.find((c) => c.id === id);
  const data = await kp('v2.2/films/collections', { type: col.type, page: String(page) });
  return { items: (data.items ?? []).map(fromKp), hasMore: page < (data.totalPages ?? 1) };
}

/** Поиск по названию. */
export async function search(keyword, page = 1) {
  if (!(await isOnline())) {
    const q = keyword.toLowerCase();
    return { items: LOCAL.filter((m) => m.t.toLowerCase().includes(q)), hasMore: false, local: true };
  }
  const data = await kp('v2.2/films', { keyword, order: 'NUM_VOTE', page: String(page) });
  return { items: (data.items ?? []).map(fromKp).filter((f) => f.y), hasMore: page < (data.totalPages ?? 1) };
}

/** Подробности фильма (описание, длительность, ссылка). */
export async function details(film) {
  if (!film.kpId || !(await isOnline())) return film;
  try {
    const full = fromKp(await kp(`v2.2/films/${film.kpId}`));
    return { ...film, ...Object.fromEntries(Object.entries(full).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length))) };
  } catch {
    return film;
  }
}

export const matchesMood = (film, mood) => {
  if (!mood) return true;
  if (film.moods) return film.moods.includes(mood);
  return film.g.some((g) => MOOD_GENRES[mood].includes(g));
};
