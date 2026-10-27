// render.js — rysuje meteogram w układzie starego meteo.pl (UM 4 km) na kontekście 2D canvas.
// Działa w przeglądarce (HTMLCanvasElement) i w Node (@napi-rs/canvas).

export const FONT = "Arial, 'Liberation Sans', Helvetica, sans-serif";
export const API = 'https://devmgramapi.meteo.pl';
export const TZ = 'Europe/Warsaw';

// ---------- palety ICM (z kodu meteo.pl) ----------
function expand(spec) {
  const out = [];
  for (const [n, c] of spec) for (let i = 0; i < n; i++) out.push(`rgb(${c})`);
  return out;
}
const PRESSURE_PALETTE = expand([
  [48, '245,245,245'],
  ...[
    '235,240,240', '210,230,230', '195,220,220', '180,210,210', '165,200,200', '150,190,190',
    '135,180,185', '120,170,180', '105,165,170', '90,160,160', '75,140,160', '60,120,140',
    '45,90,110', '30,70,90', '15,50,70', '15,35,90', '15,20,130', '15,35,150', '15,60,180',
    '15,90,210', '15,120,240', '15,150,255', '15,180,255', '15,220,255', '15,255,255',
    '0,255,210', '0,235,140', '0,205,70', '0,170,0', '0,205,0', '50,235,0', '100,255,0',
    '150,255,0', '200,255,20', '255,255,0', '255,215,0', '255,175,0', '255,135,0', '250,95,0',
    '245,55,0', '240,25,0', '235,0,30', '230,15,60', '225,30,90', '220,45,120', '215,60,150',
    '210,75,180', '205,90,210', '215,105,240', '225,120,255', '235,135,255', '245,150,255',
    '255,165,255', '245,180,245', '235,195,235', '225,205,225', '215,215,215', '220,220,220',
    '225,225,225', '230,230,230', '235,235,235', '240,240,240',
  ].map((c) => [3, c]),
  [21, '245,245,245'],
  [1, '0,0,0'],
]);
const WIND_PALETTE = expand([
  ...[
    '128,255,255', '0,255,255', '0,195,255', '0,130,255', '0,75,130', '0,130,0', '30,200,0',
    '75,255,30', '130,255,75', '200,255,130', '255,255,75', '255,200,0', '255,130,0',
    '200,75,0', '130,30,0', '130,10,10', '200,20,20', '255,40,40', '255,75,75', '255,130,130',
    '255,130,255', '220,90,220', '200,60,200', '180,30,180', '160,0,160', '90,30,90',
    '120,60,120', '150,90,150', '180,120,180', '210,150,210',
  ].map((c) => [5, c]),
  [105, '230,180,230'],
  [1, '0,0,0'],
]);
const clampIdx = (i) => Math.max(0, Math.min(255, i));
const pressureColor = (hpa) => PRESSURE_PALETTE[clampIdx(Math.trunc(((hpa - 915) / 170) * 256) + 1)];
const windColor = (ms) => WIND_PALETTE[clampIdx(Math.trunc((Math.abs(ms) / 54) * 256))];

// ---------- kolory i geometria ----------
const C = {
  page: '#FFFBF0',
  day: '#FFFFFF',
  night: '#E0E0E0',
  skyDay: '#87CEFA',
  skyNight: '#82BEE6',
  navy: '#000080',
  air: '#FF0000',
  airBand: '#FADCDC',
  chill: '#0000FF',
  chillBand: '#B9DCFF',
  dew: '#6A5ACD',
  ground: '#A52A2A',
  hum: '#D2581E',
  // [średni (słupek), max (cienka linia)]
  rain: ['#00A500', '#1F6E1F'],
  snow: ['#1932BE', '#0F2382'],
  mixed: ['#B414B4', '#6E0F6E'],
  overflow: '#D21E1E',
  storm: ['#F7E39C', '#D9AD7C', '#A32732'],
  stormEdge: '#231000',
  grid: '#222222',
  gust: '#B41E1E',
  windLine: '#111199',
  vis: '#FF9600',
  visText: '#D98E00',
  cldTop: '#A52A2A',
  cb: ['#FAFFFF', '#C8C8C8', '#969696', '#5A5A5A', '#000000'],
  cHigh: '#FFFFFF',
  cMed: '#969696',
  cLow: '#5A5A5A',
  cVlow: '#3C3C3C',
  fog: '#FFB400',
};

const PANELS = {
  temp: [57, 135],
  precip: [144, 221],
  pres: [230, 308],
  wind: [317, 395],
  dir: [401, 431],
  cb: [438, 516],
  cc: [525, 603],
};
const STRIP = [29, 630];
const CHART_H = 660;
const PX0 = 63; // lewa krawędź wykresu
const PXH = 415 / 59; // pikseli na godzinę (oryginał: 415 px na 59 h)
const RIGHT_MARGIN = 62;
const LEGEND_W = 280;

const DAYS = ['nie', 'pon', 'wto', 'śro', 'czw', 'pią', 'sob'];
const pad2 = (n) => String(n).padStart(2, '0');
const font = (px, bold = false) => `${bold ? 'bold ' : ''}${px}px ${FONT}`;

// ---------- dane ----------
export function normalizeApi(json) {
  const d = json.data || json;
  const keys = Object.keys(d).filter((k) => d[k] && Array.isArray(d[k].data));
  if (!keys.length) throw new Error('Brak danych w odpowiedzi API');
  const ref = d.airtmp_point || d[keys[0]];
  const s = {};
  for (const k of keys) {
    s[k] = d[k].data.map((v) => (v == null || !Number.isFinite(v) || v < -1e6 ? null : v));
  }
  const n = Math.max(...keys.map((k) => s[k].length));
  return {
    t0: Number(ref.first_timestamp) * 1000,
    dt: (ref.interval || 3600) * 1000,
    n,
    s,
    point: ref.point || {},
    fstart: Date.parse(json.fstart || ref.fstart),
  };
}

// Wind chill (wzór JAG/TI). Nowe API powyżej 10°C zwraca temperaturę powietrza,
// stary meteogram liczył odczuwalną także wtedy — odtwarzamy to.
const WCI = (t, ms) => {
  const v = ms * 3.6;
  if (t == null || ms == null || v < 4.8) return t;
  const p = Math.pow(v, 0.16);
  return 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p;
};
function fixChill(D) {
  for (let i = 0; i < D.air.length; i++) {
    const w = D.ws[i];
    if (D.wc[i] != null && D.air[i] != null && D.air[i] > 10 && Math.abs(D.wc[i] - D.air[i]) < 0.01) D.wc[i] = WCI(D.air[i], w);
    if (D.wcMax[i] != null && D.airMax[i] != null && D.airMax[i] > 10 && Math.abs(D.wcMax[i] - D.airMax[i]) < 0.01) D.wcMax[i] = WCI(D.airMax[i], w);
    if (D.wcMin[i] != null && D.airMin[i] != null && D.airMin[i] > 10 && Math.abs(D.wcMin[i] - D.airMin[i]) < 0.01) D.wcMin[i] = WCI(D.airMin[i], w);
    if (D.wcMin[i] != null && D.wc[i] != null) D.wcMin[i] = Math.min(D.wcMin[i], D.wc[i]);
    if (D.wcMax[i] != null && D.wc[i] != null) D.wcMax[i] = Math.max(D.wcMax[i], D.wc[i]);
  }
  return D;
}

