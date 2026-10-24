// Серверная функция Vercel: фильмы из открытых баз без ключей.
//   Wikidata (query.wikidata.org)  — списки фильмов: даты выхода, жанры, длительность, ID Кинопоиска
//   Русская Википедия (API)         — постеры и описания
// Данные обновляются сами: новый фильм появляется в Wikidata вскоре после анонса.
//
//   GET /api/films?list=new|popular|soon|series   — весь список сразу (до 90 фильмов)
//   GET /api/films?q=название
//   GET /api/films?wiki=Название статьи   — подробное описание одного фильма

const SPARQL = 'https://query.wikidata.org/sparql';
const WIKI = 'https://ru.wikipedia.org/w/api.php';
const UA = 'mysik-portfolio-movie-picker/1.0 (https://mysik-portfolio.vercel.app)';
const PAGE = 30;
const FILM = 'wd:Q11424';
const SERIES = 'wd:Q5398426';

const day = 864e5;
const isoDate = (d) => `${d.toISOString().slice(0, 10)}T00:00:00Z`;

// ---------- Запросы к Wikidata ----------
// Шаг 1 — лёгкий запрос: только ID фильмов из нужного окна дат, по популярности (число статей в Википедиях).
// Шаг 2 — подробности только для найденных ID. Так быстрее, чем один большой запрос.
function windowFor(list) {
  const now = new Date();
  return {
    new: [new Date(now - 150 * day), now],
    soon: [new Date(+now + day), new Date(+now + 240 * day)],
    popular: [new Date(now - 3 * 365 * day), now],
    series: [new Date(now - 4 * 365 * day), now],
  }[list];
}

function idsInWindowQuery(list) {
  const [from, to] = windowFor(list);
  const type = list === 'series' ? SERIES : FILM;
  const dateProp = list === 'series' ? '(wdt:P577|wdt:P580)' : 'wdt:P577';
  const minLinks = { new: 5, soon: 3, popular: 15, series: 10 }[list];
  return `SELECT ?item (MAX(?l) AS ?pop) WHERE {
    ?item wdt:P31 ${type}; ${dateProp} ?d.
    FILTER(?d >= "${isoDate(from)}"^^xsd:dateTime && ?d <= "${isoDate(to)}"^^xsd:dateTime)
    ?item wikibase:sitelinks ?l. FILTER(?l >= ${minLinks})
  } GROUP BY ?item ORDER BY DESC(?pop) LIMIT 160`;
}

function detailsQuery(ids, checkKind = false) {
  return `SELECT ?item (SAMPLE(?label) AS ?title) (SAMPLE(?orig) AS ?original) (MIN(?d) AS ?released) (SAMPLE(?dur) AS ?minutes)
    (SAMPLE(?kp) AS ?kpId) (SAMPLE(?wikiTitle) AS ?wiki) (MAX(?links) AS ?pop)
    (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres) (SAMPLE(?countryLabel) AS ?country) WHERE {
    VALUES ?item { ${ids.map((id) => `wd:${id}`).join(' ')} }
    ${checkKind ? `?item wdt:P31/wdt:P279* ?kind. VALUES ?kind { ${FILM} ${SERIES} wd:Q202866 wd:Q24862 }` : ''}
    ?item wikibase:sitelinks ?links.
    ?article schema:about ?item; schema:isPartOf <https://ru.wikipedia.org/>; schema:name ?wikiTitle.
    ?item rdfs:label ?label FILTER(lang(?label) = "ru")
    OPTIONAL { ?item (wdt:P577|wdt:P580) ?d }
    OPTIONAL { ?item wdt:P1476 ?orig }
    OPTIONAL { ?item wdt:P2047 ?dur }
    OPTIONAL { ?item wdt:P2603 ?kp }
    OPTIONAL { ?item wdt:P136 ?g. ?g rdfs:label ?genreLabel FILTER(lang(?genreLabel) = "ru") }
    OPTIONAL { ?item wdt:P495 ?c. ?c rdfs:label ?countryLabel FILTER(lang(?countryLabel) = "ru") }
  } GROUP BY ?item ORDER BY DESC(?pop)`;
}

const qid = (uri) => uri.split('/').pop();

async function loadList(list) {
  const ranked = (await sparql(idsInWindowQuery(list))).map((r) => qid(r.item));
  if (!ranked.length) return [];
  // Подробности порциями по 80 ID — параллельно
  const parts = [];
  for (let i = 0; i < ranked.length; i += 80) parts.push(ranked.slice(i, i + 80));
  const rows = (await Promise.all(parts.map((ids) => sparql(detailsQuery(ids))))).flat();
  // Убираем перевыпуски старых фильмов: первая дата выхода должна попадать в окно
  const [from] = windowFor(list);
  const fresh = rows.filter((r) => !r.released || new Date(r.released) >= from - day);
  fresh.sort((a, b) => Number(b.pop) - Number(a.pop));
  return fresh.slice(0, 90);
}

