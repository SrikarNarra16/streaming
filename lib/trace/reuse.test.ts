import { describe, expect, it, vi } from "vitest";
import { createTraceLimiter } from "./limits";
import { createMemoryTraceStore } from "./memory-store";
import { createMockProvider, type MockProviderConfig } from "./mock-provider";
import { readTraceRunConfig } from "./config";
import { isTraceEvent, type TraceEvent } from "./events";
import type { TraceProvider } from "./provider";
import { handleTraceRequest, type TraceRouteDeps } from "./route-handler";
import { readyEvents, runTraceForUser, startTraceRun, toReusableTrace, type RunTraceInput, type TraceRow, type TraceRunLimits, type TraceStore } from "./run";

const LIMITS: TraceRunLimits = { minWords: 150, maxWords: 500, firstEventTimeoutMs: 30000, idleTimeoutMs: 30000, maxTotalMs: 180000 };
const QUESTION = "Find the largest gap between neighbouring numbers.";

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

function spy(config: Partial<MockProviderConfig> & { reasoning?: string; answer?: string }) {
  const base = createMockProvider({ reasoning: "", answer: "", chunkWords: 50, ...config });
  const info = { calls: 0 };
  const provider: TraceProvider = {
    stream(req) {
      info.calls++;
      return base.stream(req);
    },
  };
  return { provider, info };
}

const SAVED = ["First saved paragraph about the idea of sorting and comparing neighbours.", "Second saved paragraph with the worked example and the answer."];

function savedRow(over: Partial<TraceRow> = {}): TraceRow {
  return {
    userId: 1,
    questionId: 1,
    source: "reasoning",
    decisionReason: "in_range",
    model: "saved-model",
    servedModel: null,
    status: "ready",
    rawReasoning: null,
    stepsText: null,
    finalParagraphs: SAVED,
    finalWords: 999, // wrong on purpose: the words in the event are recomputed
    usage: null,
    warnings: [],
    errorCode: null,
    totalMs: 10,
    ...over,
  };
}

function setup(rows: TraceRow[] = [], over: Partial<RunTraceInput> = {}) {
  const store = createMemoryTraceStore(rows);
  const reasoning = spy({ reasoning: prose(300, "r") });
  const steps = spy({ answer: prose(330, "s") });
  const input: RunTraceInput = {
    userId: 7,
    questionId: 1,
    prompt: QUESTION,
    model: "live-model",
    reasoningProvider: reasoning.provider,
    stepsProvider: steps.provider,
    setting: "auto",
    limits: LIMITS,
    store,
    signal: new AbortController().signal,
    ...over,
  };
  return { input, store, reasoning, steps };
}

async function collect(events: AsyncIterable<TraceEvent>): Promise<TraceEvent[]> {
  const out: TraceEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const ready = (events: TraceEvent[]) => events.find((e) => e.type === "trace_ready") as Extract<TraceEvent, { type: "trace_ready" }>;

describe("reuse hit", () => {
  it("streams the saved trace as trace_ready + done, with no provider call and no new row", async () => {
    const { input, store, reasoning, steps } = setup([savedRow()], { reuse: true });
    const events = await collect(runTraceForUser(input));
    expect(events.map((e) => e.type)).toEqual(["trace_ready", "done"]);
    expect(events[0]).toEqual({ type: "trace_ready", source: "reasoning", paragraphs: SAVED, words: 21, model: "saved-model" });
    expect(events[1]).toEqual({ type: "done", model: "saved-model" });
    expect(events.every(isTraceEvent)).toBe(true);
    expect(reasoning.info.calls + steps.info.calls).toBe(0);
    expect(store.rows).toHaveLength(1); // nothing was saved
  });

  it("uses the NEWEST ready row of the question, and only that question's", async () => {
    const older = savedRow({ finalParagraphs: ["Older trace paragraph one is here."], model: "old" });
    const other = savedRow({ questionId: 2, finalParagraphs: ["Another question's trace is here."], model: "other" });
    const newer = savedRow({ finalParagraphs: ["Newer trace paragraph one is here."], model: "new" });
    const { input } = setup([older, newer, other], { reuse: true });
    expect(ready(await collect(runTraceForUser(input))).paragraphs).toEqual(["Newer trace paragraph one is here."]);
  });

  it("two learners get the same trace", async () => {
    const { input } = setup([savedRow()], { reuse: true });
    const a = await collect(runTraceForUser({ ...input, userId: 1 }));
    const b = await collect(runTraceForUser({ ...input, userId: 2 }));
    expect(a).toEqual(b);
  });

  it("does not look up again when the caller already did", async () => {
    const { input, store } = setup([], { reuse: true, reused: { source: "steps", paragraphs: SAVED, model: "m" } });
    const find = vi.spyOn(store, "findReusableTrace");
    const events = await collect(runTraceForUser(input));
    expect(ready(events).source).toBe("steps");
    expect(find).not.toHaveBeenCalled();
  });
});

describe("reuse miss", () => {
  it("generates and saves as today", async () => {
    const { input, store, reasoning } = setup([], { reuse: true });
    const events = await collect(runTraceForUser(input));
    expect(ready(events).model).toBe("live-model");
    expect(reasoning.info.calls).toBe(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: "ready", userId: 7, questionId: 1 });
  });

  it("generates when the store lookup fails, without leaking the error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { input, store, reasoning } = setup([], { reuse: true });
    vi.spyOn(store, "findReusableTrace").mockRejectedValue(new Error("connection refused, password sk-DB"));
    const events = await collect(runTraceForUser(input));
    expect(ready(events)).toBeDefined();
    expect(reasoning.info.calls).toBe(1);
    expect(JSON.stringify(events)).not.toMatch(/sk-DB|refused/);
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/sk-DB|refused/);
    error.mockRestore();
  });
});

