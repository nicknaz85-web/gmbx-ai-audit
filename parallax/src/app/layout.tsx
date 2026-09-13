import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TopNav } from "@/components/layout/TopNav";
import { MobileNav } from "@/components/layout/MobileNav";

export const metadata: Metadata = {
  title: "Parallax — Equity Intelligence",
  description:
    "Institutional-grade equity research for every public stock: live quotes, fundamentals, earnings, analyst data, news and AI-driven scenario forecasts.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <TopNav />
        <main className="mx-auto max-w-[1400px] px-4 pb-24 pt-4 md:pb-10 lg:px-6">{children}</main>
        <MobileNav />
      </body>
    </html>
  );
}
