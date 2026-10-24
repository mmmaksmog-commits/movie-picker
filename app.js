import { MOODS, GENRE_ICON } from './movies.js';
import { COLLECTIONS, isOnline, loadCollection, search, details, matchesMood } from './source.js';

const $ = (s) => document.querySelector(s);
const LIST_KEY = 'movies_watchlist_v2';

const state = {
  collection: 'popular',
  mood: null,
  q: '',
  genre: '',
  decade: '',
  sort: 'default',
  tab: 'all',
  items: [],      // загруженные фильмы текущей подборки или поиска
  page: 1,
  hasMore: false,
  loading: false,
  local: false,
};
let watchlist = readList();
let requestId = 0;

function readList() { try { return JSON.parse(localStorage.getItem(LIST_KEY)) ?? {}; } catch { return {}; } }
function saveList() { try { localStorage.setItem(LIST_KEY, JSON.stringify(watchlist)); } catch { /* ignore */ } }

const escapeHTML = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (d) => (d ? `${Math.floor(d / 60)} ч ${d % 60 ? `${d % 60} мин` : ''}`.trim() : '');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
const gradient = (m) => { const h = hue(m.t); return `background: linear-gradient(160deg, hsl(${h} 70% 45%), hsl(${(h + 50) % 360} 70% 18%) 70%, #0c0a0b);`; };
const icon = (m) => GENRE_ICON[m.g[0]] ?? '🎬';

// ---------- Загрузка ----------
async function load(reset = true) {
  const id = ++requestId;
  if (reset) { state.page = 1; state.items = []; }
  state.loading = true;
  render();
  try {
    const res = state.q.trim()
      ? await search(state.q.trim(), state.page)
      : await loadCollection(state.collection, state.page);
    if (id !== requestId) return;
    const seen = new Set(state.items.map((m) => m.id));
    state.items.push(...res.items.filter((m) => !seen.has(m.id)));
    state.hasMore = res.hasMore;
    state.local = Boolean(res.local);
  } catch {
    if (id !== requestId) return;
    state.hasMore = false;
    toastError('Кинопоиск сейчас не отвечает. Попробуйте позже.');
  } finally {
    if (id === requestId) { state.loading = false; renderFilters(); render(); }
  }
}

// ---------- Фильтрация ----------
function visible() {
  const base = state.tab === 'list' ? Object.values(watchlist) : state.items;
  const list = base.filter((m) =>
    matchesMood(m, state.mood)
    && (!state.genre || m.g.includes(state.genre))
    && (!state.decade || (m.y && Math.floor(m.y / 10) * 10 === Number(state.decade))));
  const by = { rating: (a, b) => (b.r ?? 0) - (a.r ?? 0), new: (a, b) => (b.y ?? 0) - (a.y ?? 0) };
  return by[state.sort] ? [...list].sort(by[state.sort]) : list;
}

// ---------- Отрисовка ----------
function renderFilters() {
  $('#collections').hidden = state.local;
  $('#collections').innerHTML = COLLECTIONS.map((c) => `<button class="chip chip--col ${!state.q && state.collection === c.id ? 'is-active' : ''}" data-col="${c.id}">${c.name}</button>`).join('');
  $('#moods').innerHTML = MOODS.map((m) => `<button class="chip ${state.mood === m.id ? 'is-active' : ''}" data-mood="${m.id}">${m.name}</button>`).join('');

  const pool = [...state.items, ...Object.values(watchlist)];
  const genres = [...new Set(pool.flatMap((m) => m.g))].sort((a, b) => a.localeCompare(b, 'ru'));
  $('#genre').innerHTML = `<option value="">Все жанры</option>${genres.map((g) => `<option value="${escapeHTML(g)}">${GENRE_ICON[g] ?? ''} ${escapeHTML(cap(g))}</option>`).join('')}`;
  $('#genre').value = genres.includes(state.genre) ? state.genre : '';
  const decades = [...new Set(pool.map((m) => m.y && Math.floor(m.y / 10) * 10).filter(Boolean))].sort((a, b) => b - a);
  $('#decade').innerHTML = `<option value="">Любые годы</option>${decades.map((d) => `<option value="${d}">${d}-е</option>`).join('')}`;
  $('#decade').value = decades.includes(Number(state.decade)) ? state.decade : '';
  $('#sort').value = state.sort;
  $('#source').innerHTML = state.local ? '📼 Встроенная подборка' : 'Данные: <a href="https://www.kinopoisk.ru" target="_blank" rel="noopener">Кинопоиск</a>';
}

