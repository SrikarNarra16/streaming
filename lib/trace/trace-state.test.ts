import { describe, expect, it } from "vitest";
import type { TraceErrorInfo, TraceResult } from "./client";
import { initialTraceState, traceReducer, type TraceAction, type TraceState } from "./trace-state";

const TRACE: TraceResult = { source: "reasoning", paragraphs: ["One.", "Two."], words: 2, model: "m" };
const TRACE_B: TraceResult = { source: "steps", paragraphs: ["Other."], words: 1, model: "m" };
const ERROR: TraceErrorInfo = { code: "upstream", message: "The trace could not be created. Please try again." };

const run = (actions: TraceAction[], from: TraceState = initialTraceState) => actions.reduce(traceReducer, from);

describe("transitions", () => {
  it("starts idle", () => {
    expect(initialTraceState).toEqual({ status: "idle", requestId: 0 });
  });

  it("idle -> loading on start", () => {
    expect(run([{ type: "start", requestId: 1, questionId: 4 }])).toEqual({ status: "loading", requestId: 1, questionId: 4 });
  });

  it("loading -> ready with the trace, keeping the question id", () => {
    const state = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "ready", requestId: 1, trace: TRACE },
    ]);
    expect(state).toEqual({ status: "ready", requestId: 1, questionId: 4, trace: TRACE });
  });

  it("loading -> error with the error info", () => {
    const state = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "fail", requestId: 1, error: ERROR },
    ]);
    expect(state).toEqual({ status: "error", requestId: 1, questionId: 4, error: ERROR });
  });

  it("reset goes back to idle from every state, with the newer id", () => {
    const loading = run([{ type: "start", requestId: 1, questionId: 4 }]);
    const ready = traceReducer(loading, { type: "ready", requestId: 1, trace: TRACE });
    const error = traceReducer(loading, { type: "fail", requestId: 1, error: ERROR });
    for (const from of [initialTraceState, loading, ready, error]) {
      expect(traceReducer(from, { type: "reset", requestId: 9 })).toEqual({ status: "idle", requestId: 9 });
    }
  });

  it("start from ready or error drops the old result and loads again", () => {
    const ready = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "ready", requestId: 1, trace: TRACE },
    ]);
    expect(traceReducer(ready, { type: "start", requestId: 2, questionId: 5 })).toEqual({ status: "loading", requestId: 2, questionId: 5 });
    const error = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "fail", requestId: 1, error: ERROR },
    ]);
    expect(traceReducer(error, { type: "start", requestId: 2, questionId: 4 })).toEqual({ status: "loading", requestId: 2, questionId: 4 });
  });

  it("a full normal life: start, ready, start again, fail, reset", () => {
    const state = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "ready", requestId: 1, trace: TRACE },
      { type: "start", requestId: 2, questionId: 4 },
      { type: "fail", requestId: 2, error: ERROR },
      { type: "reset", requestId: 3 },
    ]);
    expect(state).toEqual({ status: "idle", requestId: 3 });
  });
});

describe("late and out-of-order actions are ignored (the same state object comes back)", () => {
  it("a ready from a request that was cancelled (reset) while loading", () => {
    const idle = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "reset", requestId: 2 },
    ]);
    expect(traceReducer(idle, { type: "ready", requestId: 1, trace: TRACE })).toBe(idle);
  });

  it("a fail from a request that was cancelled (reset) while loading", () => {
    const idle = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "reset", requestId: 2 },
    ]);
    expect(traceReducer(idle, { type: "fail", requestId: 1, error: ERROR })).toBe(idle);
  });

  it("a ready from a request that was replaced by a newer one", () => {
    const loading2 = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "start", requestId: 2, questionId: 5 },
    ]);
    expect(traceReducer(loading2, { type: "ready", requestId: 1, trace: TRACE })).toBe(loading2);
    expect(traceReducer(loading2, { type: "fail", requestId: 1, error: ERROR })).toBe(loading2);
  });

  it("the newer request can still finish after an older one's late answer was ignored", () => {
    const state = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "start", requestId: 2, questionId: 5 },
      { type: "ready", requestId: 1, trace: TRACE }, // late, ignored
      { type: "ready", requestId: 2, trace: TRACE_B },
    ]);
    expect(state).toEqual({ status: "ready", requestId: 2, questionId: 5, trace: TRACE_B });
  });

  it("answers that arrive in the opposite order: the old one cannot overwrite the new result", () => {
    const state = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "start", requestId: 2, questionId: 5 },
      { type: "ready", requestId: 2, trace: TRACE_B },
      { type: "ready", requestId: 1, trace: TRACE },
      { type: "fail", requestId: 1, error: ERROR },
    ]);
    expect(state).toEqual({ status: "ready", requestId: 2, questionId: 5, trace: TRACE_B });
  });

  it("a ready or fail with nothing loading (idle) is ignored", () => {
    expect(traceReducer(initialTraceState, { type: "ready", requestId: 0, trace: TRACE })).toBe(initialTraceState);
    expect(traceReducer(initialTraceState, { type: "fail", requestId: 0, error: ERROR })).toBe(initialTraceState);
  });

  it("a second ready or a fail after the request already finished is ignored", () => {
    const ready = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "ready", requestId: 1, trace: TRACE },
    ]);
    expect(traceReducer(ready, { type: "ready", requestId: 1, trace: TRACE_B })).toBe(ready);
    expect(traceReducer(ready, { type: "fail", requestId: 1, error: ERROR })).toBe(ready);
    const error = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "fail", requestId: 1, error: ERROR },
    ]);
    expect(traceReducer(error, { type: "ready", requestId: 1, trace: TRACE })).toBe(error);
  });

  it("a ready for an id that was never started is ignored", () => {
    const loading = run([{ type: "start", requestId: 3, questionId: 4 }]);
    expect(traceReducer(loading, { type: "ready", requestId: 7, trace: TRACE })).toBe(loading);
    expect(traceReducer(loading, { type: "fail", requestId: 2, error: ERROR })).toBe(loading);
  });

  it("a start or reset that is not newer than the state is ignored", () => {
    const loading = run([{ type: "start", requestId: 5, questionId: 4 }]);
    expect(traceReducer(loading, { type: "start", requestId: 5, questionId: 9 })).toBe(loading);
    expect(traceReducer(loading, { type: "start", requestId: 3, questionId: 9 })).toBe(loading);
    expect(traceReducer(loading, { type: "reset", requestId: 5 })).toBe(loading);
    expect(traceReducer(loading, { type: "reset", requestId: 4 })).toBe(loading);
  });

  it("a ready that arrives after a reset and a new start for the same question does not leak into it", () => {
    const state = run([
      { type: "start", requestId: 1, questionId: 4 },
      { type: "reset", requestId: 2 },
      { type: "start", requestId: 3, questionId: 4 },
      { type: "ready", requestId: 1, trace: TRACE }, // from the cancelled request
    ]);
    expect(state).toEqual({ status: "loading", requestId: 3, questionId: 4 });
  });
});

describe("the reducer does not change its input", () => {
  it("returns new objects and leaves the old state as it was", () => {
    const loading = run([{ type: "start", requestId: 1, questionId: 4 }]);
    const frozen = JSON.stringify(loading);
    traceReducer(loading, { type: "ready", requestId: 1, trace: TRACE });
    expect(JSON.stringify(loading)).toBe(frozen);
  });
});
