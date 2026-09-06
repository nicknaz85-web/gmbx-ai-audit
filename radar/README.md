# 🔴 PARTY RADAR — Live Crowd Intelligence

A self-contained, full-stack nightlife radar. It turns anonymous check-ins, crowd
reports and historical patterns into a live map of *where the night is happening
right now* — rendered in a retro synthwave style, not a generic heatmap.

Zero dependencies. Pure Node (built-in `http`) backend + vanilla JS / Canvas frontend.

## Run it

```bash
node radar/server.js
# → http://localhost:3010
```

(or via the Claude Code preview: launch config **party-radar** in `.claude/launch.json`.)

The demo boots on a simulated **Saturday ~00:50** so the city is always alive.
Set `RADAR_LIVE_CLOCK=1` to use the real wall-clock instead. An ambient
simulation keeps signals flowing; real user actions flow through the same logs
and dominate when present. State snapshots to `radar/.data/` (delete it to reseed).

## What's implemented (mapped to the brief)

| Spec feature | Where |
|---|---|
| **RADAR map layer** — retro glow / pulsing HOT ZONE (not a Google heatmap) | `public/app.js` → `RadarMap` (Canvas) |
| **HOT SCORE** (live activity × reports × owner status) | `lib/scoring.js` → `venueSnapshot` |
| **MOMENTUM** ↓ COOLING → STEADY ↑ HEATING ↑↑ SURGING 🔥 EXPLODING + `+%` | `momentumState()` |
| **REPORT THE VIBE** — <10s flow: vibe→queue→entry→mix→music | `startReport()` / `REPORT_STEPS` |
| **Report confidence** — proximity · corroboration · trust · recency | `lib/reputation.js` → `computeReportConfidence` |
| **Report decay** — smooth exp. relevance, cold reports expire | `lib/util.js` → `decayWeight` / `isFresh` |
| **Check-ins** (I'M HERE) + anti-abuse (dup / GPS / rate / device cluster) | `screenCheckin` |
| **QUICK PULSE** (still popping?) | `/api/pulse` + venue card |
| **LIVE CROWD COUNTER** — "N recent signals" (never "N inside") | `recentSignals` |
| **NEARBY ACTIVITY / clusters / HOT ZONE** (venues within 400 m rising) | `nearbyActivity` / `clusters` |
| **AREA / neighbourhood NIGHT SCORE** | `areaSnapshot` |
| **RADAR FEED** — live transition events | `detectTransitions` / `radarFeed` |
| **TREND PREDICTION / FORECAST** + expected peak | `venueForecast` |
| **SHOULD I GO?** — rules-based GO NOW / WAIT / YOUR CALL | `shouldIGo` |
| **PARTY RADAR SCORE** — flagship composite of all of the above | `partyRadarScore` |
| **Reputation & subtle badges** (Night Scout, Local, First on Scene…) | `refreshBadges` |
| **VENUE UPDATE / COMMUNITY / ESTIMATE** source tags | `source` field + UI chips |
| **Privacy** — everything aggregated, salted anon hashes, no individual movement | `anonHash`, no user id ever returned |
| **Friend signals** | intentionally *not* in MVP (privacy) — architecture leaves room |

## Architecture

```
radar/
  server.js          zero-dep HTTP server: static + JSON API + boots simulation
  lib/
    util.js          geo (haversine), decay, anon hashing, demo night-clock
    store.js         in-memory signal logs + JSON snapshot persistence + prune
    seed.js          neighbourhoods + venues w/ historical baselines + backfill
    reputation.js    trust, report confidence, anti-abuse, badges (all hidden)
    scoring.js       ALL derived intelligence (computed on read, always fresh)
    simulate.js      ambient nightlife tick + feed growth
  public/
    index.html · styles.css · app.js   retro Canvas radar SPA
```

**Design principle:** nothing derived is stored. Every score is computed on read
from the append-only signal logs, so all numbers are always live and always
reflect time-decay. Storage stays dumb; intelligence lives in `scoring.js`.

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/state` | Everything the map + lists need (venues, areas, clusters, feed) |
| GET | `/api/venue/:id` | Full venue detail (radar score, forecast, decision…) |
| GET | `/api/area/:id` | Neighbourhood detail + ranked venues |
| GET | `/api/feed` | Radar feed |
| GET | `/api/me` | The signed-in anon user's own badges |
| POST | `/api/checkin` | `{venueId, coords?}` — anti-abuse screened |
| POST | `/api/report` | `{venueId, vibe, queue, entry, mix, music, coords?}` |
| POST | `/api/pulse` | `{venueId, state}` quick pulse |
| POST | `/api/owner/update` | Verified-venue live status (demo: gated on `verified`) |

Identity is an anonymous, non-reversible salted hash from a first-party cookie —
used only for reputation and anti-abuse. No raw identifier is ever stored or returned.
