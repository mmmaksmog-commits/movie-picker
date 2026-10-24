// Серверная функция Vercel: прокси к API Кинопоиска (kinopoiskapiunofficial.tech).
// Ключ хранится в переменной окружения KP_API_KEY и не попадает в браузер.
// При публикации сайта лежит по адресу /api/kp?path=...
//
// Разрешены только нужные приложению запросы, чтобы функцию нельзя было
// использовать как открытый прокси и тратить чужой лимит.

const API = 'https://kinopoiskapiunofficial.tech/api';

const ALLOWED = [
  /^v2\.2\/films\/collections$/,  // топ-250, популярное
  /^v2\.2\/films\/premieres$/,    // премьеры месяца
  /^v2\.2\/films\/filters$/,      // список жанров
  /^v2\.2\/films$/,               // поиск с фильтрами
  /^v2\.2\/films\/\d{1,9}$/,      // карточка фильма
];
const ALLOWED_PARAMS = new Set(['type', 'page', 'year', 'month', 'keyword', 'genres', 'order', 'ratingFrom', 'yearFrom', 'yearTo']);

module.exports = async (req, res) => {
  const key = process.env.KP_API_KEY;
  if (!key) return res.status(503).json({ error: 'no_key' });

  const { path = '', ...rest } = req.query;
  if (!ALLOWED.some((re) => re.test(path))) return res.status(400).json({ error: 'bad_path' });

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) {
    if (ALLOWED_PARAMS.has(k) && typeof v === 'string' && v.length <= 60) params.set(k, v);
  }

  try {
    const upstream = await fetch(`${API}/${path}${params.size ? `?${params}` : ''}`, {
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    });
    const body = await upstream.text();
    // Кэш на CDN Vercel: одинаковые запросы не тратят дневной лимит ключа
    if (upstream.ok) res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    res.status(upstream.status).setHeader('Content-Type', 'application/json; charset=utf-8').send(body);
  } catch {
    res.status(502).json({ error: 'upstream_unavailable' });
  }
};
