// events.js — self-updating "what's on tonight" per venue, from the Ticketmaster
// Discovery API. We query ONCE PER CITY (not per venue) for ALL upcoming events,
// then match each event's Ticketmaster venue to one of ours by name + proximity.
// Refreshed on boot and once a day. No key set → the whole thing is a no-op and
// venues simply show no events (never fabricated data).
import { cityTz } from './hours.js';

const TM = 'https://app.ticketmaster.com/discovery/v2/events.json';
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
function haversineKm(a, b) { const R = 6371, tr = (d) => d * Math.PI / 180; const dLat = tr(b.lat - a.lat), dLng = tr(b.lng - a.lng); const x = Math.sin(dLat / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// venueId -> [{ date:'YYYY-MM-DD', name, artists:[..], time:'11:00 PM', url }]
let CACHE = {};
let lastRefresh = 0;
let refreshing = false;

export function eventsEnabled() { return !!process.env.TICKETMASTER_KEY; }
export function eventsStatus() { return { enabled: eventsEnabled(), venuesWithEvents: Object.keys(CACHE).length, lastRefresh }; }

// venue-local calendar date (YYYY-MM-DD) for "is this tonight?"
function localDateOf(city, ref) {
  const d = new Date(ref + cityTz(city) * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
// pick a good wide cover from Ticketmaster's images (prefer 16:9, widest, non-fallback)
function bestImage(images) {
  if (!Array.isArray(images) || !images.length) return null;
  const real = images.filter((i) => i && i.url && !i.fallback);
  const pool = real.length ? real : images.filter((i) => i && i.url);
  if (!pool.length) return null;
  const wide = pool.filter((i) => i.ratio === '16_9');
  const pick = (wide.length ? wide : pool).sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  return pick ? pick.url : null;
}
function fmtTime(t) { // "23:00:00" -> "11:00 PM"
  if (!t) return null;
  let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12; return `${h}${m ? ':' + String(m).padStart(2, '0') : ''} ${ap}`;
}

// Upcoming events for a venue (today first). Returns the soonest for the card
// chip plus the full week's list (each with a Ticketmaster cover image) for the
// "all events this week" modal. `full` includes the whole list; without it we
// keep the payload light (soonest + count only) for the big /api/state response.
export function upcomingFor(venueId, city, ref = Date.now(), full = false) {
  const list = CACHE[venueId]; if (!list || !list.length) return null;
  const today = localDateOf(city, ref);
  const future = list.filter((e) => e.date >= today).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  if (!future.length) return null;
  const e = future[0];
  const out = { image: e.image || null, name: e.name, artists: e.artists || [], time: e.time || null, url: e.url || null, date: e.date, isTonight: e.date === today, count: future.length, more: Math.max(0, future.length - 1) };
  if (full) out.events = future.map((x) => ({ image: x.image || null, name: x.name, artists: x.artists || [], time: x.time || null, url: x.url || null, date: x.date, isTonight: x.date === today }));
  return out;
}

async function fetchArea(center, key, startISO, endISO, radiusKm) {
  // no classification filter — pull ALL event types near the area; matching to one
  // of our nightlife venues (by name + proximity) is what keeps results relevant,
  // so a club night Ticketmaster tags as "Undefined"/comedy/etc. still comes through.
  const r = Math.max(2, Math.min(50, Math.round(radiusKm)));
  const url = `${TM}?apikey=${encodeURIComponent(key)}&latlong=${center.lat.toFixed(4)},${center.lng.toFixed(4)}&radius=${r}&unit=km&startDateTime=${startISO}&endDateTime=${endISO}&size=199&sort=date,asc`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j._embedded && j._embedded.events) || [];
  } catch { return []; }
}

// Build/refresh the cache from Ticketmaster. Groups our venues by NEIGHBOURHOOD
// (small areas → each query isn't crowded out by a big city's flood of concerts)
// and queries Ticketmaster once per group, deduping each event to its best venue.
export async function refreshEvents(venues) {
  const key = process.env.TICKETMASTER_KEY;
  if (!key || refreshing) return;
  refreshing = true;
  try {
    // group by neighbourhood id (fall back to city) so each query covers a tight area
    const groups = {};
    for (const v of venues) {
      if (!v.coords) continue;
      const gid = v.neighborhood || v.city;
      (groups[gid] || (groups[gid] = [])).push(v);
    }
    const now = Date.now();
    const startISO = new Date(now).toISOString().slice(0, 19) + 'Z';
    const endISO = new Date(now + 8 * 864e5).toISOString().slice(0, 19) + 'Z';
    const chosen = {}; // ticketmaster eventId -> best { venueId, nameHit, km, ev }
    for (const gid of Object.keys(groups)) {
      const vs = groups[gid];
      const center = { lat: vs.reduce((s, v) => s + v.coords.lat, 0) / vs.length, lng: vs.reduce((s, v) => s + v.coords.lng, 0) / vs.length };
      let spread = 0; for (const v of vs) spread = Math.max(spread, haversineKm(center, v.coords));
      const events = await fetchArea(center, key, startISO, endISO, spread + 3); // cover the hood + ~3km buffer
      await sleep(180); // stay well under Ticketmaster's 5 req/sec
      for (const ev of events) {
        const tmV = ev._embedded && ev._embedded.venues && ev._embedded.venues[0];
        if (!tmV || !ev.id) continue;
        const loc = tmV.location ? { lat: +tmV.location.latitude, lng: +tmV.location.longitude } : null;
        const tmName = norm(tmV.name);
        const isMusic = ((ev.classifications) || []).some((c) => c && c.segment && c.segment.name === 'Music');
        // best venue in this group for the event: NAME match (any event type) wins;
        // otherwise a music event essentially AT one of our venues (≤250m), so nearby
        // tourist attractions never attach to a club.
        let named = null, near = null, nearKm = Infinity;
        for (const v of vs) {
          const vn = norm(v.name);
          const nameHit = vn && tmName && (vn === tmName || (vn.length >= 4 && (tmName.includes(vn) || vn.includes(tmName))));
          const km = loc ? haversineKm(v.coords, loc) : Infinity;
          if (nameHit && km < 3) { named = v; break; }
          if (km < nearKm) { nearKm = km; near = v; }
        }
        let venue = null, nameHit = false, km = Infinity;
        if (named) { venue = named; nameHit = true; km = 0; }
        else if (isMusic && near && nearKm <= 0.25) { venue = near; km = nearKm; }
        if (!venue) continue;
        // dedupe across groups: keep the strongest claim on each event
        const cur = chosen[ev.id];
        const better = !cur || (nameHit && !cur.nameHit) || (nameHit === cur.nameHit && km < cur.km);
        if (better) chosen[ev.id] = { venueId: venue.id, nameHit, km, ev };
      }
    }
    const next = {};
    for (const eid of Object.keys(chosen)) {
      const { venueId, ev } = chosen[eid];
      const artists = ((ev._embedded && ev._embedded.attractions) || []).map((a) => a.name).filter(Boolean).slice(0, 4);
      const rec = { date: ev.dates && ev.dates.start && ev.dates.start.localDate, time: fmtTime(ev.dates && ev.dates.start && ev.dates.start.localTime), name: ev.name, artists, url: ev.url || null, image: bestImage(ev.images) };
      if (!rec.date) continue;
      (next[venueId] || (next[venueId] = [])).push(rec);
    }
    CACHE = next;
    lastRefresh = Date.now();
    console.log(`  🎟️  Events refreshed: ${Object.keys(CACHE).length} venues have upcoming lineups`);
  } finally { refreshing = false; }
}

// Kick off on boot, then refresh once a day on its own (only when a key is set).
export function scheduleEvents(venues) {
  if (!process.env.TICKETMASTER_KEY) return;
  refreshEvents(venues).catch(() => {});
  setInterval(() => refreshEvents(venues).catch(() => {}), 24 * 3600 * 1000);
}
