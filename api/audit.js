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

  return await getPlaceDetails(placeId, placesKey);
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
    'reviews', 'photos', 'url'
  ].join(',');
  const params = new URLSearchParams({ place_id: placeId, fields, key: placesKey });
  const r = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
  const data = await r.json();
  if (data.status !== 'OK' || !data.result) return null;

  const p = data.result;
  return {
    name: p.name || null,
    rating: p.rating ?? null,
    reviewCount: p.user_ratings_total ?? 0,
    address: p.formatted_address || null,
    phone: p.formatted_phone_number || null,
    website: p.website || null,
    hasHours: !!(p.opening_hours && p.opening_hours.weekday_text && p.opening_hours.weekday_text.length),
    openNow: p.opening_hours ? !!p.opening_hours.open_now : null,
    categories: p.types || [],
    businessStatus: p.business_status || null,
    description: p.editorial_summary ? p.editorial_summary.overview : null,
    photoCount: p.photos ? p.photos.length : 0,
    reviews: (p.reviews || []).slice(0, 5).map(r => ({
      rating: r.rating,
      text: (r.text || '').slice(0, 300),
      time: r.relative_time_description,
      hasOwnerReply: !!r.author_url && false // Places API does not expose owner replies; left false/unknown deliberately
    })),
    mapsUrl: p.url || null
  };
}

// ── Send the real data to Claude for scoring/summarisation ──
async function analyseWithClaude(place, anthropicKey) {
  const prompt = `You are a Google Business Profile auditor. Below is REAL data pulled from the Google Places API for one business. Score and analyse ONLY what is given — do not invent facts, reviews, or business details that aren't present. If a field is missing or null, treat that as a gap to flag (e.g. no website, no hours, no description).

REAL PROFILE DATA:
${JSON.stringify(place, null, 2)}

Respond ONLY with valid JSON, no markdown, in this exact shape:
{
  "score": <number 0-100, derived from the real data above>,
  "grade": "<NEEDS ATTENTION|GOOD PROGRESS|EXCELLENT>",
  "headline": "<short headline specific to this business>",
  "description": "<2 sentence summary grounded in the real data>",
  "categories": [
    {"label": "Profile Completeness", "score": <0-100>},
    {"label": "Review Strength", "score": <0-100>},
    {"label": "Review Reply Rate", "score": <0-100>},
    {"label": "Update Activity", "score": <0-100>},
    {"label": "Service Areas", "score": <0-100>},
    {"label": "Service Listings", "score": <0-100>},
    {"label": "Photo Activity", "score": <0-100>},
    {"label": "Local SEO", "score": <0-100>}
  ],
  "good": [ {"title": "<finding grounded in real data>", "body": "<why this is good>"} ],
  "bad": [ {"title": "<real gap or weakness>", "body": "<explanation with specific advice>", "tag": "<HIGH IMPACT|MEDIUM IMPACT|LOW IMPACT>"} ],
  "actions": [ {"title": "<action>", "body": "<specific advice>", "impact": "<high|med|low>"} ]
}

Notes on scoring fields you don't have direct data for (update activity, service listings, local SEO depth): be conservative and explicitly say in the relevant "bad" or "good" item that this is inferred from limited public signals (e.g. review recency, category breadth, presence of a website) rather than presenting it as a confirmed fact. Make good 2-4 items, bad 3-5 items, actions 4-6 items.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1800,
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
  return parsed;
}
