import { describe, expect, it } from "vitest";
import { segmentTrace } from "../segment";
import { SAMPLE_REASONING, SAMPLE_STEPS } from "../trace/sample-trace";
import { isCodeParagraph, KIND_PRIORITY, MIN_PARAGRAPH_WORDS, proposeBlanks, type BlankCandidate, type ProposeOptions } from "./propose";
import { validateBlank } from "./validate";

// A first paragraph (skipped by default) that is long enough, and filler so a paragraph reaches 15 words.
const INTRO = "We need a function that searches a sorted list for a target value and tells us where the target is located inside the list.";
const FILL = "and nothing else in this sentence matters for the example we are discussing here today";

// Candidates for the SECOND paragraph, with the first one in front of it.
const second = (paragraph: string, options: ProposeOptions = {}) => proposeBlanks([INTRO, paragraph], options)[1];
const answers = (list: BlankCandidate[]) => list.map((c) => c.answer);
const wordCount = (text: string) => text.trim().split(/\s+/).length;

describe("candidate kinds", () => {
  it('"number": the 3 in low=3 and the 2 in mid=2', () => {
    const p = `In the first round we have low=3 and mid=2 at the start of the search ${FILL}.`;
    const list = second(p, { maxBlanksPerParagraph: 5 });
    expect(list.map((c) => c.kind)).toEqual(["number", "number"]);
    expect(answers(list).sort()).toEqual(["2", "3"]);
    for (const c of list) expect(p.slice(c.start, c.end)).toBe(c.answer);
  });

  it('"number": a value that a sentence states ("the answer is 14")', () => {
    const p = `After sorting the list we compare the neighbours one by one and the largest gap is 14 ${FILL}.`;
    expect(second(p)).toMatchObject([{ kind: "number", answer: "14" }]);
  });

  it("does not take a number that belongs to more arithmetic, or one that is not a stated value", () => {
    const p = `We set x = 3 + 1 and then we look at the list of 7 values for a while ${FILL}.`;
    expect(second(p, { maxBlanksPerParagraph: 5 }).filter((c) => c.kind === "number")).toEqual([]);
  });

  it('"condition": low <= high', () => {
    const p = `The loop keeps going while low <= high, because the target could still be somewhere between the two ends of the list.`;
    const [c] = second(p);
    expect(c).toMatchObject({ kind: "condition", answer: "low <= high" });
    expect(p.slice(c.start, c.end)).toBe("low <= high");
  });

  it('"condition": arr[mid] < target, and a symbol written without spaces', () => {
    expect(second(`Now we check whether arr[mid] < target holds, since then the answer must lie to the right of the middle position.`)[0]).toMatchObject({ kind: "condition", answer: "arr[mid] < target" });
    expect(second(`The loop ends when top<=bottom is false and then we stop walking around the spiral of numbers in the matrix.`)[0]).toMatchObject({ kind: "condition", answer: "top<=bottom" });
  });

  it("does not make a condition out of partial arithmetic, or of two plain numbers", () => {
    const partial = second(`We keep going while low <= high - 1 holds and then we check the middle element again and again.`, { maxBlanksPerParagraph: 5 });
    expect(partial.filter((c) => c.kind === "condition")).toEqual([]);
    const numbers = second(`We know that 1 < 2 is true and so the first example is fine ${FILL}.`, { maxBlanksPerParagraph: 5 });
    expect(numbers.filter((c) => c.kind === "condition")).toEqual([]);
  });

  it('"update": low = mid + 1', () => {
    const p = `If the middle value is too small we move the left end of the range with low = mid + 1 and then check the new middle again.`;
    const [c] = second(p);
    expect(c).toMatchObject({ kind: "update", answer: "low = mid + 1" });
    expect(p.slice(c.start, c.end)).toBe("low = mid + 1");
  });

  it('"update": an augmented assignment, but not a call or a plain number', () => {
    expect(second(`After the first row we move the boundary with top += 1 and then continue with the right column of the matrix.`)[0]).toMatchObject({ kind: "update", answer: "top += 1" });
    const call = second(`We store the larger value with best = max(best, gap) at every step of the loop over the sorted list ${FILL}.`, { maxBlanksPerParagraph: 5 });
    expect(call.filter((c) => c.kind === "update")).toEqual([]);
    const plain = second(`We start with best = 0 before the loop begins and the list has not been looked at yet ${FILL}.`, { maxBlanksPerParagraph: 5 });
    expect(plain.filter((c) => c.kind === "update")).toEqual([]);
    expect(plain.filter((c) => c.kind === "number").map((c) => c.answer)).toEqual(["0"]);
  });

  it('"complexity": O(log n) gives "log n", not "O(log n)"', () => {
    const p = `Each step halves the range, so the running time is O(log n) which is very fast even for large lists of numbers.`;
    const [c] = second(p);
    expect(c).toMatchObject({ kind: "complexity", answer: "log n" });
    expect(c.answer).not.toContain("O(");
    expect(p.slice(c.start, c.end)).toBe("log n");
    expect(p[c.start - 1]).toBe("("); // the parentheses stay outside the blank
    expect(p[c.end]).toBe(")");
    expect(second(`Sorting the whole list costs O(n log n) in the worst case, which is fine for a short exercise like this one.`)[0].answer).toBe("n log n");
  });

  it('"term": an identifier that was used before and is used once here', () => {
    const trace = [
      INTRO,
      "First we define largest_gap as the routine that reports one number for a collection of numbers given by the person calling it.",
      "Later the result of largest_gap is compared with zero so that an empty collection gives a sensible number back to the person calling it.",
    ];
    const [, first, later] = proposeBlanks(trace, { maxBlanksPerParagraph: 9 });
    expect(answers(first)).not.toContain("largest_gap"); // first use: nobody can recall it yet
    expect(later).toContainEqual(expect.objectContaining({ kind: "term", answer: "largest_gap" }));
  });

  it("does not take a common word, a short word, or a word mentioned only once in the trace", () => {
    const trace = [
      INTRO,
      "This will make the answer easier because there is only one rare zebra mentioned in this whole short text here today.",
      "Then we will also check that this is fine and there is nothing else to do with it for now in the end.",
    ];
    const lists = proposeBlanks(trace, { maxBlanksPerParagraph: 9 });
    expect(answers(lists[1]).concat(answers(lists[2]))).not.toContain("zebra");
    for (const word of ["this", "will", "that", "there", "with"]) {
      expect(answers(lists[2])).not.toContain(word);
    }
  });
});

