// /api/leads
//   POST { email, url }           -> save a new lead (called from the audit form, no auth needed)
//   GET  (Authorization: Bearer <token from /api/admin>) -> list all leads
//   DELETE (Authorization: Bearer <token>)                -> clear all leads
//
// Requires a Vercel KV store attached to the project (Storage tab -> Create Database -> KV).

import { kv } from '@vercel/kv';
import { verifyToken, isRateLimited, clientIp } from './admin.js';

const LEADS_KEY = 'gmbx_leads';
const MAX_LEADS = 5000;

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // 10 submissions per hour per IP — stops spam flooding the lead list
    if (await isRateLimited('leads', clientIp(req), 10, 3600)) {
      return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
    }
    const { email, url, phone, source } = req.body || {};
    const emailOk = typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const phoneClean = (typeof phone === 'string' ? phone : '').replace(/[^\d+() \-]/g, '').trim().slice(0, 25);
    // A lead needs at least one way to contact them
    if (!emailOk && phoneClean.length < 7) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    const leads = (await kv.get(LEADS_KEY)) || [];
    leads.unshift({
      email: emailOk ? email : '',
      phone: phoneClean || '',
      source: (typeof source === 'string' ? source : '').slice(0, 40),
      url: (typeof url === 'string' ? url : '').slice(0, 500),
      date: new Date().toISOString()
    });
    if (leads.length > MAX_LEADS) leads.length = MAX_LEADS;
    await kv.set(LEADS_KEY, leads);
    return res.status(200).json({ ok: true });
  }

  // GET / DELETE require an admin token
  const SECRET = process.env.ADMIN_TOKEN_SECRET;
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!SECRET || !verifyToken(token, SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    const leads = (await kv.get(LEADS_KEY)) || [];
    return res.status(200).json({ leads });
  }

  if (req.method === 'DELETE') {
    await kv.set(LEADS_KEY, []);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
