// places.js — Google Places (New) integration: authoritative open/closed,
// rating, review count and price level for each venue. Dormant unless
// GOOGLE_PLACES_KEY is set. Cost-controlled:
//   • each venue's place id is resolved once (Text Search) and cached forever
//   • live details (openNow) refresh at most once per TTL
//   • callers refresh lazily (a viewed venue) or in small capped background
//     batches (the map), never a full 80-venue sweep at once.

import { db, saveSnapshotSoon } from './store.js';
import { now, MIN, fmtHour } from './util.js';
import { summarizeReviews } from './reviews.js';

// ---- match confidence: reject the wrong Google place (a pharmacy called
// "Drugstore", a different club, a hotel) so we never read its hours/rating ----

// PRIMARY place types that mean this result is not the venue we want — a shop,
// a hotel, or just a street address/office. Checked against primaryType only:
// Google also tags real clubs with noisy secondary types like "store", so
// rejecting on any type would throw out genuine venues (Ministry of Sound is a
// night_club that Google also tags "store").
const NON_NIGHTLIFE = new Set([
  'drugstore', 'pharmacy', 'supermarket', 'grocery_store', 'convenience_store',
  'department_store', 'store', 'shopping_mall', 'clothing_store', 'lodging',
  'hotel', 'gas_station', 'bank', 'atm', 'hospital', 'clinic', 'doctor',
  'gym', 'parking', 'church', 'school', 'university', 'spa',
  // address / non-place results
  'premise', 'subpremise', 'street_address', 'route', 'postal_code', 'plus_code',
  'corporate_office', 'travel_agency', 'real_estate_agency',
]);

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
// A match is name-confident if one normalized name contains the other, or the
// word sets overlap by at least half — enough to catch "Amnesia" ~ "Amnesia
// Ibiza" while rejecting "Drugstore" ~ "dm drogerie markt".
function nameConfident(want, got) {
  const a = normName(want), b = normName(got);
  if (!a || !b) return false;
  if (a.length >= 3 && (b.includes(a) || a.includes(b))) return true;
  // space-insensitive: "Lux Frágil" ~ "LuxFrágil", "Klub 20/44" ~ "Klub2044"
  const ca = a.replace(/ /g, ''), cb = b.replace(/ /g, '');
  if (ca.length >= 4 && (cb.includes(ca) || ca.includes(cb))) return true;
  // ignore leading articles/prepositions so "Le Dépôt" doesn't match "Le SECTEURX"
  // (or "La X" ~ "La Y") on the shared article alone
  const ART = new Set(['le', 'la', 'les', 'l', 'the', 'el', 'il', 'lo', 'los', 'un', 'une', 'du', 'de', 'di', 'da', 'o', 'a']);
  const A = new Set(a.split(' ').filter((w) => w.length > 1 && !ART.has(w)));
  const B = new Set(b.split(' ').filter((w) => w.length > 1 && !ART.has(w)));
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.5;
}
function typeOk(hit) {
  // judge by the PRIMARY type only — secondary types are noisy on real venues
  const pt = hit.primaryType;
  if (pt && NON_NIGHTLIFE.has(pt)) return false;
  return true;
}

// A nightlife qualifier added to the search query so Google doesn't resolve a
// bar/club NAME to a generic business of the same word — "Drugstore" the club
// vs a drugstore/pharmacy. This disambiguates matching AND the directions link.
export function typeWord(v) {
  // gay/LGBTQ+ venues share names with straight (or strip) venues — e.g. "Pleasure"
  // the Belgrade gay club vs a same-named strip club. The qualifier disambiguates
  // both the place match and the directions link.
  const g = v.lgbtq ? 'gay ' : '';
  if (v.kind === 'Club' || v.category === 'Dancing') return g + 'nightclub';
  if (v.kind === 'Rooftop' || v.category === 'Rooftops') return g + 'rooftop bar';
  if (v.kind === 'Venue' || v.category === 'Live') return g + 'music venue';
  if (v.kind === 'Wine Bar' || v.category === 'Wine') return g + 'wine bar';
  return g + 'bar';
}

const HOST = 'https://places.googleapis.com/v1';
const DETAILS_TTL = 12 * MIN;   // how long an openNow reading stays fresh
const RESOLVE_TTL = 24 * 60 * MIN; // re-try a failed name→id match once a day

export const enabled = () => !!process.env.GOOGLE_PLACES_KEY;
const key = () => process.env.GOOGLE_PLACES_KEY;

// Cached record for a venue, if any. Shape:
//   { placeId, rating, ratings, priceLevel, gmapsUrl, address, location,
//     openNow, opensLabel, closesLabel, detailsTs, resolvedTs, dead }
export function getPlace(venueId) {
  const p = db.places[venueId];
  return p && !p.dead ? p : null;
}

