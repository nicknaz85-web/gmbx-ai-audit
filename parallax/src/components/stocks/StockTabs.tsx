"use client";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabDef {
  id: string;
  label: string;
  content: ReactNode;
}

/* Sticky secondary navigation for the stock page. All section content is
   server-rendered and passed in; switching is instant (client-side toggle) with
   no refetch. Sticks just beneath the global top bar. */
export function StockTabs({ tabs }: { tabs: TabDef[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <div className="sticky top-14 z-30 -mx-4 border-b border-line bg-bg px-4 lg:-mx-6 lg:px-6">
        <nav className="flex gap-1 overflow-x-auto" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === active}
              onClick={() => setActive(t.id)}
              className={cn(
                "relative whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors",
                t.id === active ? "text-text" : "text-muted hover:text-text"
              )}
            >
              {t.label}
              {t.id === active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </nav>
      </div>
      <div className="fadein pt-5" role="tabpanel" key={current.id}>
        {current.content}
      </div>
    </div>
  );
}
