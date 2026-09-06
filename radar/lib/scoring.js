// scoring.js — every piece of derived nightlife intelligence is computed here,
// on demand, from the raw signal logs. Nothing is precomputed/stored, so the
// numbers are always live and always reflect time-decay.

import { db, venueById, pushFeed } from './store.js';
import { expectedRate, dayFactor } from './seed.js';
import { computeReportConfidence, inflationPenalty, getUser } from './reputation.js';
import { getBusyness } from './besttime.js';
import { resolveOpen } from './hours.js';
import { getPlace } from './places.js';
import { currencyInfo, formatMoney } from './money.js';
import {
  now, MIN, clamp, mean, round, haversineMeters, ageMinutes,
  decayWeight, isFresh, nightHour, nightCurve, fmtHour, relevanceLabel,
} from './util.js';

// Cities where Instagram is blocked — no IG button for these venues.
const NO_INSTAGRAM = new Set([
  'Moscow', 'Saint Petersburg',                 // Russia
  'Shanghai', 'Beijing', 'Chengdu', 'Shenzhen', // mainland China (Hong Kong is fine)
]);

const VIBE_NUM = { dead: 12, chill: 42, popping: 78, packed: 96 };
const VIBE_ORDER = ['dead', 'chill', 'popping', 'packed'];
const OWNER_NUM = { quiet: 20, busy: 55, popping: 80, packed: 95 };

// ---- primitive: decay-weighted check-in activity in a time window ----
function activity(venueId, startMin, endMin, ref = now()) {
  let w = 0;
  for (const c of db.checkins) {
    if (c.venueId !== venueId || !c.accepted) continue;
    const age = ageMinutes(c.ts, ref);
    if (age < startMin || age >= endMin) continue;
    w += (c.weight || 1) * decayWeight(age);
  }
  return w;
}

function freshReports(venueId, ref = now()) {
  return db.reports
    .filter((r) => r.venueId === venueId && isFresh(ageMinutes(r.ts, ref)))
    .map((r) => ({ ...r, age: ageMinutes(r.ts, ref) }));
}
function latestOwnerUpdate(venueId, ref = now()) {
  const list = db.ownerUpdates
    .filter((o) => o.venueId === venueId && ref - o.ts < 90 * MIN)
    .sort((a, b) => b.ts - a.ts);
  return list[0] || null;
}

const smoothLoad = (load) => 100 * (1 - Math.exp(-1.9 * Math.max(0, load)));

// Consensus vibe from fresh reports, confidence-weighted.
function reportConsensus(venue, ref = now()) {
  const reps = freshReports(venue.id, ref);
  if (!reps.length) return null;
  let num = 0, wsum = 0;
  const queueVotes = {}, musicVotes = {}, mixVotes = {};
  let entrySum = 0, entryW = 0;
  for (const r of reps) {
    const conf = r.confidence ?? computeReportConfidence({ venue, coords: r.coords, uHash: r.uHash, ts: r.ts });
    const w = conf * decayWeight(r.age);
    num += (VIBE_NUM[r.vibe] ?? 50) * w;
    wsum += w;
    if (r.queue) queueVotes[r.queue] = (queueVotes[r.queue] || 0) + w;
    if (r.music) musicVotes[r.music] = (musicVotes[r.music] || 0) + w;
    if (r.mix) mixVotes[r.mix] = (mixVotes[r.mix] || 0) + w;
    if (typeof r.entry === 'number') { entrySum += r.entry * w; entryW += w; }
  }
  const top = (votes) => Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const vibeNum = wsum ? num / wsum : 50;
  // corroboration lifts aggregate confidence: several independent agreeing
  // reports are more trustworthy than any single one, not just their average.
  const maxW = Math.max(...reps.map((r) => (r.confidence ?? 0.5) * decayWeight(r.age)));
  return {
    vibeNum,
    vibe: VIBE_ORDER[Math.min(3, Math.max(0, Math.round((vibeNum - 12) / 28)))],
    count: reps.length,
    confidence: clamp(maxW * (1 + 0.14 * (reps.length - 1)), 0.1, 1),
    lastAgeMin: Math.min(...reps.map((r) => r.age)),
    queue: top(queueVotes),
    music: top(musicVotes),
    mix: top(mixVotes),
    entry: entryW ? Math.round(entrySum / entryW) : null,
  };
}

