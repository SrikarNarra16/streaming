import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeFromProvider, consumeTrace, TRACE_WARNINGS, type TraceWarning } from "./consume";
import { traceError, type TraceEvent } from "./events";
import { createMockProvider } from "./mock-provider";
import type { TraceProvider } from "./provider";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const r = (text: string): TraceEvent => ({ type: "reasoning_delta", text });
const a = (text: string): TraceEvent => ({ type: "answer_delta", text });
const done: TraceEvent = { type: "done", model: "m" };

/** Waits `ms` before each event. After the last one it ends, or hangs forever with `hang`. */
function timeline(steps: Array<[number, TraceEvent]>, hang = false): AsyncGenerator<TraceEvent> {
  return (async function* () {
    for (const [ms, event] of steps) {
      if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
      yield event;
    }
    if (hang) await new Promise(() => {});
  })();
}

describe("firstEventTimeoutMs", () => {
  it("is the limit for the wait before the first event, even when idleTimeoutMs is shorter", async () => {
    const promise = consumeTrace(timeline([[40000, r("a")], [1000, a("b")], [1000, done]]), {
      firstEventTimeoutMs: 60000,
      idleTimeoutMs: 30000,
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect((await promise).status).toBe("complete");
  });

  it("fails a slow start when it is shorter than idleTimeoutMs", async () => {
    const abortUpstream = vi.fn();
    const promise = consumeTrace(timeline([[5000, r("a")]]), { firstEventTimeoutMs: 2000, idleTimeoutMs: 30000, abortUpstream });
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;
    expect(res).toMatchObject({ status: "failed", reasoning: "" });
    expect(res.error?.code).toBe("timeout");
    expect(abortUpstream).toHaveBeenCalledTimes(1);
  });

  it("hands over to idleTimeoutMs after the first event", async () => {
    const promise = consumeTrace(timeline([[1000, r("a")], [5000, a("b")]]), { firstEventTimeoutMs: 60000, idleTimeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(3000); // first event at 1 s, then 2 s of silence
    const res = await promise;
    expect(res).toMatchObject({ status: "failed", reasoning: "a" });
    expect(res.error?.code).toBe("timeout");
  });

  it("defaults to idleTimeoutMs", async () => {
    const promise = consumeTrace(timeline([[5000, r("a")]]), { idleTimeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await promise).error?.code).toBe("timeout");
  });

  it("aborts a provider that never produces a first event", async () => {
    let signal: AbortSignal | undefined;
    const base = createMockProvider({ reasoning: "a b", answer: "c", failure: { mode: "stall", afterChunks: 0 } });
    const provider: TraceProvider = {
      stream(req) {
        signal = req.signal;
        return base.stream(req);
      },
    };
    const promise = consumeFromProvider(provider, "q", { firstEventTimeoutMs: 1500, idleTimeoutMs: 60000 });
    await vi.advanceTimersByTimeAsync(1500);
    const res = await promise;
    expect(res.status).toBe("failed");
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("maxTotalMs", () => {
  const every20s = (events: TraceEvent[]) => timeline(events.map((e) => [20000, e] as [number, TraceEvent]));

  it("during reasoning: failed with a timeout, keeping the reasoning, and the upstream is aborted", async () => {
    const abortUpstream = vi.fn();
    const promise = consumeTrace(every20s([r("a "), r("b "), r("c "), r("d ")]), { idleTimeoutMs: 30000, maxTotalMs: 50000, abortUpstream });
    await vi.advanceTimersByTimeAsync(50000);
    const res = await promise;
    expect(res).toMatchObject({ status: "failed", reasoning: "a b " });
    expect(res.error?.code).toBe("timeout");
    expect(abortUpstream).toHaveBeenCalledTimes(1);
    // consumeTrace itself left no timer behind: only this test's own source is still sleeping
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("during the answer: partial", async () => {
    const promise = consumeTrace(timeline([[10000, r("a")], [10000, a("b")], [10000, a("c")], [60000, a("d")]]), {
      idleTimeoutMs: 30000,
      maxTotalMs: 45000,
    });
    await vi.advanceTimersByTimeAsync(45000);
    const res = await promise;
    expect(res).toMatchObject({ status: "partial", answer: "bc" });
    expect(res.error?.code).toBe("timeout");
  });

  it("after done: complete with a warning", async () => {
    const promise = consumeTrace(timeline([[1000, r("a")], [1000, a("b")], [1000, done]], true), { maxTotalMs: 4000, drainTimeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(4000); // done at 3 s, the stream never closes, the total deadline hits at 4 s
    const res = await promise;
    expect(res.status).toBe("complete");
    expect(res.warnings).toEqual(["timeout_after_answer"]);
    expect(res.error).toBeUndefined();
  });

  it("is off by default and clears its timer when the stream completes", async () => {
    const promise = consumeTrace(every20s([r("a"), a("b"), done]));
    await vi.advanceTimersByTimeAsync(60000);
    expect((await promise).status).toBe("complete");

    const withDeadline = consumeTrace(timeline([[10, r("a")], [10, a("b")], [10, done]]), { maxTotalMs: 600000 });
    await vi.advanceTimersByTimeAsync(30);
    expect((await withDeadline).status).toBe("complete");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("TraceWarning", () => {
  it("every warning the consumer can produce is a member of TRACE_WARNINGS, and all of them are produced", async () => {
    const seen = new Set<TraceWarning>();
    const note = (warnings: TraceWarning[]) => warnings.forEach((w) => seen.add(w));

    note((await consumeTrace(timeline([[0, r("x")], [0, done]]))).warnings); // finished_without_answer
    note((await consumeTrace(timeline([[0, r("x")], [0, a("y")]]))).warnings); // stream_ended_without_done
    note((await consumeTrace(timeline([[0, a("y")], [0, done], [0, traceError("upstream")]]))).warnings); // error_after_answer
    note((await consumeTrace(timeline([[0, a("y")], [0, done], [0, a("late")]]))).warnings); // events_after_done
    note((await consumeTrace(timeline([[0, { type: "mystery" } as unknown as TraceEvent], [0, a("y")], [0, done]]))).warnings); // ignored_unknown_event
    note(
      (
        await consumeTrace(timeline([[0, a("y")], [0, done]]), {
          onAnswer: () => {
            throw new Error("ui bug");
          },
        })
      ).warnings
    ); // callback_error
    const drain = consumeTrace(timeline([[0, a("y")], [0, done]], true), { drainTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    note((await drain).warnings); // timeout_after_answer

    expect([...seen].sort()).toEqual([...TRACE_WARNINGS].sort());
  });
});