describe("candidates that the validator rejects are never proposed", () => {
  it("the same word twice in one paragraph", () => {
    const p = `We use low = mid + 1 in one branch and later low = mid + 1 in the other branch of the search over the list ${FILL}.`;
    expect(second(p, { maxBlanksPerParagraph: 9 }).filter((c) => c.answer === "low = mid + 1")).toEqual([]);
  });

  it("a number that appears several times in the paragraph", () => {
    const p = `The gaps are 3, 3 and 3 so the answer is 3 for this small example of a sorted list ${FILL}.`;
    expect(second(p, { maxBlanksPerParagraph: 9 }).filter((c) => c.kind === "number")).toEqual([]);
  });

  it("every proposed candidate passes validateBlank and is exactly its slice of the paragraph", () => {
    const paragraphs = segmentTrace(SAMPLE_REASONING + "\n\n" + SAMPLE_STEPS);
    const all = proposeBlanks(paragraphs, { maxBlanksPerParagraph: 9, includeCode: true, skipFirst: false });
    all.forEach((list, i) => {
      for (const c of list) {
        expect(paragraphs[i].slice(c.start, c.end)).toBe(c.answer);
        expect(validateBlank(c.answer, { paragraph: paragraphs[i] }).ok).toBe(true);
        expect(KIND_PRIORITY).toContain(c.kind);
        expect(c.reason.length).toBeGreaterThan(5);
      }
    });
    expect(all.flat().length).toBeGreaterThan(0);
  });
});

