// discover-hoods.js — discover venues for SPECIFIC neighbourhoods (by id), near
// each hood's centre. Use when a city already has enough venues overall but a new
// sub-area (e.g. a college district) needs its own spots. Bakes like discover-venues.
//   node scripts/discover-hoods.js la-westwood la-usc la-downtown la-silverlake
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'lib');
const env = readFileSync(path.join(ROOT, '.env'), 'utf8');
const KEY = (env.match(/GOOGLE_PLACES_KEY=(.+)/) || [])[1]?.trim();
if (!KEY) { console.error('No GOOGLE_PLACES_KEY in .env'); process.exit(1); }

const TARGET = 4; // per hood
const wanted = process.argv.slice(2);
if (!wanted.length) { console.error('pass hood ids'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
function haversineKm(a, b) { const R = 6371, tr = (d) => d * Math.PI / 180; const dLat = tr(b.lat - a.lat), dLng = tr(b.lng - a.lng); const x = Math.sin(dLat / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

const { db } = await import('../lib/store.js');
const seedMod = await import('../lib/seed.js');
seedMod.seed();

async function searchText(query, center, radiusM) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.types,places.primaryType,places.location,places.rating,places.userRatingCount,places.businessStatus,places.regularOpeningHours,places.photos,places.priceLevel,places.googleMapsUri,places.formattedAddress' },
    body: JSON.stringify({ textQuery: query, maxResultCount: 15, locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: radiusM } } }),
  });
  if (!res.ok) { console.warn('  searchText', res.status); return []; }
  return (await res.json()).places || [];
}
async function photoUrl(name) {
  try { const res = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=900&skipHttpRedirect=true`, { headers: { 'X-Goog-Api-Key': KEY } }); if (!res.ok) return null; return (await res.json()).photoUri || null; } catch { return null; }
}
const PRICE_EUR = { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 5, PRICE_LEVEL_MODERATE: 10, PRICE_LEVEL_EXPENSIVE: 18, PRICE_LEVEL_VERY_EXPENSIVE: 30 };
const NIGHT_TYPES = new Set(['night_club', 'bar', 'pub', 'dance_hall', 'wine_bar']);
function kindFor(p, isClub) {
  const t = p.primaryType || (p.types || [])[0] || '';
  if (t === 'night_club' || isClub) return { kind: 'Club', category: 'Dancing' };
  if (t === 'wine_bar') return { kind: 'Wine Bar', category: 'Bars' };
  return { kind: 'Bar', category: 'Bars' };
}

const newDefs = [], addResolved = {}, addPlaces = {}, addHours = {}, addPhotos = {};
const usedIds = new Set(db.venues.map((v) => v.id));
const seenGlobal = new Set(db.venues.map((v) => norm(v.name)));

async function processHood(hoodId) {
  const h = db.neighborhoods.find((x) => x.id === hoodId);
  if (!h) { console.warn('  no hood', hoodId); return 0; }
  const student = (h.bestFor || []).includes('Student');
  const radiusM = Math.min(4000, Math.max(2500, (h.radius || 500) * 5));
  const queries = student
    ? [`bar near ${h.name} ${h.city}`, `night club near ${h.name} ${h.city}`, `student bar ${h.city}`, `pub ${h.name} ${h.city}`, `cocktail bar ${h.name} ${h.city}`]
    : [`night club ${h.name} ${h.city}`, `bar ${h.name} ${h.city}`, `cocktail bar ${h.name} ${h.city}`, `lounge ${h.name} ${h.city}`];
  const picks = [];
  for (const q of queries) {
    if (picks.length >= TARGET) break;
    const isClub = /club/.test(q);
    let results; try { results = await searchText(q, h.center, radiusM); } catch { results = []; }
    await sleep(200);
    for (const p of results) {
      if (picks.length >= TARGET) break;
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
      if (!p.location || !p.displayName?.text) continue;
      if ((p.userRatingCount || 0) < 20) continue;
      const types = new Set([p.primaryType, ...(p.types || [])]);
      if (![...types].some((t) => NIGHT_TYPES.has(t))) continue;
      const loc = { lat: +p.location.latitude, lng: +p.location.longitude };
      if (haversineKm(h.center, loc) > radiusM / 1000 + 0.5) continue; // keep it near the hood
      const nm = norm(p.displayName.text);
      if (!nm || seenGlobal.has(nm)) continue;
      if (nm.length >= 4 && [...seenGlobal].some((e) => e.length >= 4 && (e.includes(nm) || nm.includes(e)))) continue;
      seenGlobal.add(nm);
      picks.push({ p, isClub, loc });
    }
  }
  for (const { p, isClub, loc } of picks) {
    const name = p.displayName.text.trim();
    let id = slugify(name) + '_' + h.id; while (usedIds.has(id)) id += '_2'; usedIds.add(id);
    const { kind, category } = kindFor(p, isClub);
    const ratings = p.userRatingCount || 0;
    const peakRate = Math.max(8, Math.min(20, Math.round(Math.log10(ratings + 1) * 5)));
    const capacity = kind === 'Club' ? 400 : 180;
    const price = kind === 'Club' ? (PRICE_EUR[p.priceLevel] ?? 10) : (PRICE_EUR[p.priceLevel] ?? 0);
    newDefs.push(`  ['${esc(name)}', '${h.id}', '${category}', '${kind}', ${capacity}, 0, ${peakRate}, ${price}, { mult: 1, trend: 0.6 }, true],`);
    addResolved[id] = { lat: +loc.lat.toFixed(6), lng: +loc.lng.toFixed(6) };
    addPlaces[id] = { placeId: p.id, location: addResolved[id], rating: p.rating || null, ratings, gmapsUrl: p.googleMapsUri || null, address: p.formattedAddress || null };
    const periods = (p.regularOpeningHours?.periods || []).filter((x) => x.open).map((x) => ({ open: { day: x.open.day, hour: x.open.hour || 0, minute: x.open.minute || 0 }, ...(x.close ? { close: { day: x.close.day, hour: x.close.hour || 0, minute: x.close.minute || 0 } } : {}) }));
    if (periods.length) addHours[id] = { periods, businessStatus: 'OPERATIONAL' };
    const ph = p.photos && p.photos[0]?.name;
    if (ph) { const url = await photoUrl(ph); if (url) addPhotos[id] = url; await sleep(100); }
    console.log(`  + ${name} (${kind}, ${ratings}) -> ${h.name}`);
  }
  return picks.length;
}

let added = 0;
for (const hid of wanted) { console.log(hid + ':'); added += await processHood(hid); }
console.log(`\nDiscovered ${added} venues. Writing files…`);
function mergeJsonExport(file, varName, additions) {
  if (!Object.keys(additions).length) return;
  const p = path.join(LIB, file);
  const src = readFileSync(p, 'utf8');
  const m = src.match(new RegExp('export const ' + varName + '\\s*=\\s*(\\{[\\s\\S]*\\});'));
  if (!m) { console.warn('could not parse', file); return; }
  const obj = JSON.parse(m[1]); Object.assign(obj, additions);
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
  const close = src.indexOf('\n];', src.indexOf('const VENUE_DEFS = ['));
  writeFileSync(p, src.slice(0, close) + '\n  // --- discovered per-hood ---\n' + newDefs.join('\n') + src.slice(close));
  console.log(`  seed.js: +${newDefs.length} VENUE_DEFS`);
}
console.log('Done.');
