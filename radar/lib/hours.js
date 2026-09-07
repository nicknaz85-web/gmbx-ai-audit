// hours.js — honest "is it open right now?" for each venue.
//
// Two sources, in priority order:
//   1. Google Places `openNow` (authoritative, venue-local) — used only when we
//      have a CONFIDENT match (see lib/places.js name+type gating).
//   2. A schedule fallback derived from the venue's type, city timezone AND the
//      night of week — clubs are weekend-led, so a Tuesday 3am reads closed.

import { fmtHour } from './util.js';

// Summer (DST-active) UTC offsets. Most venue cities are CEST (+2); Eastern
// European ones (Greece, Romania, Moldova) are EEST (+3); Portugal is WEST (+1).
const EEST_CITIES = new Set([
  'Athens', 'Thessaloniki', 'Mykonos', 'Santorini', 'Heraklion',
  'Chania', 'Patras', 'Rhodes', 'Corfu',   // Greece
  'Bucharest', 'Mamaia',                    // Romania
  'Chișinău',                               // Moldova
  'Sofia',                                  // Bulgaria
  'Helsinki',                               // Finland
]);
// UTC+1 in summer: Portugal (WEST) and the UK / Ireland (BST).
const WEST_CITIES = new Set([
  'Lisbon', 'Porto',
  'London', 'Manchester', 'Glasgow', 'Leeds', 'Birmingham', 'Liverpool',
  'Bristol', 'Newcastle', 'Edinburgh', 'Sheffield', 'Cardiff', 'Belfast',
  'Dublin', // Ireland (IST, UTC+1)
]);
// Explicit UTC offsets for cities outside Europe (approximate, DST-of-the-moment;
// this is a nightlife guide, not a timezone database). Overrides the sets below.
const CITY_OFFSET = {
  // North America
  'New York': -4, 'Montreal': -4, 'Toronto': -4, 'Miami': -4, 'Chicago': -5,
  'Los Angeles': -7, 'Las Vegas': -7, 'Mexico City': -6, 'Cancún': -5, 'Tulum': -5,
  'Panama City': -5, 'San José': -6,
  // South America
  'São Paulo': -3, 'Rio de Janeiro': -3, 'Buenos Aires': -3, 'Bogotá': -5,
  'Medellín': -5, 'Lima': -5, 'Santiago': -3,
  // Asia
  'Bangkok': 7, 'Ho Chi Minh City': 7, 'Hanoi': 7, 'Tokyo': 9, 'Osaka': 9,
  'Seoul': 9, 'Bali': 8, 'Singapore': 8, 'Dubai': 4, 'Tel Aviv': 3,
  // Eastern Europe / Baltics / Belarus / Turkey (EET/EEST, +3 in summer)
  'Minsk': 3, 'Vilnius': 3, 'Riga': 3, 'Tallinn': 3, 'Istanbul': 3,
  // Oceania & Africa
  'Sydney': 10, 'Melbourne': 10, 'Brisbane': 10, 'Perth': 8, 'Auckland': 12,
  'Cape Town': 2, 'Johannesburg': 2, 'Lagos': 1, 'Nairobi': 3, 'Marrakech': 1,
  'Cairo': 3, 'Accra': 0,
  // India / China / rest of Asia
  'Mumbai': 5.5, 'Delhi': 5.5, 'Bangalore': 5.5, 'Goa': 5.5,
  'Shanghai': 8, 'Beijing': 8, 'Chengdu': 8, 'Hong Kong': 8, 'Taipei': 8,
  'Kuala Lumpur': 8, 'Manila': 8, 'Jakarta': 7,
  // Middle East / Caucasus
  'Beirut': 3, 'Tbilisi': 4,
  // North America (more)
  'San Francisco': -7, 'Vancouver': -7, 'Detroit': -4, 'Washington': -4,
  'Atlanta': -4, 'Austin': -5, 'New Orleans': -5,
  // Latin America / Caribbean (more)
  'Montevideo': -3, 'Cartagena': -5, 'Havana': -4, 'San Juan': -4,
  // Europe (more)
  'Reykjavik': 0, 'Kyiv': 3,
  // Russia + Central Asia + Caucasus
  'Moscow': 3, 'Saint Petersburg': 3, 'Tashkent': 5, 'Almaty': 5, 'Baku': 4, 'Yerevan': 4,
  // Africa (more)
  'Dakar': 0, 'Casablanca': 1, 'Addis Ababa': 3, 'Durban': 2,
  // China (more)
  'Shenzhen': 8,
  // South America (more)
  'Camboriú': -3,
};
export function cityTz(city) {
  if (CITY_OFFSET[city] !== undefined) return CITY_OFFSET[city];
  if (EEST_CITIES.has(city)) return 3;
  if (WEST_CITIES.has(city)) return 1;
  return 2;
}