describe("reuse off", () => {
  it("ignores saved rows (default and false) and saves a new one", async () => {
    for (const reuse of [undefined, false]) {
      const { input, store, reasoning } = setup([savedRow()], reuse === undefined ? {} : { reuse });
      const find = vi.spyOn(store, "findReusableTrace");
      const events = await collect(runTraceForUser(input));
      expect(ready(events).model).toBe("live-model");
      expect(ready(events).paragraphs).not.toEqual(SAVED);
      expect(reasoning.info.calls).toBe(1);
      expect(store.rows).toHaveLength(2);
      expect(find).not.toHaveBeenCalled();
    }
  });
});

describe("rows that are never reused", () => {
  const bad: Array<[string, Partial<TraceRow>]> = [
    ["status failed", { status: "failed", errorCode: "upstream" }],
    ["status cancelled", { status: "cancelled", errorCode: "cancelled" }],
    ["error code set and failed", { status: "failed", errorCode: "timeout", finalParagraphs: SAVED }],
    ["empty paragraphs", { finalParagraphs: [] }],
    ["another question", { questionId: 2 }],
  ];

  it.each(bad)("%s: the store finds nothing and the run generates", async (_name, over) => {
    const { input, store, reasoning } = setup([savedRow(over)], { reuse: true });
    expect(await store.findReusableTrace(1)).toBeNull();
    const events = await collect(runTraceForUser(input));
    expect(ready(events).model).toBe("live-model");
    expect(reasoning.info.calls).toBe(1);
  });

  it("a newer failed row does not hide an older ready one", async () => {
    const { store } = setup([savedRow({ model: "good" }), savedRow({ status: "failed", errorCode: "upstream", finalParagraphs: [] })]);
    expect(await store.findReusableTrace(1)).toMatchObject({ model: "good" });
  });
});

describe("a reused trace goes through the same output checks as a generated one", () => {
  const unsafe: Array<[string, unknown]> = [
    ["a paragraph with $$", ["Fine paragraph here.", "Has $$ inside it."]],
    ["a paragraph with BLANK(", ["Fine paragraph here.", "Has BLANK(x) inside it."]],
    ["a paragraph with blank( in lower case", ["Fine paragraph here.", "Has blank(x) inside it."]],
    ["an empty-looking paragraph", ["Fine paragraph here.", "   "]],
    ["a non-string paragraph", ["Fine paragraph here.", 5]],
    ["not an array", "Fine paragraph here."],
    ["no paragraphs", []],
  ];

  it.each(unsafe)("%s: the saved trace is not shown, a new one is generated", async (_name, paragraphs) => {
    // the stored row is handed over directly, as a store that did not filter would
    const { input, reasoning } = setup([], { reuse: true, reused: { source: "reasoning", paragraphs: paragraphs as string[], model: "saved" } });
    const events = await collect(runTraceForUser(input));
    expect(ready(events).model).toBe("live-model");
    expect(reasoning.info.calls).toBe(1);
  });

  it("readyEvents is the one gate for both paths: same events, same checks", () => {
    expect(readyEvents("steps", SAVED, "m")).toEqual([{ type: "trace_ready", source: "steps", paragraphs: SAVED, words: 21, model: "m" }, { type: "done", model: "m" }]);
    expect(readyEvents("steps", ["a $$ b"], "m")).toBeNull();
    expect(readyEvents("steps", [], "m")).toBeNull();
    expect(readyEvents("other" as never, SAVED, "m")).toBeNull(); // not a valid source for the protocol
  });

  it("a generated trace uses the same gate (its events equal readyEvents of its paragraphs)", async () => {
    const { input } = setup();
    const events = await collect(runTraceForUser(input));
    const t = ready(events);
    expect(events).toEqual(readyEvents(t.source, t.paragraphs, "live-model"));
  });

  it("toReusableTrace: only ready rows with valid source and non-empty string paragraphs", () => {
    const row = { source: "reasoning", status: "ready", finalParagraphs: SAVED, model: "m" };
    expect(toReusableTrace(row)).toEqual({ source: "reasoning", paragraphs: SAVED, model: "m" });
    for (const over of [{ status: "failed" }, { status: "cancelled" }, { status: "" }, { source: "x" }, { finalParagraphs: [] }, { finalParagraphs: null }, { finalParagraphs: [""] }, { finalParagraphs: [1] }, { finalParagraphs: "text" }]) {
      expect(toReusableTrace({ ...row, ...over }), JSON.stringify(over)).toBeNull();
    }
  });
});

