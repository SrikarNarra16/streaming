import { describe, expect, it } from "vitest";
import { segmentTrace } from "../segment";
import { SAMPLE_REASONING, SAMPLE_STEPS } from "../trace/sample-trace";
import { BINARY_SEARCH_TRACE, SPIRAL_MATRIX_TRACE } from "./fixtures";
import { COMPLEXITY_NEVER_BLANKED, GENERIC_TERMS, NEGATIVE_NUMBERS_ARE_SPACING_SAFE, HOLD_BACK_SPACING_SENSITIVE, isCodeParagraph, isSpacingSensitive, KIND_PRIORITY, MIN_PARAGRAPH_WORDS, proposeBlanks, proposeBlanksWithStats, type BlankCandidate, type ProposeOptions } from "./propose";
import { validateBlank } from "./validate";

// A first paragraph (skipped by default) that is long enough, and filler so a paragraph reaches 15 words.
const INTRO = "We need a function that searches a sorted list for a target value and tells us where the target is located inside the list.";
const FILL = "and nothing else in this sentence matters for the example we are discussing here today";

// Candidates for the SECOND paragraph, with the first one in front of it. Spacing-sensitive kinds (conditions,
// updates) are held back by default, so most tests switch them on; the default has its own tests below.
const second = (paragraph: string, options: ProposeOptions = {}) => proposeBlanks([INTRO, paragraph], { includeSpacingSensitive: true, ...options })[1];
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
    // no update candidate can hide the number here (the parentheses rule the update out)
    const q = `We then compute x = 3 * (a + b) at every step of the loop over the data ${FILL}.`;
    expect(second(q, { maxBlanksPerParagraph: 5 })).toEqual([]);
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
    const on = { includeSpacingSensitive: true };
    const [first, secondList] = proposeBlanks([P, P], on);
    expect(first).toEqual([]);
    expect(secondList.length).toBe(1);
    expect(proposeBlanks([P, P], { ...on, skipFirst: false, allowRepeatAcrossParagraphs: true })[0].length).toBe(1);
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

describe("trace-wide uniqueness", () => {
  const A = `The loop keeps going while low <= high, because the target could still be somewhere between the two ends of the range.`;
  const B = `Later on we again test low <= high, because the target could still be somewhere between the two ends of the range.`;
  const on = { includeSpacingSensitive: true };

  it("never chooses the same answer text (any case) in two paragraphs", () => {
    const lists = proposeBlanks([INTRO, A, B], { ...on, maxBlanksPerParagraph: 3 });
    const texts = lists.flat().map((c) => c.answer.toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.filter((t) => t === "low <= high")).toHaveLength(1);
  });

  it("the other paragraph falls to its next candidate", () => {
    const lists = proposeBlanks([INTRO, A, B], { ...on, maxBlanksPerParagraph: 1 });
    expect(lists[1].length + lists[2].length).toBe(2);
    expect(lists.flat().map((c) => c.answer).sort()).not.toEqual(["low <= high", "low <= high"]);
    expect(lists.flat().filter((c) => c.answer === "low <= high")).toHaveLength(1);
  });

  it("allowRepeatAcrossParagraphs lifts the rule", () => {
    const lists = proposeBlanks([INTRO, A, B], { ...on, allowRepeatAcrossParagraphs: true });
    expect(lists[1][0].answer).toBe("low <= high");
    expect(lists[2][0].answer).toBe("low <= high");
  });

  it("is deterministic: the same seed gives the same winner", () => {
    expect(proposeBlanks([INTRO, A, B], { ...on, seed: 5 })).toEqual(proposeBlanks([INTRO, A, B], { ...on, seed: 5 }));
  });
});

describe("generic terms", () => {
  const TRACE = [
    INTRO,
    "We keep going through the sorted list and the values in it, and the trace talks about gaps between neighbours all the time.",
    "Again the sorted list and the values in it matter here, and the gaps between neighbours are what the answer is built from.",
  ];

  it("keeps the documented generic words", () => {
    for (const w of ["list", "value", "values", "sorted", "number", "numbers", "array", "element", "elements", "item", "items", "result", "step", "steps", "example", "answer", "function", "input", "output"]) {
      expect(GENERIC_TERMS.has(w)).toBe(true);
    }
  });

  it("excludes them by default and counts them as held back", () => {
    const { candidates, stats } = proposeBlanksWithStats(TRACE, { maxBlanksPerParagraph: 9 });
    const picked = candidates.flat().map((c) => c.answer.toLowerCase());
    for (const w of ["list", "values", "sorted"]) expect(picked).not.toContain(w);
    expect(picked).toContain("gaps");
    expect(stats.heldBackGenericTerms).toBeGreaterThan(0);
  });

  it("allowGenericTerms brings them back", () => {
    const picked = proposeBlanks(TRACE, { maxBlanksPerParagraph: 9, allowGenericTerms: true }).flat().map((c) => c.answer.toLowerCase());
    expect(picked).toEqual(expect.arrayContaining(["sorted"]));
  });

  it("a capitalised sentence-start word is not taken as a term, an identifier is", () => {
    const trace = [INTRO, "First we sketch things. Gaps are what we need to find, and the gaps between neighbours are the whole point of it.", "Gaps matter so we store gaps_seen for each step and we also report gaps_seen at the end of the whole run."];
    const picked = proposeBlanks(trace, { maxBlanksPerParagraph: 9 }).flat().map((c) => c.answer);
    expect(picked).not.toContain("Gaps");
  });
});

