"use client";
import { useEffect, useState } from "react";
import type { NewsArticle } from "@/types";
import { NewsList } from "./NewsList";
import { cn } from "@/lib/cn";

const CATEGORIES = ["For You", "Markets", "Stocks", "Technology", "AI", "Earnings", "Economy", "Crypto"];

export function NewsScreen({ initial }: { initial: NewsArticle[] }) {
  const [category, setCategory] = useState("For You");
  const [items, setItems] = useState<NewsArticle[]>(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/news?category=${encodeURIComponent(category)}&limit=30`)
      .then((r) => r.json())
      .then((data: NewsArticle[]) => { if (active) { setItems(data); setLoading(false); } })
      .catch(() => active && setLoading(false));
    return () => { active = false; };
  }, [category]);

  return (
    <div className="panel">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors", category === c ? "bg-surface-2 text-text" : "text-muted hover:text-text")}
          >
            {c}
          </button>
        ))}
      </div>
      <div className={cn("transition-opacity", loading && "opacity-50")}>
        <NewsList items={items} />
      </div>
    </div>
  );
}
