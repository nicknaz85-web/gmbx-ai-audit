import { provider } from "@/lib/api";
import { IndexStrip } from "@/components/stocks/IndexStrip";
import { MoversScreen } from "@/components/stocks/MoversScreen";
import { Timestamp } from "@/components/common/bits";

export const dynamic = "force-dynamic";

export default async function MoversPage() {
  const [indices, bundle] = await Promise.all([provider.indices(), provider.movers()]);
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold">Market Movers</h1>
          <p className="text-[13px] text-muted">Biggest gainers, losers, most active and unusual volume across the tracked universe.</p>
        </div>
        <Timestamp label="Snapshot" value="live" />
      </div>
      <IndexStrip indices={indices} />
      <MoversScreen bundle={bundle} />
    </div>
  );
}
