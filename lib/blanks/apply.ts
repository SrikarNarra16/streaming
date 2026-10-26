// Puts chosen blanks into the paragraphs and returns the content string the page reads:
// "$$" between paragraphs and BLANK(answer) where a blank goes. Nothing is neutralised or rewritten.
//
// The result is checked by parsing it with the page's own parser (lib/content.ts): the paragraphs must come
// back as the same number of paragraphs, the blank answers must equal the chosen answers, and the visible text
// with the answers put back must equal the original paragraph. Anything that would not survive that
// (an answer with ")", "$$" or "BLANK(", spaces around an answer, a paragraph that already contains "$$" or
// "BLANK(", an empty paragraph) throws an error that says which paragraph and why.
import { parseContent } from "../content";

export interface ChosenBlank {
  answer: string;
  /** paragraph.slice(start, end) must equal the answer. */
  start: number;
  end: number;
}

export class BlankApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlankApplyError";
  }
}

export function applyBlanks(paragraphs: string[], chosen: ChosenBlank[][]): string {
  if (chosen.length > paragraphs.length) {
    throw new BlankApplyError(`blanks were chosen for ${chosen.length} paragraphs but there are only ${paragraphs.length}`);
  }

  const pieces = paragraphs.map((paragraph, index) => {
    const label = `paragraph ${index + 1}`;
    if (paragraph.trim() === "") throw new BlankApplyError(`${label} is empty: the page cannot show an empty paragraph`);
    if (paragraph.includes("$$")) throw new BlankApplyError(`${label} contains "$$", which would split it`);
    if (/blank\(/i.test(paragraph)) throw new BlankApplyError(`${label} already contains "BLANK(", which the page would read as a blank`);

    const blanks = [...(chosen[index] ?? [])].sort((a, b) => a.start - b.start);
    let text = "";
    let at = 0;
    for (const blank of blanks) {
      const { answer, start, end } = blank;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < at || end <= start || end > paragraph.length) {
        throw new BlankApplyError(`${label}: a blank at ${start}-${end} is out of range or overlaps another blank`);
      }
      if (paragraph.slice(start, end) !== answer) {
        throw new BlankApplyError(`${label}: the text at ${start}-${end} is not the answer "${answer}"`);
      }
      if (answer.trim() === "") throw new BlankApplyError(`${label}: an empty answer is not a blank`);
      if (answer !== answer.trim()) throw new BlankApplyError(`${label}: the answer "${answer}" has spaces around it, so the learner's trimmed input could never match`);
      if (answer.includes(")")) throw new BlankApplyError(`${label}: the answer "${answer}" contains ")", which ends a blank early`);
      if (answer.includes("$$")) throw new BlankApplyError(`${label}: the answer "${answer}" contains "$$"`);
      if (/blank\(/i.test(answer)) throw new BlankApplyError(`${label}: the answer "${answer}" contains "BLANK("`);
      if (/[\r\n]/.test(answer)) throw new BlankApplyError(`${label}: the answer "${answer}" contains a line break`);
      text += paragraph.slice(at, start) + `BLANK(${answer})`;
      at = end;
    }
    return text + paragraph.slice(at);
  });

  const content = pieces.join("$$");

  // Round trip through the page's own parser.
  const parsed = parseContent(content);
  if (parsed.length !== paragraphs.length) {
    throw new BlankApplyError(`the content reads back as ${parsed.length} paragraphs instead of ${paragraphs.length}`);
  }
  parsed.forEach((parts, index) => {
    const expectedAnswers = [...(chosen[index] ?? [])].sort((a, b) => a.start - b.start).map((b) => b.answer);
    const answers = parts.flatMap((part) => (part.type === "blank" ? [part.answer] : []));
    const visible = parts.map((part) => (part.type === "text" ? part.text : part.answer)).join("");
    if (answers.length !== expectedAnswers.length || answers.some((a, i) => a !== expectedAnswers[i])) {
      throw new BlankApplyError(`paragraph ${index + 1}: the blanks read back as [${answers.join(" | ")}] instead of [${expectedAnswers.join(" | ")}]`);
    }
    if (visible !== paragraphs[index]) {
      throw new BlankApplyError(`paragraph ${index + 1}: the text read back differently from the original`);
    }
  });

  return content;
}
