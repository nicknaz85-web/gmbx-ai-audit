// add-named.js — add specific famous venues (by name) and top up sparse cities,
// pulling REAL Google Places (New) data and baking it in exactly like
// discover-venues.js (VENUE_DEFS + RESOLVED + BAKED_PLACES + BAKED_HOURS + BAKED_PHOTOS).
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'lib');
const env = readFileSync(path.join(ROOT, '.env'), 'utf8');
const KEY = (env.match(/GOOGLE_PLACES_KEY=(.+)/) || [])[1]?.trim();
if (!KEY) { console.error('No GOOGLE_PLACES_KEY in .env'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
function haversineKm(a, b) { const R = 6371, tr = (d) => d * Math.PI / 180; const dLat = tr(b.lat - a.lat), dLng = tr(b.lng - a.lng); const x = Math.sin(dLat / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

const { db } = await import('../lib/store.js');
const seedMod = await import('../lib/seed.js');
seedMod.seed();

const cities = {};
for (const h of db.neighborhoods) {
  (cities[h.city] || (cities[h.city] = { hoods: [], names: new Set(), count: 0, city: h.city }));
  cities[h.city].hoods.push({ id: h.id, name: h.name, center: h.center, radius: h.radius });
}
for (const v of db.venues) { const c = cities[v.city]; if (c) { c.names.add(norm(v.name)); c.count++; } }
for (const c of Object.values(cities)) {
  const n = c.hoods.length;
  c.center = { lat: c.hoods.reduce((s, h) => s + h.center.lat, 0) / n, lng: c.hoods.reduce((s, h) => s + h.center.lng, 0) / n };
  c.radius = Math.min(35000, Math.max(9000, Math.max(...c.hoods.map((h) => h.radius || 500)) * 12));
}

async function searchText(query, center, radiusM) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.types,places.primaryType,places.location,places.rating,places.userRatingCount,places.businessStatus,places.regularOpeningHours,places.photos,places.priceLevel,places.googleMapsUri,places.formattedAddress,places.servesLunch,places.servesDinner,places.servesBrunch' },
    body: JSON.stringify({ textQuery: query, maxResultCount: 12, locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: radiusM } } }),
  });
  if (!res.ok) { console.warn('  searchText', res.status, (await res.text()).slice(0, 120)); return []; }
  return (await res.json()).places || [];
}
async function photoUrl(name) {
  try { const res = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=900&skipHttpRedirect=true`, { headers: { 'X-Goog-Api-Key': KEY } }); if (!res.ok) return null; return (await res.json()).photoUri || null; } catch { return null; }
}
const PRICE_EUR = { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 5, PRICE_LEVEL_MODERATE: 10, PRICE_LEVEL_EXPENSIVE: 18, PRICE_LEVEL_VERY_EXPENSIVE: 30 };
const NIGHT_TYPES = new Set(['night_club', 'bar', 'pub', 'dance_hall', 'wine_bar', 'restaurant']);
function kindFor(p) {
  const t = p.primaryType || (p.types || [])[0] || '';
  if (t === 'night_club') return { kind: 'Club', category: 'Dancing' };
  if (t === 'wine_bar') return { kind: 'Wine Bar', category: 'Bars' };
  return { kind: 'Bar', category: 'Bars' };
}

const newDefs = [], addResolved = {}, addPlaces = {}, addHours = {}, addPhotos = {};
const usedIds = new Set(db.venues.map((v) => v.id));

async function bake(city, p, hood) {
  const name = p.displayName.text.trim();
  let id = slugify(name) + '_' + hood.id; while (usedIds.has(id)) id += '_2'; usedIds.add(id);
  const { kind, category } = kindFor(p);
  const loc = { lat: +p.location.latitude, lng: +p.location.longitude };
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
  const food = p.servesLunch || p.servesDinner || p.servesBrunch ? ' [food]' : '';
  console.log(`  + ${name} (${kind}, ${ratings} ratings)${food} -> ${city}`);
  return true;
}

// pick the best Google match for a named query
function bestMatch(results, wantName, center) {
  const wn = norm(wantName);
  let best = null, bestScore = -1;
  for (const p of results) {
    if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
    if (!p.location || !p.displayName?.text) continue;
    const nm = norm(p.displayName.text);
    const nameHit = nm === wn ? 3 : (nm.includes(wn) || wn.includes(nm)) ? 2 : 0;
    if (nameHit < 2) continue; // must actually be the venue we asked for
    const km = haversineKm(center, { lat: +p.location.latitude, lng: +p.location.longitude });
    if (km > 25) continue;
    const score = nameHit * 1000 + Math.min(2000, p.userRatingCount || 0) / 100;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

// ---- 1) Famous named Budapest food-bars everyone talks about ----
const BP = cities['Budapest'];
const bpHood = BP.hoods[0];
const wanted = ['Mazel Tov Budapest', "Anker't Budapest", 'Doboz Budapest', 'Kőleves Kert Budapest', 'Ellátó Kert Budapest'];
console.log('Budapest named venues:');
for (const q of wanted) {
  const want = q.replace(/ Budapest$/, '');
  if ([...BP.names].some((e) => e === norm(want) || (norm(want).length >= 4 && (e.includes(norm(want)) || norm(want).includes(e))))) { console.log(`  = ${want} already present, skip`); continue; }
  let res; try { res = await searchText(q, BP.center, BP.radius); } catch { res = []; }
  await sleep(200);
  const p = bestMatch(res, want, BP.center);
  if (!p) { console.log(`  ! no confident match for ${want}`); continue; }
  if (!(p.servesLunch || p.servesDinner || p.servesBrunch)) console.log(`  (note: ${p.displayName.text} — Google doesn't flag food, adding anyway)`);
  BP.names.add(norm(p.displayName.text));
  await bake('Budapest', p, bpHood);
}

// ---- 2) Top up any city still under 5 (e.g. Chengdu) with broader queries ----
const TARGET = 5;
for (const c of Object.values(cities)) {
  if (c.count >= TARGET) continue;
  const need = TARGET - c.count;
  const seen = new Set(c.names);
  const picks = [];
  const queries = c.city === 'Chengdu'
    ? ['pub in Chengdu', 'irish bar Chengdu', 'music bar Chengdu', 'cocktail bar Chengdu', 'nightclub in Chengdu', 'bar in Chengdu']
    : [`night club in ${c.city}`, `bar in ${c.city}`, `cocktail bar in ${c.city}`, `lounge in ${c.city}`];
  const floor = c.city === 'Chengdu' ? 10 : 15;
  console.log(`Top-up ${c.city} (has ${c.count}, need ${need}):`);
  for (const q of queries) {
    if (picks.length >= need) break;
    let res; try { res = await searchText(q, c.center, c.radius); } catch { res = []; }
    await sleep(200);
    for (const p of res) {
      if (picks.length >= need) break;
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
      if (!p.location || !p.displayName?.text) continue;
      if ((p.userRatingCount || 0) < floor) continue;
      const types = new Set([p.primaryType, ...(p.types || [])]);
      if (![...types].some((t) => NIGHT_TYPES.has(t))) continue;
      const nm = norm(p.displayName.text);
      if (!nm || seen.has(nm)) continue;
      if (nm.length >= 4 && [...seen].some((e) => e.length >= 4 && (e.includes(nm) || nm.includes(e)))) continue;
      const loc = { lat: +p.location.latitude, lng: +p.location.longitude };
      let hood = c.hoods[0], best = Infinity;
      for (const h of c.hoods) { const d = haversineKm(h.center, loc); if (d < best) { best = d; hood = h; } }
      if (best > 70) continue;
      seen.add(nm); picks.push({ p, hood });
    }
  }
  for (const { p, hood } of picks) await bake(c.city, p, hood);
  if (!picks.length) console.log('  ! Google returned no new usable venues (sparse coverage)');
}

// ---- write files ----
console.log(`\nAdding ${newDefs.length} venues. Writing files…`);
function mergeJsonExport(file, varName, additions) {
  if (!Object.keys(additions).length) return;
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
    writeFileSync(p, src.slice(0, close) + '\n  // --- named + top-up (Google Places) ---\n' + newDefs.join('\n') + src.slice(close));
    console.log(`  seed.js: +${newDefs.length} VENUE_DEFS`);
  } else console.warn('could not find VENUE_DEFS');
}
console.log('Done.');
