// purge-adult-venues.js — remove strip clubs / gentlemen's clubs / adult venues
// from the dataset (the app is about dancing, drinks & nightlife, not adult clubs).
// Removes matching venues from seed.js VENUE_DEFS and every baked map. --dry to preview.
//   node scripts/purge-adult-venues.js --dry
//   node scripts/purge-adult-venues.js
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'lib');
const DRY = process.argv.includes('--dry');
const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// high-confidence adult-venue name patterns (deliberately avoids bare "cabaret",
// which catches legit clubs like Cabaret Voltaire, and "workmen's").
const AP = "['’‘]?"; // straight or curly apostrophe (optional)
const ADULT = new RegExp(
  `gentlemen${AP}s? ?(club|lounge)|gentlemens ?(club|lounge)|ladies and gentlemens|\\bstrip ?club\\b|stripclub|striptease|strip ?tease|strip show|strip ?(and|&) ?bar|\\(\\s*strip|club de strip|\\btopless\\b|\\b18\\+|go-?go ?(bar|pub|club)|klub ?gogo|exotic danc|\\bstrippers?\\b|showclub|para adultos|club nocturno para adultos|adult ?(club|entertainment|lounge)|\\bmen${AP}s club\\b|sweet cheeks|rick${AP}s cabaret|\\bburlesque\\b|\\bpeep ?show\\b`, 'i');
// US-style "cabaret" that are really strip clubs — matched by EXACT name so the
// bare word "cabaret" (Cabaret Voltaire, Havana show cabarets…) stays protected.
const EXTRA_NAMES = new Set(['Love Cabaret', 'Curves Cabaret', "Danny's Cabaret", 'Rick’s Cabaret', "Rick's Cabaret"]);

const { db } = await import('../lib/store.js');
const seedMod = await import('../lib/seed.js');
seedMod.seed();

const doomed = db.venues.filter((v) => ADULT.test(v.name) || EXTRA_NAMES.has(v.name));
console.log(`Adult venues to remove: ${doomed.length}`);
doomed.forEach((v) => console.log(`  ✕ ${v.name} · ${v.city}`));
const doomedIds = new Set(doomed.map((v) => v.id));
const doomedNames = new Set(doomed.map((v) => v.name));
if (DRY) { console.log('\nDRY — nothing written.'); process.exit(0); }

// 1) seed.js VENUE_DEFS — drop lines whose first quoted field is a doomed name
const seedPath = path.join(LIB, 'seed.js');
const seedSrc = readFileSync(seedPath, 'utf8');
const seedLines = seedSrc.split('\n');
let removedDefs = 0;
const keptLines = seedLines.filter((line) => {
  const m = line.match(/^\s*\['((?:[^'\\]|\\.)*)',/); // a VENUE_DEFS row: ['Name', ...
  if (!m) return true;
  const name = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  if (doomedNames.has(name)) { removedDefs++; return false; }
  return true;
});
writeFileSync(seedPath, keptLines.join('\n'));
console.log(`\nseed.js: removed ${removedDefs} VENUE_DEFS`);

// 2) baked maps keyed by venue id
function pruneMap(file, varName) {
  const p = path.join(LIB, file);
  const src = readFileSync(p, 'utf8');
  const m = src.match(new RegExp('export const ' + varName + '\\s*=\\s*(\\{[\\s\\S]*\\});'));
  if (!m) { console.warn('  could not parse', file); return; }
  const obj = JSON.parse(m[1]);
  let n = 0;
  for (const id of Object.keys(obj)) if (doomedIds.has(id)) { delete obj[id]; n++; }
  writeFileSync(p, src.slice(0, m.index) + `export const ${varName} = ${JSON.stringify(obj)};` + src.slice(m.index + m[0].length));
  console.log(`  ${file}: -${n}`);
}
pruneMap('resolved.js', 'RESOLVED');
pruneMap('baked-places.js', 'BAKED_PLACES');
pruneMap('baked-hours.js', 'BAKED_HOURS');
pruneMap('baked-photos.js', 'BAKED_PHOTOS');
pruneMap('baked-instagram.js', 'BAKED_INSTAGRAM');
pruneMap('baked-entry.js', 'BAKED_ENTRY');
pruneMap('baked-kinds.js', 'KIND_OVERRIDES');

// prune the primaryType cache (plain JSON, not an export)
try {
  const cp = path.join(LIB, 'place-types.json');
  const cache = JSON.parse(readFileSync(cp, 'utf8'));
  let n = 0;
  for (const id of Object.keys(cache)) if (doomedIds.has(id)) { delete cache[id]; n++; }
  writeFileSync(cp, JSON.stringify(cache));
  console.log(`  place-types.json: -${n}`);
} catch {}
console.log('Done.');
