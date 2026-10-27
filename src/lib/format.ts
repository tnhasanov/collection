import { DateTime } from "luxon";

/** Client-safe formatting helpers (Asia/Baku, AZN). Server code uses the equivalents in server/money.ts and server/dates.ts. */
export const BAKU = "Asia/Baku";
const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtAzn(v: string | number | null | undefined, withCurrency = true): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return withCurrency ? `${nf.format(n)} AZN` : nf.format(n);
}

export function fmtPct(v: number | string | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "n/a";
  return `${(Number(v) * 100).toFixed(digits)}%`;
}

export function fmtDateTime(v: string | Date | null | undefined, seconds = false): string {
  if (!v) return "—";
  const d = typeof v === "string" ? DateTime.fromISO(v) : DateTime.fromJSDate(v);
  return d.setZone(BAKU).toFormat(seconds ? "dd MMM yyyy, HH:mm:ss" : "dd MMM yyyy, HH:mm");
}

export function fmtTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? DateTime.fromISO(v) : DateTime.fromJSDate(v);
  return d.setZone(BAKU).toFormat("HH:mm");
}

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return DateTime.fromISO(v, { zone: "utc" }).toFormat("dd MMM yyyy");
  const d = typeof v === "string" ? DateTime.fromISO(v) : DateTime.fromJSDate(v);
  return d.setZone(BAKU).toFormat("dd MMM yyyy");
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function bakuTodayIso(serverNow?: string | null): string {
  return (serverNow ? DateTime.fromISO(serverNow) : DateTime.now()).setZone(BAKU).toISODate() as string;
}

export function toBakuLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return DateTime.fromISO(iso).setZone(BAKU).toFormat("yyyy-LL-dd'T'HH:mm");
}

export function fromBakuLocalInput(local: string): string | null {
  if (!local) return null;
  const d = DateTime.fromFormat(local, "yyyy-LL-dd'T'HH:mm", { zone: BAKU });
  return d.isValid ? d.toUTC().toISO() : null;
}

export function humanize(code: string | null | undefined): string {
  if (!code) return "—";
  return code.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
