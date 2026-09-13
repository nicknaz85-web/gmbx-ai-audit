"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { SearchResult } from "@/types";
import { useDebounce } from "@/hooks/useDebounce";
import { Monogram } from "@/components/common/Monogram";
import { fmtPrice, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";

export function GlobalSearch({ variant = "bar" }: { variant?: "bar" | "page" }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounce(q, 140);
  const reqId = useRef(0);

  useEffect(() => {
    const term = debounced.trim();
    if (!term) {
      setResults([]);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(term)}`)
      .then((r) => r.json())
      .then((data: SearchResult[]) => {
        if (id !== reqId.current) return; // drop out-of-order responses
        setResults(data);
        setActive(0);
        setLoading(false);
      })
      .catch(() => id === reqId.current && setLoading(false));
  }, [debounced]);

  // Cmd/Ctrl+K to focus the search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = useCallback(
    (ticker: string) => {
      setOpen(false);
      setQ("");
      setResults([]);
      router.push(`/stocks/${ticker}`);
    },
    [router]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[active];
      if (pick) go(pick.ticker);
    }
  };

  return (
    <div ref={boxRef} className={cn("relative", variant === "bar" ? "w-full max-w-[440px]" : "w-full")}>
      <div className="relative">
        <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search stocks, companies or tickers"
          className={cn(
            "w-full rounded-md border border-line bg-bg-2 pl-9 pr-14 text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-line-2 focus:bg-surface",
            variant === "bar" ? "h-9" : "h-11 text-base"
          )}
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-line-2 bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-faint sm:flex">
          ⌘K
        </kbd>
      </div>

      {open && (q.trim() || loading) && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-lg border border-line-2 bg-surface shadow-2xl fadein">
          {loading && results.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-faint">Searching…</div>
          )}
          {!loading && results.length === 0 && q.trim() && (
            <div className="px-3 py-6 text-center text-xs text-faint">
              No matches for “{q}”. Try a ticker like AAPL or NVDA.
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={r.ticker}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r.ticker)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                i === active ? "bg-surface-3" : "hover:bg-surface-2"
              )}
            >
              <Monogram ticker={r.ticker} bg={r.logoBg} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{r.ticker}</span>
                  <span className="truncate text-xs text-muted">{r.name}</span>
                </div>
                <span className="text-[11px] text-faint">{r.exchange}</span>
              </div>
              <div className="text-right">
                <div className="tnum text-sm">${fmtPrice(r.price)}</div>
                <div className={cn("tnum text-[11px]", r.changePercent >= 0 ? "text-pos" : "text-neg")}>
                  {r.changePercent >= 0 ? "+" : ""}
                  {fmtPct(r.changePercent, 2)}
                </div>
              </div>
            </button>
          ))}
          {results.length > 0 && (
            <div className="border-t border-line px-3 py-1.5 text-[10px] text-faint">
              <span className="tnum">↑↓</span> navigate · <span className="tnum">↵</span> open · <span className="tnum">esc</span> close
            </div>
          )}
        </div>
      )}
    </div>
  );
}
