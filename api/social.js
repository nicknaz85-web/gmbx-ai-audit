// GET/POST /api/social?action=generate | post
//
// Social media automation pipeline driven by a Google Sheet (no Zapier needed):
//   1. You add rows with Status = "Idea"  (Client | Platform | Topic | Website | ... )
//   2. ?action=generate  → Claude writes Caption + Hashtags, sets Status = "Generated"
//   3. You review in the sheet and set Status = "Approved"  (your safety step)
//   4. ?action=post      → publishes Approved rows to Facebook Pages / Instagram
//      Business via the Meta Graph API, sets Status = "Posted" + Posted Link.
//      TikTok rows are generated but never auto-posted (copy into Metricool/Buffer).
//
// Sheet columns (row 1 is the header, data starts at row 2):
//   A Client | B Platform | C Topic | D Website | E Caption | F Hashtags
//   G Image Link | H Status | I Post Date (YYYY-MM-DD) | J Posted Link
//
// If a row's Image Link is empty, ChatGPT's image model (gpt-image-1) generates
// one from a brief Claude writes, and the image is stored in Vercel Blob so
// Instagram gets a permanent public URL. A hand-pasted Image Link always wins.
//
// Env vars required (Vercel project settings):
//   ANTHROPIC_API_KEY              (already set — used by the audit tool)
//   OPENAI_API_KEY                 for AI image generation (optional — skipped if unset)
//   BLOB_READ_WRITE_TOKEN          auto-set when you add a Blob store to the project
//   CRON_SECRET                    protects this endpoint; Vercel crons send it
//   SOCIAL_SHEET_ID                the ID from the sheet URL
//   SOCIAL_SHEET_TAB               optional, defaults to "Posts"
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   service account with the sheet shared to it
//   GOOGLE_SERVICE_ACCOUNT_KEY     the service account's PEM private key
//   META_ACCESS_TOKEN              long-lived Facebook Page access token
//   META_PAGE_ID                   Facebook Page ID
//   META_IG_USER_ID                Instagram Business account ID linked to the page

import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { put } from '@vercel/blob';

const GRAPH = 'https://graph.facebook.com/v23.0';
const MAX_ROWS_PER_RUN = 15;    // caption generations per invocation
const TIME_BUDGET_MS = 250_000; // stay under the 300s function limit (images are slow)

const COL = { client: 0, platform: 1, topic: 2, website: 3, caption: 4, hashtags: 5, image: 6, status: 7, postDate: 8, postedLink: 9 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  const key = String(req.query?.key || '');
  if (!secret || (authHeader !== `Bearer ${secret}` && key !== secret)) {
    return res.status(401).json({ error: 'Unauthorized. Pass ?key=<CRON_SECRET> or set the Authorization header.' });
  }

  const missing = ['SOCIAL_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY']
    .filter(k => !process.env[k]);
  if (missing.length) {
    return res.status(500).json({ error: `Missing env vars: ${missing.join(', ')}. See SOCIAL-SETUP.md.` });
  }

  const action = String(req.query?.action || '');
  try {
    if (action === 'generate') return res.status(200).json(await runGenerate());
    if (action === 'post') return res.status(200).json(await runPost());
    return res.status(400).json({ error: 'Use ?action=generate or ?action=post' });
  } catch (err) {
    console.error('social error:', err);
    return res.status(502).json({ error: err.message || 'Social automation failed' });
  }
}

// ── Step 2: turn "Idea" rows into drafted posts ──
async function runGenerate() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const started = Date.now();
  const { token, tab, rows } = await readSheet();

  const ideas = rows
    .map((cells, i) => ({ cells, rowNum: i + 2 }))
    .filter(r => norm(r.cells[COL.status]) === 'idea' && (r.cells[COL.topic] || '').trim())
    .slice(0, MAX_ROWS_PER_RUN);

  const results = [];
  // Small concurrent batches: image generation is the slow part (~20-40s each),
  // so keep batches at 2 and let the time guard stop before the function limit
  for (let i = 0; i < ideas.length; i += 2) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const batch = ideas.slice(i, i + 2);
    const settled = await Promise.allSettled(batch.map(r => generateRow(r, rows)));
    for (let j = 0; j < batch.length; j++) {
      const row = batch[j];
      const outcome = settled[j];
      if (outcome.status === 'fulfilled') {
        const updates = [
          { range: cellRange(tab, 'E', row.rowNum, 'F'), values: [[outcome.value.caption, outcome.value.hashtags]] },
          { range: cellRange(tab, 'H', row.rowNum), values: [['Generated']] }
        ];
        if (outcome.value.imageUrl) {
          updates.push({ range: cellRange(tab, 'G', row.rowNum), values: [[outcome.value.imageUrl]] });
        }
        await writeCells(token, tab, updates);
        results.push({ row: row.rowNum, client: row.cells[COL.client], status: 'Generated', image: outcome.value.imageUrl || row.cells[COL.image] || 'none' });
      } else {
        const msg = (outcome.reason?.message || 'unknown error').slice(0, 90);
        await writeCells(token, tab, [{ range: cellRange(tab, 'H', row.rowNum), values: [[`Error: ${msg}`]] }])
          .catch(() => {});
        results.push({ row: row.rowNum, client: row.cells[COL.client], status: 'Error', error: msg });
      }
    }
  }

  return { action: 'generate', found: ideas.length, processed: results.length, results };
}

