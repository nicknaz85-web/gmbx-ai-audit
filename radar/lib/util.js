// util.js — geo, time, decay, hashing, small math helpers.
// No external deps. All pure functions so they're easy to reason about and test.

import crypto from 'node:crypto';

export const MIN = 60 * 1000;
export const now = () => Date.now();

export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const round = (v, d = 0) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
export const sum = (arr) => arr.reduce((a, b) => a + b, 0);
export const mean = (arr) => (arr.length ? sum(arr) / arr.length : 0);

// Great-circle distance in metres between two {lat,lng}.
export function haversineMeters(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// One-way hash so we can correlate a device/user across requests for
// anti-abuse and reputation WITHOUT ever storing or exposing a raw identifier.
const SALT = process.env.RADAR_SALT || 'party-radar-anon-salt-v1';
export function anonHash(...parts) {
  return crypto
    .createHash('sha256')
    .update(SALT + '|' + parts.filter(Boolean).join('|'))
    .digest('hex')
    .slice(0, 16);
}

// Time-decay for a crowd signal, given its age in minutes.
// Smooth exponential (tau≈32min) that mirrors the product's relevance buckets:
//   0–15 very high · 15–30 high · 30–60 medium · 60–120 low · 120+ very low.
// Below FRESH_FLOOR a signal is treated as expired for LIVE status.
const DECAY_TAU = 32;
export const FRESH_FLOOR = 0.06;
export function decayWeight(ageMin) {
  if (ageMin <= 0) return 1;
  return Math.exp(-ageMin / DECAY_TAU);
}
export function isFresh(ageMin) {
  return decayWeight(ageMin) >= FRESH_FLOOR; // ~ up to 90 min
}
export function relevanceLabel(ageMin) {
  if (ageMin <= 15) return 'live';
  if (ageMin <= 30) return 'recent';
  if (ageMin <= 60) return 'fading';
  if (ageMin <= 120) return 'stale';
  return 'expired';
}

export function ageMinutes(ts, ref = now()) {
  return (ref - ts) / MIN;
}

// Deterministic pseudo-random in [0,1) from a string seed — used by the
// simulation so a given night/venue/minute reproduces the same ambient noise.
export function seededRand(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h >>>= 0;
  return h / 4294967296;
}

export function randId(prefix = 'id') {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

// Gaussian bump centred on `peak` (hour, may be fractional & wrap past midnight),
// used for a venue's expected-activity curve across the night.
export function nightCurve(hour, peak, spread) {
  // map so 6am..6am wraps cleanly (nightlife spans midnight)
  let h = hour;
  let p = peak;
  if (h < 6) h += 24;
  if (p < 6) p += 24;
  return Math.exp(-((h - p) ** 2) / (2 * spread * spread));
}

// Demo clock: nightlife apps are boring at 3pm. When enabled, the HOUR OF NIGHT
// used by baseline curves is shifted into prime time (and the day pinned to a
// weekend) so the radar always demos as a live Saturday night. Crucially this
// only affects the historical-shape maths — real elapsed time still drives all
// decay, momentum and signal ages, because those use raw timestamp differences.
let DEMO = null;
function rawNightHour(ts, tz = 3) {
  const d = new Date(ts + tz * 3600 * 1000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}
export function enableDemoClock(targetHour = 0.33, forceDow = 6) {
  DEMO = { hourShift: targetHour - rawNightHour(now()), forceDow };
}
export function disableDemoClock() { DEMO = null; }

// Local "night hour" as a float (e.g. 23.5), demo-shifted when the demo clock is on.
export function nightHour(ts = now(), tzOffsetHours = 3) {
  const raw = rawNightHour(ts, tzOffsetHours);
  return (((raw + (DEMO ? DEMO.hourShift : 0)) % 24) + 24) % 24;
}
export function dayOfWeek(ts = now(), tzOffsetHours = 3) {
  if (DEMO) return DEMO.forceDow;
  const d = new Date(ts + tzOffsetHours * 3600 * 1000);
  // shift so the "night" belongs to the evening it started (after-midnight = prev day)
  const h = d.getUTCHours();
  let dow = d.getUTCDay();
  if (h < 6) dow = (dow + 6) % 7;
  return dow; // 0=Sun..6=Sat
}

export function fmtClock(ts, tzOffsetHours = 3) {
  const d = new Date(ts + tzOffsetHours * 3600 * 1000);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

// hour float -> "12:45 AM"
export function fmtHour(hourFloat) {
  let hf = ((hourFloat % 24) + 24) % 24;
  let h = Math.floor(hf);
  const m = Math.round((hf - h) * 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}
