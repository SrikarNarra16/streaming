import { describe, expect, it } from "vitest";
import { cleanTrace } from "./clean-trace";
import { findTraceArtifacts, segmentTrace } from "./segment";

const words = (s: string) => (s.trim() === "" ? 0 : s.trim().split(/\s+/).length);

describe("cleanTrace: what is removed and how", () => {
  it("removes an artifact that is alone on its line, with the line break", () => {
    const { text, removed } = cleanTrace("Need code.\nDesired oververbosity 5\nThen go.");
    expect(text).toBe("Need code.\nThen go.");
    expect(removed).toEqual([
      { text: "Desired oververbosity 5", index: 11, reason: "artifact alone on its line (line removed)" },
    ]);
    expect(cleanTrace("Need code.\nDesired oververbosity 5.\nThen go.").text).toBe("Need code.\nThen go.");
  });

  it("removes an artifact at the very start of the trace", () => {
    expect(cleanTrace("Desired oververbosity 5. Need a function.").text).toBe("Need a function.");
    expect(cleanTrace("Desired oververbosity 5\nNeed a function.").text).toBe("Need a function.");
  });

  it("removes an artifact at the very end of the trace, without leaving a stray space", () => {
    expect(cleanTrace("Need a function. Desired oververbosity 5.").text).toBe("Need a function.");
    expect(cleanTrace("Need a function. Desired oververbosity 5").text).toBe("Need a function.");
    expect(cleanTrace("Need a function.\nDesired oververbosity 5").text).toBe("Need a function.");
  });

  it("removes a whole-sentence artifact in the middle of a line", () => {
    const { text, removed } = cleanTrace("Could include example. Desired oververbosity 5. We'll provide code.");
    expect(text).toBe("Could include example. We'll provide code.");
    expect(removed[0].text).toBe("Desired oververbosity 5.");
    expect(removed[0].reason).toContain("whole sentence");
  });

  it("removes only the phrase (and its comma) when the sentence goes on", () => {
    const first = cleanTrace("Final with code. Desired oververbosity 5, but user says just write function.");
    expect(first.text).toBe("Final with code. but user says just write function.");
    expect(first.removed[0]).toMatchObject({ text: "Desired oververbosity 5,", reason: expect.stringContaining("start of a sentence") });

    expect(cleanTrace("Final with function. Desired oververbosity 5 but simple.").text).toBe("Final with function. but simple.");
  });

  it("fixes spacing and commas around an artifact inside a sentence", () => {
    expect(cleanTrace("We add the example, Desired oververbosity 5, and then finish.").text).toBe(
      "We add the example, and then finish."
    );
    expect(cleanTrace("We add the example Desired oververbosity 5 and then finish.").text).toBe(
      "We add the example and then finish."
    );
    expect(cleanTrace("We add the example Desired oververbosity 5.").text).toBe("We add the example.");
  });

  it("removes two artifacts in one trace and lists them in order with their original indexes", () => {
    const raw = "A. Desired oververbosity 5. B.\n\nC. Oververbosity 5. D.";
    const { text, removed } = cleanTrace(raw);
    expect(text).toBe("A. B.\n\nC. D.");
    expect(removed.map((r) => r.text)).toEqual(["Desired oververbosity 5.", "Oververbosity 5."]);
    expect(removed.map((r) => r.index)).toEqual([raw.indexOf("Desired"), raw.indexOf("Oververbosity")]);
  });

  it("handles the misspellings seen in saved traces", () => {
    expect(cleanTrace("Final. Desired overbrev 5. Next.").text).toBe("Final. Next.");
    expect(cleanTrace("Fine. Desired oververbose 5. Next.").text).toBe("Fine. Next.");
  });

  it("keeps Windows line endings", () => {
    expect(cleanTrace("Need code.\r\nDesired oververbosity 5\r\nThen go.").text).toBe("Need code.\r\nThen go.");
  });
});

describe("cleanTrace: what must stay", () => {
  it("returns the text unchanged when there is no artifact", () => {
    const raw = "  Need a function.\n\nThen   we test it.  ";
    expect(cleanTrace(raw)).toEqual({ text: raw, removed: [] });
  });

  it("keeps false positives such as 'overview 3' and 'over 5 items'", () => {
    const raw = "An overview 3 steps long. We went over 5 items. Overbought 2 times.";
    expect(cleanTrace(raw)).toEqual({ text: raw, removed: [] });
  });

  it("removes no other words", () => {
    const raw = "Need code. Desired oververbosity 5, but user says short. Then go. Oververbosity 5.";
    const { text, removed } = cleanTrace(raw);
    const removedWords = removed.reduce((n, r) => n + words(r.text), 0);
    expect(words(text)).toBe(words(raw) - removedWords);
  });
});

describe("cleanTrace: idempotent and compatible with the segmenter", () => {
  const fixtures = [
    "Need code.\nDesired oververbosity 5\nThen go.",
    "Desired oververbosity 5. Need a function. Desired oververbosity 5.",
    "A. Desired oververbosity 5, but B. Oververbosity 5. C.",
    "We add the example, Desired oververbosity 5, and finish.",
    "Nothing to remove here.",
    "",
  ];
  for (const raw of fixtures) {
    it(`cleaning twice equals cleaning once: ${JSON.stringify(raw.slice(0, 30))}`, () => {
      const once = cleanTrace(raw);
      const twice = cleanTrace(once.text);
      expect(twice.text).toBe(once.text);
      expect(twice.removed).toEqual([]);
    });
  }

  it("leaves no artifact in the segmented output, although the uncleaned trace has them", () => {
    const raw =
      "We need a function. Desired oververbosity 5. " +
      "Think about edge cases for a while, " + "and more words follow here ".repeat(12) +
      "\n```python\ndef f(x):\n    return x\n```\n" +
      "Final answer next. Oververbosity 5, but keep it simple. Done.";
    expect(findTraceArtifacts(segmentTrace(raw).join(" ")).length).toBeGreaterThan(0);
    const cleaned = cleanTrace(raw).text;
    expect(findTraceArtifacts(segmentTrace(cleaned).join(" "))).toEqual([]);
  });
});
