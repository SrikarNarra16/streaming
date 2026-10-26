// Give-away check: would the text around a blank already tell the learner the answer?
// Pure. DRAFT: both rules and the constants are first guesses to be tuned with the professor's criteria.
//
// Rule "stem_before":     one of the GIVEAWAY_WORDS_BEFORE words right before the blank has the same stem as a
//                         word of the answer ("the sorted ___" hides "sort..." only on paper).
// Rule "previous_sentence": the answer (its words and symbols, in order, words compared by stem) appears in the
//                         previous sentence of the same paragraph.
// (The whole-paragraph "appears twice" check lives in validateBlank; the second rule is stem-aware, so
// "sorted" in the previous sentence also gives away "sorting".)

/** How many words directly before the blank are compared with the answer. DRAFT. */
export const GIVEAWAY_WORDS_BEFORE = 2;
/** A stem shorter than this is ignored by the "stem_before" rule, and is not cut shorter by suffix removal. DRAFT. */
export const MIN_STEM_CHARS = 3;
/** Longest suffixes first. A very rough stemmer on purpose. DRAFT. */
export const STEM_SUFFIXES: readonly string[] = ["ations", "ation", "ings", "ing", "edly", "ed", "es", "ly", "s"];

export type GiveAwayRule = "stem_before" | "previous_sentence";

const wordPattern = () => new RegExp("[\\p{L}\\p{N}_]+", "gu");
const tokenPattern = () => new RegExp("[\\p{L}\\p{N}_]+|[^\\s\\p{L}\\p{N}_]+", "gu");
const hasLetter = (text: string) => new RegExp("\\p{L}", "u").test(text);

/** The words of a text (letters, digits and underscores), in order. */
export const wordsOf = (text: string): string[] => text.match(wordPattern()) ?? [];

/** Lower-cases the word and cuts one common suffix, if at least MIN_STEM_CHARS characters remain. */
export function stemOf(word: string): string {
  const lower = word.toLowerCase();
  for (const suffix of STEM_SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length - suffix.length >= MIN_STEM_CHARS) return lower.slice(0, lower.length - suffix.length);
  }
  return lower;
}

/** Words and runs of symbols, so "arr[mid] < target" does not match "arr[mid] == target". Words are stemmed. */
const tokensOf = (text: string): string[] => (text.match(tokenPattern()) ?? []).map(stemOf);

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((stem, j) => haystack[i + j] === stem)) return true;
  }
  return false;
}

/** Returns the rule that makes the blank paragraph.slice(start, end) a give-away, or null when it is not. */
export function findGiveAway(paragraph: string, start: number, end: number): GiveAwayRule | null {
  const answer = paragraph.slice(start, end);
  const answerWords = wordsOf(answer);
  if (answerWords.length === 0) return null;
  const prefix = paragraph.slice(0, start);

  // Rule "stem_before"
  const answerStems = new Set(answerWords.map(stemOf).filter((stem) => stem.length >= MIN_STEM_CHARS && hasLetter(stem)));
  const before = wordsOf(prefix).slice(-GIVEAWAY_WORDS_BEFORE).map(stemOf);
  if (before.some((stem) => answerStems.has(stem))) return "stem_before";

  // Rule "previous_sentence"
  const sentences = prefix.split(/[.!?]+\s+/);
  if (sentences.length >= 2) {
    if (containsSequence(tokensOf(sentences[sentences.length - 2]), tokensOf(answer))) return "previous_sentence";
  }
  return null;
}

export const isGiveAway = (paragraph: string, start: number, end: number) => findGiveAway(paragraph, start, end) !== null;
