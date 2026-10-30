import { describe, expect, it } from "vitest";
import { orderWork, workStatusCode, type WorkLike } from "@/server/modules/work/nextWork";

const now = new Date("2026-10-30T08:00:00Z");
const w = (id: string, type: string, status: string, extra: Partial<WorkLike> = {}): WorkLike => ({ id, type, status, rank: null, priority: "0", dueAt: null, createdAt: "2026-10-01T00:00:00Z", ...extra });

describe("next work in workflow order", () => {
  it("work being handled comes first, then voice work in claim order, then blocked voice, tasks and reminders", () => {
    const items = [
      w("reminder", "DIGITAL_REMINDER", "ELIGIBLE"),
      w("task", "PTP_FOLLOWUP", "ELIGIBLE", { dueAt: "2026-10-29T08:00:00Z" }),
      w("blocked", "CALL", "DEFERRED", { rank: 1 }),
      w("call-r5", "CALL", "ELIGIBLE", { rank: 5 }),
      w("call-r2", "CALL", "ELIGIBLE", { rank: 2 }),
      w("callback-due", "CALLBACK", "ELIGIBLE", { rank: 90, dueAt: "2026-10-30T07:00:00Z" }),
      w("callback-later", "CALLBACK", "ELIGIBLE", { rank: 1, dueAt: "2026-10-31T07:00:00Z" }),
      w("claimed", "CALL", "CLAIMED"),
      w("in-call", "CALL", "IN_PROGRESS"),
      w("done", "CALL", "COMPLETED"),
    ];
    expect(orderWork(items, now).map((x) => x.id)).toEqual(["in-call", "claimed", "callback-due", "callback-later", "call-r2", "call-r5", "blocked", "task", "reminder"]);
  });

  it("equal rank falls back to priority, then age", () => {
    const items = [w("old-low", "CALL", "ELIGIBLE", { rank: 3, priority: "1", createdAt: "2026-09-01T00:00:00Z" }), w("new-high", "CALL", "ELIGIBLE", { rank: 3, priority: "7" }), w("older-high", "CALL", "ELIGIBLE", { rank: 3, priority: "7", createdAt: "2026-08-01T00:00:00Z" })];
    expect(orderWork(items, now).map((x) => x.id)).toEqual(["older-high", "new-high", "old-low"]);
  });

  it("short status codes", () => {
    expect(workStatusCode(w("a", "CALLBACK", "ELIGIBLE", { dueAt: "2026-10-30T07:59:00Z" }), now)).toBe("CALLBACK_DUE");
    expect(workStatusCode(w("a", "CALLBACK", "ELIGIBLE", { dueAt: "2026-10-31T07:59:00Z" }), now)).toBe("CALLBACK");
    expect(workStatusCode(w("a", "CALLBACK", "DEFERRED"), now)).toBe("CALLBACK_BLOCKED");
    expect(workStatusCode(w("a", "CALL", "ELIGIBLE"), now)).toBe("CALL_READY");
    expect(workStatusCode(w("a", "CALL", "DEFERRED"), now)).toBe("CALL_BLOCKED");
    expect(workStatusCode(w("a", "CALL", "IN_PROGRESS"), now)).toBe("IN_CALL");
    expect(workStatusCode(w("a", "MANUAL_REVIEW", "QUEUED"), now)).toBe("MANUAL_REVIEW");
  });
});
