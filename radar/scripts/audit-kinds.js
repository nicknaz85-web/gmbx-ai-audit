// audit-kinds.js — verify venue kind/category against Google's primaryType and
// write lib/baked-kinds.js (an id -> {kind, category} override map applied by seed()).
// By default audits only venues whose NAME and current kind disagree (cheap, high
// signal). Pass --all to verify every venue with a placeId (uses ~1 Google Place
// Details call each — costs real credit).
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'lib');
const env = readFileSync(path.join(ROOT, '.env'), 'utf8');
const KEY = (env.match(/GOOGLE_PLACES_KEY=(.+)/) || [])[1]?.trim();
if (!KEY) { console.error('No GOOGLE_PLACES_KEY in .env'); process.exit(1); }
const ALL = process.argv.includes('--all');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { db } = await import('../lib/store.js');
const seedMod = await import('../lib/seed.js');
seedMod.seed();
const { BAKED_PLACES } = await import('../lib/baked-places.js');

const clubRe = /\b(club|nightclub|night club|discoteca|discotheque|disco|boite|bo[iî]te|klub)\b/i;
const barRe = /\b(bar|lounge|pub|taberna|tavern|cocktail|wine|speakeasy|cervecer|brew|taproom|tap room|kneipe|bodega|cantina|beer)\b/i;

// map Google primaryType/types -> our (kind, category). null = leave as-is.
// primaryType is authoritative; only fall back to the types[] set when the
// primaryType is uninformative (many live/concert venues *also* list night_club).
const VENUE_TYPES = ['performing_arts_theater', 'concert_hall', 'event_venue', 'live_music_venue', 'amphitheatre', 'auditorium'];
function kindFromGoogle(primaryType, types) {
  if (primaryType === 'night_club') return { kind: 'Club', category: 'Dancing' };
  if (VENUE_TYPES.includes(primaryType)) return { kind: 'Venue', category: 'Live' };
  if (primaryType === 'wine_bar') return { kind: 'Wine Bar', category: 'Bars' };
  if (['bar', 'pub', 'bar_and_grill'].includes(primaryType)) return { kind: 'Bar', category: 'Bars' };
  // primaryType wasn't a nightlife type (e.g. restaurant, tourist_attraction) —
  // fall back to the types list for a hint, else leave the hand-set kind alone.
  const t = new Set([primaryType, ...(types || [])]);
  if (t.has('night_club')) return { kind: 'Club', category: 'Dancing' };
  if (t.has('wine_bar')) return { kind: 'Wine Bar', category: 'Bars' };
  if (t.has('bar') || t.has('pub')) return { kind: 'Bar', category: 'Bars' };
  if (VENUE_TYPES.some((x) => t.has(x))) return { kind: 'Venue', category: 'Live' };
  return null;
}

async function details(placeId) {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'id,displayName,primaryType,types' },
    });
    if (!res.ok) { console.warn('  details', res.status, placeId); return null; }
    return await res.json();
  } catch { return null; }
}

// choose which venues to check
const candidates = db.venues.filter((v) => {
  if (!BAKED_PLACES[v.id]?.placeId) return false;
  if (ALL) return true;
  const isClubName = clubRe.test(v.name), isBarName = barRe.test(v.name);
  if (isClubName && v.kind !== 'Club') return true;          // "Club X" not marked Club
  if (!isClubName && isBarName && v.kind === 'Club') return true; // "X Bar/Lounge" marked Club
  return false;
});
console.log(`Auditing ${candidates.length} venues${ALL ? ' (--all)' : ' (name/kind mismatches)'}…`);

// keep any overrides that already exist so re-runs are additive
let existing = {};
try { const src = readFileSync(path.join(LIB, 'baked-kinds.js'), 'utf8'); const m = src.match(/=\s*(\{[\s\S]*\});/); if (m) existing = JSON.parse(m[1]); } catch {}

const overrides = { ...existing };
let changed = 0, checked = 0;
for (const v of candidates) {
  const d = await details(BAKED_PLACES[v.id].placeId);
  await sleep(140);
  checked++;
  if (!d) continue;
  const want = kindFromGoogle(d.primaryType, d.types);
  if (!want) { continue; }
  if (want.kind !== v.kind) {
    overrides[v.id] = { kind: want.kind, category: want.category };
    changed++;
    console.log(`  ~ ${v.name} · ${v.city}: ${v.kind} -> ${want.kind}  (google: ${d.primaryType})`);
  } else if (overrides[v.id]) {
    // google now agrees with the base def — drop a stale override
    delete overrides[v.id];
  }
}
console.log(`\nChecked ${checked}, corrected ${changed}.`);

const header = `// baked-kinds.js — venue kind/category overrides verified against Google's
// primaryType (see scripts/audit-kinds.js). Applied by seed(); keyed by venue id.
export const KIND_OVERRIDES = `;
writeFileSync(path.join(LIB, 'baked-kinds.js'), header + JSON.stringify(overrides, null, 0) + ';\n');
console.log(`Wrote lib/baked-kinds.js with ${Object.keys(overrides).length} overrides.`);
