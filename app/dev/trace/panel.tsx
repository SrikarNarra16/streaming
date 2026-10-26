"use client";

// Plain, unstyled panel for trying the live trace. It does not write to /api/logs and stores nothing.
import { useEffect, useRef, useState } from "react";
import { useTrace } from "../../../lib/trace/use-trace";

export function TraceDevPanel() {
  const { state, start, cancel, reset } = useTrace();
  const [questionId, setQuestionId] = useState("1");
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef(0);

  // Elapsed time: counts up while loading and stays at the final value afterwards.
  useEffect(() => {
    if (state.status === "loading") {
      startedAt.current = performance.now();
      setElapsedMs(0);
      const timer = setInterval(() => setElapsedMs(performance.now() - startedAt.current), 100);
      return () => clearInterval(timer);
    }
    if (state.status === "ready" || state.status === "error") setElapsedMs(performance.now() - startedAt.current);
  }, [state.status, state.requestId]);

  const id = Number(questionId);
  const validId = Number.isInteger(id) && id >= 1;

  return (
    <main style={{ padding: 16, fontFamily: "monospace" }}>
      <h1>Trace test page (development only)</h1>
      <p>Needs a logged-in session. Log in at <a href="/auth/login">/auth/login</a> first.</p>

      <label>
        Question id: <input type="number" min={1} value={questionId} onChange={(e) => setQuestionId(e.target.value)} />
      </label>{" "}
      <button onClick={() => start(id)} disabled={!validId || state.status === "loading"}>
        Start
      </button>{" "}
      <button onClick={cancel} disabled={state.status !== "loading"}>
        Cancel
      </button>{" "}
      <button onClick={reset}>Reset</button>

      <p>State: {state.status}</p>
      <p>Elapsed: {(elapsedMs / 1000).toFixed(1)} s</p>

      {state.status === "error" && (
        <p>
          {state.error.code === "auth" ? (
            <>
              Not logged in. Please <a href="/auth/login">log in</a> and try again.
            </>
          ) : (
            state.error.message
          )}
          {state.error.code === "busy" && state.error.retryAfterSeconds !== undefined && ` Try again in ${state.error.retryAfterSeconds} s.`}{" "}
          (code: {state.error.code})
        </p>
      )}

      {state.status === "ready" && (
        <>
          <p>Source: {state.trace.source}</p>
          <p>Words: {state.trace.words}</p>
          <p>Model: {state.trace.model}</p>
          <p>Paragraphs: {state.trace.paragraphs.length}</p>
          <ol>
            {state.trace.paragraphs.map((paragraph, i) => (
              <li key={i} style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>
                {paragraph}
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}
