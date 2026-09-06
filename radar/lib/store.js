// store.js — in-memory state with lightweight JSON snapshot persistence.
// The engine is intentionally storage-agnostic: everything derived (hot score,
// momentum, area scores…) is computed on read from the append-only signal logs,
// so the store only has to keep raw events + a little reputation/feed state.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { now, MIN } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.data');
const SNAPSHOT = path.join(DATA_DIR, 'snapshot.json');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export function ensureMediaDir() { if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true }); }

// Signals older than this are pruned — live crowd data is worthless once cold.
const RETENTION = 3 * 60 * MIN;

export const db = {
  neighborhoods: [], // static-ish reference data (id, name, city, center, radius)
  venues: [], // static venue records incl. baseline pattern
  checkins: [], // {id, venueId, uHash, dHash, ts, coords, accepted, weight, reason}
  reports: [], // {id, venueId, uHash, dHash, ts, coords, vibe, queue, entry, mix, music, confidence}
  pulses: [], // {id, venueId, uHash, ts, state}  (quick "still popping?" taps)
  ownerUpdates: [], // {id, venueId, ts, status, queue, entry, specials, lastEntry, music}
  users: {}, // uHash -> {reports, accurate, first, lastSeen, neighborhoods:{}, badges:[]}
  authUsers: {}, // emailKey -> {id, email, salt, hash, verified, createdAt} (email+password accounts)
  feed: [], // radar feed items {id, ts, venueId, kind, text, sub, area}
  media: [], // community photos/videos {id, venueId, uHash, ts, type, ext} (file on disk in MEDIA_DIR)
  besttime: {}, // venueId -> {available, live, busyness, ts} | {dead, ts}  (real foot-traffic cache)
  places: {}, // venueId -> {address, rating, ratings, priceLevel, openNow, photoRef, gmapsUrl, ts} | {dead, ts}
  prevState: {}, // venueId -> last computed {vibe, hot, momentumState} for transition detection
  meta: { started: now(), lastTick: 0 },
};

export function loadSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT)) {
      const saved = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
      for (const k of ['checkins', 'reports', 'pulses', 'ownerUpdates', 'feed', 'media']) {
        if (Array.isArray(saved[k])) db[k] = saved[k];
      }
      if (saved.users) db.users = saved.users;
      if (saved.authUsers) db.authUsers = saved.authUsers;
      if (saved.prevState) db.prevState = saved.prevState;
      if (saved.places) db.places = saved.places; // resolved Google place ids + cached details
      return true;
    }
  } catch (e) {
    console.warn('[store] snapshot load failed:', e.message);
  }
  return false;
}

let saveTimer = null;
export function saveSnapshotSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveSnapshot, 4000);
}
export function saveSnapshot() {
  saveTimer = null;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = {
      checkins: db.checkins,
      reports: db.reports,
      pulses: db.pulses,
      ownerUpdates: db.ownerUpdates,
      feed: db.feed.slice(-200),
      media: db.media.slice(-400), // metadata only; files live in MEDIA_DIR
      users: db.users,
      authUsers: db.authUsers,
      prevState: db.prevState,
      places: db.places, // resolved Google place ids + cached details (small)
      savedAt: now(),
    };
    fs.writeFileSync(SNAPSHOT, JSON.stringify(out));
  } catch (e) {
    console.warn('[store] snapshot save failed:', e.message);
  }
}

// Drop cold signals so the arrays don't grow without bound and stale crowd
// data never leaks into live status.
export function prune(ref = now()) {
  const cut = ref - RETENTION;
  const feedCut = ref - 100 * MIN;
  db.checkins = db.checkins.filter((c) => c.ts >= cut);
  db.reports = db.reports.filter((r) => r.ts >= cut);
  db.pulses = db.pulses.filter((p) => p.ts >= cut);
  db.ownerUpdates = db.ownerUpdates.filter((o) => o.ts >= ref - 4 * 60 * MIN);
  db.feed = db.feed.filter((f) => f.ts >= feedCut).slice(-200);
}

export const venueById = (id) => db.venues.find((v) => v.id === id);
export const neighborhoodById = (id) => db.neighborhoods.find((n) => n.id === id);

export function pushFeed(item) {
  db.feed.push({ id: 'f_' + now() + '_' + db.feed.length, ...item });
  if (db.feed.length > 250) db.feed = db.feed.slice(-250);
}
