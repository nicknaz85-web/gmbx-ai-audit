// reclassify-clubs-by-hours.js — Google tags some all-day bars/lounges as
// "night_club" (e.g. Giardino, open 9am–midnight). A real nightclub opens in the
// evening and runs deep into the night. So: any venue currently labelled Club that
// OPENS in the daytime (≤5pm) AND never stays open past ~2am is really a bar. Add
// a kind override for those. Merges into lib/baked-kinds.js.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(__dirname, '..', 'lib');
const { db } = await import('../lib/store.js');
const seedMod = await import('../lib/seed.js');
seedMod.seed();
const { BAKED_HOURS } = await import('../lib/baked-hours.js');
const { KIND_OVERRIDES } = await import('../lib/baked-kinds.js');

// Does it open during the DAYTIME (a period starting 6am–6pm)? And how late does it
// ever stay open (24h+, after-midnight rolls past 24)? An open at hour 0–5 is NIGHT
// (a real late club), NOT a daytime open — that was the bug that mislabelled Crobar.
function hoursShape(id) {
  const h = BAKED_HOURS[id];
  if (!h || !h.periods || !h.periods.length) return null;
  let daytimeOpen = false, latestClose = -1, any = false;
  for (const p of h.periods) {
    if (!p.open) continue;
    any = true;
    const oh = p.open.hour + p.open.minute / 60;
    if (oh >= 6 && oh < 18) daytimeOpen = true; // opens in the daytime
    if (p.close) {
      const ch = p.close.hour + p.close.minute / 60;
      // after-midnight close: either the close is dated to a later day, OR (same day)
      // the close time is earlier than the open time — both mean it rolls past midnight
      const rollover = (p.close.day !== p.open.day || ch <= oh) ? 24 : 0;
      latestClose = Math.max(latestClose, ch + rollover);
    } else {
      latestClose = Math.max(latestClose, 26); // open-ended → treat as late
    }
  }
  return any ? { daytimeOpen, latestClose } : null;
}

const overrides = { ...KIND_OVERRIDES };
let changed = 0;
for (const v of db.venues) {
  const curOv = overrides[v.id];
  const kind = (curOv && curOv.kind) || v.kind;
  const cat = (curOv && curOv.category) || v.category;
  if (!(kind === 'Club' || cat === 'Dancing')) continue; // only re-check clubs
  const s = hoursShape(v.id);
  if (!s) continue; // no hours → leave as-is
  // opens in the DAYTIME AND never stays open past ~00:30 → an all-day bar/lounge,
  // not a nightclub. (Kept conservative: real clubs that close at 1–2am — incl. US
  // clubs capped by liquor laws — are left alone; only midnight-closers get relabelled.)
  if (s.daytimeOpen && s.latestClose <= 24.5) {
    overrides[v.id] = { ...(curOv || {}), kind: 'Bar', category: 'Bars' };
    changed++;
    if (changed <= 30) console.log(`  ~ ${v.name} · ${v.city}: Club -> Bar (daytime open, closes ${(s.latestClose % 24)}:00)`);
  }
}

console.log(`\nReclassified ${changed} early-closing "clubs" to Bar.`);
const src = readFileSync(path.join(LIB, 'baked-kinds.js'), 'utf8');
const m = src.match(/export const KIND_OVERRIDES\s*=\s*(\{[\s\S]*\});/);
writeFileSync(path.join(LIB, 'baked-kinds.js'),
  src.slice(0, m.index) + 'export const KIND_OVERRIDES = ' + JSON.stringify(overrides) + ';' + src.slice(m.index + m[0].length));
console.log(`Wrote lib/baked-kinds.js (${Object.keys(overrides).length} overrides).`);
