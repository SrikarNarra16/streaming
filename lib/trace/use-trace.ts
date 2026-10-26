"use client";

// A thin hook over traceReducer and fetchTrace.
//  - start(questionId) is called explicitly (never from an effect), so React strict mode cannot send two requests
//  - starting again, cancel() and reset() abort the request that is still running
//  - the request is aborted on unmount and nothing is set after that
//  - the last ready trace is kept IN MEMORY ONLY (a ref), for the same question id: start() for that question
//    again shows it without a new request, until reset() is called. Nothing goes to localStorage or cookies.
import { useCallback, useEffect, useReducer, useRef } from "react";
import { fetchTrace, toTraceErrorInfo, type TraceResult } from "./client";
import { initialTraceState, traceReducer, type TraceState } from "./trace-state";

export interface UseTrace {
  state: TraceState;
  start: (questionId: number) => void;
  /** Aborts the running request, if any, and goes back to idle. The remembered trace is kept. */
  cancel: () => void;
  /** Aborts the running request, forgets the remembered trace and goes back to idle. */
  reset: () => void;
}

export function useTrace(options: { fetchImpl?: typeof fetch } = {}): UseTrace {
  const [state, dispatch] = useReducer(traceReducer, initialTraceState);
  const counter = useRef(0); // the id of the newest request or reset
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const remembered = useRef<{ questionId: number; trace: TraceResult } | null>(null);
  const fetchImplRef = useRef(options.fetchImpl);
  fetchImplRef.current = options.fetchImpl;

  useEffect(() => {
    mounted.current = true; // also correct after strict mode's simulated unmount and remount
    return () => {
      mounted.current = false;
      controller.current?.abort();
      controller.current = null;
    };
  }, []);

  const abortRunning = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  const start = useCallback(
    (questionId: number) => {
      if (!mounted.current) return;
      abortRunning(); // starting again cancels the previous request
      const requestId = ++counter.current;

      const kept = remembered.current;
      if (kept && kept.questionId === questionId) {
        dispatch({ type: "start", requestId, questionId });
        dispatch({ type: "ready", requestId, trace: kept.trace }); // no new request
        return;
      }

      const own = new AbortController();
      controller.current = own;
      dispatch({ type: "start", requestId, questionId });
      fetchTrace(questionId, { signal: own.signal, fetchImpl: fetchImplRef.current }).then(
        (trace) => {
          if (!mounted.current || counter.current !== requestId) return; // replaced, cancelled or unmounted
          if (controller.current === own) controller.current = null;
          remembered.current = { questionId, trace };
          dispatch({ type: "ready", requestId, trace });
        },
        (error: unknown) => {
          if (!mounted.current || counter.current !== requestId) return;
          if (controller.current === own) controller.current = null;
          dispatch({ type: "fail", requestId, error: toTraceErrorInfo(error) });
        }
      );
    },
    [abortRunning]
  );

  const cancel = useCallback(() => {
    if (!mounted.current || controller.current === null) return; // nothing is running
    abortRunning();
    dispatch({ type: "reset", requestId: ++counter.current });
  }, [abortRunning]);

  const reset = useCallback(() => {
    if (!mounted.current) return;
    abortRunning();
    remembered.current = null;
    dispatch({ type: "reset", requestId: ++counter.current });
  }, [abortRunning]);

  return { state, start, cancel, reset };
}
