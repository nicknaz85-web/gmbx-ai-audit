// entry-extract.js — infer a venue's real entry/cover price (as a EUR base
// amount) from what Google reviewers actually wrote, so the door price is
// accurate per venue instead of guessed from Google's (drink-cost) price level.
//
// Returns { eur, basedOn, free } or null when reviews give no usable signal.
//   eur     – EUR base amount (0 = free), or null if only a "free" signal
//   basedOn – how many distinct cover mentions backed it
//   free    – true when reviewers explicitly say there's no cover
import { currencyInfo } from './money.js';

// currency hints that can appear in review text, → ISO code used by money.js CUR
const SYMBOL_CUR = { '€': 'EUR', '£': 'GBP', $: null /* ambiguous → use city */ };
const WORD_CUR = [
  [/\beuros?\b|\beur\b/i, 'EUR'], [/\bpounds?\b|\bquid\b|\bgbp\b/i, 'GBP'],
  [/\bdollars?\b|\busd\b|\bbucks?\b/i, 'USD'], [/\bdinars?\b|\brsd\b|\bdin\b/i, 'RSD'],
  [/\bz[łl]\b|\bzloty\b|\bpln\b/i, 'PLN'], [/\bforints?\b|\bhuf\b|\bft\b/i, 'HUF'],
  [/\bkorun[ay]?\b|\bczk\b|\bk[čc]\b/i, 'CZK'], [/\bbaht\b|\bthb\b/i, 'THB'],
  [/\bpesos?\b|\bmxn\b/i, 'MXN'], [/\brupees?\b|\binr\b/i, 'INR'],
  [/\blei\b|\bron\b/i, 'RON'], [/\bkroner?\b|\bkr\b/i, 'DKK'],
];

const FREE_RX = /\b(no cover|no entry fee|no entrance fee|no door (?:charge|fee)|free (?:entry|admission|entrance|to (?:get in|enter))|entry (?:is|was) free|entrance (?:is|was) free|don'?t charge (?:a )?(?:cover|entry))\b/i;
// a number near a cover/entry/door word (either order), optional currency symbol
const AMT_CTX = [
  /(?:cover|entry|entrance|admission|door)(?:\s+(?:charge|fee|price|cost))?(?:\s+(?:of|was|is|:|about|around|approximately))?\s*([€£$])?\s?(\d{1,5})(?:\s*(euros?|pounds?|dollars?|dinars?|pesos?|baht|z[łl]|forints?|lei|kr|rupees?))?/i,
  /([€£$])?\s?(\d{1,5})\s*(euros?|pounds?|dollars?|dinars?|pesos?|baht|z[łl]|forints?|lei|kr|rupees?)?\s*(?:cover|entry|entrance|admission|to get in|to enter|at the door)/i,
];

function curCodeFor(symbol, word, city) {
  if (word) { for (const [rx, code] of WORD_CUR) if (rx.test(word)) return code; }
  if (symbol && SYMBOL_CUR[symbol]) return SYMBOL_CUR[symbol];
  // symbol '$' or nothing → assume the amount is in the venue city's own currency
  return currencyInfo(city).code;
}

// convert a locally-quoted amount to a EUR base amount
function toEur(amount, code) { return amount / (RATE[code] ?? 1); }
// EUR→local rates mirrored from money.js CUR (only what we might parse from text)
const RATE = { EUR: 1, GBP: 0.86, USD: 1.08, RSD: 117, PLN: 4.3, HUF: 395, CZK: 25, THB: 39, MXN: 18.5, INR: 92, RON: 5, DKK: 7.45 };

export function extractEntry(reviews, editorial, city, category) {
  const texts = [];
  if (editorial) texts.push(String(editorial));
  for (const r of reviews || []) if (r && r.text) texts.push(String(r.text));
  if (!texts.length) return null;

  const covers = []; // EUR amounts found in cover context
  let sawFree = false;
  for (const t of texts) {
    if (FREE_RX.test(t)) sawFree = true;
    for (const rx of AMT_CTX) {
      let m; const re = new RegExp(rx.source, 'gi');
      while ((m = re.exec(t))) {
        const symbol = m[1] || null, num = parseInt(m[2], 10), word = m[3] || null;
        if (!isFinite(num)) continue;
        const code = curCodeFor(symbol, word, city);
        const eur = toEur(num, code);
        // plausible door cover: €1–€80; ignore absurd (drink tabs, phone numbers)
        if (eur >= 1 && eur <= 80) covers.push(Math.round(eur));
      }
    }
  }

  if (covers.length) {
    covers.sort((a, b) => a - b);
    const med = covers[Math.floor(covers.length / 2)];
    return { eur: med, basedOn: covers.length, free: false };
  }
  if (sawFree) return { eur: 0, basedOn: 1, free: true };
  // No signal at all: bars/cafés are free by default (people don't mention a
  // cover because there isn't one); leave clubs on their seeded baseline.
  if (category === 'Bars') return { eur: 0, basedOn: 0, free: true };
  return null;
}
