// Proposes where fill-in-the-blanks could go in a trace. Pure and deterministic: no network, no AI.
//
// DRAFT: the rules, the ranking and every constant below are first guesses to be tuned with the professor's
// criteria. Nothing here is a final decision about what is worth asking a learner.
//
// A candidate is a piece of one paragraph: paragraph.slice(start, end) === answer. Candidates come from five
// small rules (see the comments at each rule), must pass validateBlank, are ranked by KIND_PRIORITY, and ties
// are broken by a hash of the seed so the same input and seed always give the same result.
import { findGiveAway } from "./giveaway";
import { answerWords, validateBlank } from "./validate";

export type BlankKind = "number" | "condition" | "update" | "complexity" | "term";

export interface BlankCandidate {
  answer: string;
  start: number;
  end: number;
  kind: BlankKind;
  /** A short fixed explanation of why this piece is a candidate. */
  reason: string;
  /** The answer has an operator or comparison character, so grading (exact) may fail on different spacing. */
  spacingSensitive: boolean;
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
  /** Allow the same answer text (case-insensitive) in more than one paragraph of the trace. Default false. */
  allowRepeatAcrossParagraphs?: boolean;
  /** Allow "term" candidates that are in GENERIC_TERMS. Default false. */
  allowGenericTerms?: boolean;
  /** Allow candidates whose answer has an operator character (see SPACING_SENSITIVE). Default false. */
  includeSpacingSensitive?: boolean;
}

/** What was left out on purpose, counted over candidates that were otherwise acceptable. */
export interface ProposeStats {
  heldBackSpacingSensitive: number;
  heldBackGenericTerms: number;
  heldBackGiveAway: number;
}