function seriesFromModel(m) {
  const s = m.s;
  const g = (k) => s[k] || new Array(m.n).fill(null);
  const pos = (k) => g(k).map((v) => (v != null && v > 0 ? v : null));
  return {
    air: g('airtmp_point'),
    airMin: g('airtmp_min'),
    airMax: g('airtmp_max'),
    wc: g('wchill_point'),
    wcMin: g('wchill_min'),
    wcMax: g('wchill_max'),
    dew: g('dwptmp_point'),
    grdMin: g('grdtmp_min'),
    grdMax: g('grdtmp_max'),
    pAvg: g('pcpttl_aver'),
    pMax: g('pcpttl_max'),
    pType: g('pcpttl_type_max'),
    storm: g('storm_max'),
    flash: g('flash_max'),
    hum: g('realhum_aver'),
    slp: g('slpres_point').map((v) => (v == null ? null : v / 100)),
    trp: g('trpres_point').map((v) => (v == null ? null : v / 100)),
    ws: g('wind10_sd_true_prev_point'),
    wd: g('wind10_dr_deg_true_prev_point'),
    gust: g('wind_gust_max'),
    vis: g('visibl_min').map((v) => (v != null && v > 0 ? v / 1000 : null)),
    cb: [pos('cldbse01'), pos('cldbse25'), pos('cldbse45'), pos('cldbse65'), pos('cldbse79')],
    ctop: pos('cldtop'),
    chigh: g('cldhigh_aver'),
    cmed: g('cldmed_aver'),
    clow: g('cldlow_aver'),
    cvlow: g('cldvlow_aver'),
    fog: g('fog_max'),
  };
}

// ---------- czas i słońce ----------
const RAD = Math.PI / 180;
export function solarAltitude(ms, lat, lon) {
  const d = ms / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const h = (gmst * 15 + lon) * RAD - ra;
  const alt = Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(h));
  return alt / RAD;
}
const isNight = (ms, lat, lon) => solarAltitude(ms, lat, lon) < -0.833;

const dtfCache = new Map();
export function localParts(ms, tz = TZ) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    dtfCache.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const y = +p.year, mo = +p.month, d = +p.day, h = +p.hour % 24, mi = +p.minute;
  const offsetMin = Math.round((Date.UTC(y, mo - 1, d, h, mi) - Math.floor(ms / 60000) * 60000) / 60000);
  return {
    y, mo, d, h, mi,
    wd: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(),
    offsetMin,
    abbr: offsetMin === 60 ? 'CET' : offsetMin === 120 ? 'CEST' : `UTC${offsetMin >= 0 ? '+' : ''}${offsetMin / 60}`,
  };
}

// wschód/zachód dla doby lokalnej zawierającej ms
function sunTimes(ms, lat, lon, tz) {
  const p = localParts(ms, tz);
  const start = Date.UTC(p.y, p.mo - 1, p.d) - p.offsetMin * 60000;
  let rise = null, set = null;
  let prev = isNight(start, lat, lon);
  for (let t = start + 60000; t <= start + 86400000; t += 60000) {
    const n = isNight(t, lat, lon);
    if (prev && !n && rise == null) rise = t;
    if (!prev && n && set == null) set = t;
    prev = n;
  }
  return { rise, set, dayStart: start };
}

// ---------- pomocnicze rysowanie ----------
function scale(panel, lo, hi) {
  const [top, bot] = panel;
  return { top, bot, lo, hi, y: (v) => bot - ((v - lo) / (hi - lo)) * (bot - top) };
}
function clipRect(ctx, x0, y0, x1, y1) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
}
function polyline(ctx, xs, ys, color, width) {
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < xs.length; i++) {
    if (ys[i] == null || Number.isNaN(ys[i])) { pen = false; continue; }
    if (!pen) { ctx.moveTo(xs[i], ys[i]); pen = true; } else ctx.lineTo(xs[i], ys[i]);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}
function band(ctx, xs, lo, hi, color) {
  // obszar między dwiema seriami (pomija przerwy)
  let i = 0;
  while (i < xs.length) {
    while (i < xs.length && (lo[i] == null || hi[i] == null)) i++;
    let j = i;
    while (j < xs.length && lo[j] != null && hi[j] != null) j++;
    if (j - i >= 1) {
      ctx.beginPath();
      ctx.moveTo(xs[i], hi[i]);
      for (let k = i + 1; k < j; k++) ctx.lineTo(xs[k], hi[k]);
      for (let k = j - 1; k >= i; k--) ctx.lineTo(xs[k], lo[k]);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    i = j;
  }
}
function areaFromBase(ctx, xs, ys, base, color) {
  const lo = xs.map(() => base);
  band(ctx, xs, lo, ys, color);
}
function dot(ctx, x, y, r, fill, stroke, lw = 1) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function text(ctx, s, x, y, { color = '#000', align = 'left', size = 12, bold = false, baseline = 'alphabetic' } = {}) {
  ctx.font = font(size, bold);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(s, x, y);
}
function vtext(ctx, s, x, yc, color, size = 12) {
  ctx.save();
  ctx.translate(x, yc);
  ctx.rotate(-Math.PI / 2);
  ctx.font = font(size);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, 0, 0);
  ctx.restore();
}
function fitSize(ctx, s, maxW, size = 12, min = 9) {
  let sz = size;
  ctx.font = font(sz);
  while (sz > min && ctx.measureText(s).width > maxW) { sz -= 0.5; ctx.font = font(sz); }
  return sz;
}
// liniowa projekcja na nieliniowej skali (jak w meteo.pl)
function projectPiecewise(v, labels, cap) {
  if (v == null) return null;
  const r = Math.max(0, Math.min(v, cap));
  const step = 1 / (labels.length - 1);
  let k = 0;
  while (k < labels.length - 2 && r > labels[k + 1]) k++;
  const f = k * step + ((r - labels[k]) / (labels[k + 1] - labels[k])) * step;
  return f > 0 ? f : null;
}
function niceRange(min, max, padding, steps) {
  const span = max - min + 2 * padding;
  const step = steps.find((s) => span / s <= 5) || steps[steps.length - 1];
  return { lo: Math.floor((min - padding) / step) * step, hi: Math.ceil((max + padding) / step) * step, step };
}
const finite = (arrs) => arrs.flat().filter((v) => v != null && Number.isFinite(v));
const ticksOf = (lo, hi, step) => {
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
};

