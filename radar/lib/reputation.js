// reputation.js — behind-the-scenes trust, report-confidence weighting and
// anti-abuse. None of the raw numbers are ever exposed to users; the UI only
// ever sees derived labels/badges and confidence-weighted aggregates.

import { db } from './store.js';
import { now, MIN, haversineMeters, ageMinutes, decayWeight, clamp } from './util.js';

export function getUser(uHash) {
  if (!db.users[uHash]) {
    db.users[uHash] = {
      uHash,
      first: now(),
      lastSeen: now(),
      reports: 0,
      accurate: 0, // reports that later matched community consensus
      checkins: 0,
      neighborhoods: {}, // hood -> count (for LOCAL badge)
      lateReports: 0, // reports after 2am (NIGHT OWL)
      earlyScoops: 0, // reported a venue before it became popular (FIRST ON SCENE)
      badges: [],
    };
  }
  return db.users[uHash];
}

// Reporter trust 0.35..1.0. New accounts start neutral-low; accuracy lifts it.
// Users can NEVER buy trust — it's purely earned via matching, corroborated reports.
export function reporterTrust(uHash) {
  const u = db.users[uHash];
  if (!u) return 0.45;
  const ageDays = (now() - u.first) / (24 * 60 * MIN);
  const maturity = clamp(ageDays / 14, 0, 1); // ramps over ~2 weeks
  const accuracy = u.reports >= 3 ? u.accurate / u.reports : 0.55;
  const volume = clamp(u.reports / 40, 0, 1);
  let t = 0.4 + 0.35 * accuracy + 0.15 * maturity + 0.1 * volume;
  // "Local" / "Night Scout" reports get a slight extra weighting (never large).
  if (u.badges.includes('local') || u.badges.includes('night_scout')) t += 0.06;
  return clamp(t, 0.35, 1);
}

// Confidence 0..1 for a single crowd report, combining:
//  proximity · reporter trust · recency · corroboration · trend agreement.
export function computeReportConfidence({ venue, coords, uHash, ts = now() }) {
  const trust = reporterTrust(uHash);

  // proximity: full weight inside the venue, decaying to a floor when far/absent
  let proximity = 0.55; // no-GPS reports still count, but capped
  if (coords) {
    const d = haversineMeters(coords, venue.coords);
    if (d <= 120) proximity = 1;
    else if (d <= 400) proximity = 0.8;
    else if (d <= 1000) proximity = 0.45;
    else proximity = 0.15;
  }

  const recency = decayWeight(ageMinutes(ts));

  // corroboration: independent recent reports (distinct users/devices) for the
  // same venue make any one report more believable.
  const recent = db.reports.filter(
    (r) => r.venueId === venue.id && r.uHash !== uHash && ageMinutes(r.ts) <= 30
  );
  const distinct = new Set(recent.map((r) => r.dHash || r.uHash)).size;
  const corroboration = clamp(0.7 + distinct * 0.1, 0.7, 1.15);

  let conf = trust * proximity * recency * corroboration;

  // suspicious pattern damping: brand-new + far away + device already very busy
  const u = db.users[uHash];
  const dHashBusy = coords
    ? db.reports.filter((r) => r.dHash && r.uHash === uHash && ageMinutes(r.ts) <= 20).length
    : 0;
  if (u && now() - u.first < 20 * MIN && proximity < 0.5) conf *= 0.5;
  if (dHashBusy > 4) conf *= 0.6; // one device spamming reports
  return clamp(conf, 0.03, 1);
}

// Anti-abuse gate for check-ins. Returns {accepted, weight, reason}. We never
// hard-fail silently — a rejected check-in still records as a signal with weight
// 0 so abuse patterns remain visible to the owner-inflation detector.
export function screenCheckin({ venue, uHash, dHash, coords, ts = now() }) {
  // 1) one accepted check-in per user per venue within a 90-min window
  const dup = db.checkins.find(
    (c) => c.venueId === venue.id && c.uHash === uHash && c.accepted && ts - c.ts < 90 * MIN
  );
  if (dup) return { accepted: false, weight: 0, reason: 'duplicate' };

  // 2) device-level rate limit: max 3 accepted check-ins / 10 min / device
  if (dHash) {
    const burst = db.checkins.filter(
      (c) => c.dHash === dHash && c.accepted && ts - c.ts < 10 * MIN
    ).length;
    if (burst >= 3) return { accepted: false, weight: 0, reason: 'rate_limited' };
  }

  // 3) GPS proximity: if coords supplied they must be reasonably close.
  //    Missing coords are allowed but down-weighted (can't verify presence).
  let weight = 0.6;
  if (coords) {
    const d = haversineMeters(coords, venue.coords);
    if (d <= 150) weight = 1;
    else if (d <= 400) weight = 0.7;
    else if (d <= 800) weight = 0.3;
    else return { accepted: false, weight: 0, reason: 'too_far' };
  }

  // 4) device-cluster damping: many check-ins from one device/network across
  //    venues suggests a single actor inflating activity.
  if (dHash) {
    const clusterVenues = new Set(
      db.checkins
        .filter((c) => c.dHash === dHash && ts - c.ts < 60 * MIN)
        .map((c) => c.venueId)
    ).size;
    if (clusterVenues > 3) weight *= 0.5;
  }
  return { accepted: true, weight, reason: 'ok' };
}

// Owner-inflation signal for a venue: fraction of very-recent check-ins that
// come from a tiny set of devices. Used to discount suspicious surges.
export function inflationPenalty(venueId, ref = now()) {
  const recent = db.checkins.filter(
    (c) => c.venueId === venueId && c.accepted && ref - c.ts < 30 * MIN
  );
  if (recent.length < 8) return 1;
  const byDev = {};
  for (const c of recent) byDev[c.dHash || 'na'] = (byDev[c.dHash || 'na'] || 0) + 1;
  const top = Math.max(...Object.values(byDev));
  const concentration = top / recent.length;
  if (concentration > 0.5) return 0.6; // half from one device -> heavy discount
  if (concentration > 0.35) return 0.8;
  return 1;
}

const BADGE_DEFS = [
  { id: 'night_scout', label: 'Night Scout', test: (u) => u.accurate >= 12 },
  { id: 'first_on_scene', label: 'First on Scene', test: (u) => u.earlyScoops >= 3 },
  { id: 'vibe_check', label: 'Vibe Check', test: (u) => u.reports >= 10 },
  { id: 'local', label: 'Local', test: (u) => Object.values(u.neighborhoods).some((c) => c >= 8) },
  { id: 'night_owl', label: 'Night Owl', test: (u) => u.lateReports >= 6 },
  { id: 'trend_spotter', label: 'Trend Spotter', test: (u) => u.earlyScoops >= 6 },
];

export function refreshBadges(u) {
  const earned = BADGE_DEFS.filter((b) => b.test(u)).map((b) => b.id);
  u.badges = earned;
  return earned.map((id) => BADGE_DEFS.find((b) => b.id === id));
}
export function badgeLabel(id) {
  return BADGE_DEFS.find((b) => b.id === id)?.label || id;
}