describe("which paragraphs get blanks", () => {
  const P = `The loop keeps going while low <= high, because the target could still be somewhere between the two ends of the list.`;

  it("skips the first paragraph by default, and only then", () => {
    const [first, secondList] = proposeBlanks([P, P]);
    expect(first).toEqual([]);
    expect(secondList.length).toBe(1);
    expect(proposeBlanks([P, P], { skipFirst: false })[0].length).toBe(1);
  });

  it("skips a paragraph under 15 words, and accepts one of exactly 15", () => {
    expect(MIN_PARAGRAPH_WORDS).toBe(15);
    const short = "We loop while low <= high until the target is found there.";
    expect(wordCount(short)).toBeLessThan(15);
    expect(second(short)).toEqual([]);
    const exactly = "We keep looping while low <= high and the target is not found anywhere today.";
    expect(wordCount(exactly)).toBe(15);
    expect(second(exactly).length).toBe(1);
  });

  const CODE = "```python\nwhile low <= high:\n    mid = low + high\n    if arr[mid] < target:\n        low = mid + 1\n    else:\n        high = mid - 1\n```";

  it("skips code paragraphs unless includeCode is true", () => {
    expect(isCodeParagraph(CODE)).toBe(true);
    expect(isCodeParagraph(P)).toBe(false);
    expect(second(CODE)).toEqual([]);
    expect(second(CODE, { includeCode: true })).toMatchObject([{ kind: "condition" }]);
  });

  it("returns one list per paragraph, also for an empty trace and for maxBlanksPerParagraph 0", () => {
    expect(proposeBlanks([])).toEqual([]);
    expect(proposeBlanks([P, P, P], { maxBlanksPerParagraph: 0 })).toEqual([[], [], []]);
    expect(proposeBlanks([P, P, P])).toHaveLength(3);
  });
});

describe("ranking and limits", () => {
  const MIXED = `The loop keeps going while low <= high and when the value is too small we set low = mid + 1 and the cost is O(log n) in total here.`;

  it("ranks by kind: condition, then update, then complexity", () => {
    const list = second(MIXED, { maxBlanksPerParagraph: 5 });
    expect(list.map((c) => c.kind).slice(0, 3)).toEqual(["condition", "update", "complexity"]);
    expect(list.slice(3).every((c) => c.kind === "number" || c.kind === "term")).toBe(true); // easier kinds come last
  });

  it("returns at most maxBlanksPerParagraph, best first, and none overlap", () => {
    expect(second(MIXED).map((c) => c.kind)).toEqual(["condition"]);
    expect(second(MIXED, { maxBlanksPerParagraph: 2 }).map((c) => c.kind)).toEqual(["condition", "update"]);
    const list = second(MIXED, { maxBlanksPerParagraph: 5 });
    for (const a of list) for (const b of list) if (a !== b) expect(a.end <= b.start || b.end <= a.start).toBe(true);
  });
});

describe("determinism", () => {
  const TIE = `In the first round we have low=3 and mid=2 at the start of the search ${FILL}.`;

  it("the same input and seed always give the same result", () => {
    for (const seed of [0, 7, "abc"]) {
      expect(proposeBlanks([INTRO, TIE], { seed, maxBlanksPerParagraph: 2 })).toEqual(proposeBlanks([INTRO, TIE], { seed, maxBlanksPerParagraph: 2 }));
    }
  });

  it("the seed only decides ties: different seeds can pick a different one of two equal candidates", () => {
    const picked = new Set<string>();
    for (let seed = 0; seed < 40; seed++) picked.add(second(TIE, { seed })[0].answer);
    expect([...picked].sort()).toEqual(["2", "3"]);
  });

  it("the seed never changes the kinds that are chosen", () => {
    const kinds = (seed: number) => second(`The loop keeps going while low <= high and low=3 holds ${FILL}.`, { seed, maxBlanksPerParagraph: 3 }).map((c) => c.kind);
    expect(kinds(1)).toEqual(kinds(99));
  });
});

describe("what an answer may contain", () => {
  // a small deterministic generator of awkward paragraphs
  function awkward(count: number): string[] {
    let state = 12345;
    const next = (n: number) => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0), state % n);
    const pieces = ["low <= high", "low = mid + 1", "O(log n)", "$$", "BLANK(x)", "blank (y)", "f(x)", "a)b", "largest_gap", "value", "3", "x = 5", "arr[mid] < target", "\n", " ", "...", "the", "sorted", "mid=2"];
    return Array.from({ length: count }, () => Array.from({ length: 14 + next(10) }, () => pieces[next(pieces.length)]).join(" "));
  }

  it("no answer contains $$, BLANK( or a closing parenthesis, for the samples and for awkward text", () => {
    const sets = [segmentTrace(SAMPLE_REASONING), segmentTrace(SAMPLE_STEPS), awkward(200)];
    for (const paragraphs of sets) {
      const lists = proposeBlanks(paragraphs, { maxBlanksPerParagraph: 5, includeCode: true, skipFirst: false });
      for (const c of lists.flat()) {
        expect(c.answer).not.toContain("$$");
        expect(c.answer).not.toMatch(/blank\(/i);
        expect(c.answer).not.toContain(")");
        expect(c.answer).toBe(c.answer.trim());
        expect(c.answer).not.toMatch(/[\r\n]/);
      }
    }
  });
});
