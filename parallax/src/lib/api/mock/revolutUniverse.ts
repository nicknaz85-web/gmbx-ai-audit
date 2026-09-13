import type { Exchange } from "@/types";
import type { UniverseEntry } from "./universe";

/* ---------------------------------------------------------------------------
   Extended stock universe — the broad set of real, well-known US-listed
   companies available on mainstream retail brokerages (Revolut and similar):
   S&P 500 / Nasdaq-100 large caps, popular mid/small caps and major ADRs.

   Each row carries only what is genuinely knowable — real ticker, name,
   exchange and sector — plus an APPROXIMATE price/market-cap anchor (exactly
   how the curated entries work). Everything else (quotes, fundamentals,
   earnings, forecasts) is synthesised consistently by the Parallax engine from
   these seeds. Fields we don't have real values for (CEO, HQ, headcount,
   founding year) are left blank and render as "—" rather than being invented.

   Tickers duplicated in the curated list (src/lib/api/mock/universe.ts) are
   filtered out there, so the curated, richer entries win.
   --------------------------------------------------------------------------- */

// [ticker, name, exchange, sector, priceAnchor, marketCapAnchor, profitable?, country?]
type Row = [string, string, Exchange, string, number, number, boolean?, string?];

const PALETTE = [
  "#39424f", "#3b3f7a", "#1f5b57", "#26543a", "#6b5322", "#6b2e30",
  "#4a2f52", "#2f4a5e", "#5e3f2e", "#3c4a2a", "#2b303a", "#5c2f42",
];