// ---------- geometria osi czasu ----------
function makeLayout({ n, px0, pxh, t0, dt }) {
  const pxR = px0 + (n - 1) * pxh;
  return {
    n, px0, pxh, pxR, t0, dt,
    xi: (i) => px0 + i * pxh,
    xt: (t) => px0 + ((t - t0) / dt) * pxh,
    xs: Array.from({ length: n }, (_, i) => px0 + i * pxh),
  };
}
function nightSegments(lay, lat, lon) {
  const segs = [];
  let start = null;
  for (let x = lay.px0; x <= lay.pxR; x += 1) {
    const t = lay.t0 + ((x - lay.px0 + 0.5) / lay.pxh) * lay.dt;
    const n = isNight(t, lat, lon);
    if (n && start == null) start = x;
    if (!n && start != null) { segs.push([start, x]); start = null; }
  }
  if (start != null) segs.push([start, lay.pxR]);
  return segs;
}

// ---------- rysowanie paneli ----------
function drawStrip(ctx, lay, segs) {
  ctx.fillStyle = C.day;
  ctx.fillRect(lay.px0, STRIP[0], lay.pxR - lay.px0, STRIP[1] - STRIP[0]);
  ctx.fillStyle = C.night;
  for (const [a, b] of segs) ctx.fillRect(a, STRIP[0], b - a, STRIP[1] - STRIP[0]);
}
function drawSky(ctx, lay, segs, panel) {
  const [top, bot] = panel;
  ctx.fillStyle = C.skyDay;
  ctx.fillRect(lay.px0, top, lay.pxR - lay.px0, bot - top);
  ctx.fillStyle = C.skyNight;
  for (const [a, b] of segs) ctx.fillRect(a, top, b - a, bot - top);
}
function drawGrid(ctx, lay, panel, ys, vxs) {
  const [top, bot] = panel;
  ctx.save();
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  for (const x of vxs) {
    const xx = Math.round(x) + 0.5;
    ctx.moveTo(xx, top);
    ctx.lineTo(xx, bot);
  }
  for (const y of ys) {
    const yy = Math.round(y) + 0.5;
    if (yy <= top + 1 || yy >= bot - 1) continue;
    ctx.moveTo(lay.px0, yy);
    ctx.lineTo(lay.pxR, yy);
  }
  ctx.stroke();
  ctx.restore();
}
function drawFrame(ctx, lay, panel) {
  const [top, bot] = panel;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(Math.round(lay.px0) + 0.5, top + 0.5, Math.round(lay.pxR - lay.px0), bot - top);
}
function tickLabels(ctx, lay, sc, ticks, fmt, side, color = '#000') {
  for (const v of ticks) {
    const y = sc.y(v);
    if (side === 'left') text(ctx, fmt(v), lay.px0 - 6, y, { align: 'right', baseline: 'middle', color });
    else text(ctx, fmt(v), lay.pxR + 6, y, { align: 'left', baseline: 'middle', color });
  }
}

function drawTemp(ctx, lay, D, sc) {
  const y = (arr) => arr.map((v) => (v == null ? null : sc.y(v)));
  band(ctx, lay.xs, y(D.airMin), y(D.airMax), C.airBand);
  band(ctx, lay.xs, y(D.wcMin), y(D.wcMax), C.chillBand);
  ctx.strokeStyle = C.ground;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < lay.n; i++) {
    if (D.grdMin[i] == null || D.grdMax[i] == null) continue;
    const x = Math.round(lay.xs[i]) + 0.5;
    ctx.moveTo(x, sc.y(D.grdMax[i]));
    ctx.lineTo(x, sc.y(D.grdMin[i]));
  }
  ctx.stroke();
  for (let i = 0; i < lay.n; i++) if (D.dew[i] != null) dot(ctx, lay.xs[i], sc.y(D.dew[i]), 1.7, C.dew);
  polyline(ctx, lay.xs, y(D.wc), C.chill, 2);
  polyline(ctx, lay.xs, y(D.air), C.air, 2);
}

function precipColors(type) {
  return type === 2 ? C.snow : type === 3 ? C.mixed : C.rain;
}
function drawPrecip(ctx, lay, D, sc, hum) {
  const w = lay.pxh;
  for (let i = 0; i < lay.n; i++) {
    const avg = D.pAvg[i] || 0;
    const mx = D.pMax[i] || 0;
    if (avg <= 0 && mx <= 0) continue;
    const [cAvg, cMax] = precipColors(D.pType[i]);
    const x1 = lay.xs[i], x0 = x1 - w;
    const yy = Math.round(sc.y(Math.min(avg, sc.hi)));
    if (avg > 0 && yy < sc.bot) {
      const xa = Math.round(x0), xb = Math.round(x1);
      ctx.fillStyle = cAvg;
      ctx.fillRect(xa, yy, xb - xa, sc.bot - yy);
    }
    if (mx > 0) {
      const xm = Math.round(x0 + w / 2) + 0.5;
      ctx.strokeStyle = cMax;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xm, sc.bot);
      ctx.lineTo(xm, Math.min(sc.bot - 1, Math.round(sc.y(Math.min(mx, sc.hi)))));
      ctx.stroke();
      if (mx > sc.hi) {
        ctx.fillStyle = C.overflow;
        ctx.fillRect(Math.round(x0 + w / 2) - 1, sc.top + 2, 3, 3);
      }
    }
  }
  polyline(ctx, lay.xs, D.hum.map((v) => (v == null ? null : hum.y(Math.max(hum.lo, v)))), C.hum, 2);
  const yStorm = sc.bot - 0.62 * (sc.bot - sc.top);
  for (let i = 0; i < lay.n; i++) {
    if (!(D.storm[i] > 0)) continue;
    const f = D.flash[i] || 0;
    const fill = f >= 30 ? C.storm[2] : f >= 10 ? C.storm[1] : C.storm[0];
    dot(ctx, lay.xs[i] - w / 2, yStorm, 2.5, fill, C.stormEdge, 1);
  }
}

function drawPressure(ctx, lay, D, sc) {
  const p = D.slp;
  for (let i = 0; i < lay.n - 1; i++) {
    if (p[i] == null || p[i + 1] == null) continue;
    const x0 = lay.xs[i], x1 = lay.xs[i + 1];
    ctx.beginPath();
    ctx.moveTo(x0, sc.bot);
    ctx.lineTo(x0, sc.y(p[i]));
    ctx.lineTo(x1, sc.y(p[i + 1]));
    ctx.lineTo(x1 + 0.6, sc.y(p[i + 1]));
    ctx.lineTo(x1 + 0.6, sc.bot);
    ctx.closePath();
    ctx.fillStyle = pressureColor((p[i] + p[i + 1]) / 2);
    ctx.fill();
  }
  polyline(ctx, lay.xs, p.map((v) => (v == null ? null : sc.y(v))), '#000', 2);
}

