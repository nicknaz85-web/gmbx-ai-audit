// discover-venues.js — find REAL nightlife venues per CITY from Google Places
// (New) and bake them in with correct info (coords, rating, hours, photo).
// Fills every city that currently has < TARGET venues, up to TARGET total,
// deduped city-wide and assigned to the nearest neighbourhood.
//
//   node scripts/discover-venues.js            # all under-served cities
//   node scripts/discover-venues.js Durban Lyon # only these cities
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'lib');
const env = readFileSync(path.join(ROOT, '.env'), 'utf8');
const KEY = (env.match(/GOOGLE_PLACES_KEY=(.+)/) || [])[1]?.trim();
if (!KEY) { console.error('No GOOGLE_PLACES_KEY in .env'); process.exit(1); }

const TARGET = 5;
const onlyCities = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
function haversineKm(a, b) { const R = 6371, tr = (d) => d * Math.PI / 180; const dLat = tr(b.lat - a.lat), dLng = tr(b.lng - a.lng); const x = Math.sin(dLat / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// ---- load the seeded world ----
const { db } = await import('../lib/store.js');
const seedMod = await import('../lib/seed.js');
seedMod.seed();
const neighborhoods = db.neighborhoods, venues = db.venues;

// group by CITY
const cities = {};
for (const h of neighborhoods) {
  (cities[h.city] || (cities[h.city] = { hoods: [], names: new Set(), count: 0, city: h.city }));
  cities[h.city].hoods.push({ id: h.id, name: h.name, center: h.center, radius: h.radius });
}
for (const v of venues) { const c = cities[v.city]; if (c) { c.names.add(norm(v.name)); c.count++; } }
for (const c of Object.values(cities)) {
  const n = c.hoods.length;
  c.center = { lat: c.hoods.reduce((s, h) => s + h.center.lat, 0) / n, lng: c.hoods.reduce((s, h) => s + h.center.lng, 0) / n };
  c.radius = Math.min(35000, Math.max(9000, Math.max(...c.hoods.map((h) => h.radius || 500)) * 12));
}

// ---- Places (New) helpers ----
async function searchText(query, center, radiusM) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.types,places.primaryType,places.location,places.rating,places.userRatingCount,places.businessStatus,places.regularOpeningHours,places.photos,places.priceLevel,places.googleMapsUri,places.formattedAddress' },
    body: JSON.stringify({ textQuery: query, maxResultCount: 12, locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: radiusM } } }),
  });
  if (!res.ok) { console.warn('  searchText', res.status, (await res.text()).slice(0, 100)); return []; }
  return (await res.json()).places || [];
}
async function photoUrl(name) {
  try { const res = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=900&skipHttpRedirect=true`, { headers: { 'X-Goog-Api-Key': KEY } }); if (!res.ok) return null; return (await res.json()).photoUri || null; } catch { return null; }
}
const PRICE_EUR = { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 5, PRICE_LEVEL_MODERATE: 10, PRICE_LEVEL_EXPENSIVE: 18, PRICE_LEVEL_VERY_EXPENSIVE: 30 };
const NIGHT_TYPES = new Set(['night_club', 'bar', 'pub', 'dance_hall', 'wine_bar']);
function kindFor(p, isClubQuery) {
  const t = p.primaryType || (p.types || [])[0] || '';
  if (t === 'night_club' || isClubQuery) return { kind: 'Club', category: 'Dancing' };
  if (t === 'wine_bar') return { kind: 'Wine Bar', category: 'Bars' };
  return { kind: 'Bar', category: 'Bars' };
}

const newDefs = [], addResolved = {}, addPlaces = {}, addHours = {}, addPhotos = {};
const usedIds = new Set(venues.map((v) => v.id));

async function processCity(c) {
  const need = TARGET - c.count;
  if (need <= 0) return 0;
  const seen = new Set(c.names);
  const picks = [];
  const queries = [`night club in ${c.city}`, `nightclub in ${c.city}`, `cocktail bar in ${c.city}`, `bar in ${c.city}`];
  for (const q of queries) {
    if (picks.length >= need) break;
    const isClub = /club/.test(q);
    let results; try { results = await searchText(q, c.center, c.radius); } catch { results = []; }
    await sleep(200);
    for (const p of results) {
      if (picks.length >= need) break;
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
      if (!p.location || !p.displayName?.text) continue;
      if ((p.userRatingCount || 0) < 25) continue;
      const types = new Set([p.primaryType, ...(p.types || [])]);
      if (![...types].some((t) => NIGHT_TYPES.has(t))) continue;
      const nm = norm(p.displayName.text);
      if (!nm || seen.has(nm)) continue;
      if (nm.length >= 4 && [...seen].some((e) => e.length >= 4 && (e.includes(nm) || nm.includes(e)))) continue;
      const loc = { lat: +p.location.latitude, lng: +p.location.longitude };
      let hood = c.hoods[0], best = Infinity;
      for (const h of c.hoods) { const d = haversineKm(h.center, loc); if (d < best) { best = d; hood = h; } }
      if (best > 70) continue; // absurdly far from the city → skip
      seen.add(nm);
      picks.push({ p, isClub, loc, hood });
    }
  }
  for (const { p, isClub, loc, hood } of picks) {
    const name = p.displayName.text.trim();
    let id = slugify(name) + '_' + hood.id; while (usedIds.has(id)) id += '_2'; usedIds.add(id);
    const { kind, category } = kindFor(p, isClub);
    const ratings = p.userRatingCount || 0;
    const peakRate = Math.max(8, Math.min(20, Math.round(Math.log10(ratings + 1) * 5)));
    const capacity = kind === 'Club' ? 400 : 180;
    const price = kind === 'Club' ? (PRICE_EUR[p.priceLevel] ?? 10) : (PRICE_EUR[p.priceLevel] ?? 0);
    newDefs.push(`  ['${esc(name)}', '${hood.id}', '${category}', '${kind}', ${capacity}, 0, ${peakRate}, ${price}, { mult: 1, trend: 0.6 }, true],`);
    addResolved[id] = { lat: +loc.lat.toFixed(6), lng: +loc.lng.toFixed(6) };
    addPlaces[id] = { placeId: p.id, location: addResolved[id], rating: p.rating || null, ratings, gmapsUrl: p.googleMapsUri || null, address: p.formattedAddress || null };
    const periods = (p.regularOpeningHours?.periods || []).filter((x) => x.open).map((x) => ({ open: { day: x.open.day, hour: x.open.hour || 0, minute: x.open.minute || 0 }, ...(x.close ? { close: { day: x.close.day, hour: x.close.hour || 0, minute: x.close.minute || 0 } } : {}) }));
    if (periods.length) addHours[id] = { periods, businessStatus: 'OPERATIONAL' };
    const ph = p.photos && p.photos[0]?.name;
    if (ph) { const url = await photoUrl(ph); if (url) addPhotos[id] = url; await sleep(100); }
  }
  return picks.length;
}

let targets = Object.values(cities).filter((c) => c.count < TARGET);
if (onlyCities.length) targets = targets.filter((c) => onlyCities.some((x) => x.toLowerCase() === c.city.toLowerCase()));
targets.sort((a, b) => a.city.localeCompare(b.city));
console.log(`Cities to fill: ${targets.length}`);
let added = 0, done = 0;
for (const c of targets) { const n = await processCity(c); added += n; done++; console.log(`[${done}/${targets.length}] ${c.city} +${n} (had ${c.count})`); }
console.log(`\nDiscovered ${added} new venues. Writing files…`);

function mergeJsonExport(file, varName, additions) {
  const p = path.join(LIB, file);
  const src = readFileSync(p, 'utf8');
  const m = src.match(new RegExp('export const ' + varName + '\\s*=\\s*(\\{[\\s\\S]*\\});'));
  if (!m) { console.warn('could not parse', file); return; }
  const obj = JSON.parse(m[1]);
  Object.assign(obj, additions);
  writeFileSync(p, src.slice(0, m.index) + `export const ${varName} = ${JSON.stringify(obj)};` + src.slice(m.index + m[0].length));
  console.log(`  ${file}: +${Object.keys(additions).length} (now ${Object.keys(obj).length})`);
}
mergeJsonExport('resolved.js', 'RESOLVED', addResolved);
mergeJsonExport('baked-places.js', 'BAKED_PLACES', addPlaces);
mergeJsonExport('baked-hours.js', 'BAKED_HOURS', addHours);
mergeJsonExport('baked-photos.js', 'BAKED_PHOTOS', addPhotos);
if (newDefs.length) {
  const p = path.join(LIB, 'seed.js');
  const src = readFileSync(p, 'utf8');
  const start = src.indexOf('const VENUE_DEFS = [');
  const close = src.indexOf('\n];', start);
  if (start >= 0 && close >= 0) {
    writeFileSync(p, src.slice(0, close) + '\n  // --- discovered from Google Places ---\n' + newDefs.join('\n') + src.slice(close));
    console.log(`  seed.js: +${newDefs.length} VENUE_DEFS`);
  } else console.warn('could not find VENUE_DEFS');
}
console.log('Done.');
