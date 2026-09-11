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
function fmtTime(t) { // "23:00:00" -> "11:00 PM"
  if (!t) return null;
  let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12; return `${h}${m ? ':' + String(m).padStart(2, '0') : ''} ${ap}`;
}

// The soonest upcoming event for a venue (today first), + whether it's tonight.
export function upcomingFor(venueId, city, ref = Date.now()) {
  const list = CACHE[venueId]; if (!list || !list.length) return null;
  const today = localDateOf(city, ref);
  const future = list.filter((e) => e.date >= today).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  if (!future.length) return null;
  const e = future[0];
  return { name: e.name, artists: e.artists || [], time: e.time || null, url: e.url || null, date: e.date, isTonight: e.date === today, more: Math.max(0, future.length - 1) };
}

async function fetchCity(center, key, startISO, endISO) {
  // no classification filter — pull ALL event types near the city; matching to one
  // of our nightlife venues (by name + proximity) is what keeps results relevant,
  // so a club night Ticketmaster tags as "Undefined"/comedy/etc. still comes through.
  const url = `${TM}?apikey=${encodeURIComponent(key)}&latlong=${center.lat.toFixed(4)},${center.lng.toFixed(4)}&radius=25&unit=km&startDateTime=${startISO}&endDateTime=${endISO}&size=200&sort=date,asc`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j._embedded && j._embedded.events) || [];
  } catch { return []; }
}

// Build/refresh the cache from Ticketmaster. Groups venues by city, one query each.
export async function refreshEvents(venues) {
  const key = process.env.TICKETMASTER_KEY;
  if (!key || refreshing) return;
  refreshing = true;
  try {
    // group our venues by city, with a representative centre
    const cities = {};
    for (const v of venues) {
      if (!v.coords) continue;
      (cities[v.city] || (cities[v.city] = [])).push(v);
    }
    const now = Date.now();
    const startISO = new Date(now).toISOString().slice(0, 19) + 'Z';
    const endISO = new Date(now + 8 * 864e5).toISOString().slice(0, 19) + 'Z';
    const next = {};
    for (const [city, vs] of Object.entries(cities)) {
      const center = { lat: vs.reduce((s, v) => s + v.coords.lat, 0) / vs.length, lng: vs.reduce((s, v) => s + v.coords.lng, 0) / vs.length };
      const events = await fetchCity(center, key, startISO, endISO);
      await sleep(220); // stay well under Ticketmaster's 5 req/sec
      for (const ev of events) {
        const tmV = ev._embedded && ev._embedded.venues && ev._embedded.venues[0];
        if (!tmV) continue;
        const loc = tmV.location ? { lat: +tmV.location.latitude, lng: +tmV.location.longitude } : null;
        const tmName = norm(tmV.name);
        // match to one of our venues in this city: name hit, else closest within 400m
        let best = null, bestKm = Infinity;
        for (const v of vs) {
          const vn = norm(v.name);
          const nameHit = vn && tmName && (vn === tmName || (vn.length >= 4 && (tmName.includes(vn) || vn.includes(tmName))));
          const km = loc ? haversineKm(v.coords, loc) : Infinity;
          if (nameHit && km < 3) { best = v; bestKm = 0; break; }
          if (km < bestKm) { bestKm = km; best = v; }
        }
        if (!best || bestKm > 0.4) continue; // no confident venue match → drop
        const artists = ((ev._embedded && ev._embedded.attractions) || []).map((a) => a.name).filter(Boolean).slice(0, 4);
        const rec = { date: ev.dates && ev.dates.start && ev.dates.start.localDate, time: fmtTime(ev.dates && ev.dates.start && ev.dates.start.localTime), name: ev.name, artists, url: ev.url || null };
        if (!rec.date) continue;
        (next[best.id] || (next[best.id] = [])).push(rec);
      }
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
