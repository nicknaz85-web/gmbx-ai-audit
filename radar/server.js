// server.js — zero-dependency Node server for PARTY RADAR.
// Serves the frontend from /public and exposes the live-intelligence API.
// State lives in-process (snapshotted to .data/) and is kept alive by the
// ambient simulation in lib/simulate.js.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { db, loadSnapshot, saveSnapshot, saveSnapshotSoon, venueById, neighborhoodById, pushFeed, MEDIA_DIR, ensureMediaDir } from './lib/store.js';
import { seed } from './lib/seed.js';
import { startSimulation } from './lib/simulate.js';
import { refreshVenue as btRefresh, enabled as btEnabled } from './lib/besttime.js';
import { refreshVenue as gpRefresh, refreshStale as gpRefreshStale, warmAll as gpWarmAll, warmInstagram as gpWarmIG, ensureInstagram as gpEnsureIG, isDefunct as gpIsDefunct, enabled as gpEnabled } from './lib/places.js';
import { venueSnapshot, areaSnapshot, clusters, radarFeed, detectTransitions } from './lib/scoring.js';
import {
  getUser, refreshBadges, badgeLabel, screenCheckin, computeReportConfidence,
} from './lib/reputation.js';
import { anonHash, randId, now, MIN, clamp, round, enableDemoClock } from './lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3010;

// load radar/.env (BESTTIME_* keys) without a dependency
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
} catch (e) { /* ignore */ }

// ---- boot ----
// Real wall-clock by default so open/closed and busyness reflect reality — at
// 3pm the clubs read closed, not "popping". Set RADAR_DEMO_CLOCK=1 to force a
// lively Saturday-night demo (pins the world to ~00:50 Sat).
if (process.env.RADAR_DEMO_CLOCK) enableDemoClock(0.83, 6);
loadSnapshot();
ensureMediaDir();
seed();
// Ambient simulation disabled — the radar reflects only REAL user reports/check-ins.
// Re-enable startSimulation() to restore the self-driving demo crowd.
// startSimulation();
// Coordinates, ratings, reviews and hours are BAKED IN (lib/resolved.js,
// baked-places.js), so we no longer sweep Google Places on boot — that sweep
// burned the daily API quota (and then failed). Set PLACES_LIVE=1 to re-enable.
if (gpEnabled() && process.env.PLACES_LIVE) gpWarmAll(db.venues).catch(() => {});
// background: pre-resolve every venue's Instagram profile (throttled; not Google quota)
gpWarmIG(db.venues).catch(() => {});

// ---- helpers ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};
const MEDIA_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const MAX_MEDIA_BYTES = 14 * 1024 * 1024;

