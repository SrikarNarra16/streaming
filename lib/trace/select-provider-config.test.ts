// Checks what select-provider asks createDeepSeekProvider for, with the real provider replaced by a recorder.
import { describe, expect, it, vi } from "vitest";
import { createDeepSeekProvider } from "./deepseek-provider";
import { selectTraceProviders } from "./select-provider";

vi.mock("./deepseek-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deepseek-provider")>();
  return { ...actual, createDeepSeekProvider: vi.fn(() => ({ stream: () => (async function* () {})() })) };
});

describe("the DeepSeek providers that are built", () => {
  it("the reasoning provider keeps the default behaviour: no effort and no thinking override, even if an effort is set", () => {
    vi.mocked(createDeepSeekProvider).mockClear();
    selectTraceProviders({ DEEPSEEK_API_KEY: "sk-test-fake-key-123", DEEPSEEK_TRACE_EFFORT: "max", DEEPSEEK_TRACE_MODEL: "deepseek-flash", DEEPSEEK_TRACE_MAX_TOKENS: "6000" });
    const calls = vi.mocked(createDeepSeekProvider).mock.calls;
    expect(calls).toHaveLength(2);

    const reasoningConfig = calls[0][0];
    expect(Object.keys(reasoningConfig).sort()).toEqual(["client", "maxTokens", "model"]);
    expect(reasoningConfig).toMatchObject({ model: "deepseek-flash", maxTokens: 6000 });
    expect("effort" in reasoningConfig).toBe(false);
    expect("thinking" in reasoningConfig).toBe(false);
  });

  it("the steps provider has thinking disabled and no effort", () => {
    vi.mocked(createDeepSeekProvider).mockClear();
    selectTraceProviders({ DEEPSEEK_API_KEY: "sk-test-fake-key-123", DEEPSEEK_TRACE_EFFORT: "high" });
    const stepsConfig = vi.mocked(createDeepSeekProvider).mock.calls[1][0];
    expect(stepsConfig).toMatchObject({ model: "deepseek-flash", maxTokens: 8000, thinking: "disabled" });
    expect("effort" in stepsConfig).toBe(false);
  });

  it("both providers share one client", () => {
    vi.mocked(createDeepSeekProvider).mockClear();
    selectTraceProviders({ DEEPSEEK_API_KEY: "sk-test-fake-key-123" });
    const [reasoning, steps] = vi.mocked(createDeepSeekProvider).mock.calls;
    expect(reasoning[0].client).toBe(steps[0].client);
  });
});
