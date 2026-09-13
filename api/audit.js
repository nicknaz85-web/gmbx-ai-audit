// POST /api/audit  { url: "<google maps / business profile link>" }
// 1. Extracts a search query from the URL and resolves it to a real Google Place via the Places API.
// 2. Pulls real signals (rating, review count, review text, photos, hours, categories, website).
// 3. Sends ONLY that real data to Claude and asks it to score/summarize it — no invented numbers.

import { Resend } from 'resend';
import { isRateLimited, clientIp } from './admin.js';

// Only URLs on these hosts are ever fetched server-side — the audit only makes
// sense for Google Business Profile links, and this prevents the endpoint being
// used to make requests to arbitrary/internal hosts (SSRF).
const ALLOWED_URL_HOSTS = /^(?:[a-z0-9-]+\.)*(?:google\.[a-z.]{2,6}|share\.google|goo\.gl|g\.co|g\.page)$/i;

function isAllowedAuditUrl(raw) {
  try {
    const u = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return ALLOWED_URL_HOSTS.test(u.hostname);
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 10 audits per hour per IP — each audit costs real money (Claude + Places + Outscraper)
  if (await isRateLimited('audit', clientIp(req), 10, 3600)) {
    return res.status(429).json({ error: 'Too many audits from this connection. Please try again in an hour.' });
  }

  const { url, email, updatesPerMonth, targetKeywords, serviceArea } = req.body || {};
  if (!url || typeof url !== 'string' || url.trim().length < 3 || url.length > 2000) {
    return res.status(400).json({ error: 'Missing or invalid url' });
  }
  if (!isAllowedAuditUrl(url.trim())) {
    return res.status(400).json({ error: 'Please paste a Google Maps or Google Business Profile link (google.com/maps/..., share.google/..., or maps.app.goo.gl/...).' });
  }

  const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const OUTSCRAPER_KEY = process.env.OUTSCRAPER_API_KEY;
  if (!PLACES_KEY || !ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'Server is missing API keys. Set GOOGLE_PLACES_API_KEY and ANTHROPIC_API_KEY in your Vercel project settings.' });
  }

  try {
    const place = await resolvePlace(url.trim(), PLACES_KEY, OUTSCRAPER_KEY);
    if (!place) {
      return res.status(404).json({ error: "Couldn't find a matching Google Business Profile for that link. Please check the link and try again." });
    }
    if (place === 'SHARE_LINK_UNRESOLVABLE') {
      return res.status(404).json({ error: "This share link couldn't be resolved automatically. Please open the business on Google Maps in your browser, copy the full URL from the address bar (it starts with google.com/maps/place/), and paste that instead." });
    }
    if (place === 'NOT_IN_PLACES_API') {
      return res.status(404).json({ error: "This business exists on Google Maps but isn't indexed in Google's Places API, which is required to run the audit. This affects some small or newly-created listings. Ask the business owner to ensure their Google Business Profile is fully verified and published." });
    }

    // Self-reported by the person submitting the audit, NOT independently verified — pass
    // through clearly labelled so the prompt/model treats it as a claim, not a confirmed fact.
    place.selfReported = {
      updatesPerMonth: (typeof updatesPerMonth === 'number' && updatesPerMonth >= 0) ? updatesPerMonth : null,
      targetKeywords: (typeof targetKeywords === 'string' && targetKeywords.trim()) ? targetKeywords.trim().slice(0, 300) : null,
      serviceArea: (typeof serviceArea === 'string' && serviceArea.trim()) ? serviceArea.trim().slice(0, 300) : null
    };
    if (place.selfReported.updatesPerMonth != null) {
      place.dataNotAvailable = place.dataNotAvailable.filter(d => d !== 'Google Posts / update frequency');
    }
    if (place.selfReported.serviceArea != null) {
      place.dataNotAvailable = place.dataNotAvailable.filter(d => d !== 'service area list');
    }

    const report = await analyseWithClaude(place, ANTHROPIC_KEY);

    // Local keyword ranking is slow (Outscraper polling), so we DON'T block the audit on it.
    // Instead return the context the browser needs to fetch rankings separately via
    // /api/rankings once the audit is already on screen.
    if (place.selfReported.targetKeywords && OUTSCRAPER_KEY) {
      report.rankingContext = {
        keywords: place.selfReported.targetKeywords,
        name: place.name,
        address: place.address,
        phone: place.phone,
        serviceArea: place.selfReported.serviceArea
      };
    }

    // Send audit email — fire-and-forget so it never blocks or errors the audit response
    if (email && typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const RESEND_KEY = process.env.RESEND_API_KEY;
      const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'GMBX Audit <onboarding@resend.dev>';
      if (RESEND_KEY) {
        sendAuditEmail({ email, businessName: place.name, report, resendKey: RESEND_KEY, fromEmail: FROM_EMAIL })
          .catch(e => console.error('Audit email failed (non-fatal):', e.message));
      }
    }

    return res.status(200).json(report);
  } catch (err) {
    console.error('audit error:', err);
    return res.status(502).json({ error: 'Audit failed while analysing the profile. Please try again shortly.' });
  }
}

