/**
 * Amount text for the interface language. Azerbaijani and Russian use a no-break space between thousands and a
 * decimal comma (8 400,00); English keeps 8,400.00. Display only: stored and submitted values are never formatted.
 */
const en = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoneyText(n: number, locale?: string | null): string {
  if (locale !== "az" && locale !== "ru") return en.format(n);
  const [int, frac] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "−" : ""}${int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${frac}`;
}