function drawWind(ctx, lay, D, sc) {
  const v = D.ws;
  for (let i = 0; i < lay.n - 1; i++) {
    if (v[i] == null || v[i + 1] == null) continue;
    const x0 = lay.xs[i], x1 = lay.xs[i + 1];
    ctx.beginPath();
    ctx.moveTo(x0, sc.bot);
    ctx.lineTo(x0, sc.y(v[i]));
    ctx.lineTo(x1, sc.y(v[i + 1]));
    ctx.lineTo(x1 + 0.6, sc.y(v[i + 1]));
    ctx.lineTo(x1 + 0.6, sc.bot);
    ctx.closePath();
    ctx.fillStyle = windColor((v[i] + v[i + 1]) / 2);
    ctx.fill();
  }
  polyline(ctx, lay.xs, v.map((x) => (x == null ? null : sc.y(x))), C.windLine, 2);
  ctx.strokeStyle = C.gust;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < lay.n; i++) {
    const g = D.gust[i];
    if (g == null) continue;
    if (g > sc.hi) continue;
    const yy = Math.round(sc.y(g)) + 0.5;
    ctx.moveTo(lay.xs[i] - lay.pxh, yy);
    ctx.lineTo(lay.xs[i], yy);
  }
  ctx.stroke();
  for (let i = 0; i < lay.n; i++) {
    const g = D.gust[i];
    if (g != null && g > sc.hi) {
      const x = lay.xs[i] - lay.pxh / 2;
      ctx.beginPath();
      ctx.moveTo(x - 3, sc.top + 1);
      ctx.lineTo(x + 3, sc.top + 1);
      ctx.lineTo(x, sc.top + 6);
      ctx.closePath();
      ctx.fillStyle = C.overflow;
      ctx.fill();
    }
  }
}

function arrow(ctx, x, y, towardDeg, len, color) {
  const a = towardDeg * RAD;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const hx = x + (dx * len) / 2, hy = y + (dy * len) / 2;
  const tx = x - (dx * len) / 2, ty = y - (dy * len) / 2;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(hx - dx * 3, hy - dy * 3);
  ctx.stroke();
  const hl = 5, hw = 2.6;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx - dx * hl - dy * hw, hy - dy * hl + dx * hw);
  ctx.lineTo(hx - dx * hl + dy * hw, hy - dy * hl - dx * hw);
  ctx.closePath();
  ctx.fill();
}
function drawDir(ctx, lay, D, panel) {
  const yc = (panel[0] + panel[1]) / 2;
  for (let i = 0; i < lay.n; i++) {
    if (D.wd[i] == null) continue;
    arrow(ctx, lay.xs[i], yc, D.wd[i] + 180, 14, C.windLine);
  }
}

const CB_LABELS = [0, 0.5, 2, 7, 15];
const VIS_LABELS = [0, 1, 5, 20, 100];
function drawCloudBase(ctx, lay, D, panel) {
  const [top, bot] = panel;
  const yf = (f) => (f == null ? null : bot - f * (bot - top));
  polyline(ctx, lay.xs, D.vis.map((v) => yf(projectPiecewise(v, VIS_LABELS, 90))), C.vis, 2);
  const put = (arr, fill, stroke) => {
    for (let i = 0; i < lay.n; i++) {
      const f = projectPiecewise(arr[i], CB_LABELS, 14);
      if (f == null) continue;
      dot(ctx, lay.xs[i], yf(f), 2.8, fill, stroke, 0.8);
    }
  };
  put(D.ctop, C.cldTop);
  put(D.cb[0], C.cb[0], '#969696');
  put(D.cb[1], C.cb[1]);
  put(D.cb[2], C.cb[2]);
  put(D.cb[3], C.cb[3]);
  put(D.cb[4], C.cb[4]);
}

function drawCloudCover(ctx, lay, D, panel) {
  const sc = scale(panel, 0, 8);
  const y = (arr) => arr.map((v) => (v == null ? null : sc.y(Math.max(0, Math.min(1, v)) * 8)));
  areaFromBase(ctx, lay.xs, y(D.chigh), sc.bot, C.cHigh);
  areaFromBase(ctx, lay.xs, y(D.cmed), sc.bot, C.cMed);
  areaFromBase(ctx, lay.xs, y(D.clow), sc.bot, C.cLow);
  areaFromBase(ctx, lay.xs, y(D.cvlow), sc.bot, C.cVlow);
  polyline(ctx, lay.xs, y(D.cmed), C.cMed, 1.5);
  polyline(ctx, lay.xs, y(D.chigh), C.cHigh, 1.5);
  for (let i = 0; i < lay.n; i++) {
    const f = D.fog[i];
    if (!(f > 0)) continue;
    const h = Math.max(1, Math.min(1, f) * (sc.bot - sc.top));
    ctx.fillStyle = C.fog;
    ctx.fillRect(lay.xs[i] - 1.5, sc.bot - h, 3, h);
  }
}

function compass(ctx, x, yc) {
  text(ctx, 'N', x, yc - 5, { align: 'center', size: 11, color: C.navy });
  text(ctx, 'S', x, yc + 9, { align: 'center', size: 11, color: C.navy });
  text(ctx, 'W', x - 8, yc + 2, { align: 'center', size: 11, color: C.navy });
  text(ctx, 'E', x + 7, yc + 2, { align: 'center', size: 11, color: C.navy });
}

// ---------- skale ----------
function computeScales(D) {
  const tVals = finite([D.air, D.airMin, D.airMax, D.wc, D.wcMin, D.wcMax, D.dew, D.grdMin, D.grdMax]);
  const tMin = Math.min(...tVals), tMax = Math.max(...tVals);
  const tSpan = tMax - tMin + 2;
  const tStep = tSpan <= 22 ? 5 : tSpan <= 45 ? 10 : 20;
  const temp = { lo: tMin - 1, hi: tMax + 1, step: tStep };

  const pm = Math.max(0, ...finite([D.pMax, D.pAvg]));
  const precip = pm <= 5 ? { hi: 5, step: 1 } : pm <= 10 ? { hi: 10, step: 2 } : pm <= 20 ? { hi: 20, step: 4 } : { hi: 30, step: 6 };
  precip.lo = 0;

  const pv = finite([D.slp]);
  const pres = pv.length ? niceRange(Math.min(...pv), Math.max(...pv), 1, [2, 5, 10, 20]) : { lo: 1000, hi: 1020, step: 5 };

  const ws = finite([D.ws]), gs = finite([D.gust]);
  const a = ws.length ? Math.max(...ws) : 0, gmax = gs.length ? Math.max(...gs) : 0;
  const nmax = Math.round(Math.min(Math.max(a, gmax), 4 * a));
  const wind = nmax <= 5 ? { hi: 5, step: 1 } : nmax <= 10 ? { hi: 10, step: 2 } : nmax <= 15 ? { hi: 15, step: 5 }
    : nmax <= 20 ? { hi: 20, step: 5 } : nmax <= 25 ? { hi: 25, step: 5 } : nmax <= 30 ? { hi: 30, step: 10 }
      : nmax <= 40 ? { hi: 40, step: 10 } : { hi: 50, step: 10 };
  wind.lo = 0;
  return { temp, precip, pres, wind };
}

