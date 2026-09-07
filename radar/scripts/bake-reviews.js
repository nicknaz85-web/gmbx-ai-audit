// bake-reviews.js — fill in "what people say" (pros/cons), the short description
// and rating for every Google-connected venue that doesn't have them yet. Fetches
// each venue's real Google reviews + editorial summary (one GetPlace call) and runs
// the same summarizer the live path uses (lib/reviews.js), then bakes the result.
//
//   node scripts/bake-reviews.js            # enrich up to 400 this run
//   node scripts/bake-reviews.js --limit 50
//   node scripts/bake-reviews.js --dry

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seed } from '../lib/seed.js';
import { db, venueById } from '../lib/store.js';
import { BAKED_PLACES } from '../lib/baked-places.js';
import { summarizeReviews } from '../lib/reviews.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? (process.argv[i + 1] ?? true) : d; };
const LIMIT = Math.min(2000, parseInt(arg('--limit', '400'), 10) || 400);
const DRY = process.argv.includes('--dry');
const KEY = process.env.GOOGLE_PLACES_KEY || (() => { try { return fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/^GOOGLE_PLACES_KEY=(.+)$/m)?.[1].trim(); } catch { return null; } })();
if (!KEY) { console.error('No GOOGLE_PLACES_KEY.'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function details(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'rating,userRatingCount,priceLevel,editorialSummary,reviews' },
  });
  if (res.status === 429) { const e = new Error('429'); e.quota = true; throw e; }
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 120));
  return res.json();
}

seed();
// needs enrichment = Google-connected but no processed review text yet
const need = Object.entries(BAKED_PLACES)
  .filter(([id, b]) => b.placeId && venueById(id) && (!b.review || !b.review.basedOn))
  .map(([id]) => id);
console.log(`Google-connected venues needing reviews/description: ${need.length}. This run: up to ${LIMIT}.${DRY ? ' (DRY)' : ''}`);

const map = { ...BAKED_PLACES };
let ok = 0, none = 0, i = 0;
for (const id of need.slice(0, LIMIT)) {
  i++; const v = venueById(id); const b = map[id];
  try {
    const d = await details(b.placeId);
    const reviews = (d.reviews || []).map((r) => ({ rating: r.rating, text: r.text?.text || r.originalText?.text || '' }));
    const review = summarizeReviews(reviews, d.editorialSummary?.text || null);
    const rating = d.rating ?? b.rating ?? null, ratings = d.userRatingCount ?? b.ratings ?? null;
    const nPros = review ? (review.pros?.length || 0) + (review.cons?.length || 0) : 0;
    console.log(`  [${i}] ${review ? '✓' : '·'} ${v.name} (${v.city}) — ${review?.basedOn || 0} reviews, ${nPros} pts${review?.summary ? ', desc' : ''}`);
    if (DRY) { await sleep(90); continue; }
    map[id] = { ...b, rating, ratings, review: review || b.review || null };
    if (review) ok++; else none++;
  } catch (e) {
    if (e.quota) { console.log(`  [${i}] ⏹ quota (429) — stopping, saving ${ok}.`); break; }
    console.log(`  [${i}] ✕ ${v.name} — ${e.message}`);
  }
  await sleep(110);
}

if (!DRY && ok) {
  fs.writeFileSync(path.join(__dirname, '..', 'lib', 'baked-places.js'),
    '// AUTO-GENERATED: real Google ratings + review pros/cons + descriptions,\n// resolved once and baked in so the app shows them without live resolution.\n'
    + 'export const BAKED_PLACES = ' + JSON.stringify(map) + ';\n');
  console.log(`\nEnriched ${ok} venues (${none} had no usable review text). Wrote baked-places.js.`);
} else console.log(DRY ? '\nDRY — nothing written.' : '\nNothing written.');
