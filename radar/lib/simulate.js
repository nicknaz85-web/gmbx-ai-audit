// simulate.js — ambient nightlife so the radar keeps breathing without real
// users. Every tick it injects a small number of ANONYMOUS check-ins/pulses per
// venue following that venue's baseline × trend, occasionally a community
// report or an owner special, then runs transition detection to grow the feed.
// Real user actions flow through the same signal logs and dominate when present.

import { db, pushFeed, saveSnapshotSoon, prune } from './store.js';
import { expectedRate } from './seed.js';
import { detectTransitions, areaSnapshot } from './scoring.js';
import { resolveOpen } from './hours.js';
import { getPlace } from './places.js';
import { now, MIN, anonHash, seededRand, randId, nightHour } from './util.js';

let phase = 0;

export function tick() {
  const t = now();
  phase++;

  for (const v of db.venues) {
    // no ambient crowd for a venue that's closed right now
    if (!resolveOpen(v, t, getPlace(v.id)).open) continue;
    const base = expectedRate(v, t) * v.sim.mult;
    // drift the trend a little so venues rise and fall over the night
    v.sim.trend = clamp(v.sim.trend + (seededRand(v.id + phase) - 0.5) * 0.25, -1, 1.2);
    const trendMult = 1 + v.sim.trend * 0.5;
    // expected check-ins in a ~45s tick window
    const perTick = (base / (30 * 60 / 45)) * Math.max(0.05, trendMult);
    let n = Math.floor(perTick);
    if (seededRand(v.id + t) < perTick - n) n++;
    for (let k = 0; k < n; k++) {
      const uHash = anonHash('amb', v.id, t, k);
      db.checkins.push({
        id: randId('ci'),
        venueId: v.id,
        uHash,
        dHash: anonHash('amb-dev', v.id, (phase + k) % 40),
        ts: t - Math.floor(seededRand(uHash) * 20000),
        coords: v.coords,
        accepted: true,
        weight: 0.8,
        reason: 'ok',
        sim: true,
      });
    }
    // occasional ambient quick-pulse from "checked-in" users
    if (n > 0 && seededRand(v.id + 'p' + phase) > 0.75) {
      db.pulses.push({
        id: randId('pl'),
        venueId: v.id,
        uHash: anonHash('amb-pulse', v.id, phase),
        ts: t,
        state: v.sim.trend > 0.3 ? 'busier' : v.sim.trend < -0.3 ? 'slowing' : 'yes',
        sim: true,
      });
    }
  }

  prune(t);
  detectTransitions(t);

  // periodic area-level feed line so the feed always has neighbourhood pulse
  if (phase % 8 === 0) {
    const areas = db.neighborhoods.map((h) => areaSnapshot(h, t));
    const rising = areas.filter((a) => a.heating + a.surging >= 2).sort((a, b) => b.surging - a.surging)[0];
    if (rising) {
      pushFeed({ ts: t, kind: 'area', text: `${rising.surging + rising.heating} venues in ${rising.name} are heating up`, area: rising.name });
    }
  }

  db.meta.lastTick = t;
  saveSnapshotSoon();
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

let timer = null;
export function startSimulation(intervalMs = 45000) {
  if (timer) return;
  // one immediate tick so the feed has fresh content, then interval
  tick();
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
}
export function stopSimulation() {
  if (timer) clearInterval(timer);
  timer = null;
}
