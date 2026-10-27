import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { normalizeApi, render, measure, runLabel } from '../render.js';

const fdir = new URL('../node_modules/@expo-google-fonts/arimo/', import.meta.url).pathname;
GlobalFonts.registerFromPath(fdir + '400Regular/Arimo_400Regular.ttf', 'Arial');
GlobalFonts.registerFromPath(fdir + '700Bold/Arimo_700Bold.ttf', 'Arial');

const c = JSON.parse(readFileSync(new URL('./ref-compact.json', import.meta.url)));
// compact -> kształt odpowiedzi API
const data = {};
for (const [k, v] of Object.entries(c)) {
  if (!Array.isArray(v)) continue;
  data[k] = { data: v.map((x) => (x == null ? -327276480 : x)), first_timestamp: c.first, interval: 3600, point: c.point, fstart: c.fstart };
}
const model = normalizeApi({ fstart: c.fstart, data });
const out = process.argv[2] || '/tmp/out.png';
const sc = Number(process.argv[3] || 1);
const legend = process.argv[4] !== 'nolegend';
const { width, height } = measure(model, { legend });
const canvas = createCanvas(Math.round(width * sc), Math.round(height * sc));
const ctx = canvas.getContext('2d');
ctx.scale(sc, sc);
const t = Date.now();
render(ctx, model, { legend, title: 'Gdynia (punkt z wzoru)', subtitle: runLabel(model) });
writeFileSync(out, canvas.toBuffer('image/png'));
console.log('ok', width, height, Date.now() - t, 'ms');
