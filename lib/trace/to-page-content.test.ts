import { describe, expect, it } from "vitest";
import { isBlankAnswerCorrect, parseContent } from "../content";
import { segmentTrace } from "../segment";
import { SAMPLE_REASONING, SAMPLE_STEPS } from "./sample-trace";
import { blankSeedFor, traceToPageContent } from "./to-page-content";

const INTRO = "We need a function that searches a sorted list for a target value and tells us where the target is located inside the list.";
const TIE = "In the first round we have low=3 and mid=2 at the start of the search and nothing else in this sentence matters for the example we are discussing.";
const SHORT = "Short one.";

const visible = (parts: ReturnType<typeof parseContent>[number]) => parts.map((p) => (p.type === "text" ? p.text : p.answer)).join("");

describe("traceToPageContent", () => {
  it("joins paragraphs with $$ and puts at most one BLANK(...) in a paragraph, never in the first", () => {
    const paragraphs = segmentTrace(SAMPLE_REASONING);
    const { content, blankCount } = traceToPageContent(paragraphs, 7);
    expect(blankCount).toBeGreaterThan(0);
    const parsed = parseContent(content);
    expect(parsed).toHaveLength(paragraphs.length);
    expect(parsed[0].every((p) => p.type === "text")).toBe(true);
    parsed.forEach((parts, i) => {
      expect(parts.filter((p) => p.type === "blank").length).toBeLessThanOrEqual(1);
      expect(visible(parts)).toBe(paragraphs[i]); // putting the answers back gives the original text
    });
    expect(parsed.flat().filter((p) => p.type === "blank")).toHaveLength(blankCount);
  });

  it("reads back through the page's own grading: a different case typed passes", () => {
    const { content } = traceToPageContent(segmentTrace(SAMPLE_STEPS), 3);
    const blanks = parseContent(content).flat().flatMap((p) => (p.type === "blank" ? [p.answer] : []));
    expect(blanks.length).toBeGreaterThan(0);
    for (const answer of blanks) {
      expect(isBlankAnswerCorrect(`  ${answer.toUpperCase()} `, answer)).toBe(true);
      expect(answer).not.toMatch(/\$\$|\)|blank\(/i);
    }
  });

  it("is deterministic: the same paragraphs and question id always give the same content", () => {
    const paragraphs = segmentTrace(SAMPLE_REASONING);
    const first = traceToPageContent(paragraphs, 12);
    for (let i = 0; i < 5; i++) expect(traceToPageContent([...paragraphs], 12)).toEqual(first);
  });

  it("the seed comes from the question id: ids can tie-break differently, one id never does", () => {
    expect(blankSeedFor(5)).toBe(blankSeedFor(5));
    expect(blankSeedFor(5)).not.toBe(blankSeedFor(6));
    const contents = new Set<string>();
    for (let id = 1; id <= 40; id++) contents.add(traceToPageContent([INTRO, TIE], id).content);
    expect(contents.size).toBe(2); // the two equal candidates "3" and "2" both occur across ids
    for (const content of contents) expect(content).toMatch(/BLANK\([23]\)/);
  });

  it("falls back to the plain paragraphs when no blank is found", () => {
    const paragraphs = [INTRO, SHORT, "Another short paragraph."];
    expect(traceToPageContent(paragraphs, 1)).toEqual({ content: paragraphs.join("$$"), blankCount: 0 });
  });

  it("drops empty paragraphs, so the page never meets an empty one", () => {
    expect(traceToPageContent([SHORT, "", "  ", "Second."], 1).content).toBe("Short one.$$Second.");
  });

  it('returns "" (use the stored content) for nothing, or for text the page would read as structure', () => {
    expect(traceToPageContent([], 1)).toEqual({ content: "", blankCount: 0 });
    expect(traceToPageContent(["", " "], 1).content).toBe("");
    expect(traceToPageContent([INTRO, "has $$ inside it and enough words to be a real paragraph of text here today"], 1).content).toBe("");
    expect(traceToPageContent([INTRO, "has BLANK(x) inside it and enough words to be a real paragraph of text here today"], 1).content).toBe("");
  });
});
