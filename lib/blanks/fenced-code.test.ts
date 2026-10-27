import { describe, expect, it } from "vitest";
import { isBlankAnswerCorrect, nextToken, parseContent } from "../content";
import { segmentTrace } from "../segment";
import { SAMPLE_REASONING } from "../trace/sample-trace";
import { applyBlanks } from "./apply";
import { isCodeParagraph, proposeBlanks } from "./propose";

// Paragraphs that now arrive with a ``` fence around code the model printed without one.
const paragraphs = segmentTrace(SAMPLE_REASONING);
const FLUSH = segmentTrace(
  "We need the pointers first and then the loop body that moves them around the sorted list one step at a time today.\nlow = 0\nhigh = len(arr) - 1\nAfter that comes the loop that keeps halving the range until the target has been found or the range is empty.",
);

describe("fenced code paragraphs and the blank generator", () => {
  it("are still code paragraphs, so they get no blank by default", () => {
    for (const set of [paragraphs, FLUSH]) {
      const fencedIndexes = set.map((p, i) => (p.startsWith("```") ? i : -1)).filter((i) => i >= 0);
      expect(fencedIndexes.length).toBeGreaterThan(0);
      const lists = proposeBlanks(set, { maxBlanksPerParagraph: 9, skipFirst: false, includeSpacingSensitive: true });
      for (const i of fencedIndexes) {
        expect(isCodeParagraph(set[i])).toBe(true);
        expect(lists[i]).toEqual([]);
      }
    }
  });

  it("includeCode true looks inside them, and any blank still round trips", () => {
    const lists = proposeBlanks(paragraphs, { includeCode: true, maxBlanksPerParagraph: 9, includeSpacingSensitive: true });
    const codeIndex = paragraphs.findIndex((p) => p.startsWith("```"));
    for (const c of lists[codeIndex]) expect(paragraphs[codeIndex].slice(c.start, c.end)).toBe(c.answer); // none are found in this particular code, which repeats its names
    const best = lists.map((l) => l.slice(0, 1));
    const content = applyBlanks(paragraphs, best);
    expect(parseContent(content)).toHaveLength(paragraphs.length);
  });
});

describe("applyBlanks and the page parser with a fenced block", () => {
  it("round trips content that contains a fenced block (no blank inside it)", () => {
    const best = proposeBlanks(paragraphs).map((l) => l.slice(0, 1));
    const content = applyBlanks(paragraphs, best);
    expect(content).toContain("```\ndef largest_gap(nums):\n    if len(nums) < 2:");
    const parsed = parseContent(content);
    expect(parsed).toHaveLength(paragraphs.length);
    parsed.forEach((parts, i) => {
      expect(parts.map((p) => (p.type === "text" ? p.text : p.answer)).join("")).toBe(paragraphs[i]);
    });
    const codeIndex = paragraphs.findIndex((p) => p.startsWith("```"));
    expect(parsed[codeIndex]).toEqual([{ type: "text", text: paragraphs[codeIndex] }]);
  });

  it("the typing loop reads the fenced block through nextToken, character by character, to the same text", () => {
    const content = applyBlanks(paragraphs, []);
    let position = 0;
    let typed = "";
    for (;;) {
      const token = nextToken(content, position, 1);
      if (token.kind === "end") break;
      if (token.kind === "paragraphBreak") typed += "$$";
      else if (token.kind === "char") typed += token.text;
      else typed += `BLANK(${token.answer})`;
      position += token.length;
    }
    expect(typed).toBe(content);
  });

  it("a blank next to a fenced block still grades with a different case", () => {
    const set = [...FLUSH];
    const best = proposeBlanks(set, { skipFirst: false }).map((l) => l.slice(0, 1));
    const content = applyBlanks(set, best);
    for (const part of parseContent(content).flat()) {
      if (part.type === "blank") expect(isBlankAnswerCorrect(` ${part.answer.toUpperCase()} `, part.answer)).toBe(true);
    }
  });
});
