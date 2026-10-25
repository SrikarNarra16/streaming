// A TraceProvider that replays given reasoning and answer text in small word chunks, with optional
// failure modes. For tests and local development: no network. It stops as soon as the signal aborts.
import { traceError, type TraceErrorCode, type TraceEvent, type TraceUsage } from "./events";
import type { TraceProvider, TraceRequest } from "./provider";

export type MockFailure =
  /** Stops emitting after `afterChunks` chunks (reasoning chunks first, then answer chunks) and never ends. */
  | { mode: "stall"; afterChunks: number }
  /** Emits `afterChunks` reasoning chunks, then an error event, then ends. */
  | { mode: "error-mid-reasoning"; afterChunks: number; code?: TraceErrorCode }
  /** Delivers the whole reasoning and answer and the done event, then an error event arrives. */
  | { mode: "error-after-answer"; code?: TraceErrorCode }
  /** Reasoning ends and done arrives with no answer at all. */
  | { mode: "no-answer" };

export interface MockProviderConfig {
  reasoning: string;
  answer: string;
  /** Words per chunk (default 3). */
  chunkWords?: number;
  /** Delay before every event in milliseconds (default 0 = no sleep call). */
  delayMs?: number;
  /** Injectable sleep so tests can use fake timers. The default is an abortable setTimeout. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  failure?: MockFailure;
  model?: string;
  servedModel?: string;
  finishReason?: string;
  usage?: TraceUsage;
}

/** Splits text into chunks of `chunkWords` words; joining the chunks gives back the exact text. */
export function chunkText(text: string, chunkWords: number): string[] {
  if (text === "") return [];
  const words = text.match(/\s*\S+/g) ?? [];
  if (words.length === 0) return [text]; // whitespace only
  const tail = text.slice(words.join("").length);
  const size = Math.max(1, Math.floor(chunkWords));
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += size) chunks.push(words.slice(i, i + size).join(""));
  chunks[chunks.length - 1] += tail;
  return chunks;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export function createMockProvider(config: MockProviderConfig): TraceProvider {
  const chunkWords = config.chunkWords ?? 3;
  const delayMs = config.delayMs ?? 0;
  const sleep = config.sleep ?? defaultSleep;
  const model = config.model ?? "mock-model";

  return {
    async *stream({ signal }: TraceRequest): AsyncGenerator<TraceEvent> {
      const failure = config.failure;
      const reasoning = chunkText(config.reasoning, chunkWords);
      const answer = failure?.mode === "no-answer" ? [] : chunkText(config.answer, chunkWords);

      // Every event goes through here: wait, then stop at once if the signal aborted meanwhile.
      const pause = async (): Promise<boolean> => {
        if (signal.aborted) return false;
        if (delayMs > 0) await sleep(delayMs, signal);
        return !signal.aborted;
      };

      let emitted = 0;
      const stallAfter = failure?.mode === "stall" ? failure.afterChunks : Infinity;
      const stall = async () => {
        await waitForAbort(signal); // never ends on its own; ends quietly when aborted
      };

      for (const text of reasoning) {
        if (emitted >= stallAfter) return void (await stall());
        if (failure?.mode === "error-mid-reasoning" && emitted >= failure.afterChunks) {
          if (!(await pause())) return;
          yield traceError(failure.code ?? "upstream");
          return;
        }
        if (!(await pause())) return;
        yield { type: "reasoning_delta", text };
        emitted++;
      }
      if (failure?.mode === "error-mid-reasoning" && emitted >= failure.afterChunks) {
        // fewer reasoning chunks than requested: still fail before the answer
        if (!(await pause())) return;
        yield traceError(failure.code ?? "upstream");
        return;
      }

      for (const text of answer) {
        if (emitted >= stallAfter) return void (await stall());
        if (!(await pause())) return;
        yield { type: "answer_delta", text };
        emitted++;
      }
      if (emitted >= stallAfter) return void (await stall());

      if (!(await pause())) return;
      yield {
        type: "done",
        model,
        ...(config.servedModel !== undefined ? { servedModel: config.servedModel } : {}),
        finishReason: config.finishReason ?? "stop",
        ...(config.usage !== undefined ? { usage: config.usage } : {}),
      };

      if (failure?.mode === "error-after-answer") {
        if (!(await pause())) return;
        yield traceError(failure.code ?? "upstream");
      }
    },
  };
}
