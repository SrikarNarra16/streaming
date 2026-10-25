import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeFromProvider, consumeTrace } from "./consume";
import { TRACE_ERROR_CODES, TRACE_ERROR_MESSAGES, traceError, type TraceEvent } from "./events";
import { createMockProvider, type MockProviderConfig } from "./mock-provider";
import type { TraceProvider } from "./provider";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const r = (text: string): TraceEvent => ({ type: "reasoning_delta", text });
const a = (text: string): TraceEvent => ({ type: "answer_delta", text });
const done: TraceEvent = { type: "done", model: "m", servedModel: "served", finishReason: "stop", usage: { totalTokens: 7 } };

async function* from(...events: TraceEvent[]): AsyncGenerator<TraceEvent> {
  for (const event of events) yield event;
}

// Wraps a mock provider so a test can see the abort signal it received and whether it was shut down.
function watched(config: Partial<MockProviderConfig>) {
  const info = { signal: undefined as AbortSignal | undefined, finished: false };
  const base = createMockProvider({ reasoning: "one two three four five six", answer: "alpha beta gamma delta", chunkWords: 2, ...config });
  const provider: TraceProvider = {
    stream(req) {
      info.signal = req.signal;
      return (async function* () {
        try {
          yield* base.stream(req);
        } finally {
          info.finished = true;
        }
      })();
    },
  };
  return { provider, info };
}

describe("statuses", () => {
  it("complete: reasoning, answer and done", async () => {
    const onReasoning = vi.fn();
    const onAnswer = vi.fn();
    const res = await consumeTrace(from(r("think "), r("more"), a("the "), a("answer"), done), { onReasoning, onAnswer });
    expect(res).toEqual({
      status: "complete",
      reasoning: "think more",
      answer: "the answer",
      warnings: [],
      model: "m",
      servedModel: "served",
      finishReason: "stop",
      usage: { totalTokens: 7 },
    });
    expect(onReasoning.mock.calls).toEqual([["think "], ["more"]]);
    expect(onAnswer.mock.calls).toEqual([["the "], ["answer"]]);
  });

  it("complete with a warning when done arrives without any answer (mock no-answer)", async () => {
    const { provider } = watched({ failure: { mode: "no-answer" } });
    const res = await consumeFromProvider(provider, "q");
    expect(res.status).toBe("complete");
    expect(res.answer).toBe("");
    expect(res.warnings).toEqual(["finished_without_answer"]);
  });

  it("complete with a warning when the stream ends after an answer without a done event", async () => {
    const res = await consumeTrace(from(r("x"), a("answer")));
    expect(res.status).toBe("complete");
    expect(res.warnings).toEqual(["stream_ended_without_done"]);
  });

  it("failed when the stream ends before any answer and without done, keeping the reasoning", async () => {
    const res = await consumeTrace(from(r("only thinking")));
    expect(res).toMatchObject({ status: "failed", reasoning: "only thinking", answer: "" });
    expect(res.error?.code).toBe("upstream");
  });

  it("failed on an error event during reasoning (mock error-mid-reasoning), keeping the partial reasoning", async () => {
    const { provider } = watched({ failure: { mode: "error-mid-reasoning", afterChunks: 2 } });
    const res = await consumeFromProvider(provider, "q");
    expect(res.status).toBe("failed");
    expect(res.reasoning).toBe("one two three four");
    expect(res.error).toEqual({ code: "upstream", message: TRACE_ERROR_MESSAGES.upstream });
  });

  it("failed on an error event before anything arrived", async () => {
    const res = await consumeTrace(from(traceError("limit")));
    expect(res).toMatchObject({ status: "failed", reasoning: "", answer: "" });
    expect(res.error?.code).toBe("limit");
  });

  it("partial on an error event during the answer", async () => {
    const res = await consumeTrace(from(r("thinking"), a("half an ans"), traceError("upstream")));
    expect(res).toMatchObject({ status: "partial", reasoning: "thinking", answer: "half an ans" });
    expect(res.error?.code).toBe("upstream");
  });

  it("complete with a warning when an error arrives after the full answer (mock error-after-answer)", async () => {
    const { provider } = watched({ failure: { mode: "error-after-answer" } });
    const res = await consumeFromProvider(provider, "q");
    expect(res.status).toBe("complete");
    expect(res.answer).toBe("alpha beta gamma delta");
    expect(res.warnings).toEqual(["error_after_answer"]);
    expect(res.error).toBeUndefined();
  });

  it("complete with a warning when the stream does not close after done (drain timeout)", async () => {
    async function* hangsAfterDone(): AsyncGenerator<TraceEvent> {
      yield r("x");
      yield a("answer");
      yield done;
      await new Promise(() => {}); // never closes
    }
    const abortUpstream = vi.fn();
    const promise = consumeTrace(hangsAfterDone(), { drainTimeoutMs: 500, idleTimeoutMs: 60000, abortUpstream });
    await vi.advanceTimersByTimeAsync(500);
    const res = await promise;
    expect(res.status).toBe("complete");
    expect(res.warnings).toEqual(["timeout_after_answer"]);
    expect(abortUpstream).toHaveBeenCalledTimes(1);
  });

  it("ignores unknown events and events after done, with warnings", async () => {
    const weird = { type: "mystery" } as unknown as TraceEvent;
    const res = await consumeTrace(from(r("x"), weird, a("answer"), done, a("late")));
    expect(res).toMatchObject({ status: "complete", answer: "answer" });
    expect(res.warnings).toEqual(["ignored_unknown_event", "events_after_done"]);
  });

  it("a throwing stream is handled like an upstream error", async () => {
    async function* broken(): AsyncGenerator<TraceEvent> {
      yield r("partial thought");
      throw new Error("boom");
    }
    const res = await consumeTrace(broken());
    expect(res).toMatchObject({ status: "failed", reasoning: "partial thought" });
    expect(res.error?.code).toBe("upstream");
  });

  it("a callback that throws only adds a warning", async () => {
    const res = await consumeTrace(from(r("x"), a("y"), done), {
      onReasoning: () => {
        throw new Error("ui bug");
      },
    });
    expect(res.status).toBe("complete");
    expect(res.warnings).toEqual(["callback_error"]);
  });
});