async function generateRow({ cells }, allRows) {
  const client = (cells[COL.client] || '').trim();
  const platform = (cells[COL.platform] || 'Instagram').trim();
  const topic = (cells[COL.topic] || '').trim();
  const website = (cells[COL.website] || '').trim();

  // Recent captions for this client so the model doesn't repeat itself
  const recent = allRows
    .filter(r => norm(r[COL.client]) === norm(client) && (r[COL.caption] || '').trim())
    .slice(-3)
    .map((r, i) => `${i + 1}. ${r[COL.caption].slice(0, 200)}`)
    .join('\n');

  const prompt = `You write social media posts for local businesses. Create ONE unique ${platform} post.

Business: ${client}
Website: ${website || 'not provided'}
Platform: ${platform}
Topic: ${topic}

Rules:
- Engaging and specific to the topic — no generic filler, no repeating past angles.
- Include one clear call to action (visit, book, call, message, or leave a review).
- Match the platform: Instagram/Facebook captions conversational and skimmable (short paragraphs or line breaks, under 1500 characters); TikTok captions punchy and under 150 characters.
- Mention the website naturally only if it fits.
- "caption" must NOT contain hashtags. "hashtags" is a single space-separated string of 6-12 relevant hashtags (mix of local/niche/broad).
- "image_prompt" is a brief for an AI image generator: one concrete, photorealistic scene that matches the post (subject, setting, mood, lighting). Real-life photography style, no text, no words, no logos, no watermarks in the image.${recent ? `\n\nDo NOT reuse the angles or openers from these recent posts for this business:\n${recent}` : ''}`;

  const anthropic = new Anthropic();
  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { caption: { type: 'string' }, hashtags: { type: 'string' }, image_prompt: { type: 'string' } },
          required: ['caption', 'hashtags', 'image_prompt'],
          additionalProperties: false
        }
      }
    },
    messages: [{ role: 'user', content: prompt }]
  });

  const text = msg.content.find(b => b.type === 'text')?.text || '';
  const parsed = JSON.parse(text);
  if (!parsed.caption) throw new Error('Model returned an empty caption');

  // AI image: only when the row has no hand-pasted Image Link, image gen is
  // configured, and the platform actually posts images (TikTok is video-first)
  const hasOwnImage = (cells[COL.image] || '').trim();
  const canGenerate = process.env.OPENAI_API_KEY && process.env.BLOB_READ_WRITE_TOKEN;
  if (!hasOwnImage && canGenerate && !norm(platform).includes('tiktok')) {
    try {
      parsed.imageUrl = await generateImage(parsed.image_prompt, client);
    } catch (err) {
      // No image is not fatal — the caption still lands, image can be added by hand
      console.error(`image generation failed for ${client}:`, err.message);
    }
  }
  return parsed;
}

// ── ChatGPT image model (gpt-image-1) → permanent public URL in Vercel Blob ──
async function generateImage(imagePrompt, client) {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: imagePrompt,
      size: '1024x1024',
      quality: 'medium'
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || `OpenAI image error (${r.status})`);

  // gpt-image-1 returns base64; Instagram needs a URL Meta can fetch any time,
  // so store it in Vercel Blob rather than relying on a temporary OpenAI URL
  const buffer = Buffer.from(data.data[0].b64_json, 'base64');
  const safeName = norm(client).replace(/[^a-z0-9]+/g, '-') || 'post';
  const blob = await put(`social/${safeName}-${Date.now()}.png`, buffer, {
    access: 'public',
    contentType: 'image/png'
  });
  return blob.url;
}

