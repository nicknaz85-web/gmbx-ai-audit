// reviews.js — turn a venue's Google reviews into a short, honest pros & cons.
// Google returns up to 5 review texts + an editorial blurb; we tag each review
// sentence by aspect (music, staff, price…) and polarity, then surface the
// aspects people consistently praise or complain about. Heuristic, not an LLM,
// so it stays cheap and offline — but it reflects what the reviews actually say.

const POS = ['amazing', 'great', 'awesome', 'brilliant', 'fantastic', 'best', 'love', 'loved',
  'excellent', 'perfect', 'incredible', 'friendly', 'clean', 'worth', 'recommend', 'superb',
  'nice', 'epic', 'unreal', 'good', 'on point', 'top', 'fun', 'welcoming', 'smooth', 'quick'];
const NEG = ['bad', 'terrible', 'awful', 'worst', 'rude', 'dirty', 'expensive', 'pricey',
  'overpriced', 'slow', 'crowded', 'packed', 'rip off', 'ripoff', 'avoid', 'disappointing',
  'disappointed', 'poor', 'small', 'waited', 'scam', 'aggressive', 'mediocre', 'meh',
  'long queue', 'long wait', 'too long', 'not worth', 'horrible', 'unfriendly', 'cramped'];

// aspect -> keywords, plus the human phrase to show for a positive / negative lean
const ASPECTS = {
  music:   { kw: ['music', 'dj', 'djs', 'sound', 'soundsystem', 'sound system', 'bass', 'tunes', 'lineup', 'line-up', 'set', 'beats'], pro: 'Great music & sound', con: 'Music / sound let it down' },
  vibe:    { kw: ['atmosphere', 'vibe', 'vibes', 'energy', 'ambience', 'ambiance', 'mood'], pro: 'Amazing atmosphere', con: 'Atmosphere fell flat' },
  staff:   { kw: ['staff', 'service', 'bartender', 'bartenders', 'bar staff', 'waiter', 'waitress', 'team'], pro: 'Friendly staff', con: 'Service issues' },
  door:    { kw: ['security', 'bouncer', 'bouncers', 'door', 'door policy', 'doorman'], pro: 'Smooth entry & security', con: 'Strict / rude door staff' },
  drinks:  { kw: ['drink', 'drinks', 'cocktail', 'cocktails', 'beer', 'wine', 'shots'], pro: 'Good drinks', con: 'Drinks disappointed' },
  price:   { kw: ['price', 'prices', 'pricey', 'expensive', 'cheap', 'cost', 'overpriced', 'value', 'entry fee', 'rip off', 'ripoff', 'worth'], pro: 'Good value', con: 'Pricey drinks / entry' },
  crowd:   { kw: ['crowd', 'crowded', 'packed', 'busy', 'people', 'cramped'], pro: 'Great crowd', con: 'Gets very crowded' },
  queue:   { kw: ['queue', 'queues', 'line', 'wait', 'waiting', 'waited'], pro: 'Quick to get in', con: 'Long queues' },
  venue:   { kw: ['venue', 'space', 'room', 'rooms', 'decor', 'toilets', 'bathroom', 'bathrooms', 'layout', 'terrace', 'rooftop'], pro: 'Great space', con: 'Venue / facilities lacking' },
};

const has = (text, words) => words.some((w) => text.includes(w));

// classify one clause for one aspect: +1 praise, -1 complaint, 0 unclear
function polarity(clause, reviewRating) {
  const pos = has(clause, POS), neg = has(clause, NEG);
  if (pos && !neg) return 1;
  if (neg && !pos) return -1;
  if (pos && neg) return 0;
  // no sentiment words in the clause — lean on the star rating
  if (reviewRating >= 4) return 1;
  if (reviewRating <= 2) return -1;
  return 0;
}

// reviews: [{ rating, text }]  ·  editorial: Google's one-line blurb (optional)
export function summarizeReviews(reviews, editorial) {
  const list = (reviews || []).filter((r) => r && r.text);
  if (!list.length) return editorial ? { summary: editorial, pros: [], cons: [] } : null;

  const tally = {}; // aspect -> net score
  for (const r of list) {
    const text = String(r.text).toLowerCase();
    const clauses = text.split(/[.!?;\n]+/);
    for (const clause of clauses) {
      if (clause.trim().length < 3) continue;
      for (const [key, a] of Object.entries(ASPECTS)) {
        if (!has(clause, a.kw)) continue;
        tally[key] = (tally[key] || 0) + polarity(clause, r.rating || 0);
      }
    }
  }

  const pros = [], cons = [];
  for (const [key, score] of Object.entries(tally)) {
    if (score > 0) pros.push({ key, phrase: ASPECTS[key].pro, weight: score });
    else if (score < 0) cons.push({ key, phrase: ASPECTS[key].con, weight: -score });
  }
  pros.sort((a, b) => b.weight - a.weight);
  cons.sort((a, b) => b.weight - a.weight);

  return {
    summary: editorial || null,
    pros: pros.slice(0, 4).map((p) => p.phrase),
    cons: cons.slice(0, 4).map((c) => c.phrase),
    dress: dressFromText((editorial || '') + ' ' + list.map((r) => r.text).join(' ')),
    basedOn: list.length,
  };
}

// Sniff a dress code out of the review / editorial text. Returns {code, tip} or
// null when nothing is said (the caller then falls back to a venue-type guess).
function dressFromText(raw) {
  const t = ' ' + String(raw).toLowerCase() + ' ';
  const has = (re) => re.test(t);
  if (has(/\b(beach club|pool party|swimwear|bikini|beachwear|by the pool)\b/))
    return { code: 'Beach & resort', tip: 'Beachwear by day, light resort style by night.' };
  if (has(/\b(dress to impress|smart casual|no sportswear|no trainers|no sneakers|no shorts|no tracksuit|collared|well dressed|dress code|face control|strict door|elegant|upscale|classy|no flip)\b/))
    return { code: 'Dress to impress', tip: 'Smart & stylish — skip sportswear, trainers and shorts; the door can be picky.' };
  if (has(/\b(all black|wear black|dark clothes|black clothes|techno|underground|no dress code|anything goes|come as you are|whatever you want)\b/))
    return { code: 'Casual / all-black', tip: 'Anything goes — dark, casual clothes fit the underground vibe.' };
  return null;
}
