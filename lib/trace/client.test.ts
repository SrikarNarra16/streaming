import { describe, expect, it, vi } from "vitest";
import { fetchTrace, toTraceErrorInfo, TRACE_CLIENT_MESSAGES, TraceClientError, type TraceClientErrorCode } from "./client";
import { TRACE_ERROR_CODES, type TraceEvent } from "./events";
import { encodeEvent } from "./ndjson";

const encoder = new TextEncoder();
const READY: TraceEvent = { type: "trace_ready", source: "steps", paragraphs: ["Héllo 😀 first.", "Second paragraph."], words: 4, model: "m" };
const DONE: TraceEvent = { type: "done", model: "m" };
const bytes = (...events: TraceEvent[]) => encoder.encode(events.map(encodeEvent).join(""));
const oneByteChunks = (data: Uint8Array) => Array.from(data, (b) => Uint8Array.of(b));

// A response body that hands out the given chunks one by one; keepOpen leaves the stream waiting at the end.
function body(chunks: Uint8Array[], options: { keepOpen?: boolean; onCancel?: () => void } = {}) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
        return;
      }
      if (options.keepOpen) return new Promise<void>(() => {});
      controller.close();
    },
    cancel() {
      options.onCancel?.();
    },
  });
}

const ok = (chunks: Uint8Array[], options?: { keepOpen?: boolean; onCancel?: () => void }) =>
  new Response(body(chunks, options), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });

