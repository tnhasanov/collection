import { AppError } from "@/server/errors";

/**
 * Small in-memory sliding-window limiter for the local sign-in endpoint (per client IP and per username).
 * It protects a single-instance pilot from credential guessing; a multi-instance deployment must move this to a
 * shared store (Postgres or Redis), which is documented in DEPLOYMENT.md. Entries expire with their window.
 */
const WINDOW_MS = 15 * 60_000;
const LIMITS = { ip: 30, user: 8 } as const;
const buckets = new Map<string, number[]>();

function prune(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, v] of buckets) if (v.every((t) => now - t > WINDOW_MS)) buckets.delete(k);
}

export function checkLoginRateLimit(parts: { ip?: string | null; username?: string | null }, now = Date.now()) {
  prune(now);
  const keys: [string, number][] = [];
  if (parts.ip) keys.push([`ip:${parts.ip}`, LIMITS.ip]);
  if (parts.username) keys.push([`user:${parts.username.toLowerCase()}`, LIMITS.user]);
  for (const [key, limit] of keys) {
    const hits = (buckets.get(key) ?? []).filter((t) => now - t <= WINDOW_MS);
    buckets.set(key, hits);
    if (hits.length >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((WINDOW_MS - (now - hits[0])) / 1000));
      throw new AppError(429, "RATE_LIMITED", `Too many sign-in attempts; try again in ${Math.ceil(retryAfterSec / 60)} min`, { retryAfterSec });
    }
  }
}

/** Records a failed attempt (successful sign-ins are not counted so a legitimate user is never locked by their own activity). */
export function recordLoginFailure(parts: { ip?: string | null; username?: string | null }, now = Date.now()) {
  for (const key of [parts.ip ? `ip:${parts.ip}` : null, parts.username ? `user:${parts.username.toLowerCase()}` : null]) {
    if (!key) continue;
    buckets.set(key, [...(buckets.get(key) ?? []).filter((t) => now - t <= WINDOW_MS), now]);
  }
}

/** Test hook. */
export function resetLoginRateLimit() {
  buckets.clear();
}
