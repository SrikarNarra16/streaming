// Proposes where fill-in-the-blanks could go in a trace. Pure and deterministic: no network, no AI.
//
// DRAFT: the rules, the ranking and every constant below are first guesses to be tuned with the professor's
// criteria. Nothing here is a final decision about what is worth asking a learner.
//
// A candidate is a piece of one paragraph: paragraph.slice(start, end) === answer. Candidates come from five
// small rules (see the comments at each rule), must pass validateBlank, are ranked by KIND_PRIORITY, and ties
// are broken by a hash of the seed so the same input and seed always give the same result.
import { answerWords, validateBlank } from "./validate";

export type BlankKind = "number" | "condition" | "update" | "complexity" | "term";

export interface BlankCandidate {
  answer: string;
  start: number;
  end: number;
  kind: BlankKind;
  /** A short fixed explanation of why this piece is a candidate. */
  reason: string;
}

export interface ProposeOptions {
  /** At most this many non-overlapping candidates per paragraph. Default 1. */
  maxBlanksPerParagraph?: number;
  /** Also look in code paragraphs (they are skipped by default). */
  includeCode?: boolean;
  /** Skip the first paragraph (usually the problem restated). Default true. */
  skipFirst?: boolean;
  /** Breaks ties between equally ranked candidates deterministically. Default 0. */
  seed?: number | string;
}

/** Best first. DRAFT: conditions and updates test the algorithm, numbers and terms are easier. */
export const KIND_PRIORITY: readonly BlankKind[] = ["condition", "update", "complexity", "number", "term"];
/** A paragraph with fewer words than this gets no blank. DRAFT. */
export const MIN_PARAGRAPH_WORDS = 15;
export const DEFAULT_MAX_BLANKS_PER_PARAGRAPH = 1;
/** A term must be mentioned at least this many times in the whole trace (and once in its own paragraph). DRAFT. */
export const TERM_MIN_MENTIONS = 2;
/** Terms shorter than this are ignored. DRAFT. */
export const TERM_MIN_CHARS = 4;
/**
 * A term may only be blanked where the trace has already used it in an EARLIER paragraph, so the learner can
 * recall it. Without this, the first mention of an arbitrary variable name would become a blank nobody can know.
 * DRAFT.
 */
export const TERM_NEEDS_EARLIER_MENTION = true;

/** Frequent words that are not worth a blank even when repeated. DRAFT: extend when tuning. */
export const TERM_STOPWORDS: ReadonlySet<string> = new Set([
  "that", "this", "with", "from", "have", "will", "would", "could", "should", "there", "their", "about", "which",
  "where", "when", "then", "than", "into", "over", "also", "each", "every", "some", "other", "such", "only", "just",
  "like", "make", "made", "need", "needs", "maybe", "first", "second", "third", "next", "last", "case", "good",
  "fine", "work", "works", "take", "taken", "gets", "give", "gives", "here", "what", "same", "more", "most",
  "does", "done", "after", "before", "because", "while", "until", "again", "still", "even", "being", "those",
  "these", "them", "they", "your", "ours", "step", "steps", "think", "thing", "things", "something", "example",
]);

const REASONS: Record<BlankKind, string> = {
  number: "a concrete value in a worked example",
  condition: "a comparison that decides what happens next",
  update: "an assignment that updates a variable",
  complexity: "the growth rate inside a big-O expression",
  term: "a key term that the trace keeps coming back to",
};

// ---- small building blocks for the patterns (built with RegExp(), because they use lookbehind) -----------
const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const INDEX = "(?:\\[[A-Za-z0-9_+\\- ]{1,12}\\])?";
const NUM = "\\d+(?:\\.\\d+)?";
const OPERAND = `(?:${IDENT}${INDEX}|${NUM})`;
const NOT_AFTER_WORD = "(?<![A-Za-z0-9_.\\]])";

