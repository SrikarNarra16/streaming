import { describe, expect, it } from "vitest";
import { consumeTrace } from "./consume";
import { isTraceEvent, traceError, type TraceEvent } from "./events";
import { decodeEvents, encodeEvent } from "./ndjson";

const ready: TraceEvent = { type: "trace_ready", source: "reasoning", paragraphs: ["One.", "Two."], words: 2, model: "m" };

describe("trace_ready", () => {
  it("is a valid event, with either source", () => {
    expect(isTraceEvent(ready)).toBe(true);
    expect(isTraceEvent({ ...ready, source: "steps" })).toBe(true);
    expect(isTraceEvent({ ...ready, paragraphs: [], words: 0 })).toBe(true);
  });

  it("is rejected when a field is missing or has the wrong shape", () => {
    expect(isTraceEvent({ ...ready, source: "both" })).toBe(false);
    expect(isTraceEvent({ ...ready, source: undefined })).toBe(false);
    expect(isTraceEvent({ ...ready, paragraphs: "One." })).toBe(false);
    expect(isTraceEvent({ ...ready, paragraphs: ["One.", 2] })).toBe(false);
    expect(isTraceEvent({ ...ready, words: -1 })).toBe(false);
    expect(isTraceEvent({ ...ready, words: 1.5 })).toBe(false);
    expect(isTraceEvent({ ...ready, words: "2" })).toBe(false);
    expect(isTraceEvent({ ...ready, model: undefined })).toBe(false);
  });

  it("survives encoding and decoding unchanged", async () => {
    async function* source() {
      yield encodeEvent(ready) + encodeEvent({ type: "done", model: "m" });
    }
    const events: TraceEvent[] = [];
    for await (const event of decodeEvents(source())) events.push(event);
    expect(events).toEqual([ready, { type: "done", model: "m" }]);
  });

  it("is ignored, with a warning, if a provider ever sends it to the consumer", async () => {
    async function* source(): AsyncGenerator<TraceEvent> {
      yield { type: "answer_delta", text: "answer" };
      yield ready;
      yield { type: "done", model: "m" };
    }
    const res = await consumeTrace(source());
    expect(res).toMatchObject({ status: "complete", answer: "answer" });
    expect(res.warnings).toEqual(["ignored_unknown_event"]);
  });

  it("keeps error events generic next to it", () => {
    expect(traceError("upstream")).toMatchObject({ type: "error", code: "upstream" });
  });
});
