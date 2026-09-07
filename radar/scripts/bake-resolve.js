// bake-resolve.js — PHASE 2. Resolve venues that have no Google place ID yet
// (mostly the newer regions), then bake their real coordinates, place data AND
// weekly hours. One Places `searchText` call per venue returns all of it.
//
//   node scripts/bake-resolve.js --dry        # preview matches, no writes
//   node scripts/bake-resolve.js              # resolve + bake (default 120)
//   node scripts/bake-resolve.js --limit 40   # cap this run
//
// Only CONFIDENT matches (same name/type vetting as the live resolver) are baked;
// anything unmatched stays on its current approximate coords + schedule fallback.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seed } from '../lib/seed.js';
import { db } from '../lib/store.js';
import { BAKED_PLACES } from '../lib/baked-places.js';
import { BAKED_HOURS } from '../lib/baked-hours.js';
import { RESOLVED } from '../lib/resolved.js';
import { typeWord } from '../lib/places.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(__dirname, '..', 'lib');

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i >= 0 ? (process.argv[i + 1] ?? true) : def; };
const LIMIT = Math.min(2000, parseInt(arg('--limit', '120'), 10) || 120);
const DRY = process.argv.includes('--dry');

function loadEnvKey() {
  if (process.env.GOOGLE_PLACES_KEY) return process.env.GOOGLE_PLACES_KEY;
  try { const m = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/^GOOGLE_PLACES_KEY=(.+)$/m); return m ? m[1].trim() : null; } catch { return null; }
}
const KEY = loadEnvKey();
if (!KEY) { console.error('No GOOGLE_PLACES_KEY. Aborting.'); process.exit(1); }

