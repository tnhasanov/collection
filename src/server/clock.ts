import { bakuBusinessDate, type IsoDate } from "@/server/dates";

/**
 * Clock abstraction. Two clocks exist conceptually:
 *  - the business date drives portfolio calculations (DPD, due dates, cohorts);
 *  - the actual clock drives dispatch restrictions (quiet hours, cooldown expiry).
 * In DEMO mode an offset clock anchors the seeded business date (27 Oct 2026, Asia/Baku) to the
 * moment of seeding and lets time advance from there, so seeded cooldowns and deadlines stay coherent.
 * INTEGRATION mode always uses the real clock.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class OffsetClock implements Clock {
  constructor(public readonly offsetMs: number) {}
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
}

export class FixedClock implements Clock {
  constructor(private at: Date) {}
  now(): Date {
    return new Date(this.at.getTime());
  }
  set(at: Date) {
    this.at = at;
  }
  advance(ms: number) {
    this.at = new Date(this.at.getTime() + ms);
  }
}

export const DEMO_BUSINESS_DATE: IsoDate = "2026-10-27";
export const DEMO_SEED_INSTANT = new Date("2026-10-27T06:00:00.000Z"); // 10:00 Asia/Baku (UTC+4)

let cached: { clock: Clock; loadedAt: number } | null = null;
let override: Clock | null = null;

/** Tests and the worker can pin a clock explicitly. */
export function setClockOverride(clock: Clock | null) {
  override = clock;
  cached = null;
}

export async function getClock(): Promise<Clock> {
  if (override) return override;
  if (process.env.APP_MODE !== "DEMO" || process.env.DEMO_CLOCK_MODE === "real") return new SystemClock();
  if (cached && Date.now() - cached.loadedAt < 15_000) return cached.clock;
  // Lazy import keeps this module usable in pure unit tests.
  const { prisma } = await import("@/server/db");
  const setting = await prisma.setting.findUnique({ where: { key: "clock.demoOffsetMs" } });
  const offset = typeof setting?.value === "number" ? setting.value : 0;
  const clock = new OffsetClock(offset);
  cached = { clock, loadedAt: Date.now() };
  return clock;
}

/**
 * Synchronous access to the domain clock for callers that cannot await (the mock provider adapter stamps its
 * events with it). The worker primes the cache with getClock() before any adapter use and refreshes it every tick;
 * outside DEMO offset mode this is simply the system clock.
 */
export function getClockSync(): Clock {
  if (override) return override;
  if (process.env.APP_MODE !== "DEMO" || process.env.DEMO_CLOCK_MODE === "real") return new SystemClock();
  return cached?.clock ?? new OffsetClock(0);
}

export async function now(): Promise<Date> {
  return (await getClock()).now();
}

export async function businessDate(): Promise<IsoDate> {
  return bakuBusinessDate(await now());
}
