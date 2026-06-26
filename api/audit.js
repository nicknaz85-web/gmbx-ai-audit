// POST /api/audit  { url: "<google maps / business profile link>" }
// 1. Extracts a search query from the URL and resolves it to a real Google Place via the Places API.
// 2. Pulls real signals (rating, review count, review text, photos, hours, categories, website).
// 3. Sends ONLY that real data to Claude and asks it to score/summarize it — no invented numbers.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body || {};
  if (!url || typeof url !== 'string' || url.trim().length < 3) {
    return res.status(400).json({ error: 'Missing or invalid url' });
  }

  const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!PLACES_KEY || !ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'Server is missing API keys. Set GOOGLE_PLACES_API_KEY and ANTHROPIC_API_KEY in your Vercel project settings.' });
  }

  try {
    const place = await resolvePlace(url.trim(), PLACES_KEY);
    if (!place) {
      return res.status(404).json({ error: "Couldn't find a matching Google Business Profile for that link. Please check the link and try again." });
    }

    const report = await analyseWithClaude(place, ANTHROPIC_KEY);
    return res.status(200).json(report);
  } catch (err) {
    console.error('audit error:', err);
    return res.status(502).json({ error: 'Audit failed while analysing the profile. Please try again shortly.' });
  }
}

// ── Resolve a Google Maps/Business Profile URL to real place data ──
async function resolvePlace(rawUrl, placesKey) {
  // Expand short links (maps.app.goo.gl, goo.gl/maps) to the full URL first.
  let url = rawUrl;
  try {
    const head = await fetch(rawUrl, { method: 'GET', redirect: 'follow' });
    if (head.url) url = head.url;
  } catch (e) { /* fall back to raw url */ }

  let placeId = extractPlaceId(url);

  if (!placeId) {
    const queryText = extractSearchText(url);
    if (!queryText) return null;
    placeId = await findPlaceId(queryText, placesKey);
    if (!placeId) return null;
  }

  const place = await getPlaceDetails(placeId, placesKey);
  if (!place) return null;

  const enrichment = await enrichFromLiveMapsListing(place, url);
  if (enrichment) {
    place.liveProfileCategories = enrichment.extraCategories;
    place.accessibilityFeatures = enrichment.accessibilityFeatures;
  }
  return place;
}

function extractPlaceId(url) {
  // ?query_place_id=... or ?place_id=... or .../place/.../data=...!1s<placeId>... patterns
  const m1 = url.match(/[?&](?:query_)?place_id=([^&]+)/);
  if (m1) return decodeURIComponent(m1[1]);
  return null;
}

function extractSearchText(url) {
  // Pull the human-readable business name/address segment out of a Maps URL, e.g.
  // https://www.google.com/maps/place/Some+Business+Name/@51.5,-0.1,15z/...
  const m = url.match(/\/maps\/place\/([^/@]+)/);
  if (m) return decodeURIComponent(m[1].replace(/\+/g, ' '));
  // Fallback: try a "q=" query param (older Maps URL format)
  const m2 = url.match(/[?&]q=([^&]+)/);
  if (m2) return decodeURIComponent(m2[1].replace(/\+/g, ' '));
  return null;
}

