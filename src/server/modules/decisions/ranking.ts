import { dec } from "@/server/money";

export interface RankCandidate {
  customerId: string;
  era: string | null;
  oldestOverdueDueDate: string | null; // ISO
}

/** Stable common ranking: ERA descending, oldest overdue due date ascending, customer id ascending. */
export function rankCandidates<T extends RankCandidate>(candidates: T[]): (T & { rank: number | null })[] {
  const scored = candidates.filter((c) => c.era !== null);
  const unscored = candidates.filter((c) => c.era === null);
  scored.sort((a, b) => {
    const cmp = dec(b.era!).comparedTo(dec(a.era!));
    if (cmp !== 0) return cmp;
    const da = a.oldestOverdueDueDate ?? "9999-12-31";
    const db = b.oldestOverdueDueDate ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    return a.customerId < b.customerId ? -1 : a.customerId > b.customerId ? 1 : 0;
  });
  return [...scored.map((c, i) => ({ ...c, rank: i + 1 })), ...unscored.map((c) => ({ ...c, rank: null }))];
}

export const TIEBREAK_DESCRIPTION = "ERA desc, oldest overdue due date asc, customer id asc";
