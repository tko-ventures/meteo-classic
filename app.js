import { fetchForecast, fetchAvailable, render, measure, runLabel } from './render.js';

const $ = (s) => document.querySelector(s);
const els = {
  form: $('#search'), q: $('#q'), results: $('#results'), model: $('#model'), run: $('#run'),
  legend: $('#legend'), scale: $('#scale'), download: $('#download'), share: $('#share'),
  status: $('#status'), stage: $('#stage'), linkbox: $('#linkbox'), linkurl: $('#linkurl'),
  copy: $('#copy'), open: $('#open'),
};
const DEFAULT = { lat: 51.2204544, lon: 18.5700965, name: 'Wieluń' };
const state = { lat: null, lon: null, name: '', model: 'um4_60', legend: true, run: '', data: null, objectUrl: null };
let available = null;
let reqId = 0;

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* prywatne okno */ } },
};

function setStatus(html, isErr = false) {
  els.status.innerHTML = html;
  els.status.classList.toggle('err', isErr);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const fmtRun = (sec) => {
  const d = new Date(sec * 1000);
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)} ${pad2(d.getUTCHours())} UTC`;
};

// współrzędne z tekstu, linku meteo.pl albo app.meteo.pl
function parseCoords(str) {
  const s = str.trim();
  try {
    const u = new URL(s);
    const lat = u.searchParams.get('lat');
    const lng = u.searchParams.get('lng') ?? u.searchParams.get('lon');
    if (lat && lng) return { lat: +lat, lon: +lng };
    const m = u.pathname.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: +m[1], lon: +m[2] };
  } catch { /* nie URL */ }
  const m = s.match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
  if (m) return { lat: +m[1].replace(',', '.'), lon: +m[2].replace(',', '.') };
  return null;
}

async function geocode(q) {
  const u = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=6&accept-language=pl`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('wyszukiwarka miejsc nie odpowiada');
  return r.json();
}
async function reverse(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10&accept-language=pl`);
    if (!r.ok) return '';
    const j = await r.json();
    return j.name || '';
  } catch { return ''; }
}

function hideResults() { els.results.hidden = true; els.results.innerHTML = ''; }
function showResults(list) {
  els.results.innerHTML = '';
  for (const p of list) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const rest = p.display_name.split(',').slice(1, 4).join(',').trim();
    b.innerHTML = `${esc(p.name || p.display_name.split(',')[0])} <small>${esc(rest)}</small>`;
    b.addEventListener('click', () => {
      hideResults();
      choose(+p.lat, +p.lon, p.name || p.display_name.split(',')[0]);
    });
    li.append(b);
    els.results.append(li);
  }
  els.results.hidden = false;
  els.results.querySelector('button')?.focus();
}

function choose(lat, lon, name) {
  state.lat = lat; state.lon = lon; state.name = name || '';
  els.q.value = name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  store.set('loc', { lat, lon, name: state.name });
  draw();
}

async function loadRuns() {
  try {
    if (!available) available = await fetchAvailable();
    const runs = (available[state.model] || []).slice().sort((a, b) => b - a);
    const cur = state.run;
    els.run.innerHTML = '<option value="">najnowszy</option>' +
      runs.map((r) => `<option value="${r}">${fmtRun(r)}</option>`).join('');
    els.run.value = runs.includes(+cur) ? cur : '';
    state.run = els.run.value;
  } catch { /* lista przebiegów jest opcjonalna */ }
}

function renderToCanvas(scale) {
  const opts = {
    legend: state.legend,
    title: state.name || `${state.lat.toFixed(3)}, ${state.lon.toFixed(3)}`,
    subtitle: runLabel(state.data, state.model),
  };
  const { width, height } = measure(state.data, opts);
  const c = document.createElement('canvas');
  c.width = Math.round(width * scale);
  c.height = Math.round(height * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  render(ctx, state.data, opts);
  return { canvas: c, width, height };
}

function show() {
  const dpr = Math.min(3, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
  const { canvas, width, height } = renderToCanvas(dpr);
  canvas.toBlob((blob) => {
    if (!blob) return;
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(blob);
    const img = new Image(width, height);
    img.src = state.objectUrl;
    img.alt = `Meteogram dla: ${state.name || 'wybranego punktu'}`;
    els.stage.replaceChildren(img);
  }, 'image/png');
}

// adresy jak w app.meteo.pl: /meteogram/51.22,18.57 (strona) i /meteogram/51.22,18.57.png (obrazek)
const coordPath = () => `/meteogram/${+state.lat.toFixed(4)},${+state.lon.toFixed(4)}`;
function coordsFromPath(pathname) {
  const m = decodeURIComponent(pathname).match(/^\/meteogram\/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\/?$/);
  return m ? { lat: +m[1], lon: +m[2] } : null;
}
function extraParams(u) {
  if (state.name) u.searchParams.set('name', state.name);
  if (state.model !== 'um4_60') u.searchParams.set('model', state.model);
  if (!state.legend) u.searchParams.set('legend', '0');
  return u;
}

function syncUrl() {
  history.replaceState(null, '', extraParams(new URL(coordPath(), location.origin)));
}

function pngLink() {
  return extraParams(new URL(`${coordPath()}.png`, location.origin)).toString();
}

async function draw() {
  if (state.lat == null) return;
  const id = ++reqId;
  els.download.disabled = true;
  els.share.disabled = true;
  els.linkbox.classList.remove('show');
  setStatus(`Pobieranie prognozy dla <b>${esc(state.name || `${state.lat.toFixed(3)}, ${state.lon.toFixed(3)}`)}</b>…`);
  syncUrl();
  try {
    const data = await fetchForecast({ lat: state.lat, lon: state.lon, model: state.model, date: state.run || null });
    if (id !== reqId) return;
    state.data = data;
    if (!state.name) {
      state.name = await reverse(state.lat, state.lon);
      if (state.name) { els.q.value = state.name; syncUrl(); }
    }
    show();
    const pt = data.point || {};
    setStatus(`<b>${esc(state.name || 'Punkt')}</b> · ${runLabel(data, state.model)} · punkt siatki ${pt.lat?.toFixed?.(4) ?? state.lat}, ${pt.lon?.toFixed?.(4) ?? state.lon}`);
    els.download.disabled = false;
    els.share.disabled = false;
  } catch (e) {
    if (id !== reqId) return;
    setStatus(`Nie udało się pobrać prognozy: ${esc(e.message)}. Punkt musi leżeć w obszarze modelu UM (Polska i okolice).`, true);
  }
}

els.form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const q = els.q.value.trim();
  if (!q) return;
  const c = parseCoords(q);
  if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) { hideResults(); choose(c.lat, c.lon, ''); return; }
  setStatus('Szukam…');
  try {
    const list = await geocode(q);
    if (!list.length) { setStatus(`Nie znaleziono: <b>${esc(q)}</b>`, true); return; }
    setStatus('');
    if (list.length === 1) choose(+list[0].lat, +list[0].lon, list[0].name);
    else showResults(list);
  } catch (e) {
    setStatus(`Błąd wyszukiwania: ${esc(e.message)}`, true);
  }
});
document.addEventListener('click', (e) => { if (!els.form.contains(e.target)) hideResults(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideResults(); });

els.model.addEventListener('change', async () => {
  state.model = els.model.value; state.run = '';
  store.set('model', state.model);
  await loadRuns();
  draw();
});
els.run.addEventListener('change', () => { state.run = els.run.value; draw(); });
els.legend.addEventListener('change', () => {
  state.legend = els.legend.checked;
  store.set('legend', state.legend);
  if (state.data) { show(); syncUrl(); }
});
els.download.addEventListener('click', () => {
  const { canvas } = renderToCanvas(Number(els.scale.value) || 1);
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    const slug = (state.name || 'punkt').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-');
    const d = new Date(state.data.fstart);
    a.download = `meteogram-${slug}-${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}.png`;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
});
els.share.addEventListener('click', () => {
  const link = pngLink();
  els.linkurl.value = link;
  els.open.href = link;
  els.linkbox.classList.add('show');
  els.linkurl.select();
});
els.copy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(els.linkurl.value); els.copy.textContent = 'Skopiowano'; }
  catch { els.linkurl.select(); document.execCommand?.('copy'); els.copy.textContent = 'Skopiowano'; }
  setTimeout(() => { els.copy.textContent = 'Kopiuj'; }, 1500);
});

// start: parametry z adresu > ostatnia lokalizacja > Wieluń
(async function init() {
  const p = new URLSearchParams(location.search);
  const fromPath = coordsFromPath(location.pathname);
  const lat = fromPath ? fromPath.lat : parseFloat(p.get('lat'));
  const lon = fromPath ? fromPath.lon : parseFloat(p.get('lng') ?? p.get('lon'));
  state.model = p.get('model') === 'um4_120' ? 'um4_120' : (store.get('model') || 'um4_60');
  state.legend = p.has('legend') ? !(p.get('legend') === '0' || p.get('legend') === 'false') : (store.get('legend') ?? true);
  els.model.value = state.model;
  els.legend.checked = state.legend;
  await loadRuns();
  if (Number.isFinite(lat) && Number.isFinite(lon)) choose(lat, lon, p.get('name') || '');
  else {
    const last = store.get('loc');
    if (last && Number.isFinite(last.lat)) choose(last.lat, last.lon, last.name);
    else choose(DEFAULT.lat, DEFAULT.lon, DEFAULT.name);
  }
})();
