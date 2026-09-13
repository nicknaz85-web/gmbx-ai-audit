import type {
  Quote, Candle, ChartRange, KeyStats, CompanyProfile, FinancialStatements,
  EarningsRow, UpcomingEarnings, AnalystConsensus, AnalystAction, NewsArticle,
  SearchResult, IndexQuote, Mover, InsiderTx, Institution, Peer, Filing,
} from "@/types";
import type { MoversBundle } from "./mock/market";

/* The single interface every data provider implements. Components and API
   routes depend ONLY on this contract, so swapping the mock provider for
   Finnhub / FMP / Polygon is a one-line change in ./index.ts with no UI edits.

   Every method returns a Promise so real (network) providers slot in without
   changing call sites. */
export interface DataProvider {
  name: string;

  // Discovery
  search(query: string): Promise<SearchResult[]>;
  indices(): Promise<IndexQuote[]>;
  movers(): Promise<MoversBundle>;
  trending(): Promise<Mover[]>;

  // Company
  profile(ticker: string): Promise<CompanyProfile | null>;
  quote(ticker: string): Promise<Quote | null>;
  candles(ticker: string, range: ChartRange): Promise<Candle[]>;
  keyStats(ticker: string): Promise<KeyStats | null>;
  financials(ticker: string, annual: boolean): Promise<FinancialStatements | null>;

  // Earnings
  earningsHistory(ticker: string): Promise<EarningsRow[]>;
  upcomingEarnings(ticker: string): Promise<UpcomingEarnings | null>;

  // Analyst & ownership
  analyst(ticker: string): Promise<{ consensus: AnalystConsensus; actions: AnalystAction[] } | null>;
  insiders(ticker: string): Promise<InsiderTx[]>;
  institutions(ticker: string): Promise<Institution[]>;
  peers(ticker: string): Promise<Peer[]>;
  filings(ticker: string): Promise<Filing[]>;

  // News
  news(opts?: { ticker?: string; category?: string; limit?: number }): Promise<NewsArticle[]>;
}
