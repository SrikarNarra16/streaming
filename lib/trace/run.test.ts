import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanTrace } from "../clean-trace";
import { segmentTrace } from "../segment";
import { createTraceLimiter } from "./limits";
import { createMockProvider, type MockProviderConfig } from "./mock-provider";
import type { TraceEvent } from "./events";
import type { TraceProvider } from "./provider";
import { runTraceForUser, startTraceRun, type RunTraceInput, type TraceRow, type TraceRunLimits, type TraceStore } from "./run";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LIMITS: TraceRunLimits = { minWords: 150, maxWords: 500, firstEventTimeoutMs: 30000, idleTimeoutMs: 30000, maxTotalMs: 180000 };

const countWords = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

// Exactly `total` words in sentences of ten words, so the segmenter can split them into paragraphs.
function prose(total: number, tag: string): string {
  const sentences: string[] = [];
  let made = 0;
  let index = 0;
  while (made < total) {
    const n = Math.min(10, total - made);
    sentences.push(Array.from({ length: n }, (_, i) => (i === 0 ? `${tag.toUpperCase()}${index}` : `${tag}${index}x${i}`)).join(" ") + ".");
    made += n;
    index++;
  }
  return sentences.join(" ");
}

// A mock provider that records how it was used.
function spy(config: Partial<MockProviderConfig> & { reasoning?: string; answer?: string }) {
  const base = createMockProvider({ reasoning: "", answer: "", chunkWords: 3, ...config });
  const info = { calls: 0, prompts: [] as string[], signals: [] as AbortSignal[], emitted: 0, finished: 0 };
  const provider: TraceProvider = {
    stream(req) {
      info.calls++;
      info.prompts.push(req.prompt);
      info.signals.push(req.signal);
      return (async function* () {
        try {
          for await (const event of base.stream(req)) {
            info.emitted++;
            yield event;
          }
        } finally {
          info.finished++;
        }
      })();
    },
  };
  return { provider, info };
}

function fakeStore(options: { failWith?: unknown } = {}) {
  const rows: TraceRow[] = [];
  const store: TraceStore = {
    saveTrace: vi.fn(async (row: TraceRow) => {
      rows.push(row);
      if (options.failWith !== undefined) throw options.failWith;
    }),
  };
  return { store, rows };
}

function input(over: Partial<RunTraceInput> & Pick<RunTraceInput, "reasoningProvider" | "stepsProvider" | "store">): RunTraceInput {
  return {
    userId: 7,
    questionId: 3,
    prompt: "Write a function.",
    model: "test-model",
    setting: "auto",
    limits: LIMITS,
    signal: new AbortController().signal,
    ...over,
  };
}