// --- vetting (mirrors lib/places.js) ---
const NON_NIGHTLIFE = new Set(['drugstore','pharmacy','supermarket','grocery_store','convenience_store','department_store','store','shopping_mall','clothing_store','lodging','hotel','gas_station','bank','atm','hospital','clinic','doctor','gym','parking','church','school','university','spa','premise','subpremise','street_address','route','postal_code','plus_code','corporate_office','travel_agency','real_estate_agency']);
const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function nameConfident(want, got) {
  const a = normName(want), b = normName(got);
  if (!a || !b) return false;
  if (a.length >= 3 && (b.includes(a) || a.includes(b))) return true;
  const ca = a.replace(/ /g, ''), cb = b.replace(/ /g, '');
  if (ca.length >= 4 && (cb.includes(ca) || ca.includes(cb))) return true;
  // drop articles AND generic nightlife words so a shared "club"/"pub"/"bar" alone
  // can't fake a match ("Pinta Pub" ~ "Hot Pub", "Oil Club" ~ "Pepper Club")
  const STOP = new Set(['le','la','les','l','the','el','il','lo','los','un','une','du','de','di','da','o','a',
    'club','bar','pub','lounge','nightclub','night','disco','cafe','coffee','room','rooms','house','music',
    'beach','records','social','studio','studios','hall','klub','klub']);
  const A = new Set(a.split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
  const B = new Set(b.split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
  if (!A.size || !B.size) return false;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter >= 1 && inter / Math.min(A.size, B.size) >= 0.5;
}
const typeOk = (hit) => !(hit.primaryType && NON_NIGHTLIFE.has(hit.primaryType));

const HOST = 'https://places.googleapis.com/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveOne(v) {
  const body = {
    textQuery: [`${v.name} ${typeWord(v)}`, v.neighborhoodName, v.city].filter(Boolean).join(', '),
    maxResultCount: 5,
    locationBias: v.coords ? { circle: { center: { latitude: v.coords.lat, longitude: v.coords.lng }, radius: 3000 } } : undefined,
  };
  const res = await fetch(`${HOST}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.primaryType,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.formattedAddress,places.businessStatus,places.regularOpeningHours.periods,places.editorialSummary',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 429) { const e = new Error('429'); e.quota = true; throw e; }
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 140));
  const cands = (await res.json()).places || [];
  const ok = cands.filter((p) => typeOk(p) && nameConfident(v.name, p.displayName?.text));
  if (!ok.length) return null;
  ok.sort((a, b) => (b.userRatingCount || 0) - (a.userRatingCount || 0));
  return ok[0];
}

const normPeriods = (hit) => (hit.regularOpeningHours?.periods || []).map((p) => ({
  open: p.open ? { day: p.open.day, hour: p.open.hour || 0, minute: p.open.minute || 0 } : null,
  close: p.close ? { day: p.close.day, hour: p.close.hour || 0, minute: p.close.minute || 0 } : null,
})).filter((p) => p.open);

function writeGenerated(file, name, header, mapObj, pretty) {
  const keys = Object.keys(mapObj).sort();
  const body = pretty
    ? '\n' + keys.map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(mapObj[k])).join(',\n') + '\n'
    : JSON.stringify(mapObj);
  fs.writeFileSync(path.join(LIB, file), `${header}\nexport const ${name} = ${pretty ? '{' + body + '}' : body};\n`);
}

async function main() {
  seed();
  const need = db.venues.filter((v) => !(BAKED_PLACES[v.id] || {}).placeId && !(db.places[v.id] || {}).placeId);
  console.log(`Venues needing resolve: ${need.length}. This run: up to ${LIMIT}.${DRY ? ' (DRY)' : ''}`);

  const resolved = { ...RESOLVED }, places = { ...BAKED_PLACES }, hours = { ...BAKED_HOURS };
  let matched = 0, missed = 0, i = 0;
  for (const v of need.slice(0, LIMIT)) {
    i++;
    try {
      const hit = await resolveOne(v);
      if (!hit) { missed++; console.log(`  [${i}] — ${v.name} (${v.city}) · no confident match`); await sleep(150); continue; }
      const loc = hit.location ? { lat: hit.location.latitude, lng: hit.location.longitude } : null;
      const per = normPeriods(hit);
      matched++;
      console.log(`  [${i}] ✓ ${v.name} (${v.city}) → "${hit.displayName?.text}" ★${hit.rating ?? '-'} (${hit.userRatingCount ?? 0}) · ${per.length} periods${hit.businessStatus && hit.businessStatus !== 'OPERATIONAL' ? ' · ' + hit.businessStatus : ''}`);
      if (DRY) { await sleep(150); continue; }
      if (loc) resolved[v.id] = loc;
      places[v.id] = {
        placeId: hit.id, location: loc, rating: hit.rating ?? null, ratings: hit.userRatingCount ?? null,
        gmapsUrl: hit.googleMapsUri ?? null, address: hit.formattedAddress ?? null,
        review: hit.editorialSummary?.text ? { summary: hit.editorialSummary.text, pros: [], cons: [], basedOn: 0 } : null,
      };
      // Google's businessStatus is unreliable for nightlife (it wrongly flags many
      // open clubs — Motion, Octagon, Zouk... — as CLOSED_PERMANENTLY), so NEVER
      // bake a closed status. Only bake real hours when the place reads operational
      // AND has periods; otherwise leave it to the schedule fallback.
      if (per.length && (!hit.businessStatus || hit.businessStatus === 'OPERATIONAL')) {
        hours[v.id] = { periods: per, businessStatus: 'OPERATIONAL' };
      }
    } catch (e) {
      if (e.quota) { console.log(`  [${i}] ⏹ quota hit (429) — stopping.`); break; }
      missed++; console.log(`  [${i}] ✕ ${v.name} (${v.city}) — ${e.message}`);
    }
    await sleep(150);
  }

  console.log(`\nMatched ${matched}, missed ${missed}.`);
  if (DRY || matched === 0) { console.log(DRY ? 'DRY — nothing written.' : 'Nothing to write.'); return; }
  writeGenerated('resolved.js', 'RESOLVED',
    '// AUTO-GENERATED: real Google coordinates resolved once and baked in so pins\n// are correct without live resolution. Regenerate from a warmed snapshot.', resolved, false);
  writeGenerated('baked-places.js', 'BAKED_PLACES',
    '// AUTO-GENERATED: real Google ratings + review pros/cons + descriptions,\n// resolved once and baked in so the app shows them without live resolution.', places, false);
  writeGenerated('baked-hours.js', 'BAKED_HOURS',
    '// baked-hours.js — real weekly opening-hours schedules from Google Places.\n// day 0=Sunday..6=Saturday, venue-local. Empty periods + OPERATIONAL = schedule fallback.', hours, true);
  console.log('Wrote resolved.js, baked-places.js, baked-hours.js.');
}
main().catch((e) => { console.error(e); process.exit(1); });
