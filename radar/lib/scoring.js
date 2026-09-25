// scoring.js — every piece of derived nightlife intelligence is computed here,
// on demand, from the raw signal logs. Nothing is precomputed/stored, so the
// numbers are always live and always reflect time-decay.

import { db, venueById, pushFeed } from './store.js';
import { expectedRate, dayFactor } from './seed.js';
import { computeReportConfidence, inflationPenalty, getUser } from './reputation.js';
import { getBusyness } from './besttime.js';
import { resolveOpen, cityTz } from './hours.js';
import { upcomingFor } from './events.js';
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

// Deterministic "typical genre" for a venue, shown when nobody has reported the
// music — so the Music stat is never just a dash.
const CITY_GENRE = { Berlin: 'Techno', Leipzig: 'Techno', Detroit: 'Techno', Tbilisi: 'Techno', Amsterdam: 'House & Techno' };
const LATIN_CITIES = new Set(['Medellín', 'Bogotá', 'Mexico City', 'Cancún', 'Tulum', 'Buenos Aires', 'São Paulo', 'Rio de Janeiro', 'Lima', 'Santiago', 'San José', 'Panama City', 'Guatemala City', 'San Salvador', 'Cartagena', 'Havana', 'Montevideo', 'Camboriú']);
function genreHint(v) {
  if (v.kind === 'Club' || v.category === 'Dancing' || v.category === 'Late Night') {
    if (CITY_GENRE[v.city]) return CITY_GENRE[v.city];
    if (LATIN_CITIES.has(v.city)) return 'Reggaeton & Latin';
    return 'House & Techno';
  }
  if (v.kind === 'Rooftop') return 'House & Commercial';
  if (v.kind === 'Wine Bar') return 'Jazz & Soul';
  if (v.kind === 'Venue' || v.category === 'Live') return 'Live music';
  return 'House & Hip-Hop'; // bars
}

