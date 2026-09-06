// baked-hours.js — real weekly opening-hours schedules from Google Places,
// baked in so the app knows exactly when each venue is open. Open/closed is
// computed LIVE from these weekly periods + the city timezone (see hours.js),
// so it stays correct at any hour — unlike a frozen openNow snapshot.
//
// Shape: { [venueId]: { periods: [{ open:{day,hour,minute}, close:{day,hour,minute} }...],
//                       businessStatus: 'OPERATIONAL' } }
// `day` is 0=Sunday..6=Saturday in the venue's LOCAL time (Google's convention).
// An entry with an empty `periods` array + businessStatus 'OPERATIONAL' means the
// place is effectively open 24/7 (Google returns no periods for always-open spots).
//
// Filled in batches by scripts/bake-hours.js (Google's free tier caps GetPlace at
// ~100/day, so this grows over several runs).
export const BAKED_HOURS = {};
