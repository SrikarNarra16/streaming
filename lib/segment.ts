// Turns one long raw reasoning trace (plain text) into learner-sized paragraphs.
// Pure and deterministic: no network, no database, no UI. Words are never rewritten or dropped.
// The only changes to the text are whitespace normalisation (in prose) and the content-safety
// replacements described under "Content safety" below.
//
// Pipeline: normalise -> split into prose blocks and code runs -> split prose into sentences ->
// group sentences into paragraphs -> merge a short tail -> merge a short lead-in ending in a colon with the
// paragraph after it -> wrap unfenced code in a ``` fence -> neutralise `$$` and `BLANK(`.

export interface SegmentOptions {
  /** Close a paragraph at the first sentence boundary at or after this many words (default 40). */
  targetMinWords?: number;
  /** A paragraph never goes over this many words unless one sentence alone is longer (default 80). */
  targetMaxWords?: number;
  /** A single sentence longer than this is split at a clause boundary (default 140). */
  hardMaxWords?: number;
  /** A final prose paragraph shorter than this is merged into the previous one (default 15; 0 turns it off). */
  minTailWords?: number;
}

export const DEFAULT_SEGMENT_OPTIONS = {
  targetMinWords: 40,
  targetMaxWords: 80,
  hardMaxWords: 140,
  minTailWords: 15,
} as const;

export interface SegmentStats {
  /** Words in the normalised input. */
  inputWords: number;
  paragraphs: number;
  /** Paragraphs that are code runs (kept whole). */
  codeParagraphs: number;
  /** Sentences longer than hardMaxWords that were split at a clause or word boundary. */
  longSentencesSplit: number;
  /** Short tails merged into the previous paragraph. */
  tailsMerged: number;
  /** Short lead-in paragraphs ending in a colon merged with the paragraph after them. */
  leadInsMerged: number;
  /** Code runs that the model printed without a fence and that were wrapped in a ``` fence. */
  codeFenced: number;
  /** `$$` replaced by `$ $` (one per `$` that was directly followed by another `$`). */
  dollarReplacements: number;
  /** `BLANK(` (any letter case) replaced by `BLANK (` (the same letters, a space before the parenthesis). */
  blankReplacements: number;
  /** A trailing `$` followed by a space so that it cannot merge with the `$$` separator. */
  trailingDollarGuards: number;
  /** dollarReplacements + blankReplacements + trailingDollarGuards. */
  replacements: number;
}

export interface SegmentResult {
  paragraphs: string[];
  stats: SegmentStats;
}

export interface TraceArtifact {
  text: string;
  index: number;
}

const MIN_CLAUSE_WORDS = 10;

/** A paragraph under this many words that ends in a colon is a lead-in ("Here is the code:") and joins the next one. */
export const LEAD_IN_MAX_WORDS = 8;
/** Flush-left lines that look like code are one code run only from this many lines in a row. */
export const MIN_FLUSH_CODE_LINES = 2;

// Abbreviations after which a full stop does not end a sentence.
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "cf", "fig", "eg", "ie", "approx", "vol", "viz",
]);

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

// ---------------------------------------------------------------------------------------------
// Blocks: prose versus code
// ---------------------------------------------------------------------------------------------

interface Block {
  kind: "prose" | "code";
  lines: string[];
}

