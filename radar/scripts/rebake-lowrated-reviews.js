// rebake-lowrated-reviews.js — re-summarise reviews for LOW-RATED venues (≤3.5★)
// so the "what people say" section is honest and surfaces real complaints, not
// only the praise Google's "most relevant" reviews skew toward. Re-fetches each
// low-rated venue's reviews and re-runs the (rating-aware) summarizer, overwriting
// its baked review object. Bounded to a few hundred venues.
//
//   node scripts/rebake-lowrated-reviews.js            # all ≤3.5★, up to 500
//   node scripts/rebake-lowrated-reviews.js --limit 50
//   node scripts/rebake-lowrated-reviews.js --dry
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seed } from '../lib/seed.js';
import { db, venueById } from '../lib/store.js';
import { BAKED_PLACES } from '../lib/baked-places.js';
import { summarizeReviews } from '../lib/reviews.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? (process.argv[i + 1] ?? true) : d; };
const LIMIT = Math.min(2000, parseInt(arg('--limit', '500'), 10) || 500);
const THRESH = parseFloat(arg('--max', '3.5')) || 3.5;
const DRY = process.argv.includes('--dry');
const KEY = process.env.GOOGLE_PLACES_KEY || (() => { try { return fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/^GOOGLE_PLACES_KEY=(.+)$/m)?.[1].trim(); } catch { return null; } })();
if (!KEY) { console.error('No GOOGLE_PLACES_KEY.'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function details(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'rating,userRatingCount,editorialSummary,reviews' },
  });
  if (res.status === 429) { const e = new Error('429'); e.quota = true; throw e; }
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 120));
  return res.json();
}

seed();
const need = Object.entries(BAKED_PLACES)
  .filter(([id, b]) => b.placeId && venueById(id) && b.rating != null && b.rating <= THRESH)
  .map(([id]) => id);
console.log(`Low-rated (≤${THRESH}★) Google-connected venues: ${need.length}. This run: up to ${LIMIT}.${DRY ? ' (DRY)' : ''}`);

const map = { ...BAKED_PLACES };
let ok = 0, changed = 0, i = 0;
for (const id of need.slice(0, LIMIT)) {
  i++; const v = venueById(id); const b = map[id];
  try {
    const d = await details(b.placeId);
    const reviews = (d.reviews || []).map((r) => ({ rating: r.rating, text: r.text?.text || r.originalText?.text || '' }));
    const rating = d.rating ?? b.rating ?? null, ratings = d.userRatingCount ?? b.ratings ?? null;
    const review = summarizeReviews(reviews, d.editorialSummary?.text || null, rating);
    const before = (b.review?.cons || []).join('|');
    const after = (review?.cons || []).join('|');
    if (before !== after) changed++;
    console.log(`  [${i}] ${review ? '✓' : '·'} ${v.name} (${v.city}) ${rating}★ — cons: [${after}]`);
    if (DRY) { await sleep(90); continue; }
    if (review) { map[id] = { ...b, rating, ratings, review }; ok++; }
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
  console.log(`\nRe-baked ${ok} low-rated venues (${changed} had their cons change). Wrote baked-places.js.`);
} else console.log(DRY ? '\nDRY — nothing written.' : '\nNothing written.');
