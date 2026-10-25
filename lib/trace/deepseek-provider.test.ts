import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeFromProvider } from "./consume";
import {
  createDeepSeekProvider,
  USAGE_WAIT_MS,
  type DeepSeekChunk,
  type DeepSeekClient,
  type DeepSeekRequestParams,
} from "./deepseek-provider";
import { traceError, type TraceEvent } from "./events";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const SERVED = "deepseek-flash-served";
const reasoningChunk = (t: string): DeepSeekChunk => ({ model: SERVED, choices: [{ delta: { reasoning_content: t, content: null } }] });
const answerChunk = (t: string): DeepSeekChunk => ({ model: SERVED, choices: [{ delta: { content: t } }] });
const finishChunk = (reason = "stop"): DeepSeekChunk => ({ model: SERVED, choices: [{ delta: {}, finish_reason: reason }] });
const usageChunk = (): DeepSeekChunk => ({
  model: SERVED,
  choices: [],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 12 } },
});
const USAGE = { promptTokens: 10, completionTokens: 20, totalTokens: 30, reasoningTokens: 12 };

const hang = () => new Promise<never>(() => {});

interface FakeState {
  params?: DeepSeekRequestParams;
  signal?: AbortSignal;
  createCalls: number;
  released: boolean;
}

// A stand-in for the openai client: the script decides what the stream yields, throws or waits for.
function fakeClient(script: () => AsyncGenerator<DeepSeekChunk>, options: { rejectWith?: unknown; createPromise?: Promise<void> } = {}) {
  const state: FakeState = { createCalls: 0, released: false };
  const client: DeepSeekClient = {
    chat: {
      completions: {
        async create(params, { signal }) {
          state.createCalls++;
          state.params = params;
          state.signal = signal;
          if (options.createPromise) await options.createPromise;
          if (options.rejectWith !== undefined) throw options.rejectWith;
          const gen = script();
          return {
            [Symbol.asyncIterator]() {
              const it = gen[Symbol.asyncIterator]();
              return {
                next: () => it.next(),
                return: () => {
                  state.released = true;
                  return it.return(undefined);
                },
              };
            },
          };
        },
      },
    },
  };
  return { client, state };
}

async function* chunks(...items: DeepSeekChunk[]): AsyncGenerator<DeepSeekChunk> {
  for (const item of items) yield item;
}

const provider = (client: DeepSeekClient) => createDeepSeekProvider({ client, model: "deepseek-flash", maxTokens: 1234 });

async function collect(client: DeepSeekClient, signal = new AbortController().signal): Promise<TraceEvent[]> {
  const out: TraceEvent[] = [];
  for await (const event of provider(client).stream({ prompt: "q", signal })) out.push(event);
  return out;
}

const r = (text: string): TraceEvent => ({ type: "reasoning_delta", text });
const a = (text: string): TraceEvent => ({ type: "answer_delta", text });

describe("request", () => {
  it("sends one user message, no system prompt, streaming with usage, thinking enabled", async () => {
    const { client, state } = fakeClient(() => chunks(finishChunk(), usageChunk()));
    const controller = new AbortController();
    await collect(client, controller.signal);
    expect(state.params).toEqual({
      model: "deepseek-flash",
      messages: [{ role: "user", content: "q" }],
      max_tokens: 1234,
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: "enabled" },
    });
    expect(state.signal).toBe(controller.signal);
  });
});

