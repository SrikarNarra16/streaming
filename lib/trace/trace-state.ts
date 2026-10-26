// The state of one live trace in the browser, as a pure reducer. Every action carries a requestId. A late
// "ready" or "fail" from a request that was cancelled or replaced has an older id than the state and is
// ignored (the same state object is returned).
import type { TraceErrorInfo, TraceResult } from "./client";

export type TraceState =
  | { status: "idle"; requestId: number }
  | { status: "loading"; requestId: number; questionId: number }
  | { status: "ready"; requestId: number; questionId: number; trace: TraceResult }
  | { status: "error"; requestId: number; questionId: number; error: TraceErrorInfo };

export type TraceAction =
  | { type: "start"; requestId: number; questionId: number }
  | { type: "ready"; requestId: number; trace: TraceResult }
  | { type: "fail"; requestId: number; error: TraceErrorInfo }
  | { type: "reset"; requestId: number };

export const initialTraceState: TraceState = { status: "idle", requestId: 0 };

export function traceReducer(state: TraceState, action: TraceAction): TraceState {
  switch (action.type) {
    case "start":
      // a new request must have a newer id than anything seen so far
      return action.requestId > state.requestId ? { status: "loading", requestId: action.requestId, questionId: action.questionId } : state;

    case "reset":
      return action.requestId > state.requestId ? { status: "idle", requestId: action.requestId } : state;

    case "ready":
      // only the request that is currently loading may finish
      return state.status === "loading" && state.requestId === action.requestId
        ? { status: "ready", requestId: state.requestId, questionId: state.questionId, trace: action.trace }
        : state;

    case "fail":
      return state.status === "loading" && state.requestId === action.requestId
        ? { status: "error", requestId: state.requestId, questionId: state.questionId, error: action.error }
        : state;
  }
}
