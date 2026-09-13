import type { DataProvider } from "../provider";
import { findEntry } from "./universe";
import {
  genProfile, genQuote, genCandles, genKeyStats, genFinancials,
  genEarningsHistory, genUpcomingEarnings, genAnalyst, genInsiders,
  genInstitutions, genPeers, genFilings,
} from "./generators";
import { genIndices, genMovers, genTrending, genNews, searchUniverse } from "./market";

/* The reference provider. It is fully deterministic and requires no API keys,
   so the entire product is previewable out of the box. A tiny artificial delay
   makes the loading/skeleton states observable, mirroring real network latency. */

function later<T>(value: T, ms = 0): Promise<T> {
  if (!ms) return Promise.resolve(value);
  return new Promise((res) => setTimeout(() => res(value), ms));
}

export const mockProvider: DataProvider = {
  name: "mock",

  async search(query) {
    return searchUniverse(query);
  },
  async indices() {
    return genIndices();
  },
  async movers() {
    return genMovers();
  },
  async trending() {
    return genTrending();
  },

  async profile(ticker) {
    const e = findEntry(ticker);
    return e ? genProfile(e) : null;
  },
  async quote(ticker) {
    const e = findEntry(ticker);
    return e ? genQuote(e) : null;
  },
  async candles(ticker, range) {
    const e = findEntry(ticker);
    return e ? genCandles(e, range) : [];
  },
  async keyStats(ticker) {
    const e = findEntry(ticker);
    return e ? genKeyStats(e) : null;
  },
  async financials(ticker, annual) {
    const e = findEntry(ticker);
    return e ? genFinancials(e, annual) : null;
  },

  async earningsHistory(ticker) {
    const e = findEntry(ticker);
    return e ? genEarningsHistory(e) : [];
  },
  async upcomingEarnings(ticker) {
    const e = findEntry(ticker);
    return e ? genUpcomingEarnings(e) : null;
  },

  async analyst(ticker) {
    const e = findEntry(ticker);
    return e ? genAnalyst(e) : null;
  },
  async insiders(ticker) {
    const e = findEntry(ticker);
    return e ? genInsiders(e) : [];
  },
  async institutions(ticker) {
    const e = findEntry(ticker);
    return e ? genInstitutions(e) : [];
  },
  async peers(ticker) {
    const e = findEntry(ticker);
    return e ? genPeers(e) : [];
  },
  async filings(ticker) {
    const e = findEntry(ticker);
    return e ? genFilings(e) : [];
  },

  async news(opts) {
    return genNews(opts);
  },
};
