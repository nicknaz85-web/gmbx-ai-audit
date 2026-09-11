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

export function eventsEnabled() { return !!(process.env.TICKETMASTER_KEY || process.env.SKIDDLE_KEY || process.env.SEATGEEK_ID); }
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

function fmtTimeISO(s) { // "2026-09-11T23:00:00" or "... 23:00:00" -> "11:00 PM"
  if (!s) return null;
  const m = String(s).match(/[T ](\d{2}):(\d{2})/);
  return m ? fmtTime(m[1] + ':' + m[2] + ':00') : null;
}

// ---- event PROVIDERS ----------------------------------------------------------
// Each returns a NORMALISED list of events near an area:
//   { id, venueName, loc:{lat,lng}|null, isMusic, date, time, name, artists[], url, image }
// A provider with no key configured returns [] (a no-op), so sources stack freely.

// Ticketmaster Discovery API — broad concert/ticketed coverage worldwide.
async function tmFetch(center, radiusKm, startISO, endISO) {
  const key = process.env.TICKETMASTER_KEY; if (!key) return [];
  const r = Math.max(2, Math.min(50, Math.round(radiusKm)));
  const url = `${TM}?apikey=${encodeURIComponent(key)}&latlong=${center.lat.toFixed(4)},${center.lng.toFixed(4)}&radius=${r}&unit=km&startDateTime=${startISO}&endDateTime=${endISO}&size=199&sort=date,asc`;
  let evs = [];
  try { const res = await fetch(url, { headers: { Accept: 'application/json' } }); if (!res.ok) return []; evs = ((await res.json())._embedded || {}).events || []; } catch { return []; }
  return evs.map((ev) => {
    const tmV = ev._embedded && ev._embedded.venues && ev._embedded.venues[0];
    return { id: 'tm_' + ev.id, venueName: tmV && tmV.name, loc: tmV && tmV.location ? { lat: +tmV.location.latitude, lng: +tmV.location.longitude } : null,
      isMusic: ((ev.classifications) || []).some((c) => c && c.segment && c.segment.name === 'Music'),
      date: ev.dates && ev.dates.start && ev.dates.start.localDate, time: fmtTime(ev.dates && ev.dates.start && ev.dates.start.localTime),
      name: ev.name, artists: ((ev._embedded && ev._embedded.attractions) || []).map((a) => a.name).filter(Boolean).slice(0, 4), url: ev.url || null, image: bestImage(ev.images) };
  });
}

// Skiddle — official UK API with an explicit CLUB event filter (great club nights).
async function skiddleFetch(center, radiusKm, startISO, endISO) {
  const key = process.env.SKIDDLE_KEY; if (!key) return [];
  const miles = Math.max(2, Math.min(30, Math.round(radiusKm * 0.621)));
  const url = `https://www.skiddle.com/api/v1/events/search/?api_key=${encodeURIComponent(key)}&latitude=${center.lat.toFixed(4)}&longitude=${center.lng.toFixed(4)}&radius=${miles}&eventcode=CLUB,LIVE&minDate=${startISO.slice(0, 10)}&maxDate=${endISO.slice(0, 10)}&limit=100&order=date`;
  let results = [];
  try { const res = await fetch(url, { headers: { Accept: 'application/json' } }); if (!res.ok) return []; results = (await res.json()).results || []; } catch { return []; }
  return results.map((r) => ({ id: 'sk_' + r.id, venueName: r.venue && r.venue.name, loc: r.venue && r.venue.latitude ? { lat: +r.venue.latitude, lng: +r.venue.longitude } : null,
    isMusic: true, date: String(r.startdate || r.date || '').slice(0, 10), time: fmtTimeISO(r.startdate || (r.openingtimes && r.openingtimes.doorsopen)),
    name: r.eventname, artists: (r.artists || []).map((a) => (a && a.name) || a).filter(Boolean).slice(0, 4), url: r.link || null, image: r.largeimageurl || r.imageurl || null }));
}

