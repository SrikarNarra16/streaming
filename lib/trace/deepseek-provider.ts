// TraceProvider for DeepSeek's streaming chat API. The caller creates and passes in the client, so this
// file never reads environment variables or keys; see deepseek-client.ts for the real client.
//
// Request: one user message (the prompt), no system prompt, stream: true, stream_options.include_usage,
// thinking enabled (or disabled if configured), and reasoning_effort only if an effort is configured.
// max_tokens includes the hidden reasoning tokens, so a trace that hits the limit ends
// with finish_reason "length": the `done` event then carries finishReason "length" so the consumer can
// tell that the output was cut off by the token limit and not finished.
//
// Mapping: delta.reasoning_content -> reasoning_delta, delta.content -> answer_delta (empty strings are
// skipped). When finish_reason arrives the provider waits up to USAGE_WAIT_MS for the usage chunk and then
// emits `done`. If the stream ends with no finish_reason, no `done` is emitted.
//
// Errors: every failure becomes a generic error event ("cancelled" if the signal aborted, otherwise
// "upstream"). Only the error's name and HTTP status are logged, with a fixed prefix; the message, status
// text and headers are never copied anywhere. A failure after finish_reason (the answer is complete, only
// the usage is missing) emits `done` first and then the error, so the consumer keeps the answer.
import { traceError, type TraceEvent, type TraceUsage } from "./events";
import type { TraceProvider, TraceRequest } from "./provider";

/** How long to wait for the usage chunk after finish_reason. */
export const USAGE_WAIT_MS = 2000;

export interface DeepSeekChunk {
  model?: string;
  choices?: Array<{
    delta?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  } | null;
}

/** DeepSeek's reasoning effort. Left unset, the API's own default applies. */
export const TRACE_EFFORTS = ["low", "high", "max"] as const;
export type TraceEffort = (typeof TRACE_EFFORTS)[number];

export interface DeepSeekRequestParams {
  model: string;
  messages: Array<{ role: "user"; content: string }>;
  max_tokens: number;
  stream: true;
  stream_options: { include_usage: true };
  thinking: { type: "enabled" | "disabled" };
  /** Only present when an effort was configured. */
  reasoning_effort?: TraceEffort;
}

/** The part of the openai SDK client that the provider uses. */
export interface DeepSeekClient {
  chat: {
    completions: {
      create(params: DeepSeekRequestParams, options: { signal: AbortSignal }): PromiseLike<AsyncIterable<DeepSeekChunk>>;
    };
  };
}

