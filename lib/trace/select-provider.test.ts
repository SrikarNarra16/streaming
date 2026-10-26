import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeFromProvider } from "./consume";
import { SAMPLE_REASONING, SAMPLE_STEPS } from "./sample-trace";
import { selectTraceProviders } from "./select-provider";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TRACE_PROVIDER "mock"', () => {
  it("gives mock providers that replay the invented samples", async () => {
    const selected = selectTraceProviders({ TRACE_PROVIDER: "mock" });
    if (!selected.ok) throw new Error("expected providers");
    expect(selected.providers.model).toBe("mock-model");

    const reasoning = consumeFromProvider(selected.providers.reasoning, "q");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await reasoning).toMatchObject({ status: "complete", reasoning: SAMPLE_REASONING });

    const steps = consumeFromProvider(selected.providers.steps, "q");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await steps).toMatchObject({ status: "complete", reasoning: "", answer: SAMPLE_STEPS });
  });

  it("needs no key", () => {
    expect(selectTraceProviders({ TRACE_PROVIDER: "mock" }).ok).toBe(true);
    expect(selectTraceProviders({ TRACE_PROVIDER: "mock", DEEPSEEK_API_KEY: "" }).ok).toBe(true);
  });
});

describe('TRACE_PROVIDER "deepseek" (the default)', () => {
  it("is not configured without a key: the route turns this into a generic 503", () => {
    expect(selectTraceProviders({})).toEqual({ ok: false, reason: "not_configured" });
    expect(selectTraceProviders({ DEEPSEEK_API_KEY: "" })).toEqual({ ok: false, reason: "not_configured" });
    expect(selectTraceProviders({ DEEPSEEK_API_KEY: "   " })).toEqual({ ok: false, reason: "not_configured" });
    expect(selectTraceProviders({ TRACE_PROVIDER: "deepseek" })).toEqual({ ok: false, reason: "not_configured" });
  });

  it("returns two providers and the model once a key is present (no request is made)", () => {
    const selected = selectTraceProviders({ DEEPSEEK_API_KEY: "sk-test-fake-key-123", DEEPSEEK_TRACE_MODEL: "deepseek-v4-pro" });
    if (!selected.ok) throw new Error("expected providers");
    expect(selected.providers.model).toBe("deepseek-v4-pro");
    expect(typeof selected.providers.reasoning.stream).toBe("function");
    expect(typeof selected.providers.steps.stream).toBe("function");
    expect(selected.providers.reasoning).not.toBe(selected.providers.steps);
  });

  it("falls back to deepseek for an unknown provider name", () => {
    expect(selectTraceProviders({ TRACE_PROVIDER: "other" })).toEqual({ ok: false, reason: "not_configured" });
  });

  it("does not put the key in the result", () => {
    const selected = selectTraceProviders({ DEEPSEEK_API_KEY: "sk-test-fake-key-123" });
    expect(JSON.stringify(selected)).not.toContain("sk-test-fake-key-123");
  });
});
