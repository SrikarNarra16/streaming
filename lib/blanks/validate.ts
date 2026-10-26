// Is this text acceptable as the answer of a fill-in-the-blank?
//
// DRAFT: every number and word list below is a judgement value to be tuned with the professor's criteria.
//
// The page marks a blank as BLANK(answer). Its parser (lib/content.ts) takes everything up to the FIRST ")" as
// the answer, matches the marker in any letter case, and compares the learner's trimmed input with the stored
// answer as written (lower-cased). That is why an answer may not contain ")", "$$" or "BLANK(", may not have
// spaces around it, and may not be empty.

/** An answer longer than this many characters is too long to type. DRAFT. */
export const MAX_ANSWER_CHARS = 40;
/** An answer with more words than this is too long to type. Only tokens with a letter or digit count as words. DRAFT. */
export const MAX_ANSWER_WORDS = 4;

/**
 * Very common words. A blank on one of these is either trivial to guess or impossible to tell apart, and it
 * would match all over the paragraph. DRAFT list: extend or shorten it when tuning.
 */
export const COMMON_WORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "am",
  "to", "of", "and", "or", "but", "nor", "so", "then", "than", "that", "this", "these", "those",
  "we", "it", "its", "he", "she", "they", "you", "i", "me", "my", "our", "your", "their", "them", "us",
  "in", "on", "at", "for", "with", "as", "by", "from", "into", "onto", "over", "under", "up", "down", "out",
  "if", "not", "no", "yes", "can", "will", "would", "should", "could", "may", "might", "must", "shall",
  "do", "does", "did", "done", "has", "have", "had", "having",
  "there", "here", "what", "which", "who", "whom", "when", "where", "how", "why",
  "also", "just", "only", "too", "very", "more", "most", "all", "any", "each", "every", "both", "some", "such",
  "about", "after", "before", "because", "while", "until", "once", "again", "now", "still", "even",
]);

export type BlankRejection =
  | "empty"
  | "not_trimmed"
  | "forbidden_text"
  | "too_long"
  | "too_many_words"
  | "repeated_in_paragraph"
  | "common_word"
  | "only_punctuation";

export interface BlankValidation {
  ok: boolean;
  /** "ok", or why the answer was rejected. */
  reason: "ok" | BlankRejection;
}

export interface BlankContext {
  /** The paragraph the blank would go into (its plain text, before any blank is inserted). */
  paragraph: string;
}

const WORD_CHAR = "[\\p{L}\\p{N}_]";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Counts the places where `answer` occurs in `paragraph`, ignoring case. If the answer starts or ends with a
 *  word character, the match must not touch another word character there (whole-word match). */
export function countOccurrences(answer: string, paragraph: string): number {
  const start = new RegExp(`^${WORD_CHAR}`, "u").test(answer) ? `(?<!${WORD_CHAR})` : "";
  const end = new RegExp(`${WORD_CHAR}$`, "u").test(answer) ? `(?!${WORD_CHAR})` : "";
  return (paragraph.match(new RegExp(`${start}${escapeRegExp(answer)}${end}`, "giu")) ?? []).length;
}

/** Whitespace-separated tokens that contain a letter or a digit (an "=" or "+" on its own is not a word). */
export function answerWords(answer: string): string[] {
  return answer.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token));
}

export function validateBlank(answer: string, context: BlankContext): BlankValidation {
  const reject = (reason: BlankRejection): BlankValidation => ({ ok: false, reason });

  if (answer.trim() === "") return reject("empty");
  if (answer !== answer.trim()) return reject("not_trimmed");
  if (answer.includes(")") || answer.includes("$$") || /blank\(/i.test(answer) || /[\r\n]/.test(answer)) return reject("forbidden_text");
  if (!/[\p{L}\p{N}]/u.test(answer)) return reject("only_punctuation");
  if (answer.length > MAX_ANSWER_CHARS) return reject("too_long");
  const words = answerWords(answer);
  if (words.length > MAX_ANSWER_WORDS) return reject("too_many_words");
  if (words.every((word) => COMMON_WORDS.has(word.toLowerCase()))) return reject("common_word");
  if (countOccurrences(answer, context.paragraph) > 1) return reject("repeated_in_paragraph");
  return { ok: true, reason: "ok" };
}
