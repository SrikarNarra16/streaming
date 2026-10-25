import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDeepSeekClientFromEnv,
  DEFAULT_TRACE_MAX_TOKENS,
  DEFAULT_TRACE_MODEL,
  readTraceSettingsFromEnv,
} from "./deepseek-client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Every test passes its own env object, so none of them depends on or reads the real environment.

describe("createDeepSeekClientFromEnv", () => {
  it("throws a generic error when the key is missing, empty or blank", () => {
    for (const env of [{}, { DEEPSEEK_API_KEY: "" }, { DEEPSEEK_API_KEY: "   " }]) {
      expect(() => createDeepSeekClientFromEnv(env)).toThrow(new Error("The AI service is not configured."));
    }
  });

  it("builds a client with chat.completions.create when a key is present, without logging anything", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = createDeepSeekClientFromEnv({ DEEPSEEK_API_KEY: "sk-test-fake-key-123" });
    expect(typeof client.chat.completions.create).toBe("function");
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("uses the env object it is given, not the process environment", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-from-process-env-should-be-ignored");
    expect(() => createDeepSeekClientFromEnv({})).toThrow("The AI service is not configured.");
  });

  it("never puts the key in the error", () => {
    try {
      createDeepSeekClientFromEnv({ DEEPSEEK_API_KEY: "" });
    } catch (e) {
      expect(String(e)).not.toMatch(/sk-|DEEPSEEK/);
    }
  });
});

describe("readTraceSettingsFromEnv", () => {
  it("uses the documented defaults", () => {
    expect(readTraceSettingsFromEnv({})).toEqual({ model: "deepseek-flash", maxTokens: 8000 });
    expect(DEFAULT_TRACE_MODEL).toBe("deepseek-flash");
    expect(DEFAULT_TRACE_MAX_TOKENS).toBe(8000);
  });

  it("accepts a valid model and token limit, trimming spaces", () => {
    expect(readTraceSettingsFromEnv({ DEEPSEEK_TRACE_MODEL: " deepseek-v4-pro ", DEEPSEEK_TRACE_MAX_TOKENS: " 4000 " })).toEqual({
      model: "deepseek-v4-pro",
      maxTokens: 4000,
    });
  });

  it("falls back to the default model for an empty or odd value", () => {
    for (const value of ["", "   ", "has space", "a/b", "x".repeat(65), "model;drop"]) {
      expect(readTraceSettingsFromEnv({ DEEPSEEK_TRACE_MODEL: value }).model).toBe("deepseek-flash");
    }
  });

  it("falls back to 8000 for a token limit that is not a sensible whole number", () => {
    for (const value of ["abc", "-5", "12.5", "0", "100", "255", "100001", "99999999", "1e5", "0x1000", ""]) {
      expect(readTraceSettingsFromEnv({ DEEPSEEK_TRACE_MAX_TOKENS: value }).maxTokens).toBe(8000);
    }
  });

  it("accepts the limits themselves", () => {
    expect(readTraceSettingsFromEnv({ DEEPSEEK_TRACE_MAX_TOKENS: "256" }).maxTokens).toBe(256);
    expect(readTraceSettingsFromEnv({ DEEPSEEK_TRACE_MAX_TOKENS: "100000" }).maxTokens).toBe(100000);
  });
});
