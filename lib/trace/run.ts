// Orchestration of one live trace for one user. No Next.js imports, so it can be tested on its own.
//
// What happens (details in the comments below):
//   1. unless the setting is "steps": ask the reasoning provider, consume its stream on the SERVER (the raw
//      deltas never reach the browser), clean it, count its words; stop and abort upstream as soon as the
//      cleaned reasoning is longer than maxWords
//   2. decide with decideTraceSource which kind of text becomes the trace
//   3. if that is "steps": ask the steps provider (thinking disabled) and use its answer text as the trace
//   4. if the steps call fails: fall back to the reasoning, if there is any
//   5. segment the final text and send the browser ONLY trace_ready and done, or one generic error event
//   6. save one row through the store, exactly once, however the run ends
//
// The browser never receives upstream text: error events carry the fixed generic messages from events.ts.
import { cleanTrace } from "../clean-trace";
import { segmentTrace } from "../segment";
import { consumeFromProvider, type ConsumeOptions, type ConsumeResult } from "./consume";
import { traceError, type TraceEvent, type TraceSource, type TraceUsage } from "./events";
import type { TraceLimiter } from "./limits";
import { decideTraceSource, type TraceSetting } from "./policy";
import type { TraceProvider } from "./provider";
import { buildStepsPrompt } from "./steps-prompt";

export interface TraceRunLimits {
  /** The trace should have at least / at most this many words (counted after cleaning). */
  minWords: number;
  maxWords: number;
  /** Longest wait before the first event, and between two events, for each provider call. */
  firstEventTimeoutMs: number;
  idleTimeoutMs: number;
  /** Deadline for each provider call. */
  maxTotalMs: number;
}

export type TraceRunStatus = "ready" | "failed" | "cancelled";

/** What is saved for one request. Matches the `traces` table. */
export interface TraceRow {
  userId: number;
  questionId: number;
  source: TraceSource;
  decisionReason: string;
  model: string;
  servedModel: string | null;
  status: TraceRunStatus;
  rawReasoning: string | null;
  stepsText: string | null;
  finalParagraphs: string[];
  finalWords: number;
  usage: { reasoning?: TraceUsage; steps?: TraceUsage } | null;
  warnings: string[];
  errorCode: string | null;
  totalMs: number | null;
}

export interface TraceStore {
  saveTrace(row: TraceRow): Promise<void>;
}

export interface RunTraceInput {
  userId: number;
  questionId: number;
  /** The question text, taken from the database by the caller. */
  prompt: string;
  /** The model that is being asked (saved and sent as `model`). */
  model: string;
  reasoningProvider: TraceProvider;
  stepsProvider: TraceProvider;
  setting: TraceSetting;
  limits: TraceRunLimits;
  store: TraceStore;
  /** Aborted when the client goes away. The run then ends as "cancelled" and is still saved. */
  signal: AbortSignal;
}

const countWords = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);
const sumWords = (paragraphs: string[]) => paragraphs.reduce((n, p) => n + countWords(p), 0);

// Whole paragraphs from the start, as many as fit in maxWords. Never cuts inside a paragraph, so never
// mid-sentence. If even the first paragraph is longer than maxWords it is kept whole.
function trimAtParagraphBoundary(text: string, maxWords: number): string[] {
  const paragraphs = segmentTrace(text);
  const kept: string[] = [];
  let total = 0;
  for (const paragraph of paragraphs) {
    const words = countWords(paragraph);
    if (total + words > maxWords) break;
    kept.push(paragraph);
    total += words;
  }
  if (kept.length === 0 && paragraphs.length > 0) kept.push(paragraphs[0]);
  return kept;
}

function logFailure(what: string, error: unknown): void {
  const raw = error instanceof Error ? error.name : typeof error;
  console.error(`[trace] ${what}:`, /^[A-Za-z0-9_]{1,60}$/.test(raw) ? raw : "Error"); // the name only, never the message
}