async function collect(gen: AsyncGenerator<TraceEvent>): Promise<TraceEvent[]> {
  const events: TraceEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

const types = (events: TraceEvent[]) => events.map((e) => e.type);
const failingSteps = () => spy({ failure: { mode: "error-mid-reasoning", afterChunks: 0 } });
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('"auto": which text becomes the trace', () => {
  it("uses the reasoning when its cleaned word count is within the range, and never calls the steps provider", async () => {
    const reasoningText = prose(300, "r");
    const reasoning = spy({ reasoning: reasoningText, answer: "final code" });
    const steps = spy({ answer: prose(330, "s") });
    const { store, rows } = fakeStore();

    const events = await collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    expect(types(events)).toEqual(["trace_ready", "done"]);
    expect(steps.info.calls).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 7,
      questionId: 3,
      source: "reasoning",
      decisionReason: "in_range",
      model: "test-model",
      status: "ready",
      rawReasoning: reasoningText,
      stepsText: null,
      errorCode: null,
    });
    expect(rows[0].finalParagraphs).toEqual(segmentTrace(reasoningText));
    expect(rows[0].finalWords).toBe(300);
    expect(events[0]).toMatchObject({ type: "trace_ready", source: "reasoning", words: 300, model: "test-model", paragraphs: rows[0].finalParagraphs });
  });

  it("counts the words AFTER cleaning: leaked artifact words do not push a trace over the maximum", async () => {
    const text = `${prose(250, "a")} Desired oververbosity 5. ${prose(250, "b")}`; // 503 raw words, 500 after cleaning
    const reasoning = spy({ reasoning: text });
    const steps = spy({ answer: prose(330, "s") });
    const { store, rows } = fakeStore();

    await collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    expect(countWords(text)).toBe(503);
    expect(rows[0]).toMatchObject({ source: "reasoning", decisionReason: "in_range", finalWords: 500 });
    expect(reasoning.info.signals[0].aborted).toBe(false); // it was not stopped early
    expect(steps.info.calls).toBe(0);
    expect(rows[0].rawReasoning).toBe(text); // the raw text is kept as received
    expect(rows[0].finalParagraphs.join(" ")).not.toMatch(/oververbosity/i);
  });

  it("uses the steps text when the reasoning is too short", async () => {
    const reasoning = spy({ reasoning: `SECRETREASONING ${prose(80, "r")}`, answer: "x" });
    const stepsText = prose(330, "s");
    const steps = spy({ answer: stepsText });
    const { store, rows } = fakeStore();

    const events = await collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    expect(steps.info.calls).toBe(1);
    expect(steps.info.prompts[0]).toContain("Write a function."); // the steps prompt wraps the question
    expect(steps.info.prompts[0]).toContain("step by step");
    expect(types(events)).toEqual(["trace_ready", "done"]);
    expect(events[0]).toMatchObject({ source: "steps", words: 330 });
    expect(JSON.stringify(events)).not.toContain("SECRETREASONING"); // the raw reasoning never reaches the client
    expect(rows[0]).toMatchObject({ source: "steps", decisionReason: "too_short", status: "ready", stepsText });
    expect(rows[0].rawReasoning).toContain("SECRETREASONING");
  });

  it("uses the steps text when the reasoning is too long, and stops the reasoning early", async () => {
    const reasoning = spy({ reasoning: prose(900, "r"), answer: "x" });
    const steps = spy({ answer: prose(330, "s") });
    const { store, rows } = fakeStore();
    const totalChunks = 300; // 900 words in chunks of three

    const events = await collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));
    await flush();

    expect(rows[0]).toMatchObject({ source: "steps", decisionReason: "too_long", status: "ready" });
    expect(rows[0].warnings).toContain("reasoning_stopped_at_max_words");
    // stopped as soon as the cleaned reasoning passed 500 words: about 167 chunks, far fewer than all 300
    expect(reasoning.info.emitted).toBeLessThan(totalChunks);
    expect(reasoning.info.emitted).toBeGreaterThanOrEqual(167);
    expect(reasoning.info.emitted).toBeLessThanOrEqual(170);
    expect(reasoning.info.signals[0].aborted).toBe(true);
    expect(reasoning.info.finished).toBe(1);
    expect(countWords(rows[0].rawReasoning!)).toBeGreaterThan(500);
    expect(countWords(rows[0].rawReasoning!)).toBeLessThan(510);
    expect(steps.info.calls).toBe(1);
    expect(types(events)).toEqual(["trace_ready", "done"]);
  });

  it("treats a failed reasoning call as too short and goes to the steps text", async () => {
    const reasoning = spy({ reasoning: prose(300, "r"), failure: { mode: "error-mid-reasoning", afterChunks: 20 } });
    const steps = spy({ answer: prose(330, "s") });
    const { store, rows } = fakeStore();

    await collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    expect(rows[0]).toMatchObject({ source: "steps", decisionReason: "too_short" });
    expect(rows[0].warnings).toContain("reasoning_failed");
  });

  it("ends the reasoning call with an idle timeout when it stalls, then uses the steps text", async () => {
    const reasoning = spy({ reasoning: prose(300, "r"), failure: { mode: "stall", afterChunks: 2 } });
    const steps = spy({ answer: prose(330, "s") });
    const { store, rows } = fakeStore();
    const limits = { ...LIMITS, idleTimeoutMs: 1000 };

    const running = collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store, limits })));
    await vi.advanceTimersByTimeAsync(1000);
    const events = await running;
    await flush();

    expect(types(events)).toEqual(["trace_ready", "done"]);
    expect(rows[0]).toMatchObject({ source: "steps", decisionReason: "too_short" });
    expect(reasoning.info.signals[0].aborted).toBe(true);
    expect(reasoning.info.finished).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the settings", () => {
  it('"steps" never calls the reasoning provider', async () => {
    const reasoning = spy({ reasoning: prose(300, "r") });
    const steps = spy({ answer: prose(330, "s") });
    const { store, rows } = fakeStore();

    const events = await collect(runTraceForUser(input({ setting: "steps", reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    expect(reasoning.info.calls).toBe(0);
    expect(steps.info.calls).toBe(1);
    expect(events[0]).toMatchObject({ type: "trace_ready", source: "steps" });
    expect(rows[0]).toMatchObject({ source: "steps", decisionReason: "setting_steps", rawReasoning: null, status: "ready" });
  });

  it('"reasoning" never calls the steps provider, even when the reasoning is too long', async () => {
    const text = prose(900, "r");
    const reasoning = spy({ reasoning: text });
    const steps = spy({ answer: prose(330, "s") });
    const { store, rows } = fakeStore();

    const events = await collect(runTraceForUser(input({ setting: "reasoning", reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    expect(steps.info.calls).toBe(0);
    expect(rows[0]).toMatchObject({ source: "reasoning", decisionReason: "setting_reasoning", status: "ready" });
    expect(rows[0].warnings).toContain("reasoning_trimmed_to_max_words");
    expect(rows[0].finalWords).toBeLessThanOrEqual(500);
    expect(rows[0].finalParagraphs).toEqual(segmentTrace(cleanTrace(text).text).slice(0, rows[0].finalParagraphs.length));
    expect(events[0]).toMatchObject({ type: "trace_ready", source: "reasoning" });
  });

  it('"reasoning" uses a short reasoning as it is', async () => {
    const text = prose(60, "r");
    const reasoning = spy({ reasoning: text });
    const steps = spy({ answer: prose(330, "s") });
    const { store, rows } = fakeStore();

    await collect(runTraceForUser(input({ setting: "reasoning", reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    expect(steps.info.calls).toBe(0);
    expect(rows[0]).toMatchObject({ source: "reasoning", finalWords: 60 });
  });

  it('"reasoning" with no usable reasoning at all ends with a generic error', async () => {
    const reasoning = spy({ reasoning: "", failure: { mode: "error-mid-reasoning", afterChunks: 0 } });
    const steps = spy({ answer: prose(330, "s") });
    const { store, rows } = fakeStore();

    const events = await collect(runTraceForUser(input({ setting: "reasoning", reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    expect(events).toEqual([{ type: "error", code: "upstream", message: "The AI service could not process this request." }]);
    expect(steps.info.calls).toBe(0);
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "upstream", finalParagraphs: [], finalWords: 0 });
  });
});

describe("when the steps call fails", () => {
  it("cuts a too-long reasoning at the last paragraph boundary under the maximum, never mid-sentence", async () => {
    const text = prose(900, "r");
    const reasoning = spy({ reasoning: text });
    const steps = failingSteps();
    const { store, rows } = fakeStore();

    const events = await collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    const row = rows[0];
    expect(steps.info.calls).toBe(1);
    expect(row).toMatchObject({ source: "reasoning", decisionReason: "steps_failed_used_trimmed_reasoning", status: "ready" });
    expect(row.warnings).toEqual(expect.arrayContaining(["steps_failed", "decision_too_long", "reasoning_stopped_at_max_words"]));
    expect(row.finalWords).toBeLessThanOrEqual(500);
    expect(row.finalWords).toBeGreaterThan(400); // as many whole paragraphs as fit
    // whole paragraphs from the start of the segmented reasoning, each ending a sentence
    expect(row.finalParagraphs).toEqual(segmentTrace(cleanTrace(row.rawReasoning!).text).slice(0, row.finalParagraphs.length));
    for (const paragraph of row.finalParagraphs) expect(paragraph.endsWith(".")).toBe(true);
    expect(events[0]).toMatchObject({ type: "trace_ready", source: "reasoning", paragraphs: row.finalParagraphs });
  });

  it('uses a too-short reasoning as it is, with the reason "steps_failed_used_short_reasoning"', async () => {
    const text = prose(80, "r");
    const reasoning = spy({ reasoning: text });
    const steps = failingSteps();
    const { store, rows } = fakeStore();

    const events = await collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    expect(rows[0]).toMatchObject({
      source: "reasoning",
      decisionReason: "steps_failed_used_short_reasoning",
      status: "ready",
      finalWords: 80,
    });
    expect(rows[0].finalParagraphs).toEqual(segmentTrace(text));
    expect(rows[0].warnings).toEqual(expect.arrayContaining(["steps_failed", "decision_too_short"]));
    expect(types(events)).toEqual(["trace_ready", "done"]);
  });

  it("treats a steps text that broke off in the middle as a failure", async () => {
    const reasoning = spy({ reasoning: prose(80, "r") });
    const steps = spy({ answer: prose(330, "s"), failure: { mode: "stall", afterChunks: 40 } });
    const { store, rows } = fakeStore();
    const limits = { ...LIMITS, idleTimeoutMs: 1000 };

    const running = collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store, limits })));
    await vi.advanceTimersByTimeAsync(1000);
    await running;

    expect(rows[0].decisionReason).toBe("steps_failed_used_short_reasoning");
    expect(rows[0].stepsText).not.toBeNull(); // what arrived is kept for the record
    expect(rows[0].warnings).toContain("steps_failed");
  });

  it("ends with a generic error when there is nothing usable (steps failed, reasoning failed)", async () => {
    const reasoning = spy({ reasoning: "", failure: { mode: "error-mid-reasoning", afterChunks: 0 } });
    const steps = failingSteps();
    const { store, rows } = fakeStore();

    const events = await collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    expect(events).toEqual([{ type: "error", code: "upstream", message: "The AI service could not process this request." }]);
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "upstream", finalParagraphs: [] });
  });

  it('with the "steps" setting there is no reasoning to fall back on, so it ends with an error', async () => {
    const reasoning = spy({ reasoning: prose(300, "r") });
    const steps = failingSteps();
    const { store, rows } = fakeStore();

    const events = await collect(runTraceForUser(input({ setting: "steps", reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    expect(types(events)).toEqual(["error"]);
    expect(reasoning.info.calls).toBe(0);
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "upstream" });
  });
});

describe("what the client receives", () => {
  it("is only trace_ready followed by done, or a generic error: never the raw deltas", async () => {
    const reasoning = spy({ reasoning: prose(300, "r"), answer: "ANSWERCODE final" });
    const steps = spy({ answer: prose(330, "s") });
    const { store } = fakeStore();

    const events = await collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("trace_ready");
    expect(events[1]).toEqual({ type: "done", model: "test-model" });
    expect(JSON.stringify(events)).not.toContain("ANSWERCODE");
    expect(types(events)).not.toContain("reasoning_delta");
    expect(types(events)).not.toContain("answer_delta");
  });

  it("segments the final text with the segmenter", async () => {
    const reasoning = spy({ reasoning: prose(300, "r") });
    const steps = spy({});
    const { store } = fakeStore();
    const [ready] = await collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store })));
    if (ready.type !== "trace_ready") throw new Error("expected trace_ready");
    expect(ready.paragraphs.length).toBeGreaterThan(3);
    expect(ready.paragraphs.every((p) => p.trim() !== "")).toBe(true);
  });
});

describe("the store is called exactly once", () => {
  it("on a normal ending", async () => {
    const { store } = fakeStore();
    await collect(runTraceForUser(input({ reasoningProvider: spy({ reasoning: prose(300, "r") }).provider, stepsProvider: spy({}).provider, store })));
    expect(store.saveTrace).toHaveBeenCalledTimes(1);
  });

  it("on a failure", async () => {
    const { store, rows } = fakeStore();
    await collect(runTraceForUser(input({ setting: "steps", reasoningProvider: spy({}).provider, stepsProvider: failingSteps().provider, store })));
    expect(store.saveTrace).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe("failed");
  });

  it("when the client cancels during the reasoning call (and the provider is aborted)", async () => {
    const reasoning = spy({ reasoning: prose(300, "r"), delayMs: 100, chunkWords: 1 });
    const steps = spy({ answer: prose(330, "s") });
    const { store, rows } = fakeStore();
    const controller = new AbortController();

    const running = collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: steps.provider, store, signal: controller.signal })));
    await vi.advanceTimersByTimeAsync(250);
    controller.abort();
    const events = await running;
    await flush();

    expect(events).toEqual([{ type: "error", code: "cancelled", message: "The request was cancelled." }]);
    expect(store.saveTrace).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ status: "cancelled", errorCode: "cancelled" });
    expect(rows[0].rawReasoning).not.toBeNull(); // what had arrived is kept
    expect(reasoning.info.signals[0].aborted).toBe(true);
    expect(reasoning.info.finished).toBe(1);
    expect(steps.info.calls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("when the client cancels during the steps call", async () => {
    const steps = spy({ answer: prose(330, "s"), delayMs: 100, chunkWords: 1 });
    const { store, rows } = fakeStore();
    const controller = new AbortController();

    const running = collect(runTraceForUser(input({ setting: "steps", reasoningProvider: spy({}).provider, stepsProvider: steps.provider, store, signal: controller.signal })));
    await vi.advanceTimersByTimeAsync(250);
    controller.abort();
    await running;
    await flush();

    expect(store.saveTrace).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ status: "cancelled", source: "steps" });
    expect(steps.info.signals[0].aborted).toBe(true);
  });

  it("when the signal was already aborted before the run started", async () => {
    const controller = new AbortController();
    controller.abort();
    const reasoning = spy({ reasoning: prose(300, "r") });
    const { store, rows } = fakeStore();

    const events = await collect(runTraceForUser(input({ reasoningProvider: reasoning.provider, stepsProvider: spy({}).provider, store, signal: controller.signal })));

    expect(types(events)).toEqual(["error"]);
    expect(store.saveTrace).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe("cancelled");
    expect(reasoning.info.emitted).toBe(0);
  });

  it("when the reader stops after the first event", async () => {
    const { store, rows } = fakeStore();
    const gen = runTraceForUser(input({ reasoningProvider: spy({ reasoning: prose(300, "r") }).provider, stepsProvider: spy({}).provider, store }));
    const first = await gen.next();
    expect(first.value).toMatchObject({ type: "trace_ready" });
    await gen.return(undefined);
    expect(store.saveTrace).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe("ready");
  });

  it("when a provider throws as soon as it is called (and the steps text is empty too)", async () => {
    const exploding: TraceProvider = {
      stream() {
        throw new Error("provider bug");
      },
    };
    const { store, rows } = fakeStore();
    const events = await collect(runTraceForUser(input({ reasoningProvider: exploding, stepsProvider: spy({}).provider, store })));
    expect(types(events)).toEqual(["error"]);
    expect(store.saveTrace).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "upstream" });
  });

  it("when the run itself throws unexpectedly inside the pipeline", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenLimits = { ...LIMITS };
    Object.defineProperty(brokenLimits, "maxWords", {
      get() {
        throw new TypeError("limits are broken: sk-INTERNAL");
      },
    });
    const { store, rows } = fakeStore();

    const events = await collect(
      runTraceForUser(input({ reasoningProvider: spy({ reasoning: prose(300, "r") }).provider, stepsProvider: spy({}).provider, store, limits: brokenLimits }))
    );

    expect(events).toEqual([{ type: "error", code: "upstream", message: "The AI service could not process this request." }]);
    expect(store.saveTrace).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "upstream" });
    expect(consoleError.mock.calls).toEqual([["[trace] run failed:", "TypeError"]]); // the name only
  });
});