const FENCE = /^\s*```/;
const INDENTED = /^(?: {4,}|\t)\S/; // 4+ spaces or a tab, then text
// A flush-left line that opens an indented block (for example "def f(x):") belongs to the code run below it.
const CODE_HEADER = /^\s*(?:def|class|for|while|if|elif|else|try|except|finally|with|async|function)\b.*[:{]\s*$/;

// A flush-left line that looks like a statement. Only a run of MIN_FLUSH_CODE_LINES or more such lines is code.
const ASSIGNMENT = /^[A-Za-z_][\w.]*(?:\[[^\]\n]*\])?\s*(?:[-+*/%]|\/\/)?=(?!=)\s*\S/;
const STATEMENT = /^(?:break|continue|pass|return(?:\s+\S.*)?|raise\s+\S.*|import\s+\S.*|from\s+\S+\s+import\s+\S.*|print\(.*\)|yield\s+\S.*)$/;
const CALL = /^[A-Za-z_][\w.]*\(.*\)$/;

export function looksLikeCodeLine(line: string): boolean {
  const t = line.trim();
  if (t === "" || /[.!?]$/.test(t)) return false; // prose sentences end like this
  return CODE_HEADER.test(t) || ASSIGNMENT.test(t) || STATEMENT.test(t) || CALL.test(t);
}

function toBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const kinds: Array<"prose" | "code"> = lines.map(() => "prose");

  // Fenced blocks (fences included). An unclosed fence runs to the end of the text.
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) {
      kinds[i] = "code";
      inFence = !inFence;
    } else if (inFence) {
      kinds[i] = "code";
    }
  });

  // Runs of indented lines; blank lines between indented lines stay inside the run.
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i] !== "prose" || !INDENTED.test(lines[i])) continue;
    let start = i;
    if (i > 0 && kinds[i - 1] === "prose" && CODE_HEADER.test(lines[i - 1]) && !INDENTED.test(lines[i - 1])) {
      start = i - 1;
    }
    let end = i;
    let j = i + 1;
    while (j < lines.length) {
      if (kinds[j] === "prose" && INDENTED.test(lines[j])) {
        end = j;
        j++;
        continue;
      }
      if (kinds[j] === "prose" && lines[j].trim() === "") {
        let k = j + 1;
        while (k < lines.length && lines[k].trim() === "") k++;
        if (k < lines.length && kinds[k] === "prose" && INDENTED.test(lines[k])) {
          j = k;
          continue;
        }
      }
      break;
    }
    for (let x = start; x <= end; x++) kinds[x] = "code";
    i = end;
  }

  // Flush-left code the model printed without indentation: a run of lines that look like statements.
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i] !== "prose" || !looksLikeCodeLine(lines[i])) continue;
    let end = i;
    while (end + 1 < lines.length && kinds[end + 1] === "prose" && looksLikeCodeLine(lines[end + 1])) end++;
    if (end - i + 1 >= MIN_FLUSH_CODE_LINES) for (let x = i; x <= end; x++) kinds[x] = "code";
    i = end;
  }

  const blocks: Block[] = [];
  lines.forEach((line, i) => {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kinds[i]) last.lines.push(line);
    else blocks.push({ kind: kinds[i], lines: [line] });
  });
  return blocks;
}

// A code run keeps its line breaks and indentation. Only blank lines at its ends are dropped.
function codeText(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end).join("\n").trimEnd();
}

// Code that has no fence gets one, so the page's markdown renderer keeps the line breaks and indentation.
// Code that the model already fenced is left as it is.
function fenced(code: string): { text: string; wrapped: boolean } {
  if (FENCE.test(code.split("\n")[0])) return { text: code, wrapped: false };
  return { text: "```\n" + code + "\n```", wrapped: true };
}

// ---------------------------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------------------------

function splitSentences(prose: string): string[] {
  const sentences: string[] = [];

  // A blank line always ends a sentence. So does a single line break, unless the line ends with a
  // comma or semicolon: reasoning traces use line breaks between thoughts (and for bullets or
  // step-by-step notes without end punctuation); they are not hard-wrapped.
  const pieces = prose.split(/(?<![,;])\n[ \t]*/);

  for (const piece of pieces) {
    const text = piece.replace(/\s+/g, " ").trim();
    if (text === "") continue;

    let sentenceStart = 0;
    const candidates = /[.!?]+["')\]]*(?=\s|$)/g;
    let match: RegExpExecArray | null;
    while ((match = candidates.exec(text)) !== null) {
      const end = match.index + match[0].length;
      if (end >= text.length) break; // the end of the piece closes the last sentence anyway

      // The next sentence has to start like one.
      const next = text.slice(end).trimStart()[0];
      if (!next || !/[A-Z0-9"'(\[`*#$]/.test(next)) continue;

      // Not after an abbreviation such as "e.g.", "i.e.", "Dr." or an initial like "J."
      const before = text.slice(sentenceStart, match.index);
      const token = (before.match(/[\w.'-]*$/)?.[0] ?? "").toLowerCase();
      if (match[0][0] === "." && match[0].length === 1) {
        if (ABBREVIATIONS.has(token) || /^(?:[a-z]\.)+[a-z]$/.test(token) || /^[a-z]$/.test(token)) continue;
      }

      // A bare list number such as "2." is not a sentence.
      const soFar = text.slice(sentenceStart, end).trim();
      if (/^(?:\d+|[A-Za-z])[.)]$/.test(soFar)) continue;

      sentences.push(text.slice(sentenceStart, end).trim());
      sentenceStart = end;
    }
    const rest = text.slice(sentenceStart).trim();
    if (rest !== "") sentences.push(rest);
  }
  return sentences;
}

