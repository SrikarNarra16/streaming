// Turns the paragraphs of a finished live trace into the content string the learner page reads
// ("$$" between paragraphs, BLANK(answer) markers), using the DRAFT blank generator (lib/blanks).
// Pure and deterministic: the blank seed comes from the question id, so every learner gets the same blanks for the
// same question and the same trace. If anything goes wrong or no blank is found, the paragraphs are joined
// without blanks. If even that would not be read back as the same paragraphs, the content is "" and the caller
// falls back to the stored content.
import { applyBlanks } from "../blanks/apply";
import { proposeBlanks } from "../blanks/propose";

/** The seed is this prefix plus the question id. DRAFT, like the generator. */
export const BLANK_SEED_PREFIX = "question-";

export interface PageContent {
  /** "" when the paragraphs cannot be shown safely (the caller then uses the stored content). */
  content: string;
  blankCount: number;
}

export const blankSeedFor = (questionId: number): string => `${BLANK_SEED_PREFIX}${questionId}`;

export function traceToPageContent(paragraphs: string[], questionId: number): PageContent {
  const clean = paragraphs.filter((paragraph) => paragraph.trim() !== "");
  // "$$" or "BLANK(" inside a paragraph would be read by the page as structure: never show such text as it is
  if (clean.length === 0 || clean.some((paragraph) => paragraph.includes("$$") || /blank\(/i.test(paragraph))) {
    return { content: "", blankCount: 0 };
  }
  const plain = clean.join("$$");

  try {
    const best = proposeBlanks(clean, { seed: blankSeedFor(questionId) }); // the best candidate per paragraph
    const blankCount = best.reduce((n, list) => n + list.length, 0);
    if (blankCount === 0) return { content: plain, blankCount: 0 };
    return { content: applyBlanks(clean, best), blankCount };
  } catch {
    return { content: plain, blankCount: 0 };
  }
}