// ---------- wspólne rysowanie całego zestawu paneli ----------
function drawPanels(ctx, lay, D, R, segs, vgrid, presRightHpa = false) {
  drawStrip(ctx, lay, segs);
  drawSky(ctx, lay, segs, PANELS.cb);
  drawSky(ctx, lay, segs, PANELS.cc);

  const clipP = (p) => clipRect(ctx, lay.px0, p[0], lay.pxR + 1, p[1] + 1);

  const tS = scale(PANELS.temp, R.temp.lo, R.temp.hi);
  const tT = ticksOf(R.temp.lo, R.temp.hi, R.temp.step);
  if (R.temp.lo < 0) {
    const y0 = Math.max(PANELS.temp[0], Math.min(PANELS.temp[1], tS.y(0)));
    drawSky(ctx, lay, segs, [y0, PANELS.temp[1]]);
  }
  clipP(PANELS.temp); drawTemp(ctx, lay, D, tS); drawGrid(ctx, lay, PANELS.temp, tT.map(tS.y), vgrid); ctx.restore();

  const pS = scale(PANELS.precip, R.precip.lo, R.precip.hi);
  const pT = ticksOf(R.precip.lo, R.precip.hi, R.precip.step);
  const hS = scale(PANELS.precip, 50, 100);
  clipP(PANELS.precip); drawPrecip(ctx, lay, D, pS, hS); drawGrid(ctx, lay, PANELS.precip, pT.map(pS.y), vgrid); ctx.restore();

  const prS = scale(PANELS.pres, R.pres.lo, R.pres.hi);
  const prT = ticksOf(R.pres.lo, R.pres.hi, R.pres.step);
  clipP(PANELS.pres); drawPressure(ctx, lay, D, prS); drawGrid(ctx, lay, PANELS.pres, prT.map(prS.y), vgrid); ctx.restore();

  const wS = scale(PANELS.wind, R.wind.lo, R.wind.hi);
  const wT = ticksOf(R.wind.lo, R.wind.hi, R.wind.step);
  clipP(PANELS.wind); drawWind(ctx, lay, D, wS); drawGrid(ctx, lay, PANELS.wind, wT.map(wS.y), vgrid); ctx.restore();

  clipP(PANELS.dir); drawGrid(ctx, lay, PANELS.dir, [], vgrid); drawDir(ctx, lay, D, PANELS.dir); ctx.restore();

  const fr = [0, 0.25, 0.5, 0.75, 1];
  const cbY = (f) => PANELS.cb[1] - f * (PANELS.cb[1] - PANELS.cb[0]);
  clipP(PANELS.cb); drawCloudBase(ctx, lay, D, PANELS.cb); drawGrid(ctx, lay, PANELS.cb, fr.map(cbY), vgrid); ctx.restore();

  const ccS = scale(PANELS.cc, 0, 8);
  clipP(PANELS.cc); drawCloudCover(ctx, lay, D, PANELS.cc); drawGrid(ctx, lay, PANELS.cc, [0, 2, 4, 6, 8].map(ccS.y), vgrid); ctx.restore();

  for (const p of Object.values(PANELS)) drawFrame(ctx, lay, p);

  // etykiety osi
  const intFmt = (v) => String(Math.round(v));
  tickLabels(ctx, lay, tS, tT, intFmt, 'left');
  tickLabels(ctx, lay, tS, tT, intFmt, 'right');
  const pFmt = R.precip.step < 1 ? (v) => v.toFixed(1) : intFmt;
  tickLabels(ctx, lay, pS, pT, pFmt, 'left');
  tickLabels(ctx, lay, pS, pT, (v) => String(Math.round(50 + ((v - R.precip.lo) / (R.precip.hi - R.precip.lo)) * 50)), 'right', C.hum);
  tickLabels(ctx, lay, prS, prT, intFmt, 'left');
  tickLabels(ctx, lay, prS, prT, presRightHpa ? intFmt : (v) => String(Math.round(v * 0.750062)), 'right');
  tickLabels(ctx, lay, wS, wT, intFmt, 'left');
  tickLabels(ctx, lay, wS, wT, (v) => String(Math.round(v * 3.6)), 'right');
  const cbS = { y: cbY };
  tickLabels(ctx, lay, cbS, fr, (f) => CB_LABELS[Math.round(f * 4)].toFixed(1), 'left');
  tickLabels(ctx, lay, cbS, fr, (f) => String(VIS_LABELS[Math.round(f * 4)]), 'right', C.visText);
  tickLabels(ctx, lay, ccS, [0, 2, 4, 6, 8], intFmt, 'left');
  const fogS = scale(PANELS.cc, 0, 1);
  tickLabels(ctx, lay, fogS, [0, 0.25, 0.5, 0.75, 1], (v) => String(v), 'right', C.visText);
}

// ---------- główny meteogram ----------
export function chartSize(model) {
  return { width: Math.round(PX0 + (model.n - 1) * PXH + RIGHT_MARGIN), height: CHART_H };
}
export function measure(model, opts = {}) {
  const c = chartSize(model);
  return { width: c.width + (opts.legend === false ? 0 : LEGEND_W), height: c.height };
}

function dms(v, pos, neg) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mf = (a - d) * 60;
  const m = Math.floor(mf);
  const s = Math.round((mf - m) * 60);
  return `${d}°${m}'${s}"${v >= 0 ? pos : neg}`;
}

export function terrainHeight(D) {
  const hs = [];
  for (let i = 0; i < D.slp.length; i++) {
    const p0 = D.slp[i], p = D.trp[i];
    if (p0 && p) hs.push(44330 * (1 - Math.pow(p / p0, 0.1903)));
  }
  if (!hs.length) return null;
  hs.sort((a, b) => a - b);
  return Math.round(hs[Math.floor(hs.length / 2)]);
}

