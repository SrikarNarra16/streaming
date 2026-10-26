// Browser-side access to POST /api/trace. Pure apart from the fetch it is given, so it is testable with fake
// Response objects. It never shows server response text to the user: error answers are not read at all, and
// every error carries one of the fixed sentences below.
import type { TraceSource } from "./events";
import { decodeEvents } from "./ndjson";

export type TraceClientErrorCode =
  | "auth"
  | "busy"
  | "not_found"
  | "not_configured"
  | "upstream"
  | "timeout"
  | "cancelled"
  | "unknown";

export const TRACE_CLIENT_MESSAGES: Record<TraceClientErrorCode, string> = {
  auth: "Please sign in again to continue.",
  busy: "A trace is already running, or there have been too many requests. Please wait a moment and try again.",
  not_found: "That question could not be found.",
  not_configured: "The thinking trace is not available right now.",
  upstream: "The trace could not be created. Please try again.",
  timeout: "The trace took too long. Please try again.",
  cancelled: "The request was cancelled.",
  unknown: "Something went wrong. Please try again.",
};

export class TraceClientError extends Error {
  readonly code: TraceClientErrorCode;
  /** Only for "busy": the seconds the server asked to wait (Retry-After), when it sent a valid value. */
  readonly retryAfterSeconds?: number;

  constructor(code: TraceClientErrorCode, retryAfterSeconds?: number) {
    super(TRACE_CLIENT_MESSAGES[code]);
    this.name = "TraceClientError";
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The plain shape kept in state and shown to the user. */
export interface TraceErrorInfo {
  code: TraceClientErrorCode;
  message: string;
  retryAfterSeconds?: number;
}

export function toTraceErrorInfo(error: unknown): TraceErrorInfo {
  const e = error instanceof TraceClientError ? error : new TraceClientError("unknown");
  return { code: e.code, message: e.message, ...(e.retryAfterSeconds !== undefined ? { retryAfterSeconds: e.retryAfterSeconds } : {}) };
}

export interface TraceResult {
  source: TraceSource;
  paragraphs: string[];
  words: number;
  model: string;
}

export interface FetchTraceOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function statusToError(response: Response): TraceClientError {
  switch (response.status) {
    case 401:
      return new TraceClientError("auth");
    case 404:
      return new TraceClientError("not_found");
    case 503:
      return new TraceClientError("not_configured");
    case 429: {
      const header = response.headers.get("Retry-After");
      const seconds = header !== null && /^\d{1,6}$/.test(header.trim()) ? Number(header.trim()) : undefined;
      return new TraceClientError("busy", seconds);
    }
    default:
      return new TraceClientError(response.status >= 500 ? "upstream" : "unknown");
  }
}

const EVENT_ERROR_CODES = {
  timeout: "timeout",
  cancelled: "cancelled",
  upstream: "upstream",
  limit: "busy",
} as const;

/**
 * Asks the server for the trace of one question and resolves with the finished trace.
 * Rejects with a TraceClientError. The reader is released (cancelled) when the signal aborts, when an error
 * event arrives, and as soon as trace_ready has been read.
 */
export async function fetchTrace(questionId: number, options: FetchTraceOptions = {}): Promise<TraceResult> {
  const { signal } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (signal?.aborted) throw new TraceClientError("cancelled");

  let response: Response;
  try {
    response = await fetchImpl("/api/trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId }),
      signal,
    });
  } catch {
    throw new TraceClientError(signal?.aborted ? "cancelled" : "unknown"); // a network failure: nothing from it is shown
  }

  if (!response.ok) {
    void response.body?.cancel().catch(() => {}); // the body is never read, only given back
    throw statusToError(response);
  }
  if (!response.body) throw new TraceClientError("upstream");

  const reader = response.body.getReader();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    void reader.cancel().catch(() => {}); // also ends a read that is still waiting
  };
  const onAbort = () => release();
  signal?.addEventListener("abort", onAbort, { once: true });

  async function* chunks(): AsyncGenerator<Uint8Array> {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  }

  try {
    for await (const event of decodeEvents(chunks())) {
      if (event.type === "trace_ready") {
        return { source: event.source, paragraphs: event.paragraphs, words: event.words, model: event.model };
      }
      if (event.type === "error") throw new TraceClientError(EVENT_ERROR_CODES[event.code]);
      // reasoning/answer deltas and done carry nothing the browser needs
    }
    // the stream ended without trace_ready
    throw new TraceClientError(signal?.aborted ? "cancelled" : "upstream");
  } catch (error) {
    if (signal?.aborted) throw new TraceClientError("cancelled");
    throw error instanceof TraceClientError ? error : new TraceClientError("unknown");
  } finally {
    signal?.removeEventListener("abort", onAbort);
    release();
  }
}