describe("idle timeout", () => {
  it("during reasoning: failed with a timeout error, the provider is aborted, nothing is left running", async () => {
    const { provider, info } = watched({ failure: { mode: "stall", afterChunks: 2 } });
    const promise = consumeFromProvider(provider, "q", { idleTimeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    const res = await promise;
    expect(res.status).toBe("failed");
    expect(res.reasoning).toBe("one two three four");
    expect(res.error).toEqual({ code: "timeout", message: TRACE_ERROR_MESSAGES.timeout });
    expect(info.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(info.finished).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("during the answer: partial", async () => {
    const { provider, info } = watched({ reasoning: "a b", answer: "c d e f", failure: { mode: "stall", afterChunks: 2 } });
    const promise = consumeFromProvider(provider, "q", { idleTimeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    const res = await promise;
    expect(res).toMatchObject({ status: "partial", reasoning: "a b", answer: "c d" });
    expect(res.error?.code).toBe("timeout");
    await vi.advanceTimersByTimeAsync(0);
    expect(info.finished).toBe(true);
  });

  it("is measured between events and restarts on every event, not over the total time", async () => {
    async function* slow(): AsyncGenerator<TraceEvent> {
      for (const event of [r("a"), r("b"), r("c"), a("d"), a("e"), done]) {
        await new Promise((resolve) => setTimeout(resolve, 20000)); // 20 s < 30 s each time, 120 s in total
        yield event;
      }
    }
    const promise = consumeTrace(slow(), { idleTimeoutMs: 30000 });
    await vi.advanceTimersByTimeAsync(130000);
    const res = await promise;
    expect(res.status).toBe("complete");
    expect(res.error).toBeUndefined();
  });

  it("fires when a single gap is longer than the limit", async () => {
    async function* gap(): AsyncGenerator<TraceEvent> {
      yield r("a");
      await new Promise((resolve) => setTimeout(resolve, 31000));
      yield a("late");
    }
    const promise = consumeTrace(gap(), { idleTimeoutMs: 30000 });
    await vi.advanceTimersByTimeAsync(30000);
    const res = await promise;
    expect(res.status).toBe("failed");
    expect(res.error?.code).toBe("timeout");
    expect(res.reasoning).toBe("a");
  });

  it("uses 30 seconds by default", async () => {
    async function* silent(): AsyncGenerator<TraceEvent> {
      await new Promise((resolve) => setTimeout(resolve, 40000));
      yield r("x");
    }
    const promise = consumeTrace(silent());
    await vi.advanceTimersByTimeAsync(29999);
    let settled = false;
    void promise.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await promise).error?.code).toBe("timeout");
  });

  it("clears its timer when the stream completes", async () => {
    await consumeTrace(from(r("x"), a("y"), done));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer when the stream fails", async () => {
    await consumeTrace(from(r("x"), traceError("upstream")));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("cancellation", () => {
  it("cancelled when the caller aborts mid-stream; the provider is aborted and shut down", async () => {
    const { provider, info } = watched({ reasoning: "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10", chunkWords: 1, delayMs: 100 });
    const controller = new AbortController();
    const promise = consumeFromProvider(provider, "q", { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(250); // two chunks so far
    controller.abort();
    const res = await promise;
    expect(res.status).toBe("cancelled");
    expect(res.reasoning).toBe("w1 w2");
    expect(info.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(info.finished).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancelled straight away when the signal is already aborted", async () => {
    const { provider, info } = watched({});
    const controller = new AbortController();
    controller.abort();
    const res = await consumeFromProvider(provider, "q", { signal: controller.signal });
    expect(res).toMatchObject({ status: "cancelled", reasoning: "", answer: "" });
    expect(info.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("truncation", () => {
  it("stops after maxReasoningWords, aborts the provider and keeps what was received", async () => {
    const { provider, info } = watched({
      reasoning: Array.from({ length: 20 }, (_, i) => `w${i + 1}`).join(" "),
      chunkWords: 2,
    });
    const res = await consumeFromProvider(provider, "q", { maxReasoningWords: 5 });
    expect(res.status).toBe("truncated");
    expect(res.reasoning).toBe("w1 w2 w3 w4 w5 w6"); // the chunk that crossed the limit is kept whole
    expect(res.answer).toBe("");
    expect(info.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(info.finished).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not truncate a reasoning that stays within the limit", async () => {
    const res = await consumeTrace(from(r("one two three"), a("answer"), done), { maxReasoningWords: 3 });
    expect(res.status).toBe("complete");
  });

  it("counts words across chunk boundaries", async () => {
    const res = await consumeTrace(from(r("hel"), r("lo wor"), r("ld ok"), a("x"), done), { maxReasoningWords: 3 });
    expect(res.status).toBe("complete"); // "hello world ok" is 3 words, not more
  });
});

describe("error messages never leak", () => {
  it("replaces any message carried by an error event", async () => {
    for (const code of TRACE_ERROR_CODES) {
      const dirty = { type: "error", code, message: "401 Bearer sk-abc123 https://user:pw@host" } as TraceEvent;
      const res = await consumeTrace(from(r("x"), dirty));
      expect(res.error?.message).toBe(TRACE_ERROR_MESSAGES[code]);
      expect(JSON.stringify(res)).not.toMatch(/sk-|Bearer|https?:/);
    }
  });

  it("does not copy the message of an exception thrown by the stream", async () => {
    async function* leaky(): AsyncGenerator<TraceEvent> {
      yield r("x");
      throw new Error("failed with key sk-SECRET123 and header Bearer abc");
    }
    const res = await consumeTrace(leaky());
    expect(res.error).toEqual({ code: "upstream", message: TRACE_ERROR_MESSAGES.upstream });
    expect(JSON.stringify(res)).not.toMatch(/sk-|Bearer/);
  });

  it("every generic message is free of key-like text", () => {
    for (const message of Object.values(TRACE_ERROR_MESSAGES)) expect(message).not.toMatch(/sk-|Bearer/i);
  });
});
