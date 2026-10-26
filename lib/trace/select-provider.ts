// Chooses where the reasoning and the step-by-step text come from: TRACE_PROVIDER "deepseek" (default) or "mock".
import { createDeepSeekClientFromEnv, readTraceSettingsFromEnv } from "./deepseek-client";
import { createDeepSeekProvider } from "./deepseek-provider";
import { readTraceRunConfig } from "./config";
import { createMockProvider } from "./mock-provider";
import type { TraceProvider } from "./provider";
import { SAMPLE_REASONING, SAMPLE_REASONING_ANSWER, SAMPLE_STEPS } from "./sample-trace";

export interface TraceProviders {
  reasoning: TraceProvider;
  steps: TraceProvider;
  /** The model that is being asked. */
  model: string;
}

export type SelectProvidersResult = { ok: true; providers: TraceProviders } | { ok: false; reason: "not_configured" };

type Env = Record<string, string | undefined>;

export function selectTraceProviders(env: Env = process.env): SelectProvidersResult {
  const { provider } = readTraceRunConfig(env);

  if (provider === "mock") {
    const common = { chunkWords: 4, delayMs: 10, model: "mock-model" };
    return {
      ok: true,
      providers: {
        model: "mock-model",
        reasoning: createMockProvider({ ...common, reasoning: SAMPLE_REASONING, answer: SAMPLE_REASONING_ANSWER }),
        steps: createMockProvider({ ...common, reasoning: "", answer: SAMPLE_STEPS }),
      },
    };
  }

  let client;
  try {
    client = createDeepSeekClientFromEnv(env);
  } catch {
    return { ok: false, reason: "not_configured" }; // the route answers with a generic 503
  }
  const { model, maxTokens } = readTraceSettingsFromEnv(env);
  // Deliberately no `effort`: the reasoning call keeps DeepSeek's default behaviour (DEEPSEEK_TRACE_EFFORT is not used here).
  return {
    ok: true,
    providers: {
      model,
      reasoning: createDeepSeekProvider({ client, model, maxTokens }),
      steps: createDeepSeekProvider({ client, model, maxTokens, thinking: "disabled" }),
    },
  };
}
