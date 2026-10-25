import { afterEach, describe, expect, it, vi } from "vitest";
import { chunkText, createMockProvider, type MockProviderConfig } from "./mock-provider";
import { traceError, type TraceEvent } from "./events";

afterEach(() => vi.useRealTimers());

const REASONING = "one two three four five six seven";
const ANSWER = "alpha beta gamma delta";

async function run(config: Partial<MockProviderConfig>, signal = new AbortController().signal): Promise<TraceEvent[]> {
  const provider = createMockProvider({ reasoning: REASONING, answer: ANSWER, ...config });
  const out: TraceEvent[] = [];
  for await (const event of provider.stream({ prompt: "q", signal })) out.push(event);
  return out;
}

const texts = (events: TraceEvent[], type: "reasoning_delta" | "answer_delta") =>
  events.filter((e): e is Extract<TraceEvent, { text: string }> => e.type === type).map((e) => e.text);

describe("chunkText", () => {
  it("joins back to the exact text, including odd whitespace", () => {
    for (const text of ["a b c d e", "  lead and trail  ", "line one\n\nline two  x", " ", "single"]) {
      for (const size of [1, 2, 3, 10]) expect(chunkText(text, size).join("")).toBe(text);
    }
  });

  it("makes chunks of the requested number of words", () => {
    expect(chunkText("a b c d e", 2)).toEqual(["a b", " c d", " e"]);
    expect(chunkText("", 3)).toEqual([]);
  });
});

describe("normal replay", () => {
  it("sends reasoning chunks, then answer chunks, then done", async () => {
    const events = await run({ chunkWords: 3, model: "m", servedModel: "s", usage: { totalTokens: 9 } });
    expect(texts(events, "reasoning_delta").join("")).toBe(REASONING);
    expect(texts(events, "answer_delta").join("")).toBe(ANSWER);
    expect(texts(events, "reasoning_delta")).toHaveLength(3);
    const types = events.map((e) => e.type);
    expect(types.lastIndexOf("reasoning_delta")).toBeLessThan(types.indexOf("answer_delta"));
    expect(events[events.length - 1]).toEqual({ type: "done", model: "m", servedModel: "s", finishReason: "stop", usage: { totalTokens: 9 } });
  });

  it("calls the injected sleep before every event when delayMs is set", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const events = await run({ chunkWords: 4, delayMs: 25, sleep });
    expect(sleep).toHaveBeenCalledTimes(events.length);
    expect(sleep.mock.calls.every(([ms]) => ms === 25)).toBe(true);
  });

  it("does not call sleep when there is no delay", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    await run({ sleep });
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("failure modes", () => {
  it("error-mid-reasoning: some reasoning, then an error, then the stream ends", async () => {
    const events = await run({ chunkWords: 2, failure: { mode: "error-mid-reasoning", afterChunks: 2 } });
    expect(events.map((e) => e.type)).toEqual(["reasoning_delta", "reasoning_delta", "error"]);
    expect(events[2]).toEqual(traceError("upstream"));
    expect((await run({ failure: { mode: "error-mid-reasoning", afterChunks: 0, code: "limit" } }))).toEqual([traceError("limit")]);
  });

  it("error-after-answer: everything is delivered, then done, then an error", async () => {
    const events = await run({ failure: { mode: "error-after-answer" } });
    expect(texts(events, "answer_delta").join("")).toBe(ANSWER);
    expect(events.slice(-2).map((e) => e.type)).toEqual(["done", "error"]);
  });

  it("no-answer: reasoning, then done, with no answer events", async () => {
    const events = await run({ failure: { mode: "no-answer" } });
    expect(texts(events, "answer_delta")).toEqual([]);
    expect(texts(events, "reasoning_delta").join("")).toBe(REASONING);
    expect(events[events.length - 1].type).toBe("done");
  });

  it("stall: emits the given number of chunks, then never ends until aborted", async () => {
    const controller = new AbortController();
    const provider = createMockProvider({ reasoning: REASONING, answer: ANSWER, chunkWords: 2, failure: { mode: "stall", afterChunks: 3 } });
    const seen: TraceEvent[] = [];
    let finished = false;
    const finishedPromise = (async () => {
      for await (const event of provider.stream({ prompt: "q", signal: controller.signal })) seen.push(event);
      finished = true;
    })();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toHaveLength(3);
    expect(finished).toBe(false);
    controller.abort();
    await finishedPromise;
    expect(finished).toBe(true);
    expect(seen).toHaveLength(3);
  });

  it("stall in the answer part: reasoning and part of the answer arrive first", async () => {
    const controller = new AbortController();
    const provider = createMockProvider({ reasoning: "a b", answer: "c d e f", chunkWords: 2, failure: { mode: "stall", afterChunks: 2 } });
    const seen: TraceEvent[] = [];
    const done = (async () => {
      for await (const event of provider.stream({ prompt: "q", signal: controller.signal })) seen.push(event);
    })();
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await done;
    expect(seen.map((e) => e.type)).toEqual(["reasoning_delta", "answer_delta"]);
  });
});

describe("abort", () => {
  it("emits nothing when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await run({}, controller.signal)).toEqual([]);
  });

  it("stops at once when aborted between events", async () => {
    const controller = new AbortController();
    const provider = createMockProvider({ reasoning: REASONING, answer: ANSWER, chunkWords: 1 });
    const seen: TraceEvent[] = [];
    for await (const event of provider.stream({ prompt: "q", signal: controller.signal })) {
      seen.push(event);
      controller.abort();
    }
    expect(seen).toHaveLength(1);
  });

  it("stops during a delay without emitting the next event", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const provider = createMockProvider({ reasoning: REASONING, answer: ANSWER, chunkWords: 1, delayMs: 100 });
    const seen: TraceEvent[] = [];
    const done = (async () => {
      for await (const event of provider.stream({ prompt: "q", signal: controller.signal })) seen.push(event);
    })();
    await vi.advanceTimersByTimeAsync(250); // events at 100 ms and 200 ms
    expect(seen).toHaveLength(2);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(seen).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