async function findPlaceId(queryText, placesKey) {
  const params = new URLSearchParams({
    input: queryText,
    inputtype: 'textquery',
    fields: 'place_id',
    key: placesKey
  });
  const r = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params}`);
  const data = await r.json();
  if (data.status === 'OK' && data.candidates && data.candidates[0]) {
    return data.candidates[0].place_id;
  }
  return null;
}

async function getPlaceDetails(placeId, placesKey) {
  const fields = [
    'name', 'rating', 'user_ratings_total', 'formatted_address', 'formatted_phone_number',
    'website', 'opening_hours', 'business_status', 'types', 'editorial_summary',
    'reviews', 'photos', 'url', 'geometry'
  ].join(',');
  const params = new URLSearchParams({ place_id: placeId, fields, key: placesKey, reviews_sort: 'newest' });
  const r = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
  const data = await r.json();
  if (data.status !== 'OK' || !data.result) return null;

  const p = data.result;
  const photoCount = p.photos ? p.photos.length : 0;
  return {
    name: p.name || null,
    rating: p.rating ?? null,
    reviewCount: p.user_ratings_total ?? 0,
    address: p.formatted_address || null,
    phone: p.formatted_phone_number || null,
    website: p.website || null,
    hasHours: !!(p.opening_hours && p.opening_hours.weekday_text && p.opening_hours.weekday_text.length),
    openNow: p.opening_hours ? !!p.opening_hours.open_now : null,
    // IMPORTANT: this is a small set of coarse Google-internal type tags (e.g. "beauty_salon",
    // "spa"), NOT the full list of categories the owner has assigned in their live profile
    // (which commonly has 5-10 specific categories). Never treat the shortness of this list as
    // evidence the real profile lacks subcategories — that cannot be determined from this field.
    googleTypeTags: p.types || [],
    businessStatus: p.business_status || null,
    // This is Google's own auto-generated blurb for well-known places, NOT the owner-written
    // GBP description. The Places API has no field for the owner's actual description text,
    // so its absence here must never be reported as "the business has no description".
    googleEditorialSummary: p.editorial_summary ? p.editorial_summary.overview : null,
    photoCountReturned: photoCount,
    // The Places API hard-caps the photos array at 10 regardless of how many photos actually
    // exist on the live profile. A value of 10 here is therefore ambiguous (could be exactly 10
    // or could be hundreds) and must NOT be reported as "low"/"insufficient". Only a count below
    // this cap (e.g. 3) is a real, trustworthy signal of an actually sparse photo library.
    photoCountIsApiCapped: photoCount >= 10,
    reviews: (p.reviews || []).slice(0, 5).map(r => {
      var fullText = r.text || '';
      var truncated = fullText.length > 800;
      return {
        rating: r.rating,
        // Cut for prompt size only, not because the real review is incomplete — truncated
        // is flagged explicitly so the model never mistakes our cut for the customer's writing.
        text: truncated ? fullText.slice(0, 800) + '…' : fullText,
        textWasTruncatedForBrevityByUs: truncated,
        time: r.relative_time_description
        // Note: the Places API does not expose whether the owner replied to a review at all,
        // so no reply-status field is included here — do not infer or assume reply behaviour.
      };
    }),
    reviewsSortedBy: 'newest',
    mapsUrl: p.url || null,
    lat: p.geometry && p.geometry.location ? p.geometry.location.lat : null,
    lng: p.geometry && p.geometry.location ? p.geometry.location.lng : null,
    dataNotAvailable: [
      'owner-written business description',
      'review reply status / reply rate',
      'service area list',
      'service/product listings',
      'Google Posts / update frequency',
      'true total photo count when googleTypeTags photoCountIsApiCapped is true'
    ]
  };
}

// ── Best-effort enrichment: fetch the richer category list + accessibility attributes that
// are visible on the live Maps listing but not exposed by the official Places API. This calls
// an undocumented internal Google endpoint (not the public Places API), so it may break or
// return nothing at any time — every failure path below must be silently non-fatal.
async function enrichFromLiveMapsListing(place, rawInputUrl) {
  try {
    if (place.lat == null || place.lng == null) return null;
    const cidHex = extractCidHex(place.mapsUrl, rawInputUrl);
    if (!cidHex) return null;

    const pb = buildPreviewPb(cidHex, place.lat, place.lng);
    const r = await fetch(`https://www.google.com/maps/preview/place?authuser=0&hl=en&gl=us&pb=${pb}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' }
    });
    if (!r.ok) return null;
    const raw = await r.text();
    const cleaned = raw.replace(/^\)\]\}'\s*/, '');

    const extraCategories = extractCategoriesNearAddress(cleaned, place.address);
    const accessibilityFeatures = extractAccessibilityFeatures(cleaned);

    if (!extraCategories.length && !accessibilityFeatures.length) return null;
    return { extraCategories, accessibilityFeatures };
  } catch (e) {
    console.error('Live listing enrichment skipped (non-fatal):', e.message);
    return null;
  }
}

