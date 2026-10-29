"use client";

// The content of the current question for the learner page: { content, source, loading }.
//  - Flag off (NEXT_PUBLIC_LIVE_TRACE=false): returns the stored content straight away. Nothing is fetched and
//    nothing is set.
//  - Flag on (the default): starts the live trace when the question is known (before the learner presses Start), shows it with
//    the draft blanks when it is ready, and uses the stored content on an error or when the wait runs out.
// The trace is started from a timer that the effect cleans up, so React strict mode (mount, unmount, mount)
// sends one request, not two. Switching tabs or pressing Reset does not change the question id, so nothing restarts.
import { useEffect, useMemo, useRef, useState } from "react";
import { isLiveTraceEnabled } from "./flag";
import { selectQuestionContent, type QuestionContent, type TraceStatusForQuestion } from "./question-content";
import { traceToPageContent } from "./to-page-content";
import { useTrace } from "./use-trace";

/** How long the learner may wait for the live trace before the stored content is used. DRAFT. */
export const LIVE_CONTENT_WAIT_MS = 45_000;

export interface QuestionLike {
  id: number;
  content: string;
}

export interface UseQuestionContentOptions {
  /** Defaults to the NEXT_PUBLIC_LIVE_TRACE flag (on unless it is "false"). For tests. */
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  waitMs?: number;
}

export function useQuestionContent(question: QuestionLike | null, options: UseQuestionContentOptions = {}): QuestionContent {
  const enabled = options.enabled ?? isLiveTraceEnabled();
  const waitMs = options.waitMs ?? LIVE_CONTENT_WAIT_MS;
  const { state, start, cancel } = useTrace({ fetchImpl: options.fetchImpl });
  const [timedOutFor, setTimedOutFor] = useState<number | null>(null);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  const questionId = question?.id ?? null;
  const storedContent = question?.content || "";

  // Start when the question is known (once per question id; strict mode's cleanup cancels the first timer).
  useEffect(() => {
    if (!enabled || questionId === null) return;
    const startTimer = setTimeout(() => start(questionId), 0);
    return () => clearTimeout(startTimer);
  }, [enabled, questionId, start]);

  const status: TraceStatusForQuestion = !enabled || questionId === null || state.status === "idle" ? "idle" : state.questionId === questionId ? state.status : "idle";

  // Give up after waitMs while the trace is still on its way. A ready or failed trace stops the timer.
  const waiting = enabled && questionId !== null && timedOutFor !== questionId && (status === "idle" || status === "loading");
  useEffect(() => {
    if (!waiting || questionId === null) return;
    const waitTimer = setTimeout(() => {
      setTimedOutFor(questionId);
      cancelRef.current(); // a late trace must not change the content under a learner who has started
    }, waitMs);
    return () => clearTimeout(waitTimer);
  }, [waiting, questionId, waitMs]);

  const trace = status === "ready" && state.status === "ready" ? state.trace : null;
  const live = useMemo(() => (trace && questionId !== null ? traceToPageContent(trace.paragraphs, questionId).content : null), [trace, questionId]);

  return selectQuestionContent({ enabled: enabled && questionId !== null, storedContent, status, liveContent: live, timedOut: timedOutFor === questionId });
}
