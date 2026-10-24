import { MOVIES, MOODS, GENRE_ICON } from './movies.js';

const $ = (s) => document.querySelector(s);
const LIST_KEY = 'movies_watchlist';
const movies = MOVIES.map((m, i) => ({ ...m, id: i }));

const state = { mood: null, q: '', genre: '', decade: '', sort: 'rating', dur: 210, tab: 'all' };
let watchlist = new Set(read());

function read() { try { return JSON.parse(localStorage.getItem(LIST_KEY)) ?? []; } catch { return []; } }
function persist() { try { localStorage.setItem(LIST_KEY, JSON.stringify([...watchlist])); } catch { /* ignore */ } }

// Постер генерируется из названия: свой градиент для каждого фильма
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
const poster = (m) => {
  const h = hue(m.t);
  return `background: linear-gradient(160deg, hsl(${h} 70% 45%), hsl(${(h + 50) % 360} 70% 18%) 70%, #0c0a0b);`;
};
const hm = (d) => `${Math.floor(d / 60)} ч ${d % 60 ? `${d % 60} мин` : ''}`.trim();
const escapeHTML = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Фильтры ----------
function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = movies.filter((m) =>
    (state.tab === 'all' || watchlist.has(m.id))
    && (!state.mood || m.m.includes(state.mood))
    && (!state.genre || m.g.includes(state.genre))
    && (!state.decade || Math.floor(m.y / 10) * 10 === Number(state.decade))
    && m.d <= state.dur
    && (!q || m.t.toLowerCase().includes(q)));
  const by = { rating: (a, b) => b.r - a.r, new: (a, b) => b.y - a.y, short: (a, b) => a.d - b.d };
  return list.sort(by[state.sort]);
}

function renderFilters() {
  $('#moods').innerHTML = MOODS.map((m) => `<button class="chip ${state.mood === m.id ? 'is-active' : ''}" data-mood="${m.id}">${m.name}</button>`).join('');
  const genres = [...new Set(movies.flatMap((m) => m.g))].sort();
  $('#genre').innerHTML = `<option value="">Все жанры</option>${genres.map((g) => `<option value="${g}">${GENRE_ICON[g] ?? ''} ${g[0].toUpperCase() + g.slice(1)}</option>`).join('')}`;
  const decades = [...new Set(movies.map((m) => Math.floor(m.y / 10) * 10))].sort((a, b) => b - a);
  $('#decade').innerHTML = `<option value="">Любые годы</option>${decades.map((d) => `<option value="${d}">${d}-е</option>`).join('')}`;
}

function card(m) {
  const saved = watchlist.has(m.id);
  return `<article class="movie" data-id="${m.id}">
    <button class="poster" style="${poster(m)}" data-open="${m.id}" aria-label="Подробнее: ${escapeHTML(m.t)}">
      <span class="poster__icon">${GENRE_ICON[m.g[0]] ?? '🎬'}</span>
      <span class="poster__title">${escapeHTML(m.t)}</span>
      <span class="poster__rating">★ ${m.r.toFixed(1)}</span>
    </button>
    <button class="save ${saved ? 'is-on' : ''}" data-save="${m.id}" aria-label="${saved ? 'Убрать из списка' : 'Посмотреть позже'}">${saved ? '♥' : '♡'}</button>
    <div class="movie__meta"><b>${escapeHTML(m.t)}</b><span>${m.y} · ${m.g.join(', ')} · ${hm(m.d)}</span></div>
  </article>`;
}

function render() {
  const list = filtered();
  $('#durLabel').textContent = state.dur >= 210 ? 'любая' : hm(state.dur);
  $('#countAll').textContent = state.tab === 'all' ? list.length : movies.length;
  $('#countList').textContent = watchlist.size;
  $('#grid').innerHTML = list.length
    ? list.map(card).join('')
    : `<div class="empty">${state.tab === 'list' && !watchlist.size ? '♡<p>Добавляйте фильмы сердечком — они появятся здесь.</p>' : '🍿<p>Ничего не нашлось. Попробуйте ослабить фильтры.</p>'}</div>`;
}