// ---------------------------------------------------------------------------------------------
// Very long sentences
// ---------------------------------------------------------------------------------------------

// How many words go into the left piece. The last clause boundary before the limit wins:
// after a ";" or ",", or just before " and " / " but ". Without one, cut at the limit.
function findCut(words: string[], hardMax: number): number {
  for (let cut = hardMax; cut >= MIN_CLAUSE_WORDS; cut--) {
    if (/[;,]$/.test(words[cut - 1])) return cut;
    if (cut < words.length && /^(?:and|but)$/i.test(words[cut])) return cut;
  }
  return hardMax;
}

function splitLongSentence(sentence: string, hardMax: number): string[] {
  let words = sentence.split(" ");
  if (words.length <= hardMax) return [sentence];
  const pieces: string[] = [];
  while (words.length > hardMax) {
    const cut = findCut(words, hardMax);
    pieces.push(words.slice(0, cut).join(" "));
    words = words.slice(cut);
  }
  pieces.push(words.join(" "));
  return pieces;
}

/** A short prose paragraph that ends in a colon. */
export function isLeadIn(paragraph: string): boolean {
  const t = paragraph.trim();
  return t.endsWith(":") && !t.includes("\n") && countWords(t) < LEAD_IN_MAX_WORDS;
}

// ---------------------------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------------------------

function groupSentences(sentences: string[], minWords: number, maxWords: number): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  const close = () => {
    if (current.length > 0) paragraphs.push(current.join(" "));
    current = [];
    currentWords = 0;
  };
  for (const sentence of sentences) {
    const words = countWords(sentence);
    if (current.length > 0 && currentWords + words > maxWords) close();
    current.push(sentence);
    currentWords += words;
    if (currentWords >= minWords) close();
  }
  close();
  return paragraphs;
}

// ---------------------------------------------------------------------------------------------
// Content safety
// ---------------------------------------------------------------------------------------------
// The page splits paragraphs on "$$" and treats BLANK(...) (any letter case) as a blank to fill in.
// Reversible in meaning:
//   "$$"     -> "$ $"      every "$" directly followed by another "$" gets a space after it
//   "BLANK(" -> "BLANK ("  same letters, a space before the parenthesis (the page needs "BLANK(" together)
//   a paragraph ending in "$" gets a trailing space, otherwise "$" + the "$$" separator would read as
//   "$$" followed by a stray "$" and move that character into the next paragraph.

