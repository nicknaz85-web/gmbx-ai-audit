"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GlobalSearch } from "./GlobalSearch";
import { MarketStatus } from "./MarketStatus";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/movers", label: "Movers" },
  { href: "/news", label: "News" },
  { href: "/screener", label: "Screener" },
  { href: "/watchlist", label: "Watchlist" },
];

export function TopNav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    // Single 56px row at every breakpoint so the stock page's sticky section
    // tabs (top-14) always dock flush beneath it — no separate mobile search row.
    <header className="sticky top-0 z-40 h-14 border-b border-line bg-bg">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2.5 px-3 sm:gap-4 sm:px-4 lg:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Parallax home">
          <Logo />
        </Link>

        <div className="flex flex-1 justify-center">
          <GlobalSearch />
        </div>

        <nav className="hidden items-center gap-1 lg:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                isActive(l.href) ? "bg-surface-2 text-text" : "text-muted hover:text-text hover:bg-surface-2/60"
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-3 lg:ml-1">
          <div className="hidden sm:block"><MarketStatus /></div>
          <div className="hidden h-5 w-px bg-line lg:block" />
          <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-2 bg-surface-2 text-xs font-semibold text-muted transition-colors hover:text-text" aria-label="Account">
            N
          </button>
        </div>
      </div>
    </header>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="1.5" y="1.5" width="21" height="21" rx="5" stroke="var(--color-line-2)" />
        <path d="M6 16 L10 9 L14 13 L18 6" stroke="var(--color-text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18" cy="6" r="1.7" fill="var(--color-accent)" />
      </svg>
      {!compact && (
        <span className="hidden text-[15px] font-semibold tracking-[-0.01em] text-text sm:inline">
          Parallax
        </span>
      )}
    </span>
  );
}
