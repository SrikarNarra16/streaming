import { describe, expect, it } from "vitest";
import { createTraceLimiter, getSharedTraceLimiter } from "./limits";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("createTraceLimiter", () => {
  it("allows one running trace per user at a time", () => {
    const limiter = createTraceLimiter({ maxPerHour: 20 });
    const first = limiter.tryStart(1);
    expect(first.ok).toBe(true);
    expect(limiter.tryStart(1)).toEqual({ ok: false, reason: "busy", retryAfterSeconds: 5 });
    if (first.ok) first.release();
    expect(limiter.tryStart(1).ok).toBe(true);
  });

  it("keeps users apart", () => {
    const limiter = createTraceLimiter({});
    expect(limiter.tryStart(1).ok).toBe(true);
    expect(limiter.tryStart(2).ok).toBe(true);
    expect(limiter.tryStart(1).ok).toBe(false);
    expect(limiter.tryStart(2).ok).toBe(false);
  });

  it("release can be called more than once without freeing a slot that belongs to a later trace", () => {
    const limiter = createTraceLimiter({});
    const first = limiter.tryStart(1);
    if (!first.ok) throw new Error("expected a slot");
    first.release();
    const second = limiter.tryStart(1);
    expect(second.ok).toBe(true);
    first.release(); // a stale, repeated release
    expect(limiter.tryStart(1).ok).toBe(false); // the second trace still holds the slot
    if (second.ok) second.release();
  });

  it("allows at most maxPerHour starts in a rolling hour, and says when to retry", () => {
    const time = clock();
    const limiter = createTraceLimiter({ maxPerHour: 3, now: time.now });
    for (let i = 0; i < 3; i++) {
      const r = limiter.tryStart(1);
      if (!r.ok) throw new Error("expected a slot");
      r.release();
      time.advance(10 * 60 * 1000); // ten minutes apart
    }
    const blocked = limiter.tryStart(1);
    expect(blocked).toMatchObject({ ok: false, reason: "hourly" });
    // the oldest start was 30 minutes ago, so it expires in 30 minutes
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBe(30 * 60);
  });

  it("is a rolling window: a slot frees up when the oldest start leaves the hour", () => {
    const time = clock();
    const limiter = createTraceLimiter({ maxPerHour: 2, now: time.now });
    const a = limiter.tryStart(1);
    if (a.ok) a.release();
    time.advance(30 * 60 * 1000);
    const b = limiter.tryStart(1);
    if (b.ok) b.release();
    expect(limiter.tryStart(1).ok).toBe(false);
    time.advance(30 * 60 * 1000 + 1); // the first start is now more than an hour old
    expect(limiter.tryStart(1).ok).toBe(true);
  });

  it("does not count a refused request as a start", () => {
    const time = clock();
    const limiter = createTraceLimiter({ maxPerHour: 1, now: time.now });
    const first = limiter.tryStart(1);
    expect(limiter.tryStart(1)).toMatchObject({ ok: false, reason: "busy" });
    expect(limiter.tryStart(1)).toMatchObject({ ok: false, reason: "busy" });
    if (first.ok) first.release();
    time.advance(60 * 60 * 1000 + 1);
    expect(limiter.tryStart(1).ok).toBe(true);
  });

  it("answers busy before hourly when both apply", () => {
    const limiter = createTraceLimiter({ maxPerHour: 1 });
    const first = limiter.tryStart(1);
    expect(limiter.tryStart(1)).toMatchObject({ reason: "busy" });
    if (first.ok) first.release();
    expect(limiter.tryStart(1)).toMatchObject({ reason: "hourly" });
  });

  it("reports at least one second to wait", () => {
    const time = clock();
    const limiter = createTraceLimiter({ maxPerHour: 1, now: time.now });
    const r = limiter.tryStart(1);
    if (r.ok) r.release();
    time.advance(60 * 60 * 1000 - 100); // 100 ms before the start leaves the window
    const blocked = limiter.tryStart(1);
    if (blocked.ok) throw new Error("expected a refusal");
    expect(blocked.retryAfterSeconds).toBe(1);
  });
});

describe("getSharedTraceLimiter", () => {
  it("returns the same limiter for the same setting (one per server process)", () => {
    expect(getSharedTraceLimiter(7)).toBe(getSharedTraceLimiter(7));
  });
});