function drawChart(ctx, model, opts) {
  const { width } = chartSize(model);
  const D = fixChill(seriesFromModel(model));
  const lat = model.point.lat ?? opts.lat, lon = model.point.lon ?? opts.lon;
  const tz = opts.tz || TZ;
  const lay = makeLayout({ n: model.n, px0: PX0, pxh: PXH, t0: model.t0, dt: model.dt });
  const tEnd = model.t0 + (model.n - 1) * model.dt;

  ctx.fillStyle = C.page;
  ctx.fillRect(0, 0, width, CHART_H);

  const segs = nightSegments(lay, lat, lon);
  const vgrid = [];
  const labels = [];
  for (let t = Math.ceil(model.t0 / 3600000) * 3600000; t <= tEnd; t += 3600000) {
    const h = new Date(t).getUTCHours();
    if (h % 3 === 0) vgrid.push(lay.xt(t));
    if (h % 6 === 3) labels.push(t);
  }
  const R = computeScales(D);
  drawPanels(ctx, lay, D, R, segs, vgrid);

  // tytuły osi
  const titles = [
    ['temp', ['temperatura', '(°C)'], ['(°C)', 'temperatura']],
    ['precip', ['opad', '(mm/h, kg/m²/h)'], ['(%)', 'wilgotność wzgl.']],
    ['pres', ['ciśnienie', '(hPa)'], ['(mm Hg)', 'ciśnienie']],
    ['wind', ['wiatr', '(m/s)'], ['(km/h)', 'wiatr']],
    ['cb', ['pion. rozciągł. chm.', '(km)'], ['(km)', 'widzialność']],
    ['cc', ['zachmurzenie', '(oktanty)'], ['(frakcja)', 'mgła']],
  ];
  for (const [k, left, right] of titles) {
    const [top, bot] = PANELS[k];
    const yc = (top + bot) / 2;
    const maxW = bot - top + 14;
    vtext(ctx, left[0], 11, yc, C.navy, fitSize(ctx, left[0], maxW));
    vtext(ctx, left[1], 25, yc, C.navy, fitSize(ctx, left[1], maxW));
    vtext(ctx, right[0], width - 24, yc, C.navy, fitSize(ctx, right[0], maxW));
    vtext(ctx, right[1], width - 8, yc, C.navy, fitSize(ctx, right[1], maxW));
  }
  const dyc = (PANELS.dir[0] + PANELS.dir[1]) / 2;
  compass(ctx, 22, dyc - 2);
  compass(ctx, width - 22, dyc - 2);

  // oś czasu: lokalnie u góry, UTC na dole
  const abbr0 = localParts(model.t0, tz).abbr;
  text(ctx, abbr0, PX0 - 11, 54, { align: 'right' });
  text(ctx, localParts(tEnd, tz).abbr, lay.pxR + 12, 54, { align: 'left' });
  text(ctx, 'UTC', PX0 - 11, 616, { align: 'right' });
  text(ctx, 'UTC', lay.pxR + 12, 616, { align: 'left' });
  for (const t of labels) {
    const x = lay.xt(t);
    text(ctx, pad2(localParts(t, tz).h), x, 54, { align: 'center' });
    text(ctx, pad2(new Date(t).getUTCHours()), x, 616, { align: 'center' });
  }
  // daty nad dniem (środek okresu jasnego)
  const seen = new Set();
  for (let t = model.t0; t <= tEnd + 86400000; t += 3600000) {
    const p = localParts(t, tz);
    const key = `${p.y}-${p.mo}-${p.d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const noon = Date.UTC(p.y, p.mo - 1, p.d, 12);
    if (noon < model.t0 - 4 * 3600000 || noon > tEnd + 4 * 3600000) continue;
    const a = noon, b = noon;
    ctx.font = font(12);
    const label = `${DAYS[p.wd]}, ${pad2(p.d)}.${pad2(p.mo)}`;
    const w1 = ctx.measureText(label).width;
    let xc = (lay.xt(a) + lay.xt(b)) / 2;
    xc = Math.max(lay.px0 + w1 / 2, Math.min(lay.pxR - w1 / 2, xc));
    text(ctx, label, xc, 41, { align: 'center' });
    const short = `${pad2(p.d)}.${pad2(p.mo)}`;
    const w2 = ctx.measureText(short).width;
    let xc2 = (lay.xt(a) + lay.xt(b)) / 2;
    xc2 = Math.max(lay.px0 + w2 / 2, Math.min(lay.pxR - w2 / 2, xc2));
    text(ctx, short, xc2, 629, { align: 'center' });
  }

  // nagłówek
  const st = sunTimes(model.t0, lat, lon, tz);
  const hm = (ms) => {
    if (ms == null) return '--:--';
    const p = localParts(ms, tz);
    return `${pad2(p.h)}:${pad2(p.mi)} ${p.abbr}`;
  };
  text(ctx, `wschód słońca: ${hm(st.rise)}`, 4, 12, { color: C.navy });
  text(ctx, `zachód słońca: ${hm(st.set)}`, 4, 25, { color: C.navy });
  const cx = width / 2 + 33;
  text(ctx, `${dms(lon, 'E', 'W')}, ${dms(lat, 'N', 'S')}`, cx, 12, { align: 'center', color: C.navy });
  if (model.point.col != null) {
    text(ctx, `(x=${model.point.col},  y=${model.point.row})`, cx, 25, { align: 'center', color: C.navy });
  }
  const hgt = terrainHeight(D);
  const rx = width - 74;
  text(ctx, 'wysokość terenu (model)', rx, 12, { align: 'center', color: C.navy });
  text(ctx, hgt == null ? '–' : `≈ ${hgt} m n.p.m.`, rx, 25, { align: 'center', color: C.navy });

  // stopka
  text(ctx, 'dane: ICM UW (meteo.pl), model UM 4 km', 18, 652, { color: C.navy, size: 11 });
  text(ctx, 'nieoficjalna wizualizacja', width - 15, 652, { color: C.navy, size: 11, align: 'right' });
}

// ---------- legenda (statyczny przykład jak w starym meteo.pl) ----------
const LEG = (() => {
  const n = 17;
  const air = [7, 6.5, 5.5, 4.5, 3.5, 2.5, 2, 1.5, 1, 0.5, 0, -0.5, -1, -2, -3, -1.5, 0];
  const D = {
    air,
    airMax: air.map((v, i) => v + [9, 8, 7, 6, 5, 4, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2][i]),
    airMin: air.map((v) => v - 2),
    wc: air.map((v) => v - 3),
    wcMax: air.map((v) => v - 1.5),
    wcMin: air.map((v) => v - 7),
    dew: [-1, -1.5, -2, -2.5, -3, -3, -3.5, -4, -4, -4, -4.5, -5, -5, -5.5, -6, -5, -4],
    grdMax: [24, 21, 17, 12, 8, 5, 3, 2, 1, 1, 0.5, 0, 0, 0, -1, 1, 3],
    grdMin: [6, 4, 2, 0, -1, -2, -3, -3, -4, -4, -4, -5, -5, -5, -6, -4, -2],
    pAvg: [0.95, 1.15, 1.2, 1.0, 0.45, 0.3, 0.05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pMax: [1.5, 2.6, 2.6, 1.4, 0.7, 0.55, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pType: [1, 1, 1, 2, 1, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    storm: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    flash: [4, 12, 35, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hum: [72, 80, 86, 90, 93, 95, 96, 96, 95, 94, 95, 96, 96, 95, 93, 90, 86],
    slp: [1015.6, 1015.9, 1016.3, 1016.6, 1016.8, 1016.7, 1016.5, 1016.3, 1016.3, 1016.3, 1016.2, 1016.1, 1016.0, 1015.8, 1015.6, 1015.3, 1015.0],
    ws: [5, 5.6, 5.2, 4.6, 4.1, 3.6, 3.5, 3.8, 4.0, 4.2, 4.6, 4.4, 4.0, 4.2, 4.8, 5.3, 5.6],
    gust: [21, 13.5, 12.5, 11.5, 10.5, 9.5, 9, 8.5, 9, 9.5, 10, 10, 9.5, 10, 11, 12, 12.5],
    wd: new Array(n).fill(0).map((_, i) => 320 + (i % 3) * 4),
    vis: [4, 6, 8, 10, 12, 14, 12, 10, 8, 7, 6, 7, 8, 7, 6, 6, 7],
    cb: [
      [0.3, 0.3, 0.35, 0.4, 0.35, null, 0.3, 0.25, 0.2, 0.2, 0.25, null, null, 0.2, 0.2, 0.2, 0.2],
      [0.5, 0.45, 0.6, null, 0.45, 0.5, null, 0.4, 0.45, null, 0.6, 0.5, 0.45, null, 0.5, 0.4, null],
      [null, 0.6, null, 0.8, 0.6, null, 0.6, 0.6, null, 0.8, null, 0.9, null, 1.1, 1.0, null, 0.8],
      [2.5, null, 3, null, null, 3.5, 4, null, 5, 4.5, null, 3.5, 3, 2.5, null, 2.5, 3],
      [null, null, null, 6, 6.5, 6, null, 7.5, 8, null, 6.5, 4.5, null, 3.5, 3, null, 2.5],
    ],
    ctop: [8.5, 9.5, 9.5, 11, 11, 11.5, 11.5, 12, 12, 12, 12, 12, 12, 12, 11.5, 11.5, 11.5],
    chigh: [0, 0, 0, 0.1, 0.3, 0.5, 0.65, 0.75, 0.85, 0.95, 0.85, 0.7, 0.55, 0.5, 0.45, 0.5, 0.55],
    cmed: [0.25, 0.3, 0.2, 0.15, 0.1, 0.2, 0.4, 0.55, 0.5, 0.45, 0.35, 0.3, 0.3, 0.35, 0.3, 0.25, 0.2],
    clow: [0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.1, 0.15, 0.2, 0.25, 0.3, 0.3, 0.3, 0.25, 0.2, 0.2, 0.25],
    cvlow: [0.15, 0.1, 0.08, 0.05, 0.03, 0, 0, 0, 0, 0.03, 0.06, 0.08, 0.1, 0.1, 0.08, 0.1, 0.12],
    fog: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.12, 0.25, 0.25, 0.25, 0.25],
  };
  const R = {
    temp: { lo: -12, hi: 32, step: 10 },
    precip: { lo: 0, hi: 2.2, step: 0.5 },
    pres: { lo: 1011.6, hi: 1018, step: 2 },
    wind: { lo: 0, hi: 20, step: 5 },
  };
  return { n, D, R };
})();

function legendLayout() {
  return makeLayout({ n: LEG.n, px0: 135, pxh: PXH, t0: 0, dt: 3600000 });
}

function drawLegend(ctx, opts) {
  const { D, R } = LEG;
  const lay = legendLayout();
  ctx.fillStyle = C.page;
  ctx.fillRect(0, 0, LEGEND_W, CHART_H);
  const segs = [[lay.xi(5), lay.xi(13.7)]];
  // pionowa siatka co 3 h, start legendy = 14 UTC
  const vgrid = [1, 4, 7, 10, 13, 16].map(lay.xi);
  drawPanels(ctx, lay, D, R, segs, vgrid, true);
  // oś czasu legendy
  [[4, '20', '18'], [10, '02', '00'], [16, '08', '06']].forEach(([i, loc, utc]) => {
    text(ctx, loc, lay.xi(i), 54, { align: 'center' });
    text(ctx, utc, lay.xi(i), 616, { align: 'center' });
  });

  // skale do celowania liniami odnośników
  const tS = scale(PANELS.temp, R.temp.lo, R.temp.hi);
  const pS = scale(PANELS.precip, R.precip.lo, R.precip.hi);
  const hS = scale(PANELS.precip, 50, 100);
  const prS = scale(PANELS.pres, R.pres.lo, R.pres.hi);
  const wS = scale(PANELS.wind, R.wind.lo, R.wind.hi);
  const ccS = scale(PANELS.cc, 0, 8);
  const cbY = (v, cap = 14) => PANELS.cb[1] - projectPiecewise(v, CB_LABELS, cap) * (PANELS.cb[1] - PANELS.cb[0]);
  const visY = (v) => PANELS.cb[1] - projectPiecewise(v, VIS_LABELS, 90) * (PANELS.cb[1] - PANELS.cb[0]);
  const x = lay.xi;
  const mid = (i) => x(i) - PXH / 2;
  const SKYBOX = { bg: C.skyDay, fg: '#FFFFFF' };

  // [tekst, x, y(baseline), kolor, cel [x,y] | null, opcje]
  const L = [
    ['Czas lokalny', 6, 19, '#000'],
    ['(CET/CEST)', 6, 31, '#000', [x(4) - 8, 45]],
    ['Temperatura gruntu', 6, 47, C.ground],
    ['max/min', 28, 57, C.ground, [x(2), tS.y(D.grdMax[2]) + 2]],
    ['Temperatura:', 6, 69, '#000'],
    ['punkt środkowy', 12, 81, C.air, [x(1), tS.y(D.air[1])]],
    ['max/min', 28, 91, '#F09A9A', [x(0) + 3, tS.y(D.airMax[0] - 2)]],
    ['odczuwana', 12, 103, C.chill, [x(1), tS.y(D.wc[1])]],
    ['max/min', 28, 112, '#7FB4E8', [x(0) + 3, tS.y(D.wcMin[0] + 1.5)]],
    ['Temp. punktu rosy', 6, 124, C.dew, [x(4), tS.y(D.dew[4])]],
    ['Opad powyżej skali', 6, 141, C.overflow, [mid(1), pS.top + 3]],
    ['Wilgotność względna', 6, 154, C.hum, [x(2), hS.y(D.hum[2])]],
    ['Wystąpienie burzy', 6, 168, '#000', [mid(0) - 3, pS.bot - 0.62 * (pS.bot - pS.top)]],
    ['Deszcz:', 18, 182, C.rain[0]],
    ['max', 64, 182, C.rain[0], [mid(0), pS.y(D.pMax[0]) + 4]],
    ['średni', 64, 194, C.rain[0], [mid(2) - 2, pS.y(D.pAvg[2]) + 6]],
    ['Śnieg:', 18, 206, C.snow[0]],
    ['max', 64, 206, C.snow[0], [mid(3), pS.y(D.pMax[3]) + 3]],
    ['średni', 64, 217, C.snow[0], [mid(3) - 2, pS.y(D.pAvg[3]) + 6]],
    ['Opad mieszany', 6, 229, C.mixed[0], [mid(5), pS.y(D.pAvg[5]) + 2]],
    ['Ciśnienie', 6, 266, '#000', [x(3), prS.y(D.slp[3]) + 1]],
    ['zredukowane', 6, 279, '#000'],
    ['do poziomu morza', 6, 292, '#000'],
    ['Wiatr na 10m:', 6, 322, '#000'],
    ['poryw powyżej skali', 8, 336, C.overflow, [mid(0) + 1, wS.top + 3]],
    ['max porywy wiatru', 8, 351, C.gust, [mid(3), wS.y(D.gust[3])]],
    ['prędkość wiatru', 8, 372, C.windLine, [x(3), wS.y(D.ws[3])]],
    ['w środku obszaru', 8, 385, C.windLine],
    ['kierunek wiatru', 6, 414, C.windLine, [x(1) - 6, (PANELS.dir[0] + PANELS.dir[1]) / 2]],
    ['Wierzchołek chmur', 6, 433, C.cldTop, [x(6), cbY(D.ctop[6])]],
    ['Podstawa chmur*', 6, 447, '#000'],
    ['o pokryciu', 6, 457, '#000'],
    ['> 7.9 okt.', 14, 471, '#000', [x(4), cbY(D.cb[4][4])]],
    ['> 6.5 okt.', 14, 482, '#5A5A5A', [x(2), cbY(D.cb[3][2])]],
    ['> 4.5 okt.', 14, 494, '#969696', [x(3), cbY(D.cb[2][3])]],
    ['> 2.5 okt.', 14, 504, '#B4B4B4', [x(4), cbY(D.cb[1][4])]],
    ['> 0.1 okt.', 14, 515, SKYBOX, [x(3), cbY(D.cb[0][3])]],
    ['Widzialność', 6, 530, C.visText, [x(5), visY(D.vis[5])]],
    ['Chmury:', 6, 546, '#000'],
    ['wysokie', 14, 560, SKYBOX, [x(9), ccS.y(D.chigh[9] * 8) + 3]],
    ['średnie', 14, 573, '#969696', [x(7), ccS.y(D.cmed[7] * 8) + 3]],
    ['niskie', 14, 585, '#5A5A5A', [x(2), ccS.y(D.clow[2] * 8) + 2]],
    ['bardzo niskie', 14, 597, '#3C3C3C', [x(1), ccS.bot - 2]],
    ['Mgła', 6, 609, C.visText, [x(13), ccS.bot - 2]],
    ['Czas uniwersalny (UTC)', 6, 626, '#000', [x(4) - 8, 612]],
  ];
  ctx.setLineDash([]);
  for (const [s, tx, ty, col, target] of L) {
    const box = typeof col === 'object';
    ctx.font = font(12);
    const w = ctx.measureText(s).width;
    if (box) {
      ctx.fillStyle = col.bg;
      ctx.fillRect(tx - 2, ty - 10, w + 4, 13);
    }
    const color = box ? col.fg : col;
    text(ctx, s, tx, ty, { color });
    if (target) {
      ctx.beginPath();
      ctx.moveTo(tx + w + 2, ty - 4);
      ctx.lineTo(target[0], target[1]);
      ctx.strokeStyle = box ? col.bg : color;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  text(ctx, '* powyżej poziomu morza', 6, 652, { size: 10 });

  // nazwa miejsca i przebieg modelu
  if (opts.title) {
    ctx.font = font(13, true);
    let s = opts.title;
    while (s.length > 3 && ctx.measureText(s).width > LEGEND_W - 100) s = s.slice(0, -2);
    if (s !== opts.title) s = s.replace(/\s*\S?$/, '') + '…';
    text(ctx, s, 100, 11, { bold: true, size: 13 });
  }
  if (opts.subtitle) text(ctx, opts.subtitle, 100, 24, { size: 11, color: '#333' });
}

// ---------- API publiczne ----------
export function render(ctx, model, opts = {}) {
  const withLegend = opts.legend !== false;
  ctx.save();
  if (withLegend) {
    drawLegend(ctx, opts);
    ctx.translate(LEGEND_W, 0);
  }
  drawChart(ctx, model, opts);
  ctx.restore();
}

export function runLabel(model, modelName = 'um4_60') {
  const d = new Date(model.fstart);
  const h = modelName === 'um4_120' ? '120h' : '60h';
  return `UM 4km ${h}, start ${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)} ${pad2(d.getUTCHours())} UTC`;
}

// pobieranie danych (przeglądarka i Node 18+)
export async function fetchAvailable(fetchImpl = fetch) {
  const r = await fetchImpl(`${API}/meteorograms/available`);
  if (!r.ok) throw new Error(`API meteo.pl: ${r.status}`);
  return r.json();
}
export async function fetchForecast({ lat, lon, model = 'um4_60', date = null }, fetchImpl = fetch) {
  let runs = [];
  if (date == null) {
    const av = await fetchAvailable(fetchImpl);
    runs = (av[model] || []).slice().sort((a, b) => b - a);
    if (!runs.length) throw new Error(`Brak przebiegów modelu ${model}`);
  } else runs = [Number(date)];
  let lastErr;
  for (const run of runs.slice(0, 3)) {
    try {
      const r = await fetchImpl(`${API}/meteorograms/${model}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: run, point: { lat: Number(lat), lon: Number(lon) } }),
      });
      if (!r.ok) throw new Error(`API meteo.pl: ${r.status}`);
      const j = await r.json();
      const m = normalizeApi(j);
      if (m.n < 2) throw new Error('Za mało danych');
      m.run = run;
      m.model = model;
      return m;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Nie udało się pobrać prognozy');
}
