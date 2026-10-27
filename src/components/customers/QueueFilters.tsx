"use client";
import { useRouter } from "next/navigation";

const BANDS = ["", "DPD_1_3", "DPD_4_10", "DPD_11_16", "DPD_17_23", "DPD_24_30", "DPD_31_45", "DPD_46_60", "DPD_61_90", "DPD_91_PLUS"];

export function QueueFilters({ current }: { current: Record<string, string | number> }) {
  const router = useRouter();
  const update = (k: string, v: string) => {
    const q = new URLSearchParams();
    for (const [key, val] of Object.entries({ ...current, [k]: v, page: "1" })) if (val !== "" && val !== undefined && key !== "pageSize") q.set(key, String(val));
    router.push(`/work-queue?${q.toString()}`);
  };
  const sel = (id: string, label: string, options: [string, string][]) => (
    <label className="text-xs text-muted">
      <span className="label">{label}</span>
      <select className="select" id={id} value={String(current[id] ?? "")} onChange={(e) => update(id, e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {sel("queue", "Queue", [["mine", "My assigned cases"], ["all", "All voice work"], ["senior", "Senior-only"], ["callbacks", "Callbacks"], ["blocked", "Blocked / deferred"], ["manual", "Manual review (unscored)"], ["later", "Later-stage / handover"]])}
      {sel("eligibility", "Contact eligibility", [["", "All statuses"], ["ELIGIBLE", "Eligible now"], ["DEFERRED", "Deferred"], ["QUEUED", "Queued"], ["CLAIMED", "Claimed"]])}
      {sel("band", "DPD band", BANDS.map((b) => [b, b ? b.replace("DPD_", "").replace("_", "–").replace("PLUS", "+") + " DPD" : "All bands"]))}
      {sel("bucket", "Action bucket", [["", "All buckets"], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), `Bucket ${i + 1}`] as [string, string])])}
      {sel("riskClass", "Model class", [["", "All classes"], ...Array.from({ length: 8 }, (_, i) => [String(i + 1), `Class ${i + 1}`] as [string, string])])}
      {sel("language", "Language", [["", "Any"], ["AZ", "AZ"], ["RU", "RU"], ["EN", "EN"]])}
    </div>
  );
}
