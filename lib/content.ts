// Pure content parsing and grading, extracted unchanged from app/streaming/page.tsx.
// Content format: `$$` between paragraphs, BLANK(answer) for fill-in-the-blank markers.

export type ContentToken =
  | { kind: "end" }
  | { kind: "blank"; answer: string; length: number }
  | { kind: "paragraphBreak"; length: number }
  | { kind: "char"; text: string; length: number };

// What the typewriter does next at `position` in `content`. The order of the checks matters:
// end of content, then a BLANK(...) marker, then a `$$` paragraph break, otherwise plain text.
export function nextToken(content: string, position: number, charsPerStep: number = 1): ContentToken {
  // Check for end of content
  if (position >= content.length) {
    return { kind: "end" };
  }

  const remainingText = content.slice(position);

  // Check for BLANK
  const blankMatch = remainingText.match(/^BLANK\(([^)]+)\)/i);
  if (blankMatch) {
    return { kind: "blank", answer: blankMatch[1], length: blankMatch[0].length };
  }

  // Check for paragraph break - Custom paragraph break - $$
  if (remainingText.startsWith("$") && remainingText.charAt(1) == "$") {
    return { kind: "paragraphBreak", length: 2 };
  }

  // Otherwise, type the next chunk
  const chunk = remainingText.slice(0, charsPerStep);
  return { kind: "char", text: chunk, length: chunk.length };
}

export type ContentPart = { type: "text"; text: string } | { type: "blank"; answer: string };

// Walks the whole content with nextToken and groups it the way the page does: a `$$` ends the
// current paragraph (even an empty one); a trailing paragraph is kept only if it has any parts.
export function parseContent(content: string): ContentPart[][] {
  const paragraphs: ContentPart[][] = [];
  let current: ContentPart[] = [];
  let position = 0;

  for (;;) {
    const token = nextToken(content, position);
    if (token.kind === "end") break;
    position += token.length;

    if (token.kind === "paragraphBreak") {
      paragraphs.push(current);
      current = [];
    } else if (token.kind === "blank") {
      current.push({ type: "blank", answer: token.answer });
    } else {
      const last = current[current.length - 1];
      if (last && last.type === "text") last.text += token.text;
      else current.push({ type: "text", text: token.text });
    }
  }

  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}

// Only the learner's input is trimmed; the stored answer is compared as written (lower-cased).
export function isBlankAnswerCorrect(userInput: string, correctAnswer: string): boolean {
  return userInput.trim().toLowerCase() === correctAnswer.toLowerCase();
}