// Is this fundamentally a late-night club (weekend-led) vs an everyday bar?
export function isClubLike(venue) {
  return venue.kind === 'Club' || venue.category === 'Dancing' || venue.category === 'Late Night';
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Nights a club is typically open when we DON'T have its real Google hours —
// Wed–Sun (closed Mon/Tue). This is a fallback estimate; real per-venue hours
// override it once baked in.
const CLUB_NIGHTS = new Set([0, 3, 4, 5, 6]);

// Opening window [open, close] in local night-hours (close may exceed 24).
function scheduleFor(venue) {
  const late = venue.category === 'Late Night';
  switch (venue.kind) {
    case 'Club':     return [late ? 23.5 : 23, late ? 30 : 29];      // 11pm–5/6am
    case 'Venue':    return [20, 27];                                 // 8pm–3am
    case 'Rooftop':  return [18, late ? 27 : 26];                     // 6pm–2/3am
    case 'Wine Bar': return [18, 25];                                 // 6pm–1am
    case 'Bar':      return [18, late ? 29 : 27];                     // 6pm–3/5am
    default:         return [19, 27];
  }
}

// Local wall-clock parts for a venue right now.
function localNow(venue, ref) {
  const tz = cityTz(venue.city);
  const d = new Date(ref + tz * 3600 * 1000);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const dow = d.getUTCDay();
  // the "night" belongs to the evening it started — after midnight = previous day
  const nightDow = h < 6 ? (dow + 6) % 7 : dow;
  return { h, dow, nightDow };
}

// Next club night label ("Fri", "Sat"…) at/after a given night-of-week.
function nextClubNight(nightDow) {
  for (let i = 0; i < 7; i++) {
    const d = (nightDow + i) % 7;
    if (CLUB_NIGHTS.has(d)) return { day: d, inDays: i };
  }
  return { day: 5, inDays: 0 };
}

// Schedule-based open/closed. Returns the same shape as the Google path.
function scheduleOpen(venue, ref) {
  const [openH, closeH] = scheduleFor(venue);
  const { h, nightDow } = localNow(venue, ref);
  const nowMin = h * 60, openMin = openH * 60, closeMin = closeH * 60;
  const inWindow =
    (nowMin >= openMin && nowMin < closeMin) ||
    (nowMin + 1440 >= openMin && nowMin + 1440 < closeMin);

  let open = inWindow;
  let opensLabel = fmtHour(openH);

  if (isClubLike(venue) && !CLUB_NIGHTS.has(nightDow)) {
    // it's a weeknight — a club is closed even inside the nightly hours
    open = false;
    const nn = nextClubNight(nightDow);
    opensLabel = `${DAY_NAMES[nn.day]} ${fmtHour(openH)}`;
  }

  return { open, source: 'schedule', opensLabel, closesLabel: fmtHour(closeH) };
}

const WEEK_MIN = 7 * 1440;
// Open/closed computed from real Google weekly periods (baked in), evaluated in
// the venue's local time. `periods` = [{ open:{day,hour,minute}, close:{...} }],
// day 0=Sunday. Empty periods + operational = open 24/7.
function openFromPeriods(periods, venue, ref) {
  const tz = cityTz(venue.city);
  const d = new Date(ref + tz * 3600 * 1000);
  const dow = d.getUTCDay();
  const nowWM = dow * 1440 + d.getUTCHours() * 60 + d.getUTCMinutes();
  // callers guard against empty periods (see resolveOpen) — always non-empty here
  let open = false, curCloseWM = null;
  let next = null; // soonest upcoming open: { delta, day, hour }
  for (const p of periods) {
    if (!p.open) continue;
    const oWM = p.open.day * 1440 + p.open.hour * 60 + (p.open.minute || 0);
    let cWM = p.close
      ? p.close.day * 1440 + p.close.hour * 60 + (p.close.minute || 0)
      : oWM + 1440;
    if (cWM <= oWM) cWM += WEEK_MIN; // wraps past midnight / end of week
    for (const t of [nowWM, nowWM + WEEK_MIN]) {
      if (t >= oWM && t < cWM) { open = true; curCloseWM = cWM; }
    }
    const delta = ((oWM - nowWM) % WEEK_MIN + WEEK_MIN) % WEEK_MIN;
    if (!next || delta < next.delta) next = { delta, day: p.open.day, hour: p.open.hour + (p.open.minute || 0) / 60 };
  }

  if (open) {
    return { open: true, source: 'google', opensLabel: null, closesLabel: fmtHour((curCloseWM % 1440) / 60) };
  }
  // closed now → label the next opening (prefix the weekday when it's not today)
  const opensLabel = next
    ? (next.day !== dow ? DAY_NAMES[next.day] + ' ' : '') + fmtHour(next.hour)
    : null;
  return { open: false, source: 'google', opensLabel, closesLabel: null };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
// Local calendar month (1–12) for the venue's city.
function localMonth(venue, ref) {
  const d = new Date(ref + cityTz(venue.city) * 3600 * 1000);
  return d.getUTCMonth() + 1;
}
// Is `month` inside the venue's open season? Handles ranges that wrap the year.
function inSeason(season, month) {
  if (!season) return true;
  const { from, to } = season;
  return from <= to ? (month >= from && month <= to) : (month >= from || month <= to);
}

// Public: resolve open state. `place` is the cached Google record (or null);
// we trust its openNow only when places.js marked the match confident.
export function resolveOpen(venue, ref, place) {
  // seasonal (e.g. summer-only) venues read closed outside their season, whatever
  // Google or the schedule says
  if (venue.season && !inSeason(venue.season, localMonth(venue, ref))) {
    return {
      open: false,
      source: 'season',
      seasonalClosed: true,
      opensLabel: MONTHS[(venue.season.from - 1 + 12) % 12],
      closesLabel: null,
    };
  }
  // permanently/temporarily closed per Google → never open
  if (place && (place.businessStatus === 'CLOSED_PERMANENTLY' || place.businessStatus === 'CLOSED_TEMPORARILY')) {
    const perm = place.businessStatus === 'CLOSED_PERMANENTLY';
    return { open: false, source: 'closed', opensLabel: perm ? 'permanently closed' : 'temporarily closed', closesLabel: null, permanentlyClosed: perm };
  }
  // real weekly hours (baked or live) → compute open/closed from the schedule.
  // Empty periods means Google has no regular hours (irregular/event-based, e.g.
  // Berghain) — NOT 24/7 — so fall through to the schedule estimate instead.
  if (place && Array.isArray(place.periods) && place.periods.length) {
    return openFromPeriods(place.periods, venue, ref);
  }
  // live openNow snapshot (only from a fresh confident live fetch)
  if (place && place.confident && typeof place.openNow === 'boolean') {
    const sched = scheduleFor(venue);
    return {
      open: place.openNow,
      source: 'google',
      opensLabel: place.opensLabel || fmtHour(sched[0]),
      closesLabel: place.closesLabel || fmtHour(sched[1]),
    };
  }
  return scheduleOpen(venue, ref);
}
