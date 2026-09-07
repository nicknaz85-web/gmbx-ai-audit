// bake-hours.js — fetch real weekly opening hours from Google Places and bake
// them into lib/baked-hours.js. Google's free tier caps GetPlace at ~100/day, so
// this runs in batches: it skips venues already baked and stops at the daily
// budget (or on the first 429), so you can run it once a day until every venue
// has real hours.
//
//   node scripts/bake-hours.js                 # up to 95 venues, priority order
//   node scripts/bake-hours.js --limit 40      # cap this run at 40
//   node scripts/bake-hours.js --city Berlin   # only this city (still budget-capped)
//   node scripts/bake-hours.js --dry           # show what it WOULD fetch, no calls

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seed } from '../lib/seed.js';
import { db } from '../lib/store.js';
import { BAKED_PLACES } from '../lib/baked-places.js';
import { BAKED_HOURS } from '../lib/baked-hours.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOURS_FILE = path.join(__dirname, '..', 'lib', 'baked-hours.js');

// ---- args ----
const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i >= 0 ? (process.argv[i + 1] ?? true) : def; };
// default 95/run (safe under the old free-tier daily cap); raise via --limit once
// the project's GetPlace daily quota is upgraded. Hard ceiling just guards typos.
const LIMIT = Math.min(2000, parseInt(arg('--limit', '95'), 10) || 95);
const ONLY_CITY = arg('--city', null);
const DRY = process.argv.includes('--dry');

// ---- key from .env ----
function loadEnvKey() {
  if (process.env.GOOGLE_PLACES_KEY) return process.env.GOOGLE_PLACES_KEY;
  try {
    const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const m = env.match(/^GOOGLE_PLACES_KEY=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}
const KEY = loadEnvKey();
if (!KEY) { console.error('No GOOGLE_PLACES_KEY (env or .env). Aborting.'); process.exit(1); }

// Priority — biggest nightlife scenes first so the cities users hit most get real
// hours earliest. Anything not listed is done afterwards, alphabetically by city.
const CITY_PRIORITY = [
  'Berlin', 'London', 'Amsterdam', 'Paris', 'Barcelona', 'Madrid', 'Ibiza',
  'New York', 'Miami', 'Los Angeles', 'Las Vegas', 'Mexico City',
  'Tbilisi', 'Belgrade', 'Prague', 'Budapest', 'Warsaw', 'Bucharest',
  'Athens', 'Thessaloniki', 'Lisbon', 'Rome', 'Milan', 'Vienna', 'Zurich',
  'Sarajevo', 'Tel Aviv', 'Istanbul', 'Bangkok', 'Tokyo', 'Seoul', 'Singapore',
  'São Paulo', 'Buenos Aires', 'Medellín', 'Bogotá', 'Cape Town', 'Sydney',
];

const HOST = 'https://places.googleapis.com/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHours(placeId) {
  const res = await fetch(`${HOST}/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'businessStatus,regularOpeningHours.periods' },
  });
  if (res.status === 429) { const t = await res.text(); const e = new Error('429'); e.quota = true; e.body = t; throw e; }
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 140));
  const j = await res.json();
  // normalise periods to just {open:{day,hour,minute}, close:{day,hour,minute}}
  const periods = (j.regularOpeningHours?.periods || []).map((p) => ({
    open: p.open ? { day: p.open.day, hour: p.open.hour || 0, minute: p.open.minute || 0 } : null,
    close: p.close ? { day: p.close.day, hour: p.close.hour || 0, minute: p.close.minute || 0 } : null,
  })).filter((p) => p.open);
  return { periods, businessStatus: j.businessStatus || 'OPERATIONAL' };
}

function writeBaked(map) {
  const keys = Object.keys(map).sort();
  const body = keys.map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(map[k])).join(',\n');
  const out = `// baked-hours.js — real weekly opening-hours schedules from Google Places.
// See notes below; generated/updated by scripts/bake-hours.js. Open/closed is
// computed live from these periods + the city timezone (hours.js).
//
// Shape: { [venueId]: { periods:[{open:{day,hour,minute},close:{day,hour,minute}}], businessStatus } }
// day 0=Sunday..6=Saturday, venue-local. Empty periods + OPERATIONAL = open 24/7.
export const BAKED_HOURS = {
${body}
};
`;
  fs.writeFileSync(HOURS_FILE, out);
}

async function main() {
  seed(); // populates db.venues + db.places (placeIds from BAKED_PLACES)
  const done = new Set(Object.keys(BAKED_HOURS));

  // candidates: venues with a known placeId, not yet baked
  let cand = db.venues
    .map((v) => ({ id: v.id, name: v.name, city: v.city, placeId: (BAKED_PLACES[v.id] || {}).placeId || (db.places[v.id] || {}).placeId }))
    .filter((v) => v.placeId && !done.has(v.id));
  if (ONLY_CITY) cand = cand.filter((v) => v.city.toLowerCase() === String(ONLY_CITY).toLowerCase());

  // order by city priority, then city name, then venue name
  const rank = (c) => { const i = CITY_PRIORITY.indexOf(c); return i < 0 ? 999 : i; };
  cand.sort((a, b) => rank(a.city) - rank(b.city) || a.city.localeCompare(b.city) || a.name.localeCompare(b.name));

  const total = db.venues.filter((v) => (BAKED_PLACES[v.id] || {}).placeId).length;
  console.log(`Baked so far: ${done.size}/${total}. Remaining with placeId: ${cand.length}. This run: up to ${LIMIT}.`);
  if (DRY) { console.log('DRY — would fetch:', cand.slice(0, LIMIT).map((c) => `${c.name} (${c.city})`).join(', ')); return; }
  if (!cand.length) { console.log('Nothing left to bake. 🎉'); return; }

  const map = { ...BAKED_HOURS };
  let ok = 0, fail = 0, i = 0;
  for (const c of cand.slice(0, LIMIT)) {
    i++;
    try {
      const h = await fetchHours(c.placeId);
      map[c.id] = h;
      ok++;
      const nper = h.periods.length;
      console.log(`  [${i}] ✓ ${c.name} (${c.city}) — ${nper ? nper + ' periods' : '24/7 or none'}${h.businessStatus !== 'OPERATIONAL' ? ' · ' + h.businessStatus : ''}`);
    } catch (e) {
      if (e.quota) { console.log(`  [${i}] ⏹ quota hit (429) — stopping. Saving ${ok} fetched this run.`); break; }
      fail++;
      console.log(`  [${i}] ✕ ${c.name} (${c.city}) — ${e.message}`);
    }
    await sleep(180); // gentle pacing
  }

  if (ok > 0) { writeBaked(map); console.log(`\nWrote ${HOURS_FILE}. Total baked now: ${Object.keys(map).length}/${total}. (${fail} errors this run.)`); }
  else console.log('\nNo new hours fetched — nothing written.');
}

main().catch((e) => { console.error(e); process.exit(1); });