const fakeFetch = (response: Response | (() => Response | Promise<Response>)) =>
  vi.fn(async () => (typeof response === "function" ? response() : response)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const code = (error: unknown) => (error as TraceClientError).code;

describe("fetchTrace: success", () => {
  it("posts the question id as JSON and resolves with the trace_ready fields", async () => {
    const fetchImpl = fakeFetch(ok([bytes(READY, DONE)]));
    const controller = new AbortController();
    const result = await fetchTrace(5, { signal: controller.signal, fetchImpl });

    expect(result).toEqual({ source: "steps", paragraphs: ["Héllo 😀 first.", "Second paragraph."], words: 4, model: "m" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/trace");
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: 5 }) });
    expect(init.signal).toBe(controller.signal);
  });

  it("works when the stream arrives one byte at a time, even inside multi-byte characters", async () => {
    const fetchImpl = fakeFetch(ok(oneByteChunks(bytes(READY, DONE))));
    expect(await fetchTrace(1, { fetchImpl })).toMatchObject({ paragraphs: ["Héllo 😀 first.", "Second paragraph."] });
  });

  it("works when the line is split across a few uneven chunks", async () => {
    const data = bytes(READY, DONE);
    const fetchImpl = fakeFetch(ok([data.slice(0, 5), data.slice(5, 40), data.slice(40)]));
    expect(await fetchTrace(1, { fetchImpl })).toMatchObject({ source: "steps", words: 4 });
  });

  it("ignores events that carry nothing it needs, and lines it cannot read", async () => {
    const chunks = [
      encoder.encode("not json\n"),
      bytes({ type: "reasoning_delta", text: "x" }, { type: "answer_delta", text: "y" }),
      encoder.encode('{"type":"mystery"}\n'),
      bytes(READY),
    ];
    expect(await fetchTrace(1, { fetchImpl: fakeFetch(ok(chunks)) })).toMatchObject({ words: 4 });
  });

  it("resolves at trace_ready without waiting for the end of the stream, and releases the reader", async () => {
    const onCancel = vi.fn();
    const fetchImpl = fakeFetch(ok([bytes(READY)], { keepOpen: true, onCancel }));
    expect(await fetchTrace(1, { fetchImpl })).toMatchObject({ words: 4 });
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("fetchTrace: error events", () => {
  it("maps each server error code to a client code, with the fixed message", async () => {
    const expected: Record<(typeof TRACE_ERROR_CODES)[number], TraceClientErrorCode> = { timeout: "timeout", upstream: "upstream", cancelled: "cancelled", limit: "busy" };
    for (const serverCode of TRACE_ERROR_CODES) {
      const dirty = { type: "error", code: serverCode, message: "Bearer sk-SERVERSECRET at https://u:p@h" } as TraceEvent;
      const error = await fetchTrace(1, { fetchImpl: fakeFetch(ok([bytes(dirty)])) }).catch((e) => e);
      expect(error).toBeInstanceOf(TraceClientError);
      expect(code(error)).toBe(expected[serverCode]);
      expect(error.message).toBe(TRACE_CLIENT_MESSAGES[expected[serverCode]]);
      expect(JSON.stringify([error.message, error.code])).not.toMatch(/sk-|Bearer|https?:/);
    }
  });

  it("rejects at the first error event and releases the reader", async () => {
    const onCancel = vi.fn();
    const fetchImpl = fakeFetch(ok([bytes({ type: "error", code: "upstream", message: "x" })], { keepOpen: true, onCancel }));
    await expect(fetchTrace(1, { fetchImpl })).rejects.toMatchObject({ code: "upstream" });
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("an error after some deltas still rejects", async () => {
    const chunks = [bytes({ type: "reasoning_delta", text: "partial" }), bytes({ type: "error", code: "timeout", message: "x" })];
    await expect(fetchTrace(1, { fetchImpl: fakeFetch(ok(chunks)) })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("fetchTrace: HTTP errors", () => {
  const status = (s: number, headers: Record<string, string> = {}) =>
    fakeFetch(new Response("SERVER SAYS: Bearer sk-LEAK stack trace at /srv/app.js", { status: s, headers }));

  it("401 is auth, 404 is not_found, 503 is not_configured", async () => {
    await expect(fetchTrace(1, { fetchImpl: status(401) })).rejects.toMatchObject({ code: "auth" });
    await expect(fetchTrace(1, { fetchImpl: status(404) })).rejects.toMatchObject({ code: "not_found" });
    await expect(fetchTrace(1, { fetchImpl: status(503) })).rejects.toMatchObject({ code: "not_configured" });
  });

  it("429 is busy and carries the Retry-After seconds when the header is valid", async () => {
    const error = await fetchTrace(1, { fetchImpl: status(429, { "Retry-After": "17" }) }).catch((e) => e);
    expect(error).toMatchObject({ code: "busy", retryAfterSeconds: 17 });
    for (const header of [undefined, "abc", "-3", "1.5", "Wed, 21 Oct 2026 07:28:00 GMT", ""]) {
      const e = await fetchTrace(1, { fetchImpl: status(429, header === undefined ? {} : { "Retry-After": header }) }).catch((x) => x);
      expect(e.code).toBe("busy");
      expect(e.retryAfterSeconds).toBeUndefined();
    }
  });

  it("other server errors are upstream, other client errors are unknown", async () => {
    await expect(fetchTrace(1, { fetchImpl: status(500) })).rejects.toMatchObject({ code: "upstream" });
    await expect(fetchTrace(1, { fetchImpl: status(502) })).rejects.toMatchObject({ code: "upstream" });
    await expect(fetchTrace(1, { fetchImpl: status(400) })).rejects.toMatchObject({ code: "unknown" });
    await expect(fetchTrace(1, { fetchImpl: status(418) })).rejects.toMatchObject({ code: "unknown" });
  });

  it("never shows anything the server wrote", async () => {
    for (const s of [400, 401, 404, 429, 500, 503]) {
      const error = await fetchTrace(1, { fetchImpl: status(s) }).catch((e) => e);
      expect(error.message).toBe(TRACE_CLIENT_MESSAGES[error.code as TraceClientErrorCode]);
      expect(JSON.stringify([error.message, error.name, error.code])).not.toMatch(/SERVER SAYS|sk-|Bearer|stack|app\.js/);
    }
  });

  it("does not read an error body (only gives it back)", async () => {
    const response = new Response("secret body", { status: 500 });
    const text = vi.spyOn(response, "text");
    const json = vi.spyOn(response, "json");
    await fetchTrace(1, { fetchImpl: fakeFetch(response) }).catch(() => {});
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});

describe("fetchTrace: network failures and a missing body", () => {
  it("a network failure is unknown, and its text is not shown", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch https://host/?key=sk-NETLEAK");
    }) as unknown as typeof fetch;
    const error = await fetchTrace(1, { fetchImpl }).catch((e) => e);
    expect(error).toBeInstanceOf(TraceClientError);
    expect(error.code).toBe("unknown");
    expect(error.message).toBe(TRACE_CLIENT_MESSAGES.unknown);
    expect(error.message).not.toMatch(/sk-|https?:|fetch/);
  });

  it("a successful response without a body is upstream", async () => {
    const response = new Response(null, { status: 200 });
    await expect(fetchTrace(1, { fetchImpl: fakeFetch(response) })).rejects.toMatchObject({ code: "upstream" });
  });
});

describe("fetchTrace: abort", () => {
  it("rejects with cancelled, without calling fetch, when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = fakeFetch(ok([bytes(READY)]));
    await expect(fetchTrace(1, { signal: controller.signal, fetchImpl })).rejects.toMatchObject({ code: "cancelled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects with cancelled when the signal aborts while the request is being made", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError"))))
    ) as unknown as typeof fetch;
    const pending = fetchTrace(1, { signal: controller.signal, fetchImpl });
    await tick();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });

  it("rejects with cancelled mid-stream, and releases the reader (the stream is cancelled)", async () => {
    const onCancel = vi.fn();
    const controller = new AbortController();
    const fetchImpl = fakeFetch(ok([bytes({ type: "reasoning_delta", text: "partial" })], { keepOpen: true, onCancel }));
    const pending = fetchTrace(1, { signal: controller.signal, fetchImpl });
    await tick(); // the first chunk was read; the next read is waiting
    expect(onCancel).not.toHaveBeenCalled();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled", message: TRACE_CLIENT_MESSAGES.cancelled });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not leave an abort listener behind after it finishes", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await fetchTrace(1, { signal: controller.signal, fetchImpl: fakeFetch(ok([bytes(READY)])) });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("fetchTrace: a stream that ends early", () => {
  it("an empty stream is upstream", async () => {
    await expect(fetchTrace(1, { fetchImpl: fakeFetch(ok([])) })).rejects.toMatchObject({ code: "upstream" });
  });

  it("a stream with only reasoning and done (no trace_ready) is upstream", async () => {
    const chunks = [bytes({ type: "reasoning_delta", text: "x" }, DONE)];
    await expect(fetchTrace(1, { fetchImpl: fakeFetch(ok(chunks)) })).rejects.toMatchObject({ code: "upstream" });
  });

  it("a stream that is cut off in the middle of the trace_ready line is upstream", async () => {
    const data = bytes(READY);
    await expect(fetchTrace(1, { fetchImpl: fakeFetch(ok([data.slice(0, data.length - 10)])) })).rejects.toMatchObject({ code: "upstream" });
  });

  it("a stream that breaks with a network error is upstream, not a crash", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes({ type: "reasoning_delta", text: "x" }));
      },
      pull() {
        throw new Error("socket closed: sk-STREAMLEAK");
      },
    });
    const error = await fetchTrace(1, { fetchImpl: fakeFetch(new Response(broken, { status: 200 })) }).catch((e) => e);
    expect(error.code).toBe("upstream");
    expect(error.message).not.toMatch(/sk-|socket/);
  });
});

describe("TraceClientError", () => {
  it("has a fixed generic message for every code, and nothing key-like in any of them", () => {
    const codes = Object.keys(TRACE_CLIENT_MESSAGES) as TraceClientErrorCode[];
    expect(codes.sort()).toEqual(["auth", "busy", "cancelled", "not_configured", "not_found", "timeout", "unknown", "upstream"]);
    for (const c of codes) {
      const error = new TraceClientError(c);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("TraceClientError");
      expect(error.message).toBe(TRACE_CLIENT_MESSAGES[c]);
      expect(error.message).not.toMatch(/sk-|Bearer|https?:/i);
      expect(error.message.length).toBeLessThan(120);
    }
  });

  it("only carries retryAfterSeconds when given", () => {
    expect(new TraceClientError("busy", 12).retryAfterSeconds).toBe(12);
    expect("retryAfterSeconds" in new TraceClientError("busy")).toBe(false);
  });
});

describe("toTraceErrorInfo", () => {
  it("turns a TraceClientError into plain state data, and anything else into unknown", () => {
    expect(toTraceErrorInfo(new TraceClientError("busy", 9))).toEqual({ code: "busy", message: TRACE_CLIENT_MESSAGES.busy, retryAfterSeconds: 9 });
    expect(toTraceErrorInfo(new TraceClientError("auth"))).toEqual({ code: "auth", message: TRACE_CLIENT_MESSAGES.auth });
    expect(toTraceErrorInfo(new Error("secret sk-1"))).toEqual({ code: "unknown", message: TRACE_CLIENT_MESSAGES.unknown });
    expect(toTraceErrorInfo("string")).toEqual({ code: "unknown", message: TRACE_CLIENT_MESSAGES.unknown });
  });
});