// Map Google's opening-hours periods to a human "opens 11:30 PM" for today.
function labelsFromHours(reg) {
  try {
    const periods = reg?.periods || [];
    if (!periods.length) return {};
    // pick the earliest open time across the week as a representative label
    const opens = periods.map((p) => p.open).filter(Boolean);
    const closes = periods.map((p) => p.close).filter(Boolean);
    const fmt = (t) => (t ? fmtHour(t.hour + (t.minute || 0) / 60) : null);
    return { opensLabel: fmt(opens[0]), closesLabel: fmt(closes[0]) };
  } catch { return {}; }
}

async function textSearch(venue) {
  // No type filter: many real clubs are mis-typed by Google (e.g. ROXY Prague is
  // a "sports_club"), and filtering to night_club would skip them and grab a
  // tiny same-named impostor. Instead search broadly and vet the results below.
  const body = {
    textQuery: [`${venue.name} ${typeWord(venue)}`, venue.neighborhoodName, venue.city].filter(Boolean).join(', '),
    maxResultCount: 5,
    locationBias: venue.coords
      ? { circle: { center: { latitude: venue.coords.lat, longitude: venue.coords.lng }, radius: 3000 } }
      : undefined,
  };
  const res = await fetch(`${HOST}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key(),
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.primaryType,places.types,places.location,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.formattedAddress',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('searchText ' + res.status + ' ' + (await res.text()).slice(0, 160));
  const json = await res.json();
  const cands = json.places || [];
  // keep candidates that are plausibly the venue (not a shop/hotel) and whose
  // name matches, then take the most-reviewed — the real venue dwarfs impostors.
  const ok = cands.filter((p) => typeOk(p) && nameConfident(venue.name, p.displayName?.text));
  if (!ok.length) return { hit: null, confident: false };
  ok.sort((a, b) => (b.userRatingCount || 0) - (a.userRatingCount || 0));
  return { hit: ok[0], confident: true };
}

// Resolve a venue's real Instagram profile URL by reading DuckDuckGo's no-JS
// results and taking the first instagram.com/<handle> link. Runs once per venue
// (cached), so the app can link straight to the profile instead of a search.
// handles that are Instagram's own pages or generic junk, not a venue
const IG_JUNK = new Set(['popular', 'instagram', 'explore', 'reel', 'reels', 'p', 'tv', 'stories',
  'accounts', 'about', 'developer', 'directory', 'privacy', 'terms', 'help', 'web', 'legal',
  'emailsignup', 'session', 'challenge', 'nametag', 'igtv', 'locations']);
function igHandle(u) { const m = u.match(/instagram\.com\/([A-Za-z0-9_.]+)/i); return m ? m[1].toLowerCase() : ''; }
// Does this handle plausibly belong to THIS venue? Rejects a top result that is
// actually a different place (e.g. "MP Bar" -> lepulsebar). Accepts when a
// distinctive word of the name — or its acronym (RVT -> rvtofficial) — is in it.
const IG_STOP = new Set(['bar', 'club', 'the', 'le', 'la', 'les', 'music', 'official', 'disco',
  'lounge', 'pub', 'cocktail', 'de', 'di', 'and', 'show', 'klub', 'cafe']);
function handleMatchesVenue(name, city, handle) {
  const cityTok = new Set(normName(city).split(' ').filter(Boolean));
  const toks = normName(name).split(' ').filter((w) => w.length > 1 && !IG_STOP.has(w) && !cityTok.has(w));
  if (!toks.length) return true;
  const h = handle.toLowerCase().replace(/[._]/g, '');
  // a distinctive word (4+ chars) must appear in the handle, or its acronym
  if (toks.some((t) => t.length >= 4 && h.includes(t))) return true;
  const acro = toks.map((t) => t[0]).join('');
  return acro.length >= 2 && h.includes(acro);
}
// first non-junk instagram profile link that plausibly matches the venue name
function pickIG(urls, name, city) {
  return urls.find((u) => {
    if (!/instagram\.com\/[A-Za-z0-9_.]+\/?$/.test(u)) return false;
    const h = igHandle(u);
    if (!h || IG_JUNK.has(h)) return false;
    return !name || handleMatchesVenue(name, city || '', h);
  });
}
// Read a search-results page through the Jina reader proxy — it fetches from its
// own servers (so our IP never gets rate-limited) and returns clean text. Pull
// the instagram.com/<handle> links out of that text.
async function jinaLinks(target) {
  const res = await fetch('https://r.jina.ai/' + target, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'X-Return-Format': 'text' },
  });
  if (!res.ok) return [];
  const txt = await res.text();
  return (txt.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/[A-Za-z0-9_.]+/g) || [])
    .map((u) => (u.startsWith('http') ? u : 'https://' + u));
}

// Resolve a venue's real Instagram profile URL. `hint` (e.g. "gay club") makes
// the query specific so generic names don't match an unrelated account.
// Best-effort; cached by the caller so it runs at most once per venue.
async function resolveInstagram(name, city) {
  const q = `${name} ${city} instagram`;
  const targets = [
    'https://duckduckgo.com/html/?q=' + encodeURIComponent(q),
    'https://www.google.com/search?q=' + encodeURIComponent(q),
  ];
  for (const t of targets) {
    try {
      const ig = pickIG(await jinaLinks(t), name, city);
      if (ig) return ig.replace(/\/?$/, '/');
    } catch { /* try next source */ }
  }
  return null;
}

async function details(placeId) {
  const res = await fetch(`${HOST}/places/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': key(),
      'X-Goog-FieldMask':
        'rating,userRatingCount,priceLevel,googleMapsUri,websiteUri,formattedAddress,businessStatus,currentOpeningHours.openNow,regularOpeningHours.periods,editorialSummary,reviews',
    },
  });
  if (!res.ok) throw new Error('details ' + res.status + ' ' + (await res.text()).slice(0, 160));
  return res.json();
}

