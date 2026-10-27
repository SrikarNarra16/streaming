import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTraceRunConfig } from "./config";
import type { TraceEvent } from "./events";
import { createTraceLimiter } from "./limits";
import { createMockProvider, type MockProviderConfig } from "./mock-provider";
import type { TraceProvider } from "./provider";
import { handleTraceRequest, type TraceRouteDeps } from "./route-handler";
import type { TraceRow, TraceStore } from "./run";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const QUESTION = "DB QUESTION TEXT: write a function that adds two numbers.";

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
  const base = createMockProvider({ reasoning: "", answer: "", chunkWords: 3, ...config });
  const info = { calls: 0, prompts: [] as string[], signals: [] as AbortSignal[] };
  const provider: TraceProvider = {
    stream(req) {
      info.calls++;
      info.prompts.push(req.prompt);
      info.signals.push(req.signal);
      return base.stream(req);
    },
  };
  return { provider, info };
}

function setup(over: Partial<TraceRouteDeps> = {}, mocks: { reasoning?: Partial<MockProviderConfig>; steps?: Partial<MockProviderConfig> } = {}) {
  const rows: TraceRow[] = [];
  const store: TraceStore = { saveTrace: vi.fn(async (row: TraceRow) => void rows.push(row)), findReusableTrace: vi.fn(async () => null) };
  const reasoning = spy({ reasoning: prose(300, "r"), ...mocks.reasoning });
  const steps = spy({ answer: prose(330, "s"), ...mocks.steps });
  const findQuestion = vi.fn(async (id: number) => (id === 1 ? { id: 1, question: QUESTION } : null));
  const deps: TraceRouteDeps = {
    getUserId: async () => "7",
    findQuestion,
    selectProviders: () => ({ ok: true, providers: { model: "m", reasoning: reasoning.provider, steps: steps.provider } }),
    config: readTraceRunConfig({}),
    limiter: createTraceLimiter({ maxPerHour: 100 }),
    store,
    ...over,
  };
  return { deps, rows, store, reasoning, steps, findQuestion };
}

const post = (body: unknown, init: RequestInit = {}) =>
  new Request("http://localhost/api/trace", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), ...init });

const lines = (text: string): TraceEvent[] =>
  text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe("authentication and validation", () => {
  it("answers 401 without a session, and does nothing else", async () => {
    const { deps, findQuestion, store } = setup({ getUserId: async () => null });
    const res = await handleTraceRequest(post({ questionId: 1 }), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(findQuestion).not.toHaveBeenCalled();
    expect(store.saveTrace).not.toHaveBeenCalled();
  });

  it("answers 401 for a session user id that is not a positive whole number", async () => {
    for (const id of ["abc", "0", "-1", "07", "1.5", "", "99999999999"]) {
      const { deps } = setup({ getUserId: async () => id });
      expect((await handleTraceRequest(post({ questionId: 1 }), deps)).status, id).toBe(401);
    }
  });

  it("answers 400 with a generic message for an invalid body", async () => {
    const bodies: unknown[] = ["not json", "", "null", "[]", "{}", { questionId: "1" }, { questionId: 0 }, { questionId: -2 }, { questionId: 1.5 }, { questionId: null }, { other: 1 }, "x".repeat(2000)];
    for (const body of bodies) {
      const { deps, store } = setup();
      const res = await handleTraceRequest(post(body), deps);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid request" });
      expect(store.saveTrace).not.toHaveBeenCalled();
    }
  });

  it("answers 404 for an unknown question", async () => {
    const { deps, reasoning } = setup();
    const res = await handleTraceRequest(post({ questionId: 999 }), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Question not found" });
    expect(reasoning.info.calls).toBe(0);
  });

  it("answers 500 with a generic message when the question lookup fails", async () => {
    const { deps } = setup({
      findQuestion: async () => {
        throw new Error("connection refused, password sk-DB");
      },
    });
    const res = await handleTraceRequest(post({ questionId: 1 }), deps);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/sk-|password|refused/);
  });

  it("answers 503 when the AI service is not configured, without taking a slot", async () => {
    const { deps } = setup({ selectProviders: () => ({ ok: false, reason: "not_configured" }) });
    const res = await handleTraceRequest(post({ questionId: 1 }), deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "The AI service is not available." });
    expect(deps.limiter.tryStart(7).ok).toBe(true);
  });
});