// ---------- Карточка фильма ----------
function openMovie(m, fromRoulette = false) {
  const saved = watchlist.has(m.id);
  const q = encodeURIComponent(`${m.t} ${m.y} трейлер`);
  $('#modalBox').innerHTML = `
    <button class="modal__close" data-close aria-label="Закрыть">✕</button>
    <div class="detail">
      <div class="detail__poster" style="${poster(m)}"><span>${GENRE_ICON[m.g[0]] ?? '🎬'}</span></div>
      <div class="detail__body">
        ${fromRoulette ? '<p class="detail__kicker">🎰 Сегодня смотрим</p>' : ''}
        <h2>${escapeHTML(m.t)}</h2>
        <p class="detail__meta"><span class="badge">★ ${m.r.toFixed(1)}</span> ${m.y} · ${hm(m.d)}</p>
        <p class="detail__genres">${m.g.map((g) => `<span>${GENRE_ICON[g] ?? ''} ${g}</span>`).join('')}</p>
        <p class="detail__plot">${escapeHTML(m.s)}</p>
        <div class="detail__actions">
          <button class="btn ${saved ? '' : 'btn--primary'}" data-save="${m.id}">${saved ? '♥ В списке' : '♡ Посмотреть позже'}</button>
          <a class="btn" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">▶ Трейлер</a>
          ${fromRoulette ? '<button class="btn" id="spinAgain">🎰 Ещё раз</button>' : ''}
        </div>
      </div>
    </div>`;
  $('#modal').hidden = false;
  if (fromRoulette) $('#spinAgain').onclick = roulette;
}

// ---------- Рулетка ----------
function roulette() {
  const pool = filtered();
  const source = pool.length ? pool : movies;
  const pick = source[Math.floor(Math.random() * source.length)];
  $('#modalBox').innerHTML = '<div class="slot"><div class="slot__reel" id="reel"></div><p>Выбираем фильм…</p></div>';
  $('#modal').hidden = false;
  const reel = $('#reel');
  let i = 0;
  const steps = 18;
  const spin = () => {
    const m = i < steps ? source[Math.floor(Math.random() * source.length)] : pick;
    reel.innerHTML = `<div class="slot__item" style="${poster(m)}"><span>${GENRE_ICON[m.g[0]] ?? '🎬'}</span><b>${escapeHTML(m.t)}</b></div>`;
    i++;
    if (i <= steps) setTimeout(spin, 40 + i * i * 0.6);
    else setTimeout(() => openMovie(pick, true), 450);
  };
  spin();
}

// ---------- События ----------
function toggleSave(id) {
  if (watchlist.has(id)) watchlist.delete(id); else watchlist.add(id);
  persist();
  render();
}

document.addEventListener('click', (e) => {
  const mood = e.target.closest('[data-mood]');
  if (mood) { state.mood = state.mood === mood.dataset.mood ? null : mood.dataset.mood; renderFilters(); syncSelects(); render(); return; }
  const save = e.target.closest('[data-save]');
  if (save) {
    const id = Number(save.dataset.save);
    toggleSave(id);
    if (!$('#modal').hidden && save.closest('.modal')) {
      const on = watchlist.has(id);
      save.textContent = on ? '♥ В списке' : '♡ Посмотреть позже';
      save.classList.toggle('btn--primary', !on);
    }
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) return openMovie(movies[Number(open.dataset.open)]);
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    state.tab = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    return render();
  }
  if (e.target.closest('[data-close]') || e.target.id === 'modal') $('#modal').hidden = true;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });

function syncSelects() { $('#genre').value = state.genre; $('#decade').value = state.decade; $('#sort').value = state.sort; }
$('#search').addEventListener('input', (e) => { state.q = e.target.value; render(); });
$('#genre').addEventListener('change', (e) => { state.genre = e.target.value; render(); });
$('#decade').addEventListener('change', (e) => { state.decade = e.target.value; render(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
$('#dur').addEventListener('input', (e) => { state.dur = Number(e.target.value); render(); });
$('#rouletteBtn').addEventListener('click', roulette);

renderFilters();
render();
