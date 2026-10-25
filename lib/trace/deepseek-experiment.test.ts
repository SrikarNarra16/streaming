import { describe, expect, it } from "vitest";
import { consumeFromProvider } from "./consume";
import { readTraceSettingsFromEnv } from "./deepseek-client";
import {
  createDeepSeekProvider,
  TRACE_EFFORTS,
  type DeepSeekChunk,
  type DeepSeekClient,
  type DeepSeekProviderConfig,
  type DeepSeekRequestParams,
} from "./deepseek-provider";

const finish: DeepSeekChunk = { model: "served", choices: [{ delta: {}, finish_reason: "stop" }] };
const usage: DeepSeekChunk = { model: "served", choices: [], usage: { total_tokens: 9 } };

// Records the request and replays the given chunks.
function fakeClient(...chunks: DeepSeekChunk[]) {
  const seen: { params?: DeepSeekRequestParams } = {};
  const client: DeepSeekClient = {
    chat: {
      completions: {
        async create(params) {
          seen.params = params;
          return (async function* () {
            for (const chunk of chunks) yield chunk;
          })();
        },
      },
    },
  };
  return { client, seen };
}

async function requestFor(options: Partial<Omit<DeepSeekProviderConfig, "client">>) {
  const { client, seen } = fakeClient(finish, usage);
  const provider = createDeepSeekProvider({ client, model: "deepseek-flash", maxTokens: 8000, ...options });
  for await (const event of provider.stream({ prompt: "q", signal: new AbortController().signal })) void event;
  return seen.params!;
}

const BASE = {
  model: "deepseek-flash",
  messages: [{ role: "user", content: "q" }],
  max_tokens: 8000,
  stream: true,
  stream_options: { include_usage: true },
};

describe("reasoning effort", () => {
  it("sends no reasoning_effort at all when no effort is set, and thinking stays enabled (the unchanged default)", async () => {
    const params = await requestFor({});
    expect(params).toEqual({ ...BASE, thinking: { type: "enabled" } });
    expect("reasoning_effort" in params).toBe(false);
  });

  it("sends reasoning_effort as a top-level parameter for low, high and max", async () => {
    for (const effort of TRACE_EFFORTS) {
      const params = await requestFor({ effort });
      expect(params).toEqual({ ...BASE, thinking: { type: "enabled" }, reasoning_effort: effort });
    }
    expect([...TRACE_EFFORTS]).toEqual(["low", "high", "max"]);
  });
});

describe("thinking disabled", () => {
  it("sends thinking: { type: 'disabled' } and no reasoning_effort", async () => {
    const params = await requestFor({ thinking: "disabled" });
    expect(params).toEqual({ ...BASE, thinking: { type: "disabled" } });
  });

  it("sends exactly what is configured when both options are set", async () => {
    expect(await requestFor({ thinking: "disabled", effort: "low" })).toEqual({
      ...BASE,
      thinking: { type: "disabled" },
      reasoning_effort: "low",
    });
  });

  it("an explicit 'enabled' is the same as the default", async () => {
    expect(await requestFor({ thinking: "enabled" })).toEqual(await requestFor({}));
  });

  it("produces only answer events, and the consumer ends with an empty reasoning", async () => {
    const answerOnly = (text: string): DeepSeekChunk => ({ model: "served", choices: [{ delta: { content: text } }] });
    const { client } = fakeClient(answerOnly("First, "), answerOnly("we think."), finish, usage);
    const provider = createDeepSeekProvider({ client, model: "deepseek-flash", maxTokens: 8000, thinking: "disabled" });
    const events = [];
    for await (const event of provider.stream({ prompt: "q", signal: new AbortController().signal })) events.push(event);
    expect(events.map((e) => e.type)).toEqual(["answer_delta", "answer_delta", "done"]);

    const { client: client2 } = fakeClient(answerOnly("First, "), answerOnly("we think."), finish, usage);
    const res = await consumeFromProvider(createDeepSeekProvider({ client: client2, model: "deepseek-flash", maxTokens: 8000, thinking: "disabled" }), "q");
    expect(res).toMatchObject({ status: "complete", reasoning: "", answer: "First, we think." });
  });
});

describe("DEEPSEEK_TRACE_EFFORT", () => {
  it("is unset by default", () => {
    const settings = readTraceSettingsFromEnv({});
    expect(settings).toEqual({ model: "deepseek-flash", maxTokens: 8000 });
    expect("effort" in settings).toBe(false);
  });

  it("accepts low, high and max, trimming spaces", () => {
    expect(readTraceSettingsFromEnv({ DEEPSEEK_TRACE_EFFORT: "low" }).effort).toBe("low");
    expect(readTraceSettingsFromEnv({ DEEPSEEK_TRACE_EFFORT: " high " }).effort).toBe("high");
    expect(readTraceSettingsFromEnv({ DEEPSEEK_TRACE_EFFORT: "max" }).effort).toBe("max");
  });

  it("ignores anything else, as if it were unset", () => {
    for (const value of ["", "  ", "medium", "xhigh", "none", "minimal", "HIGH", "Low", "high;max", "1", "true"]) {
      const settings = readTraceSettingsFromEnv({ DEEPSEEK_TRACE_EFFORT: value });
      expect("effort" in settings).toBe(false);
    }
  });

  it("does not disturb the other two settings", () => {
    expect(readTraceSettingsFromEnv({ DEEPSEEK_TRACE_EFFORT: "max", DEEPSEEK_TRACE_MODEL: "deepseek-v4-pro", DEEPSEEK_TRACE_MAX_TOKENS: "4000" })).toEqual({
      model: "deepseek-v4-pro",
      maxTokens: 4000,
      effort: "max",
    });
  });
});
