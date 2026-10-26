import { describe, expect, it } from "vitest";
import { isBlankAnswerCorrect, parseContent } from "../content";
import { segmentTrace } from "../segment";
import { SAMPLE_REASONING, SAMPLE_STEPS } from "../trace/sample-trace";
import { applyBlanks, BlankApplyError } from "./apply";
import { proposeBlanks } from "./propose";

const P1 = "Each step halves the range, so the running time is O(log n) for a list of any size.";
const P2 = "The loop keeps going while low <= high and then it stops.";

const at = (paragraph: string, answer: string) => {
  const start = paragraph.indexOf(answer);
  return { answer, start, end: start + answer.length };
};

describe("applyBlanks", () => {
  it("puts BLANK(answer) in place and joins paragraphs with $$", () => {
    expect(applyBlanks([P1, P2], [[at(P1, "log n")], [at(P2, "low <= high")]])).toBe(
      "Each step halves the range, so the running time is O(BLANK(log n)) for a list of any size.$$The loop keeps going while BLANK(low <= high) and then it stops."
    );
  });

  it("round trips through the page's parser: answers equal the chosen ones, visible text equals the original", () => {
    const chosen = [[at(P1, "log n")], [at(P2, "low <= high")]];
    const parsed = parseContent(applyBlanks([P1, P2], chosen));
    expect(parsed).toHaveLength(2);
    [P1, P2].forEach((original, i) => {
      const blanks = parsed[i].flatMap((p) => (p.type === "blank" ? [p.answer] : []));
      expect(blanks).toEqual(chosen[i].map((b) => b.answer));
      expect(parsed[i].map((p) => (p.type === "text" ? p.text : p.answer)).join("")).toBe(original);
    });
  });

  it("a different case typed still passes, and outer spaces typed by the learner are trimmed", () => {
    const parsed = parseContent(applyBlanks([P2], [[at(P2, "low <= high")]]));
    const blank = parsed[0].find((p) => p.type === "blank");
    if (!blank || blank.type !== "blank") throw new Error("no blank");
    expect(isBlankAnswerCorrect("LOW <= HIGH", blank.answer)).toBe(true);
    expect(isBlankAnswerCorrect("  Low <= High  ", blank.answer)).toBe(true);
    expect(isBlankAnswerCorrect("low<=high", blank.answer)).toBe(false);
  });

  it("handles a blank at the very start, at the very end, and several in one paragraph", () => {
    const p = "alpha beta gamma delta epsilon";
    expect(applyBlanks([p], [[at(p, "alpha")]])).toBe("BLANK(alpha) beta gamma delta epsilon");
    expect(applyBlanks([p], [[at(p, "epsilon")]])).toBe("alpha beta gamma delta BLANK(epsilon)");
    const two = applyBlanks([p], [[at(p, "delta"), at(p, "beta")]]); // given out of order
    expect(two).toBe("alpha BLANK(beta) gamma BLANK(delta) epsilon");
    expect(parseContent(two)[0].filter((x) => x.type === "blank")).toHaveLength(2);
  });

  it("with nothing chosen the content is just the paragraphs joined by $$, unchanged", () => {
    expect(applyBlanks([P1, P2], [])).toBe(`${P1}$$${P2}`);
    expect(applyBlanks([P1, P2], [[], []])).toBe(`${P1}$$${P2}`);
    expect(applyBlanks([], [])).toBe("");
  });

  it("changes nothing else: the text outside the blanks stays exactly as it was", () => {
    const p = "Keep   odd spacing, 'quotes' & <tags> and  unicode naïve as is.";
    expect(applyBlanks([p], [[at(p, "naïve")]])).toBe("Keep   odd spacing, 'quotes' & <tags> and  unicode BLANK(naïve) as is.");
  });
});

describe("applyBlanks errors", () => {
  const fails = (paragraphs: string[], chosen: Parameters<typeof applyBlanks>[1], message: RegExp) => {
    expect(() => applyBlanks(paragraphs, chosen)).toThrow(BlankApplyError);
    expect(() => applyBlanks(paragraphs, chosen)).toThrow(message);
  };

  it("rejects an answer that would break the parser", () => {
    const f = "We call f(x) here.";
    fails([f], [[at(f, "f(x)")]], /paragraph 1.*"\)"/);
    const lines = "We keep two\nlines here.";
    fails([lines], [[at(lines, "two\nlines")]], /line break/);
    // "$$" and "BLANK(" inside the paragraph are refused before any answer is looked at
    fails(["a$$b here"], [[at("a$$b here", "a$$b")]], /\$\$/);
    fails(["see BLANK(y here"], [[at("see BLANK(y here", "BLANK(y")]], /BLANK\(/);
  });

  it("rejects an untrimmed or empty answer", () => {
    const p = "one two three";
    fails([p], [[{ answer: " two", start: 3, end: 7 }]], /spaces around/);
    fails([p], [[{ answer: "", start: 3, end: 3 }]], /out of range|empty/);
    fails(["one   two"], [[{ answer: "   ", start: 3, end: 6 }]], /empty answer/);
  });

  it("rejects a paragraph that contains $$ or BLANK( or is empty", () => {
    fails(["a $$ b"], [], /contains "\$\$"/);
    fails(["see BLANK(x) here"], [], /already contains "BLANK\("/);
    fails(["fine", "  "], [], /paragraph 2 is empty/);
  });

  it("rejects a slice that is not the answer, an overlap and a range outside the paragraph", () => {
    const p = "one two three";
    fails([p], [[{ answer: "two", start: 0, end: 3 }]], /is not the answer/);
    fails([p], [[at(p, "one two"), at(p, "two")]], /overlaps/);
    fails([p], [[{ answer: "x", start: 20, end: 21 }]], /out of range/);
    fails([p], [[{ answer: "x", start: 5, end: 3 }]], /out of range/);
  });

  it("rejects more groups than paragraphs", () => {
    fails([P1], [[], []], /only 1/);
  });

  it("rejects what the round trip would read back differently", () => {
    // a paragraph ending with "$" followed by the "$" of the separator makes "$$$" and shifts the split
    fails(["ends with a dollar $", "second paragraph"], [], /paragraphs|read back/);
  });
});

describe("propose -> apply on the built-in samples", () => {
  for (const [name, text] of [["reasoning", SAMPLE_REASONING], ["steps", SAMPLE_STEPS]] as const) {
    it(`${name}: the best candidate per paragraph applies and round trips`, () => {
      const paragraphs = segmentTrace(text);
      const best = proposeBlanks(paragraphs, { maxBlanksPerParagraph: 3 }).map((list) => list.slice(0, 1));
      const content = applyBlanks(paragraphs, best);
      const parsed = parseContent(content);
      expect(parsed).toHaveLength(paragraphs.length);
      const total = parsed.flat().filter((p) => p.type === "blank");
      expect(total).toHaveLength(best.flat().length);
      expect(total.length).toBeGreaterThan(0);
      for (const part of total) {
        if (part.type === "blank") {
          expect(part.answer).not.toMatch(/\$\$|blank\(|\)/i);
          expect(isBlankAnswerCorrect(part.answer.toUpperCase(), part.answer)).toBe(true);
        }
      }
    });
  }
});