describe("the hourly limit", () => {
  it("a reused trace takes no slot and does not count, a generated one still does", async () => {
    const limiter = createTraceLimiter({ maxPerHour: 1 });
    const reused = { source: "reasoning" as const, paragraphs: SAVED, model: "saved" };

    // three reuses at the same time and one after the other: all fine, even with a limit of one
    const { input } = setup([savedRow()], { reuse: true, reused });
    const first = startTraceRun(limiter, input);
    const second = startTraceRun(limiter, input);
    expect(first.ok && second.ok).toBe(true);
    for (const started of [first, second]) if (started.ok) expect((await collect(started.events)).map((e) => e.type)).toEqual(["trace_ready", "done"]);
    expect(startTraceRun(limiter, input).ok).toBe(true);

    // the limiter has not been used: one generated trace is still allowed, the next is not
    const generated = setup([], { reuse: true, reused: null });
    const g1 = startTraceRun(limiter, generated.input);
    expect(g1.ok).toBe(true);
    if (g1.ok) await collect(g1.events);
    const g2 = startTraceRun(limiter, generated.input);
    expect(g2).toMatchObject({ ok: false, reason: "hourly" });
  });

  it("a saved row that fails the checks is generated again, and counts", () => {
    const limiter = createTraceLimiter({ maxPerHour: 1 });
    const { input } = setup([], { reuse: true, reused: { source: "reasoning", paragraphs: ["bad $$ text"], model: "saved" } });
    const a = startTraceRun(limiter, input);
    expect(a.ok).toBe(true);
    if (a.ok) a.release();
    expect(startTraceRun(limiter, input)).toMatchObject({ ok: false, reason: "hourly" });
  });
});

describe("through the route", () => {
  function route(config: Record<string, string>, rows: TraceRow[]) {
    const store = createMemoryTraceStore(rows);
    const save = vi.spyOn(store, "saveTrace");
    const find = vi.spyOn(store, "findReusableTrace");
    const reasoning = spy({ reasoning: prose(300, "r") });
    const steps = spy({ answer: prose(330, "s") });
    const deps: TraceRouteDeps = {
      getUserId: async () => "7",
      findQuestion: async (id) => (id === 1 ? { id: 1, question: QUESTION } : null),
      selectProviders: () => ({ ok: true, providers: { model: "live-model", reasoning: reasoning.provider, steps: steps.provider } }),
      config: readTraceRunConfig({ TRACE_MAX_PER_HOUR: "1", ...config }),
      limiter: createTraceLimiter({ maxPerHour: 1 }),
      store,
    };
    const post = () => handleTraceRequest(new Request("http://localhost/api/trace", { method: "POST", body: JSON.stringify({ questionId: 1 }) }), deps);
    return { post, save, find, reasoning, steps, store };
  }
  const lines = async (res: Response): Promise<TraceEvent[]> => (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  it("on: a hit is served with no provider call, no saved row, and never hits the hourly limit", async () => {
    const { post, save, reasoning, steps } = route({ TRACE_REUSE: "true" }, [savedRow()]);
    for (let i = 0; i < 3; i++) {
      const res = await post();
      expect(res.status).toBe(200);
      expect(await lines(res)).toEqual([
        { type: "trace_ready", source: "reasoning", paragraphs: SAVED, words: 21, model: "saved-model" },
        { type: "done", model: "saved-model" },
      ]);
    }
    expect(reasoning.info.calls + steps.info.calls).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });

  it("on, no saved trace: generates and saves; the next request reuses it; only the generated one counted", async () => {
    const { post, save, reasoning } = route({ TRACE_REUSE: "true" }, []);
    const first = await lines(await post());
    expect(first.find((e) => e.type === "trace_ready")).toMatchObject({ model: "live-model" });
    expect(save).toHaveBeenCalledTimes(1);
    const second = await post(); // the limit is 1 per hour, but this one is a reuse
    expect(second.status).toBe(200);
    expect(await lines(second)).toEqual(first);
    expect(reasoning.info.calls).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("off (default): saved rows are ignored, nothing is looked up, and the hourly limit counts every request", async () => {
    const { post, find, reasoning } = route({}, [savedRow()]);
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(429);
    expect(find).not.toHaveBeenCalled();
    expect(reasoning.info.calls).toBe(1);
  });
});

// keep the type import used
export type _Unused = TraceStore;