function neutralise(paragraph: string, stats: SegmentStats): string {
  let text = paragraph.replace(/\$(?=\$)/g, () => {
    stats.dollarReplacements++;
    return "$ ";
  });
  text = text.replace(/(blank)\(/gi, (_match, letters: string) => {
    stats.blankReplacements++;
    return `${letters} (`;
  });
  if (text.endsWith("$")) {
    stats.trailingDollarGuards++;
    text += " ";
  }
  return text;
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export function segmentTraceWithStats(raw: string, options: SegmentOptions = {}): SegmentResult {
  const o = { ...DEFAULT_SEGMENT_OPTIONS, ...options };
  if (!(o.targetMinWords <= o.targetMaxWords && o.targetMaxWords <= o.hardMaxWords)) {
    throw new RangeError("segment options need targetMinWords <= targetMaxWords <= hardMaxWords");
  }

  const stats: SegmentStats = {
    inputWords: 0,
    paragraphs: 0,
    codeParagraphs: 0,
    longSentencesSplit: 0,
    tailsMerged: 0,
    leadInsMerged: 0,
    codeFenced: 0,
    dollarReplacements: 0,
    blankReplacements: 0,
    trailingDollarGuards: 0,
    replacements: 0,
  };

  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text === "") return { paragraphs: [], stats };
  stats.inputWords = countWords(text);

  const entries: Array<{ text: string; code: boolean }> = [];
  for (const block of toBlocks(text)) {
    if (block.kind === "code") {
      const code = codeText(block.lines);
      if (code !== "") {
        const { text: fencedCode, wrapped } = fenced(code);
        entries.push({ text: fencedCode, code: true });
        stats.codeParagraphs++;
        if (wrapped) stats.codeFenced++;
      }
      continue;
    }

    const sentences = splitSentences(block.lines.join("\n")).flatMap((sentence) => {
      const pieces = splitLongSentence(sentence, o.hardMaxWords);
      if (pieces.length > 1) stats.longSentencesSplit++;
      return pieces;
    });
    const grouped = groupSentences(sentences, o.targetMinWords, o.targetMaxWords);

    // A short final paragraph joins the one before it (only prose paragraphs of this block, and
    // only if the result still fits hardMaxWords).
    if (grouped.length >= 2) {
      const tail = grouped[grouped.length - 1];
      const previous = grouped[grouped.length - 2];
      // (a lead-in such as "Here is the code:" is kept for the paragraph after it, see below)
      if (!isLeadIn(tail) && countWords(tail) < o.minTailWords && countWords(previous) + countWords(tail) <= o.hardMaxWords) {
        grouped.splice(grouped.length - 2, 2, `${previous} ${tail}`);
        stats.tailsMerged++;
      }
    }
    entries.push(...grouped.map((paragraph) => ({ text: paragraph, code: false })));
  }

  // A short lead-in ending in a colon belongs with what follows it (a blank line separates it from a code run).
  const paragraphs: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    let current = entries[i];
    while (!current.code && isLeadIn(current.text) && i + 1 < entries.length) {
      const next = entries[++i];
      current = { text: current.text + (next.code ? "\n\n" : " ") + next.text, code: next.code };
      stats.leadInsMerged++;
    }
    paragraphs.push(current.text);
  }

  const safe = paragraphs.map((p) => neutralise(p, stats));
  stats.paragraphs = safe.length;
  stats.replacements = stats.dollarReplacements + stats.blankReplacements + stats.trailingDollarGuards;
  return { paragraphs: safe, stats };
}

export function segmentTrace(raw: string, options?: SegmentOptions): string[] {
  return segmentTraceWithStats(raw, options).paragraphs;
}

/** Joins paragraphs with "$$", the paragraph separator the streaming page already uses. */
export function toContent(paragraphs: string[]): string {
  return paragraphs.join("$$");
}

// "Desired oververbosity 5" style notes that DeepSeek traces sometimes contain, including the
// misspellings seen in saved traces (overbrev, oververbose). Detection only: nothing is removed.
const ARTIFACT = /\b(?:desired\s+)?over(?:verb|brev)\w*\s*\d+\b/gi;

export function findTraceArtifacts(raw: string): TraceArtifact[] {
  const found: TraceArtifact[] = [];
  for (const match of raw.matchAll(ARTIFACT)) {
    found.push({ text: match[0], index: match.index ?? 0 });
  }
  return found;
}
