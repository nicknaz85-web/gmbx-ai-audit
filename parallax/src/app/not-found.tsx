import Link from "next/link";
import { GlobalSearch } from "@/components/layout/GlobalSearch";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <div className="text-[13px] font-semibold uppercase tracking-widest text-faint">404</div>
      <h1 className="mt-2 text-2xl font-semibold">Symbol not found</h1>
      <p className="mt-2 text-[14px] text-muted">
        We couldn&apos;t find data for that ticker. It may be delisted, unsupported, or mistyped.
      </p>
      <div className="mx-auto mt-6 max-w-sm">
        <GlobalSearch variant="page" />
      </div>
      <div className="mt-5">
        <Link href="/" className="btn btn-ghost text-muted">← Back to markets</Link>
      </div>
    </div>
  );
}
