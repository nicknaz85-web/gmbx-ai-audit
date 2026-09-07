// bake-photos.js — bake the first Google Places photo for each venue as a keyless
// image URL (shown next to the venue name). Two calls per venue: GetPlace(photos)
// to get the photo resource name, then the Photo endpoint with skipHttpRedirect to
// resolve a lh3.googleusercontent.com URL (no key in it). Skips already-baked
// venues and stops on the first 429, so it can run in batches.
//
//   node scripts/bake-photos.js            # up to 400 this run
//   node scripts/bake-photos.js --limit 80
//   node scripts/bake-photos.js --dry

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seed } from '../lib/seed.js';
import { venueById } from '../lib/store.js';
import { BAKED_PLACES } from '../lib/baked-places.js';
import { BAKED_PHOTOS } from '../lib/baked-photos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'lib', 'baked-photos.js');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? (process.argv[i + 1] ?? true) : d; };
const LIMIT = Math.min(2000, parseInt(arg('--limit', '400'), 10) || 400);
const DRY = process.argv.includes('--dry');
const MAXW = 800;
const KEY = process.env.GOOGLE_PLACES_KEY || (() => { try { return fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/^GOOGLE_PLACES_KEY=(.+)$/m)?.[1].trim(); } catch { return null; } })();
if (!KEY) { console.error('No GOOGLE_PLACES_KEY.'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = 'https://places.googleapis.com/v1';

async function firstPhotoName(placeId) {
  const r = await fetch(`${H}/places/${encodeURIComponent(placeId)}`, { headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'photos' } });
  if (r.status === 429) { const e = new Error('429'); e.quota = true; throw e; }
  if (!r.ok) throw new Error('place ' + r.status);
  const j = await r.json();
  return j.photos && j.photos[0] && j.photos[0].name || null;
}
async function photoUrl(photoName) {
  const r = await fetch(`${H}/${photoName}/media?maxWidthPx=${MAXW}&skipHttpRedirect=true`, { headers: { 'X-Goog-Api-Key': KEY } });
  if (r.status === 429) { const e = new Error('429'); e.quota = true; throw e; }
  if (!r.ok) throw new Error('media ' + r.status);
  return (await r.json()).photoUri || null;
}

seed();
const need = Object.entries(BAKED_PLACES)
  .filter(([id, b]) => b.placeId && venueById(id) && !BAKED_PHOTOS[id])
  .map(([id]) => id);
console.log(`Venues needing a photo: ${need.length}. This run: up to ${LIMIT}.${DRY ? ' (DRY)' : ''}`);
if (DRY) { console.log(need.slice(0, LIMIT).map((id) => venueById(id).name).join(', ')); process.exit(0); }

const map = { ...BAKED_PHOTOS };
let ok = 0, none = 0, i = 0;
for (const id of need.slice(0, LIMIT)) {
  i++; const v = venueById(id);
  try {
    const pn = await firstPhotoName(BAKED_PLACES[id].placeId);
    if (!pn) { none++; console.log(`  [${i}] · ${v.name} — no photo`); await sleep(90); continue; }
    const url = await photoUrl(pn);
    if (url) { map[id] = url; ok++; if (i % 25 === 0) console.log(`  [${i}] ✓ ${v.name}`); }
    else none++;
  } catch (e) {
    if (e.quota) { console.log(`  [${i}] ⏹ quota (429) — stopping, saving ${ok}.`); break; }
    console.log(`  [${i}] ✕ ${v.name} — ${e.message}`);
  }
  await sleep(90);
}
if (ok) {
  fs.writeFileSync(OUT, '// baked-photos.js — first Google Places photo per venue, keyless CDN URL.\n// Filled by scripts/bake-photos.js. Re-bake occasionally if Google rotates a URL.\nexport const BAKED_PHOTOS = ' + JSON.stringify(map) + ';\n');
  console.log(`\nBaked ${ok} photos (${none} had none). Total: ${Object.keys(map).length}. Wrote baked-photos.js.`);
} else console.log('\nNothing written.');
