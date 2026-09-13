import type { Exchange } from "@/types";
import { REVOLUT_ENTRIES } from "./revolutUniverse";

/* A curated universe of real, publicly-traded companies spanning mega-cap to
   micro-cap. Base prices are approximate anchors; the deterministic generators
   derive quotes, fundamentals and history from these seeds so every ticker in
   the app resolves to internally-consistent data. This is the ONLY place that
   hard-codes company identity — quantitative data is synthesised, never faked
   per-field. Swap this list for a provider's symbol endpoint in production. */

export interface UniverseEntry {
  ticker: string;
  name: string;
  exchange: Exchange;
  sector: string;
  industry: string;
  country: string;
  hq: string;
  base: number; // anchor price
  cap: number; // anchor market cap
  founded: number;
  employees: number;
  ceo: string;
  logoBg: string;
  profitable: boolean;
  tags: string[]; // discovery buckets
}

// Deterministic tint per company for the monogram tile (no external logos in dev).
const C = {
  slate: "#39424f", indigo: "#3b3f7a", teal: "#1f5b57", green: "#26543a",
  amber: "#6b5322", red: "#6b2e30", plum: "#4a2f52", steel: "#2f4a5e",
  clay: "#5e3f2e", moss: "#3c4a2a", ink: "#2b303a", rose: "#5c2f42",
};

