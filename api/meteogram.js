// GET /meteogram/51.22,18.57.png albo /meteogram.png?lat=51.22&lng=18.57
//     [&model=um4_60|um4_120][&legend=0][&scale=2][&name=Wieluń]
// Zwraca PNG w układzie starego meteogramu meteo.pl.
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fetchForecast, render, measure, runLabel } from '../render.js';

// Arimo = metrycznie zgodny z Arialem (SIL OFL 1.1), z pakietu npm @expo-google-fonts/arimo
const require = createRequire(import.meta.url);
let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = path.dirname(require.resolve('@expo-google-fonts/arimo/package.json'));
  GlobalFonts.registerFromPath(path.join(dir, '400Regular', 'Arimo_400Regular.ttf'), 'Arial');
  GlobalFonts.registerFromPath(path.join(dir, '700Bold', 'Arimo_700Bold.ttf'), 'Arial');
  fontsReady = true;
}

async function placeName(lat, lon) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10&accept-language=pl`,
      { headers: { 'User-Agent': 'meteo-classic/1.0 (nieoficjalny renderer meteogramow)' }, signal: AbortSignal.timeout(2500) },
    );
    if (!r.ok) return null;
    const j = await r.json();
    return j.name || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const q = req.query || {};
  // /meteogram/51.22,18.57.png → coords=51.22,18.57 (rewrite w vercel.json)
  const pair = typeof q.coords === 'string' ? decodeURIComponent(q.coords).split(',') : [];
  const lat = Number(pair.length === 2 ? pair[0] : q.lat);
  const lon = Number(pair.length === 2 ? pair[1] : q.lng ?? q.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Podaj współrzędne, np. /meteogram/51.22,18.57.png albo /meteogram.png?lat=51.22&lng=18.57');
    return;
  }
  const model = q.model === 'um4_120' ? 'um4_120' : 'um4_60';
  const legend = !(q.legend === '0' || q.legend === 'false');
  const scale = Math.min(3, Math.max(1, Number(q.scale) || 1));
  try {
    ensureFonts();
    const [m, name] = await Promise.all([
      fetchForecast({ lat, lon, model }),
      q.name ? Promise.resolve(String(q.name).slice(0, 60)) : placeName(lat, lon),
    ]);
    const { width, height } = measure(m, { legend });
    const canvas = createCanvas(Math.round(width * scale), Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    render(ctx, m, { legend, title: name || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, subtitle: runLabel(m, model) });
    const png = await canvas.encode('png');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=1800, stale-while-revalidate=3600');
    res.setHeader('X-Model-Run', new Date(m.fstart).toISOString());
    res.status(200).end(png);
  } catch (e) {
    res.status(502).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Nie udało się wygenerować meteogramu: ${e.message}`);
  }
}
