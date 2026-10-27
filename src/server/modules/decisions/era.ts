import { Decimal, dec, money } from "@/server/money";

/**
 * ERA = P(defined roll event within the defined horizon) × exposure under the approved definition.
 * ERA is a risk-ranking amount: no LGD, not IFRS 9 ECL, not expected cash recovery, not treatment benefit.
 */
export function computeEra(probability: Decimal.Value | null, exposure: Decimal.Value): Decimal | null {
  if (probability === null || probability === undefined) return null;
  return money(dec(probability).times(exposure));
}

export interface BucketAssignment {
  cutoffs: string[]; // 9 cutoff values (upper bound inclusive of buckets 1..9)
  assign: (era: Decimal.Value) => number;
  populationCount: number;
  distinctValues: number;
}

/**
 * Ten ascending ERA groups computed once at snapshot time (bucket 1 lowest, 10 highest).
 * Position-based deciles; identical ERA values always share a bucket (ties resolve to the lower bucket).
 * With fewer than ten distinct values some buckets stay empty; this is recorded on the run.
 */
export function buildDecileBuckets(eras: Decimal.Value[]): BucketAssignment {
  const sorted = eras.map((e) => dec(e)).sort((a, b) => a.comparedTo(b));
  const n = sorted.length;
  const cutoffs: Decimal[] = [];
  for (let k = 1; k <= 9; k++) {
    if (n === 0) break;
    const idx = Math.max(0, Math.floor((k * n) / 10) - 1);
    cutoffs.push(sorted[idx]);
  }
  const distinct = new Set(sorted.map((s) => s.toFixed(2))).size;
  return {
    cutoffs: cutoffs.map((c) => c.toFixed(2)),
    populationCount: n,
    distinctValues: distinct,
    assign: (era: Decimal.Value) => {
      const v = dec(era);
      let bucket = 1;
      for (const c of cutoffs) if (v.greaterThan(c)) bucket++;
      return Math.min(10, bucket);
    },
  };
}

/** breakEvenERA = actionUnitCost / assumedRelativeUplift (uplift must be positive). */
export function breakEvenEra(unitCost: Decimal.Value, uplift: Decimal.Value): Decimal {
  const u = dec(uplift);
  if (u.lessThanOrEqualTo(0)) throw new Error("Uplift must be positive to evaluate break-even ERA");
  return dec(unitCost).div(u);
}
