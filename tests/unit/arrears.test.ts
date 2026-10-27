import { describe, expect, it } from "vitest";
import { buildAnnuitySchedule } from "@/server/modules/finance/annuity";
import { deriveArrears, type InstallmentState } from "@/server/modules/finance/arrears";
import { allocatePayment } from "@/server/modules/finance/allocation";

function statesFromSchedule(paid: Record<number, { p?: string; i?: string }> = {}): InstallmentState[] {
  const s = buildAnnuitySchedule({ principal: "10000", nominalAnnualRate: "0.18", months: 24, firstDueDate: "2026-10-20" });
  return s.installments.map((i) => ({
    id: `inst-${i.seq}`,
    seq: i.seq,
    dueDate: i.dueDate,
    principalDue: i.principalDue.toFixed(2),
    interestDue: i.interestDue.toFixed(2),
    feeDue: "0",
    paidPrincipal: paid[i.seq]?.p ?? "0",
    paidInterest: paid[i.seq]?.i ?? "0",
    paidFee: "0",
  }));
}

describe("DPD and arrears (acceptance case 2)", () => {
  it("due today is DPD 0 and tomorrow is DPD 1 when unpaid", () => {
    expect(deriveArrears(statesFromSchedule(), "2026-10-20").dpd).toBe(0);
    expect(deriveArrears(statesFromSchedule(), "2026-10-20").totalOverdue.toFixed(2)).toBe("499.24");
    expect(deriveArrears(statesFromSchedule(), "2026-10-21").dpd).toBe(1);
    expect(deriveArrears(statesFromSchedule(), "2026-10-27").dpd).toBe(7);
    expect(deriveArrears(statesFromSchedule(), "2026-10-19").dpd).toBe(0);
    expect(deriveArrears(statesFromSchedule(), "2026-10-19").totalOverdue.toFixed(2)).toBe("0.00");
  });

  it("partial payment keeps the oldest installment anchored", () => {
    const partial = statesFromSchedule({ 1: { i: "150.00", p: "100.00" } });
    const a = deriveArrears(partial, "2026-10-27");
    expect(a.dpd).toBe(7);
    expect(a.totalOverdue.toFixed(2)).toBe("249.24");
    expect(a.installments[0].status).toBe("OVERDUE");
    expect(a.oldestUnpaidDueDate).toBe("2026-10-20");
  });

  it("full payment of the oldest installment cures it and moves DPD to the next unpaid", () => {
    const paid = statesFromSchedule({ 1: { i: "150.00", p: "349.24" } });
    const a = deriveArrears(paid, "2026-10-27");
    expect(a.dpd).toBe(0);
    expect(a.totalOverdue.toFixed(2)).toBe("0.00");
    expect(a.installments[0].status).toBe("PAID");
    expect(a.nextDueDate).toBe("2026-11-20");
    expect(a.nextDueAmount?.toFixed(2)).toBe("499.24");
    const later = deriveArrears(paid, "2026-11-25");
    expect(later.dpd).toBe(5);
  });

  it("tolerance only ignores residuals at or below the configured amount", () => {
    const nearly = statesFromSchedule({ 1: { i: "150.00", p: "349.00" } });
    expect(deriveArrears(nearly, "2026-10-27", "0").dpd).toBe(7);
    expect(deriveArrears(nearly, "2026-10-27", "0.50").dpd).toBe(0);
  });
});

describe("demo allocation policy (acceptance case 3 / 11)", () => {
  it("allocates oldest due first, interest then principal, leaving overpayment unapplied", () => {
    const r = allocatePayment("600.00", [
      { id: "a", seq: 1, dueDate: "2026-09-20", remainingInterest: "150.00", remainingPrincipal: "349.24", remainingFee: "0" },
      { id: "b", seq: 2, dueDate: "2026-10-20", remainingInterest: "144.76", remainingPrincipal: "354.48", remainingFee: "0" },
      { id: "c", seq: 3, dueDate: "2026-11-20", remainingInterest: "139.44", remainingPrincipal: "359.80", remainingFee: "0" },
    ], "2026-10-27");
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].interestAmount.toFixed(2)).toBe("150.00");
    expect(r.lines[0].principalAmount.toFixed(2)).toBe("349.24");
    expect(r.lines[1].interestAmount.toFixed(2)).toBe("100.76");
    expect(r.lines[1].principalAmount.toFixed(2)).toBe("0.00");
    expect(r.unapplied.toFixed(2)).toBe("0.00");
    const over = allocatePayment("1100.00", [
      { id: "a", seq: 1, dueDate: "2026-10-20", remainingInterest: "150.00", remainingPrincipal: "349.24", remainingFee: "0" },
      { id: "c", seq: 2, dueDate: "2026-11-20", remainingInterest: "139.44", remainingPrincipal: "359.80", remainingFee: "0" },
    ], "2026-10-27");
    expect(over.unapplied.toFixed(2)).toBe("600.76");
  });

  it("never creates fees and never allocates to installments after the value date", () => {
    const r = allocatePayment("50.00", [{ id: "c", seq: 3, dueDate: "2026-11-20", remainingInterest: "139.44", remainingPrincipal: "359.80", remainingFee: "0" }], "2026-10-27");
    expect(r.lines).toHaveLength(0);
    expect(r.unapplied.toFixed(2)).toBe("50.00");
  });
});
