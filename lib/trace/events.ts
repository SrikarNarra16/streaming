// Event protocol of the live thinking-trace stream: one JSON object per line (NDJSON).
//
//   { "type": "reasoning_delta", "text": "..." }
//   { "type": "answer_delta",    "text": "..." }
//   { "type": "done",  "model": "...", "servedModel"?: "...", "finishReason"?: "...", "usage"?: {...} }
//   { "type": "error", "code": "timeout" | "upstream" | "cancelled" | "limit", "message": "..." }
//
// Error messages are always one of the fixed generic sentences below. Whatever text an upstream
// service or exception produced is never carried in an event (it can contain keys, URLs with
// credentials or other raw error text); sanitizeEvent() enforces this at every boundary.

export const TRACE_ERROR_CODES = ["timeout", "upstream", "cancelled", "limit"] as const;
export type TraceErrorCode = (typeof TRACE_ERROR_CODES)[number];

export const TRACE_ERROR_MESSAGES: Record<TraceErrorCode, string> = {
  timeout: "The AI service took too long to respond.",
  upstream: "The AI service could not process this request.",
  cancelled: "The request was cancelled.",
  limit: "The request reached a usage limit.",
};

export interface TraceUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
}

export const TRACE_SOURCES = ["reasoning", "steps"] as const;
export type TraceSource = (typeof TRACE_SOURCES)[number];

export type TraceEvent =
  | { type: "reasoning_delta"; text: string }
  | { type: "answer_delta"; text: string }
  | { type: "done"; model: string; servedModel?: string; finishReason?: string; usage?: TraceUsage }
  | { type: "error"; code: TraceErrorCode; message: string }
  // What the server sends to the learner's browser instead of the raw deltas: the finished, cleaned and
  // segmented trace, and which kind of text it came from.
  | { type: "trace_ready"; source: TraceSource; paragraphs: string[]; words: number; model: string };

const isString = (v: unknown): v is string => typeof v === "string";
const isOptionalString = (v: unknown) => v === undefined || isString(v);
const isOptionalNumber = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v));

function isUsage(v: unknown): v is TraceUsage {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const u = v as Record<string, unknown>;
  return (
    isOptionalNumber(u.promptTokens) &&
    isOptionalNumber(u.completionTokens) &&
    isOptionalNumber(u.totalTokens) &&
    isOptionalNumber(u.reasoningTokens)
  );
}

/** Runtime check that a parsed value has the shape of a TraceEvent. Extra properties are allowed. */
export function isTraceEvent(x: unknown): x is TraceEvent {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const e = x as Record<string, unknown>;
  switch (e.type) {
    case "reasoning_delta":
    case "answer_delta":
      return isString(e.text);
    case "done":
      return isString(e.model) && isOptionalString(e.servedModel) && isOptionalString(e.finishReason) && (e.usage === undefined || isUsage(e.usage));
    case "error":
      return (TRACE_ERROR_CODES as readonly unknown[]).includes(e.code) && isString(e.message);
    case "trace_ready":
      return (
        (TRACE_SOURCES as readonly unknown[]).includes(e.source) &&
        Array.isArray(e.paragraphs) &&
        e.paragraphs.every(isString) &&
        typeof e.words === "number" &&
        Number.isInteger(e.words) &&
        e.words >= 0 &&
        isString(e.model)
      );
    default:
      return false;
  }
}

/** An error event with the fixed generic message for its code. */
export function traceError(code: TraceErrorCode): TraceEvent {
  return { type: "error", code, message: TRACE_ERROR_MESSAGES[code] };
}

/** Replaces the message of an error event by the generic one for its code; other events pass through. */
export function sanitizeEvent(event: TraceEvent): TraceEvent {
  return event.type === "error" ? traceError(event.code) : event;
}
