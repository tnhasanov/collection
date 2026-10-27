/**
 * DEMO_ONLY placeholder for 1-3 DPD probabilities.
 *
 * The source proposes "a simple rule-based probability using max DPD within the last 3 months" but
 * supplies no mapping. These numbers exist only so the synthetic demo can rank 1-3 DPD customers on
 * a common ERA scale. Provenance: invented demo placeholders, NOT approved, NOT derived from the deck.
 * There is deliberately no production activation path: `productionActivatable` is a compile-time false.
 */
export const DEMO_ONLY_DPD_1_3_POLICY = {
  code: "DEMO_ONLY_DPD_1_3_MAXDPD_L3M",
  version: "DEMO-ONLY-01",
  productionActivatable: false as const,
  provenance: "Demo placeholder (no bank or provider mapping supplied)",
  featureName: "MAX_DPD_L3M",
  bands: [
    { maxDpdL3mUpTo: 3, probability: "0.030" },
    { maxDpdL3mUpTo: 10, probability: "0.059" },
    { maxDpdL3mUpTo: 30, probability: "0.090" },
    { maxDpdL3mUpTo: Number.POSITIVE_INFINITY, probability: "0.149" },
  ],
};

export function demoOnlyProbabilityForDpd1to3(maxDpdL3m: number | null | undefined): { probability: string; band: string } | null {
  if (maxDpdL3m === null || maxDpdL3m === undefined || !Number.isFinite(maxDpdL3m)) return null;
  for (const b of DEMO_ONLY_DPD_1_3_POLICY.bands) {
    if (maxDpdL3m <= b.maxDpdL3mUpTo) return { probability: b.probability, band: `MAX_DPD_L3M ≤ ${b.maxDpdL3mUpTo}` };
  }
  return null;
}
