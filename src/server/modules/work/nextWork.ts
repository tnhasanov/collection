/**
 * Which of a customer's open work items is "the next work" shown on a one-row-per-customer list. The order is the one
 * the workflow already uses: work being handled now first (in a call, claimed), then voice work in claim order (a due
 * callback first, then rank, priority and age — the ORDER BY of `claimNextWorkItem`), eligible before blocked, then
 * review tasks by due time, then digital reminders. Pure and client-safe: no database access, nothing is changed.
 */
export const OPEN_WORK_STATUSES = ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED", "IN_PROGRESS"] as const;

export interface WorkLike {
  id: string;
  type: string;
  status: string;
  rank: number | null;
  priority: number | string | { toString(): string };
  dueAt: Date | string | null;
  createdAt: Date | string;
}

const VOICE = ["CALL", "CALLBACK"];
const ms = (d: Date | string | null) => (d === null ? null : typeof d === "string" ? Date.parse(d) : d.getTime());

function tier(w: WorkLike): number {
  if (w.status === "IN_PROGRESS") return 0;
  if (w.status === "CLAIMED") return 1;
  if (VOICE.includes(w.type)) return w.status === "DEFERRED" ? 3 : 2;
  if (w.type === "DIGITAL_REMINDER") return 5;
  return 4;
}

/** Comparator implementing the workflow order (negative: `a` comes first). */
export function compareWork(a: WorkLike, b: WorkLike, now: Date): number {
  const t = tier(a) - tier(b);
  if (t !== 0) return t;
  const nowMs = now.getTime();
  if (VOICE.includes(a.type) && VOICE.includes(b.type)) {
    const dueA = a.type === "CALLBACK" && (ms(a.dueAt) ?? Infinity) <= nowMs ? 0 : 1;
    const dueB = b.type === "CALLBACK" && (ms(b.dueAt) ?? Infinity) <= nowMs ? 0 : 1;
    if (dueA !== dueB) return dueA - dueB;
    const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
    const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    const pa = Number(a.priority.toString());
    const pb = Number(b.priority.toString());
    if (pa !== pb) return pb - pa;
  } else {
    const da = ms(a.dueAt) ?? Number.MAX_SAFE_INTEGER;
    const db = ms(b.dueAt) ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
  }
  const ca = ms(a.createdAt) ?? 0;
  const cb = ms(b.createdAt) ?? 0;
  return ca !== cb ? ca - cb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Open items of one customer in workflow order (the first is the displayed next work). */
export function orderWork<T extends WorkLike>(items: T[], now: Date): T[] {
  return items.filter((w) => (OPEN_WORK_STATUSES as readonly string[]).includes(w.status)).sort((a, b) => compareWork(a, b, now));
}

/** Short status code for the list cell (`cl.work.*`); the detail panel shows the full reason and times. */
export function workStatusCode(w: { type: string; status: string; dueAt?: Date | string | null }, now: Date): string {
  if (w.status === "IN_PROGRESS") return "IN_CALL";
  if (w.status === "CLAIMED") return "CLAIMED";
  if (w.type === "CALLBACK") return w.status === "DEFERRED" ? "CALLBACK_BLOCKED" : (ms(w.dueAt ?? null) ?? Infinity) <= now.getTime() ? "CALLBACK_DUE" : "CALLBACK";
  if (w.type === "CALL") return w.status === "ELIGIBLE" ? "CALL_READY" : w.status === "DEFERRED" ? "CALL_BLOCKED" : "CALL_QUEUED";
  return w.type;
}
