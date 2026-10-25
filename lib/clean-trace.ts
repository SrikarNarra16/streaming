// Removes leaked "Desired oververbosity N" style notes from a raw trace BEFORE segmentation.
// Pure and deterministic. It removes only what findTraceArtifacts matches, and only the smallest unit
// that makes sense (the whole line, the whole sentence, or just the phrase), then fixes the spacing
// and punctuation at the join. Nothing is rewritten or paraphrased, and every removal is returned.
import { findTraceArtifacts } from "./segment";

export interface RemovedArtifact {
  /** The removed text (the artifact plus any punctuation removed with it), trimmed. */
  text: string;
  /** Index of the artifact in the ORIGINAL text. */
  index: number;
  reason: string;
}

export interface CleanTraceResult {
  text: string;
  removed: RemovedArtifact[];
}

const HSPACE = /[ \t]/;

function endOfLine(text: string, from: number): number {
  let i = from;
  while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
  return i;
}

// Removal span for one artifact at [start, end) in `text`.
function removalFor(text: string, start: number, end: number): { from: number; to: number; reason: string } {
  const lineStart = Math.max(text.lastIndexOf("\n", start - 1) + 1, 0);
  const lineEnd = endOfLine(text, end);
  const leftOnLine = text.slice(lineStart, start);
  const rightOnLine = text.slice(end, lineEnd);

  // 1. The artifact is the whole line (optionally with end punctuation): remove the line and its line break.
  if (leftOnLine.trim() === "" && /^[ \t.,;:!?]*$/.test(rightOnLine)) {
    let from = lineStart;
    let to = lineEnd;
    if (text.startsWith("\r\n", to)) to += 2;
    else if (to < text.length) to += 1;
    else if (from > 0) {
      // last line of the text: take the line break before it instead, so no empty line is left
      from -= text[from - 2] === "\r" ? 2 : 1;
    }
    return { from, to, reason: "artifact alone on its line (line removed)" };
  }

  const leftTrimmed = leftOnLine.trimEnd();
  const sentenceStart = leftTrimmed === "" || /[.!?]["')\]]*$/.test(leftTrimmed);
  const rest = text.slice(end);

  // 2. The artifact is a whole sentence: remove it with its end punctuation.
  const punct = /^[.!?]+/.exec(rest)?.[0] ?? "";
  const afterPunct = rest.slice(punct.length);
  const wholeSentence =
    sentenceStart && ((punct !== "" && (afterPunct === "" || /^[ \t\r\n]/.test(afterPunct))) || (punct === "" && /^[ \t]*(\r|\n|$)/.test(rest)));
  if (wholeSentence) {
    let from = start;
    let to = end + punct.length;
    to += /^[ \t]*/.exec(text.slice(to))![0].length;
    // if nothing follows on the line, also drop the space that separated it from the previous sentence
    if (to >= text.length || text[to] === "\n" || text[to] === "\r") {
      while (from > lineStart && HSPACE.test(text[from - 1])) from--;
    }
    return { from, to, reason: "artifact is a whole sentence (sentence removed)" };
  }

  // 3. The artifact starts a longer sentence: remove just the phrase and a comma or semicolon after it.
  if (sentenceStart) {
    const lead = /^[,;]?[ \t]*/.exec(rest)![0].length;
    return { from: start, to: end + lead, reason: "artifact at the start of a sentence (phrase removed)" };
  }

  // 4. The artifact sits inside a sentence: remove just the phrase and fix spacing and commas around it.
  let from = start;
  let to = end;
  const punctAhead = /^[ \t]*([.,;:!?])/.exec(rest);
  if (punctAhead) {
    while (from > lineStart && HSPACE.test(text[from - 1])) from--;
    // ", artifact," -> keep one comma
    if (/[,;]/.test(text[from - 1] ?? "") && /[,;]/.test(punctAhead[1])) to = end + punctAhead[0].length;
  } else {
    to = end + /^[ \t]*/.exec(rest)![0].length;
  }
  return { from, to, reason: "artifact inside a sentence (phrase removed)" };
}

export function cleanTrace(raw: string): CleanTraceResult {
  const matches = findTraceArtifacts(raw);
  const removed: RemovedArtifact[] = [];
  let text = raw;

  // Last match first, so the indexes of earlier matches stay valid.
  for (let i = matches.length - 1; i >= 0; i--) {
    const { index, text: matched } = matches[i];
    const { from, to, reason } = removalFor(text, index, index + matched.length);
    removed.unshift({ text: text.slice(from, to).trim(), index, reason });
    text = text.slice(0, from) + text.slice(to);
  }
  return { text, removed };
}