export interface ProposeResult {
  candidates: BlankCandidate[][];
  stats: ProposeStats;
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
/**
 * Answers with an operator or comparison character (= < > + - * / %) are held back by default, because grading is
 * an exact match and a learner can type "low=mid+1" or "low = mid + 1". Set includeSpacingSensitive to get them.
 * DRAFT: turn this off if grading learns to ignore spacing.
 */
export const HOLD_BACK_SPACING_SENSITIVE = true;
export const SPACING_SENSITIVE = /[=<>+\-*/%]/;
export const isSpacingSensitive = (answer: string) => SPACING_SENSITIVE.test(answer);

/**
 * Words that fit almost any trace, so blanking them tests little ("list", "value", ...). A "term" candidate in this
 * set is excluded unless allowGenericTerms is set. DRAFT: extend when tuning.
 */
export const GENERIC_TERMS: ReadonlySet<string> = new Set([
  "list", "lists", "value", "values", "sorted", "sort", "sorting", "number", "numbers", "array", "arrays",
  "element", "elements", "item", "items", "result", "results", "step", "steps", "example", "examples", "answer",
  "answers", "function", "functions", "input", "output", "index", "indices", "variable", "variables", "code",
  "data", "cell", "cells", "between", "current", "previous", "compare", "compared", "comparing", "difference",
  "return", "returns", "returned", "start", "starts", "whole", "small", "large", "larger", "smaller", "case", "cases",
  "close", "closest", "largest", "smallest", "biggest", "greater", "least", "first", "check", "checks",
]);
/** A capitalised word that starts a sentence ("Check the edge cases.") is more likely a verb than a term. DRAFT. */
export const TERM_SKIP_SENTENCE_START = true;

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
function startsSentenceCapitalised(paragraph: string, at: number, word: string): boolean {
  if (!/^[A-Z][a-z]+$/.test(word)) return false; // identifiers like largest_gap or camelCase are not skipped
  return at === 0 || /[.!?:]\s+$/.test(paragraph.slice(0, at));
}

function termCandidates(paragraph: string, index: number, mentions: Map<string, number>, firstSeen: Map<string, number>): Raw[] {
  const found: Raw[] = [];
  for (const m of paragraph.matchAll(new RegExp(`${NOT_AFTER_WORD}[A-Za-z_][A-Za-z0-9_]{${TERM_MIN_CHARS - 1},}(?![A-Za-z0-9_])`, "g"))) {
    const word = m[0];
    const lower = word.toLowerCase();
    if (TERM_STOPWORDS.has(lower)) continue;
    if (TERM_SKIP_SENTENCE_START && startsSentenceCapitalised(paragraph, m.index!, word)) continue;
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

const emptyStats = (): ProposeStats => ({ heldBackSpacingSensitive: 0, heldBackGenericTerms: 0, heldBackGiveAway: 0 });

interface Pooled {
  c: Raw & { spacingSensitive: boolean };
  index: number;
  priority: number;
  mentions: number;
  tie: number;
}

export function proposeBlanksWithStats(paragraphs: string[], options: ProposeOptions = {}): ProposeResult {
  const max = Math.max(0, Math.floor(options.maxBlanksPerParagraph ?? DEFAULT_MAX_BLANKS_PER_PARAGRAPH));
  const includeCode = options.includeCode ?? false;
  const skipFirst = options.skipFirst ?? true;
  const seed = options.seed ?? 0;
  const allowRepeat = options.allowRepeatAcrossParagraphs ?? false;
  const allowGeneric = options.allowGenericTerms ?? false;
  const includeSensitive = options.includeSpacingSensitive ?? !HOLD_BACK_SPACING_SENSITIVE;
  const { counts: mentions, firstSeen } = countMentions(paragraphs);
  const stats = emptyStats();

  // 1. Every acceptable candidate of every paragraph.
  const pool: Pooled[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (max === 0) return;
    if (skipFirst && index === 0) return;
    if (countWords(paragraph) < MIN_PARAGRAPH_WORDS) return;
    if (!includeCode && isCodeParagraph(paragraph)) return;

    const raw = [
      ...conditionCandidates(paragraph),
      ...updateCandidates(paragraph),
      ...complexityCandidates(paragraph),
      ...numberCandidates(paragraph),
      ...termCandidates(paragraph, index, mentions, firstSeen),
    ];
    for (const c of raw) {
      if (!validateBlank(c.answer, { paragraph }).ok) continue;
      if (findGiveAway(paragraph, c.start, c.end) !== null) {
        stats.heldBackGiveAway++;
        continue;
      }
      if (c.kind === "term" && !allowGeneric && GENERIC_TERMS.has(c.answer.toLowerCase())) {
        stats.heldBackGenericTerms++;
        continue;
      }
      const spacingSensitive = c.kind === "condition" || c.kind === "update" || isSpacingSensitive(c.answer);
      if (spacingSensitive && !includeSensitive) {
        stats.heldBackSpacingSensitive++;
        continue;
      }
      pool.push({
        c: { ...c, spacingSensitive },
        index,
        priority: KIND_PRIORITY.indexOf(c.kind),
        mentions: c.kind === "term" ? mentions.get(c.answer.toLowerCase()) ?? 0 : 0,
        tie: tieBreak(seed, index, c),
      });
    }
  });

  // 2. Best first across the whole trace: kind priority, then (for terms) the more often mentioned, then the
  // seeded tie-break. Taking candidates in this order means that when two paragraphs want the same answer text,
  // the one that ranks higher gets it and the other falls to its next candidate.
  pool.sort((a, b) => a.priority - b.priority || b.mentions - a.mentions || a.tie - b.tie || a.index - b.index || a.c.start - b.c.start);

  const candidates: BlankCandidate[][] = paragraphs.map(() => []);
  const usedInTrace = new Set<string>();
  for (const { c, index } of pool) {
    const list = candidates[index];
    if (list.length >= max) continue;
    const text = c.answer.toLowerCase();
    const overlaps = list.some((k) => c.start < k.end && k.start < c.end);
    const sameText = list.some((k) => k.answer.toLowerCase() === text);
    if (overlaps || sameText) continue;
    if (!allowRepeat && usedInTrace.has(text)) continue;
    list.push({ ...c, reason: REASONS[c.kind] });
    usedInTrace.add(text);
  }
  return { candidates, stats };
}

export function proposeBlanks(paragraphs: string[], options: ProposeOptions = {}): BlankCandidate[][] {
  return proposeBlanksWithStats(paragraphs, options).candidates;
}

/** How many words an answer has in the sense the validator uses (exported for the preview). */
export const wordsInAnswer = (answer: string) => answerWords(answer).length;
