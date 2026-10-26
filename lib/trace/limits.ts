// Per-user limits for the live trace: at most one trace running at a time, and at most `maxPerHour`
// traces started in any rolling hour.
//
// IMPORTANT: this is kept in memory, so it is per server process. It is not shared between several
// server instances, and it starts from zero when the process restarts. It is a guard against a runaway
// client or accidental repeated clicks, not a hard billing cap.

export interface TraceLimiterOptions {
  /** Traces per user per rolling window. Default 20. */
  maxPerHour?: number;
  /** Window length in milliseconds. Default one hour. */
  windowMs?: number;
  /** Injectable clock (milliseconds), for tests. */
  now?: () => number;
}

export type TraceStartResult =
  | { ok: true; /** Gives the slot back. Safe to call more than once. */ release: () => void }
  | { ok: false; reason: "busy" | "hourly"; retryAfterSeconds: number };

export interface TraceLimiter {
  tryStart(userId: number): TraceStartResult;
}

const BUSY_RETRY_SECONDS = 5;

export function createTraceLimiter(options: TraceLimiterOptions = {}): TraceLimiter {
  const maxPerHour = options.maxPerHour ?? 20;
  const windowMs = options.windowMs ?? 60 * 60 * 1000;
  const now = options.now ?? Date.now;
  const users = new Map<number, { active: boolean; starts: number[] }>();

  return {
    tryStart(userId) {
      const time = now();
      const entry = users.get(userId) ?? { active: false, starts: [] };
      entry.starts = entry.starts.filter((t) => t > time - windowMs);

      if (entry.active) {
        users.set(userId, entry);
        return { ok: false, reason: "busy", retryAfterSeconds: BUSY_RETRY_SECONDS };
      }
      if (entry.starts.length >= maxPerHour) {
        users.set(userId, entry);
        const retryAfterMs = entry.starts[0] + windowMs - time;
        return { ok: false, reason: "hourly", retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }

      entry.active = true;
      entry.starts.push(time);
      users.set(userId, entry);

      let released = false;
      return {
        ok: true,
        release() {
          if (released) return;
          released = true;
          entry.active = false;
          // forget users with nothing left to remember
          if (entry.starts.every((t) => t <= now() - windowMs)) users.delete(userId);
        },
      };
    },
  };
}

let shared: { maxPerHour: number; limiter: TraceLimiter } | undefined;

/** The limiter used by the route: one per server process, created on first use. */
export function getSharedTraceLimiter(maxPerHour: number): TraceLimiter {
  if (!shared || shared.maxPerHour !== maxPerHour) shared = { maxPerHour, limiter: createTraceLimiter({ maxPerHour }) };
  return shared.limiter;
}
