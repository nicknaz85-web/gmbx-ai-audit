/* Number, currency, percentage and time formatting.
   Centralised so every figure in the app reads consistently. */

export function fmtPrice(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtMoney(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return "$" + fmtPrice(v, digits);
}

/** Compact large magnitudes: 1.24T, 89.4B, 512M, 4.1K */
export function fmtCompact(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(digits)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(digits <= 2 ? 1 : digits)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function fmtMoneyCompact(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return "—";
  const s = fmtCompact(v, digits);
  return s.startsWith("-") ? `-$${s.slice(1)}` : `$${s}`;
}

export function fmtPct(v: number | null | undefined, digits = 2, withSign = false): string {
  if (v == null || !isFinite(v)) return "—";
  const sign = withSign && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}

export function fmtMult(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v.toFixed(digits)}x`;
}

export function signClass(v: number | null | undefined): string {
  if (v == null || v === 0) return "text-muted";
  return v > 0 ? "text-pos" : "text-neg";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: string | number): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fmtDateShort(iso: string | number): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "14 seconds ago", "7 minutes ago", "3 hours ago", "Aug 6" */
export function fmtRelative(epochMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - epochMs) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return fmtDateShort(epochMs);
}

export function marketStateLabel(s: string): string {
  switch (s) {
    case "open": return "Market Open";
    case "pre": return "Pre-Market";
    case "post": return "After Hours";
    default: return "Market Closed";
  }
}