// "May–Oct" style label for a seasonal venue's OPEN months (from/to = 1–12).
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function seasonRange(season) {
  if (!season) return null;
  return MON3[(season.from - 1 + 12) % 12] + '–' + MON3[(season.to - 1 + 12) % 12];
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
  let mins = Math.round((f ** 1.3) * (12 + door * 15));
  // Door pressure holds a line once the room is genuinely FILLING (not on a near-
  // empty venue): a selective/pricey door then floors the wait — any club a short
  // line, popular/pricey rooms longer, marquee doors (e.g. Berghain) longest. Below
  // that, the queue follows how full it is (so a 4%-full club reads "no queue").
  if (f >= 0.45) {
    if (door >= 3) mins = Math.max(mins, 20);
    else if (door >= 2) mins = Math.max(mins, 10);
    else if (door >= 1) mins = Math.max(mins, 5);
  }
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
  // no live data → use the SAME crowd curve the Forecast draws (0.12 + 0.83·nightCurve),
  // so Party Radar and the forecast agree: a peak-hour room reads busy, not "quiet".
  // (Previously this used expFrac, a different historical model, which read ~22% while
  // the forecast curve read ~72% at the same hour.)
  else {
    const ctz = cityTz(venue.city, venue.coords);
    const curveNow = 0.12 + 0.83 * nightCurve(nightHour(ref, ctz), venue.peakHour, venue.spread);
    // the curve IS the estimate (matches the forecast's "Now" bar exactly); real
    // recent check-in activity only nudges it up, never drags it below the curve.
    fullnessFrac = clamp(curveNow + 0.25 * clamp(load));
  }
  // A closed venue is empty — don't claim a shut club is 63% full. An OPEN one is
  // never literally empty (someone's inside / at the door), which also lets a
  // selective club show its standing line even at off-peak open hours.
  if (closed) fullnessFrac = 0;
  else fullnessFrac = Math.max(fullnessFrac, 0.04);
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
  const forecast = venueForecast(venue, fullnessEst, ref, place, !!(consensus || owner || bt));
  const radar = partyRadarScore({ hot, M, nearby, consensus, owner, expFrac, freshestSignalMin, fullnessEst });
  const decision = shouldIGo({ venue, fullnessEst, M, momentum, consensus, owner, forecast, ref });

  if (closed) {
    radar.score = 0; // a closed venue reads 0 on the Party Radar (no live activity)
    radar.label = 'CLOSED';
    decision.verdict = 'CLOSED';
    if (openState.seasonalClosed) {
      decision.headline = `Closed for the season · reopens ${openState.opensLabel}`;
      decision.reasons = [`Open ${seasonRange(venue.season) || 'seasonally'} — reopens ${openState.opensLabel}`];
    } else {
      decision.headline = `Closed now · opens ${openState.opensLabel}`;
      // The opening time is already in the headline — don't repeat it as a bullet.
      // Fill the reason space with genuinely useful facts we already have instead.
      const cr = [];
      if (openState.nextCloseLabel) cr.push(`Open till ${openState.nextCloseLabel}`);
      if ((venue.price || 0) > 0) cr.push(`${entryRangeLabel(venue, consensus)} entry`);
      if (google?.rating) cr.push(`★ ${google.rating} on Google`);
      decision.reasons = cr.length ? cr : [`opens ${openState.opensLabel}`];
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
    hours: { open: openState.open, source: openState.source, opensLabel: openState.opensLabel, closesLabel: openState.closesLabel, nextCloseLabel: openState.nextCloseLabel || null, opensInMin: openState.opensInMin != null ? openState.opensInMin : null, openedAgoMin: openState.openedAgoMin != null ? openState.openedAgoMin : null },
    // tonight's real event/lineup (Ticketmaster), when we have a confident match.
    // The single-venue detail passes fullEvents so the card can list the whole week.
    tonight: upcomingFor(venue.id, venue.city, ref, !!opts.fullEvents),
    // the venue's own timezone context so the app can label foreign hours as local
    tzOffset: cityTz(venue.city, venue.coords),
    localTime: (() => { const ln = new Date(ref + cityTz(venue.city, venue.coords) * 3600 * 1000); let h = ln.getUTCHours(); const m = ln.getUTCMinutes(); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; })(),
    season: venue.season ? { label: seasonRange(venue.season) || 'Seasonal', reopen: openState.opensLabel || null, closed: !!openState.seasonalClosed } : null,
    google,
    googlePhoto: place?.googlePhoto || null,
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
    // Don't let one report overwrite the baseline (Google-informed) price — blend
    // them into an estimated RANGE so both are respected.
    entryLabel: entryRangeLabel(venue, consensus),
    currency: currencyInfo(venue.city),
    entryEstimated: consensus?.entry == null || consensus.entry !== (venue.price || 0), // range/seeded = estimate

    // named vibe reports (real users only) — newest first, for the LIVE REPORTS
    // list on the venue card. Kept for 24h since posting (the live-scoring signal
    // above still decays on its own short ~90min window — this is display only).
    recentReports: db.reports
      .filter((r) => r.venueId === venue.id && (ref - r.ts) < 24 * 60 * MIN && r.reporter && r.reporter.name)
      .map((r) => ({ ...r, age: ageMinutes(r.ts, ref) }))
      .sort((a, b) => a.age - b.age)
      .slice(0, 6)
      .map((r) => {
        const m = r.mediaId ? db.media.find((x) => x.id === r.mediaId) : null;
        return { id: r.id, mine: !!(opts.viewerHash && r.uHash === opts.viewerHash), name: r.reporter.name, age: r.reporter.age, tag: r.reporter.tag, photo: r.reporter.photo, vibe: r.vibe, queue: r.queue || null, entry: (r.entry != null ? r.entry : null), mix: r.mix || null, music: r.music || null, note: r.note || null, mediaId: m ? m.id : null, mediaUrl: m ? '/media/' + m.id + '.' + m.ext : null, mediaType: m ? m.type : null, ageMin: round(r.age) };
      }),
    music: owner?.music || consensus?.music || null,
    musicHint: genreHint(venue), // deterministic typical genre when none reported
    special: owner?.specials || null,
    forecast,
    expectedPeak: forecast.peakLabel,
    peakInMin: forecast.peakInMin != null ? forecast.peakInMin : null,
    radar, // {score,label,bar,components}
    decision,
    lastReportAgeMin: consensus ? round(consensus.lastAgeMin) : null,
    relevance: consensus ? relevanceLabel(consensus.lastAgeMin) : null,
    media: db.media
      .filter((m) => m.venueId === venue.id)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 12)
      .map((m) => {
        const rep = db.reports.find((r) => r.mediaId === m.id && r.reporter && r.reporter.name);
        return { id: m.id, url: '/media/' + m.id + '.' + m.ext, type: m.type, ageMin: round(ageMinutes(m.ts, ref)),
          by: rep ? { name: rep.reporter.name, photo: rep.reporter.photo || null } : null };
      }),
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

// Forecast fullness across the next 8 hours, hourly. The shape comes from the
// venue's researched peak-time curve (peakHourFor: venue kind + city nightlife
// culture), anchored to the current live crowd estimate (that live offset fades
// over ~2h), and — crucially — bounded by the venue's REAL opening hours: any
// hour the venue is closed reads 0%, so the forecast never claims a shut room is
// filling up. `place` carries the baked Google hours used by resolveOpen.
function venueForecast(venue, currentEst, ref, place, hasLive) {
  const tz = cityTz(venue.city, venue.coords); // peakHour is LOCAL time, so read night-hour in the venue's tz
  const shape = (ts) => 0.12 + 0.83 * nightCurve(nightHour(ts, tz), venue.peakHour, venue.spread);
  // Anchor the curve to the live crowd level ONLY when there's a genuine live signal
  // (reports / owner / foot-traffic) AND the venue is open now. Without live data
  // `currentEst` is just a historical guess from a DIFFERENT model than `shape`, and
  // anchoring to it dragged every bar down (e.g. a 71% peak-hour reading to ~22%) and
  // made the peak look like "now". No live signal → follow the venue's own curve.
  const openNow = resolveOpen(venue, ref, place).open;
  const offset = (openNow && hasLive) ? (currentEst / 100 - shape(ref)) : 0;
  // compact axis label ("11p", "3a", "12a") so the columns fit on a phone
  const shortHour = (ts) => { const h = ((Math.floor(nightHour(ts, tz)) % 24) + 24) % 24; return (h % 12 || 12) + (h < 12 ? 'a' : 'p'); };
  const HOUR = 60 * MIN;
  const isOpenAt = (ts) => resolveOpen(venue, ts, place).open;
  // The forecast only ever covers the venue's ACTUAL open session — never the hours
  // it's shut. Open now → start at "Now" and run to closing. Closed → jump forward to
  // the next opening and show that whole nightlife session. Cross-midnight sessions
  // are one continuous run because we work in absolute timestamps, so 5am is correctly
  // treated as after 10pm, not before it.
  let startTs = null;
  if (openNow) startTs = ref;
  else for (let t = ref; t <= ref + 7 * 24 * HOUR; t += 10 * MIN) { if (isOpenAt(t)) { startTs = t; break; } } // find the next opening (up to a week out, e.g. weekend-only venues)
  // when this session closes: the first shut moment at/after the start (null = never
  // closes within range, i.e. a 24h venue or unknown hours → just show the next 8h).
  let closeTs = null;
  if (startTs != null) for (let t = startTs + 10 * MIN; t <= startTs + 16 * HOUR; t += 10 * MIN) { if (!isOpenAt(t)) { closeTs = t; break; } }
  // Bars span the venue's ACTUAL open session — every hourly point from the start
  // (Now, or the next opening) through to and INCLUDING the closing-time point — the
  // count is dynamic (11pm→7am is 9 points, 10pm→4am is 7), never a fixed 8-hour box.
  // A venue with no locatable close (24h/unknown) falls back to a plain next-8h read.
  const points = [];
  // Cap the count so the chart stays readable on a phone (covers every realistic
  // nightlife session fully; an unusual all-day venue is truncated, not overflowed).
  const MAX = 12;
  const maxPts = closeTs != null ? MAX : 8;
  let reachedClose = false; // did we actually reach the closing point (vs truncate)?
  if (startTs != null) for (let k = 0; k < maxPts; k++) {
    const ts = startTs + k * HOUR;
    if (closeTs != null && ts > closeTs + 5 * MIN) { reachedClose = true; break; } // past close → stop
    const mins = Math.round((ts - ref) / MIN);
    const isNow = openNow && k === 0;                     // "Now" only when actually open now
    const fade = Math.exp(-Math.max(0, mins) / 120);      // live anchor fades over ~2h (unchanged)
    points.push({ mins: isNow ? 0 : mins, label: isNow ? 'Now' : shortHour(ts), pct: round(clamp(shape(ts) + offset * fade) * 100), open: true, ts });
  }
  // Always show the closing-time point, even when the hourly grid (offset from "Now")
  // stops short of it — e.g. open now at 1:20 with a 7:00 AM close → …6am, then 7am.
  if (startTs != null && closeTs != null && points.length && points.length < MAX) {
    const lastTs = points[points.length - 1].ts;
    if (closeTs - lastTs > 20 * MIN) {
      const mins = Math.round((closeTs - ref) / MIN);
      const fade = Math.exp(-Math.max(0, mins) / 120);
      points.push({ mins, label: shortHour(closeTs), pct: round(clamp(shape(closeTs) + offset * fade) * 100), open: true, ts: closeTs });
      reachedClose = true;
    }
  }
  // flag the final bar as the CLOSING point (only when we truly reached the close,
  // not a truncated/24h fallback) so the UI can show a "CLOSES" label under it
  if (reachedClose && points.length) points[points.length - 1].closes = true;
  // expected peak = the busiest OPEN moment of the coming night. Search further
  // than the 8h chart (up to 16h) so an afternoon check still reports tonight's
  // real peak (~2am) rather than a time capped at the window's edge.
  let bestTs = null, best = -1;
  for (let m = 0; m <= 960; m += 20) {
    const ts = ref + m * MIN;
    if (!resolveOpen(venue, ts, place).open) continue;
    const s = shape(ts);
    if (s > best) { best = s; bestTs = ts; }
  }
  // "Expected peak" reflects TONIGHT. Hide it when the venue is closed today —
  // i.e. it isn't open now and its next busy moment is more than ~14h away
  // (a future day), so a closed venue never advertises a peak.
  if (bestTs != null && !openNow && (bestTs - ref) / MIN > 14 * 60) bestTs = null;
  // If the venue CLOSES while its crowd curve is still rising (e.g. a bar that shuts
  // at midnight but would naturally peak ~1am), the "busiest open moment" is just the
  // last minute before close — not a real peak. Don't advertise "peaks at 11:59" when
  // it closes at 12: it's simply busy right up to close.
  if (bestTs != null) {
    const after = bestTs + 30 * MIN;
    const stillRising = shape(after) > shape(bestTs) + 0.001;      // hasn't peaked yet
    const closesSoon = !resolveOpen(venue, after, place).open;      // shut within 30 min
    if (stillRising && closesSoon) bestTs = null;
  }
  // Flag the ONE visible bar that holds the peak — but only when the real peak falls
  // inside the hours we're actually showing (within half an hour of a bar). If the
  // peak is outside the window we never fake-highlight a bar; the Expected Peak label
  // still reports the true time.
  if (bestTs != null) {
    let bi = -1, bd = 31 * MIN;
    for (let i = 0; i < points.length; i++) { const dd = Math.abs(points[i].ts - bestTs); if (dd < bd) { bd = dd; bi = i; } }
    if (bi >= 0) points[bi].peak = true;
  }
  // when closed now, the first bar IS the next opening hour — flag it so the UI can
  // show a small "OPENS" label under it (and no label once the venue is actually open)
  if (!openNow && startTs != null && points.length) points[0].opens = true;
  points.forEach((p) => { delete p.ts; }); // internal only — don't ship it
  return {
    points,
    peakLabel: bestTs == null ? null : fmtHour(nightHour(bestTs, tz)),
    peakInMin: bestTs == null ? 0 : round((bestTs - ref) / MIN),
  };
}

// PARTY RADAR SCORE — the flagship composite (hot + momentum + nearby + recency
// + report confidence + event impact + historical expectation).
// Entry price shown as an estimate: blend the seeded/Google baseline with any
// community-reported price into a single mid-point figure (no range/dashes), so
// one report never fully overrides the baseline.
function entryRangeLabel(venue, consensus) {
  const base = venue.price || 0;
  const rep = consensus && typeof consensus.entry === 'number' ? consensus.entry : null;
  if (rep == null) return formatMoney(base, venue.city);
  const mid = Math.round((base + rep) / 2);
  return formatMoney(mid, venue.city);
}
function partyRadarScore({ hot, M, nearby, consensus, owner, expFrac, freshestSignalMin, fullnessEst = 0 }) {
  // Party Radar should read like the forecast — "how busy is it right now" — so it is
  // ANCHORED to the live fullness/hotness of the room, then nudged a little by
  // momentum, a buzzing nearby cluster, an event and a very fresh signal. Previously a
  // broad 7-factor composite with neutral 50-midpoints diluted a 72%-full room down to
  // ~42; anchoring to busyness keeps the number honest (72% full → ~70).
  const busy = 0.8 * fullnessEst + 0.2 * hot;           // how full/alive it is now
  const momNudge = clamp((M / 36) * 9, -9, 9);          // ±~9 for strong up/down momentum
  const clusterNudge = ((nearby.score || 0) / 100) * 5; // up to +5 in a hot area
  const eventNudge = owner?.specials ? 4 : 0;           // a live event/special lifts it
  const freshBonus = Number.isFinite(freshestSignalMin) && freshestSignalMin <= 20 ? 2 : 0;
  const score = round(clamp(busy + momNudge + clusterNudge + eventNudge + freshBonus, 0, 100));
  return {
    score, label: radarLabel(score), bar: barString(score),
    components: { hot, fullnessEst, momentumNorm: round(clamp(50 + M * 1.6, 0, 100)), nearby: round(nearby.score || 0) },
  };
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
  // district peak window from its busiest venues' forecasts (labels in local time)
  const htz = cityTz(hood.city, hood.center);
  const peaks = snaps.map((s) => s.forecast.peakInMin).sort((a, b) => a - b);
  const peakStart = fmtHour(nightHour(ref + (peaks[0] ?? 30) * MIN, htz));
  const peakEnd = fmtHour(nightHour(ref + (peaks[peaks.length - 1] ?? 120) * MIN + 60 * MIN, htz));
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