// Richly-detailed, hand-authored entries. These take precedence over the broad
// bulk list for any shared ticker.
const CURATED: UniverseEntry[] = [
  { ticker: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", sector: "Technology", industry: "Consumer Electronics", country: "United States", hq: "Cupertino, CA", base: 227.4, cap: 3.42e12, founded: 1976, employees: 164000, ceo: "Tim Cook", logoBg: C.slate, profitable: true, tags: ["mega", "tech", "trending"] },
  { ticker: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ", sector: "Technology", industry: "Software—Infrastructure", country: "United States", hq: "Redmond, WA", base: 438.1, cap: 3.26e12, founded: 1975, employees: 221000, ceo: "Satya Nadella", logoBg: C.teal, profitable: true, tags: ["mega", "tech", "ai"] },
  { ticker: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", sector: "Technology", industry: "Semiconductors", country: "United States", hq: "Santa Clara, CA", base: 118.6, cap: 2.92e12, founded: 1993, employees: 29600, ceo: "Jensen Huang", logoBg: C.green, profitable: true, tags: ["mega", "tech", "ai", "trending", "semis"] },
  { ticker: "AMZN", name: "Amazon.com, Inc.", exchange: "NASDAQ", sector: "Consumer Cyclical", industry: "Internet Retail", country: "United States", hq: "Seattle, WA", base: 197.3, cap: 2.06e12, founded: 1994, employees: 1551000, ceo: "Andy Jassy", logoBg: C.amber, profitable: true, tags: ["mega", "tech", "trending"] },
  { ticker: "GOOGL", name: "Alphabet Inc.", exchange: "NASDAQ", sector: "Communication Services", industry: "Internet Content & Information", country: "United States", hq: "Mountain View, CA", base: 168.4, cap: 2.05e12, founded: 1998, employees: 182000, ceo: "Sundar Pichai", logoBg: C.steel, profitable: true, tags: ["mega", "tech", "ai"] },
  { ticker: "META", name: "Meta Platforms, Inc.", exchange: "NASDAQ", sector: "Communication Services", industry: "Internet Content & Information", country: "United States", hq: "Menlo Park, CA", base: 563.2, cap: 1.43e12, founded: 2004, employees: 70799, ceo: "Mark Zuckerberg", logoBg: C.indigo, profitable: true, tags: ["mega", "tech", "ai"] },
  { ticker: "TSLA", name: "Tesla, Inc.", exchange: "NASDAQ", sector: "Consumer Cyclical", industry: "Auto Manufacturers", country: "United States", hq: "Austin, TX", base: 248.5, cap: 7.94e11, founded: 2003, employees: 140473, ceo: "Elon Musk", logoBg: C.red, profitable: true, tags: ["mega", "trending", "ev"] },
  { ticker: "AMD", name: "Advanced Micro Devices, Inc.", exchange: "NASDAQ", sector: "Technology", industry: "Semiconductors", country: "United States", hq: "Santa Clara, CA", base: 158.7, cap: 2.57e11, founded: 1969, employees: 26000, ceo: "Lisa Su", logoBg: C.moss, profitable: true, tags: ["large", "tech", "semis", "ai"] },
  { ticker: "AVGO", name: "Broadcom Inc.", exchange: "NASDAQ", sector: "Technology", industry: "Semiconductors", country: "United States", hq: "Palo Alto, CA", base: 168.9, cap: 7.88e11, founded: 1961, employees: 20000, ceo: "Hock Tan", logoBg: C.red, profitable: true, tags: ["large", "tech", "semis", "ai"] },
  { ticker: "INTC", name: "Intel Corporation", exchange: "NASDAQ", sector: "Technology", industry: "Semiconductors", country: "United States", hq: "Santa Clara, CA", base: 21.4, cap: 9.1e10, founded: 1968, employees: 124800, ceo: "Pat Gelsinger", logoBg: C.steel, profitable: false, tags: ["large", "tech", "semis"] },
  { ticker: "JPM", name: "JPMorgan Chase & Co.", exchange: "NYSE", sector: "Financial Services", industry: "Banks—Diversified", country: "United States", hq: "New York, NY", base: 224.6, cap: 6.36e11, founded: 1799, employees: 309926, ceo: "Jamie Dimon", logoBg: C.slate, profitable: true, tags: ["mega", "financials"] },
  { ticker: "V", name: "Visa Inc.", exchange: "NYSE", sector: "Financial Services", industry: "Credit Services", country: "United States", hq: "San Francisco, CA", base: 289.1, cap: 5.6e11, founded: 1958, employees: 28800, ceo: "Ryan McInerney", logoBg: C.indigo, profitable: true, tags: ["mega", "financials"] },
  { ticker: "JNJ", name: "Johnson & Johnson", exchange: "NYSE", sector: "Healthcare", industry: "Drug Manufacturers—General", country: "United States", hq: "New Brunswick, NJ", base: 162.3, cap: 3.9e11, founded: 1886, employees: 131900, ceo: "Joaquin Duato", logoBg: C.red, profitable: true, tags: ["mega", "healthcare"] },
  { ticker: "WMT", name: "Walmart Inc.", exchange: "NYSE", sector: "Consumer Defensive", industry: "Discount Stores", country: "United States", hq: "Bentonville, AR", base: 80.2, cap: 6.45e11, founded: 1962, employees: 2100000, ceo: "Doug McMillon", logoBg: C.steel, profitable: true, tags: ["mega", "consumer"] },
  { ticker: "XOM", name: "Exxon Mobil Corporation", exchange: "NYSE", sector: "Energy", industry: "Oil & Gas Integrated", country: "United States", hq: "Spring, TX", base: 118.4, cap: 5.2e11, founded: 1870, employees: 61500, ceo: "Darren Woods", logoBg: C.red, profitable: true, tags: ["mega", "energy"] },
  { ticker: "KO", name: "The Coca-Cola Company", exchange: "NYSE", sector: "Consumer Defensive", industry: "Beverages—Non-Alcoholic", country: "United States", hq: "Atlanta, GA", base: 71.8, cap: 3.09e11, founded: 1886, employees: 79100, ceo: "James Quincey", logoBg: C.red, profitable: true, tags: ["mega", "consumer"] },
  { ticker: "DIS", name: "The Walt Disney Company", exchange: "NYSE", sector: "Communication Services", industry: "Entertainment", country: "United States", hq: "Burbank, CA", base: 96.3, cap: 1.75e11, founded: 1923, employees: 225000, ceo: "Robert Iger", logoBg: C.indigo, profitable: true, tags: ["large", "media"] },
  { ticker: "NFLX", name: "Netflix, Inc.", exchange: "NASDAQ", sector: "Communication Services", industry: "Entertainment", country: "United States", hq: "Los Gatos, CA", base: 712.5, cap: 3.05e11, founded: 1997, employees: 13000, ceo: "Ted Sarandos", logoBg: C.red, profitable: true, tags: ["large", "media", "tech"] },
  { ticker: "CRM", name: "Salesforce, Inc.", exchange: "NYSE", sector: "Technology", industry: "Software—Application", country: "United States", hq: "San Francisco, CA", base: 264.8, cap: 2.55e11, founded: 1999, employees: 72682, ceo: "Marc Benioff", logoBg: C.steel, profitable: true, tags: ["large", "tech", "ai"] },
  { ticker: "PLTR", name: "Palantir Technologies Inc.", exchange: "NASDAQ", sector: "Technology", industry: "Software—Infrastructure", country: "United States", hq: "Denver, CO", base: 32.6, cap: 7.2e10, founded: 2003, employees: 3735, ceo: "Alex Karp", logoBg: C.ink, profitable: true, tags: ["large", "tech", "ai", "trending"] },
  { ticker: "UBER", name: "Uber Technologies, Inc.", exchange: "NYSE", sector: "Technology", industry: "Software—Application", country: "United States", hq: "San Francisco, CA", base: 71.9, cap: 1.5e11, founded: 2009, employees: 31100, ceo: "Dara Khosrowshahi", logoBg: C.ink, profitable: true, tags: ["large", "tech"] },
  { ticker: "COIN", name: "Coinbase Global, Inc.", exchange: "NASDAQ", sector: "Financial Services", industry: "Financial Data & Exchanges", country: "United States", hq: "Remote", base: 214.7, cap: 5.3e10, founded: 2012, employees: 3689, ceo: "Brian Armstrong", logoBg: C.indigo, profitable: true, tags: ["large", "crypto", "trending"] },
  { ticker: "SHOP", name: "Shopify Inc.", exchange: "NYSE", sector: "Technology", industry: "Software—Application", country: "Canada", hq: "Ottawa, ON", base: 78.4, cap: 1.01e11, founded: 2006, employees: 8300, ceo: "Tobi Lütke", logoBg: C.moss, profitable: true, tags: ["large", "tech"] },
  { ticker: "SOFI", name: "SoFi Technologies, Inc.", exchange: "NASDAQ", sector: "Financial Services", industry: "Credit Services", country: "United States", hq: "San Francisco, CA", base: 8.9, cap: 9.4e9, founded: 2011, employees: 4400, ceo: "Anthony Noto", logoBg: C.steel, profitable: true, tags: ["mid", "fintech"] },
  { ticker: "RIVN", name: "Rivian Automotive, Inc.", exchange: "NASDAQ", sector: "Consumer Cyclical", industry: "Auto Manufacturers", country: "United States", hq: "Irvine, CA", base: 13.2, cap: 1.32e10, founded: 2009, employees: 14861, ceo: "RJ Scaringe", logoBg: C.moss, profitable: false, tags: ["mid", "ev"] },
  { ticker: "AFRM", name: "Affirm Holdings, Inc.", exchange: "NASDAQ", sector: "Financial Services", industry: "Credit Services", country: "United States", hq: "San Francisco, CA", base: 47.3, cap: 1.5e10, founded: 2012, employees: 2200, ceo: "Max Levchin", logoBg: C.plum, profitable: false, tags: ["mid", "fintech"] },
  { ticker: "DDOG", name: "Datadog, Inc.", exchange: "NASDAQ", sector: "Technology", industry: "Software—Application", country: "United States", hq: "New York, NY", base: 128.6, cap: 4.4e10, founded: 2010, employees: 5200, ceo: "Olivier Pomel", logoBg: C.plum, profitable: true, tags: ["large", "tech"] },
  { ticker: "CRWD", name: "CrowdStrike Holdings, Inc.", exchange: "NASDAQ", sector: "Technology", industry: "Software—Infrastructure", country: "United States", hq: "Austin, TX", base: 285.4, cap: 6.9e10, founded: 2011, employees: 7925, ceo: "George Kurtz", logoBg: C.red, profitable: true, tags: ["large", "tech", "cyber"] },
  { ticker: "SMCI", name: "Super Micro Computer, Inc.", exchange: "NASDAQ", sector: "Technology", industry: "Computer Hardware", country: "United States", hq: "San Jose, CA", base: 41.8, cap: 2.45e10, founded: 1993, employees: 5451, ceo: "Charles Liang", logoBg: C.steel, profitable: true, tags: ["mid", "tech", "ai"] },
  { ticker: "MARA", name: "MARA Holdings, Inc.", exchange: "NASDAQ", sector: "Financial Services", industry: "Capital Markets", country: "United States", hq: "Fort Lauderdale, FL", base: 17.6, cap: 6.1e9, founded: 2010, employees: 210, ceo: "Fred Thiel", logoBg: C.clay, profitable: false, tags: ["mid", "crypto"] },
  // --- Small & micro caps (research focus) ---
  { ticker: "IONQ", name: "IonQ, Inc.", exchange: "NYSE", sector: "Technology", industry: "Computer Hardware", country: "United States", hq: "College Park, MD", base: 9.4, cap: 2.0e9, founded: 2015, employees: 415, ceo: "Peter Chapman", logoBg: C.indigo, profitable: false, tags: ["small", "tech", "quantum", "reporting-soon"] },
  { ticker: "RXRX", name: "Recursion Pharmaceuticals, Inc.", exchange: "NASDAQ", sector: "Healthcare", industry: "Biotechnology", country: "United States", hq: "Salt Lake City, UT", base: 6.8, cap: 2.4e9, founded: 2013, employees: 620, ceo: "Chris Gibson", logoBg: C.teal, profitable: false, tags: ["small", "biotech", "ai"] },
  { ticker: "BBAI", name: "BigBear.ai Holdings, Inc.", exchange: "NYSE", sector: "Technology", industry: "Software—Infrastructure", country: "United States", hq: "Columbia, MD", base: 3.1, cap: 8.2e8, founded: 1988, employees: 350, ceo: "Kevin McAleenan", logoBg: C.ink, profitable: false, tags: ["small", "ai", "microcap"] },
  { ticker: "OKLO", name: "Oklo Inc.", exchange: "NYSE", sector: "Utilities", industry: "Utilities—Renewable", country: "United States", hq: "Santa Clara, CA", base: 8.7, cap: 1.1e9, founded: 2013, employees: 120, ceo: "Jacob DeWitte", logoBg: C.moss, profitable: false, tags: ["small", "energy", "nuclear"] },
  { ticker: "ASTS", name: "AST SpaceMobile, Inc.", exchange: "NASDAQ", sector: "Communication Services", industry: "Telecom Services", country: "United States", hq: "Midland, TX", base: 27.4, cap: 7.6e9, founded: 2017, employees: 850, ceo: "Abel Avellan", logoBg: C.steel, profitable: false, tags: ["small", "space", "reporting-soon"] },
  { ticker: "TMDX", name: "TransMedics Group, Inc.", exchange: "NASDAQ", sector: "Healthcare", industry: "Medical Devices", country: "United States", hq: "Andover, MA", base: 71.2, cap: 2.4e9, founded: 1998, employees: 980, ceo: "Waleed Hassanein", logoBg: C.rose, profitable: true, tags: ["small", "healthcare", "profitable-small"] },
  { ticker: "AEHR", name: "Aehr Test Systems", exchange: "NASDAQ", sector: "Technology", industry: "Semiconductor Equipment", country: "United States", hq: "Fremont, CA", base: 14.6, cap: 4.3e8, founded: 1977, employees: 130, ceo: "Gayn Erickson", logoBg: C.slate, profitable: true, tags: ["microcap", "semis", "profitable-small"] },
  { ticker: "DUOL", name: "Duolingo, Inc.", exchange: "NASDAQ", sector: "Technology", industry: "Software—Application", country: "United States", hq: "Pittsburgh, PA", base: 328.9, cap: 1.5e10, founded: 2011, employees: 800, ceo: "Luis von Ahn", logoBg: C.moss, profitable: true, tags: ["mid", "tech"] },
  { ticker: "CELH", name: "Celsius Holdings, Inc.", exchange: "NASDAQ", sector: "Consumer Defensive", industry: "Beverages—Non-Alcoholic", country: "United States", hq: "Boca Raton, FL", base: 28.1, cap: 6.6e9, founded: 2004, employees: 850, ceo: "John Fieldly", logoBg: C.amber, profitable: true, tags: ["mid", "consumer"] },
  { ticker: "ELF", name: "e.l.f. Beauty, Inc.", exchange: "NYSE", sector: "Consumer Defensive", industry: "Household & Personal Products", country: "United States", hq: "Oakland, CA", base: 118.3, cap: 6.7e9, founded: 2004, employees: 400, ceo: "Tarang Amin", logoBg: C.rose, profitable: true, tags: ["mid", "consumer"] },
  { ticker: "HIMS", name: "Hims & Hers Health, Inc.", exchange: "NYSE", sector: "Healthcare", industry: "Health Information Services", country: "United States", hq: "San Francisco, CA", base: 22.6, cap: 4.9e9, founded: 2017, employees: 1140, ceo: "Andrew Dudum", logoBg: C.ink, profitable: true, tags: ["mid", "healthcare", "trending"] },
];

// The full tradable universe: curated entries first, then every bulk-listed
// ticker not already covered by a curated entry (curated identity wins).
const curatedTickers = new Set(CURATED.map((u) => u.ticker));
export const UNIVERSE: UniverseEntry[] = [
  ...CURATED,
  ...REVOLUT_ENTRIES.filter((u) => !curatedTickers.has(u.ticker)),
];

export const UNIVERSE_MAP: Record<string, UniverseEntry> = Object.fromEntries(
  UNIVERSE.map((u) => [u.ticker, u])
);

export function findEntry(ticker: string): UniverseEntry | undefined {
  return UNIVERSE_MAP[ticker.toUpperCase()];
}
