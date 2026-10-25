// Builds the real DeepSeek client (the openai SDK pointed at DeepSeek) and reads the trace settings.
// The key is read only when createDeepSeekClientFromEnv() is called, and it is never logged or put in an error.
import OpenAI from "openai";
import { TRACE_EFFORTS, type DeepSeekClient, type TraceEffort } from "./deepseek-provider";

export const DEFAULT_TRACE_MODEL = "deepseek-flash";
/** Reasoning tokens count inside max_tokens, so the default is generous. */
export const DEFAULT_TRACE_MAX_TOKENS = 8000;

const MIN_TRACE_MAX_TOKENS = 256;
const MAX_TRACE_MAX_TOKENS = 100_000;

type Env = Record<string, string | undefined>;

export function createDeepSeekClientFromEnv(env: Env = process.env): DeepSeekClient {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("The AI service is not configured.");
  }
  // No automatic retries: a failed trace is reported and handled by the consumer, never silently repeated.
  // The cast is needed because the SDK's types do not know the DeepSeek extras (thinking, reasoning_content).
  return new OpenAI({ baseURL: "https://api.deepseek.com", apiKey, maxRetries: 0 }) as unknown as DeepSeekClient;
}

/**
 * DEEPSEEK_TRACE_MODEL and DEEPSEEK_TRACE_MAX_TOKENS, each with a fallback to its default if missing or invalid,
 * and DEEPSEEK_TRACE_EFFORT (low, high or max; unset by default, anything else is ignored).
 */
export function readTraceSettingsFromEnv(env: Env = process.env): { model: string; maxTokens: number; effort?: TraceEffort } {
  const rawModel = env.DEEPSEEK_TRACE_MODEL?.trim();
  const model = rawModel && /^[A-Za-z0-9._-]{1,64}$/.test(rawModel) ? rawModel : DEFAULT_TRACE_MODEL;

  const rawTokens = env.DEEPSEEK_TRACE_MAX_TOKENS?.trim();
  let maxTokens = DEFAULT_TRACE_MAX_TOKENS;
  if (rawTokens && /^\d{1,7}$/.test(rawTokens)) {
    const parsed = Number(rawTokens);
    if (parsed >= MIN_TRACE_MAX_TOKENS && parsed <= MAX_TRACE_MAX_TOKENS) maxTokens = parsed;
  }
  const rawEffort = env.DEEPSEEK_TRACE_EFFORT?.trim();
  const effort = TRACE_EFFORTS.find((e) => e === rawEffort);
  return effort ? { model, maxTokens, effort } : { model, maxTokens };
}
