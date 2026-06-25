# GMBX AI Audit — deploy & setup

## What changed
- `index.html` no longer calls the Anthropic API directly from the browser (that exposed no key and silently fell back to fabricated results). It now calls `/api/audit`.
- `/api/audit.js` looks up the real Google Business Profile via the Google Places API, then asks Claude to score/summarise *that real data* — no invented numbers.
- Email leads are stored via `/api/leads.js` in Vercel KV instead of `window.storage` (which only existed in the preview sandbox and would not work once deployed).
- The admin password check moved server-side (`/api/admin.js`) instead of sitting in plaintext in the page source.

## Deploy steps
1. Push this folder to a GitHub repo, then import it in Vercel ("Add New Project").
2. In the Vercel project: **Storage → Create Database → KV**, then connect it to this project (this sets the `KV_*` env vars automatically).
3. In **Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` — from console.anthropic.com
   - `GOOGLE_PLACES_API_KEY` — from console.cloud.google.com (Places API enabled, key restricted to Places API)
   - `ADMIN_PASSWORD` — whatever password you want for `/admin`
   - `ADMIN_TOKEN_SECRET` — any long random string (used to sign the admin session token)
4. Redeploy.

## Notes / limitations
- The Places API doesn't expose whether a review has an owner reply, so "Review Reply Rate" and a few other categories are scored by Claude as informed estimates from available signals, not hard facts — the prompt tells it to say so explicitly rather than presenting guesses as confirmed data.
- If the Places lookup can't resolve a URL to a real business, the API returns a 404 with a clear message instead of generating a fake audit.