// Ensure a venue has a resolved place id, refreshing details if stale.
// Safe to call often; it self-throttles on the cache TTLs. Returns the record.
export async function refreshVenue(venue) {
  if (!enabled() || !venue) return null;
  const t = now();
  let rec = db.places[venue.id] || null;

  // (1) resolve name -> place id (once, cached)
  if (!rec || (!rec.placeId && t - (rec.resolvedTs || 0) > RESOLVE_TTL)) {
    try {
      const { hit, confident } = await textSearch(venue);
      if (hit?.id && confident) {
        rec = {
          placeId: hit.id,
          confident: true,
          matchedName: hit.displayName?.text || null,
          primaryType: hit.primaryType || null,
          rating: hit.rating ?? null,
          ratings: hit.userRatingCount ?? null,
          priceLevel: hit.priceLevel ?? null,
          gmapsUrl: hit.googleMapsUri ?? null,
          address: hit.formattedAddress ?? null,
          location: hit.location ? { lat: hit.location.latitude, lng: hit.location.longitude } : null,
          openNow: null,
          resolvedTs: t,
          detailsTs: 0,
        };
      } else {
        // no confident nightlife match — stay on the schedule fallback
        rec = { placeId: null, confident: false, resolvedTs: t, dead: true };
      }
      db.places[venue.id] = rec;
      saveSnapshotSoon();
    } catch (e) {
      console.warn('[places] resolve failed for', venue.name, '-', e.message);
      db.places[venue.id] = { placeId: null, resolvedTs: t, dead: true };
      return null;
    }
  }

  if (!rec || !rec.placeId) return getPlace(venue.id);

  // (2) refresh live details (openNow etc.) on TTL
  if (t - (rec.detailsTs || 0) > DETAILS_TTL) {
    try {
      const d = await details(rec.placeId);
      const reviews = (d.reviews || []).map((r) => ({ rating: r.rating, text: r.text?.text || r.originalText?.text || '' }));
      const review = summarizeReviews(reviews, d.editorialSummary?.text || null);
      Object.assign(rec, {
        rating: d.rating ?? rec.rating,
        ratings: d.userRatingCount ?? rec.ratings,
        priceLevel: d.priceLevel ?? rec.priceLevel,
        gmapsUrl: d.googleMapsUri ?? rec.gmapsUrl,
        website: d.websiteUri ?? rec.website,
        businessStatus: d.businessStatus ?? rec.businessStatus,
        address: d.formattedAddress ?? rec.address,
        openNow: typeof d.currentOpeningHours?.openNow === 'boolean' ? d.currentOpeningHours.openNow : rec.openNow,
        ...labelsFromHours(d.regularOpeningHours),
        review: review || rec.review || null, // { summary, pros[], cons[], basedOn }
        detailsTs: t,
      });
      db.places[venue.id] = rec;
      saveSnapshotSoon();
    } catch (e) {
      console.warn('[places] details failed for', venue.name, '-', e.message);
      rec.detailsTs = t; // back off so we don't hammer a failing id
    }
  }

  return getPlace(venue.id);
}