// Correct a venue's category/kind from Google's real place type. Only acts on
// unambiguous types; keeps our curated value otherwise (a club is often tagged
// concert_hall / sports_club / event_venue, and Google has no "rooftop" type).
function refineType(cat, kind, pt) {
  // keep curated rooftops (Google has no rooftop type, tags them plain "bar")
  if (cat === 'Rooftops' || kind === 'Rooftop') return { category: 'Rooftops', kind: 'Rooftop' };
  switch (pt) {
    case 'night_club': return { category: 'Dancing', kind: 'Club' };
    case 'bar': return { category: 'Bars', kind: 'Bar' };
    case 'pub': return { category: 'Bars', kind: 'Bar' };
    case 'cocktail_bar': return { category: 'Cocktails', kind: 'Bar' };
    case 'lounge_bar': return { category: 'Bars', kind: 'Bar' };
    case 'wine_bar': return { category: 'Wine', kind: 'Wine Bar' };
    default: return { category: cat, kind };
  }
}

// Fallback dress code from the venue type when reviews don't mention one.
function dressFromVenue(v) {
  if (v.kind === 'Rooftop') return { code: 'Smart casual', tip: 'Smart casual — a step up from jeans and a tee.' };
  if (v.kind === 'Wine Bar') return { code: 'Relaxed smart', tip: 'Relaxed but put-together.' };
  if (v.kind === 'Club' || v.category === 'Dancing') {
    if ((v.price || 0) >= 18) return { code: 'Dress to impress', tip: 'Stylish night-out look — skip sportswear and trainers.' };
    return { code: 'Casual clubwear', tip: 'Casual — dark, comfy clubwear works fine.' };
  }
  if (v.kind === 'Venue') return { code: 'Casual', tip: 'Casual — whatever you can move in.' };
  return { code: 'Casual', tip: 'Casual — come as you are.' };
}

function vibeFromFullness(f) {
  if (f >= 82) return 'packed';
  if (f >= 58) return 'popping';
  if (f >= 28) return 'chill';
  return 'dead';
}

// Estimated door queue when nobody has reported one. Grows non-linearly with how
// full the room is, scaled by "door pressure" — clubs, pricier/selective doors and
// big popular rooms build lines; a quiet bar rarely does. Returns a bucket that
// matches the reported-queue vocabulary plus a rough minute estimate.
function estimateQueue(venue, fullnessFrac) {
  const f = clamp(fullnessFrac);
  let door = 0;
  const isClub = venue.kind === 'Club' || venue.category === 'Dancing';
  if (isClub) door += 1;
  if ((venue.price || 0) >= 15) door += 0.6;
  if ((venue.price || 0) >= 25) door += 0.7;
  if (venue.peakRate >= 14) door += 0.5;   // popular room
  if (venue.peakRate >= 20) door += 0.5;   // marquee room
  const mins = Math.round((f ** 1.6) * (10 + door * 12));
  let bucket;
  if (mins < 4) bucket = 'none';
  else if (mins < 12) bucket = '<10';
  else if (mins < 22) bucket = '10-20';
  else if (mins < 32) bucket = '20-30';
  else bucket = '30+';
  return { bucket, mins };
}

