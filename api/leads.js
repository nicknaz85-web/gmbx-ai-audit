// /api/leads
//   POST { email, url }           -> save a new lead (called from the audit form, no auth needed)
//   GET  (Authorization: Bearer <token from /api/admin>) -> list all leads
//   DELETE (Authorization: Bearer <token>)                -> clear all leads
//
// Requires a Vercel KV store attached to the project (Storage tab -> Create Database -> KV).

import { kv } from '@vercel/kv';
import { verifyToken } from './admin.js';

const LEADS_KEY = 'gmbx_leads';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { email, url } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    const leads = (await kv.get(LEADS_KEY)) || [];
    leads.unshift({ email, url: url || '', date: new Date().toISOString() });
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