function extractCidHex(mapsUrl, rawInputUrl) {
  // Prefer a CID/feature-id pair already present in the user's own pasted link.
  for (const url of [rawInputUrl, mapsUrl]) {
    if (!url) continue;
    const pairMatch = url.match(/0x[0-9a-f]+:0x[0-9a-f]+/i);
    if (pairMatch) return pairMatch[0];
    const cidMatch = url.match(/[?&]cid=(\d+)/);
    if (cidMatch) return '0x0:0x' + BigInt(cidMatch[1]).toString(16);
  }
  return null;
}

function buildPreviewPb(cidHex, lat, lng) {
  const session = 'GMBXAUDIT' + Date.now();
  return [
    '!1m14', '!1s' + cidHex, '!3m12',
    '!1m3', '!1d50703', '!2d' + lng, '!3d' + lat,
    '!2m3', '!1f0.0', '!2f0.0', '!3f0.0',
    '!3m2', '!1i1024', '!2i768', '!4f13.1',
    '!12m4', '!2m3', '!1i360', '!2i120', '!4i8',
    '!13m57', '!2m2', '!1i203', '!2i100', '!3m2', '!2i4', '!5b1',
    '!6m6', '!1m2', '!1i86', '!2i86', '!1m2', '!1i408', '!2i240',
    '!15m8', '!1m7', '!1m2', '!1m1', '!1e2', '!2m2', '!1i195', '!2i195', '!3i20',
    '!14m3', '!1s' + session, '!7e81', '!15i10112'
  ].join('');
}

function extractCategoriesNearAddress(payloadText, address) {
  if (!address) return [];
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('\\[((?:"[^"\\]]*",?)+)\\](?:,null){0,8},"' + escaped + '"');
  const m = payloadText.match(re);
  if (!m) return [];
  return m[1].split(',').map(s => s.replace(/^"|"$/g, '')).filter(Boolean);
}

function extractAccessibilityFeatures(payloadText) {
  const matches = payloadText.match(/"(?:Has |No )?[Ww]heelchair accessible [a-z]+"/g) || [];
  return [...new Set(matches.map(s => s.replace(/^"|"$/g, '')))];
}

// ── Send the real data to Claude for scoring/summarisation ──
async function analyseWithClaude(place, anthropicKey) {
  const prompt = `You are a Google Business Profile auditor. Below is REAL data pulled from the Google Places API for one business. Score and analyse ONLY what is given — do not invent facts, reviews, or business details that aren't present.

The "dataNotAvailable" array in the JSON below lists things the public Places API structurally cannot see for ANY business (owner-written description, review reply behaviour, the full category list, service areas, service/product listings, posting activity). These may well exist on the real profile — their absence here is a data-source limitation, not evidence the business lacks them. Do NOT create "bad" findings, categories, or scores about anything in that list, and do NOT claim or imply the business lacks them. You MAY mention them once, collectively, in the "dataLimitations" field described below — nowhere else.

Two specific traps to avoid:
- "googleTypeTags" is a short list of coarse Google-internal tags, NOT the real category list shown on the live profile. If "liveProfileCategories" is present and non-empty, THAT is the real, live category list from the profile — use and discuss it confidently instead. If "liveProfileCategories" is missing or empty, you cannot see the real category list at all — never say "no subcategories" or "categories are broad/limited" in that case, it belongs in dataLimitations instead.
- "photoCountReturned" is capped at 10 by the API ("photoCountIsApiCapped" will be true when this happened). If capped, the true count is unknown and could be hundreds — do NOT call it "low" or "insufficient". Only treat the photo count as a real, discussable signal when photoCountIsApiCapped is false (i.e. the count is genuinely below the cap).
- Each review's "text" field was cut short by US (not by the customer) when "textWasTruncatedForBrevityByUs" is true, purely to keep this prompt a reasonable size. Never comment on review length, completeness, "cut off" text, or whether customers write detailed reviews — you are not seeing the real cutoff point, only ours.
- "accessibilityFeatures", when present, is a real list of accessibility attributes from the live profile (e.g. wheelchair access) — discuss it confidently as a real signal.

Only score and discuss what is directly observed: rating, review count, review text/recency (reviews are pre-sorted newest-first, so the dates you see are accurate), phone, website, hours, business status, photo count (only when not API-capped), liveProfileCategories (when present), and accessibilityFeatures (when present). These are real, verified signals — be specific and confident about them.

REAL PROFILE DATA:
${JSON.stringify(place, null, 2)}

Respond ONLY with valid JSON, no markdown, in this exact shape:
{
  "score": <number 0-100, derived ONLY from the directly-observed fields above>,
  "grade": "<NEEDS ATTENTION|GOOD PROGRESS|EXCELLENT>",
  "headline": "<short headline specific to this business>",
  "description": "<2 sentence summary grounded in the real data>",
  "categories": [
    {"label": "Profile Completeness", "score": <0-100, based on phone/website/hours/address presence>},
    {"label": "Review Strength", "score": <0-100, based on rating and review count>},
    {"label": "Review Recency & Engagement", "score": <0-100, based on how recent/frequent the sampled reviews are>},
    {"label": "Photo Presence", "score": <0-100; if photoCountIsApiCapped is true, score 70-85 (presence confirmed, true volume unknown) — never score this low just because it hit the cap; if not capped, score based on the actual low count>}
  ],
  "good": [ {"title": "<finding grounded in directly-observed data>", "body": "<why this is good>"} ],
  "bad": [ {"title": "<real gap in directly-observed data only>", "body": "<explanation with specific advice>", "tag": "<HIGH IMPACT|MEDIUM IMPACT|LOW IMPACT>"} ],
  "actions": [ {"title": "<action>", "body": "<specific advice>", "impact": "<high|med|low>"} ],
  "dataLimitations": "<one short sentence noting that description, review replies, service areas/listings, and posting activity can't be checked from public data and should be reviewed directly on the profile (omit category list from this sentence if liveProfileCategories was present and used above)>"
}

Make good 2-4 items, bad 2-4 items (only from directly-observed gaps — e.g. missing phone, no website, low photo count, no hours), actions 4-6 items (can include suggestions about replying to reviews or adding services as general best-practice advice, but without claiming the business currently fails to do these).`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await r.json();
  if (!r.ok) {
    console.error('Anthropic API error:', r.status, JSON.stringify(data));
    throw new Error('Anthropic API error ' + r.status + ': ' + (data.error && data.error.message || 'unknown'));
  }

  const text = (data.content && data.content[0] && data.content[0].text || '')
    .trim().replace(/```json/g, '').replace(/```/g, '').trim();

  const parsed = JSON.parse(text);
  parsed.profileName = place.name;
  stripUnverifiableFindings(parsed, place);
  return parsed;
}

