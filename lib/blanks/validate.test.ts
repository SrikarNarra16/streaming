import { describe, expect, it } from "vitest";
import { answerWords, COMMON_WORDS, countOccurrences, MAX_ANSWER_CHARS, MAX_ANSWER_WORDS, validateBlank, type BlankValidation } from "./validate";

const PARAGRAPH = "The loop stops when low <= high is false, and then mid is used to compare arr[mid] with the target value in the list.";

// [answer, paragraph, expected ok, expected reason]
const TABLE: Array<[string, string, boolean, BlankValidation["reason"]]> = [
  // accepted
  ["log n", "Each step halves the range, so the running time is O(log n) for a list of any size.", true, "ok"],
  ["low <= high", PARAGRAPH, true, "ok"],
  ["arr[mid]", PARAGRAPH, true, "ok"],
  ["low = mid + 1", "We move the left end with low = mid + 1 and check again.", true, "ok"],
  ["mid", "A midpoint is not the same thing as mid, which we use once.", true, "ok"], // "midpoint" is not a whole-word match
  ["3", "The value 13 is large and 3 is small.", true, "ok"], // "13" does not count as 3
  ["is mid", "We say is mid once.", true, "ok"], // not all words are common
  ["naïve", "A naïve approach would compare everything.", true, "ok"],
  ["x".repeat(MAX_ANSWER_CHARS), "Here is one very long identifier " + "x".repeat(MAX_ANSWER_CHARS) + " in a sentence.", true, "ok"],
  ["one two three four", "We need one two three four steps here.", true, "ok"],
  // empty and trimming
  ["", PARAGRAPH, false, "empty"],
  ["   ", PARAGRAPH, false, "empty"],
  ["\t\n", PARAGRAPH, false, "empty"],
  [" mid", PARAGRAPH, false, "not_trimmed"],
  ["mid ", PARAGRAPH, false, "not_trimmed"],
  [" low <= high ", PARAGRAPH, false, "not_trimmed"],
  // text the page's parser or paragraph splitter would misread
  ["f(x)", PARAGRAPH, false, "forbidden_text"],
  ["high)", PARAGRAPH, false, "forbidden_text"],
  ["a$$b", PARAGRAPH, false, "forbidden_text"],
  ["$$", PARAGRAPH, false, "forbidden_text"],
  ["BLANK(x", PARAGRAPH, false, "forbidden_text"],
  ["blank(x", PARAGRAPH, false, "forbidden_text"],
  ["two\nlines", PARAGRAPH, false, "forbidden_text"],
  ["two\rlines", PARAGRAPH, false, "forbidden_text"],
  // too long to type
  ["x".repeat(MAX_ANSWER_CHARS + 1), PARAGRAPH, false, "too_long"],
  ["one two three four five", PARAGRAPH, false, "too_many_words"],
  // the same text twice in the paragraph
  ["mid", "We use mid here and mid there.", false, "repeated_in_paragraph"],
  ["Mid", "We use mid here and MID there.", false, "repeated_in_paragraph"], // case-insensitive
  ["3", "The gaps are 3, 3 and 3.", false, "repeated_in_paragraph"],
  ["[mid]", "We read x[mid] first and later y[mid] again.", false, "repeated_in_paragraph"], // no word boundary needed at a symbol
  ["low <= high", "Check low <= high, then check low <= high again.", false, "repeated_in_paragraph"],
  // very common words
  ["the", "We use the value.", false, "common_word"],
  ["The", "We use the value.", false, "common_word"],
  ["a", "We use a value.", false, "common_word"],
  ["is", "It is.", false, "common_word"],
  ["to", "Go to it.", false, "common_word"],
  ["and", "x and y.", false, "common_word"],
  ["we", "so we go.", false, "common_word"],
  ["then", "x then y.", false, "common_word"],
  ["is a", "It is a test.", false, "common_word"], // every word is common
  // purely punctuation
  ["...", PARAGRAPH, false, "only_punctuation"],
  ["<=", PARAGRAPH, false, "only_punctuation"],
  ["+-*", PARAGRAPH, false, "only_punctuation"],
  ["=", "a = b", false, "only_punctuation"],
];

describe("validateBlank", () => {
  it.each(TABLE)("%j in %j -> ok: %s (%s)", (answer, paragraph, ok, reason) => {
    expect(validateBlank(answer, { paragraph })).toEqual({ ok, reason });
  });

  it("has the documented draft limits", () => {
    expect(MAX_ANSWER_CHARS).toBe(40);
    expect(MAX_ANSWER_WORDS).toBe(4);
  });

  it("does not count symbols such as = and + as words", () => {
    expect(answerWords("low = mid + 1")).toEqual(["low", "mid", "1"]);
    expect(answerWords("a <= b")).toEqual(["a", "b"]);
    expect(validateBlank("low = mid + 1", { paragraph: "We set low = mid + 1 now." }).ok).toBe(true);
  });

  it("keeps a short constant list of common words", () => {
    for (const word of ["the", "a", "an", "is", "to", "of", "and", "we", "it", "so", "then"]) expect(COMMON_WORDS.has(word)).toBe(true);
    expect(COMMON_WORDS.size).toBeLessThan(200);
  });
});

describe("countOccurrences", () => {
  it("is case-insensitive and whole-word for answers that start and end with a word character", () => {
    expect(countOccurrences("mid", "mid Mid MID midpoint amid")).toBe(3);
    expect(countOccurrences("3", "3 13 31 3.5 3")).toBe(3); // "3" in "3.5" is a whole number part
    expect(countOccurrences("arr[mid]", "arr[mid] and arr[mid]")).toBe(2);
  });

  it("does not need a word boundary next to a symbol", () => {
    expect(countOccurrences("<=", "a<=b and c <= d")).toBe(2);
  });
});