function colorFor(ticker: string): string {
  let h = 0;
  for (let i = 0; i < ticker.length; i++) h = (Math.imul(h, 31) + ticker.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function capBucket(cap: number): string {
  if (cap >= 5e11) return "mega";
  if (cap >= 1e10) return "large";
  if (cap >= 2e9) return "mid";
  if (cap >= 3e8) return "small";
  return "micro";
}

const SECTOR_TAG: Record<string, string> = {
  Technology: "tech",
  Healthcare: "healthcare",
  "Financial Services": "financials",
  Energy: "energy",
  "Consumer Cyclical": "consumer",
  "Consumer Defensive": "consumer",
  "Communication Services": "media",
  Industrials: "industrials",
  Utilities: "utilities",
  "Real Estate": "reit",
  "Basic Materials": "materials",
};

function expand(r: Row): UniverseEntry {
  const [ticker, name, exchange, sector, base, cap, profitable = true, country = "United States"] = r;
  return {
    ticker,
    name,
    exchange,
    sector,
    industry: sector, // coarse — detailed industry not part of the bulk dataset
    country,
    hq: "",
    base,
    cap,
    founded: 0,
    employees: 0,
    ceo: "",
    logoBg: colorFor(ticker),
    profitable,
    tags: [capBucket(cap), SECTOR_TAG[sector] ?? "other"],
  };
}

// Anchors are approximate and split-adjusted where relevant; the engine derives
// live-looking movement from them. Order is roughly by sector for readability.
const ROWS: Row[] = [
  // ---- Technology / semis / software ----
  ["GOOG", "Alphabet Inc. (Class C)", "NASDAQ", "Communication Services", 170, 2.05e12],
  ["ORCL", "Oracle Corporation", "NYSE", "Technology", 176, 4.9e11],
  ["ADBE", "Adobe Inc.", "NASDAQ", "Technology", 505, 2.2e11],
  ["CSCO", "Cisco Systems, Inc.", "NASDAQ", "Technology", 56, 2.25e11],
  ["ACN", "Accenture plc", "NYSE", "Technology", 350, 2.2e11, true, "Ireland"],
  ["IBM", "International Business Machines", "NYSE", "Technology", 225, 2.05e11],
  ["QCOM", "QUALCOMM Incorporated", "NASDAQ", "Technology", 165, 1.85e11],
  ["TXN", "Texas Instruments Incorporated", "NASDAQ", "Technology", 200, 1.82e11],
  ["NOW", "ServiceNow, Inc.", "NYSE", "Technology", 950, 1.95e11],
  ["INTU", "Intuit Inc.", "NASDAQ", "Technology", 640, 1.8e11],
  ["AMAT", "Applied Materials, Inc.", "NASDAQ", "Technology", 185, 1.55e11],
  ["MU", "Micron Technology, Inc.", "NASDAQ", "Technology", 105, 1.16e11],
  ["ADI", "Analog Devices, Inc.", "NASDAQ", "Technology", 225, 1.12e11],
  ["LRCX", "Lam Research Corporation", "NASDAQ", "Technology", 78, 1.0e11],
  ["KLAC", "KLA Corporation", "NASDAQ", "Technology", 720, 9.6e10],
  ["PANW", "Palo Alto Networks, Inc.", "NASDAQ", "Technology", 190, 1.25e11],
  ["ANET", "Arista Networks, Inc.", "NYSE", "Technology", 95, 1.2e11],
  ["NXPI", "NXP Semiconductors N.V.", "NASDAQ", "Technology", 230, 5.8e10, true, "Netherlands"],
  ["MRVL", "Marvell Technology, Inc.", "NASDAQ", "Technology", 85, 7.3e10],
  ["SNPS", "Synopsys, Inc.", "NASDAQ", "Technology", 500, 7.7e10],
  ["CDNS", "Cadence Design Systems, Inc.", "NASDAQ", "Technology", 300, 8.2e10],
  ["FTNT", "Fortinet, Inc.", "NASDAQ", "Technology", 92, 7.0e10],
  ["ADSK", "Autodesk, Inc.", "NASDAQ", "Technology", 285, 6.1e10],
  ["WDAY", "Workday, Inc.", "NASDAQ", "Technology", 245, 6.4e10],
  ["SNOW", "Snowflake Inc.", "NYSE", "Technology", 160, 5.3e10, false],
  ["TEAM", "Atlassian Corporation", "NASDAQ", "Technology", 240, 6.2e10, false],
  ["MCHP", "Microchip Technology Incorporated", "NASDAQ", "Technology", 75, 4.0e10],
  ["ON", "ON Semiconductor Corporation", "NASDAQ", "Technology", 70, 3.0e10],
  ["NET", "Cloudflare, Inc.", "NYSE", "Technology", 110, 3.7e10, false],
  ["ZS", "Zscaler, Inc.", "NASDAQ", "Technology", 200, 3.0e10, false],
  ["DDOG", "Datadog, Inc.", "NASDAQ", "Technology", 128, 4.4e10],
  ["MDB", "MongoDB, Inc.", "NASDAQ", "Technology", 260, 1.9e10, false],
  ["HUBS", "HubSpot, Inc.", "NYSE", "Technology", 560, 2.9e10, false],
  ["DELL", "Dell Technologies Inc.", "NYSE", "Technology", 115, 8.2e10],
  ["HPQ", "HP Inc.", "NYSE", "Technology", 35, 3.4e10],
  ["HPE", "Hewlett Packard Enterprise", "NYSE", "Technology", 20, 2.6e10],
  ["MPWR", "Monolithic Power Systems, Inc.", "NASDAQ", "Technology", 800, 3.8e10],
  ["GLW", "Corning Incorporated", "NYSE", "Technology", 45, 3.9e10],
  ["APH", "Amphenol Corporation", "NYSE", "Technology", 68, 8.2e10],
  ["FICO", "Fair Isaac Corporation", "NYSE", "Technology", 1900, 4.6e10],
  ["PLTR", "Palantir Technologies Inc.", "NASDAQ", "Technology", 33, 7.2e10], // (curated overrides)
  ["ROP", "Roper Technologies, Inc.", "NASDAQ", "Technology", 560, 6.0e10],
  ["CTSH", "Cognizant Technology Solutions", "NASDAQ", "Technology", 78, 3.9e10],
  ["STX", "Seagate Technology Holdings", "NASDAQ", "Technology", 100, 2.1e10],
  ["WDC", "Western Digital Corporation", "NASDAQ", "Technology", 65, 2.2e10],
  ["TER", "Teradyne, Inc.", "NASDAQ", "Technology", 120, 2.0e10],
  ["GRMN", "Garmin Ltd.", "NYSE", "Technology", 190, 3.6e10, true, "Switzerland"],
  ["RBLX", "Roblox Corporation", "NYSE", "Technology", 45, 2.9e10, false],
  ["U", "Unity Software Inc.", "NYSE", "Technology", 20, 8.0e9, false],
  ["TWLO", "Twilio Inc.", "NYSE", "Technology", 65, 1.0e10, false],
  ["OKTA", "Okta, Inc.", "NASDAQ", "Technology", 90, 1.5e10, false],
  ["DOCU", "DocuSign, Inc.", "NASDAQ", "Technology", 60, 1.2e10],
  ["PATH", "UiPath Inc.", "NYSE", "Technology", 13, 7.3e9, false],
  ["AI", "C3.ai, Inc.", "NYSE", "Technology", 26, 3.3e9, false],
  ["FI", "Fiserv, Inc.", "NYSE", "Technology", 190, 1.1e11],
  ["PAYX", "Paychex, Inc.", "NASDAQ", "Technology", 140, 5.0e10],
  ["ADP", "Automatic Data Processing", "NASDAQ", "Technology", 290, 1.18e11],

  // ---- Communication / media ----
  ["CMCSA", "Comcast Corporation", "NASDAQ", "Communication Services", 40, 1.55e11],
  ["T", "AT&T Inc.", "NYSE", "Communication Services", 22, 1.6e11],
  ["VZ", "Verizon Communications Inc.", "NYSE", "Communication Services", 42, 1.77e11],
  ["TMUS", "T-Mobile US, Inc.", "NASDAQ", "Communication Services", 210, 2.45e11],
  ["SPOT", "Spotify Technology S.A.", "NYSE", "Communication Services", 480, 9.6e10, true, "Luxembourg"],
  ["WBD", "Warner Bros. Discovery, Inc.", "NASDAQ", "Communication Services", 8, 2.0e10, false],
  ["PARA", "Paramount Global", "NASDAQ", "Communication Services", 11, 7.5e9],
  ["EA", "Electronic Arts Inc.", "NASDAQ", "Communication Services", 145, 3.8e10],
  ["TTWO", "Take-Two Interactive Software", "NASDAQ", "Communication Services", 165, 2.9e10, false],
  ["SNAP", "Snap Inc.", "NYSE", "Communication Services", 11, 1.8e10, false],
  ["PINS", "Pinterest, Inc.", "NYSE", "Communication Services", 32, 2.2e10],
  ["MTCH", "Match Group, Inc.", "NASDAQ", "Communication Services", 35, 9.0e9],
  ["RDDT", "Reddit, Inc.", "NYSE", "Communication Services", 75, 1.3e10, false],
  ["ROKU", "Roku, Inc.", "NASDAQ", "Communication Services", 70, 1.0e10, false],

  // ---- Consumer Cyclical ----
  ["HD", "The Home Depot, Inc.", "NYSE", "Consumer Cyclical", 400, 3.95e11],
  ["MCD", "McDonald's Corporation", "NYSE", "Consumer Cyclical", 295, 2.12e11],
  ["NKE", "NIKE, Inc.", "NYSE", "Consumer Cyclical", 78, 1.17e11],
  ["LOW", "Lowe's Companies, Inc.", "NYSE", "Consumer Cyclical", 250, 1.43e11],
  ["SBUX", "Starbucks Corporation", "NASDAQ", "Consumer Cyclical", 95, 1.08e11],
  ["BKNG", "Booking Holdings Inc.", "NASDAQ", "Consumer Cyclical", 4900, 1.65e11],
  ["TJX", "The TJX Companies, Inc.", "NYSE", "Consumer Cyclical", 120, 1.35e11],
  ["ABNB", "Airbnb, Inc.", "NASDAQ", "Consumer Cyclical", 135, 8.5e10],
  ["CMG", "Chipotle Mexican Grill, Inc.", "NYSE", "Consumer Cyclical", 55, 7.5e10],
  ["ORLY", "O'Reilly Automotive, Inc.", "NASDAQ", "Consumer Cyclical", 1150, 6.6e10],
  ["MAR", "Marriott International, Inc.", "NASDAQ", "Consumer Cyclical", 250, 7.0e10],
  ["GM", "General Motors Company", "NYSE", "Consumer Cyclical", 48, 5.4e10],
  ["F", "Ford Motor Company", "NYSE", "Consumer Cyclical", 11, 4.4e10],
  ["LULU", "Lululemon Athletica Inc.", "NASDAQ", "Consumer Cyclical", 330, 4.0e10],
  ["DHI", "D.R. Horton, Inc.", "NYSE", "Consumer Cyclical", 175, 5.5e10],
  ["LEN", "Lennar Corporation", "NYSE", "Consumer Cyclical", 165, 4.4e10],
  ["ROST", "Ross Stores, Inc.", "NASDAQ", "Consumer Cyclical", 150, 5.0e10],
  ["YUM", "Yum! Brands, Inc.", "NYSE", "Consumer Cyclical", 135, 3.8e10],
  ["EBAY", "eBay Inc.", "NASDAQ", "Consumer Cyclical", 62, 3.0e10],
  ["DKNG", "DraftKings Inc.", "NASDAQ", "Consumer Cyclical", 38, 1.8e10, false],
  ["LCID", "Lucid Group, Inc.", "NASDAQ", "Consumer Cyclical", 3, 8.0e9, false],
  ["CVNA", "Carvana Co.", "NYSE", "Consumer Cyclical", 200, 4.2e10, false],
  ["ETSY", "Etsy, Inc.", "NASDAQ", "Consumer Cyclical", 55, 6.5e9],
  ["W", "Wayfair Inc.", "NYSE", "Consumer Cyclical", 45, 5.5e9, false],
  ["EXPE", "Expedia Group, Inc.", "NASDAQ", "Consumer Cyclical", 150, 1.9e10],

  // ---- Consumer Defensive ----
  ["PG", "The Procter & Gamble Company", "NYSE", "Consumer Defensive", 168, 3.95e11],
  ["COST", "Costco Wholesale Corporation", "NASDAQ", "Consumer Defensive", 900, 4.0e11],
  ["PEP", "PepsiCo, Inc.", "NASDAQ", "Consumer Defensive", 170, 2.34e11],
  ["PM", "Philip Morris International", "NYSE", "Consumer Defensive", 120, 1.87e11],
  ["MDLZ", "Mondelez International, Inc.", "NASDAQ", "Consumer Defensive", 68, 9.2e10],
  ["MO", "Altria Group, Inc.", "NYSE", "Consumer Defensive", 52, 8.8e10],
  ["CL", "Colgate-Palmolive Company", "NYSE", "Consumer Defensive", 98, 8.0e10],
  ["TGT", "Target Corporation", "NYSE", "Consumer Defensive", 145, 6.7e10],
  ["KMB", "Kimberly-Clark Corporation", "NYSE", "Consumer Defensive", 135, 4.5e10],
  ["GIS", "General Mills, Inc.", "NYSE", "Consumer Defensive", 68, 3.8e10],
  ["KHC", "The Kraft Heinz Company", "NASDAQ", "Consumer Defensive", 33, 4.0e10],
  ["MNST", "Monster Beverage Corporation", "NASDAQ", "Consumer Defensive", 50, 5.0e10],
  ["KDP", "Keurig Dr Pepper Inc.", "NASDAQ", "Consumer Defensive", 34, 4.6e10],
  ["STZ", "Constellation Brands, Inc.", "NYSE", "Consumer Defensive", 240, 4.4e10],
  ["KVUE", "Kenvue Inc.", "NYSE", "Consumer Defensive", 22, 4.2e10],
  ["DG", "Dollar General Corporation", "NYSE", "Consumer Defensive", 130, 2.9e10],
  ["KR", "The Kroger Co.", "NYSE", "Consumer Defensive", 58, 4.1e10],

  // ---- Healthcare ----
  ["LLY", "Eli Lilly and Company", "NYSE", "Healthcare", 790, 7.5e11],
  ["UNH", "UnitedHealth Group Incorporated", "NYSE", "Healthcare", 560, 5.15e11],
  ["ABBV", "AbbVie Inc.", "NYSE", "Healthcare", 180, 3.18e11],
  ["MRK", "Merck & Co., Inc.", "NYSE", "Healthcare", 100, 2.55e11],
  ["ABT", "Abbott Laboratories", "NYSE", "Healthcare", 115, 2.0e11],
  ["TMO", "Thermo Fisher Scientific Inc.", "NYSE", "Healthcare", 560, 2.15e11],
  ["PFE", "Pfizer Inc.", "NYSE", "Healthcare", 27, 1.53e11],
  ["DHR", "Danaher Corporation", "NYSE", "Healthcare", 250, 1.85e11],
  ["AMGN", "Amgen Inc.", "NASDAQ", "Healthcare", 320, 1.72e11],
  ["ISRG", "Intuitive Surgical, Inc.", "NASDAQ", "Healthcare", 500, 1.78e11],
  ["BMY", "Bristol-Myers Squibb Company", "NYSE", "Healthcare", 55, 1.12e11],
  ["GILD", "Gilead Sciences, Inc.", "NASDAQ", "Healthcare", 85, 1.06e11],
  ["VRTX", "Vertex Pharmaceuticals", "NASDAQ", "Healthcare", 470, 1.2e11],
  ["MDT", "Medtronic plc", "NYSE", "Healthcare", 88, 1.13e11, true, "Ireland"],
  ["SYK", "Stryker Corporation", "NYSE", "Healthcare", 370, 1.4e11],
  ["REGN", "Regeneron Pharmaceuticals", "NASDAQ", "Healthcare", 900, 9.7e10],
  ["CI", "The Cigna Group", "NYSE", "Healthcare", 340, 9.6e10],
  ["CVS", "CVS Health Corporation", "NYSE", "Healthcare", 58, 7.3e10],
  ["BSX", "Boston Scientific Corporation", "NYSE", "Healthcare", 80, 1.18e11],
  ["ZTS", "Zoetis Inc.", "NYSE", "Healthcare", 175, 8.0e10],
  ["BDX", "Becton, Dickinson and Company", "NYSE", "Healthcare", 230, 6.7e10],
  ["HCA", "HCA Healthcare, Inc.", "NYSE", "Healthcare", 340, 8.6e10],
  ["MRNA", "Moderna, Inc.", "NASDAQ", "Healthcare", 40, 1.5e10, false],
  ["BIIB", "Biogen Inc.", "NASDAQ", "Healthcare", 200, 2.9e10],
  ["IDXX", "IDEXX Laboratories, Inc.", "NASDAQ", "Healthcare", 480, 4.0e10],
  ["DXCM", "DexCom, Inc.", "NASDAQ", "Healthcare", 70, 2.75e10],
  ["ILMN", "Illumina, Inc.", "NASDAQ", "Healthcare", 130, 2.1e10],
  ["EW", "Edwards Lifesciences Corporation", "NYSE", "Healthcare", 65, 3.9e10],
  ["GEHC", "GE HealthCare Technologies", "NASDAQ", "Healthcare", 85, 3.9e10],

  // ---- Financial Services ----
  ["BRK.B", "Berkshire Hathaway Inc. (Class B)", "NYSE", "Financial Services", 460, 9.9e11],
  ["MA", "Mastercard Incorporated", "NYSE", "Financial Services", 490, 4.5e11],
  ["BAC", "Bank of America Corporation", "NYSE", "Financial Services", 42, 3.2e11],
  ["WFC", "Wells Fargo & Company", "NYSE", "Financial Services", 68, 2.3e11],
  ["MS", "Morgan Stanley", "NYSE", "Financial Services", 105, 1.7e11],
  ["GS", "The Goldman Sachs Group, Inc.", "NYSE", "Financial Services", 510, 1.65e11],
  ["AXP", "American Express Company", "NYSE", "Financial Services", 265, 1.9e11],
  ["C", "Citigroup Inc.", "NYSE", "Financial Services", 65, 1.24e11],
  ["SCHW", "The Charles Schwab Corporation", "NYSE", "Financial Services", 72, 1.3e11],
  ["BLK", "BlackRock, Inc.", "NYSE", "Financial Services", 970, 1.44e11],
  ["SPGI", "S&P Global Inc.", "NYSE", "Financial Services", 500, 1.56e11],
  ["PGR", "The Progressive Corporation", "NYSE", "Financial Services", 250, 1.46e11],
  ["MMC", "Marsh & McLennan Companies", "NYSE", "Financial Services", 220, 1.08e11],
  ["PYPL", "PayPal Holdings, Inc.", "NASDAQ", "Financial Services", 78, 7.8e10],
  ["ICE", "Intercontinental Exchange, Inc.", "NYSE", "Financial Services", 155, 8.9e10],
  ["CME", "CME Group Inc.", "NASDAQ", "Financial Services", 215, 7.7e10],
  ["USB", "U.S. Bancorp", "NYSE", "Financial Services", 45, 7.0e10],
  ["PNC", "The PNC Financial Services Group", "NYSE", "Financial Services", 190, 7.5e10],
  ["MCO", "Moody's Corporation", "NYSE", "Financial Services", 470, 8.6e10],
  ["HOOD", "Robinhood Markets, Inc.", "NASDAQ", "Financial Services", 25, 2.2e10],
  ["COF", "Capital One Financial Corporation", "NYSE", "Financial Services", 150, 5.7e10],
  ["GPN", "Global Payments Inc.", "NYSE", "Financial Services", 105, 2.6e10],
  ["MET", "MetLife, Inc.", "NYSE", "Financial Services", 78, 5.5e10],
  ["AIG", "American International Group", "NYSE", "Financial Services", 75, 4.8e10],
  ["TFC", "Truist Financial Corporation", "NYSE", "Financial Services", 42, 5.6e10],

  // ---- Industrials ----
  ["CAT", "Caterpillar Inc.", "NYSE", "Industrials", 380, 1.83e11],
  ["GE", "GE Aerospace", "NYSE", "Industrials", 180, 1.95e11],
  ["RTX", "RTX Corporation", "NYSE", "Industrials", 120, 1.6e11],
  ["HON", "Honeywell International Inc.", "NASDAQ", "Industrials", 205, 1.34e11],
  ["UNP", "Union Pacific Corporation", "NYSE", "Industrials", 240, 1.46e11],
  ["BA", "The Boeing Company", "NYSE", "Industrials", 175, 1.08e11, false],
  ["LMT", "Lockheed Martin Corporation", "NYSE", "Industrials", 560, 1.34e11],
  ["DE", "Deere & Company", "NYSE", "Industrials", 400, 1.1e11],
  ["UPS", "United Parcel Service, Inc.", "NYSE", "Industrials", 130, 1.11e11],
  ["ETN", "Eaton Corporation plc", "NYSE", "Industrials", 320, 1.28e11, true, "Ireland"],
  ["GD", "General Dynamics Corporation", "NYSE", "Industrials", 290, 7.9e10],
  ["NOC", "Northrop Grumman Corporation", "NYSE", "Industrials", 480, 7.0e10],
  ["MMM", "3M Company", "NYSE", "Industrials", 130, 7.1e10],
  ["EMR", "Emerson Electric Co.", "NYSE", "Industrials", 110, 6.3e10],
  ["FDX", "FedEx Corporation", "NYSE", "Industrials", 280, 6.8e10],
  ["CSX", "CSX Corporation", "NASDAQ", "Industrials", 33, 6.4e10],
  ["ITW", "Illinois Tool Works Inc.", "NYSE", "Industrials", 250, 7.5e10],
  ["PH", "Parker-Hannifin Corporation", "NYSE", "Industrials", 620, 8.0e10],
  ["WM", "Waste Management, Inc.", "NYSE", "Industrials", 210, 8.4e10],
  ["PCAR", "PACCAR Inc", "NASDAQ", "Industrials", 100, 5.2e10],
  ["TDG", "TransDigm Group Incorporated", "NYSE", "Industrials", 1300, 7.3e10],
  ["CTAS", "Cintas Corporation", "NASDAQ", "Industrials", 200, 8.1e10],

  // ---- Energy ----
  ["CVX", "Chevron Corporation", "NYSE", "Energy", 150, 2.75e11],
  ["COP", "ConocoPhillips", "NYSE", "Energy", 105, 1.24e11],
  ["SLB", "Schlumberger Limited", "NYSE", "Energy", 42, 6.0e10],
  ["EOG", "EOG Resources, Inc.", "NYSE", "Energy", 125, 7.0e10],
  ["MPC", "Marathon Petroleum Corporation", "NYSE", "Energy", 165, 5.5e10],
  ["PSX", "Phillips 66", "NYSE", "Energy", 130, 5.4e10],
  ["OXY", "Occidental Petroleum Corporation", "NYSE", "Energy", 52, 4.9e10],
  ["VLO", "Valero Energy Corporation", "NYSE", "Energy", 135, 4.3e10],
  ["WMB", "The Williams Companies, Inc.", "NYSE", "Energy", 45, 5.5e10],
  ["KMI", "Kinder Morgan, Inc.", "NYSE", "Energy", 22, 4.9e10],
  ["OKE", "ONEOK, Inc.", "NYSE", "Energy", 95, 5.6e10],
  ["DVN", "Devon Energy Corporation", "NYSE", "Energy", 42, 2.7e10],
  ["HAL", "Halliburton Company", "NYSE", "Energy", 32, 2.8e10],
  ["FANG", "Diamondback Energy, Inc.", "NASDAQ", "Energy", 185, 3.3e10],

  // ---- Utilities ----
  ["NEE", "NextEra Energy, Inc.", "NYSE", "Utilities", 80, 1.64e11],
  ["SO", "The Southern Company", "NYSE", "Utilities", 85, 9.3e10],
  ["DUK", "Duke Energy Corporation", "NYSE", "Utilities", 110, 8.5e10],
  ["CEG", "Constellation Energy Corporation", "NASDAQ", "Utilities", 230, 7.2e10],
  ["AEP", "American Electric Power Company", "NASDAQ", "Utilities", 95, 5.1e10],
  ["D", "Dominion Energy, Inc.", "NYSE", "Utilities", 55, 4.6e10],
  ["SRE", "Sempra", "NYSE", "Utilities", 80, 5.1e10],
  ["EXC", "Exelon Corporation", "NASDAQ", "Utilities", 38, 3.8e10],

  // ---- Real Estate ----
  ["PLD", "Prologis, Inc.", "NYSE", "Real Estate", 115, 1.07e11],
  ["AMT", "American Tower Corporation", "NYSE", "Real Estate", 195, 9.1e10],
  ["EQIX", "Equinix, Inc.", "NASDAQ", "Real Estate", 850, 8.1e10],
  ["WELL", "Welltower Inc.", "NYSE", "Real Estate", 120, 7.4e10],
  ["SPG", "Simon Property Group, Inc.", "NYSE", "Real Estate", 165, 5.4e10],
  ["O", "Realty Income Corporation", "NYSE", "Real Estate", 58, 5.0e10],
  ["CCI", "Crown Castle Inc.", "NYSE", "Real Estate", 105, 4.6e10],
  ["PSA", "Public Storage", "NYSE", "Real Estate", 320, 5.6e10],

  // ---- Basic Materials ----
  ["LIN", "Linde plc", "NASDAQ", "Basic Materials", 450, 2.15e11, true, "Ireland"],
  ["SHW", "The Sherwin-Williams Company", "NYSE", "Basic Materials", 360, 9.1e10],
  ["APD", "Air Products and Chemicals", "NYSE", "Basic Materials", 290, 6.4e10],
  ["FCX", "Freeport-McMoRan Inc.", "NYSE", "Basic Materials", 45, 6.5e10],
  ["ECL", "Ecolab Inc.", "NYSE", "Basic Materials", 240, 6.8e10],
  ["NUE", "Nucor Corporation", "NYSE", "Basic Materials", 150, 3.5e10],
  ["DOW", "Dow Inc.", "NYSE", "Basic Materials", 50, 3.5e10],
  ["NEM", "Newmont Corporation", "NYSE", "Basic Materials", 45, 5.1e10],

  // ---- Major ADRs & non-US popular names ----
  ["TSM", "Taiwan Semiconductor Manufacturing", "NYSE", "Technology", 190, 9.0e11, true, "Taiwan"],
  ["ASML", "ASML Holding N.V.", "NASDAQ", "Technology", 720, 2.85e11, true, "Netherlands"],
  ["NVO", "Novo Nordisk A/S", "NYSE", "Healthcare", 110, 5.0e11, true, "Denmark"],
  ["BABA", "Alibaba Group Holding Limited", "NYSE", "Consumer Cyclical", 90, 2.15e11, true, "China"],
  ["SAP", "SAP SE", "NYSE", "Technology", 230, 2.7e11, true, "Germany"],
  ["TM", "Toyota Motor Corporation", "NYSE", "Consumer Cyclical", 180, 2.4e11, true, "Japan"],
  ["SHEL", "Shell plc", "NYSE", "Energy", 68, 2.1e11, true, "United Kingdom"],
  ["BP", "BP p.l.c.", "NYSE", "Energy", 32, 8.8e10, true, "United Kingdom"],
  ["HSBC", "HSBC Holdings plc", "NYSE", "Financial Services", 45, 1.6e11, true, "United Kingdom"],
  ["TD", "The Toronto-Dominion Bank", "NYSE", "Financial Services", 58, 1.0e11, true, "Canada"],
  ["RY", "Royal Bank of Canada", "NYSE", "Financial Services", 120, 1.7e11, true, "Canada"],
  ["UL", "Unilever PLC", "NYSE", "Consumer Defensive", 60, 1.5e11, true, "United Kingdom"],
  ["SONY", "Sony Group Corporation", "NYSE", "Technology", 90, 1.1e11, true, "Japan"],
  ["NIO", "NIO Inc.", "NYSE", "Consumer Cyclical", 5, 1.0e10, false, "China"],
  ["PDD", "PDD Holdings Inc.", "NASDAQ", "Consumer Cyclical", 110, 1.5e11, true, "China"],
  ["JD", "JD.com, Inc.", "NASDAQ", "Consumer Cyclical", 35, 5.2e10, true, "China"],
  ["MELI", "MercadoLibre, Inc.", "NASDAQ", "Consumer Cyclical", 1900, 9.6e10, true, "Argentina"],
  ["SE", "Sea Limited", "NYSE", "Communication Services", 95, 5.4e10, false, "Singapore"],

  // ---- Popular high-beta / retail names ----
  ["GME", "GameStop Corp.", "NYSE", "Consumer Cyclical", 22, 9.5e9, false],
  ["AMC", "AMC Entertainment Holdings", "NYSE", "Communication Services", 5, 1.8e9, false],
  ["RIOT", "Riot Platforms, Inc.", "NASDAQ", "Financial Services", 10, 3.2e9, false],
  ["CLSK", "CleanSpark, Inc.", "NASDAQ", "Financial Services", 12, 3.0e9, false],
  ["PLUG", "Plug Power Inc.", "NASDAQ", "Industrials", 2, 1.8e9, false],
  ["FUBO", "fuboTV Inc.", "NYSE", "Communication Services", 1.5, 5.0e8, false],
  ["CHPT", "ChargePoint Holdings, Inc.", "NYSE", "Industrials", 1.2, 5.5e8, false],
  ["DNA", "Ginkgo Bioworks Holdings", "NYSE", "Healthcare", 9, 5.0e8, false],
  ["JOBY", "Joby Aviation, Inc.", "NYSE", "Industrials", 6, 4.4e9, false],
  ["ACHR", "Archer Aviation Inc.", "NYSE", "Industrials", 5, 2.3e9, false],
  ["RKLB", "Rocket Lab USA, Inc.", "NASDAQ", "Industrials", 12, 5.9e9, false],
  ["LUNR", "Intuitive Machines, Inc.", "NASDAQ", "Industrials", 9, 1.1e9, false],
];

export const REVOLUT_ENTRIES: UniverseEntry[] = ROWS.map(expand);