export async function* runTraceForUser(input: RunTraceInput): AsyncGenerator<TraceEvent> {
  const { limits, signal } = input;
  const started = Date.now();
  const warnings = new Set<string>();
  const usage: { reasoning?: TraceUsage; steps?: TraceUsage } = {};
  const row: TraceRow = {
    userId: input.userId,
    questionId: input.questionId,
    source: "reasoning",
    decisionReason: "",
    model: input.model,
    servedModel: null,
    status: "cancelled", // until the run reaches a real ending
    rawReasoning: null,
    stepsText: null,
    finalParagraphs: [],
    finalWords: 0,
    usage: null,
    warnings: [],
    errorCode: null,
    totalMs: null,
  };

  const timeouts = (extra: Partial<ConsumeOptions>): ConsumeOptions => ({
    firstEventTimeoutMs: limits.firstEventTimeoutMs,
    idleTimeoutMs: limits.idleTimeoutMs,
    maxTotalMs: limits.maxTotalMs,
    signal,
    ...extra,
  });
  const absorb = (result: ConsumeResult, key: "reasoning" | "steps") => {
    result.warnings.forEach((w) => warnings.add(w));
    if (result.usage) usage[key] = result.usage;
    if (result.servedModel) row.servedModel = result.servedModel;
  };
  const cancelled = (): TraceEvent => {
    row.status = "cancelled";
    row.errorCode = "cancelled";
    return traceError("cancelled");
  };
  const failed = (): TraceEvent => {
    row.status = "failed";
    row.errorCode = "upstream";
    return traceError("upstream");
  };

  try {
    // ---- 1. the reasoning call (skipped entirely for the "steps" setting) -------------------------
    let reasoningText = ""; // cleaned
    let reasoningWords = 0;
    let reasoningUsable = false; // complete enough to base the decision on
    let stoppedForLength = false;

    if (input.setting !== "steps") {
      const stop = new AbortController();
      let received = "";
      let rawWords = 0;
      let inWord = false;
      const result = await consumeFromProvider(
        input.reasoningProvider,
        input.prompt,
        timeouts({
          signal: AbortSignal.any([signal, stop.signal]),
          onReasoning: (text) => {
            received += text;
            for (const ch of text) {
              const space = /\s/.test(ch);
              if (!space && !inWord) rawWords++;
              inWord = !space;
            }
            // Cleaning can only remove words, so the exact (cleaned) count is needed only once the raw one is over.
            if (!stoppedForLength && rawWords > limits.maxWords && countWords(cleanTrace(received).text) > limits.maxWords) {
              stoppedForLength = true;
              stop.abort(); // ends the stream and aborts the provider at once
            }
          },
        })
      );
      absorb(result, "reasoning");
      row.rawReasoning = result.reasoning === "" ? null : result.reasoning;

      if (signal.aborted) {
        yield cancelled();
        return;
      }
      reasoningText = cleanTrace(result.reasoning).text;
      reasoningWords = countWords(reasoningText);
      if (stoppedForLength) warnings.add("reasoning_stopped_at_max_words");
      reasoningUsable = stoppedForLength || result.status === "complete" || result.status === "partial";
      if (!reasoningUsable) warnings.add("reasoning_failed");
    }

    // ---- 2. the decision ----------------------------------------------------------------------
    const decision = decideTraceSource({
      setting: input.setting,
      reasoningWords: reasoningUsable ? Math.max(reasoningWords, stoppedForLength ? limits.maxWords + 1 : 0) : 0,
      minWords: limits.minWords,
      maxWords: limits.maxWords,
    });
    row.source = decision.source;
    row.decisionReason = decision.reason;

    let paragraphs: string[] = [];
    let finalSource: TraceSource = decision.source;

    if (decision.source === "reasoning") {
      // Only the "reasoning" setting (or a decision for in-range reasoning) gets here.
      if (stoppedForLength || reasoningWords > limits.maxWords) {
        paragraphs = trimAtParagraphBoundary(reasoningText, limits.maxWords);
        warnings.add("reasoning_trimmed_to_max_words");
      } else if (reasoningText.trim() !== "") {
        paragraphs = segmentTrace(reasoningText);
      }
    } else {
      // ---- 3. the steps call --------------------------------------------------------------------
      const result = await consumeFromProvider(input.stepsProvider, buildStepsPrompt(input.prompt), timeouts({}));
      absorb(result, "steps");
      row.stepsText = result.answer === "" ? null : result.answer;

      if (signal.aborted) {
        yield cancelled();
        return;
      }
      const stepsText = cleanTrace(result.answer).text;
      if (result.status === "complete" && countWords(stepsText) > 0) {
        paragraphs = segmentTrace(stepsText);
      } else {
        // ---- 4. the steps call failed: fall back to the reasoning, if there is any ----------------
        warnings.add("steps_failed");
        warnings.add(`decision_${decision.reason}`);
        if (reasoningText.trim() !== "") {
          finalSource = "reasoning";
          if (reasoningWords > limits.maxWords || stoppedForLength) {
            paragraphs = trimAtParagraphBoundary(reasoningText, limits.maxWords);
            row.decisionReason = "steps_failed_used_trimmed_reasoning";
          } else if (reasoningWords < limits.minWords) {
            paragraphs = segmentTrace(reasoningText);
            row.decisionReason = "steps_failed_used_short_reasoning";
          } else {
            paragraphs = segmentTrace(reasoningText);
            row.decisionReason = "steps_failed_used_reasoning";
          }
        }
      }
    }

    // ---- 5. the ending ------------------------------------------------------------------------
    if (paragraphs.length === 0) {
      yield failed(); // nothing usable
      return;
    }
    row.source = finalSource;
    row.finalParagraphs = paragraphs;
    row.finalWords = sumWords(paragraphs);
    row.status = "ready";
    row.errorCode = null;
    yield { type: "trace_ready", source: finalSource, paragraphs, words: row.finalWords, model: input.model };
    yield { type: "done", model: input.model };
  } catch (error) {
    logFailure("run failed", error);
    if (row.status !== "ready") yield failed();
  } finally {
    // ---- 6. save, exactly once, whatever happened (also when the reader stopped early) -------------
    row.totalMs = Date.now() - started;
    row.usage = Object.keys(usage).length > 0 ? usage : null;
    row.warnings = [...warnings];
    try {
      await input.store.saveTrace(row);
    } catch (error) {
      logFailure("could not save the trace", error); // never breaks the response
    }
  }
}

export type StartTraceRunResult =
  | { ok: true; events: AsyncGenerator<TraceEvent>; release: () => void }
  | { ok: false; reason: "busy" | "hourly"; retryAfterSeconds: number };

/**
 * Takes the user's slot from the limiter and runs the trace. The slot is given back when the events end,
 * fail, are cancelled, or the reader stops early. `release` can also be called by the caller (safe to repeat)
 * in case the events were never read.
 */
export function startTraceRun(limiter: TraceLimiter, input: RunTraceInput): StartTraceRunResult {
  const slot = limiter.tryStart(input.userId);
  if (!slot.ok) return slot;
  const release = slot.release;
  async function* guarded(): AsyncGenerator<TraceEvent> {
    try {
      yield* runTraceForUser(input);
    } finally {
      release();
    }
  }
  return { ok: true, events: guarded(), release };
}
