import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTrace } from "./client";
import { readTraceRunConfig } from "./config";
import { createTraceLimiter } from "./limits";
import { selectQuestionContent } from "./question-content";
import { handleTraceRequest } from "./route-handler";
import { selectTraceProviders } from "./select-provider";
import { initialTraceState, traceReducer } from "./trace-state";
import { toTraceErrorInfo } from "./client";
import { LIVE_CONTENT_WAIT_MS } from "./use-question-content";

// With the live trace on by default, a server without DEEPSEEK_API_KEY must send the learner to the stored content
// at once, not after the 45 s wait. This follows the real code path with fake timers: no timer is allowed to pass.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("no DEEPSEEK_API_KEY (and TRACE_PROVIDER not set)", () => {
  const env = {}; // nothing configured: the provider defaults to "deepseek" and has no key

  it("selectTraceProviders reports not_configured without any network call", () => {
    expect(selectTraceProviders(env)).toEqual({ ok: false, reason: "not_configured" });
    expect(selectTraceProviders({ DEEPSEEK_API_KEY: "   " })).toEqual({ ok: false, reason: "not_configured" });
  });

  it("the route answers 503 at once, without taking a limiter slot or saving a row", async () => {
    const limiter = createTraceLimiter({ maxPerHour: 1 });
    const store = { saveTrace: vi.fn(), findReusableTrace: vi.fn(async () => null) };
    const request = () => new Request("http://localhost/api/trace", { method: "POST", body: JSON.stringify({ questionId: 1 }) });
    const deps = {
      getUserId: async () => "7",
      findQuestion: async () => ({ id: 1, question: "q" }),
      selectProviders: () => selectTraceProviders(env),
      config: readTraceRunConfig(env),
      limiter,
      store,
    };
    for (let i = 0; i < 3; i++) expect((await handleTraceRequest(request(), deps)).status).toBe(503);
    expect(store.saveTrace).not.toHaveBeenCalled();
    expect(limiter.tryStart(7).ok).toBe(true); // the hourly slot was never used
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the learner goes from loading to the stored content with no timer passing", async () => {
    const deps = {
      getUserId: async () => "7",
      findQuestion: async () => ({ id: 1, question: "q" }),
      selectProviders: () => selectTraceProviders(env),
      config: readTraceRunConfig(env),
      limiter: createTraceLimiter(),
      store: { saveTrace: vi.fn(), findReusableTrace: vi.fn(async () => null) },
    };
    const fetchImpl = ((_url: unknown, init: RequestInit) => handleTraceRequest(new Request("http://localhost/api/trace", init), deps)) as unknown as typeof fetch;

    // what useTrace does: start (loading), then the result of fetchTrace
    let state = traceReducer(initialTraceState, { type: "start", requestId: 1, questionId: 1 });
    const before = selectQuestionContent({ enabled: true, storedContent: "stored text", status: state.status, liveContent: null, timedOut: false });
    expect(before).toEqual({ content: "stored text", source: "stored", loading: true });

    const error = await fetchTrace(1, { fetchImpl }).then(() => null, (e: unknown) => toTraceErrorInfo(e));
    expect(error?.code).toBe("not_configured");
    state = traceReducer(state, { type: "fail", requestId: 1, error: error! });

    const after = selectQuestionContent({ enabled: true, storedContent: "stored text", status: state.status === "error" ? "error" : "loading", liveContent: null, timedOut: false });
    expect(after).toEqual({ content: "stored text", source: "stored", loading: false });
    expect(vi.getTimerCount()).toBe(0); // nothing waited: the 45 s timer was never needed
    expect(LIVE_CONTENT_WAIT_MS).toBe(45_000);
  });
});