describe("the prompt", () => {
  it("always comes from the database for that question id, never from the client", async () => {
    const { deps, reasoning, findQuestion } = setup();
    const res = await handleTraceRequest(post({ questionId: 1, prompt: "EVIL PROMPT FROM THE CLIENT", question: "EVIL TOO" }), deps);
    await res.text();
    expect(findQuestion).toHaveBeenCalledWith(1);
    expect(reasoning.info.prompts).toEqual([QUESTION]);
  });

  it("also builds the steps prompt from the database text", async () => {
    const { deps, steps } = setup({}, { reasoning: { reasoning: prose(50, "r") } }); // too short: the steps text is used
    const res = await handleTraceRequest(post({ questionId: 1, prompt: "EVIL PROMPT" }), deps);
    await res.text();
    expect(steps.info.prompts).toHaveLength(1);
    expect(steps.info.prompts[0]).toContain(QUESTION);
    expect(steps.info.prompts[0]).not.toContain("EVIL");
  });
});

describe("the streamed answer", () => {
  it("is NDJSON with the right headers and only trace_ready and done", async () => {
    const { deps, rows } = setup();
    const res = await handleTraceRequest(post({ questionId: 1 }), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");

    const events = lines(await res.text());
    expect(events.map((e) => e.type)).toEqual(["trace_ready", "done"]);
    expect(events[0]).toMatchObject({ source: "reasoning", words: 300, model: "m" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 7, questionId: 1, status: "ready" });
  });

  it("sends a generic error event, in the same format, when the run fails", async () => {
    const { deps, rows } = setup({ config: readTraceRunConfig({ TRACE_SOURCE: "steps" }) }, { steps: { answer: "", failure: { mode: "error-mid-reasoning", afterChunks: 0 } } });
    const res = await handleTraceRequest(post({ questionId: 1 }), deps);
    expect(res.status).toBe(200); // the stream was started; the failure is an event
    expect(lines(await res.text())).toEqual([{ type: "error", code: "upstream", message: "The AI service could not process this request." }]);
    expect(rows[0].status).toBe("failed");
  });
});

describe("limits", () => {
  it("answers 429 with Retry-After while a trace is already running, then lets the next one in", async () => {
    const { deps } = setup({}, { reasoning: { reasoning: prose(300, "r"), delayMs: 100, chunkWords: 1 } });
    const controller = new AbortController();
    const first = await handleTraceRequest(post({ questionId: 1 }, { signal: controller.signal }), deps);
    expect(first.status).toBe(200);
    await vi.advanceTimersByTimeAsync(50);

    const second = await handleTraceRequest(post({ questionId: 1 }), deps);
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBe("5");
    expect(await second.json()).toEqual({ error: "A trace is already running." });

    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    const third = await handleTraceRequest(post({ questionId: 1 }), deps);
    expect(third.status).toBe(200);
    controller.abort();
  });

  it("answers 429 with the seconds to wait when the hourly limit is reached", async () => {
    const { deps } = setup({ limiter: createTraceLimiter({ maxPerHour: 1 }) });
    const first = await handleTraceRequest(post({ questionId: 1 }), deps);
    await first.text(); // the trace finishes and frees the slot
    const second = await handleTraceRequest(post({ questionId: 1 }), deps);
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: "Too many requests." });
    const wait = Number(second.headers.get("Retry-After"));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(3600);
  });
});