// ── Send branded audit results email via Resend ──
async function sendAuditEmail({ email, businessName, report, resendKey, fromEmail }) {
  const resend = new Resend(resendKey);
  const score = report.score || 0;
  const grade = report.grade || '';
  const headline = report.headline || '';
  const bad = Array.isArray(report.bad) ? report.bad.slice(0, 3) : [];

  const scoreColor = score >= 70 ? '#10B981' : score >= 45 ? '#F59E0B' : '#EF4444';
  const gradeBg = grade === 'EXCELLENT' ? '#D1FAE5' : grade === 'GOOD PROGRESS' ? '#FEF3C7' : '#FEE2E2';
  const gradeColor = grade === 'EXCELLENT' ? '#065F46' : grade === 'GOOD PROGRESS' ? '#92400E' : '#991B1B';

  const issuesHtml = bad.length ? `
    <h2 style="font-size:14px;font-weight:700;color:#EF4444;margin:24px 0 12px">&#9888; Key Issues to Fix</h2>
    ${bad.map(b => `
      <div style="border-left:3px solid #EF4444;padding:10px 14px;margin-bottom:10px;background:#FFF5F5;border-radius:0 8px 8px 0">
        <div style="font-size:13px;font-weight:700;color:#1A1A2E">${esc(b.title || '')}${b.tag ? ` <span style="font-size:10px;background:#FEE2E2;color:#DC2626;padding:2px 6px;border-radius:10px;font-weight:600">${esc(b.tag)}</span>` : ''}</div>
        <div style="font-size:12px;color:#6B7280;margin-top:4px">${esc(b.body || '')}</div>
      </div>`).join('')}` : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="background:#1A1A2E;border-radius:12px 12px 0 0;padding:24px 32px;text-align:center">
    <div style="font-size:26px;font-weight:800;color:#fff;letter-spacing:-0.5px">GM<span style="color:#E63946">BX</span></div>
    <div style="font-size:12px;color:#94A3B8;margin-top:4px;letter-spacing:1px;text-transform:uppercase">Google Business Profile Audit</div>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #E5E7EB;border-top:none">
    <h1 style="margin:0 0 8px;font-size:22px;color:#1A1A2E;font-weight:800">Your Audit is Ready${businessName ? ` for ${esc(businessName)}` : ''}</h1>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px">Here's a summary of your Google Business Profile performance.</p>
    <div style="background:#F8F9FA;border-radius:12px;padding:28px;text-align:center;margin-bottom:24px">
      <div style="font-size:64px;font-weight:800;color:${scoreColor};line-height:1">${score}</div>
      <div style="font-size:12px;color:#9CA3AF;margin-top:4px">out of 100</div>
      <div style="display:inline-block;background:${gradeBg};color:${gradeColor};font-size:11px;font-weight:700;padding:5px 14px;border-radius:20px;margin-top:12px;text-transform:uppercase;letter-spacing:0.5px">${esc(grade)}</div>
      <div style="font-size:15px;font-weight:600;color:#1A1A2E;margin-top:14px;max-width:400px;margin-left:auto;margin-right:auto">${esc(headline)}</div>
    </div>
    ${issuesHtml}
    <div style="background:#1A1A2E;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
      <h2 style="margin:0 0 6px;font-size:16px;font-weight:700;color:#fff">Let GMBX Fix Everything For You</h2>
      <p style="margin:0 0 16px;font-size:13px;color:#94A3B8">Professional Google Business Profile management from just &#163;10/mo.</p>
      <a href="https://gmbx-ai-audit.vercel.app" style="display:inline-block;background:#E63946;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 28px;border-radius:8px">View All Packages &#8594;</a>
    </div>
    <h2 style="font-size:14px;font-weight:700;color:#1A1A2E;margin:0 0 12px">Choose Your Package</h2>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="25%" style="padding:4px;vertical-align:top">
          <div style="border:2px solid #D1D5DB;border-radius:10px;padding:14px 8px;text-align:center">
            <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase">Starter</div>
            <div style="font-size:11px;font-weight:800;color:#1A1A2E;margin:4px 0">Basic Opts</div>
            <div style="font-size:20px;font-weight:800;color:#1A1A2E">&#163;10<span style="font-size:10px;font-weight:400;color:#6B7280">/mo</span></div>
            <a href="https://buy.stripe.com/14A7sM6uzgcm0uE1uz1kA06" style="display:block;background:#1A1A2E;color:#fff;text-decoration:none;font-size:11px;font-weight:700;padding:8px 4px;border-radius:6px;margin-top:10px">Get Started</a>
          </div>
        </td>
        <td width="25%" style="padding:4px;vertical-align:top">
          <div style="border:2px solid #2563EB;border-radius:10px;padding:14px 8px;text-align:center">
            <div style="font-size:9px;background:#2563EB;color:#fff;border-radius:10px;padding:2px 6px;display:inline-block;margin-bottom:4px;font-weight:700">POPULAR</div>
            <div style="font-size:10px;font-weight:700;color:#2563EB;text-transform:uppercase">Growth</div>
            <div style="font-size:11px;font-weight:800;color:#1A1A2E;margin:4px 0">Medium Opts</div>
            <div style="font-size:20px;font-weight:800;color:#1A1A2E">&#163;20<span style="font-size:10px;font-weight:400;color:#6B7280">/mo</span></div>
            <a href="https://buy.stripe.com/bJe14o6uze4ea5e3CH1kA05" style="display:block;background:#2563EB;color:#fff;text-decoration:none;font-size:11px;font-weight:700;padding:8px 4px;border-radius:6px;margin-top:10px">Get Started</a>
          </div>
        </td>
        <td width="25%" style="padding:4px;vertical-align:top">
          <div style="border:2px solid #E63946;border-radius:10px;padding:14px 8px;text-align:center">
            <div style="font-size:9px;background:#E63946;color:#fff;border-radius:10px;padding:2px 6px;display:inline-block;margin-bottom:4px;font-weight:700">BEST VALUE</div>
            <div style="font-size:10px;font-weight:700;color:#E63946;text-transform:uppercase">Premium</div>
            <div style="font-size:11px;font-weight:800;color:#1A1A2E;margin:4px 0">Max Opts</div>
            <div style="font-size:20px;font-weight:800;color:#1A1A2E">&#163;30<span style="font-size:10px;font-weight:400;color:#6B7280">/mo</span></div>
            <a href="https://buy.stripe.com/9B68wQ5qvd0a7X6flp1kA04" style="display:block;background:#E63946;color:#fff;text-decoration:none;font-size:11px;font-weight:700;padding:8px 4px;border-radius:6px;margin-top:10px">Get Started</a>
          </div>
        </td>
        <td width="25%" style="padding:4px;vertical-align:top">
          <div style="border:2px solid #7C3AED;border-radius:10px;padding:14px 8px;text-align:center">
            <div style="font-size:10px;font-weight:700;color:#7C3AED;text-transform:uppercase">Social</div>
            <div style="font-size:11px;font-weight:800;color:#1A1A2E;margin:4px 0">Social Pack</div>
            <div style="font-size:20px;font-weight:800;color:#1A1A2E">&#163;150<span style="font-size:10px;font-weight:400;color:#6B7280">/mo</span></div>
            <a href="https://buy.stripe.com/fZu7sMbOT9NY1yI4GL1kA03" style="display:block;background:#7C3AED;color:#fff;text-decoration:none;font-size:11px;font-weight:700;padding:8px 4px;border-radius:6px;margin-top:10px">Get Started</a>
          </div>
        </td>
      </tr>
    </table>
  </div>
  <div style="background:#1A1A2E;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center">
    <div style="font-size:12px;color:#6B7280">&#169; 2025 GMBX &#183; Google Business Profile Management</div>
    <div style="margin-top:8px">
      <a href="https://www.gmbx.co.uk" style="color:#94A3B8;text-decoration:none;font-size:12px;margin:0 10px">gmbx.co.uk</a>
      <a href="https://www.facebook.com/profile.php?id=61571653626007" style="color:#94A3B8;text-decoration:none;font-size:12px;margin:0 10px">Facebook</a>
    </div>
    <div style="font-size:11px;color:#4B5563;margin-top:10px">You received this because you requested a free GBP audit at gmbx-ai-audit.vercel.app</div>
  </div>
</div>
</body></html>`;

  await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: `Your Google Business Profile Audit — Score: ${score}/100`,
    html
  });
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Resolve a Google Maps/Business Profile URL to real place data ──
// Returns null for "not found", or the string 'SHARE_LINK_UNRESOLVABLE' when
// a share.google link can't be resolved server-side (so the caller can show a helpful message).
async function resolvePlace(rawUrl, placesKey, outscraperKey) {
  const isShareLink = /share\.google|maps\.app\.goo\.gl/i.test(rawUrl);
  let url = rawUrl;
  try {
    const resp = await fetch(rawUrl, {
      method: 'GET', redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (resp.url && resp.url !== rawUrl) url = resp.url;
  } catch (e) { console.error('URL expansion failed:', e.message); }

  let placeId = extractPlaceId(url);

  if (!placeId && /google\.com\/search/i.test(url)) {
    placeId = await resolveViaKgmid(url, placesKey);
  }

  if (!placeId) {
    const queryText = extractSearchText(url);
    if (!queryText) return isShareLink ? 'SHARE_LINK_UNRESOLVABLE' : null;
    const latLng = extractLatLng(url);
    placeId = await findPlaceId(queryText, placesKey, latLng);
    if (!placeId) return isShareLink ? 'SHARE_LINK_UNRESOLVABLE' : null;
  }

  let place = await getPlaceDetails(placeId, placesKey);

  // ftid lookup via Places API doesn't always work — go straight to Outscraper with the
  // original Maps URL (which encodes the exact business) rather than falling back to a
  // name text-search that can return a completely different business.
  if (!place && placeId.startsWith('FTID:')) {
    if (outscraperKey) place = await resolveViaOutscraper(url, outscraperKey);
    if (!place) return 'NOT_IN_PLACES_API';
  }
  // Share links that couldn't be resolved via kgmid/text-search — try Outscraper
  if (!place && isShareLink && outscraperKey) {
    place = await resolveViaOutscraper(rawUrl, outscraperKey);
    if (!place) return 'SHARE_LINK_UNRESOLVABLE';
  }
  if (!place) return null;

  const enrichment = await enrichFromLiveMapsListing(place, url);
  if (enrichment) {
    place.liveProfileCategories = enrichment.extraCategories;
    place.accessibilityFeatures = enrichment.accessibilityFeatures;
  }
  return place;
}

function fetchWithTimeout(url, opts, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(t));
}

// Resolve a Google Search URL (from share.google redirect) to a ChIJ place ID.
async function resolveViaKgmid(searchUrl, placesKey) {
  const kgmidMatch = searchUrl.match(/[?&]kgmid=(\/g\/[^&\s]+)/);
  const qMatch = searchUrl.match(/[?&]q=([^&]+)/);
  const kgmid = kgmidMatch ? decodeURIComponent(kgmidMatch[1]) : null;
  const qText = qMatch ? decodeURIComponent(qMatch[1].replace(/\+/g, ' ')) : null;

  // 1. Fetch google.com/maps?kgmid=... — may resolve to a Maps URL with lat/lng embedded,
  //    which lets us do an accurate nearbysearch to find the ChIJ place_id
  if (kgmid && qText && placesKey) {
    try {
      const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const mResp = await fetchWithTimeout(`https://www.google.com/maps?kgmid=${encodeURIComponent(kgmid)}`, {
        method: 'GET', redirect: 'follow',
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-GB,en;q=0.9' }
      }, 5000);
      const mUrl = mResp.url || '';
      const pidFromUrl = extractPlaceId(mUrl);
      if (pidFromUrl) return pidFromUrl;
      const mHtml = await mResp.text().catch(() => '');
      const latLngInBody = extractLatLng(mUrl) || (() => {
        const m = mHtml.match(/"lat":(-?\d+\.\d+),"lng":(-?\d+\.\d+)/);
        return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
      })();
      const chijInBody = (mHtml.match(/ChIJ[A-Za-z0-9_\-]{10,60}/g) || []);
      if (chijInBody.length) return chijInBody[0];
      if (latLngInBody) {
        const pid = await findPlaceId(qText, placesKey, latLngInBody);
        if (pid) return pid;
      }
    } catch (e) { console.error('Maps kgmid fetch failed:', e.message); }
  }

  // 2. New Places API (v1) text search
  if (qText && placesKey) {
    try {
      const r = await fetchWithTimeout('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': placesKey, 'X-Goog-FieldMask': 'places.id,places.displayName' },
        body: JSON.stringify({ textQuery: qText, regionCode: 'GB', languageCode: 'en' })
      }, 5000);
      const d = await r.json();
      if (d.places && d.places[0] && d.places[0].id) return d.places[0].id;
    } catch (e) { console.error('New Places API failed:', e.message); }
  }

  return null;
}