// True once Google tells us the place is permanently closed — used to drop
// defunct venues (e.g. clubs that shut down years ago) from the map.
export function isDefunct(venueId) {
  const p = db.places[venueId];
  return !!(p && p.businessStatus === 'CLOSED_PERMANENTLY');
}

// Instagram URL for a venue if we've resolved one — readable even for venues
// with no confident Google match (whose main record is hidden by getPlace).
export function getInstagram(venueId) {
  const p = db.places[venueId];
  return (p && p.instagram) || null;
}

// Background: pre-resolve every venue's Instagram once (throttled), so buttons
// are instant. Skips venues already resolved. Runs after a fresh boot, then the
// results persist in the snapshot.
export async function warmInstagram(venues, delayMs = 1200) {
  for (const v of venues) {
    const r = db.places[v.id];
    if (r && (r.instagram || (r.website && /instagram\.com/i.test(r.website)))) continue;
    try { await ensureInstagram(v); } catch { /* keep going */ }
    await new Promise((res) => setTimeout(res, delayMs));
  }
}

// Verified Instagram handles for venues whose generic names defeat auto-search
// (mostly the LGBTQ+ additions). Keyed by exact venue name; these always win.
const IG_HANDLES = {
  'Heaven': 'heavenlgbtclub', 'Sodade 2': 'sodade2', 'BeQueer': 'bequeer_athens',
  "JackieO' Mykonos": 'jackieomykonos', 'Babylon Mykonos': 'babylon.mykonos',
  'SchwuZ': 'schwuz', 'Lab.oratory': '_lab_oratory_', 'Le Dépôt': 'ledepotparis',
  'Raidd Bar': 'raiddbar', 'Arena Madre': 'grupoarena', 'LL Show Bar': 'llshowbar',
  'Trumps': 'trumpslisboa', 'Finalmente Club': 'finalmenteclublisboa', 'Leccomilano': 'leccomilano',
  'Coming Out': 'comingoutroma', 'Royal Vauxhall Tavern': 'rvtofficial', 'Cruz 101': 'cruz101official',
  'Club Church': 'club.church', 'Le Belgica': 'lebelgica', 'Why Not': 'whynot_vienna',
  'TerMix': 'termix_club', 'AlterEgo': 'alterego_budapest', 'NY.Club': 'nyclub.munich',
  'Wunderbar': 'wunderbarhamburg', "Lucky's Manhattan": 'luckysffm', 'Polo Lounge': 'pologlasgow',
  'The Nightingale Club': 'thenightingaleclub', 'Viaduct Showbar': 'viaductshowbar',
  'Le Glam': 'glam.nice', 'Reality Bar': 'realitybar', 'Klub Tiffany': 'klubtiffany',
};

// Resolve one venue's Instagram profile on demand (when its detail is opened),
// so we never fire a burst of search requests that gets rate-limited. Cached.
export async function ensureInstagram(venue) {
  if (!venue) return null;
  const rec = db.places[venue.id] || (db.places[venue.id] = {});
  // a pinned handle (map or seed) always wins — overrides any cached guess
  const forced = IG_HANDLES[venue.name] || venue.ig;
  if (forced) { rec.instagram = 'https://www.instagram.com/' + forced + '/'; db.places[venue.id] = rec; saveSnapshotSoon(); return rec.instagram; }
  if (rec.website && /instagram\.com/i.test(rec.website)) return rec.website;
  if (rec.instagram) return rec.instagram;
  if (!enabled()) return null;
  const ig = await resolveInstagram(venue.name, venue.city);
  if (ig) { rec.instagram = ig; db.places[venue.id] = rec; saveSnapshotSoon(); }
  return ig;
}

// One-time throttled sweep so every venue gets its real Google location (fixes
// pins that the approximate seed coords dropped in water). Skips venues already
// resolved (or already tried & dead), so it's cheap after the first full pass
// and does nothing on restarts once the cache is warm.
export async function warmAll(venues, delayMs = 300) {
  if (!enabled()) return;
  for (const v of venues) {
    const r = db.places[v.id];
    if (r && (r.location || r.dead)) continue;
    try { await refreshVenue(v); } catch { /* logged inside */ }
    await new Promise((res) => setTimeout(res, delayMs));
  }
}

// Refresh up to `max` venues whose live details are stale — used to warm the
// map view without a full sweep. Fire-and-forget from request handlers.
export async function refreshStale(venues, max = 6) {
  if (!enabled()) return;
  const t = now();
  const due = venues.filter((v) => {
    const r = db.places[v.id];
    if (r?.dead) return false;
    return !r || t - (r.detailsTs || 0) > DETAILS_TTL;
  }).slice(0, max);
  for (const v of due) {
    try { await refreshVenue(v); } catch { /* logged inside */ }
  }
}
