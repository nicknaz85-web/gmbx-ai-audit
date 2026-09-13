import type { CompanyProfile } from "@/types";
import { fmtInt } from "@/lib/format";

export function CompanyOverview({ profile }: { profile: CompanyProfile }) {
  const dash = (v: string | undefined) => (v && v.trim() ? v : "—");
  const facts: [string, string][] = [
    ["Sector", dash(profile.sector)],
    ["Industry", dash(profile.industry)],
    ["CEO", dash(profile.ceo)],
    ["Employees", profile.employees > 0 ? fmtInt(profile.employees) : "—"],
    ["Founded", profile.founded > 0 ? String(profile.founded) : "—"],
    ["Headquarters", dash(profile.headquarters)],
    ["Country", dash(profile.country)],
    ["Exchange", dash(profile.exchange)],
  ];
  return (
    <div className="p-4">
      <p className="text-[13px] leading-relaxed text-muted">{profile.description}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-0 sm:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="flex flex-col border-b border-line py-2">
            <dt className="text-[11px] uppercase tracking-wide text-faint">{k}</dt>
            <dd className="text-[13px]">{v}</dd>
          </div>
        ))}
      </dl>
      <a href={profile.website} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex text-[12px] text-accent hover:underline">
        {profile.website.replace("https://", "")} ↗
      </a>
    </div>
  );
}
