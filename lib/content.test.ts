import { describe, expect, it } from "vitest";
import { isBlankAnswerCorrect, nextToken, parseContent, type ContentPart } from "./content";

const text = (t: string): ContentPart => ({ type: "text", text: t });
const blank = (answer: string): ContentPart => ({ type: "blank", answer });

describe("parseContent: paragraphs and blanks", () => {
  it("splits normal content on $$ and finds the blank", () => {
    expect(parseContent("First paragraph.$$Second paragraph with BLANK(answer) here.$$Third.")).toEqual([
      [text("First paragraph.")],
      [text("Second paragraph with "), blank("answer"), text(" here.")],
      [text("Third.")],
    ]);
  });

  it("handles several blanks in one paragraph", () => {
    expect(parseContent("Use BLANK(a) and BLANK(b), then BLANK(c).")).toEqual([
      [text("Use "), blank("a"), text(" and "), blank("b"), text(", then "), blank("c"), text(".")],
    ]);
  });

  it("handles a blank at the start, at the end, and two blanks side by side", () => {
    expect(parseContent("BLANK(x) marks the spot")).toEqual([[blank("x"), text(" marks the spot")]]);
    expect(parseContent("ends with BLANK(y)")).toEqual([[text("ends with "), blank("y")]]);
    expect(parseContent("BLANK(a)BLANK(b)")).toEqual([[blank("a"), blank("b")]]);
  });

  it("returns no paragraphs for empty content", () => {
    expect(parseContent("")).toEqual([]);
    expect(nextToken("", 0)).toEqual({ kind: "end" });
  });

  it("keeps extra whitespace exactly as written (nothing is trimmed)", () => {
    expect(parseContent(" First  $$  Second \n\n$$ Third ")).toEqual([
      [text(" First  ")],
      [text("  Second \n\n")],
      [text(" Third ")],
    ]);
    // whitespace inside the parentheses is part of the answer
    expect(parseContent("BLANK( x )")).toEqual([[blank(" x ")]]);
  });

  it("accepts the BLANK marker in any case and keeps the answer's case", () => {
    expect(parseContent("blank(Hello) BLANK(World) Blank(x)")).toEqual([
      [blank("Hello"), text(" "), blank("World"), text(" "), blank("x")],
    ]);
  });

  it("accepts answers with punctuation", () => {
    expect(parseContent("BLANK(-1) BLANK(%) BLANK(a, b) BLANK(O'Brien)")).toEqual([
      [blank("-1"), text(" "), blank("%"), text(" "), blank("a, b"), text(" "), blank("O'Brien")],
    ]);
  });

  it("treats a single $ as plain text", () => {
    expect(parseContent("cost $5")).toEqual([[text("cost $5")]]);
  });

  it("does not add an empty paragraph after a trailing $$", () => {
    expect(parseContent("Hello$$")).toEqual([[text("Hello")]]);
  });

  it("reads $$$ as a break followed by a literal $", () => {
    expect(parseContent("a$$$b")).toEqual([[text("a")], [text("$b")]]);
  });
});

describe("parseContent: KNOWN QUIRKS (pinned as they are, not fixed)", () => {
  it("KNOWN QUIRK: a missing closing parenthesis turns the marker into literal text", () => {
    expect(parseContent("BLANK(abc")).toEqual([[text("BLANK(abc")]]);
    expect(parseContent("BLANK(abc$$next")).toEqual([[text("BLANK(abc")], [text("next")]]);
  });

  it("KNOWN QUIRK: an empty BLANK() is not a blank, it is typed as literal text", () => {
    expect(parseContent("BLANK()")).toEqual([[text("BLANK()")]]);
  });

  it("KNOWN QUIRK: nested parentheses end the answer at the first ), so BLANK(f(x)) has answer 'f(x'", () => {
    expect(parseContent("BLANK(f(x)) done")).toEqual([[blank("f(x"), text(") done")]]);
  });

  it("KNOWN QUIRK: $$ inside a BLANK(...) is part of the answer and does not break the paragraph", () => {
    expect(parseContent("BLANK(a$$b) end")).toEqual([[blank("a$$b"), text(" end")]]);
  });

  it("KNOWN QUIRK: a newline inside BLANK(...) is part of the answer", () => {
    expect(parseContent("BLANK(a\nb)")).toEqual([[blank("a\nb")]]);
  });

  it("KNOWN QUIRK: a leading $$ or a doubled $$$$ produces an empty paragraph", () => {
    expect(parseContent("$$Hello")).toEqual([[], [text("Hello")]]);
    expect(parseContent("A$$$$B")).toEqual([[text("A")], [], [text("B")]]);
  });
});