// ---- the full derived snapshot for one venue ----
export function venueSnapshot(venue, ref = now(), opts = {}) {
  if (typeof venue === 'string') venue = venueById(venue);
  if (!venue) return null;

  const infl = inflationPenalty(venue.id, ref);
  const act30 = activity(venue.id, 0, 30, ref) * infl;
  const load = act30 / Math.max(1, venue.peakRate);
  const activityScore = smoothLoad(load);

  const consensus = reportConsensus(venue, ref);
  const owner = latestOwnerUpdate(venue.id, ref);
  const expNow = expectedRate(venue, ref);
  const expFrac = clamp(expNow / Math.max(1, venue.peakRate)); // historical expectation 0..1

  // real foot-traffic from BestTime, if we have it cached for this venue
  const bt = getBusyness(venue.id); // {busyness 0-100, live} | null

  // real open/closed — Google Places openNow when we have it, else a schedule
  // fallback from the venue type + city timezone. A closed room is never "hot".
  const place = getPlace(venue.id);
  const openState = resolveOpen(venue, ref, place);
  const closed = !openState.open;
  const google = place && place.placeId
    ? { placeId: place.placeId, rating: place.rating ?? null, ratings: place.ratings ?? null, url: place.gmapsUrl || null, review: place.review || null, source: openState.source }
    : null;
  // Use the REAL Google location for the map pin when we have a confident match
  // — the seed coords are approximate (jittered) and can land in water.
  const displayCoords = (place && place.location) ? place.location : venue.coords;

  // Instagram link: the venue's own IG when Google lists it as the website,
  // otherwise an Instagram search for the venue so the button always works.
  // Route Instagram through a server endpoint that resolves the real profile
  // on-demand (cached) and 302-redirects — so mobile lands on the actual page.
  // Skipped where Instagram is blocked (Russia, mainland China) — venues there
  // don't use it, so no button is shown.
  const instagram = NO_INSTAGRAM.has(venue.city) ? null : '/api/ig/' + venue.id;

  // correct the category/kind from Google's real place type
  const rt = refineType(venue.category, venue.kind, place?.primaryType);

  // dress code — from what reviews/IG say, else a venue-type default
  const dress = (place && place.review && place.review.dress) || dressFromVenue(venue);

  // HOT SCORE — blend live activity, community consensus, owner update, real busyness.
  let hot, source;
  if (owner && ageMinutes(owner.ts, ref) <= 40) {
    const ownerNum = OWNER_NUM[owner.status] ?? 55;
    hot = 0.5 * ownerNum + 0.3 * activityScore + 0.2 * (consensus?.vibeNum ?? activityScore);
    source = 'venue';
  } else if (consensus) {
    hot = 0.55 * consensus.vibeNum + 0.45 * activityScore;
    source = 'community';
  } else if (bt) {
    // no fresh community signal: use real foot-traffic (blended with live check-ins)
    hot = 0.6 * bt.busyness + 0.4 * activityScore;
    source = bt.live ? 'live' : 'besttime';
  } else {
    // estimate from live check-ins anchored to history
    hot = 0.6 * activityScore + 0.4 * (expFrac * 92);
    source = 'estimate';
  }
  hot = round(clamp(hot, 0, 100));
  // A closed venue can't be hot — clamp it down so the map, feed and bands
  // never claim a shut club is popping.
  if (closed) { hot = Math.min(hot, 4); source = 'closed'; }

  // MOMENTUM — rate of change of activity + vibe trend.
  const recRate = activity(venue.id, 0, 18, ref) / 18;
  const priRate = activity(venue.id, 18, 42, ref) / 24;
  let M = 34 * Math.tanh((1.5 * (recRate - priRate)) / (priRate + 0.4));
  // vibe trend nudges momentum
  const repRecent = mean(db.reports.filter((r) => r.venueId === venue.id && ageMinutes(r.ts, ref) <= 20).map((r) => VIBE_NUM[r.vibe] ?? 50));
  const repPrior = mean(db.reports.filter((r) => r.venueId === venue.id && ageMinutes(r.ts, ref) > 20 && ageMinutes(r.ts, ref) <= 50).map((r) => VIBE_NUM[r.vibe] ?? 50));
  if (repRecent && repPrior) M += clamp((repRecent - repPrior) * 0.25, -8, 8);
  M = round(clamp(M, -32, 36));
  const momentum = momentumState(M);
  // % vs historical baseline for "SURGING +46% activity"
  const baseRatePerMin = expNow / 30;
  const pct = baseRatePerMin > 0.05 ? round(((recRate - baseRatePerMin) / baseRatePerMin) * 100) : null;

  // FULLNESS estimate
  let fullnessFrac;
  if (consensus) fullnessFrac = clamp(0.5 * clamp(load) + 0.5 * (consensus.vibeNum / 100));
  else if (owner) fullnessFrac = clamp(0.55 * ((OWNER_NUM[owner.status] ?? 55) / 100) + 0.45 * clamp(load));
  else if (bt) fullnessFrac = clamp(0.65 * (bt.busyness / 100) + 0.35 * clamp(load));
  else fullnessFrac = clamp(0.7 * clamp(load) + 0.3 * expFrac);
  // A closed venue is empty — don't claim a shut club is 63% full.
  if (closed) fullnessFrac = 0;
  const fullnessEst = round(fullnessFrac * 100);

  // QUEUE — blend a reported queue (community/owner) with an estimate from how full
  // the room is + door pressure. A reported "none" must not mask a busy-room line, so
  // we take whichever wait is LONGER; a real reported wait (>none) is otherwise kept.
  const QORDER = { none: 0, '<10': 1, '10-20': 2, '20-30': 3, '30+': 4 };
  const reportedQueue = consensus?.queue || owner?.queue || null;
  const queueEst = estimateQueue(venue, fullnessFrac);
  let queue, queueEstimated;
  if (closed) {
    queue = 'none'; queueEstimated = false;
  } else if (reportedQueue === 'guestlist') {
    queue = 'guestlist'; queueEstimated = false;
  } else if (reportedQueue && (QORDER[reportedQueue] ?? 0) >= QORDER[queueEst.bucket]) {
    queue = reportedQueue; queueEstimated = false;          // reported wait is real and ≥ estimate
  } else {
    queue = queueEst.bucket; queueEstimated = true;         // estimate (covers reported "none" at a busy room)
  }

  // recent signals (fresh check-ins + reports + pulses)
  const recentCheckins = db.checkins.filter((c) => c.venueId === venue.id && c.accepted && isFresh(ageMinutes(c.ts, ref))).length;
  const recentReports = freshReports(venue.id, ref).length;
  const recentPulses = db.pulses.filter((p) => p.venueId === venue.id && isFresh(ageMinutes(p.ts, ref))).length;
  const recentSignals = recentCheckins + recentReports + recentPulses;

  // freshest signal of ANY kind (a live check-in counts) drives recency
  let freshestSignalMin = consensus ? consensus.lastAgeMin : Infinity;
  for (const c of db.checkins) {
    if (c.venueId === venue.id && c.accepted) {
      const a = ageMinutes(c.ts, ref);
      if (a < freshestSignalMin) freshestSignalMin = a;
    }
  }

  const nearby = nearbyActivity(venue, ref);
  const forecast = venueForecast(venue, fullnessEst, ref);
  const radar = partyRadarScore({ hot, M, nearby, consensus, owner, expFrac, freshestSignalMin });
  const decision = shouldIGo({ venue, fullnessEst, M, momentum, consensus, owner, forecast, ref });

  if (closed) {
    radar.label = 'CLOSED';
    decision.verdict = 'CLOSED';
    if (openState.seasonalClosed) {
      decision.headline = `Closed for the season · reopens ${openState.opensLabel}`;
      decision.reasons = [`${venue.season?.label || 'Seasonal'} — reopens ${openState.opensLabel}`];
    } else {
      decision.headline = `Closed now · opens ${openState.opensLabel}`;
      decision.reasons = [`opens around ${openState.opensLabel}`]
        .concat(google?.rating ? [`★ ${google.rating} on Google`] : []);
    }
  }

  return {
    id: venue.id,
    name: venue.name,
    neighborhood: venue.neighborhood,
    neighborhoodName: venue.neighborhoodName,
    city: venue.city,
    category: rt.category,
    kind: rt.kind,
    coords: displayCoords,
    verified: venue.verified,
    lgbtq: !!venue.lgbtq,
    price: venue.price,
    hot,
    momentum, // {M,state,label,arrow}
    pct,
    fullness: { est: fullnessEst, low: closed ? 0 : clamp(fullnessEst - 8, 0, 100), high: closed ? 0 : clamp(fullnessEst + 7, 0, 100) },
    vibe: closed ? 'closed' : (consensus?.vibe || vibeFromFullness(fullnessEst)),
    source,
    open: openState.open,
    hours: { open: openState.open, source: openState.source, opensLabel: openState.opensLabel, closesLabel: openState.closesLabel },
    season: venue.season ? { label: venue.season.label || 'Seasonal', reopen: openState.opensLabel || null, closed: !!openState.seasonalClosed } : null,
    google,
    instagram,
    dress,
    liveBusyness: bt ? bt.busyness : null,
    liveSource: bt ? (bt.live ? 'live' : 'besttime') : null,
    recentSignals,
    recentCheckins,
    report: consensus,
    owner: owner ? { ...owner, ageMin: round(ageMinutes(owner.ts, ref)) } : null,
    queue,
    queueEstimated,
    queueEstMin: queueEstimated ? queueEst.mins : null,
    entry: consensus?.entry ?? (venue.price || 0),
    entryLabel: formatMoney(consensus?.entry ?? (venue.price || 0), venue.city),
    currency: currencyInfo(venue.city),
    entryEstimated: consensus?.entry == null, // true = seeded/typical, not community-reported

    music: owner?.music || consensus?.music || null,
    special: owner?.specials || null,
    forecast,
    expectedPeak: forecast.peakLabel,
    radar, // {score,label,bar,components}
    decision,
    lastReportAgeMin: consensus ? round(consensus.lastAgeMin) : null,
    relevance: consensus ? relevanceLabel(consensus.lastAgeMin) : null,
    media: db.media
      .filter((m) => m.venueId === venue.id)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 12)
      .map((m) => ({ id: m.id, url: '/media/' + m.id + '.' + m.ext, type: m.type, ageMin: round(ageMinutes(m.ts, ref)) })),
  };
}

