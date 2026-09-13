// POST /api/rankings  { keywords, name, address, phone, serviceArea }
// Runs the slow Outscraper local-ranking lookup separately from /api/audit so the audit
// can render immediately and the ranking graph fills in a moment later.

import { isRateLimited, clientIp } from './admin.js';
import { fetchKeywordRankings } from './audit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 15 per hour per IP — each lookup hits the paid Outscraper API
  if (await isRateLimited('rankings', clientIp(req), 15, 3600)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const OUTSCRAPER_KEY = process.env.OUTSCRAPER_API_KEY;
  if (!OUTSCRAPER_KEY) {
    return res.status(200).json({ keywordRankings: null });
  }

  const { keywords, name, address, phone, serviceArea } = req.body || {};
  if (!keywords || typeof keywords !== 'string') {
    return res.status(400).json({ error: 'Missing keywords' });
  }

  try {
    const keywordRankings = await fetchKeywordRankings(
      keywords.slice(0, 300),
      typeof name === 'string' ? name : '',
      typeof address === 'string' ? address : '',
      typeof phone === 'string' ? phone : '',
      OUTSCRAPER_KEY,
      typeof serviceArea === 'string' ? serviceArea : ''
    );
    return res.status(200).json({ keywordRankings: keywordRankings || null });
  } catch (e) {
    console.error('rankings error:', e.message);
    return res.status(200).json({ keywordRankings: null });
  }
}
