// besttime.js — opportunistic real foot-traffic via BestTime.app.
// Lazy + credit-safe: only fetches when a venue is opened, and permanently
// caches "no data" so it never re-spends a credit on a venue BestTime can't
// forecast (common for night-only clubs). Falls back silently when unavailable.

import { db } from './store.js';
import { now, MIN } from './util.js';

const BASE = 'https://besttime.app/api/v1';
const KEY = () => process.env.BESTTIME_PRIVATE_KEY;
export const enabled = () => !!KEY();

const cityName = (v) => {
  const a = db.neighborhoods.find((n) => n.id === v.neighborhood);
  return (a && a.city) || v.neighborhoodName || '';
};
const addrOf = (v) => (v.address || `${v.neighborhoodName}, ${cityName(v)}`).replace(/^,\s*/, '').trim();

async function post(pathname, params) {
  const qs = new URLSearchParams({ api_key_private: KEY(), ...params }).toString();
  const r = await fetch(`${BASE}${pathname}?${qs}`, { method: 'POST' });
  return r.json();
}

// Refresh one venue's live busyness. Positive cache 5 min; "dead" cached forever.
export async function refreshVenue(v) {
  // require a real street address (from Google Places) — name+city lookups waste
  // credits and rarely resolve for night clubs. Dormant until addresses exist.
  if (!enabled() || !v || !v.address) return;
  const c = db.besttime[v.id];
  const t = now();
  if (c) {
    if (c.dead) return;
    if (c.ts && t - c.ts < 5 * MIN) return;
  }
  const venue_name = v.name, venue_address = addrOf(v);
  try {
    let live = await post('/forecasts/live', { venue_name, venue_address });
    if (live && /not found/i.test(live.message || '')) {
      const f = await post('/forecasts', { venue_name, venue_address });
      if (!f || f.status !== 'OK') { db.besttime[v.id] = { dead: true, ts: t }; return; }
      live = await post('/forecasts/live', { venue_name, venue_address });
    }
    const a = live && live.analysis;
    if (!live || live.status === 'Error' || !a) { db.besttime[v.id] = { dead: true, ts: t }; return; }
    const busy = a.venue_live_busyness_available ? a.venue_live_busyness : a.venue_forecasted_busyness;
    if (busy == null) { db.besttime[v.id] = { dead: true, ts: t }; return; }
    db.besttime[v.id] = { available: true, live: !!a.venue_live_busyness_available, busyness: busy, ts: t };
  } catch (e) {
    db.besttime[v.id] = { dead: true, ts: t }; // network/parse error — don't retry-spend
  }
}

export function getBusyness(id) {
  const c = db.besttime[id];
  return c && c.available ? c : null;
}