function card(m) {
  const saved = Boolean(watchlist[m.id]);
  const meta = [m.y, m.g.slice(0, 2).join(', '), hm(m.d)].filter(Boolean).join(' · ');
  return `<article class="movie">
    <button class="poster" style="${gradient(m)}" data-open="${m.id}" aria-label="Подробнее: ${escapeHTML(m.t)}">
      <span class="poster__icon">${icon(m)}</span><span class="poster__title">${escapeHTML(m.t)}</span>
      ${m.poster ? `<img src="${escapeHTML(m.poster)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      ${m.r ? `<span class="poster__rating">★ ${m.r.toFixed(1)}</span>` : m.premiere ? '<span class="poster__rating poster__rating--new">Премьера</span>' : ''}
    </button>
    <button class="save ${saved ? 'is-on' : ''}" data-save="${m.id}" aria-label="${saved ? 'Убрать из списка' : 'Посмотреть позже'}">${saved ? '♥' : '♡'}</button>
    <div class="movie__meta"><b>${escapeHTML(m.t)}</b><span>${escapeHTML(meta)}</span></div>
  </article>`;
}

function render() {
  const list = visible();
  $('#countAll').textContent = state.items.length || '';
  $('#countList').textContent = Object.keys(watchlist).length || '';
  if (state.loading && !state.items.length && state.tab === 'all') {
    $('#grid').innerHTML = Array.from({ length: 10 }, () => '<div class="movie skeleton"><div class="poster"></div><div class="movie__meta"><b></b><span></span></div></div>').join('');
  } else if (!list.length) {
    $('#grid').innerHTML = `<div class="empty">${state.tab === 'list' && !Object.keys(watchlist).length ? '♡<p>Добавляйте фильмы сердечком — они появятся здесь.</p>' : '🍿<p>Ничего не нашлось. Попробуйте другое настроение или жанр.</p>'}</div>`;
  } else {
    $('#grid').innerHTML = list.map(card).join('');
  }
  $('#moreBtn').hidden = state.tab !== 'all' || !state.hasMore;
  $('#moreBtn').disabled = state.loading;
  $('#moreBtn').textContent = state.loading ? 'Загружаю…' : 'Показать ещё';
}

// ---------- Карточка фильма ----------
const findFilm = (id) => state.items.find((m) => m.id === id) ?? watchlist[id];

async function openMovie(m, fromRoulette = false) {
  showMovie(m, fromRoulette, true);
  const full = await details(m);
  if (!$('#modal').hidden && $('#modalBox').dataset.id === m.id) showMovie(full, fromRoulette, false);
  if (watchlist[m.id]) { watchlist[m.id] = slim(full); saveList(); }
}

function showMovie(m, fromRoulette, loading) {
  const saved = Boolean(watchlist[m.id]);
  const q = encodeURIComponent(`${m.t} ${m.y ?? ''} трейлер`);
  $('#modalBox').dataset.id = m.id;
  $('#modalBox').innerHTML = `
    <button class="modal__close" data-close aria-label="Закрыть">✕</button>
    <div class="detail">
      <div class="detail__poster" style="${gradient(m)}">
        ${m.posterBig ? `<img src="${escapeHTML(m.posterBig)}" alt="" onerror="this.remove()">` : `<span>${icon(m)}</span>`}
      </div>
      <div class="detail__body">
        ${fromRoulette ? '<p class="detail__kicker">🎰 Сегодня смотрим</p>' : ''}
        <h2>${escapeHTML(m.t)}</h2>
        ${m.orig && m.orig !== m.t ? `<p class="detail__orig">${escapeHTML(m.orig)}</p>` : ''}
        <p class="detail__meta">
          ${m.r ? `<span class="badge">КП ${m.r.toFixed(1)}</span>` : ''}
          ${m.rImdb && !m.id.startsWith('local') ? `<span class="badge badge--imdb">IMDb ${m.rImdb.toFixed(1)}</span>` : ''}
          ${escapeHTML([m.y, hm(m.d), m.country].filter(Boolean).join(' · '))}
        </p>
        <p class="detail__genres">${m.g.map((g) => `<span>${GENRE_ICON[g] ?? ''} ${escapeHTML(g)}</span>`).join('')}</p>
        <p class="detail__plot">${m.s ? escapeHTML(m.s) : loading ? '<span class="shimmer">Загружаю описание…</span>' : 'Описания пока нет.'}</p>
        ${m.premiere ? `<p class="detail__premiere">В кино с ${new Date(m.premiere).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</p>` : ''}
        <div class="detail__actions">
          <button class="btn ${saved ? '' : 'btn--primary'}" data-save="${m.id}">${saved ? '♥ В списке' : '♡ Посмотреть позже'}</button>
          <a class="btn" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">▶ Трейлер</a>
          ${m.url ? `<a class="btn" href="${escapeHTML(m.url)}" target="_blank" rel="noopener">Кинопоиск ↗</a>` : ''}
          ${fromRoulette ? '<button class="btn" id="spinAgain">🎰 Ещё раз</button>' : ''}
        </div>
      </div>
    </div>`;
  $('#modal').hidden = false;
  if (fromRoulette) $('#spinAgain').onclick = roulette;
}

// ---------- Рулетка ----------
function roulette() {
  const pool = visible().length ? visible() : state.items;
  if (!pool.length) return;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  $('#modalBox').dataset.id = '';
  $('#modalBox').innerHTML = '<div class="slot"><div class="slot__reel" id="reel"></div><p>Выбираем фильм…</p></div>';
  $('#modal').hidden = false;
  let i = 0;
  const steps = 18;
  const spin = () => {
    const m = i < steps ? pool[Math.floor(Math.random() * pool.length)] : pick;
    $('#reel').innerHTML = `<div class="slot__item" style="${gradient(m)}">${m.poster ? `<img src="${escapeHTML(m.poster)}" alt="">` : `<span>${icon(m)}</span>`}<b>${escapeHTML(m.t)}</b></div>`;
    i++;
    if (i <= steps) setTimeout(spin, 40 + i * i * 0.6);
    else setTimeout(() => openMovie(pick, true), 450);
  };
  spin();
}

// ---------- Список «посмотреть позже» ----------
const slim = (m) => ({ id: m.id, kpId: m.kpId, t: m.t, orig: m.orig, y: m.y, g: m.g, country: m.country, r: m.r, rImdb: m.rImdb, d: m.d, s: m.s, poster: m.poster, posterBig: m.posterBig, url: m.url, moods: m.moods });

function toggleSave(id) {
  if (watchlist[id]) delete watchlist[id];
  else { const m = findFilm(id); if (m) watchlist[id] = slim(m); }
  saveList();
  render();
  return Boolean(watchlist[id]);
}

function toastError(text) {
  $('#grid').insertAdjacentHTML('beforebegin', `<p class="error" id="err">${escapeHTML(text)}</p>`);
  setTimeout(() => $('#err')?.remove(), 4000);
}

// ---------- События ----------
document.addEventListener('click', (e) => {
  const col = e.target.closest('[data-col]');
  if (col) {
    state.collection = col.dataset.col;
    state.q = '';
    $('#search').value = '';
    state.tab = 'all';
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === 'all'));
    renderFilters();
    return load();
  }
  const mood = e.target.closest('[data-mood]');
  if (mood) { state.mood = state.mood === mood.dataset.mood ? null : mood.dataset.mood; renderFilters(); return render(); }
  const save = e.target.closest('[data-save]');
  if (save) {
    const on = toggleSave(save.dataset.save);
    if (save.closest('.modal')) { save.textContent = on ? '♥ В списке' : '♡ Посмотреть позже'; save.classList.toggle('btn--primary', !on); }
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) { const m = findFilm(open.dataset.open); if (m) openMovie(m); return; }
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    state.tab = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    return render();
  }
  if (e.target.closest('[data-close]') || e.target.id === 'modal') $('#modal').hidden = true;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value;
    renderFilters();
    load();
  }, 450);
});
$('#genre').addEventListener('change', (e) => { state.genre = e.target.value; render(); });
$('#decade').addEventListener('change', (e) => { state.decade = e.target.value; render(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
$('#moreBtn').addEventListener('click', () => { state.page++; load(false); });
$('#rouletteBtn').addEventListener('click', roulette);

// ---------- Старт ----------
renderFilters();
isOnline().then((ok) => {
  if (!ok) state.sort = 'rating';
  load();
});