function momentumState(M) {
  if (M <= -8) return { M, state: 'cooling', label: 'COOLING OFF', arrow: '↓' };
  if (M <= 4) return { M, state: 'steady', label: 'STEADY', arrow: '→' };
  if (M <= 12) return { M, state: 'heating', label: 'HEATING UP', arrow: '↑' };
  if (M <= 22) return { M, state: 'surging', label: 'SURGING', arrow: '↑↑' };
  return { M, state: 'exploding', label: 'EXPLODING', arrow: '🔥' };
}

// avg hot of OTHER venues within 400m — feeds "nearby venues busy simultaneously"
function nearbyActivity(venue, ref) {
  const near = db.venues.filter((v) => v.id !== venue.id && haversineMeters(v.coords, venue.coords) <= 400);
  if (!near.length) return { score: 0, count: 0, hot: [] };
  const hots = near.map((v) => {
    const a = activity(v.id, 0, 30, ref) / Math.max(1, v.peakRate);
    return smoothLoad(a);
  });
  return { score: round(mean(hots)), count: near.length };
}

// forecast fullness across the next 2h from the historical night curve, anchored
// to the current live estimate (offset fades over ~2h).
function venueForecast(venue, currentEst, ref) {
  const shape = (ts) => 0.12 + 0.83 * nightCurve(nightHour(ts), venue.peakHour, venue.spread);
  const fracNow = shape(ref);
  const offset = currentEst / 100 - fracNow;
  const points = [0, 30, 60, 90, 120].map((mins) => {
    const ts = ref + mins * MIN;
    const fade = Math.exp(-mins / 90);
    const frac = clamp(shape(ts) + offset * fade);
    return { mins, label: mins === 0 ? 'Now' : fmtHour(nightHour(ts)), pct: round(frac * 100) };
  });
  // expected peak = hour maximizing curve within next 4h (fallback: venue peak)
  let bestTs = ref, best = -1;
  for (let m = 0; m <= 240; m += 15) {
    const s = shape(ref + m * MIN);
    if (s > best) { best = s; bestTs = ref + m * MIN; }
  }
  return { points, peakLabel: fmtHour(nightHour(bestTs)), peakInMin: round((bestTs - ref) / MIN) };
}

