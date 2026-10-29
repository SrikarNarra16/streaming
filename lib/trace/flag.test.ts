import { afterEach, describe, expect, it, vi } from "vitest";
import { isLiveTraceEnabled, LIVE_TRACE_FLAG_NAME, parseLiveTraceFlag } from "./flag";

afterEach(() => vi.unstubAllEnvs());

describe("parseLiveTraceFlag", () => {
  it('is off only for the exact string "false"', () => {
    expect(parseLiveTraceFlag("false")).toBe(false);
  });

  it.each([undefined, "true", "", "FALSE", "False", "0", "no", "off", " false", "false ", "false\n", "fals", "1", "yes"])("is on for %j", (value) => {
    expect(parseLiveTraceFlag(value)).toBe(true);
  });
});

describe("isLiveTraceEnabled", () => {
  it("is on when the variable is not set (the default)", () => {
    vi.stubEnv("NEXT_PUBLIC_LIVE_TRACE", undefined as unknown as string);
    delete process.env.NEXT_PUBLIC_LIVE_TRACE;
    expect(isLiveTraceEnabled()).toBe(true);
  });

  it('reads NEXT_PUBLIC_LIVE_TRACE: only "false" turns it off', () => {
    expect(LIVE_TRACE_FLAG_NAME).toBe("NEXT_PUBLIC_LIVE_TRACE");
    vi.stubEnv("NEXT_PUBLIC_LIVE_TRACE", "false");
    expect(isLiveTraceEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_LIVE_TRACE", "true");
    expect(isLiveTraceEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_LIVE_TRACE", "0");
    expect(isLiveTraceEnabled()).toBe(true);
  });
});