describe("a client that goes away", () => {
  it("aborts the upstream call, and the trace is still saved, once", async () => {
    const { deps, rows, store, reasoning } = setup({}, { reasoning: { reasoning: prose(300, "r"), delayMs: 100, chunkWords: 1 } });
    const controller = new AbortController();
    const res = await handleTraceRequest(post({ questionId: 1 }, { signal: controller.signal }), deps);
    expect(res.status).toBe(200);

    await vi.advanceTimersByTimeAsync(250);
    controller.abort(); // the browser disconnected
    await vi.advanceTimersByTimeAsync(1000);

    expect(reasoning.info.signals[0].aborted).toBe(true);
    expect(store.saveTrace).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ status: "cancelled", errorCode: "cancelled" });
    expect(deps.limiter.tryStart(7).ok).toBe(true); // the slot was released
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does the same when the response body is cancelled by the reader", async () => {
    const { deps, rows, store, reasoning } = setup({}, { reasoning: { reasoning: prose(300, "r"), delayMs: 100, chunkWords: 1 } });
    const res = await handleTraceRequest(post({ questionId: 1 }), deps);
    const reader = res.body!.getReader();
    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(250);
    await reader.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    void pending.catch(() => {});

    expect(reasoning.info.signals[0].aborted).toBe(true);
    expect(store.saveTrace).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe("cancelled");
    expect(deps.limiter.tryStart(7).ok).toBe(true);
  });

  it("saves the row as ready when the reader stops right after trace_ready, before done (as the browser client does)", async () => {
    const { deps, rows, store } = setup();
    const res = await handleTraceRequest(post({ questionId: 1 }), deps);

    // read only as far as the trace_ready line, then stop reading
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes('"type":"trace_ready"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain('"type":"trace_ready"');
    await reader.cancel();
    await vi.advanceTimersByTimeAsync(100);

    expect(store.saveTrace).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ status: "ready", errorCode: null, source: "reasoning", userId: 7, questionId: 1 });
    expect(rows[0].finalParagraphs.length).toBeGreaterThan(0);
    expect(rows[0].finalWords).toBe(300);
    expect(deps.limiter.tryStart(7).ok).toBe(true); // and the slot was released
  });

  it("still says ready when the reader stops after trace_ready while the save is slow", async () => {
    const rows: TraceRow[] = [];
    const slowStore: TraceStore = {
      saveTrace: vi.fn(async (row: TraceRow) => {
        await new Promise((resolve) => setTimeout(resolve, 500)); // the reader leaves while this is running
        rows.push(row);
      }),
      findReusableTrace: async () => null,
    };
    const { deps } = setup({ store: slowStore });
    const res = await handleTraceRequest(post({ questionId: 1 }), deps);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes('"type":"trace_ready"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    await vi.advanceTimersByTimeAsync(1000);

    expect(slowStore.saveTrace).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe("ready");
  });

  it("is handled when the request was already aborted", async () => {
    const { deps, store } = setup();
    const controller = new AbortController();
    controller.abort();
    const res = await handleTraceRequest(post({ questionId: 1 }, { signal: controller.signal }), deps);
    await res.text().catch(() => "");
    await vi.advanceTimersByTimeAsync(10);
    expect(store.saveTrace).toHaveBeenCalledTimes(1);
  });
});

describe("no key-like text anywhere in the answers", () => {
  it("keeps upstream error text out of every response body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky: TraceProvider = {
      stream() {
        return (async function* (): AsyncGenerator<TraceEvent> {
          throw new Error("401 Incorrect API key sk-LIVEKEY, Bearer abc, https://user:pw@host");
        })();
      },
    };
    const { deps } = setup({
      selectProviders: () => ({ ok: true, providers: { model: "m", reasoning: leaky, steps: leaky } }),
    });
    const res = await handleTraceRequest(post({ questionId: 1 }), deps);
    const text = await res.text();
    expect(text).not.toMatch(/sk-|Bearer|https?:|Incorrect|user:pw/);
  });
});
