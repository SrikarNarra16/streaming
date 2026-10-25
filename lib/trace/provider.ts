// A source of trace events (the real DeepSeek provider and the mock both implement this).
import type { TraceEvent } from "./events";

export interface TraceRequest {
  prompt: string;
  /** Aborting it must make the provider stop producing events and release its connection. */
  signal: AbortSignal;
}

export interface TraceProvider {
  stream(req: TraceRequest): AsyncIterable<TraceEvent>;
}