// ── Step 4: publish "Approved" rows that are due ──
async function runPost() {
  const { token, tab, rows } = await readSheet();
  const today = new Date(); today.setHours(23, 59, 59, 999);

  const due = rows
    .map((cells, i) => ({ cells, rowNum: i + 2 }))
    .filter(r => norm(r.cells[COL.status]) === 'approved' && isDue(r.cells[COL.postDate], today));

  const results = [];
  for (const row of due) {
    const platform = norm(row.cells[COL.platform]);
    const caption = (row.cells[COL.caption] || '').trim();
    const hashtags = (row.cells[COL.hashtags] || '').trim();
    const image = (row.cells[COL.image] || '').trim();
    const message = hashtags ? `${caption}\n\n${hashtags}` : caption;

    if (platform.includes('tiktok')) {
      // Meta's API doesn't cover TikTok — flag it in the sheet and move on
      await writeCells(token, tab, [{ range: cellRange(tab, 'J', row.rowNum), values: [['TikTok: post manually or via Metricool/Buffer']] }]).catch(() => {});
      results.push({ row: row.rowNum, platform: 'tiktok', status: 'Skipped (manual)' });
      continue;
    }

    try {
      let link;
      if (platform.includes('instagram')) {
        link = await postToInstagram(message, image);
      } else if (platform.includes('facebook')) {
        link = await postToFacebook(message, image);
      } else {
        throw new Error(`Unknown platform "${row.cells[COL.platform]}"`);
      }
      await writeCells(token, tab, [
        { range: cellRange(tab, 'H', row.rowNum), values: [['Posted']] },
        { range: cellRange(tab, 'J', row.rowNum), values: [[link]] }
      ]);
      results.push({ row: row.rowNum, platform, status: 'Posted', link });
    } catch (err) {
      const msg = (err.message || 'unknown error').slice(0, 90);
      await writeCells(token, tab, [{ range: cellRange(tab, 'H', row.rowNum), values: [[`Error: ${msg}`]] }]).catch(() => {});
      results.push({ row: row.rowNum, platform, status: 'Error', error: msg });
    }
  }

  return { action: 'post', found: due.length, results };
}

function isDue(postDate, cutoff) {
  const raw = (postDate || '').trim();
  if (!raw) return true;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return true; // unreadable date → treat as due, don't strand the row
  return d <= cutoff;
}

async function postToFacebook(message, imageUrl) {
  const { META_ACCESS_TOKEN, META_PAGE_ID } = process.env;
  if (!META_ACCESS_TOKEN || !META_PAGE_ID) throw new Error('Set META_ACCESS_TOKEN and META_PAGE_ID');

  const endpoint = imageUrl ? `${GRAPH}/${META_PAGE_ID}/photos` : `${GRAPH}/${META_PAGE_ID}/feed`;
  const body = new URLSearchParams({ access_token: META_ACCESS_TOKEN });
  if (imageUrl) { body.set('url', imageUrl); body.set('message', message); }
  else body.set('message', message);

  const data = await graphCall(endpoint, body);
  const postId = data.post_id || data.id;
  return `https://www.facebook.com/${postId}`;
}

async function postToInstagram(caption, imageUrl) {
  const { META_ACCESS_TOKEN, META_IG_USER_ID } = process.env;
  if (!META_ACCESS_TOKEN || !META_IG_USER_ID) throw new Error('Set META_ACCESS_TOKEN and META_IG_USER_ID');
  if (!imageUrl) throw new Error('Instagram needs an Image Link (a public https image URL)');

  // Two-step publish: create a media container, then publish it
  const container = await graphCall(`${GRAPH}/${META_IG_USER_ID}/media`, new URLSearchParams({
    image_url: imageUrl, caption, access_token: META_ACCESS_TOKEN
  }));
  const published = await graphCall(`${GRAPH}/${META_IG_USER_ID}/media_publish`, new URLSearchParams({
    creation_id: container.id, access_token: META_ACCESS_TOKEN
  }));

  const permalink = await fetch(`${GRAPH}/${published.id}?fields=permalink&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`)
    .then(r => r.json()).then(d => d.permalink).catch(() => null);
  return permalink || `https://www.instagram.com/ (media ${published.id})`;
}

async function graphCall(url, body) {
  const r = await fetch(url, { method: 'POST', body });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error?.message || `Meta API error (${r.status})`);
  return data;
}

// ── Google Sheets access via service-account JWT (no extra dependencies) ──
async function readSheet() {
  const token = await googleAccessToken();
  const tab = process.env.SOCIAL_SHEET_TAB || 'Posts';
  const id = process.env.SOCIAL_SHEET_ID;
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${tab}!A2:J1000`)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || `Sheets read failed (${r.status})`);
  return { token, tab, rows: data.values || [] };
}

async function writeCells(token, tab, updates) {
  const id = process.env.SOCIAL_SHEET_ID;
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: updates })
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error?.message || `Sheets write failed (${r.status})`);
  }
}

async function googleAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Vercel env vars store the PEM with literal \n — restore real newlines
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error(data.error_description || 'Google auth failed — check the service account email/key');
  return data.access_token;
}

function cellRange(tab, colStart, row, colEnd) {
  return colEnd ? `${tab}!${colStart}${row}:${colEnd}${row}` : `${tab}!${colStart}${row}`;
}

function norm(s) { return (s || '').trim().toLowerCase(); }
