import { afterEach, describe, expect, it, vi } from "vitest";
import { isLiveTraceEnabled, LIVE_TRACE_FLAG_NAME, parseLiveTraceFlag } from "./flag";

afterEach(() => vi.unstubAllEnvs());

describe("parseLiveTraceFlag", () => {
  it('is true only for the exact string "true"', () => {
    expect(parseLiveTraceFlag("true")).toBe(true);
  });

  it.each([undefined, "", "false", "TRUE", "True", "1", "yes", "on", " true", "true ", "true\n", "tru"])("is false for %j", (value) => {
    expect(parseLiveTraceFlag(value)).toBe(false);
  });
});

describe("isLiveTraceEnabled", () => {
  it("is off when the variable is not set (the default)", () => {
    vi.stubEnv("NEXT_PUBLIC_LIVE_TRACE", undefined as unknown as string);
    delete process.env.NEXT_PUBLIC_LIVE_TRACE;
    expect(isLiveTraceEnabled()).toBe(false);
  });

  it('reads NEXT_PUBLIC_LIVE_TRACE: "true" turns it on, anything else leaves it off', () => {
    expect(LIVE_TRACE_FLAG_NAME).toBe("NEXT_PUBLIC_LIVE_TRACE");
    vi.stubEnv("NEXT_PUBLIC_LIVE_TRACE", "true");
    expect(isLiveTraceEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_LIVE_TRACE", "1");
    expect(isLiveTraceEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_LIVE_TRACE", "false");
    expect(isLiveTraceEnabled()).toBe(false);
  });
});