// SeatGeek — official US API (concerts; overlaps Ticketmaster, adds some coverage).
async function seatgeekFetch(center, radiusKm, startISO, endISO) {
  const id = process.env.SEATGEEK_ID; if (!id) return [];
  const km = Math.max(2, Math.min(50, Math.round(radiusKm)));
  const url = `https://api.seatgeek.com/2/events?client_id=${encodeURIComponent(id)}&lat=${center.lat.toFixed(4)}&lon=${center.lng.toFixed(4)}&range=${km}km&datetime_utc.gte=${startISO}&datetime_utc.lte=${endISO}&per_page=100&sort=datetime_local.asc`;
  let evs = [];
  try { const res = await fetch(url, { headers: { Accept: 'application/json' } }); if (!res.ok) return []; evs = (await res.json()).events || []; } catch { return []; }
  return evs.map((ev) => ({ id: 'sg_' + ev.id, venueName: ev.venue && ev.venue.name, loc: ev.venue && ev.venue.location ? { lat: +ev.venue.location.lat, lng: +ev.venue.location.lon } : null,
    isMusic: /concert|music|festival/i.test(ev.type || ''), date: String(ev.datetime_local || '').slice(0, 10), time: fmtTimeISO(ev.datetime_local),
    name: ev.title, artists: (ev.performers || []).map((p) => p.name).filter(Boolean).slice(0, 4), url: ev.url || null,
    image: (ev.performers && ev.performers[0] && (ev.performers[0].image || (ev.performers[0].images && ev.performers[0].images.huge))) || null }));
}

const PROVIDERS = [tmFetch, skiddleFetch, seatgeekFetch];

// Build/refresh the cache from Ticketmaster. Groups our venues by NEIGHBOURHOOD
// (small areas → each query isn't crowded out by a big city's flood of concerts)
// and queries Ticketmaster once per group, deduping each event to its best venue.
export async function refreshEvents(venues) {
  if (!eventsEnabled() || refreshing) return;
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
    const chosen = {}; // eventId -> best { venueId, nameHit, km, ev }
    for (const gid of Object.keys(groups)) {
      const vs = groups[gid];
      const center = { lat: vs.reduce((s, v) => s + v.coords.lat, 0) / vs.length, lng: vs.reduce((s, v) => s + v.coords.lng, 0) / vs.length };
      let spread = 0; for (const v of vs) spread = Math.max(spread, haversineKm(center, v.coords));
      const radiusKm = spread + 3; // cover the hood + ~3km buffer
      // every configured provider in parallel; each is a no-op without its key
      const lists = await Promise.all(PROVIDERS.map((p) => p(center, radiusKm, startISO, endISO).catch(() => [])));
      await sleep(220); // stay under each API's rate limit
      for (const list of lists) for (const ev of list) {
        if (!ev.id || !ev.date) continue;
        const evName = norm(ev.venueName);
        // best venue in this group for the event: NAME match (any event type) wins;
        // otherwise a music event essentially AT one of our venues (≤250m), so nearby
        // attractions never attach to a club.
        let named = null, near = null, nearKm = Infinity;
        for (const v of vs) {
          const vn = norm(v.name);
          const nameHit = vn && evName && (vn === evName || (vn.length >= 4 && (evName.includes(vn) || vn.includes(evName))));
          const km = ev.loc ? haversineKm(v.coords, ev.loc) : Infinity;
          if (nameHit && km < 3) { named = v; break; }
          if (km < nearKm) { nearKm = km; near = v; }
        }
        let venue = null, nameHit = false, km = Infinity;
        if (named) { venue = named; nameHit = true; km = 0; }
        else if (ev.isMusic && near && nearKm <= 0.25) { venue = near; km = nearKm; }
        if (!venue) continue;
        const cur = chosen[ev.id];
        const better = !cur || (nameHit && !cur.nameHit) || (nameHit === cur.nameHit && km < cur.km);
        if (better) chosen[ev.id] = { venueId: venue.id, nameHit, km, ev };
      }
    }
    const next = {};
    const seenKey = {}; // dedupe the same night across providers (Ticketmaster + SeatGeek both list a concert)
    for (const eid of Object.keys(chosen)) {
      const { venueId, ev } = chosen[eid];
      const rec = { date: ev.date, time: ev.time || null, name: ev.name, artists: ev.artists || [], url: ev.url || null, image: ev.image || null };
      if (!rec.date) continue;
      const dk = venueId + '|' + rec.date + '|' + norm(rec.name).slice(0, 24);
      if (seenKey[dk]) continue; seenKey[dk] = 1;
      (next[venueId] || (next[venueId] = [])).push(rec);
    }
    CACHE = next;
    lastRefresh = Date.now();
    const srcs = [process.env.TICKETMASTER_KEY && 'Ticketmaster', process.env.SKIDDLE_KEY && 'Skiddle', process.env.SEATGEEK_ID && 'SeatGeek'].filter(Boolean).join(' + ');
    console.log(`  🎟️  Events refreshed (${srcs}): ${Object.keys(CACHE).length} venues have upcoming lineups`);
  } finally { refreshing = false; }
}

// Kick off on boot, then refresh once a day on its own (only when a key is set).
export function scheduleEvents(venues) {
  if (!eventsEnabled()) return;
  refreshEvents(venues).catch(() => {});
  setInterval(() => refreshEvents(venues).catch(() => {}), 24 * 3600 * 1000);
}
