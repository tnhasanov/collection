import { describe, expect, it } from "vitest";
import { formatMoneyText } from "@/lib/moneyFormat";
import { fmtAzn } from "@/lib/format";
import { formatAzn } from "@/server/money";
import { scriptValues } from "@/components/agent/conversation";

describe("amount display per interface language", () => {
  it("Azerbaijani and Russian group thousands with a no-break space and use a decimal comma", () => {
    expect(formatMoneyText(8400, "az")).toBe("8 400,00");
    expect(formatMoneyText(1827.244, "az")).toBe("1 827,24");
    expect(formatMoneyText(95, "ru")).toBe("95,00");
    expect(formatMoneyText(-12.5, "az")).toBe("−12,50");
    expect(fmtAzn("250", true, "az")).toBe("250,00 AZN");
    expect(formatAzn("2450", { locale: "az" })).toBe("2 450,00 AZN");
  });

  it("English keeps 8,400.00 and the default stays English", () => {
    expect(formatMoneyText(8400, "en")).toBe("8,400.00");
    expect(fmtAzn("250")).toBe("250.00 AZN");
    expect(formatAzn("2450")).toBe("2,450.00 AZN");
  });

  it("the script shows the promised amount in the interface format while the draft keeps the plain value", () => {
    const draft = { businessOutcome: "PTP", ptp: { amount: "1250.5", deadlineDate: "2026-11-02", coveredLoanIds: [], customerConfirmed: false } };
    expect(scriptValues(draft, (d) => d, (n) => fmtAzn(n, false, "az")).promiseAmount).toBe("1 250,50");
    expect(draft.ptp.amount).toBe("1250.5");
  });
});