export const isCodeParagraph = (paragraph: string) => /^\s*```/.test(paragraph) || paragraph.includes("\n") || /^( {4,}|\t)/.test(paragraph);
const countWords = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

type Raw = Pick<BlankCandidate, "answer" | "start" | "end" | "kind">;

// RULE "number": a numeric value that a variable is set to or that a sentence states, in a worked example:
//   "low=3", "mid == 2"  (identifier, = or ==, number)       the answer is the number
//   "the gap is 14", "gives 1", "returns 0", "equals 6"      the answer is the number
// A number that is followed by more arithmetic ("x = 3 + 1") or glued to letters is not taken.
function numberCandidates(paragraph: string): Raw[] {
  const found: Raw[] = [];
  const assign = new RegExp(`${NOT_AFTER_WORD}(${IDENT}${INDEX}\\s*={1,2}\\s*)(-?${NUM})(?![A-Za-z0-9_]|\\.\\d)(?!\\s*[-+*/%])`, "g");
  const states = new RegExp(`\\b(?:is|are|equals|equal to|gives|giving|returns|becomes)\\s+(-?${NUM})(?![A-Za-z0-9_]|\\.\\d)(?!\\s*[-+*/%])`, "g");
  for (const m of paragraph.matchAll(assign)) {
    const start = m.index! + m[1].length;
    found.push({ answer: m[2], start, end: start + m[2].length, kind: "number" });
  }
  for (const m of paragraph.matchAll(states)) {
    const start = m.index! + m[0].length - m[1].length;
    found.push({ answer: m[1], start, end: start + m[1].length, kind: "number" });
  }
  return found;
}

// RULE "condition": one comparison between two simple operands (an identifier, optionally indexed, or a number),
// with <=, >=, ==, !=, < or >, and at least one identifier. No parentheses, and no arithmetic around it:
//   "low <= high", "arr[mid] < target", "top<=bottom"
function conditionCandidates(paragraph: string): Raw[] {
  const comparison = new RegExp(`${NOT_AFTER_WORD}(${OPERAND}\\s*(?:<=|>=|==|!=|<|>)\\s*${OPERAND})(?![A-Za-z0-9_\\[])(?!\\s*[-+*/%(])`, "g");
  const found: Raw[] = [];
  for (const m of paragraph.matchAll(comparison)) {
    if (!/[A-Za-z_]/.test(m[1])) continue; // "1 < 2" alone is arithmetic, not a condition about the algorithm
    found.push({ answer: m[1], start: m.index!, end: m.index! + m[1].length, kind: "condition" });
  }
  return found;
}

// RULE "update": an assignment (=, +=, -=, *=, /=, %=) to a variable from a simple arithmetic expression
// without parentheses or calls, where for a plain "=" the right side is not just a number (that is the "number" rule):
//   "low = mid + 1", "top += 1", "best = x"
function updateCandidates(paragraph: string): Raw[] {
  const arithmetic = `(?:\\s*(?:\\+|-|\\*|//|/|%)\\s*${OPERAND})*`;
  const assignment = new RegExp(
    `(?<![A-Za-z0-9_.\\]=!<>])(${IDENT}${INDEX}\\s*(?:\\+|-|\\*|/|%)?=\\s*(${OPERAND}${arithmetic}))(?![A-Za-z0-9_\\[(=])`,
    "g"
  );
  const found: Raw[] = [];
  for (const m of paragraph.matchAll(assignment)) {
    const augmented = /[-+*/%]=/.test(m[1]);
    if (!augmented && new RegExp(`^${NUM}$`).test(m[2])) continue; // "x = 5": the number rule handles it; "top += 1" is an update
    found.push({ answer: m[1], start: m.index!, end: m.index! + m[1].length, kind: "update" });
  }
  return found;
}

// RULE "complexity": the inside of a big-O expression, with the parentheses left outside the blank:
//   "O(log n)" -> "log n", "O(n log n)" -> "n log n"
function complexityCandidates(paragraph: string): Raw[] {
  const found: Raw[] = [];
  for (const m of paragraph.matchAll(/\bO\(([^()]{1,30})\)/g)) {
    const inner = m[1];
    const lead = inner.length - inner.trimStart().length;
    const answer = inner.trim();
    if (answer === "") continue;
    const start = m.index! + 2 + lead;
    found.push({ answer, start, end: start + answer.length, kind: "complexity" });
  }
  return found;
}

// RULE "term": a word of at least TERM_MIN_CHARS characters that is not a common word and is mentioned at least
// TERM_MIN_MENTIONS times in the whole trace, and that already appeared in an earlier paragraph (see
// TERM_NEEDS_EARLIER_MENTION). (validateBlank then rejects it if it appears twice in its own paragraph, so it
// is mentioned once here and elsewhere in the trace.)
function termCandidates(paragraph: string, index: number, mentions: Map<string, number>, firstSeen: Map<string, number>): Raw[] {
  const found: Raw[] = [];
  for (const m of paragraph.matchAll(new RegExp(`${NOT_AFTER_WORD}[A-Za-z_][A-Za-z0-9_]{${TERM_MIN_CHARS - 1},}(?![A-Za-z0-9_])`, "g"))) {
    const word = m[0];
    const lower = word.toLowerCase();
    if (TERM_STOPWORDS.has(lower)) continue;
    if ((mentions.get(lower) ?? 0) < TERM_MIN_MENTIONS) continue;
    if (TERM_NEEDS_EARLIER_MENTION && (firstSeen.get(lower) ?? index) >= index) continue; // first used here: nobody can recall it
    found.push({ answer: word, start: m.index!, end: m.index! + word.length, kind: "term" });
  }
  return found;
}

/** Whole-word, case-insensitive mentions of every word in the whole trace, and the paragraph where each first appears. */
function countMentions(paragraphs: string[]): { counts: Map<string, number>; firstSeen: Map<string, number> } {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  paragraphs.forEach((paragraph, index) => {
    for (const m of paragraph.matchAll(new RegExp(`${NOT_AFTER_WORD}[A-Za-z_][A-Za-z0-9_]*(?![A-Za-z0-9_])`, "g"))) {
      const lower = m[0].toLowerCase();
      counts.set(lower, (counts.get(lower) ?? 0) + 1);
      if (!firstSeen.has(lower)) firstSeen.set(lower, index);
    }
  });
  return { counts, firstSeen };
}

// FNV-1a, for a stable tie-break that depends only on the seed and the candidate.
function tieBreak(seed: number | string, paragraphIndex: number, c: Raw): number {
  let hash = 0x811c9dc5;
  for (const ch of `${seed}|${paragraphIndex}|${c.start}|${c.answer}`) {
    hash ^= ch.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function proposeBlanks(paragraphs: string[], options: ProposeOptions = {}): BlankCandidate[][] {
  const max = Math.max(0, Math.floor(options.maxBlanksPerParagraph ?? DEFAULT_MAX_BLANKS_PER_PARAGRAPH));
  const includeCode = options.includeCode ?? false;
  const skipFirst = options.skipFirst ?? true;
  const seed = options.seed ?? 0;
  const { counts: mentions, firstSeen } = countMentions(paragraphs);

  return paragraphs.map((paragraph, index) => {
    if (max === 0) return [];
    if (skipFirst && index === 0) return [];
    if (countWords(paragraph) < MIN_PARAGRAPH_WORDS) return [];
    if (!includeCode && isCodeParagraph(paragraph)) return [];

    const raw = [
      ...conditionCandidates(paragraph),
      ...updateCandidates(paragraph),
      ...complexityCandidates(paragraph),
      ...numberCandidates(paragraph),
      ...termCandidates(paragraph, index, mentions, firstSeen),
    ];
    const valid = raw.filter((c) => validateBlank(c.answer, { paragraph }).ok);

    // Best first: kind priority, then (for terms) the more often mentioned, then the seeded tie-break.
    const ranked = valid
      .map((c) => ({ c, priority: KIND_PRIORITY.indexOf(c.kind), mentions: c.kind === "term" ? mentions.get(c.answer.toLowerCase()) ?? 0 : 0, tie: tieBreak(seed, index, c) }))
      .sort((a, b) => a.priority - b.priority || b.mentions - a.mentions || a.tie - b.tie || a.c.start - b.c.start)
      .map((x) => x.c);

    // Keep the best ones that do not overlap each other (or repeat the same text).
    const chosen: BlankCandidate[] = [];
    for (const c of ranked) {
      if (chosen.length >= max) break;
      const overlaps = chosen.some((k) => c.start < k.end && k.start < c.end);
      const sameText = chosen.some((k) => k.answer.toLowerCase() === c.answer.toLowerCase());
      if (overlaps || sameText) continue;
      chosen.push({ ...c, reason: REASONS[c.kind] });
    }
    return chosen;
  });
}

/** How many words an answer has in the sense the validator uses (exported for the preview). */
export const wordsInAnswer = (answer: string) => answerWords(answer).length;