describe("spacing-sensitive answers", () => {
  const P = `The loop keeps going while low <= high, and when it is too small we set low = mid + 1 and the cost is O(log n) in total here.`;

  it("is on by default as a named constant", () => {
    expect(HOLD_BACK_SPACING_SENSITIVE).toBe(true);
  });

  it("knows which answers are sensitive", () => {
    for (const a of ["low <= high", "low=mid+1", "m*n", "n + m", "a/b", "x%2", "a<b", "a>b", "a==b", "a-b", "- 1", "--1", "-x", "1-2"]) expect(isSpacingSensitive(a)).toBe(true);
    for (const a of ["log n", "n log n", "0", "mid", "largest_gap", "arr[mid]"]) expect(isSpacingSensitive(a)).toBe(false);
    for (const a of ["-1", "-3", "-3.5", "-100"]) expect(isSpacingSensitive(a)).toBe(false); // a leading minus on a number is spacing-safe
    expect(NEGATIVE_NUMBERS_ARE_SPACING_SAFE).toBe(true);
  });

  it("holds conditions and updates back by default, counts them, and gives only safe answers", () => {
    const { candidates, stats } = proposeBlanksWithStats([INTRO, P], { maxBlanksPerParagraph: 9 });
    expect(candidates[1].map((c) => c.kind)).not.toContain("condition");
    expect(candidates[1].map((c) => c.kind)).not.toContain("update");
    expect(candidates[1].map((c) => c.answer)).toContain("log n");
    expect(stats.heldBackSpacingSensitive).toBe(2);
    for (const c of candidates.flat()) {
      expect(c.spacingSensitive).toBe(false);
      expect(c.answer).not.toMatch(/[=<>+\-*/%]/);
    }
  });

  it("includeSpacingSensitive returns them, marked spacingSensitive: true", () => {
    const { candidates, stats } = proposeBlanksWithStats([INTRO, P], { maxBlanksPerParagraph: 9, includeSpacingSensitive: true });
    const kinds = candidates[1].map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["condition", "update", "complexity"]));
    for (const c of candidates[1].filter((x) => x.kind === "condition" || x.kind === "update")) expect(c.spacingSensitive).toBe(true);
    expect(candidates[1].find((c) => c.kind === "complexity")?.spacingSensitive).toBe(false);
    expect(stats.heldBackSpacingSensitive).toBe(0);
  });

  it("an answer with an operator is held back even when it is not a condition or update (m*n, -1)", () => {
    const text = `Every cell is visited exactly once, so the running time is O(m*n) where m is the number of rows and n the number of columns.`;
    expect(second(text, { includeSpacingSensitive: false }).map((c) => c.answer)).not.toContain("m*n");
    expect(second(text).map((c) => c.answer)).toContain("m*n");
  });
});

describe("give-away rule inside the proposer", () => {
  // "partition" is used before and again here, but the two words before it are "partitioned and": a give-away.
  const TRACE = [
    "We split the work with partition here and the plan is simple and short enough to read quickly at all.",
    "Here we partitioned and partition the data again and again until every piece is small enough to handle directly without more work.",
  ];

  it("does not blank a word whose stem is in the two words before it, and counts it as held back", () => {
    const { candidates, stats } = proposeBlanksWithStats(TRACE, { skipFirst: false, maxBlanksPerParagraph: 9 });
    expect(candidates.flat().map((c) => c.answer)).not.toContain("partition");
    expect(stats.heldBackGiveAway).toBeGreaterThanOrEqual(1);
  });

  it("the same word is fine when nothing around it gives it away", () => {
    const fine = [TRACE[0], "Here we split the data and then partition it again and again until every piece is small enough to handle directly."];
    expect(proposeBlanks(fine, { skipFirst: false, maxBlanksPerParagraph: 9 }).flat().map((c) => c.answer)).toContain("partition");
  });
});

