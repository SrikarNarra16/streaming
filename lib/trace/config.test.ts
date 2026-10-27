import { describe, expect, it } from "vitest";
import { readTraceRunConfig, TRACE_DEFAULTS } from "./config";

describe("readTraceRunConfig", () => {
  it("uses the documented defaults when nothing is set", () => {
    expect(readTraceRunConfig({})).toEqual({
      setting: "auto",
      provider: "deepseek",
      maxPerHour: 20,
      reuse: false,
      limits: { minWords: 150, maxWords: 500, firstEventTimeoutMs: 30000, idleTimeoutMs: 30000, maxTotalMs: 180000 },
    });
    expect(TRACE_DEFAULTS).toMatchObject({ minWords: 150, maxWords: 500, maxPerHour: 20, maxTotalMs: 180000 });
  });

  it("reads every setting", () => {
    expect(
      readTraceRunConfig({
        TRACE_SOURCE: "steps",
        TRACE_PROVIDER: "mock",
        TRACE_MIN_WORDS: "100",
        TRACE_MAX_WORDS: "400",
        TRACE_MAX_PER_HOUR: "5",
        TRACE_REUSE: "true",
        TRACE_FIRST_EVENT_TIMEOUT_MS: "10000",
        TRACE_IDLE_TIMEOUT_MS: "20000",
        TRACE_TOTAL_TIMEOUT_MS: "90000",
      })
    ).toEqual({
      setting: "steps",
      provider: "mock",
      maxPerHour: 5,
      reuse: true,
      limits: { minWords: 100, maxWords: 400, firstEventTimeoutMs: 10000, idleTimeoutMs: 20000, maxTotalMs: 90000 },
    });
  });

  it("accepts the three source settings, trimming spaces, and ignores anything else", () => {
    for (const value of ["reasoning", "steps", "auto", " steps "]) {
      expect(readTraceRunConfig({ TRACE_SOURCE: value }).setting).toBe(value.trim());
    }
    for (const value of ["", "both", "REASONING", "Auto", "1"]) {
      expect(readTraceRunConfig({ TRACE_SOURCE: value }).setting).toBe("auto");
    }
  });

  it("falls back to deepseek for an unknown provider", () => {
    expect(readTraceRunConfig({ TRACE_PROVIDER: "openai" }).provider).toBe("deepseek");
    expect(readTraceRunConfig({ TRACE_PROVIDER: "" }).provider).toBe("deepseek");
  });

  it("falls back for words, limits and timeouts that are not sensible whole numbers", () => {
    for (const value of ["abc", "-5", "0", "12.5", "1e3", "", "  ", "99999999999"]) {
      const config = readTraceRunConfig({ TRACE_MAX_WORDS: value, TRACE_MAX_PER_HOUR: value, TRACE_IDLE_TIMEOUT_MS: value });
      expect(config.limits.maxWords).toBe(500);
      expect(config.maxPerHour).toBe(20);
      expect(config.limits.idleTimeoutMs).toBe(30000);
    }
    expect(readTraceRunConfig({ TRACE_IDLE_TIMEOUT_MS: "500" }).limits.idleTimeoutMs).toBe(30000); // below the 1 s minimum
  });

  it("uses the default range for both words when the minimum is above the maximum", () => {
    const { limits } = readTraceRunConfig({ TRACE_MIN_WORDS: "600", TRACE_MAX_WORDS: "200" });
    expect(limits.minWords).toBe(150);
    expect(limits.maxWords).toBe(500);
  });

  it("keeps a valid minimum when only the maximum is invalid, as long as the pair still fits", () => {
    expect(readTraceRunConfig({ TRACE_MIN_WORDS: "200", TRACE_MAX_WORDS: "nope" }).limits).toMatchObject({ minWords: 200, maxWords: 500 });
    expect(readTraceRunConfig({ TRACE_MIN_WORDS: "800", TRACE_MAX_WORDS: "nope" }).limits).toMatchObject({ minWords: 150, maxWords: 500 });
  });

  it("never throws, whatever the environment holds", () => {
    expect(() => readTraceRunConfig({ TRACE_SOURCE: undefined, TRACE_MIN_WORDS: undefined })).not.toThrow();
  });
});

describe("TRACE_REUSE", () => {
  it("is off by default and in the defaults object", () => {
    expect(readTraceRunConfig({}).reuse).toBe(false);
    expect(TRACE_DEFAULTS.reuse).toBe(false);
  });

  it('is on only for the exact value "true" (spaces around it are trimmed)', () => {
    expect(readTraceRunConfig({ TRACE_REUSE: "true" }).reuse).toBe(true);
    expect(readTraceRunConfig({ TRACE_REUSE: " true " }).reuse).toBe(true);
    for (const value of ["", "false", "TRUE", "True", "1", "yes", "on", "tru"]) {
      expect(readTraceRunConfig({ TRACE_REUSE: value }).reuse, value).toBe(false);
    }
  });
});
