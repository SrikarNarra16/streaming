import { describe, expect, it } from "vitest";
import { SAMPLE_REASONING, SAMPLE_REASONING_ANSWER, SAMPLE_STEPS } from "./sample-trace";

const words = (text: string) => text.trim().split(/\s+/).length;

describe("sample traces (invented, for the mock provider)", () => {
  it("has a reasoning of about 250 words and a steps text of about 330 words", () => {
    expect(words(SAMPLE_REASONING)).toBeGreaterThanOrEqual(225);
    expect(words(SAMPLE_REASONING)).toBeLessThanOrEqual(275);
    expect(words(SAMPLE_STEPS)).toBeGreaterThanOrEqual(310);
    expect(words(SAMPLE_STEPS)).toBeLessThanOrEqual(360);
  });

  it("both fit the default word range, so the mock exercises the normal path", () => {
    for (const text of [SAMPLE_REASONING, SAMPLE_STEPS]) {
      expect(words(text)).toBeGreaterThanOrEqual(150);
      expect(words(text)).toBeLessThanOrEqual(500);
    }
  });

  it("each contains a short code block", () => {
    expect(SAMPLE_REASONING).toMatch(/^def largest_gap\(nums\):/m);
    expect(SAMPLE_STEPS).toContain("```python");
    expect(SAMPLE_REASONING_ANSWER).toContain("def largest_gap");
  });

  it("are split into paragraphs by blank lines", () => {
    expect(SAMPLE_REASONING.split("\n\n").length).toBeGreaterThan(3);
    expect(SAMPLE_STEPS.split("\n\n").length).toBeGreaterThan(5);
  });

  it("contain nothing that the page would read as markup of its own", () => {
    for (const text of [SAMPLE_REASONING, SAMPLE_STEPS, SAMPLE_REASONING_ANSWER]) {
      expect(text).not.toContain("$$");
      expect(text).not.toMatch(/blank\(/i);
      expect(text).not.toMatch(/oververb|overbrev/i);
    }
  });
});