describe("nextToken", () => {
  it("returns end at or past the end of the content", () => {
    expect(nextToken("ab", 2)).toEqual({ kind: "end" });
    expect(nextToken("ab", 5)).toEqual({ kind: "end" });
  });

  it("returns one character per step by default and checks BLANK before $$", () => {
    expect(nextToken("abc", 0)).toEqual({ kind: "char", text: "a", length: 1 });
    expect(nextToken("BLANK(z)rest", 0)).toEqual({ kind: "blank", answer: "z", length: 8 });
    expect(nextToken("$$x", 0)).toEqual({ kind: "paragraphBreak", length: 2 });
  });

  it("returns a shorter chunk at the end when the step is larger than what is left", () => {
    expect(nextToken("abcdef", 0, 3)).toEqual({ kind: "char", text: "abc", length: 3 });
    expect(nextToken("ab", 0, 3)).toEqual({ kind: "char", text: "ab", length: 2 });
  });

  it("KNOWN QUIRK: with a step larger than 1, a chunk can swallow the start of a BLANK marker", () => {
    // the page uses a step of 1, so this does not happen today
    expect(nextToken("xxBLANK(a)", 0, 3)).toEqual({ kind: "char", text: "xxB", length: 3 });
  });
});

describe("isBlankAnswerCorrect", () => {
  it("accepts an exact match", () => {
    expect(isBlankAnswerCorrect("in", "in")).toBe(true);
  });

  it("ignores case on both sides", () => {
    expect(isBlankAnswerCorrect("IN", "in")).toBe(true);
    expect(isBlankAnswerCorrect("In", "IN")).toBe(true);
    expect(isBlankAnswerCorrect("in", "In")).toBe(true);
    expect(isBlankAnswerCorrect("É", "é")).toBe(true);
  });

  it("trims the learner's input", () => {
    expect(isBlankAnswerCorrect("  in \n", "in")).toBe(true);
  });

  it("matches answers with punctuation exactly", () => {
    expect(isBlankAnswerCorrect("-1", "-1")).toBe(true);
    expect(isBlankAnswerCorrect("%", "%")).toBe(true);
    expect(isBlankAnswerCorrect("a, b", "a, b")).toBe(true);
    expect(isBlankAnswerCorrect("a,b", "a, b")).toBe(false);
  });

  it("rejects wrong, partial and empty answers", () => {
    expect(isBlankAnswerCorrect("on", "in")).toBe(false);
    expect(isBlankAnswerCorrect("i", "in")).toBe(false);
    expect(isBlankAnswerCorrect("", "in")).toBe(false);
  });

  it("KNOWN QUIRK: only the learner's input is trimmed, so a stored answer with spaces can never match", () => {
    expect(isBlankAnswerCorrect("x", " x ")).toBe(false);
    expect(isBlankAnswerCorrect(" x ", " x ")).toBe(false);
  });

  it("KNOWN QUIRK: for BLANK(f(x)) the stored answer is 'f(x', so the learner must type 'f(x' and 'f(x)' is marked wrong", () => {
    const [[part]] = parseContent("BLANK(f(x))");
    const answer = part.type === "blank" ? part.answer : "";
    expect(answer).toBe("f(x");
    expect(isBlankAnswerCorrect("f(x", answer)).toBe(true);
    expect(isBlankAnswerCorrect("f(x)", answer)).toBe(false);
  });
});