// Check where the business ranks in Google Maps results when searching each target
// keyword in its local area — this is the ranking that actually matters for a GBP.
function normName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

export async function fetchKeywordRankings(targetKeywords, businessName, businessAddress, businessPhone, outscraperKey, serviceArea) {
  try {
    const keywords = targetKeywords.split(/[,\n]+/).map(k => k.trim()).filter(Boolean).slice(0, 3);
    // Derive the locality from the address: use the middle parts (skip street, skip country/postcode)
    const addrParts = (businessAddress || '').split(',').map(s => s.trim()).filter(Boolean);
    let locality = addrParts.length >= 2 ? addrParts[addrParts.length - 2].replace(/\s+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i, '').trim() : (addrParts[0] || '');
    // Service-area businesses often have no public address — fall back to the
    // self-reported service area (first named area, e.g. "Exeter and Newton Abbot" -> "Exeter")
    if (!locality && serviceArea) {
      locality = serviceArea.split(/,|\band\b|&|\//i)[0].trim();
    }
    if (!locality) return null;

    const results = await Promise.all(keywords.map(async keyword => {
      try {
        const query = `${keyword}, ${locality}`;
        const params = new URLSearchParams({ query, limit: '40', language: 'en', async: 'true' });
        const r = await fetchWithTimeout(`https://api.app.outscraper.com/maps/search-v3?${params}`, {
          headers: { 'X-API-KEY': outscraperKey }
        }, 15000);
        let data = await r.json();
        console.log('DEBUG local rank submit:', r.status, query, JSON.stringify(data).slice(0, 200));

        if (data.results_location && !data.data) {
          const resultsUrl = data.results_location;
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise(res => setTimeout(res, 4000));
            const pr = await fetchWithTimeout(resultsUrl, { headers: { 'X-API-KEY': outscraperKey } }, 10000);
            const pd = await pr.json();
            if (pd.status === 'Success' && pd.data) { data = pd; break; }
            if (pd.status === 'Error') break;
          }
        }

        const items = data.data && data.data[0] ? data.data[0] : [];
        console.log('DEBUG local rank items:', items.length, 'names:', items.map(it => it.name).join(' | ').slice(0, 500));
        console.log('DEBUG matching against name:', businessName, 'phone:', businessPhone, 'street:', (businessAddress || '').split(',')[0]);
        const nameNorm = normName(businessName);
        const phoneDigits = (businessPhone || '').replace(/\D/g, '').slice(-9);
        const streetNorm = normName((businessAddress || '').split(',')[0]);
        let position = null;
        let matchedName = null;
        for (let i = 0; i < items.length; i++) {
          const itemName = normName(items[i].name);
          const itemPhone = (items[i].phone || '').replace(/\D/g, '').slice(-9);
          const itemAddr = normName(items[i].full_address || items[i].address || '');
          const nameHit = nameNorm && itemName && (itemName.includes(nameNorm) || nameNorm.includes(itemName));
          const phoneHit = phoneDigits && itemPhone && itemPhone === phoneDigits;
          const addrHit = streetNorm && streetNorm.length > 5 && itemAddr.includes(streetNorm);
          if (nameHit || phoneHit || addrHit) {
            position = i + 1;
            matchedName = items[i].name;
            break;
          }
        }
        console.log('DEBUG local rank match:', keyword, 'position:', position, 'matched:', matchedName);
        return {
          keyword,
          searchedAs: query,
          totalResultsChecked: items.length || 20,
          localMapsPosition: position || `Not in top ${items.length || 20} local results`
        };
      } catch (e) {
        console.error('Local rank lookup failed for', keyword, ':', e.message);
        return { keyword, localMapsPosition: 'unavailable' };
      }
    }));
    return results;
  } catch (e) {
    console.error('Keyword rankings failed (non-fatal):', e.message);
    return null;
  }
}

