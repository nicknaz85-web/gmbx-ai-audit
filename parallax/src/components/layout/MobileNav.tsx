"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/movers", label: "Markets", icon: MarketsIcon },
  { href: "/news", label: "Feed", icon: FeedIcon },
  { href: "/watchlist", label: "Watchlist", icon: StarIcon },
];

export function MobileNav() {
  const pathname = usePathname();
  const active = (h: string) => (h === "/" ? pathname === "/" : pathname.startsWith(h));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg md:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {ITEMS.map((it) => {
          const Icon = it.icon;
          return (
            <Link key={it.href} href={it.href} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium", active(it.href) ? "text-text" : "text-faint")}>
              <Icon active={active(it.href)} />
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function base(active: boolean) {
  return { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: active ? 2 : 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
}
function HomeIcon({ active }: { active: boolean }) { return <svg {...base(active)}><path d="M3 10 12 3l9 7" /><path d="M5 9v11h14V9" /></svg>; }
function MarketsIcon({ active }: { active: boolean }) { return <svg {...base(active)}><path d="M4 18V9M9 18V5M14 18v-6M19 18v-9" /></svg>; }
function FeedIcon({ active }: { active: boolean }) { return <svg {...base(active)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></svg>; }
function StarIcon({ active }: { active: boolean }) { return <svg {...base(active)}><path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 17l-5.3 2.6 1.1-6L3.4 9.4l6-.8z" /></svg>; }