describe("hand-written fixtures", () => {
  const words = (t: string) => t.trim().split(/\s+/).length;
  const paragraphsOf = (t: string) => segmentTrace(t);
  const answersOf = (t: string, o: ProposeOptions = {}) => proposeBlanks(paragraphsOf(t), { maxBlanksPerParagraph: 9, ...o }).flat();

  it("are realistic in size and contain the pieces the rules look for", () => {
    expect(words(BINARY_SEARCH_TRACE)).toBeGreaterThan(220);
    expect(words(BINARY_SEARCH_TRACE)).toBeLessThan(330);
    for (const piece of ["low", "high", "mid", "arr[mid] < target", "low = mid + 1", "O(log n)"]) expect(BINARY_SEARCH_TRACE).toContain(piece);
    for (const piece of ["top <= bottom", "left <= right", "top += 1", "right -= 1", "O(m*n)"]) expect(SPIRAL_MATRIX_TRACE).toContain(piece);
  });

  it("binary search with includeSpacingSensitive false: nothing with an operator, but the complexity and a number", () => {
    const list = answersOf(BINARY_SEARCH_TRACE);
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) expect(c.answer).not.toMatch(/[=<>+*/%]|(?!^-\d)-/); // only a leading minus on a number is allowed
    expect(list.map((c) => c.answer)).toEqual(expect.arrayContaining(["log n", "-1"]));
    expect(list.find((c) => c.answer === "-1")).toMatchObject({ kind: "number", spacingSensitive: false });
  });

  it("binary search with includeSpacingSensitive true: conditions and updates appear, each answer once", () => {
    const list = answersOf(BINARY_SEARCH_TRACE, { includeSpacingSensitive: true });
    const kinds = list.map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["condition", "update"]));
    expect(list.map((c) => c.answer)).toEqual(expect.arrayContaining(["arr[mid] < target"]));
    const texts = list.map((c) => c.answer.toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
    expect(answersOf(BINARY_SEARCH_TRACE, { includeSpacingSensitive: true, allowRepeatAcrossParagraphs: true }).length).toBeGreaterThanOrEqual(list.length);
  });

  it("spiral matrix: m*n is held back by default and offered with includeSpacingSensitive", () => {
    expect(answersOf(SPIRAL_MATRIX_TRACE).map((c) => c.answer)).not.toContain("m*n");
    const all = answersOf(SPIRAL_MATRIX_TRACE, { includeSpacingSensitive: true });
    expect(all.map((c) => c.answer)).toEqual(expect.arrayContaining(["m*n", "top <= bottom"]));
    expect(all.map((c) => c.answer.toLowerCase())).toContain("right -= 1");
  });

  it("never places a blank in the first paragraph, and applies and round trips", async () => {
    const { applyBlanks } = await import("./apply");
    for (const trace of [BINARY_SEARCH_TRACE, SPIRAL_MATRIX_TRACE]) {
      const paragraphs = paragraphsOf(trace);
      for (const includeSpacingSensitive of [false, true]) {
        const best = proposeBlanks(paragraphs, { includeSpacingSensitive });
        expect(best[0]).toEqual([]);
        expect(() => applyBlanks(paragraphs, best)).not.toThrow();
      }
    }
  });
});

describe("negative numbers and O(1)", () => {
  it('"-1" is proposed with spacing-sensitive filtering on, and is marked spacingSensitive: false', () => {
    const p = `An empty array returns -1 at once, and a single element works because the range holds exactly one place ${FILL}.`;
    const [c] = second(p, { includeSpacingSensitive: false });
    expect(c).toMatchObject({ kind: "number", answer: "-1", spacingSensitive: false });
    expect(p.slice(c.start, c.end)).toBe("-1");
    expect(proposeBlanksWithStats([INTRO, p]).stats.heldBackSpacingSensitive).toBe(0);
  });

  it("O(1) is never proposed, whatever the options, while O(n) and O(log n) still are", () => {
    expect(COMPLEXITY_NEVER_BLANKED.has("1")).toBe(true);
    const p = `The running time is fine and the extra space is O(1) because we only keep a few variables around ${FILL}.`;
    for (const options of [{}, { includeSpacingSensitive: true, allowGenericTerms: true, allowRepeatAcrossParagraphs: true, maxBlanksPerParagraph: 9 }]) {
      expect(second(p, options).filter((c) => c.kind === "complexity")).toEqual([]);
      expect(second(p, options).map((c) => c.answer)).not.toContain("1");
    }
    expect(second(`The running time is O(n) because we walk the data once and the extra space is small ${FILL}.`)[0]).toMatchObject({ kind: "complexity", answer: "n" });
  });

  it("with two complexities in a paragraph only the non-trivial one is proposed", () => {
    const p = `Each step halves the range, so the time is O(log n) and the extra space is O(1) in the end ${FILL}.`;
    expect(second(p, { maxBlanksPerParagraph: 5 }).filter((c) => c.kind === "complexity").map((c) => c.answer)).toEqual(["log n"]);
  });
});
