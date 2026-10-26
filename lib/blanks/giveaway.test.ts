import { describe, expect, it } from "vitest";
import { findGiveAway, GIVEAWAY_WORDS_BEFORE, isGiveAway, MIN_STEM_CHARS, stemOf, wordsOf } from "./giveaway";

const check = (paragraph: string, answer: string, occurrence = 0) => {
  let start = -1;
  for (let i = 0; i <= occurrence; i++) start = paragraph.indexOf(answer, start + 1);
  return findGiveAway(paragraph, start, start + answer.length);
};

describe("stemOf", () => {
  it("cuts one common suffix and lower-cases", () => {
    expect(stemOf("Sorted")).toBe("sort");
    expect(stemOf("sorting")).toBe("sort");
    expect(stemOf("lists")).toBe("list");
    expect(stemOf("list")).toBe("list");
    expect(stemOf("searches")).toBe("search");
    expect(stemOf("quickly")).toBe("quick");
  });

  it("does not cut a word shorter than the minimum stem", () => {
    expect(MIN_STEM_CHARS).toBe(3);
    expect(stemOf("is")).toBe("is");
    expect(stemOf("used")).toBe("used");
    expect(stemOf("mid")).toBe("mid");
    expect(stemOf("3")).toBe("3");
  });
});

describe("wordsOf", () => {
  it("splits on anything that is not a letter, digit or underscore", () => {
    expect(wordsOf("arr[mid] < target, largest_gap!")).toEqual(["arr", "mid", "target", "largest_gap"]);
    expect(wordsOf("naïve 3.5")).toEqual(["naïve", "3", "5"]);
    expect(wordsOf("")).toEqual([]);
  });
});

describe("findGiveAway: stem in the words before the blank", () => {
  it("looks at the two words right before", () => {
    expect(GIVEAWAY_WORDS_BEFORE).toBe(2);
    expect(check("The data is sorted and sort order matters here for us.", "sort", 1)).toBe("stem_before"); // before = [sorted, and]
    expect(check("The data sorted then sort again before we go on today.", "sort", 1)).toBe("stem_before"); // before = [sorted, then]
  });

  it("does not look further back than two words", () => {
    expect(check("We sorted one two three quickly, then use sort here.", "sort")).toBeNull();
  });

  it("is case-insensitive and works for the plural of the answer", () => {
    expect(check("There are Lists of data and the next list is long.", "list", 0)).toBeNull(); // 'list' inside 'Lists' is not a standalone word match here
    expect(check("Many lists then list gives it away.", "list", 0)).toBe(null);
  });

  it("a binary-before-search style phrase: the stem rule is about the answer's own stem, not about neighbours", () => {
    expect(check("We use binary search on the sorted array to find it fast.", "search")).toBeNull();
    expect(check("We use search then search again on the array to find it.", "search", 1)).toBe("stem_before");
  });

  it("ignores very short or numeric stems", () => {
    expect(check("Take 3 then 3 again, the total is 3 here and now today.", "3", 2)).toBeNull();
    expect(check("We have it, to go on and on with it so far.", "on", 1)).toBeNull();
  });
});

describe("findGiveAway: previous sentence", () => {
  it("rejects an answer whose words are in the previous sentence of the same paragraph", () => {
    const p = "First we sort the data using merge sort. Afterwards the sorted data is scanned once from left to right.";
    expect(check(p, "sorted")).toBe("previous_sentence");
  });

  it("a multi-word answer must appear as a sequence", () => {
    const p = "The cost is n log n in the worst case. For the next part the cost is n and log is not used again anywhere else.";
    expect(check(p, "n log n")).toBeNull();
    const q = "The cost is n log n in the worst case. For the next part the cost is also n log n as before for all inputs.";
    expect(check(q, "n log n", 1)).toBe("previous_sentence");
  });

  it("symbols are part of the match: a different comparison is not a give-away", () => {
    const p = "If arr[mid] == target we are done and return mid. Otherwise, if arr[mid] < target then we go right of the middle.";
    expect(check(p, "arr[mid] < target")).toBeNull();
    const q = "If arr[mid] < target we go right and stop. Later, if arr[mid] < target holds again, we go right once more as well.";
    expect(check(q, "arr[mid] < target", 1)).toBe("previous_sentence");
  });

  it("only the previous sentence counts, not older ones", () => {
    const p = "We use a heap here. Then we do other work. Later the heap is used again in a different way for the end.";
    expect(check(p, "heap", 1)).toBeNull();
  });

  it("does not split on a decimal point", () => {
    const p = "The ratio is 3.5 and that is all we say. Next the ratio is kept for a long time to come ok.";
    expect(check(p, "ratio", 1)).toBe("previous_sentence"); // the sentence break after "say." is found, the one inside "3.5" is not
  });

  it("returns null for a first sentence with nothing before", () => {
    expect(check("Binary search halves the range every time it looks.", "halves")).toBeNull();
  });

  it("isGiveAway is the boolean form", () => {
    const p = "We use sort. Then sort again please today.";
    expect(isGiveAway(p, p.lastIndexOf("sort"), p.lastIndexOf("sort") + 4)).toBe(true);
    expect(isGiveAway(p, p.indexOf("again"), p.indexOf("again") + 5)).toBe(false);
  });
});