async function resolveViaOutscraper(mapsUrl, outscraperKey) {
  try {
    const params = new URLSearchParams({ query: mapsUrl, limit: '1', language: 'en', async: 'false', reviews_limit: '5' });
    const r = await fetchWithTimeout(`https://api.app.outscraper.com/maps/search-v3?${params}`, {
      headers: { 'X-API-KEY': outscraperKey }
    }, 25000);
    const data = await r.json();
    const raw = data.data && data.data[0] && data.data[0][0];
    if (!raw || !raw.name) return null;
    const photoCount = raw.photos_count || 0;
    const reviews = (raw.reviews_data || []).slice(0, 5).map(rv => {
      const fullText = rv.review_text || '';
      const truncated = fullText.length > 800;
      return {
        rating: rv.review_rating,
        text: truncated ? fullText.slice(0, 800) + '…' : fullText,
        textWasTruncatedForBrevityByUs: truncated,
        time: rv.review_datetime_utc || null
      };
    });

    const hoursObj = raw.working_hours || null;
    const weekdayText = hoursObj
      ? Object.entries(hoursObj).map(([day, hrs]) => `${day}: ${hrs}`)
      : (raw.working_hours_csv_compatible ? [raw.working_hours_csv_compatible] : []);

    return {
      name: raw.name || null,
      rating: raw.rating ?? null,
      reviewCount: raw.reviews ?? 0,
      address: raw.full_address || raw.address || null,
      phone: raw.phone || null,
      website: raw.website || null,
      hasHours: weekdayText.length > 0,
      openNow: null,
      googleTypeTags: raw.subtypes ? raw.subtypes.split(', ') : (raw.type ? [raw.type] : []),
      businessStatus: raw.business_status || null,
      googleEditorialSummary: null,
      photoCountReturned: Math.min(photoCount, 10),
      photoCountIsApiCapped: photoCount >= 10,
      reviews,
      reviewsSortedBy: 'newest',
      mapsUrl: raw.url || mapsUrl,
      lat: raw.latitude ?? null,
      lng: raw.longitude ?? null,
      dataSource: 'outscraper',
      dataNotAvailable: [
        'owner-written business description',
        'review reply status / reply rate',
        'service area list',
        'service/product listings',
        'Google Posts / update frequency'
      ]
    };
  } catch (e) {
    console.error('Outscraper lookup failed:', e.message);
    return null;
  }
}

