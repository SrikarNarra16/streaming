// Which kind of text becomes the trace: the model's reasoning, or the step-by-step fallback.
// Pure. The words are counted by the caller AFTER the cleaner has run.
import type { TraceSource } from "./events";

export const TRACE_SETTINGS = ["reasoning", "steps", "auto"] as const;
export type TraceSetting = (typeof TRACE_SETTINGS)[number];

export type TraceDecisionReason = "setting_reasoning" | "setting_steps" | "in_range" | "too_short" | "too_long";

export interface TraceDecisionInput {
  setting: TraceSetting;
  /** Words in the cleaned reasoning. Ignored for the "steps" setting. */
  reasoningWords: number;
  minWords: number;
  maxWords: number;
}

export function decideTraceSource({ setting, reasoningWords, minWords, maxWords }: TraceDecisionInput): {
  source: TraceSource;
  reason: TraceDecisionReason;
} {
  if (setting === "reasoning") return { source: "reasoning", reason: "setting_reasoning" };
  if (setting === "steps") return { source: "steps", reason: "setting_steps" };
  if (reasoningWords < minWords) return { source: "steps", reason: "too_short" };
  if (reasoningWords > maxWords) return { source: "steps", reason: "too_long" };
  return { source: "reasoning", reason: "in_range" };
}
