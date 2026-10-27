// Settings for the live trace, read from environment variables. Pure: the environment is passed in, and
// every value falls back to its default when it is missing or not sensible. Never throws.
import { TRACE_SETTINGS, type TraceSetting } from "./policy";
import type { TraceRunLimits } from "./run";

export const TRACE_PROVIDERS = ["deepseek", "mock"] as const;
export type TraceProviderName = (typeof TRACE_PROVIDERS)[number];

export interface TraceRunConfig {
  setting: TraceSetting;
  provider: TraceProviderName;
  limits: TraceRunLimits;
  /** Traces per user per rolling hour. */
  maxPerHour: number;
  /** Show every learner the newest saved trace of a question instead of generating a new one. Off by default. */
  reuse: boolean;
}

export const TRACE_DEFAULTS = {
  setting: "auto",
  provider: "deepseek",
  minWords: 150,
  maxWords: 500,
  maxPerHour: 20,
  reuse: false,
  firstEventTimeoutMs: 30_000,
  idleTimeoutMs: 30_000,
  maxTotalMs: 180_000,
} as const;

type Env = Record<string, string | undefined>;

function whole(raw: string | undefined, min: number, max: number): number | undefined {
  const text = raw?.trim();
  if (!text || !/^\d{1,9}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= min && n <= max ? n : undefined;
}

export function readTraceRunConfig(env: Env = process.env): TraceRunConfig {
  const rawSetting = env.TRACE_SOURCE?.trim();
  const setting = TRACE_SETTINGS.find((s) => s === rawSetting) ?? TRACE_DEFAULTS.setting;
  const rawProvider = env.TRACE_PROVIDER?.trim();
  const provider = TRACE_PROVIDERS.find((p) => p === rawProvider) ?? TRACE_DEFAULTS.provider;

  // The word range only makes sense as a pair: if either is invalid or min > max, both fall back.
  let minWords = whole(env.TRACE_MIN_WORDS, 1, 100_000) ?? TRACE_DEFAULTS.minWords;
  let maxWords = whole(env.TRACE_MAX_WORDS, 1, 100_000) ?? TRACE_DEFAULTS.maxWords;
  if (minWords > maxWords) {
    minWords = TRACE_DEFAULTS.minWords;
    maxWords = TRACE_DEFAULTS.maxWords;
  }

  return {
    setting,
    provider,
    maxPerHour: whole(env.TRACE_MAX_PER_HOUR, 1, 10_000) ?? TRACE_DEFAULTS.maxPerHour,
    reuse: env.TRACE_REUSE?.trim() === "true", // only the exact value "true" turns it on
    limits: {
      minWords,
      maxWords,
      firstEventTimeoutMs: whole(env.TRACE_FIRST_EVENT_TIMEOUT_MS, 1_000, 600_000) ?? TRACE_DEFAULTS.firstEventTimeoutMs,
      idleTimeoutMs: whole(env.TRACE_IDLE_TIMEOUT_MS, 1_000, 600_000) ?? TRACE_DEFAULTS.idleTimeoutMs,
      maxTotalMs: whole(env.TRACE_TOTAL_TIMEOUT_MS, 1_000, 3_600_000) ?? TRACE_DEFAULTS.maxTotalMs,
    },
  };
}
