import { describe, expect, it } from "vitest";
import { buildAnnuitySchedule, regularPayment, AnnuityValidationError } from "@/server/modules/finance/annuity";
import { dec } from "@/server/money";

describe("annuity engine (acceptance case 1)", () => {
  it("matches the 10,000 / 18% / 24 reference fixture", () => {
    const s = buildAnnuitySchedule({ principal: "10000", nominalAnnualRate: "0.18", months: 24, firstDueDate: "2026-10-20" });
    expect(s.regularPayment.toFixed(2)).toBe("499.24");
    expect(s.regularPaymentUnrounded.toFixed(13)).toBe("499.2410196950872");
    const first = s.installments[0];
    expect(first.interestDue.toFixed(2)).toBe("150.00");
    expect(first.principalDue.toFixed(2)).toBe("349.24");
    expect(first.closingPrincipal.toFixed(2)).toBe("9650.76");
    expect(s.installments[1].dueDate).toBe("2026-11-20");
    expect(s.installments[23].dueDate).toBe("2028-09-20");
  });

  it("amortizes principal exactly with a disclosed final adjustment", () => {
    const s = buildAnnuitySchedule({ principal: "10000", nominalAnnualRate: "0.18", months: 24, firstDueDate: "2026-10-20" });
    const principalSum = s.installments.reduce((a, i) => a.plus(i.principalDue), dec(0));
    expect(principalSum.toFixed(2)).toBe("10000.00");
    expect(s.installments[23].closingPrincipal.toFixed(2)).toBe("0.00");
    // Final adjustment is small and explicitly disclosed.
    expect(s.finalAdjustment.abs().lessThan(1)).toBe(true);
    expect(s.installments[23].totalDue.toFixed(2)).toBe(s.regularPayment.plus(s.finalAdjustment).toFixed(2));
  });

  it("handles the zero-rate 1,200 / 12 fixture", () => {
    const s = buildAnnuitySchedule({ principal: "1200", nominalAnnualRate: "0", months: 12, firstDueDate: "2026-01-31" });
    expect(s.regularPayment.toFixed(2)).toBe("100.00");
    for (const i of s.installments) {
      expect(i.interestDue.toFixed(2)).toBe("0.00");
      expect(i.totalDue.toFixed(2)).toBe("100.00");
    }
    expect(s.finalAdjustment.toFixed(2)).toBe("0.00");
    // 31 Jan anchor clamps to 28 Feb then returns to the 31st where the month allows.
    expect(s.installments[1].dueDate).toBe("2026-02-28");
    expect(s.installments[2].dueDate).toBe("2026-03-31");
  });

  it("rejects invalid inputs and negative amortization", () => {
    expect(() => buildAnnuitySchedule({ principal: "0", nominalAnnualRate: "0.1", months: 12, firstDueDate: "2026-01-01" })).toThrow(AnnuityValidationError);
    expect(() => buildAnnuitySchedule({ principal: "1000", nominalAnnualRate: "0.1", months: 0, firstDueDate: "2026-01-01" })).toThrow(AnnuityValidationError);
    expect(() => buildAnnuitySchedule({ principal: "1000", nominalAnnualRate: "-0.1", months: 12, firstDueDate: "2026-01-01" })).toThrow(AnnuityValidationError);
    expect(() => buildAnnuitySchedule({ principal: "1000", nominalAnnualRate: "0.1", months: 12, firstDueDate: "2026-13-01" })).toThrow(AnnuityValidationError);
  });

  it("keeps calculation precision separate from display rounding", () => {
    expect(regularPayment("10000", "0.18", 24).toFixed(6)).toBe("499.241020");
  });
});