// PARTY RADAR SCORE — the flagship composite (hot + momentum + nearby + recency
// + report confidence + event impact + historical expectation).
function partyRadarScore({ hot, M, nearby, consensus, owner, expFrac, freshestSignalMin }) {
  const momentumNorm = clamp(50 + M * 1.6, 0, 100);
  const recency = 100 * decayWeight(
    Number.isFinite(freshestSignalMin) ? freshestSignalMin : (consensus ? consensus.lastAgeMin : owner ? 25 : 60)
  );
  const reportConf = consensus ? consensus.confidence * 100 : 50;
  const eventImpact = owner?.specials ? 68 : 42;
  const historical = expFrac * 100;
  const nearbyScore = nearby.score || 0;
  const W = { hot: 0.32, momentum: 0.16, nearby: 0.12, recency: 0.1, conf: 0.1, event: 0.06, hist: 0.14 };
  const score = round(
    W.hot * hot + W.momentum * momentumNorm + W.nearby * nearbyScore +
    W.recency * recency + W.conf * reportConf + W.event * eventImpact + W.hist * historical
  );
  return { score, label: radarLabel(score), bar: barString(score), components: { hot, momentumNorm: round(momentumNorm), nearby: round(nearbyScore), recency: round(recency), reportConf: round(reportConf), eventImpact, historical: round(historical) } };
}