async function sparql(query) {
  const res = await fetch(`${SPARQL}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
    signal: AbortSignal.timeout(50000),
  });
  if (!res.ok) throw new Error(`wikidata ${res.status}`);
  const json = await res.json();
  return json.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

// ---------- Жанры: «драматический фильм» → «драма» ----------
const GENRE_RULES = [
  [/драм/, 'драма'], [/комед/, 'комедия'], [/ужас|хоррор/, 'ужасы'], [/триллер/, 'триллер'], [/фантаст|супергер/, 'фантастика'],
  [/фэнтез/, 'фэнтези'], [/приключ/, 'приключения'], [/боевик|боев/, 'боевик'], [/мелодрам|романт/, 'мелодрама'],
  [/анимац|мульт/, 'мультфильм'], [/семейн|детск/, 'семейный'], [/детектив|нуар/, 'детектив'], [/криминал|гангстер/, 'криминал'],
  [/биограф/, 'биография'], [/историч|пеплум/, 'история'], [/музык|мюзикл/, 'мюзикл'], [/военн/, 'военный'],
  [/документ/, 'документальный'], [/спорт/, 'спорт'], [/вестерн/, 'вестерн'],
];
function genres(raw) {
  const out = [];
  for (const label of raw ? raw.split('|') : []) {
    for (const [re, name] of GENRE_RULES) if (re.test(label) && !out.includes(name)) out.push(name);
  }
  return out.slice(0, 4);
}

// ---------- Постеры и описания из Википедии ----------
const clean = (s) => (s || '').replace(/́/g, '').replace(/\s*\([^)]*англ\.[^)]*\)/, '').trim();

async function wikiInfo(titles, sentences = 2) {
  const info = {};
  const chunks = [];
  for (let i = 0; i < titles.length; i += 20) chunks.push(titles.slice(i, i + 20)); // extracts — максимум 20 за раз
  await Promise.all(chunks.map(async (chunk) => {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', redirects: '1',
      prop: 'pageimages|extracts', piprop: 'thumbnail', pithumbsize: '500', pilicense: 'any', pilimit: '50',
      exintro: '1', explaintext: '1', exsentences: String(sentences), exlimit: '20', titles: chunk.join('|'),
    });
    try {
      const res = await fetch(`${WIKI}?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      const json = await res.json();
      const back = {};
      for (const r of json.query?.redirects ?? []) back[r.to] = r.from;
      for (const r of json.query?.normalized ?? []) back[r.to] = r.from;
      for (const p of json.query?.pages ?? []) {
        const key = back[p.title] ?? p.title;
        info[key] = { poster: p.thumbnail?.source ?? '', s: clean(p.extract) };
      }
    } catch { /* без постеров — не страшно */ }
  }));
  return info;
}

function toFilm(row, wiki) {
  const w = wiki[row.wiki] ?? {};
  const y = row.released ? Number(row.released.slice(0, 4)) : null;
  return {
    id: `wd:${row.item.split('/').pop()}`,
    kpId: row.kpId ? Number(row.kpId) : null,
    t: row.title,
    orig: row.original && row.original !== row.title ? row.original : '',
    y,
    date: row.released ? row.released.slice(0, 10) : '',
    g: genres(row.genres),
    country: row.country || '',
    d: row.minutes ? Math.round(Number(row.minutes)) : null,
    s: w.s || '',
    poster: w.poster || '',
    posterBig: w.poster || '',
    wiki: row.wiki,
    url: row.kpId ? `https://www.kinopoisk.ru/film/${row.kpId}/` : `https://ru.wikipedia.org/wiki/${encodeURIComponent(row.wiki)}`,
    pop: Number(row.pop) || 0,
  };
}

async function withWiki(rows) {
  const wiki = await wikiInfo(rows.map((r) => r.wiki));
  return rows.map((r) => toFilm(r, wiki));
}

// ---------- Обработчик ----------
const LISTS = ['new', 'popular', 'soon', 'series'];
const SITE = 'https://mysik-portfolio.vercel.app';

module.exports = async (req, res) => {
  const { list, q, wiki, warm } = req.query;
  try {
    // Ночной прогрев (Vercel Cron): запрашиваем списки через CDN, чтобы посетители получали готовые данные
    if (warm) {
      const done = await Promise.allSettled(LISTS.map((l) => fetch(`${SITE}/api/films?list=${l}`, { headers: { 'Cache-Control': 'no-cache' } })));
      return res.status(200).json({ warmed: done.map((d, i) => `${LISTS[i]}:${d.status === 'fulfilled' ? d.value.status : 'error'}`) });
    }
    let body;
    if (typeof wiki === 'string' && wiki) {
      const info = await wikiInfo([wiki.slice(0, 200)], 6);
      body = info[wiki] ?? {};
    } else if (typeof q === 'string' && q.trim()) {
      const params = new URLSearchParams({ action: 'wbsearchentities', format: 'json', language: 'ru', uselang: 'ru', type: 'item', limit: '30', search: q.trim().slice(0, 80) });
      const found = await fetch(`https://www.wikidata.org/w/api.php?${params}`, { headers: { 'User-Agent': UA } }).then((r) => r.json());
      const ids = (found.search ?? []).map((s) => s.id).filter((id) => /^Q\d+$/.test(id));
      body = { items: ids.length ? await withWiki(await sparql(detailsQuery(ids, true))) : [] };
    } else if (LISTS.includes(list)) {
      body = { items: await withWiki(await loadList(list)) };
      if (list === 'soon') body.items.sort((a, b) => a.date.localeCompare(b.date));
    } else {
      return res.status(400).json({ error: 'bad_request' });
    }
    // Кэш на CDN: сутки свежий, ещё неделю отдаётся старый, пока в фоне готовится новый
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'source_unavailable', detail: String(err.message || err) });
  }
};
