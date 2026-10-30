import { DateTime } from "luxon";

/** All customer-facing and operational times are displayed in Asia/Baku. Timestamps are stored in UTC. */
export const BAKU_ZONE = "Asia/Baku";

export type IsoDate = string; // yyyy-MM-dd

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value, { zone: "utc" }).isValid;
}

/** Date-only values are stored as UTC midnight (Prisma @db.Date). */
export function toDbDate(iso: IsoDate): Date {
  if (!isIsoDate(iso)) throw new Error(`Invalid ISO date: ${iso}`);
  return new Date(`${iso}T00:00:00.000Z`);
}

export function fromDbDate(value: Date | string | null | undefined): IsoDate | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString().slice(0, 10);
}

/** Business date in Baku for a given instant. */
export function bakuBusinessDate(at: Date): IsoDate {
  return DateTime.fromJSDate(at, { zone: BAKU_ZONE }).toISODate() as IsoDate;
}

/** Start of a Baku calendar day as an instant. */
export function bakuStartOfDay(iso: IsoDate): Date {
  return DateTime.fromISO(iso, { zone: BAKU_ZONE }).startOf("day").toJSDate();
}

/** End of a Baku business day (23:59:59.999) as an instant. */
export function bakuEndOfDay(iso: IsoDate): Date {
  return DateTime.fromISO(iso, { zone: BAKU_ZONE }).endOf("day").toJSDate();
}

/** Combine a Baku local date and HH:mm into an instant. */
export function bakuDateTime(iso: IsoDate, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return DateTime.fromISO(iso, { zone: BAKU_ZONE }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).toJSDate();
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return DateTime.fromISO(iso, { zone: "utc" }).plus({ days }).toISODate() as IsoDate;
}

/** Add months keeping the same day of month, clamped to the end of the target month (contractual due-date convention). */
export function addMonthsClamped(iso: IsoDate, months: number, anchorDay?: number): IsoDate {
  const base = DateTime.fromISO(iso, { zone: "utc" });
  const target = base.plus({ months }).startOf("month");
  const day = Math.min(anchorDay ?? base.day, target.daysInMonth ?? 28);
  return target.set({ day }).toISODate() as IsoDate;
}

/** Calendar days from a to b (b - a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const da = DateTime.fromISO(a, { zone: "utc" });
  const db = DateTime.fromISO(b, { zone: "utc" });
  return Math.round(db.diff(da, "days").days);
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** English keeps "dd MMM yyyy, HH:mm"; Azerbaijani and Russian use the numeric local form "dd.MM.yyyy HH:mm". */
export function formatBakuDateTime(at: Date | string | null | undefined, opts: { seconds?: boolean; locale?: string } = {}): string {
  if (!at) return "—";
  const d = typeof at === "string" ? new Date(at) : at;
  const numeric = opts.locale === "az" || opts.locale === "ru";
  return DateTime.fromJSDate(d, { zone: BAKU_ZONE }).toFormat(numeric ? (opts.seconds ? "dd.MM.yyyy HH:mm:ss" : "dd.MM.yyyy HH:mm") : opts.seconds ? "dd MMM yyyy, HH:mm:ss" : "dd MMM yyyy, HH:mm");
}

export function formatBakuTime(at: Date | string | null | undefined): string {
  if (!at) return "—";
  const d = typeof at === "string" ? new Date(at) : at;
  return DateTime.fromJSDate(d, { zone: BAKU_ZONE }).toFormat("HH:mm");
}

export function formatDate(iso: IsoDate | Date | null | undefined, locale?: string): string {
  if (!iso) return "—";
  const s = typeof iso === "string" ? iso : fromDbDate(iso);
  if (!s) return "—";
  return DateTime.fromISO(s.slice(0, 10), { zone: "utc" }).toFormat(locale === "az" || locale === "ru" ? "dd.MM.yyyy" : "dd MMM yyyy");
}

export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

export function addHours(at: Date, hours: number): Date {
  return new Date(at.getTime() + hours * 3_600_000);
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000);
}

export function bakuWeekday(at: Date): number {
  return DateTime.fromJSDate(at, { zone: BAKU_ZONE }).weekday; // 1 = Monday .. 7 = Sunday
}

export function bakuHourMinute(at: Date): { hour: number; minute: number } {
  const d = DateTime.fromJSDate(at, { zone: BAKU_ZONE });
  return { hour: d.hour, minute: d.minute };
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
