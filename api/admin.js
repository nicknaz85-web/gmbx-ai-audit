// POST /api/admin  { password }
// Checks the admin password server-side (never shipped in client JS) and returns a short-lived token
// that the browser must send back as a Bearer token to read/clear leads.

import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const SECRET = process.env.ADMIN_TOKEN_SECRET;
  if (!ADMIN_PASSWORD || !SECRET) {
    return res.status(500).json({ error: 'Server is missing ADMIN_PASSWORD / ADMIN_TOKEN_SECRET env vars.' });
  }

  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const expires = Date.now() + 1000 * 60 * 60 * 4; // 4 hours
  const token = signToken(expires, SECRET);
  return res.status(200).json({ token, expires });
}

export function signToken(expires, secret) {
  const sig = crypto.createHmac('sha256', secret).update(String(expires)).digest('hex');
  return `${expires}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const [expiresStr, sig] = token.split('.');
  if (!expiresStr || !sig) return false;
  const expires = Number(expiresStr);
  if (!expires || Date.now() > expires) return false;
  const expectedSig = crypto.createHmac('sha256', secret).update(expiresStr).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
}
