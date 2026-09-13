// POST /api/admin  { password }
// Checks the admin password server-side (never shipped in client JS) and returns a short-lived token
// that the browser must send back as a Bearer token to read/clear leads.

import crypto from 'crypto';
import { kv } from '@vercel/kv';

// Sliding-window rate limiter backed by Vercel KV. Returns true when the
// caller is over the limit. Fails open (never blocks) if KV is unreachable.
export async function isRateLimited(bucket, ip, maxHits, windowSeconds) {
  try {
    const key = `rl:${bucket}:${ip}`;
    const hits = await kv.incr(key);
    if (hits === 1) await kv.expire(key, windowSeconds);
    return hits > maxHits;
  } catch {
    return false;
  }
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') || req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const SECRET = process.env.ADMIN_TOKEN_SECRET;
  if (!ADMIN_PASSWORD || !SECRET) {
    return res.status(500).json({ error: 'Server is missing ADMIN_PASSWORD / ADMIN_TOKEN_SECRET env vars.' });
  }

  // Brute-force protection: 10 attempts per 15 minutes per IP
  if (await isRateLimited('admin', clientIp(req), 10, 900)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length > 200 || !timingSafeCompare(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const expires = Date.now() + 1000 * 60 * 60 * 4; // 4 hours
  const token = signToken(expires, SECRET);
  return res.status(200).json({ token, expires });
}

function timingSafeCompare(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function signToken(expires, secret) {
  const sig = crypto.createHmac('sha256', secret).update(String(expires)).digest('hex');
  return `${expires}.${sig}`;
}

export function verifyToken(token, secret) {
  try {
    if (!token || typeof token !== 'string') return false;
    const [expiresStr, sig] = token.split('.');
    if (!expiresStr || !sig) return false;
    const expires = Number(expiresStr);
    if (!expires || Date.now() > expires) return false;
    const expectedSig = crypto.createHmac('sha256', secret).update(expiresStr).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
