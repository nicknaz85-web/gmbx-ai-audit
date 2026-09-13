import { provider } from "@/lib/api";
import { NewsScreen } from "@/components/news/NewsScreen";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const initial = await provider.news({ limit: 30 });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Market News</h1>
        <p className="text-[13px] text-muted">Breaking market and company news. Headlines link back to the original publisher.</p>
      </div>
      <NewsScreen initial={initial} />
    </div>
  );
}
