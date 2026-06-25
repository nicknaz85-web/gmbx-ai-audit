// TEMPORARY diagnostic endpoint — reports only true/false for each required env var, never values.
// Delete this file once the missing-keys issue is resolved.
export default function handler(req, res) {
  res.status(200).json({
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    GOOGLE_PLACES_API_KEY: !!process.env.GOOGLE_PLACES_API_KEY,
    ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD,
    ADMIN_TOKEN_SECRET: !!process.env.ADMIN_TOKEN_SECRET,
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    VERCEL_ENV: process.env.VERCEL_ENV || null
  });
}