// Bands calibrated to the composite's real dynamic range: even a peak-night top
// room lands high-80s, so RED HOT begins at 84 (a genuine convergence of hot +
// momentum + fresh corroborated reports + a hot cluster), not an unreachable 90.
export function radarLabel(score) {
  if (score >= 84) return 'RED HOT';
  if (score >= 70) return 'POPPING';
  if (score >= 56) return 'BUSY';
  if (score >= 42) return 'HEATING UP';
  if (score >= 26) return 'CHILL';
  return 'QUIET';
}
function barString(score) {
  const filled = Math.round((score / 100) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// SHOULD I GO — rules-based decision assistant.
function shouldIGo({ venue, fullnessEst, M, momentum, consensus, owner, forecast }) {
  const reasons = [];
  const queue = consensus?.queue || owner?.queue;
  const special = owner?.specials;
  const peakSoon = forecast.peakInMin > 5 && forecast.peakInMin <= 75;
  let verdict, headline;

  const heating = M >= 4;
  const cooling = M <= -8;

  if (heating && fullnessEst >= 30 && fullnessEst < 90) {
    verdict = 'GO NOW';
    headline = momentum.state === 'exploding' || momentum.state === 'surging' ? 'Getting busier fast' : 'Warming up nicely';
    reasons.push(`${momentum.arrow} ${momentum.label.toLowerCase()}`);
  } else if (fullnessEst >= 88 && !cooling) {
    verdict = 'GO NOW';
    headline = 'Packed and holding';
    reasons.push('🔥 already at peak energy');
  } else if (fullnessEst < 30 && forecast.peakInMin > 45) {
    verdict = 'WAIT';
    headline = `Too early — builds toward ${forecast.peakLabel}`;
  } else if (cooling && fullnessEst < 65) {
    verdict = 'WAIT';
    headline = 'Cooling off — try elsewhere or later';
    reasons.push('↓ activity dropping');
  } else {
    verdict = 'YOUR CALL';
    headline = 'Steady — solid but not surging';
  }

  if (queue && queue !== 'none') reasons.push(`${queueLabel(queue)} queue`);
  else if (queue === 'none') reasons.push('no queue');
  if (peakSoon) reasons.push(`peak expected in ${forecast.peakInMin} min`);
  if (special) reasons.push(special.toLowerCase());
  else if (venue.price > 0) reasons.push(`${formatMoney(venue.price, venue.city)} entry`);
  if (fullnessEst != null) reasons.push(`~${fullnessEst}% full`);

  return { verdict, headline, reasons: reasons.slice(0, 5), peakLabel: forecast.peakLabel, peakInMin: forecast.peakInMin };
}

function queueLabel(q) {
  return { none: 'no', '<10': '<10 min', '10-20': '10–20 min', '20-30': '20–30 min', '30+': '30+ min' }[q] || q;
}

// ---- AREA / NEIGHBOURHOOD scores ----
export function areaSnapshot(hood, ref = now()) {
  const venues = db.venues.filter((v) => v.neighborhood === hood.id);
  const snaps = venues.map((v) => venueSnapshot(v, ref));
  const radarScores = snaps.map((s) => s.radar.score).sort((a, b) => b - a);
  // weight the top venues most — a district is judged by its best rooms
  const topWeighted = radarScores.slice(0, 5);
  const weights = topWeighted.map((_, i) => 1 / (i + 1));
  const nightScore = round(
    topWeighted.reduce((a, s, i) => a + s * weights[i], 0) / (weights.reduce((a, b) => a + b, 0) || 1)
  );
  const popping = snaps.filter((s) => s.radar.score >= 70).length;
  const packed = snaps.filter((s) => s.fullness.est >= 82).length;
  const surging = snaps.filter((s) => ['surging', 'exploding'].includes(s.momentum.state)).length;
  const heating = snaps.filter((s) => s.momentum.state === 'heating').length;
  // district peak window from its busiest venues' forecasts
  const peaks = snaps.map((s) => s.forecast.peakInMin).sort((a, b) => a - b);
  const peakStart = fmtHour(nightHour(ref + (peaks[0] ?? 30) * MIN));
  const peakEnd = fmtHour(nightHour(ref + (peaks[peaks.length - 1] ?? 120) * MIN + 60 * MIN));
  return {
    id: hood.id,
    name: hood.name,
    city: hood.city,
    center: hood.center,
    nightScore,
    label: radarLabel(nightScore),
    momentum: momentumState(round(mean(snaps.map((s) => s.momentum.M)))),
    popping, packed, surging, heating,
    venueCount: venues.length,
    bestFor: hood.bestFor,
    peakWindow: `${peakStart}–${peakEnd}`,
    hotzone: (popping + packed) >= 3 || surging >= 2,
  };
}

// geographic clusters (venues within 400m all rising) -> HOT ZONE labels
export function clusters(ref = now()) {
  return db.neighborhoods
    .map((h) => areaSnapshot(h, ref))
    .filter((a) => a.hotzone || a.surging > 0)
    .sort((a, b) => b.nightScore - a.nightScore);
}

// ---- RADAR FEED: detect notable transitions vs the previous computed state ----
export function detectTransitions(ref = now()) {
  for (const v of db.venues) {
    const s = venueSnapshot(v, ref);
    const prev = db.prevState[v.id];
    const cur = { vibe: s.vibe, hot: s.hot, momentumState: s.momentum.state };
    if (prev) {
      if (VIBE_ORDER.indexOf(cur.vibe) > VIBE_ORDER.indexOf(prev.vibe) && cur.vibe === 'packed') {
        pushFeed({ ts: ref, venueId: v.id, kind: 'vibe', text: `${v.name} changed to PACKED`, area: v.neighborhoodName });
      }
      if (['surging', 'exploding'].includes(cur.momentumState) && !['surging', 'exploding'].includes(prev.momentumState)) {
        pushFeed({ ts: ref, venueId: v.id, kind: 'surge', text: `${v.name} is ${cur.momentumState.toUpperCase()}`, sub: s.pct != null && s.pct > 0 ? `+${s.pct}% activity` : '', area: v.neighborhoodName });
      }
    }
    db.prevState[v.id] = cur;
  }
}

export function radarFeed(limit = 30, ref = now()) {
  return db.feed
    .filter((f) => ref - f.ts < 100 * MIN)
    .slice(-limit)
    .reverse()
    .map((f) => ({ ...f, ageMin: round(ageMinutes(f.ts, ref)) }));
}