// Decode a data: URL, write it to MEDIA_DIR, and record it against a venue.
function saveMedia({ venueId, uHash, dataUrl }) {
  const m = /^data:([\w/.+-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return { error: 'bad media' };
  const mime = m[1].toLowerCase();
  const ext = MEDIA_EXT[mime];
  if (!ext) return { error: 'unsupported media type' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_MEDIA_BYTES) return { error: 'media too large' };
  const id = randId('m');
  try {
    ensureMediaDir();
    fs.writeFileSync(path.join(MEDIA_DIR, id + '.' + ext), buf);
  } catch (e) {
    console.error('media write failed', e.message);
    return { error: 'media save failed' };
  }
  const entry = { id, venueId, uHash, ts: now(), type: mime.startsWith('video') ? 'video' : 'image', ext };
  db.media.push(entry);
  return { entry };
}

// ---- email + password auth (Clubbit accounts) ----------------------------
// Passwords are never stored in plaintext: we keep a random salt + scrypt hash.
// Verification codes live in memory only (they expire); the account record is
// what gets persisted. Real email delivery uses Resend when RESEND_API_KEY is
// set; otherwise we run in dev mode and hand the code back to the client so the
// full flow is testable without an email provider.
const authCodes = new Map(); // emailKey -> { code, exp, tries, verified }
const CODE_TTL = 10 * 60 * 1000;
const emailKey = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(pw, salt, hash) {
  try {
    const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}
function genCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }

// Stateless session token: base64url(emailKey).HMAC(emailKey). The signing secret
// is PERSISTED (env → .data/auth_secret → generate once) so tokens survive server
// restarts — otherwise a restart would silently invalidate every token, profile
// saves would fail, and returning users would be sent back through onboarding.
const AUTH_SECRET = (() => {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const f = path.join(__dirname, '.data', 'auth_secret');
  try { if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim(); } catch (e) {}
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.mkdirSync(path.join(__dirname, '.data'), { recursive: true }); fs.writeFileSync(f, s); } catch (e) {}
  return s;
})();
function makeToken(key) {
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(key).digest('base64url');
  return Buffer.from(key).toString('base64url') + '.' + sig;
}
function tokenKey(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [b, sig] = token.split('.');
  let key; try { key = Buffer.from(b, 'base64url').toString('utf8'); } catch { return null; }
  const exp = crypto.createHmac('sha256', AUTH_SECRET).update(key).digest('base64url');
  try { if (sig.length === exp.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return key; } catch {}
  return null;
}

// Whitelist the profile fields we persist against an account (no secrets here).
function sanitizeProfile(p) {
  if (!p || typeof p !== 'object') return {};
  const str = (v, n = 400) => (typeof v === 'string' ? v.slice(0, n) : null);
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  return {
    firstName: str(p.firstName, 60),
    gender: str(p.gender, 40),
    dateOfBirth: str(p.dateOfBirth, 10),
    calculatedAge: num(p.calculatedAge),
    clubbingFrequency: str(p.clubbingFrequency, 60),
    profilePhoto: (typeof p.profilePhoto === 'string' && p.profilePhoto.length < 600000) ? p.profilePhoto : null,
    onboardingComplete: !!p.onboardingComplete,
    updatedAt: now(),
  };
}

// Deliver a verification code. Returns { sent } — sent:false means dev mode,
// in which case the caller reveals the code to the client for testing.
async function sendVerificationCode(email, code) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || 'Clubbit <onboarding@resend.dev>';
  if (!key) return { sent: false };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [email], subject: `${code} is your Clubbit code`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1a1030">
          <h2 style="margin:0 0 8px">Verify your email</h2>
          <p style="margin:0 0 16px;color:#555">Enter this code in Clubbit to finish signing up.</p>
          <div style="font-size:34px;font-weight:800;letter-spacing:10px;background:#f4f0ff;border-radius:12px;padding:18px;text-align:center;color:#7c3aed">${code}</div>
          <p style="margin:16px 0 0;color:#888;font-size:13px">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
        </div>`,
        text: `Your Clubbit verification code is ${code}. It expires in 10 minutes.`,
      }),
    });
    if (!r.ok) { console.warn('[auth] Resend send failed', r.status, await r.text().catch(() => '')); return { sent: false }; }
    return { sent: true };
  } catch (e) {
    console.warn('[auth] email send error', e.message);
    return { sent: false };
  }
}

function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > -1) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

// Anonymous, non-reversible identity for reputation + anti-abuse. We never store
// or return anything that identifies a person — only salted hashes.
function identity(req, res) {
  const cookies = parseCookies(req);
  // Prefer the app's stable id header — cross-origin cookies aren't reliably
  // sent from the packaged app, so this keeps a user's reports/photos attributed
  // to them across requests. Falls back to the cookie for the plain web app.
  const hdr = String(req.headers['x-clubbit-uid'] || '').trim().slice(0, 64);
  let anonId = hdr || cookies.prid;
  const setCookies = [];
  if (!anonId) {
    anonId = randId('a');
    setCookies.push(`prid=${anonId}; Path=/; Max-Age=31536000; SameSite=Lax`);
  }
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const deviceId = hdr || cookies.prdev || anonId;
  if (!hdr && !cookies.prdev) setCookies.push(`prdev=${deviceId}; Path=/; Max-Age=31536000; SameSite=Lax`);
  if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
  return { uHash: anonHash('user', anonId), dHash: anonHash('dev', deviceId, ip.slice(0, 12)) };
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    // generous cap so a report can carry an inline photo/video (base64)
    req.on('data', (c) => { b += c; if (b.length > 20 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// map bounds across all venues (for the stylized projection on the client)
function mapBounds() {
  const lats = db.venues.map((v) => v.coords.lat);
  const lngs = db.venues.map((v) => v.coords.lng);
  const pad = 0.004;
  return { minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad, minLng: Math.min(...lngs) - pad, maxLng: Math.max(...lngs) + pad };
}

// ---- API ----
async function api(req, res, url) {
  const id = identity(req, res);
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const route = seg.slice(1).join('/');
  const method = req.method;

  // GET /api/state — everything the map + overview needs in one call
  if (method === 'GET' && route === 'state') {
    const ref = now();
    const venues = db.venues.map((v) => {
      const s = venueSnapshot(v, ref);
      return {
        id: s.id, name: s.name, neighborhood: s.neighborhood, neighborhoodName: s.neighborhoodName,
        city: s.city, category: s.category, kind: s.kind, coords: s.coords, verified: s.verified, lgbtq: s.lgbtq,
        hot: s.hot, radar: s.radar, momentum: s.momentum, vibe: s.vibe, pct: s.pct,
        fullness: s.fullness, recentSignals: s.recentSignals, entry: s.entry,
        entryLabel: s.entryLabel, currency: s.currency,
        source: s.source, special: s.special,
        open: s.open, hours: s.hours, season: s.season, google: s.google, googlePhoto: s.googlePhoto,
        expectedPeak: s.expectedPeak, dress: s.dress, instagram: s.instagram,
        photo: ((s.media || []).find((m) => m.type === 'image') || {}).url || null,
      };
    });
    // (baked data covers ratings/hours; live refresh gated behind PLACES_LIVE to
    // avoid burning the daily Google quota)
    if (gpEnabled() && process.env.PLACES_LIVE) gpRefreshStale(db.venues, 8).catch(() => {});
    const areas = db.neighborhoods.map((h) => areaSnapshot(h, ref));
    const cities = new Set(db.venues.map((v) => v.city));
    return send(res, 200, {
      city: cities.size > 1 ? 'Greece' : (db.venues[0]?.city || 'Athens'),
      generatedAt: ref,
      serverTime: ref,
      bounds: mapBounds(),
      venues,
      areas,
      clusters: clusters(ref),
      feed: radarFeed(24, ref),
    });
  }

  // GET /api/ig/:id — 302-redirect to the venue's Instagram profile. Baked/pinned
  // handles resolve instantly; otherwise a short live lookup, then a name-based
  // handle guess so it ALWAYS lands on Instagram (never a Google search).
  if (method === 'GET' && seg[1] === 'ig' && seg[2]) {
    const v = venueById(seg[2]);
    let url = null;
    if (v) { try { url = await Promise.race([gpEnsureIG(v), new Promise((r) => setTimeout(() => r(null), 2500))]); } catch (e) {} }
    if (!url && v) {
      const h = String(v.name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
      if (h) url = 'https://www.instagram.com/' + h + '/';
    }
    if (!url) url = 'https://www.instagram.com/';
    res.writeHead(302, { Location: url });
    return res.end();
  }

  // GET /api/venue/:id — full detail for a venue page
  if (method === 'GET' && seg[1] === 'venue' && seg[2]) {
    const v = venueById(seg[2]);
    if (!v) return send(res, 404, { error: 'not found' });
    if (btEnabled()) { try { await btRefresh(v); } catch (e) {} } // opportunistic real busyness
    if (gpEnabled() && process.env.PLACES_LIVE) { try { await gpRefresh(v); } catch (e) {} }  // baked data covers this; live gated
    return send(res, 200, venueSnapshot(v, now(), { viewerHash: id.uHash }));
  }

  // GET /api/area/:id
  if (method === 'GET' && seg[1] === 'area' && seg[2]) {
    const h = neighborhoodById(seg[2]);
    if (!h) return send(res, 404, { error: 'not found' });
    const ref = now();
    const area = areaSnapshot(h, ref);
    area.venues = db.venues
      .filter((v) => v.neighborhood === h.id)
      .map((v) => venueSnapshot(v, ref))
      .sort((a, b) => b.radar.score - a.radar.score);
    return send(res, 200, area);
  }

  // GET /api/feed
  if (method === 'GET' && route === 'feed') {
    return send(res, 200, { feed: radarFeed(40, now()) });
  }

  // GET /api/me — the only place we surface a user's own (subtle) badges
  if (method === 'GET' && route === 'me') {
    const u = getUser(id.uHash);
    u.lastSeen = now();
    const badges = refreshBadges(u).map((b) => ({ id: b.id, label: b.label }));
    const mine = db.media.filter((m) => m.uHash === id.uHash);
    const media = mine
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 30)
      .map((m) => ({ id: m.id, url: '/media/' + m.id + '.' + m.ext, type: m.type, ageMin: round((now() - m.ts) / MIN) }));
    // the user's own reports (with their photo) so the profile shows an overview
    const reports = db.reports
      .filter((r) => r.uHash === id.uHash)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 50)
      .map((r) => {
        const v = venueById(r.venueId);
        const m = r.mediaId ? db.media.find((x) => x.id === r.mediaId) : null;
        return {
          id: r.id, venueId: r.venueId, venueName: v ? v.name : 'A venue',
          vibe: r.vibe, queue: r.queue || null, entry: (r.entry != null ? r.entry : null),
          mix: r.mix || null, music: r.music || null, note: r.note || null,
          mediaUrl: m ? '/media/' + m.id + '.' + m.ext : null, mediaType: m ? m.type : null,
          ageMin: round((now() - r.ts) / MIN),
        };
      });
    return send(res, 200, {
      badges,
      reportsMade: Math.round(u.reports),
      checkins: u.checkins,
      photos: mine.length,
      media,
      reports,
    });
  }

  // POST /api/checkin  { venueId, coords? }
  if (method === 'POST' && route === 'checkin') {
    const body = await readBody(req);
    const v = venueById(body.venueId);
    if (!v) return send(res, 400, { error: 'bad venue' });
    const coords = validCoords(body.coords);
    const screen = screenCheckin({ venue: v, uHash: id.uHash, dHash: id.dHash, coords, ts: now() });
    db.checkins.push({
      id: randId('ci'), venueId: v.id, uHash: id.uHash, dHash: id.dHash,
      ts: now(), coords, accepted: screen.accepted, weight: screen.weight, reason: screen.reason,
    });
    if (screen.accepted) {
      const u = getUser(id.uHash);
      u.checkins++; u.lastSeen = now();
      u.neighborhoods[v.neighborhood] = (u.neighborhoods[v.neighborhood] || 0) + 1;
      refreshBadges(u);
    }
    saveSnapshotSoon();
    const s = venueSnapshot(v, now());
    return send(res, 200, { accepted: screen.accepted, reason: screen.reason, venue: s });
  }

  // POST /api/pulse  { venueId, state }  (quick "still popping?")
  if (method === 'POST' && route === 'pulse') {
    const body = await readBody(req);
    const v = venueById(body.venueId);
    if (!v || !['yes', 'slowing', 'busier'].includes(body.state)) return send(res, 400, { error: 'bad pulse' });
    db.pulses.push({ id: randId('pl'), venueId: v.id, uHash: id.uHash, ts: now(), state: body.state });
    saveSnapshotSoon();
    return send(res, 200, { ok: true, venue: venueSnapshot(v, now()) });
  }

  // POST /api/report  { venueId, vibe, queue, entry, mix, music, coords? }
  if (method === 'POST' && route === 'report') {
    const body = await readBody(req);
    const v = venueById(body.venueId);
    const vibe = body.vibe;
    if (!v || !['dead', 'chill', 'popping', 'packed'].includes(vibe)) return send(res, 400, { error: 'bad report' });
    // a photo or video is required and is added to the venue's profile
    const saved = saveMedia({ venueId: v.id, uHash: id.uHash, dataUrl: body.media && body.media.dataUrl });
    if (saved.error) return send(res, 400, { error: saved.error, needMedia: true });
    const coords = validCoords(body.coords);
    const ts = now();
    const confidence = computeReportConfidence({ venue: v, coords, uHash: id.uHash, ts });

    // reputation: does this match the current community consensus? (accuracy)
    const before = venueSnapshot(v, ts);
    const u = getUser(id.uHash);
    u.reports++; u.lastSeen = ts;
    u.neighborhoods[v.neighborhood] = (u.neighborhoods[v.neighborhood] || 0) + 1;
    if (before.report) {
      const order = ['dead', 'chill', 'popping', 'packed'];
      if (Math.abs(order.indexOf(vibe) - order.indexOf(before.report.vibe)) <= 1) u.accurate++;
    } else {
      u.accurate += 0.5; // first-reporter benefit of the doubt
    }
    // early scoop: called it busy before the crowd/history caught up
    if ((vibe === 'popping' || vibe === 'packed') && before.fullness.est < 45) u.earlyScoops++;
    const nightH = new Date(ts + 3 * 3600 * 1000).getUTCHours();
    if (nightH >= 2 && nightH < 6) u.lateReports++;

    // reporter identity (from the poster's profile) so reports read
    // "Nick, 26 reported…" with a face — sanitised & size-capped.
    const rp = body.reporter && typeof body.reporter === 'object' ? body.reporter : null;
    const reporter = rp ? {
      name: String(rp.name || '').trim().slice(0, 24) || null,
      age: (typeof rp.age === 'number' && rp.age >= 16 && rp.age <= 99) ? Math.round(rp.age) : null,
      tag: String(rp.tag || '').trim().slice(0, 20) || null,
      photo: (typeof rp.photo === 'string' && rp.photo.length <= 300000) ? rp.photo : null,
    } : null;

    db.reports.push({
      id: randId('rp'), venueId: v.id, uHash: id.uHash, dHash: id.dHash, ts,
      coords, vibe,
      queue: safeEnum(body.queue, ['none', '<10', '10-20', '20-30', '30+', 'guestlist', 'unknown']),
      entry: typeof body.entry === 'number' ? clamp(body.entry, 0, 200) : (body.entry === 'guestlist' ? 0 : null),
      mix: safeEnum(body.mix, ['more_women', 'even', 'more_men']),
      music: (() => {
        const known = safeEnum(body.music, ['House', 'Techno', 'Hip-Hop', 'R&B', 'Afrobeats', 'Commercial', 'Latin', 'Other', 'Tech House', 'Live']);
        if (known) return known;
        if (typeof body.music === 'string') { const s = body.music.trim().replace(/[^\p{L}\p{N} &/'\-]/gu, '').slice(0, 24); return s || null; }
        return null;
      })(),
      note: (typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '') || null,
      confidence, mediaId: saved.entry.id, reporter,
    });
    const badges = refreshBadges(u).map((b) => b.label);
    saveSnapshotSoon();
    const after = venueSnapshot(v, now());
    // community report -> feed, attributed to the reporter when we have a name
    if (vibe === 'packed' || after.momentum.state === 'surging' || after.momentum.state === 'exploding' || reporter) {
      const who = reporter && reporter.name ? `${reporter.name}${reporter.age ? ', ' + reporter.age : ''}` : 'Someone';
      pushFeed({ ts, venueId: v.id, kind: 'report', text: `${who} reported ${v.name} is ${vibe.toUpperCase()}`, sub: reporter && reporter.tag ? reporter.tag : '', area: v.neighborhoodName });
    }
    return send(res, 200, { ok: true, confidenceTier: confidenceTier(confidence), badges, venue: after });
  }

  // POST /api/owner/update  { venueId, status, queue, entry, specials, lastEntry, music }
  // Verified venues only (demo: gated on the venue's verified flag, no external auth).
  if (method === 'POST' && route === 'owner/update') {
    const body = await readBody(req);
    const v = venueById(body.venueId);
    if (!v) return send(res, 400, { error: 'bad venue' });
    if (!v.verified) return send(res, 403, { error: 'venue not verified for owner updates' });
    db.ownerUpdates.push({
      id: randId('ou'), venueId: v.id, ts: now(),
      status: safeEnum(body.status, ['quiet', 'busy', 'popping', 'packed']) || 'busy',
      queue: safeEnum(body.queue, ['none', '<10', '10-20', '20-30', '30+']) || 'none',
      entry: typeof body.entry === 'number' ? clamp(body.entry, 0, 200) : v.price,
      specials: typeof body.specials === 'string' ? body.specials.slice(0, 80) : '',
      lastEntry: typeof body.lastEntry === 'string' ? body.lastEntry.slice(0, 12) : '',
      music: safeEnum(body.music, ['House', 'Techno', 'Hip-Hop', 'R&B', 'Afrobeats', 'Commercial', 'Latin', 'Tech House', 'Live', 'Other']) || null,
    });
    if (body.specials) pushFeed({ ts: now(), venueId: v.id, kind: 'special', text: `${v.name}: ${String(body.specials).slice(0, 60)}`, area: v.neighborhoodName });
    saveSnapshotSoon();
    return send(res, 200, { ok: true, venue: venueSnapshot(v, now()) });
  }

  // POST /api/mascot { dataUrl } — set the app's header mascot image (writes public/mascot.png)
  if (method === 'POST' && route === 'mascot') {
    const body = await readBody(req);
    const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/s.exec(body.dataUrl || '');
    if (!m) return send(res, 400, { error: 'not an image' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) return send(res, 400, { error: 'image too large (max 8MB)' });
    try { fs.writeFileSync(path.join(PUBLIC, 'mascot.png'), buf); }
    catch (e) { return send(res, 500, { error: 'could not save' }); }
    return send(res, 200, { ok: true });
  }

  // POST /api/asset { name, dataUrl } — save a generated PNG into /public
  // (whitelisted to clubbit-* names; used to store a tightly-cropped logo)
  if (method === 'POST' && route === 'asset') {
    const body = await readBody(req);
    const name = String(body.name || '').replace(/[^a-z0-9_-]/gi, '');
    const m = /^data:image\/png;base64,(.+)$/s.exec(body.dataUrl || '');
    if (!name || !/^clubbit-/.test(name) || !m) return send(res, 400, { error: 'bad asset' });
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 6 * 1024 * 1024) return send(res, 400, { error: 'too large' });
    try { fs.writeFileSync(path.join(PUBLIC, name + '.png'), buf); } catch (e) { return send(res, 500, { error: 'save failed' }); }
    return send(res, 200, { ok: true });
  }

  // POST /api/media/delete { id } — remove one of the user's OWN photos/videos
  // (also removes the report that photo belongs to, so it's a full undo)
  if (method === 'POST' && route === 'media/delete') {
    const body = await readBody(req);
    const m = db.media.find((x) => x.id === body.id);
    if (!m) return send(res, 404, { error: 'not found' });
    if (m.uHash !== id.uHash) return send(res, 403, { error: 'not your photo' });
    db.media = db.media.filter((x) => x.id !== m.id);
    db.reports = db.reports.filter((r) => r.mediaId !== m.id); // remove the linked report
    try { fs.unlinkSync(path.join(MEDIA_DIR, m.id + '.' + m.ext)); } catch (e) { /* file may already be gone */ }
    saveSnapshotSoon();
    return send(res, 200, { ok: true });
  }

  // POST /api/report/delete { id } — remove one of the user's OWN reports + its photo
  if (method === 'POST' && route === 'report/delete') {
    const body = await readBody(req);
    const r = db.reports.find((x) => x.id === body.id);
    if (!r) return send(res, 404, { error: 'not found' });
    if (r.uHash !== id.uHash) return send(res, 403, { error: 'not your report' });
    db.reports = db.reports.filter((x) => x.id !== r.id);
    if (r.mediaId) {
      const m = db.media.find((x) => x.id === r.mediaId);
      db.media = db.media.filter((x) => x.id !== r.mediaId);
      if (m) { try { fs.unlinkSync(path.join(MEDIA_DIR, m.id + '.' + m.ext)); } catch (e) {} }
    }
    saveSnapshotSoon();
    return send(res, 200, { ok: true });
  }

  // POST /api/auth/request-code { email }
  // New/unverified email → generate + send a 6-digit code. If the email already
  // has a password, we tell the client to ask for the password instead (sign in).
  if (method === 'POST' && route === 'auth/request-code') {
    const body = await readBody(req);
    const email = String(body.email || '').trim();
    if (!validEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
    const key = emailKey(email);
    const existing = db.authUsers[key];
    if (existing && existing.hash) return send(res, 200, { ok: true, exists: true });
    const code = genCode();
    authCodes.set(key, { code, exp: Date.now() + CODE_TTL, tries: 0, verified: false });
    const { sent } = await sendVerificationCode(email, code);
    return send(res, 200, { ok: true, exists: false, sent, devCode: sent ? undefined : code });
  }

  // POST /api/auth/verify-code { email, code }
  if (method === 'POST' && route === 'auth/verify-code') {
    const body = await readBody(req);
    const key = emailKey(body.email);
    const code = String(body.code || '').trim();
    const rec = authCodes.get(key);
    if (!rec || rec.exp < Date.now()) { authCodes.delete(key); return send(res, 400, { error: 'That code has expired. Request a new one.' }); }
    if (rec.tries >= 6) { authCodes.delete(key); return send(res, 429, { error: 'Too many attempts. Request a new code.' }); }
    rec.tries++;
    if (code !== rec.code) return send(res, 400, { error: 'Incorrect code. Try again.' });
    rec.verified = true;
    return send(res, 200, { ok: true });
  }

  // POST /api/auth/set-password { email, code, password } — create the account
  if (method === 'POST' && route === 'auth/set-password') {
    const body = await readBody(req);
    const key = emailKey(body.email);
    const rec = authCodes.get(key);
    if (!rec || !rec.verified || rec.exp < Date.now()) return send(res, 400, { error: 'Please verify your email again.' });
    if (String(body.code || '').trim() !== rec.code) return send(res, 400, { error: 'Please verify your email again.' });
    const pw = String(body.password || '');
    if (pw.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters.' });
    if (db.authUsers[key] && db.authUsers[key].hash) return send(res, 409, { error: 'An account already exists for this email.' });
    const { salt, hash } = hashPassword(pw);
    const uid = 'clubbit_' + crypto.randomBytes(8).toString('hex');
    db.authUsers[key] = { id: uid, email: String(body.email || '').trim(), salt, hash, verified: true, createdAt: now(), profile: null };
    authCodes.delete(key);
    saveSnapshotSoon();
    return send(res, 200, { ok: true, user: { id: uid, email: db.authUsers[key].email }, token: makeToken(key) });
  }

  // POST /api/auth/signin { email, password } — returning users; hands back the
  // saved profile so a returning login restores everything (even on a new device).
  if (method === 'POST' && route === 'auth/signin') {
    const body = await readBody(req);
    const key = emailKey(body.email);
    const u = db.authUsers[key];
    if (!u || !u.hash) return send(res, 404, { error: 'No account found for this email.' });
    if (!verifyPassword(String(body.password || ''), u.salt, u.hash)) return send(res, 401, { error: 'Incorrect password.' });
    return send(res, 200, { ok: true, user: { id: u.id, email: u.email }, token: makeToken(key), profile: u.profile || null });
  }

  // POST /api/auth/profile { token, profile } — save the onboarding profile
  // against the signed-in account.
  if (method === 'POST' && route === 'auth/profile') {
    const body = await readBody(req);
    const key = tokenKey(body.token);
    if (!key || !db.authUsers[key]) return send(res, 401, { error: 'Not signed in.' });
    db.authUsers[key].profile = { ...sanitizeProfile(body.profile), id: db.authUsers[key].id, email: db.authUsers[key].email };
    saveSnapshotSoon();
    return send(res, 200, { ok: true });
  }

  // GET /api/auth/profile?token=... — fetch the saved profile for a token
  if (method === 'GET' && route === 'auth/profile') {
    const key = tokenKey(url.searchParams.get('token'));
    if (!key || !db.authUsers[key]) return send(res, 401, { error: 'Not signed in.' });
    return send(res, 200, { ok: true, profile: db.authUsers[key].profile || null, email: db.authUsers[key].email });
  }

  // POST /api/auth/delete { token } — permanently delete the account (email,
  // password and saved profile). Irreversible.
  if (method === 'POST' && route === 'auth/delete') {
    const body = await readBody(req);
    const key = tokenKey(body.token);
    if (key && db.authUsers[key]) { delete db.authUsers[key]; saveSnapshotSoon(); }
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'unknown route' });
}

function validCoords(c) {
  if (c && typeof c.lat === 'number' && typeof c.lng === 'number' && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180) {
    return { lat: c.lat, lng: c.lng };
  }
  return null;
}
function safeEnum(v, allowed) { return allowed.includes(v) ? v : null; }
function confidenceTier(c) { return c >= 0.7 ? 'high' : c >= 0.4 ? 'medium' : 'low'; }

// ---- user-uploaded media (photos/videos on venue profiles) ----
function serveMedia(req, res, url) {
  const name = path.basename(decodeURIComponent(url.pathname)); // strip any path
  const filePath = path.join(MEDIA_DIR, name);
  if (!filePath.startsWith(MEDIA_DIR)) return send(res, 403, 'forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'not found');
    send(res, 200, data, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
  });
}

// ---- static files ----
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const filePath = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC)) return send(res, 403, 'forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) =>
        e2 ? send(res, 404, 'not found') : send(res, 200, html, { 'Content-Type': MIME['.html'] })
      );
    }
    send(res, 200, data, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  // CORS — the packaged mobile app (Capacitor) runs on capacitor://localhost or
  // https://localhost, a different origin from the hosted backend. Reflect the
  // request origin and allow credentials so fetch()/cookies work from the app.
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Clubbit-Uid');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); } // preflight
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch((e) => { console.error('api error', e); send(res, 500, { error: 'server error' }); });
  } else if (url.pathname.startsWith('/media/')) {
    serveMedia(req, res, url);
  } else {
    serveStatic(req, res, url);
  }
});

server.listen(PORT, () => {
  console.log(`\n  🔴 PARTY RADAR running → http://localhost:${PORT}`);
  console.log(process.env.RESEND_API_KEY
    ? `  ✉️  Email: LIVE via Resend (from ${process.env.MAIL_FROM || 'onboarding@resend.dev'})\n`
    : `  ✉️  Email: dev mode — codes shown in-app. Set RESEND_API_KEY in radar/.env for real emails.\n`);
});

process.on('SIGINT', () => { saveSnapshot(); process.exit(0); });
process.on('SIGTERM', () => { saveSnapshot(); process.exit(0); });
