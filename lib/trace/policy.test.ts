import { describe, expect, it } from "vitest";
import { decideTraceSource, TRACE_SETTINGS, type TraceDecisionInput } from "./policy";

const decide = (setting: TraceDecisionInput["setting"], reasoningWords: number, minWords = 150, maxWords = 500) =>
  decideTraceSource({ setting, reasoningWords, minWords, maxWords });

describe("decideTraceSource", () => {
  it("lists the three settings", () => {
    expect([...TRACE_SETTINGS]).toEqual(["reasoning", "steps", "auto"]);
  });

  it('"reasoning" always gives reasoning, whatever the length', () => {
    for (const words of [0, 10, 150, 300, 500, 501, 5000]) {
      expect(decide("reasoning", words)).toEqual({ source: "reasoning", reason: "setting_reasoning" });
    }
  });

  it('"steps" always gives steps, whatever the length', () => {
    for (const words of [0, 10, 150, 300, 500, 501, 5000]) {
      expect(decide("steps", words)).toEqual({ source: "steps", reason: "setting_steps" });
    }
  });

  describe('"auto"', () => {
    it("uses reasoning when the words are within [min, max], both ends included", () => {
      for (const words of [150, 151, 300, 499, 500]) {
        expect(decide("auto", words)).toEqual({ source: "reasoning", reason: "in_range" });
      }
    });

    it('uses steps with the reason "too_short" below the minimum', () => {
      for (const words of [0, 1, 100, 149]) {
        expect(decide("auto", words)).toEqual({ source: "steps", reason: "too_short" });
      }
    });

    it('uses steps with the reason "too_long" above the maximum', () => {
      for (const words of [501, 502, 1000, 100000]) {
        expect(decide("auto", words)).toEqual({ source: "steps", reason: "too_long" });
      }
    });

    it("works with another range", () => {
      expect(decide("auto", 40, 50, 60).reason).toBe("too_short");
      expect(decide("auto", 55, 50, 60)).toEqual({ source: "reasoning", reason: "in_range" });
      expect(decide("auto", 61, 50, 60).reason).toBe("too_long");
    });

    it("a range of a single value accepts exactly that value", () => {
      expect(decide("auto", 100, 100, 100).reason).toBe("in_range");
      expect(decide("auto", 99, 100, 100).reason).toBe("too_short");
      expect(decide("auto", 101, 100, 100).reason).toBe("too_long");
    });
  });
});