describe("a failing store", () => {
  it("does not break the response and is logged only by its error name", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = fakeStore({ failWith: new Error("connection to db failed, password sk-DBSECRET, Bearer abc") });

    const events = await collect(runTraceForUser(input({ reasoningProvider: spy({ reasoning: prose(300, "r") }).provider, stepsProvider: spy({}).provider, store })));

    expect(types(events)).toEqual(["trace_ready", "done"]);
    expect(store.saveTrace).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls).toEqual([["[trace] could not save the trace:", "Error"]]);
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/sk-|Bearer|password/i);
  });

  it("copes with a store that throws something that is not an Error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = fakeStore({ failWith: "plain string with sk-LEAK" });
    const events = await collect(runTraceForUser(input({ reasoningProvider: spy({ reasoning: prose(300, "r") }).provider, stepsProvider: spy({}).provider, store })));
    expect(types(events)).toEqual(["trace_ready", "done"]);
  });
});

describe("limiter slots (startTraceRun)", () => {
  const start = (limiter = createTraceLimiter({ maxPerHour: 100 }), over: Partial<RunTraceInput> = {}) => {
    const { store, rows } = fakeStore();
    const reasoning = spy({ reasoning: prose(300, "r") });
    const run = startTraceRun(
      limiter,
      input({ reasoningProvider: reasoning.provider, stepsProvider: spy({ answer: prose(330, "s") }).provider, store, ...over })
    );
    return { limiter, run, rows, reasoning };
  };

  it("holds the user's slot while the trace runs, and refuses a second one", async () => {
    const slow = spy({ reasoning: prose(300, "r"), delayMs: 100, chunkWords: 1 });
    const limiter = createTraceLimiter({ maxPerHour: 100 });
    const { store } = fakeStore();
    const run = startTraceRun(limiter, input({ reasoningProvider: slow.provider, stepsProvider: spy({}).provider, store }));
    if (!run.ok) throw new Error("expected to start");
    const running = collect(run.events);
    await vi.advanceTimersByTimeAsync(50);
    expect(limiter.tryStart(7)).toMatchObject({ ok: false, reason: "busy" });
    await vi.advanceTimersByTimeAsync(60000);
    await running;
    expect(limiter.tryStart(7).ok).toBe(true);
  });

  it("releases the slot when the trace succeeds", async () => {
    const { limiter, run } = start();
    if (!run.ok) throw new Error("expected to start");
    await collect(run.events);
    expect(limiter.tryStart(7).ok).toBe(true);
  });

  it("releases the slot when the trace fails", async () => {
    const { limiter, run } = start(undefined, { setting: "steps", stepsProvider: failingSteps().provider });
    if (!run.ok) throw new Error("expected to start");
    expect(types(await collect(run.events))).toEqual(["error"]);
    expect(limiter.tryStart(7).ok).toBe(true);
  });

  it("releases the slot when the client cancels", async () => {
    const controller = new AbortController();
    const slow = spy({ reasoning: prose(300, "r"), delayMs: 100, chunkWords: 1 });
    const limiter = createTraceLimiter({ maxPerHour: 100 });
    const { store } = fakeStore();
    const run = startTraceRun(limiter, input({ reasoningProvider: slow.provider, stepsProvider: spy({}).provider, store, signal: controller.signal }));
    if (!run.ok) throw new Error("expected to start");
    const running = collect(run.events);
    await vi.advanceTimersByTimeAsync(250);
    controller.abort();
    await running;
    expect(limiter.tryStart(7).ok).toBe(true);
  });

  it("releases the slot when the reader stops early", async () => {
    const { limiter, run } = start();
    if (!run.ok) throw new Error("expected to start");
    await run.events.next();
    await run.events.return(undefined);
    expect(limiter.tryStart(7).ok).toBe(true);
  });

  it("releases the slot when the provider throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exploding: TraceProvider = {
      stream() {
        throw new Error("boom");
      },
    };
    const { limiter, run } = start(undefined, { reasoningProvider: exploding });
    if (!run.ok) throw new Error("expected to start");
    await collect(run.events);
    expect(limiter.tryStart(7).ok).toBe(true);
  });

  it("the caller can release a slot whose events were never read, and a repeat is harmless", () => {
    const { limiter, run } = start();
    if (!run.ok) throw new Error("expected to start");
    expect(limiter.tryStart(7).ok).toBe(false);
    run.release();
    run.release();
    expect(limiter.tryStart(7).ok).toBe(true);
  });

  it("returns the refusal from the limiter", () => {
    const limiter = createTraceLimiter({ maxPerHour: 100 });
    const first = start(limiter);
    expect(first.run.ok).toBe(true);
    const second = start(limiter);
    expect(second.run).toMatchObject({ ok: false, reason: "busy", retryAfterSeconds: 5 });
  });
});