describe("mapping", () => {
  it("maps reasoning_content and content, skips empty ones, and ends with done carrying model, servedModel, finishReason and usage", async () => {
    const { client } = fakeClient(() =>
      chunks(
        reasoningChunk("think "),
        { choices: [{ delta: { reasoning_content: "" } }] },
        { choices: [{ delta: { content: "" } }] },
        { choices: [{ delta: { content: null } }] },
        { choices: [{ delta: {} }] },
        { choices: [] },
        reasoningChunk("more"),
        answerChunk("The "),
        answerChunk("answer"),
        finishChunk("stop"),
        usageChunk()
      )
    );
    const events = await collect(client);
    expect(events).toEqual([
      r("think "),
      r("more"),
      a("The "),
      a("answer"),
      { type: "done", model: "deepseek-flash", servedModel: SERVED, finishReason: "stop", usage: USAGE },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends reasoning before answer when one chunk carries both", async () => {
    const { client } = fakeClient(() => chunks({ choices: [{ delta: { reasoning_content: "R", content: "A" } }] }, finishChunk(), usageChunk()));
    expect((await collect(client)).slice(0, 2)).toEqual([r("R"), a("A")]);
  });
});

describe("finish_reason and usage", () => {
  it("finishes at once when the usage is in the same chunk as the finish_reason", async () => {
    const both: DeepSeekChunk = { ...finishChunk(), usage: { total_tokens: 5 } };
    const { client } = fakeClient(() => chunks(answerChunk("x"), both));
    const events = await collect(client);
    expect(events[events.length - 1]).toEqual({ type: "done", model: "deepseek-flash", servedModel: SERVED, finishReason: "stop", usage: { totalTokens: 5 } });
  });

  it("waits up to 2 seconds for a usage chunk that never arrives, then still emits done", async () => {
    const { client, state } = fakeClient(async function* () {
      yield answerChunk("x");
      yield finishChunk();
      await hang();
    });
    const events: TraceEvent[] = [];
    const finished = (async () => {
      for await (const event of provider(client).stream({ prompt: "q", signal: new AbortController().signal })) events.push(event);
    })();
    await vi.advanceTimersByTimeAsync(USAGE_WAIT_MS - 1);
    expect(events).toEqual([a("x")]);
    await vi.advanceTimersByTimeAsync(1);
    await finished;
    expect(events[events.length - 1]).toEqual({ type: "done", model: "deepseek-flash", servedModel: SERVED, finishReason: "stop" });
    expect(state.released).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("emits done without usage when the stream ends right after the finish_reason", async () => {
    const { client } = fakeClient(() => chunks(answerChunk("x"), finishChunk()));
    const events = await collect(client);
    expect(events[events.length - 1]).toEqual({ type: "done", model: "deepseek-flash", servedModel: SERVED, finishReason: "stop" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still emits done for finish_reason "length" so the consumer can see the token limit was hit', async () => {
    const { client } = fakeClient(() => chunks(reasoningChunk("a long thought"), finishChunk("length"), usageChunk()));
    const events = await collect(client);
    expect(events[events.length - 1]).toMatchObject({ type: "done", finishReason: "length", usage: USAGE });
  });

  it("emits no done when the stream ends without any finish_reason", async () => {
    const { client } = fakeClient(() => chunks(reasoningChunk("x"), answerChunk("y")));
    const events = await collect(client);
    expect(events).toEqual([r("x"), a("y")]);
  });
});

describe("errors", () => {
  it("turns an error mid-stream into a generic error event and logs only its name and status", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = Object.assign(new Error("boom: key sk-SECRET, Bearer abc, https://user:pw@host/x"), { status: 502 });
    const { client } = fakeClient(async function* () {
      yield reasoningChunk("so far");
      throw failure;
    });
    const events = await collect(client);
    expect(events).toEqual([r("so far"), traceError("upstream")]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual(["[deepseek-provider] stream failed:", "Error", 502]);
  });

  it("maps a failed request (for example HTTP 429) to one generic upstream error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    class RateLimitError extends Error {
      status = 429;
    }
    const { client, state } = fakeClient(() => chunks(), { rejectWith: new RateLimitError("Too many requests, key sk-123") });
    expect(await collect(client)).toEqual([traceError("upstream")]);
    expect(state.createCalls).toBe(1);
    expect(spy.mock.calls[0]).toEqual(["[deepseek-provider] stream failed:", "Error", 429]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the answer when the stream fails after the finish_reason: done first, then the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(async function* () {
      yield answerChunk("full answer");
      yield finishChunk();
      throw new Error("connection reset");
    });
    const events = await collect(client);
    expect(events).toEqual([
      a("full answer"),
      { type: "done", model: "deepseek-flash", servedModel: SERVED, finishReason: "stop" },
      traceError("upstream"),
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never copies the text of the thrown error into events or logs", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const messages = [
      "Incorrect API key provided: sk-abc123",
      "401 Authorization: Bearer sk-live-xyz",
      "request to https://user:pass@api.example.com failed",
    ];
    for (const message of messages) {
      const { client } = fakeClient(() => chunks(), { rejectWith: Object.assign(new Error(message), { status: 401 }) });
      const events = await collect(client);
      expect(JSON.stringify(events)).not.toMatch(/sk-|Bearer|https?:|Authorization/i);
    }
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toMatch(/sk-|Bearer|https?:|Authorization|Incorrect/);
    for (const message of messages) expect(logged).not.toContain(message);
  });

  it("logs an odd error name as plain 'Error' and a non-number status as no status", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const odd = Object.assign(new Error("x"), { name: "Evil sk-123\nname", status: "401 Unauthorized sk-1" });
    const { client } = fakeClient(() => chunks(), { rejectWith: odd });
    await collect(client);
    expect(spy.mock.calls[0]).toEqual(["[deepseek-provider] stream failed:", "Error", "no status"]);
  });
});

describe("abort and release", () => {
  it("stops mid-stream with a cancelled event and releases the underlying stream", async () => {
    const { client, state } = fakeClient(async function* () {
      yield reasoningChunk("first");
      await hang();
    });
    const controller = new AbortController();
    const events: TraceEvent[] = [];
    const finished = (async () => {
      for await (const event of provider(client).stream({ prompt: "q", signal: controller.signal })) {
        events.push(event);
        if (events.length === 1) controller.abort();
      }
    })();
    await finished;
    expect(events).toEqual([r("first"), traceError("cancelled")]);
    expect(state.released).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("emits only a cancelled event, and makes no request, when the signal is already aborted", async () => {
    const { client, state } = fakeClient(() => chunks(answerChunk("x")));
    const controller = new AbortController();
    controller.abort();
    expect(await collect(client, controller.signal)).toEqual([traceError("cancelled")]);
    expect(state.createCalls).toBe(0);
  });

  it("notices an abort while the request is still being opened, and releases a stream that opens late", async () => {
    let open!: () => void;
    const opening = new Promise<void>((resolve) => (open = resolve));
    const { client, state } = fakeClient(() => chunks(answerChunk("x")), { createPromise: opening });
    const controller = new AbortController();
    const events: TraceEvent[] = [];
    const finished = (async () => {
      for await (const event of provider(client).stream({ prompt: "q", signal: controller.signal })) events.push(event);
    })();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await finished;
    expect(events).toEqual([traceError("cancelled")]);
    open(); // the client finally answers
    await vi.advanceTimersByTimeAsync(0);
    expect(state.released).toBe(true);
  });

  it("releases the stream when the consumer stops reading early", async () => {
    const { client, state } = fakeClient(() => chunks(reasoningChunk("a"), reasoningChunk("b"), reasoningChunk("c")));
    for await (const event of provider(client).stream({ prompt: "q", signal: new AbortController().signal })) {
      expect(event).toEqual(r("a"));
      break;
    }
    expect(state.released).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("end to end through consumeFromProvider", () => {
  it("normal run: complete, with model, served model, finish reason and usage", async () => {
    const { client } = fakeClient(() => chunks(reasoningChunk("think "), reasoningChunk("more"), answerChunk("the answer"), finishChunk(), usageChunk()));
    const res = await consumeFromProvider(provider(client), "q");
    expect(res).toEqual({
      status: "complete",
      reasoning: "think more",
      answer: "the answer",
      warnings: [],
      model: "deepseek-flash",
      servedModel: SERVED,
      finishReason: "stop",
      usage: USAGE,
    });
  });

  it('a token-limit cut-off is complete with finishReason "length"', async () => {
    const { client } = fakeClient(() => chunks(reasoningChunk("endless thinking"), finishChunk("length"), usageChunk()));
    const res = await consumeFromProvider(provider(client), "q");
    expect(res).toMatchObject({ status: "complete", answer: "", finishReason: "length" });
    expect(res.warnings).toEqual(["finished_without_answer"]);
  });

  it("an error after the full answer is complete, with a warning", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(async function* () {
      yield reasoningChunk("thinking");
      yield answerChunk("complete answer");
      yield finishChunk();
      throw new Error("socket hang up");
    });
    const res = await consumeFromProvider(provider(client), "q");
    expect(res).toMatchObject({ status: "complete", reasoning: "thinking", answer: "complete answer", finishReason: "stop" });
    expect(res.warnings).toEqual(["error_after_answer"]);
    expect(res.usage).toBeUndefined();
  });

  it("a stall in the middle of the answer ends in an idle timeout: partial, upstream aborted and released", async () => {
    const { client, state } = fakeClient(async function* () {
      yield reasoningChunk("thinking");
      yield answerChunk("half an");
      await hang();
    });
    const promise = consumeFromProvider(provider(client), "q", { idleTimeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    const res = await promise;
    expect(res).toMatchObject({ status: "partial", reasoning: "thinking", answer: "half an" });
    expect(res.error?.code).toBe("timeout");
    expect(state.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.released).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a stream that never sends a first chunk hits firstEventTimeoutMs", async () => {
    const { client, state } = fakeClient(async function* () {
      await hang();
    });
    const promise = consumeFromProvider(provider(client), "q", { firstEventTimeoutMs: 500, idleTimeoutMs: 60000 });
    await vi.advanceTimersByTimeAsync(500);
    const res = await promise;
    expect(res).toMatchObject({ status: "failed", reasoning: "" });
    expect(res.error?.code).toBe("timeout");
    expect(state.signal?.aborted).toBe(true);
  });
});
