// NDJSON encoding and decoding of trace events. Decoding never throws on bad input.
import { isTraceEvent, sanitizeEvent, traceError, type TraceEvent } from "./events";

/** One line of JSON with a trailing newline. Error messages are replaced by the generic ones. */
export function encodeEvent(event: TraceEvent): string {
  return JSON.stringify(sanitizeEvent(event)) + "\n";
}

export interface DecodeStats {
  /** Events decoded and yielded. */
  events: number;
  /** Empty or whitespace-only lines (skipped). */
  blankLines: number;
  /** Lines that are not valid JSON, or longer than maxLineChars (skipped). */
  malformedLines: number;
  /** Valid JSON that is not a known trace event (skipped). */
  unknownLines: number;
}

export function createDecodeStats(): DecodeStats {
  return { events: 0, blankLines: 0, malformedLines: 0, unknownLines: 0 };
}

export interface DecodeOptions {
  /** Filled in while decoding; also returned when the generator finishes. */
  stats?: DecodeStats;
  /** A line longer than this is dropped and counted as malformed (default 1,000,000 characters). */
  maxLineChars?: number;
}

function parseLine(line: string, stats: DecodeStats): TraceEvent | null {
  const trimmed = line.trim();
  if (trimmed === "") {
    stats.blankLines++;
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    stats.malformedLines++;
    return null;
  }
  if (!isTraceEvent(value)) {
    stats.unknownLines++;
    return null;
  }
  stats.events++;
  return sanitizeEvent(value);
}

/**
 * Turns a stream of text or byte chunks into trace events. Handles lines split across chunks,
 * multi-byte characters split across byte chunks, CRLF, blank lines, and a last line without a
 * newline. Malformed and unknown lines are skipped and counted in `stats`. If the source stream
 * itself throws, the generator yields one generic "upstream" error event and ends; it never throws.
 */
export async function* decodeEvents(
  stream: AsyncIterable<string | Uint8Array>,
  options: DecodeOptions = {}
): AsyncGenerator<TraceEvent, DecodeStats, undefined> {
  const stats = options.stats ?? createDecodeStats();
  const maxLineChars = options.maxLineChars ?? 1_000_000;
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let discarding = false; // inside a line that was too long: skip up to the next newline

  function* drain(): Generator<TraceEvent> {
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (discarding) {
        discarding = false;
        continue;
      }
      const event = parseLine(line, stats);
      if (event) yield event;
    }
    if (buffer.length > maxLineChars) {
      if (!discarding) stats.malformedLines++;
      discarding = true;
      buffer = "";
    }
  }

  try {
    for await (const chunk of stream) {
      buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      yield* drain();
    }
    buffer += decoder.decode(); // flush a character that was cut off at the very end
    yield* drain();
    if (buffer !== "" && !discarding) {
      const event = parseLine(buffer, stats);
      if (event) yield event;
    }
  } catch {
    yield traceError("upstream");
  }
  return stats;
}
