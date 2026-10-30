"use client";
import { useRouter } from "next/navigation";
import type { Locale } from "@/i18n/dictionaries";
import { at } from "@/i18n/agentText";

const BANDS = ["DPD_1_3", "DPD_4_10", "DPD_11_16", "DPD_17_23", "DPD_24_30", "DPD_31_45", "DPD_46_60", "DPD_61_90", "DPD_91_PLUS"];
const QUEUES = ["mine", "all", "callbacks", "blocked", "senior", "manual", "later"];

/** Work-queue filters. They select which work items count; the list still shows each matching customer once. */
export function QueueFilters({ current, locale }: { current: Record<string, string | number>; locale: Locale }) {
  const A = (k: string) => at(locale, k);
  const router = useRouter();
  const update = (k: string, v: string) => {
    const q = new URLSearchParams();
    for (const [key, val] of Object.entries({ ...current, [k]: v, page: "1" })) if (val !== "" && val !== undefined && key !== "pageSize") q.set(key, String(val));
    router.push(`/work-queue?${q.toString()}`);
  };
  const sel = (id: string, label: string, options: [string, string][]) => (
    <label className="text-[13px] text-muted">
      <span className="mb-1 block">{label}</span>
      <select className="select" id={id} value={String(current[id] ?? "")} onChange={(e) => update(id, e.target.value)} data-testid={`qf-${id}`}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {sel("queue", A("cl.f.queue"), QUEUES.map((q) => [q, A(`cl.queue.${q}`)]))}
      {sel("eligibility", A("cl.f.status"), [["", A("cl.f.allStatuses")], ["ELIGIBLE", A("cl.kpi.eligible")], ["DEFERRED", A("cl.work.CALL_BLOCKED")], ["QUEUED", A("cl.work.CALL_QUEUED")], ["CLAIMED", A("cl.work.CLAIMED")]])}
      {sel("band", A("cl.f.band"), [["", A("cl.f.all")], ...BANDS.map((b) => [b, `${b.replace("DPD_", "").replace("_", "–").replace("PLUS", "+")}`] as [string, string])])}
      {sel("bucket", A("cl.f.bucket"), [["", A("cl.f.all")], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string])])}
      {sel("riskClass", A("cl.f.class"), [["", A("cl.f.all")], ...Array.from({ length: 8 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string])])}
      {sel("language", A("cl.f.language"), [["", A("cl.f.any")], ["AZ", "AZ"], ["RU", "RU"], ["EN", "EN"]])}
    </div>
  );
}