// Belt-and-braces enforcement: the model sometimes ignores the prompt instruction and turns
// "we can't see this" into a finding anyway (just with softer wording). Strip those out here
// instead of trusting the model to comply, so the UI never shows things like "no description",
// "no review replies", "no subcategories", or "low photo count" (when the count is just the
// API's hard cap of 10) as if they were confirmed facts.
const UNVERIFIABLE_TOPIC_PATTERN = /editorial summary|review repl|owner repl|service (and\/or )?product listing|service area|google post|update activity|post frequency|post(ing)? activity|review.*(truncat|cut off|cut short)|truncat.*review|(detailed|complete|full) reviews?/i;
const CATEGORY_CLAIM_PATTERN = /subcategor|categor(y|ies) (is|are) (broad|limited|generic)|no specialist|category breadth/i;
const LOW_PHOTO_CLAIM_PATTERN = /photo/i;

function stripUnverifiableFindings(parsed, place) {
  const hasLiveCategories = Array.isArray(place.liveProfileCategories) && place.liveProfileCategories.length > 0;
  ['good', 'bad'].forEach(key => {
    if (Array.isArray(parsed[key])) {
      parsed[key] = parsed[key].filter(item => {
        const text = (item.title || '') + ' ' + (item.body || '');
        if (UNVERIFIABLE_TOPIC_PATTERN.test(text)) return false;
        // Only drop category-breadth claims when we genuinely couldn't see the real list —
        // if the live-listing scrape succeeded, these claims are grounded and should stay.
        if (!hasLiveCategories && CATEGORY_CLAIM_PATTERN.test(text)) return false;
        // Photo count is ambiguous (API-capped) — drop any photo-related claim in that case,
        // since we can't tell if the real count is 10 or 10,000.
        if (place.photoCountIsApiCapped && LOW_PHOTO_CLAIM_PATTERN.test(text)) return false;
        return true;
      });
    }
  });
}
