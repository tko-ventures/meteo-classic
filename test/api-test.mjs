// Lokalny test funkcji /api/meteogram z podstawionym fetch (bez sieci).
import { readFileSync, writeFileSync } from 'node:fs';
import handler from '../api/meteogram.js';

const c = JSON.parse(readFileSync(new URL('./ref-compact.json', import.meta.url)));
const long = process.argv[3] === 'long';
const data = {};
for (const [k, v] of Object.entries(c)) {
  if (!Array.isArray(v)) continue;
  const arr = long ? [...v, ...v] : v;
  data[k] = { data: arr.map((x) => (x == null ? -327276480 : x)), first_timestamp: c.first, interval: 3600, point: c.point, fstart: c.fstart };
}
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (o) => ({ ok: true, status: 200, json: async () => o });
  if (u.endsWith('/meteorograms/available')) return json({ um4_60: [1792972800, 1792994400], um4_120: [1792972800] });
  if (u.includes('/meteorograms/')) return json({ fstart: c.fstart, data });
  if (u.includes('nominatim')) return json({ name: 'Gdynia' });
  throw new Error('unexpected ' + u);
};
const out = process.argv[2];
const res = {
  headers: {}, code: 0,
  status(c) { this.code = c; return this; },
  setHeader(k, v) { this.headers[k] = v; return this; },
  end(b) { this.body = b; },
};
await handler({ query: { lat: '54.4853', lng: '18.4708', model: long ? 'um4_120' : 'um4_60', scale: '1' } }, res);
console.log(res.code, res.headers['Content-Type'], res.body?.length, res.headers['X-Model-Run']);
if (res.code === 200) writeFileSync(out, res.body); else console.log(String(res.body));
await handler({ query: {} }, res);
console.log('bad request ->', res.code, String(res.body));
