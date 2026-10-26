// Consumes a stream of trace events and reduces it to one result with a clear status.
//
// "The full answer has been delivered" means: a `done` event, or the end of the stream, arrived
// after at least one answer_delta. Anything that goes wrong after that point (an error event, or
// the stream not closing in time) cannot cost the learner the answer, so the status stays
// "complete" and only a warning is added. After a `done` the consumer therefore keeps reading, for
// at most drainTimeoutMs, only to see whether the stream closes cleanly.
//
// Status table:
//   done event                                               -> complete  (warning if there was no answer)
//   end of stream without done, after >= 1 answer_delta      -> complete  (warning: stream_ended_without_done)
//   end of stream without done, no answer_delta yet          -> failed    (partial reasoning is kept)
//   error event or idle timeout, no answer_delta yet         -> failed    (partial reasoning is kept)
//   error event or idle timeout during the answer            -> partial
//   error event or drain timeout after the full answer       -> complete  (warning)
//   the caller's signal aborts                               -> cancelled
//   reasoning grows past maxReasoningWords                   -> truncated (upstream is aborted)
//   the stream throws                                        -> handled like an "upstream" error event
import {
  isTraceEvent,
  sanitizeEvent,
  TRACE_ERROR_MESSAGES,
  type TraceErrorCode,
  type TraceEvent,
  type TraceUsage,
} from "./events";
import type { TraceProvider } from "./provider";

export type ConsumeStatus = "complete" | "partial" | "failed" | "cancelled" | "truncated";

/** Things that went slightly wrong without changing the status. */
export const TRACE_WARNINGS = [
  "error_after_answer",
  "timeout_after_answer",
  "stream_ended_without_done",
  "finished_without_answer",
  "events_after_done",
  "ignored_unknown_event",
  "callback_error",
] as const;
export type TraceWarning = (typeof TRACE_WARNINGS)[number];

export interface ConsumeOptions {
  /** Longest wait between two events, once the first one has arrived. Default 30000. */
  idleTimeoutMs?: number;
  /** Longest wait before the FIRST event. Default: the same as idleTimeoutMs. */
  firstEventTimeoutMs?: number;
  /** Deadline for the whole stream, counted from the start of consumption. Default: none.
   *  When it passes it is handled like an idle timeout. */
  maxTotalMs?: number;
  /** After `done`: longest wait for the stream to close cleanly. Default 2000. */
  drainTimeoutMs?: number;
  /** Aborting it ends consumption with status "cancelled". */
  signal?: AbortSignal;
  /** Stop once the reasoning has more than this many words (default: unlimited). */
  maxReasoningWords?: number;
  onReasoning?: (text: string) => void;
  onAnswer?: (text: string) => void;
  /** Called when consumption stops early (timeout, cancel, truncation, failure) so the source can abort. */
  abortUpstream?: () => void;
}

export interface ConsumeResult {
  status: ConsumeStatus;
  reasoning: string;
  answer: string;
  error?: { code: TraceErrorCode; message: string };
  warnings: TraceWarning[];
  model?: string;
  servedModel?: string;
  finishReason?: string;
  usage?: TraceUsage;
}

