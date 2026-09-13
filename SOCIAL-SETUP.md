# Social Media Automation — Setup Guide

This replaces the Zapier plan with the same workflow built into your Vercel project.
No Zapier subscription, no OpenAI key — it uses the `ANTHROPIC_API_KEY` you already have.

**The flow:**

```
Google Sheet (Status = Idea)
      ↓  daily cron 07:00 UTC — /api/social?action=generate
Claude writes Caption + Hashtags + an image brief
ChatGPT (gpt-image-1) paints the image → stored in Vercel Blob → Image Link filled
(Status = Generated)
      ↓  YOU review caption + image in the sheet, change Status to Approved
      ↓  daily cron 09:00 UTC — /api/social?action=post
Facebook Page + Instagram Business (Status = Posted, link saved)
```

TikTok rows get captions generated too, but auto-posting isn't possible via Meta's API —
copy those into Metricool / Buffer / the TikTok app (the sheet gets a note reminding you).

---

## Step 1 — Create the Google Sheet

1. Go to [sheets.new](https://sheets.new), name it e.g. **GMBX Social Posts**.
2. Rename the tab at the bottom to **Posts** (or set `SOCIAL_SHEET_TAB` to whatever you call it).
3. Import `social-posts-template.csv` from this repo: **File → Import → Upload → Replace current sheet**.
   That gives you the exact columns the code expects:

   `Client | Platform | Topic | Website | Caption | Hashtags | Image Link | Status | Post Date | Posted Link`

4. Copy the **sheet ID** from the URL — the long string between `/d/` and `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

**Column rules:**
- `Platform` — one platform per row: `Instagram`, `Facebook`, or `TikTok`. Want the same topic on two platforms? Add two rows.
- `Status` — the lifecycle: `Idea` → `Generated` → `Approved` (you set this) → `Posted`. If a row shows `Error: ...`, fix the cause and set it back to `Idea` (or `Approved`) to retry.
- `Image Link` — leave it **empty** and ChatGPT generates an image automatically (step 4). Paste your own public https image URL to override — a hand-filled link always wins. Instagram requires an image either way.
- `Post Date` — optional, format `YYYY-MM-DD`. Empty = post on the next run after approval.

## Step 2 — Google service account (lets the server read/write the sheet)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project (e.g. *gmbx-social*).
2. **APIs & Services → Library** → search **Google Sheets API** → Enable.
3. **IAM & Admin → Service Accounts → Create service account** — name it *sheet-bot*, no roles needed → Done.
4. Open the new service account → **Keys → Add key → Create new key → JSON** → download the file.
5. In the JSON file you need two values:
   - `client_email` → this is `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` (the whole `-----BEGIN PRIVATE KEY-----...` string) → this is `GOOGLE_SERVICE_ACCOUNT_KEY`
6. **Share the Google Sheet with the `client_email` address as Editor** (the Share button, like sharing with a person). Without this the server gets "permission denied".

## Step 3 — Meta (Facebook + Instagram) access

Prerequisites: a **Facebook Page** and an **Instagram Business/Creator account linked to that Page**
(Instagram app → Settings → Business tools → connect the Facebook Page).

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App** → type **Business**.
2. Open **Tools → Graph API Explorer** ([link](https://developers.facebook.com/tools/explorer/)):
   - Select your app.
   - **Add permissions:** `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`.
   - Click **Generate Access Token** and approve, selecting your Page and Instagram account.
3. Make the token long-lived: open the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/), paste the token → **Extend Access Token** (gives ~60 days).
4. Get the **Page token** (Page tokens derived from a long-lived user token don't expire):
   in Graph API Explorer, call `GET /me/accounts` with the extended token. In the response find your Page:
   - `access_token` → this is `META_ACCESS_TOKEN`
   - `id` → this is `META_PAGE_ID`
5. Get the Instagram ID: call `GET /{META_PAGE_ID}?fields=instagram_business_account`.
   - `instagram_business_account.id` → this is `META_IG_USER_ID`

> While the app is in Development mode this works for accounts with a role on the app (you). That's fine for posting to your own/clients' pages you manage; for pages owned by other people's Meta accounts you'd need App Review or Business Manager access.

## Step 4 — AI images (ChatGPT + Vercel Blob)

Two quick pieces — the image model, and somewhere to host the images (Instagram needs a
permanent public URL, and OpenAI's own URLs expire within an hour):

1. **OpenAI key** — go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys),
   create a key → this is `OPENAI_API_KEY`. Add a few pounds of credit at
   Settings → Billing (images cost ~3–4p each).
2. **Vercel Blob** — Vercel dashboard → your project → **Storage → Create Database → Blob**
   → connect it to the project. This automatically adds the `BLOB_READ_WRITE_TOKEN`
   env var — nothing to copy.

If either is missing the pipeline still works: captions are generated, `Image Link` stays
empty, and you fill images by hand.

## Step 5 — Vercel environment variables

Vercel dashboard → your project → **Settings → Environment Variables** (Production):

| Name | Value |
|---|---|
| `SOCIAL_SHEET_ID` | from step 1.4 |
| `SOCIAL_SHEET_TAB` | `Posts` (optional if you kept the name) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | `private_key` from the JSON (paste as-is, `\n` included) |
| `META_ACCESS_TOKEN` | Page access token |
| `META_PAGE_ID` | Facebook Page ID |
| `META_IG_USER_ID` | Instagram Business account ID |
| `OPENAI_API_KEY` | from step 4.1 — enables AI images |
| `CRON_SECRET` | any long random string (e.g. from [generate-secret.vercel.app/32](https://generate-secret.vercel.app/32)) |

(`BLOB_READ_WRITE_TOKEN` was added automatically when you connected the Blob store in step 4.2.)

`ANTHROPIC_API_KEY` is already set from the audit tool.

Then **redeploy** (push to git, or Deployments → Redeploy) so the new endpoint, crons, and env vars go live.

## Step 6 — Test it

1. Make sure the sheet has a few rows with `Status = Idea`.
2. Run the generator manually in your browser:
   `https://YOUR-DOMAIN/api/social?action=generate&key=YOUR_CRON_SECRET`
   → captions, hashtags and an AI image link appear in the sheet, Status flips to `Generated`.
   (Images take ~30s each — with several rows the page can take a few minutes to respond.)
3. Review a row — click the `Image Link` to see the image — then set `Status = Approved`.
4. Run the poster:
   `https://YOUR-DOMAIN/api/social?action=post&key=YOUR_CRON_SECRET`
   → it publishes and writes the live post link into `Posted Link`.

> If the deploy complains about `maxDuration: 300` in `vercel.json` (older projects
> without Fluid compute cap at 60s), lower it to 60 — generation then does ~2 images
> per run and picks up the rest on the next trigger.

## Daily schedule

Two Vercel crons are configured in `vercel.json`:

| Time (UTC) | Endpoint | What it does |
|---|---|---|
| 07:00 | `/api/social?action=generate` | drafts up to 15 `Idea` rows |
| 09:00 | `/api/social?action=post` | publishes due `Approved` rows |

On the Vercel Hobby plan crons run once daily and may fire up to an hour late — that's fine for this.
You can always trigger either action manually with the `&key=` URL from step 5.

## Costs

- **Zapier:** £0 (not used)
- **Claude:** roughly 1–2p per caption
- **ChatGPT images (gpt-image-1):** roughly 3–4p per image
- **Vercel / Blob storage / Google Sheets / Meta APIs:** free at this scale

≈ 5p per fully-generated post — about £1.50/month at one post per day.

## Troubleshooting

- **"Google auth failed"** — the private key was pasted wrong, or the Sheets API isn't enabled.
- **"The caller does not have permission"** — you didn't share the sheet with the service account email (step 2.6).
- **"Error validating access token"** — the Meta token expired or lost permissions; redo step 3.2–3.4.
- **Instagram row shows `Error: Instagram needs an Image Link`** — the AI image step was skipped or failed (check `OPENAI_API_KEY` and the Blob store). Add an image URL by hand, or set the row back to `Idea` to regenerate with an image.
- **Row is `Generated` but `Image Link` is empty** — image generation failed for that row (the caption is kept). Check the OpenAI key has billing credit, or paste an image manually.
- **Don't like the AI image?** Delete the `Image Link`, set Status back to `Idea`, and it regenerates a new caption + image — or paste your own URL and just approve.
- Row stuck with `Error: ...`? Fix the cause, then set Status back to `Idea` (regenerate) or `Approved` (repost).