describe("nothing key-like in events, rows or logs", () => {
  it("keeps upstream error text out of everything", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky: TraceProvider = {
      stream() {
        return (async function* (): AsyncGenerator<TraceEvent> {
          yield { type: "reasoning_delta", text: "thinking " };
          throw new Error("401 Incorrect API key sk-LIVEKEY123, header Bearer abc, https://user:pw@api.example.com");
        })();
      },
    };
    const { store, rows } = fakeStore();

    const events = await collect(runTraceForUser(input({ setting: "steps", reasoningProvider: leaky, stepsProvider: leaky, store })));

    expect(events).toEqual([{ type: "error", code: "upstream", message: "The AI service could not process this request." }]);
    const everything = JSON.stringify([events, rows, consoleError.mock.calls]);
    expect(everything).not.toMatch(/sk-|Bearer|https?:|Incorrect|user:pw/);
  });

  it("replaces an error message that arrives from a provider event", async () => {
    const dirty: TraceProvider = {
      stream() {
        return (async function* (): AsyncGenerator<TraceEvent> {
          yield { type: "error", code: "limit", message: "Bearer sk-abc123 at https://u:p@h" };
        })();
      },
    };
    const { store, rows } = fakeStore();
    const events = await collect(runTraceForUser(input({ setting: "steps", reasoningProvider: dirty, stepsProvider: dirty, store })));
    expect(JSON.stringify([events, rows])).not.toMatch(/sk-|Bearer|https?:/);
  });
});