function extractPlaceId(url) {
  // ?query_place_id=... or ?place_id=...
  const m1 = url.match(/[?&](?:query_)?place_id=([^&]+)/);
  if (m1) return decodeURIComponent(m1[1]);

  // data=...!1s<placeId>... embedded in full Maps URLs
  const dataParam = url.match(/[?&/]data=([^?&\s#]+)/);
  if (dataParam) {
    const decoded = decodeURIComponent(dataParam[1]);
    // ChIJ format (old-style place ID)
    const pid = decoded.match(/!1s(ChIJ[^!&]+)/);
    if (pid) return pid[1];
    // Hex CID pair format 0xFEATURE:0xCID — use ftid lookup
    const hex = decoded.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    if (hex) return 'FTID:' + hex[1];
  }

  // ftid= parameter
  const ftid = url.match(/[?&]ftid=(ChIJ[^&]+)/);
  if (ftid) return decodeURIComponent(ftid[1]);

  // Bare hex pair in URL path (some share links)
  const hexPair = url.match(/(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (hexPair) return 'FTID:' + hexPair[1];

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

function extractLatLng(url) {
  // !3d<lat>!4d<lng> in Maps data parameter (most precise — actual business coords)
  const m1 = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) };
  // @lat,lng in Maps path
  const m2 = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
  return null;
}

async function findPlaceId(queryText, placesKey, latLng) {
  // With location — use nearbysearch which is extremely accurate when we have coords
  if (latLng) {
    const p0 = new URLSearchParams({ location: `${latLng.lat},${latLng.lng}`, radius: '500', name: queryText, key: placesKey });
    const r0 = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${p0}`);
    const d0 = await r0.json();
    if (d0.status === 'OK' && d0.results && d0.results[0]) return d0.results[0].place_id;

    const p1b = new URLSearchParams({ query: queryText, location: `${latLng.lat},${latLng.lng}`, radius: '1000', key: placesKey });
    const r1b = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${p1b}`);
    const d1b = await r1b.json();
    if (d1b.status === 'OK' && d1b.results && d1b.results[0]) return d1b.results[0].place_id;
  }

  const p1 = new URLSearchParams({ input: queryText, inputtype: 'textquery', fields: 'place_id', key: placesKey });
  const r1 = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${p1}`);
  const d1 = await r1.json();
  if (d1.status === 'OK' && d1.candidates && d1.candidates[0]) return d1.candidates[0].place_id;

  const p2 = new URLSearchParams({ query: queryText, key: placesKey });
  const r2 = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${p2}`);
  const d2 = await r2.json();
  if (d2.status === 'OK' && d2.results && d2.results[0]) return d2.results[0].place_id;

  return null;
}

async function getPlaceDetails(placeId, placesKey) {
  const fields = [
    'name', 'rating', 'user_ratings_total', 'formatted_address', 'formatted_phone_number',
    'website', 'opening_hours', 'business_status', 'types', 'editorial_summary',
    'reviews', 'photos', 'url', 'geometry'
  ].join(',');
  // FTID:0x...:0x... comes from extractPlaceId when the URL uses hex pair format
  const idParam = placeId.startsWith('FTID:') ? { ftid: placeId.slice(5) } : { place_id: placeId };
  const params = new URLSearchParams({ ...idParam, fields, key: placesKey, reviews_sort: 'newest' });
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
  // This template (including the long, semantically-opaque !15m106...!37i784 tail) is copied
  // verbatim from a real browser request to Google's internal preview/place endpoint — it is
  // NOT fully understood, but the request returns 400 if this tail is shortened/simplified.
  // Only !1s (place id), !2d/!3d (lng/lat) and !14m3!1s (session id) are substituted per place.
  return [
    '!1m14', '!1s' + cidHex, '!3m12',
    '!1m3', '!1d50703.30295666765', '!2d' + lng, '!3d' + lat,
    '!2m3', '!1f0.0', '!2f0.0', '!3f0.0',
    '!3m2', '!1i1024', '!2i768', '!4f13.1',
    '!12m4', '!2m3', '!1i360', '!2i120', '!4i8',
    '!13m57', '!2m2', '!1i203', '!2i100', '!3m2', '!2i4', '!5b1',
    '!6m6', '!1m2', '!1i86', '!2i86', '!1m2', '!1i408', '!2i240',
    '!7m33',
    '!1m3', '!1e1', '!2b0', '!3e3', '!1m3', '!1e2', '!2b1', '!3e2', '!1m3', '!1e2', '!2b0', '!3e3',
    '!1m3', '!1e8', '!2b0', '!3e3', '!1m3', '!1e10', '!2b0', '!3e3', '!1m3', '!1e10', '!2b1', '!3e2',
    '!1m3', '!1e10', '!2b0', '!3e4', '!1m3', '!1e9', '!2b1', '!3e2', '!2b1', '!9b0',
    '!15m8', '!1m7', '!1m2', '!1m1', '!1e2', '!2m2', '!1i195', '!2i195', '!3i20',
    '!14m3', '!1s' + session, '!7e81', '!15i10112',
    '!15m106',
    '!1m26', '!13m9', '!2b1', '!3b1', '!4b1', '!6i1', '!8b1', '!9b1', '!14b1', '!20b1', '!25b1',
    '!18m15', '!3b1', '!4b1', '!5b1', '!6b1', '!13b1', '!14b1', '!17b1', '!21b1', '!22b1', '!30b1', '!32b1',
    '!33m1', '!1b1', '!34b1', '!36e2', '!10m1', '!8e3', '!11m1', '!3e1', '!17b1',
    '!20m2', '!1e3', '!1e6', '!24b1', '!25b1', '!26b1', '!27b1', '!29b1', '!30m1', '!2b1', '!36b1', '!37b1',
    '!39m3', '!2m2', '!2i1', '!3i1', '!43b1', '!52b1', '!55b1', '!56m1', '!1b1', '!61m2', '!1m1', '!1e1',
    '!65m5', '!3m4', '!1m3', '!1m2', '!1i224', '!2i298',
    '!72m22', '!1m8', '!2b1', '!5b1', '!7b1', '!12m4', '!1b1', '!2b1', '!4m1', '!1e1', '!4b1',
    '!8m10', '!1m6', '!4m1', '!1e1', '!4m1', '!1e3', '!4m1', '!1e4',
    '!3sother_user_google_review_posts__and__hotel_and_vr_partner_review_posts', '!6m1', '!1e1', '!9b1',
    '!89b1', '!90m2', '!1m1', '!1e2',
    '!98m3', '!1b1', '!2b1', '!3b1', '!103b1', '!113b1', '!114m3', '!1b1', '!2m1', '!1b1',
    '!117b1', '!122m1', '!1b1', '!126b1', '!127b1', '!128m1', '!1b0', '!21m0', '!22m1', '!1e81',
    '!30m8', '!3b1', '!6m2', '!1b1', '!2b1', '!7m2', '!1e3', '!2b1', '!9b1',
    '!34m5', '!7b1', '!10b1', '!14b1', '!15m1', '!1b0', '!37i784'
  ].join('');
}

function extractCategoriesNearAddress(payloadText, address) {
  if (!address) return [];
  // Google's internal payload stores the address string as "{Business Name}, {address}"
  // (concatenated), while Places API's formatted_address is just the address — so we match
  // address as a suffix inside the quotes (preceded by arbitrary text), not the whole string.
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('\\[((?:"[^"\\]]*",?)+)\\](?:,null){0,8},"[^"]*' + escaped + '"');
  const m = payloadText.match(re);
  if (!m) return [];
  return m[1].split(',').map(s => s.replace(/^"|"$/g, '')).filter(Boolean);
}

function extractAccessibilityFeatures(payloadText) {
  const matches = payloadText.match(/"(?:Has |No )?[Ww]heelchair accessible [a-z]+"/g) || [];
  const all = [...new Set(matches.map(s => s.replace(/^"|"$/g, '')))];
  // Remove contradicting pairs — when both "Has X" and "No X" exist the data is ambiguous
  return all.filter(f => {
    const opposite = f.startsWith('Has ') ? 'No ' + f.slice(4) : f.startsWith('No ') ? 'Has ' + f.slice(3) : null;
    return !opposite || !all.includes(opposite);
  });
}

// ── Send the real data to Claude for scoring/summarisation ──
async function analyseWithClaude(place, anthropicKey) {
  const prompt = `You are a Google Business Profile auditor. Below is REAL data pulled from the Google Places API for one business. Score and analyse ONLY what is given — do not invent facts, reviews, or business details that aren't present.

The "dataNotAvailable" array in the JSON below lists things the public Places API structurally cannot see for ANY business (owner-written description, review reply behaviour, the full category list, service areas, service/product listings, posting activity). These may well exist on the real profile — their absence here is a data-source limitation, not evidence the business lacks them. Do NOT create "bad" findings, categories, or scores about anything in that list, and do NOT claim or imply the business lacks them. You MAY mention them once, collectively, in the "dataLimitations" field described below — nowhere else.

Two specific traps to avoid:
- "googleTypeTags" is a short list of coarse Google-internal tags, NOT the real category list shown on the live profile. If "liveProfileCategories" is present and non-empty, THAT is the real, live category list from the profile — use and discuss it confidently instead. If "liveProfileCategories" is missing or empty, this means OUR LOOKUP FAILED, NOT that the business has no categories — never say "no subcategories", "categories not populated", "no live category data", or "categories are broad/limited" in that case. Treat it exactly like the other dataNotAvailable items: omit it from findings entirely, mention only collectively in dataLimitations if at all.
- "photoCountReturned" is capped at 10 by the API ("photoCountIsApiCapped" will be true when this happened). If capped, the true count is unknown and could be hundreds — do NOT call it "low" or "insufficient". Only treat the photo count as a real, discussable signal when photoCountIsApiCapped is false (i.e. the count is genuinely below the cap).
- Each review's "text" field was cut short by US (not by the customer) when "textWasTruncatedForBrevityByUs" is true, purely to keep this prompt a reasonable size. Never comment on review length, completeness, "cut off" text, or whether customers write detailed reviews — you are not seeing the real cutoff point, only ours.
- "accessibilityFeatures", when present, is a real list of accessibility attributes from the live profile (e.g. wheelchair access) — discuss it confidently as a real signal.

"selfReported" holds answers the business owner typed in when requesting this audit — NOT independently verified, so treat it as a claim, not a confirmed fact, and say so when you use it:
- "updatesPerMonth" (number or null): if not null, you may now score an "Update Activity" category and discuss posting frequency, framed as "the business reports posting ~N times/month" — don't claim this is independently confirmed.
- "targetKeywords" (string or null): if not null, you may now score a "Keyword Alignment" category assessing whether the website/categories/address support ranking for these self-reported target keywords — frame findings around whether the visible profile data (categories, website, location) plausibly supports these keyword goals. If "keywordRankings" is present in the data, each entry shows the business's actual current position in local Google Maps results when searching that keyword in its area ("searchedAs" shows the exact query used) — use these real local rankings to ground your Keyword Alignment score and findings (localMapsPosition 1-3 = excellent, 4-10 = good, 11-20 = needs work, "Not in top N" = poor; "unavailable" means the check failed — do not treat that as a bad ranking or create findings from it).
- "serviceArea" (string or null): if not null, you may now score a "Service Area Coverage" category, framed around whether the address/categories are consistent with serving that self-reported area — don't claim to have independently verified the actual configured service-area radius on the profile.
For any of the three that ARE null, do not invent or score them — they remain in dataNotAvailable.

Only score and discuss what is directly observed: rating, review count, review text/recency (reviews are pre-sorted newest-first, so the dates you see are accurate), phone, website, hours, business status, photo count (only when not API-capped), liveProfileCategories (when present), accessibilityFeatures (when present), and selfReported fields (when present, framed as self-reported). These are real signals — be specific and confident, while being clear about which are independently verified vs. self-reported.

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
    {"label": "Photo Presence", "score": <0-100; if photoCountIsApiCapped is true, score 70-85 (presence confirmed, true volume unknown) — never score this low just because it hit the cap; if not capped, score based on the actual low count>},
    "<then append {\"label\": \"Update Activity\", \"score\": <0-100>} ONLY if selfReported.updatesPerMonth is not null, append {\"label\": \"Keyword Alignment\", \"score\": <0-100>} ONLY if selfReported.targetKeywords is not null, and append {\"label\": \"Service Area Coverage\", \"score\": <0-100>} ONLY if selfReported.serviceArea is not null — omit any of these three entirely when their field is null, do not include this instruction string itself in your output"
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
  parsed.keywordRankings = place.keywordRankings || null;
  stripUnverifiableFindings(parsed, place);
  return parsed;
}

// Belt-and-braces enforcement: the model sometimes ignores the prompt instruction and turns
// "we can't see this" into a finding anyway (just with softer wording). Strip those out here
// instead of trusting the model to comply, so the UI never shows things like "no description",
// "no review replies", "no subcategories", or "low photo count" (when the count is just the
// API's hard cap of 10) as if they were confirmed facts.
// These can never be verified from any data source this tool has access to.
const ALWAYS_UNVERIFIABLE_PATTERN = /editorial summary|review repl|owner repl|service (and\/or )?product listing|review.*(truncat|cut off|cut short)|truncat.*review|(detailed|complete|full) reviews?/i;
// These become verifiable once the matching selfReported field is supplied.
const UPDATE_ACTIVITY_PATTERN = /google post|update activity|post frequency|post(ing)? activity/i;
const SERVICE_AREA_PATTERN = /service area/i;
const CATEGORY_CLAIM_PATTERN = /subcategor|categor(y|ies) (is|are) (broad|limited|generic)|no specialist|category breadth|categor(y|ies).*not.*populat|no live categor|categor.*not.*currently|live category data|categor(y|ies).*(could not|couldn'?t|cannot|can'?t|unable|not be).*(confirm|verif|retriev|return|check)|category lookup|categor(y|ies).*lookup/i;
const LOW_PHOTO_CLAIM_PATTERN = /photo/i;
const HOURS_PATTERN = /business hours|hours (are|not|missing)|no hours|hours set|opening hours/i;
const REVIEW_RECENCY_PATTERN = /review recency|recency.*confirm|no review text|no.*timestamp|timestamp.*unavailable/i;

function stripUnverifiableFindings(parsed, place) {
  const hasLiveCategories = Array.isArray(place.liveProfileCategories) && place.liveProfileCategories.length > 0;
  const selfReported = place.selfReported || {};
  ['good', 'bad'].forEach(key => {
    if (Array.isArray(parsed[key])) {
      parsed[key] = parsed[key].filter(item => {
        const text = (item.title || '') + ' ' + (item.body || '');
        if (ALWAYS_UNVERIFIABLE_PATTERN.test(text)) return false;
        if (selfReported.updatesPerMonth == null && UPDATE_ACTIVITY_PATTERN.test(text)) return false;
        if (selfReported.serviceArea == null && SERVICE_AREA_PATTERN.test(text)) return false;
        // Only drop category-breadth claims when we genuinely couldn't see the real list —
        // if the live-listing scrape succeeded, these claims are grounded and should stay.
        if (!hasLiveCategories && CATEGORY_CLAIM_PATTERN.test(text)) return false;
        // Photo count is ambiguous (API-capped) — drop any photo-related claim in that case,
        // since we can't tell if the real count is 10 or 10,000.
        if (place.photoCountIsApiCapped && LOW_PHOTO_CLAIM_PATTERN.test(text)) return false;
        // Only trust a "missing hours" finding when our data source actually confirms hours
        // are absent (hasHours === false AND we have hours data at all). Both the Places API
        // and Outscraper frequently omit hours that DO exist on the live profile (especially
        // service-area businesses), so never assert "no hours" unless we're sure.
        if (!place.hasHours && HOURS_PATTERN.test(text)) return false;
        if (place.dataSource === 'outscraper' && REVIEW_RECENCY_PATTERN.test(text)) return false;
        return true;
      });
    }
  });
}