export interface DeepSeekProviderConfig {
  client: DeepSeekClient;
  model: string;
  maxTokens: number;
  /** Sent as the top-level `reasoning_effort` request parameter. Unset: nothing is sent. */
  effort?: TraceEffort;
  /** Default "enabled". "disabled" sends thinking: { type: "disabled" }: no reasoning deltas, only answer deltas. */
  thinking?: "enabled" | "disabled";
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function mapUsage(raw: NonNullable<DeepSeekChunk["usage"]>): TraceUsage {
  const usage: TraceUsage = {};
  if (isNumber(raw.prompt_tokens)) usage.promptTokens = raw.prompt_tokens;
  if (isNumber(raw.completion_tokens)) usage.completionTokens = raw.completion_tokens;
  if (isNumber(raw.total_tokens)) usage.totalTokens = raw.total_tokens;
  const reasoning = raw.completion_tokens_details?.reasoning_tokens;
  if (isNumber(reasoning)) usage.reasoningTokens = reasoning;
  return usage;
}

// Logs only the error name and HTTP status, never the message.
function logFailure(error: unknown): void {
  const rawName = error instanceof Error ? error.name : typeof error;
  const name = /^[A-Za-z0-9_]{1,60}$/.test(rawName) ? rawName : "Error";
  const status = (error as { status?: unknown } | null)?.status;
  console.error("[deepseek-provider] stream failed:", name, isNumber(status) ? status : "no status");
}

type Step =
  | { kind: "created"; response: AsyncIterable<DeepSeekChunk> }
  | { kind: "next"; result: IteratorResult<DeepSeekChunk> }
  | { kind: "error"; error: unknown }
  | { kind: "aborted" }
  | { kind: "usage-timeout" };

export function createDeepSeekProvider(config: DeepSeekProviderConfig): TraceProvider {
  return {
    async *stream({ prompt, signal }: TraceRequest): AsyncGenerator<TraceEvent> {
      if (signal.aborted) {
        yield traceError("cancelled");
        return;
      }

      let iterator: AsyncIterator<DeepSeekChunk> | undefined;
      let released = false;
      let usageTimer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;

      // Gives the underlying stream back (not awaited: a stalled stream only finishes after the abort).
      const release = () => {
        if (released || !iterator) return;
        released = true;
        try {
          Promise.resolve(iterator.return?.()).catch(() => {});
        } catch {
          /* ignore */
        }
      };

      const abortedPromise = new Promise<Step>((resolve) => {
        onAbort = () => resolve({ kind: "aborted" });
        signal.addEventListener("abort", onAbort, { once: true });
      });

      let servedModel: string | undefined;
      let finishReason: string | undefined;
      let usage: TraceUsage | undefined;
      let usageDeadline: Promise<Step> | undefined;

      const doneEvent = (): TraceEvent => ({
        type: "done",
        model: config.model,
        ...(servedModel !== undefined ? { servedModel } : {}),
        ...(finishReason !== undefined ? { finishReason } : {}),
        ...(usage !== undefined ? { usage } : {}),
      });

      try {
        const params: DeepSeekRequestParams = {
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: config.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
          thinking: { type: config.thinking ?? "enabled" },
          ...(config.effort !== undefined ? { reasoning_effort: config.effort } : {}),
        };
        // Opening the stream is raced against the abort too, in case a client ignores the signal.
        const created = Promise.resolve(config.client.chat.completions.create(params, { signal }));
        created.catch(() => {});
        const opened = await Promise.race([
          created.then((response) => ({ kind: "created", response }) as Step),
          abortedPromise,
        ]);
        if (opened.kind === "aborted") {
          // if the stream opens after all, give it straight back
          created.then(
            (response) => {
              try {
                Promise.resolve(response[Symbol.asyncIterator]().return?.()).catch(() => {});
              } catch {
                /* ignore */
              }
            },
            () => {}
          );
          yield traceError("cancelled");
          return;
        }
        if (opened.kind !== "created") throw new Error("unexpected state");
        iterator = opened.response[Symbol.asyncIterator]();

        for (;;) {
          const next = iterator.next();
          next.catch(() => {});
          const racers: Array<Promise<Step>> = [
            next.then(
              (result) => ({ kind: "next", result }) as Step,
              (error: unknown) => ({ kind: "error", error }) as Step
            ),
            abortedPromise,
          ];
          if (usageDeadline) racers.push(usageDeadline);
          const step = await Promise.race(racers);

          if (step.kind === "aborted") {
            yield traceError("cancelled");
            return;
          }
          if (step.kind === "usage-timeout") {
            yield doneEvent();
            return;
          }
          if (step.kind === "error") throw step.error; // only its name and status are ever logged
          if (step.kind !== "next") throw new Error("unexpected state");
          if (step.result.done) {
            released = true; // the stream ended by itself
            if (finishReason !== undefined) yield doneEvent();
            return;
          }

          const chunk = step.result.value;
          if (servedModel === undefined && typeof chunk.model === "string" && chunk.model !== "") servedModel = chunk.model;
          const choice = chunk.choices?.[0];
          const reasoningText = choice?.delta?.reasoning_content;
          if (typeof reasoningText === "string" && reasoningText !== "") yield { type: "reasoning_delta", text: reasoningText };
          const answerText = choice?.delta?.content;
          if (typeof answerText === "string" && answerText !== "") yield { type: "answer_delta", text: answerText };
          if (chunk.usage) usage = mapUsage(chunk.usage);
          if (finishReason === undefined && typeof choice?.finish_reason === "string" && choice.finish_reason !== "") {
            finishReason = choice.finish_reason;
          }

          if (finishReason !== undefined) {
            if (usage !== undefined) {
              yield doneEvent();
              return;
            }
            if (!usageDeadline) {
              usageDeadline = new Promise<Step>((resolve) => {
                usageTimer = setTimeout(() => resolve({ kind: "usage-timeout" }), USAGE_WAIT_MS);
              });
            }
          }
        }
      } catch (error) {
        if (signal.aborted) {
          yield traceError("cancelled");
          return;
        }
        logFailure(error);
        if (finishReason !== undefined) yield doneEvent(); // the answer was complete, only the usage is missing
        yield traceError("upstream");
      } finally {
        clearTimeout(usageTimer);
        if (onAbort) signal.removeEventListener("abort", onAbort);
        release();
      }
    },
  };
}
