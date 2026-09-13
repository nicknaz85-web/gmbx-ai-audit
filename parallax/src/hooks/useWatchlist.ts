"use client";
import { useCallback, useEffect, useState } from "react";

/* Client-side watchlist backed by localStorage (Phase 1). The API mirrors what
   a server-backed store would expose, so swapping to the DB in Phase 2 only
   changes this hook's internals. A storage event keeps tabs/components in sync. */

const KEY = "parallax:watchlist";
const EVT = "parallax:watchlist-change";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function write(list: string[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(EVT));
}

export function useWatchlist() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTickers(read());
    setReady(true);
    const sync = () => setTickers(read());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const add = useCallback((t: string) => {
    const up = t.toUpperCase();
    const cur = read();
    if (!cur.includes(up)) write([up, ...cur]);
  }, []);

  const remove = useCallback((t: string) => {
    write(read().filter((x) => x !== t.toUpperCase()));
  }, []);

  const toggle = useCallback((t: string) => {
    const up = t.toUpperCase();
    const cur = read();
    write(cur.includes(up) ? cur.filter((x) => x !== up) : [up, ...cur]);
  }, []);

  const has = useCallback((t: string) => tickers.includes(t.toUpperCase()), [tickers]);

  return { tickers, ready, add, remove, toggle, has };
}
