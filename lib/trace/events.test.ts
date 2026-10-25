import { describe, expect, it } from "vitest";
import {
  isTraceEvent,
  sanitizeEvent,
  TRACE_ERROR_CODES,
  TRACE_ERROR_MESSAGES,
  traceError,
  type TraceEvent,
} from "./events";

describe("isTraceEvent", () => {
  it("accepts every event type, with and without the optional fields", () => {
    expect(isTraceEvent({ type: "reasoning_delta", text: "hi" })).toBe(true);
    expect(isTraceEvent({ type: "answer_delta", text: "" })).toBe(true);
    expect(isTraceEvent({ type: "done", model: "m" })).toBe(true);
    expect(
      isTraceEvent({
        type: "done",
        model: "m",
        servedModel: "s",
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, reasoningTokens: 0 },
      })
    ).toBe(true);
    expect(isTraceEvent({ type: "error", code: "timeout", message: "x" })).toBe(true);
  });

  it("accepts extra properties", () => {
    expect(isTraceEvent({ type: "answer_delta", text: "a", extra: 1 })).toBe(true);
  });

  it("rejects things that are not events", () => {
    for (const bad of [null, undefined, 5, "text", [], {}, { type: "nope" }, { type: "reasoning_delta" }, { type: "answer_delta", text: 3 }]) {
      expect(isTraceEvent(bad)).toBe(false);
    }
  });

  it("rejects malformed done and error events", () => {
    expect(isTraceEvent({ type: "done" })).toBe(false);
    expect(isTraceEvent({ type: "done", model: 1 })).toBe(false);
    expect(isTraceEvent({ type: "done", model: "m", usage: { totalTokens: "3" } })).toBe(false);
    expect(isTraceEvent({ type: "done", model: "m", usage: [] })).toBe(false);
    expect(isTraceEvent({ type: "error", code: "boom", message: "x" })).toBe(false);
    expect(isTraceEvent({ type: "error", code: "upstream" })).toBe(false);
  });
});

describe("error messages", () => {
  it("has a short generic message for every code that never looks like a key or a URL", () => {
    for (const code of TRACE_ERROR_CODES) {
      const message = TRACE_ERROR_MESSAGES[code];
      expect(message.length).toBeLessThan(60);
      expect(message).not.toMatch(/sk-|bearer|https?:|@/i);
      expect(traceError(code)).toEqual({ type: "error", code, message });
    }
  });

  it("sanitizeEvent replaces whatever message an error event carries", () => {
    const dirty: TraceEvent = { type: "error", code: "upstream", message: "401 Bearer sk-abc123 at https://user:pw@host/x" };
    expect(sanitizeEvent(dirty)).toEqual(traceError("upstream"));
  });

  it("sanitizeEvent leaves other events untouched", () => {
    const event: TraceEvent = { type: "answer_delta", text: "sk- is fine inside normal text" };
    expect(sanitizeEvent(event)).toBe(event);
  });
});