type Outcome =
  | { kind: "next"; result: IteratorResult<TraceEvent> }
  | { kind: "idle" }
  | { kind: "aborted" }
  | { kind: "threw" };

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export async function consumeTrace(events: AsyncIterable<TraceEvent>, options: ConsumeOptions = {}): Promise<ConsumeResult> {
  const idleMs = options.idleTimeoutMs ?? 30000;
  const firstMs = options.firstEventTimeoutMs ?? idleMs;
  const drainMs = options.drainTimeoutMs ?? 2000;
  const { signal } = options;

  const result: ConsumeResult = { status: "failed", reasoning: "", answer: "", warnings: [] };
  const warn = (code: TraceWarning) => {
    if (!result.warnings.includes(code)) result.warnings.push(code);
  };
  const safely = (callback: ((text: string) => void) | undefined, text: string) => {
    try {
      callback?.(text);
    } catch {
      warn("callback_error");
    }
  };

  let answerDeltas = 0;
  let eventsSeen = 0;
  let doneSeen = false;
  let stoppedEarly = false;

  let iterator: AsyncIterator<TraceEvent> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  // The total deadline is one timer for the whole stream; without it this promise never settles.
  const totalPromise = new Promise<Outcome>((resolve) => {
    if (options.maxTotalMs !== undefined) totalTimer = setTimeout(() => resolve({ kind: "idle" }), options.maxTotalMs);
  });

  const abortedPromise = new Promise<Outcome>((resolve) => {
    if (!signal) return;
    onAbort = () => resolve({ kind: "aborted" });
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });

  // An error or timeout: after the full answer it only adds a warning; before that it decides the status.
  const fail = (code: TraceErrorCode) => {
    if (doneSeen) {
      result.status = "complete";
      warn(code === "timeout" ? "timeout_after_answer" : "error_after_answer");
      return;
    }
    result.error = { code, message: TRACE_ERROR_MESSAGES[code] };
    result.status = answerDeltas > 0 ? "partial" : "failed";
  };

  try {
    if (signal?.aborted) {
      result.status = "cancelled";
      stoppedEarly = true;
      return result;
    }
    try {
      iterator = events[Symbol.asyncIterator]();
    } catch {
      fail("upstream");
      stoppedEarly = true;
      return result;
    }

    for (;;) {
      const next = iterator.next();
      next.catch(() => {}); // an abandoned next() must never become an unhandled rejection
      const nextOutcome: Promise<Outcome> = next.then(
        (r) => ({ kind: "next", result: r }) as Outcome,
        () => ({ kind: "threw" }) as Outcome
      );
      const waitMs = doneSeen ? drainMs : eventsSeen === 0 ? firstMs : idleMs;
      const idleOutcome = new Promise<Outcome>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "idle" }), waitMs);
      });

      let outcome: Outcome;
      try {
        outcome = await Promise.race([nextOutcome, idleOutcome, totalPromise, abortedPromise]);
      } finally {
        clearTimeout(timer);
        timer = undefined;
      }

      if (outcome.kind === "aborted") {
        result.status = "cancelled";
        stoppedEarly = true;
        return result;
      }
      if (outcome.kind === "idle") {
        fail("timeout");
        stoppedEarly = true;
        return result;
      }
      if (outcome.kind === "threw") {
        fail("upstream");
        stoppedEarly = true;
        return result;
      }

      const { result: step } = outcome;
      if (!step.done) eventsSeen++;
      if (step.done) {
        if (doneSeen) {
          result.status = "complete";
        } else if (answerDeltas > 0) {
          result.status = "complete";
          warn("stream_ended_without_done");
        } else {
          fail("upstream"); // the stream ended before any answer and without done
        }
        return result;
      }

      if (!isTraceEvent(step.value)) {
        warn("ignored_unknown_event");
        continue;
      }
      const event = sanitizeEvent(step.value);

      if (event.type === "error") {
        fail(event.code);
        stoppedEarly = true;
        return result;
      }
      if (doneSeen) {
        warn("events_after_done");
        continue;
      }

      if (event.type === "reasoning_delta") {
        result.reasoning += event.text;
        safely(options.onReasoning, event.text);
        if (options.maxReasoningWords !== undefined && countWords(result.reasoning) > options.maxReasoningWords) {
          result.status = "truncated";
          stoppedEarly = true;
          return result;
        }
      } else if (event.type === "answer_delta") {
        answerDeltas++;
        result.answer += event.text;
        safely(options.onAnswer, event.text);
      } else if (event.type === "done") {
        doneSeen = true;
        result.model = event.model;
        if (event.servedModel !== undefined) result.servedModel = event.servedModel;
        if (event.finishReason !== undefined) result.finishReason = event.finishReason;
        if (event.usage !== undefined) result.usage = event.usage;
        result.status = "complete";
        if (answerDeltas === 0) warn("finished_without_answer");
      } else {
        // trace_ready is what the server sends to the browser; a provider never produces it
        warn("ignored_unknown_event");
      }
    }
  } finally {
    // Always: no timer, no abort listener, no upstream left running.
    clearTimeout(timer);
    clearTimeout(totalTimer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    if (stoppedEarly) {
      try {
        options.abortUpstream?.();
      } catch {
        /* ignore */
      }
    }
    if (iterator?.return) {
      // Not awaited: a stalled source only finishes after abortUpstream() above has fired.
      Promise.resolve()
        .then(() => iterator!.return!())
        .catch(() => {});
    }
  }
}

/**
 * Convenience for a TraceProvider: creates the AbortController the provider needs, wires it to
 * consumeTrace (so timeouts, truncation and cancellation abort the provider) and consumes the stream.
 */
export async function consumeFromProvider(
  provider: TraceProvider,
  prompt: string,
  options: Omit<ConsumeOptions, "abortUpstream"> = {}
): Promise<ConsumeResult> {
  const controller = new AbortController();
  let events: AsyncIterable<TraceEvent>;
  try {
    events = provider.stream({ prompt, signal: controller.signal });
  } catch {
    events = {
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("provider failed to start")) }),
    };
  }
  return consumeTrace(events, { ...options, abortUpstream: () => controller.abort() });
}
