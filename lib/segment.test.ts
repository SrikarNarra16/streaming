import { describe, expect, it } from "vitest";
import { parseContent } from "./content";
import { findTraceArtifacts, isLeadIn, segmentTrace, segmentTraceWithStats, toContent } from "./segment";
import { SAMPLE_REASONING, SAMPLE_STEPS } from "./trace/sample-trace";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (s: string) => (s.trim() === "" ? 0 : s.trim().split(/\s+/).length);

// "Alpha1 alpha2 ... alphaN." with a capital first letter, n words long
const sentence = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => (i === 0 ? `${tag.toUpperCase()}1` : `${tag}${i + 1}`)).join(" ") + ".";

// every sentence becomes its own paragraph and no tail is merged: lets us look at sentence splitting alone
const PER_SENTENCE = { targetMinWords: 1, targetMaxWords: 500, hardMaxWords: 500, minTailWords: 0 };

describe("basic shapes", () => {
  it("returns no paragraphs for empty or whitespace-only input", () => {
    expect(segmentTrace("")).toEqual([]);
    expect(segmentTrace("  \n\r\n \t ")).toEqual([]);
  });

  it("keeps a single short sentence as one paragraph", () => {
    expect(segmentTrace("  We need a function.  ")).toEqual(["We need a function."]);
  });

  it("rejects options that do not fit together", () => {
    expect(() => segmentTrace("x", { targetMinWords: 90, targetMaxWords: 80 })).toThrow(RangeError);
  });
});

describe("sentence splitting", () => {
  it("does not break on abbreviations, decimals, versions, file names or dots in code", () => {
    const text =
      "Use e.g. a list here. Pi is about 3.14 in this case. See main.py for the details. " +
      "Dr. Smith uses v1.2.3 every day. Call np.maximum(a, b) next. Is it ready? Yes! Done.";
    expect(segmentTrace(text, PER_SENTENCE)).toEqual([
      "Use e.g. a list here.",
      "Pi is about 3.14 in this case.",
      "See main.py for the details.",
      "Dr. Smith uses v1.2.3 every day.",
      "Call np.maximum(a, b) next.",
      "Is it ready?",
      "Yes!",
      "Done.",
    ]);
  });

  it("does not break on i.e. or after a bare list number", () => {
    expect(segmentTrace("That is, i.e. the same one. 2. Next item follows.", PER_SENTENCE)).toEqual([
      "That is, i.e. the same one.",
      "2. Next item follows.",
    ]);
    // a number that ends a real sentence still ends it
    expect(segmentTrace("Pick option 2. Then go on.", PER_SENTENCE)).toEqual(["Pick option 2.", "Then go on."]);
  });

  it("ends a sentence at a line break, except after a trailing comma or semicolon", () => {
    expect(segmentTrace("top=0,bottom=2\ntop row 1,2,3 top=1\nright col 6,9", PER_SENTENCE)).toEqual([
      "top=0,bottom=2",
      "top row 1,2,3 top=1",
      "right col 6,9",
    ]);
    expect(segmentTrace("first part,\nsecond part;\nthird part", PER_SENTENCE)).toEqual([
      "first part, second part; third part",
    ]);
  });

  it("ends a sentence at a blank line and before list items", () => {
    expect(segmentTrace("First part without a full stop\n\nSecond part", PER_SENTENCE)).toEqual([
      "First part without a full stop",
      "Second part",
    ]);
    expect(segmentTrace("Items:\n- one two three.\n- four five six.", PER_SENTENCE)).toEqual([
      "Items: - one two three.", // the short lead-in joins the paragraph after it
      "- four five six.",
    ]);
  });
});

describe("grouping into paragraphs", () => {
  it("closes a paragraph at the first sentence boundary after targetMinWords", () => {
    const text = [sentence(25, "a"), sentence(25, "b"), sentence(25, "c"), sentence(25, "d")].join(" ");
    expect(segmentTrace(text).map(words)).toEqual([50, 50]);
  });

  it("never goes over targetMaxWords by adding a sentence", () => {
    const text = [sentence(30, "a"), sentence(60, "b"), sentence(30, "c"), sentence(30, "d")].join(" ");
    const result = segmentTrace(text);
    expect(result.map(words)).toEqual([30, 60, 60]);
    expect(Math.max(...result.map(words))).toBeLessThanOrEqual(80);
  });

  it("lets a single sentence longer than targetMaxWords stand alone", () => {
    expect(segmentTrace(sentence(100, "long")).map(words)).toEqual([100]);
  });
});

describe("short tail", () => {
  it("merges a final prose paragraph under 15 words into the previous one", () => {
    const result = segmentTrace(`${sentence(45, "a")} ${sentence(8, "b")}`);
    expect(result.map(words)).toEqual([53]);
  });

  it("keeps a tail of 15 words or more as its own paragraph", () => {
    expect(segmentTrace(`${sentence(45, "a")} ${sentence(20, "b")}`).map(words)).toEqual([45, 20]);
  });

  it("does not merge a tail into a code run", () => {
    const raw = "```\nx = 1\n```\nAll done here.";
    expect(segmentTrace(raw)).toEqual(["```\nx = 1\n```", "All done here."]);
  });

  it("does not merge when the result would pass hardMaxWords", () => {
    const { paragraphs, stats } = segmentTraceWithStats(sentence(290, "z"));
    expect(paragraphs.map(words)).toEqual([140, 140, 10]);
    expect(stats.tailsMerged).toBe(0);
  });
});

describe("code runs", () => {
  it("keeps a fenced block whole, as its own paragraph, closing the prose before it", () => {
    const fence = "```python\ndef f(x):\n    return x + 1.5\n```";
    const raw = `We write the helper first. It is short.\n${fence}\nThen we call it.`;
    expect(segmentTrace(raw)).toEqual(["We write the helper first. It is short.", fence, "Then we call it."]);
  });

  it("keeps an indented run whole, including its leading indentation", () => {
    const raw = "The plan is simple.\n    a = 1\n    b = 2\n\n    c = a + b\nThat is all.";
    expect(segmentTrace(raw)).toEqual(["The plan is simple.", "```\n    a = 1\n    b = 2\n\n    c = a + b\n```", "That is all."]);
  });

  it("includes a flush-left 'def ...:' header line in the code run below it", () => {
    const raw = "Here is the function.\ndef f(x):\n    return x\nDone.";
    expect(segmentTrace(raw)).toEqual(["Here is the function.", "```\ndef f(x):\n    return x\n```", "Done."]);
  });

  it("keeps a code run longer than hardMaxWords whole", () => {
    const code = Array.from({ length: 30 }, () => "    total = total + value * 2 + offset").join("\n");
    const result = segmentTrace(`Look at this.\n${code}`);
    expect(result).toEqual(["Look at this.", "```\n" + code + "\n```"]);
    expect(words(result[1])).toBeGreaterThan(140);
  });

  it("treats an unclosed fence as code to the end", () => {
    expect(segmentTrace("Start here.\n```\nx = 1\ny = 2")).toEqual(["Start here.", "```\nx = 1\ny = 2"]);
  });
});

describe("very long sentences", () => {
  it("splits at the last comma before hardMaxWords", () => {
    const longSentence =
      Array.from({ length: 200 }, (_, i) => (i % 50 === 49 ? `w${i},` : `w${i}`)).join(" ") + ".";
    const { paragraphs, stats } = segmentTraceWithStats(longSentence);
    expect(paragraphs.map(words)).toEqual([100, 100]);
    expect(stats.longSentencesSplit).toBe(1);
  });

  it("splits just before ' and ' when that is the last clause boundary", () => {
    const parts = Array.from({ length: 150 }, (_, i) => (i === 119 ? "and" : `w${i}`));
    const result = segmentTrace(parts.join(" ") + ".");
    expect(result.map(words)).toEqual([119, 31]);
    expect(result[1].startsWith("and ")).toBe(true);
  });

  it("splits at a word boundary when there is no clause boundary", () => {
    const result = segmentTrace(Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ") + ".");
    expect(result.map(words)).toEqual([140, 60]);
  });
});

describe("content safety", () => {
  it("neutralises $$ and BLANK( (any case) and counts the replacements", () => {
    const { paragraphs, stats } = segmentTraceWithStats("Costs $$5 and BLANK(x) or blank(y) or Blank(z) here.");
    expect(paragraphs).toEqual(["Costs $ $5 and BLANK (x) or blank (y) or Blank (z) here."]);
    expect(stats).toMatchObject({ dollarReplacements: 1, blankReplacements: 3, trailingDollarGuards: 0, replacements: 4 });
  });

  it("leaves no $$ behind, even for $$$ and longer runs", () => {
    const { paragraphs, stats } = segmentTraceWithStats("a $$$ b $$$$ c");
    expect(paragraphs[0]).not.toContain("$$");
    expect(paragraphs[0]).toBe("a $ $ $ b $ $ $ $ c");
    expect(stats.dollarReplacements).toBe(5);
  });

  it("guards a trailing $ so it cannot merge with the $$ separator", () => {
    const { paragraphs, stats } = segmentTraceWithStats("The price is $");
    expect(paragraphs).toEqual(["The price is $ "]);
    expect(stats.trailingDollarGuards).toBe(1);
  });

  it("produces content that the page parser reads back as the same plain-text paragraphs", () => {
    const raw =
      "Costs $$5 and BLANK(x) here. " + "Filler words go here ".repeat(10) + "and the price is $$$ now. " +
      "More filler follows ".repeat(10) + "and ends with a $";
    const paragraphs = segmentTrace(raw, { targetMinWords: 10, targetMaxWords: 20 });
    expect(paragraphs.length).toBeGreaterThan(2);
    const parsed = parseContent(toContent(paragraphs));
    expect(parsed).toHaveLength(paragraphs.length);
    parsed.forEach((parts, i) => {
      expect(parts.every((p) => p.type === "text")).toBe(true);
      expect(parts.map((p) => (p.type === "text" ? p.text : "")).join("")).toBe(paragraphs[i]);
    });
  });
});

describe("line endings and the no-words-lost property", () => {
  it("treats Windows and old Mac line endings like \\n", () => {
    const unix = "First line.\n\nSecond line here.\n    code = 1\nLast words.";
    const windows = unix.replace(/\n/g, "\r\n");
    const oldMac = unix.replace(/\n/g, "\r");
    expect(segmentTrace(windows)).toEqual(segmentTrace(unix));
    expect(segmentTrace(oldMac)).toEqual(segmentTrace(unix));
    expect(segmentTrace(windows).join("")).not.toContain("\r");
  });

  const fixtures: Record<string, string> = {
    prose: `${sentence(45, "a")} ${sentence(30, "b")}\n\n${sentence(55, "c")} ${sentence(9, "d")}`,
    fenced: "We start. It is short.\n```python\nfor i in range(3):\n    print(i)\n```\nThen we end. Really.",
    indented: "Plan:\n    a = 1\n    b = 2\nDone with it, e.g. now. Dr. Who agrees at 3.5 percent.",
    oversized: Array.from({ length: 300 }, (_, i) => (i % 70 === 69 ? `w${i};` : `w${i}`)).join(" ") + ".",
    artifacts: "Need a short answer. Desired oververbosity 5. But the user wants code.",
    windows: "One two three.\r\nFour five six.\r\n\r\nSeven eight nine.",
  };
  for (const [name, raw] of Object.entries(fixtures)) {
    it(`loses no words: ${name}`, () => {
      const result = segmentTrace(raw);
      expect(result.length).toBeGreaterThan(0);
      // the only added text is the ``` fence around code that had none
      expect(norm(result.join(" ").replace(/```/g, ""))).toBe(norm(raw.replace(/```/g, "")));
    });
  }
});

describe("toContent", () => {
  it("joins paragraphs with $$", () => {
    expect(toContent(["a", "b", "c"])).toBe("a$$b$$c");
    expect(toContent(["only"])).toBe("only");
    expect(toContent([])).toBe("");
  });
});

describe("findTraceArtifacts (detects only, never removes)", () => {
  it("finds oververbosity-style notes, including the misspellings seen in saved traces", () => {
    const raw = "Need code. Desired oververbosity 5. Maybe. Oververbosity 5. Also overbrev 5 and oververbose 5.";
    expect(findTraceArtifacts(raw).map((a) => a.text)).toEqual([
      "Desired oververbosity 5",
      "Oververbosity 5",
      "overbrev 5",
      "oververbose 5",
    ]);
  });

  it("reports the index of each match", () => {
    const raw = "abc Desired oververbosity 5 end";
    const [hit] = findTraceArtifacts(raw);
    expect(raw.slice(hit.index, hit.index + hit.text.length)).toBe(hit.text);
    expect(hit.index).toBe(4);
  });

  it("does not flag ordinary words that start with 'over'", () => {
    expect(findTraceArtifacts("An overview 3 steps long. We went over 5 items. Overbought 2 times.")).toEqual([]);
  });

  it("leaves the text in the segmented output", () => {
    const raw = "Need a short answer. Desired oververbosity 5. But the user wants code.";
    expect(segmentTrace(raw).join(" ")).toContain("Desired oververbosity 5");
    expect(findTraceArtifacts(raw)).toHaveLength(1);
  });
});

describe("stats", () => {
  it("reports words, paragraphs and code paragraphs", () => {
    const { stats } = segmentTraceWithStats(`${sentence(45, "a")}\n    x = 1\n${sentence(45, "b")}`);
    expect(stats).toMatchObject({ inputWords: 45 + 3 + 45, paragraphs: 3, codeParagraphs: 1, replacements: 0 });
  });
});

describe("code without a fence", () => {
  it("wraps the sample trace's indented code block in a fence and keeps its indentation", () => {
    const paragraphs = segmentTrace(SAMPLE_REASONING);
    const code = paragraphs.filter((p) => p.startsWith("```"));
    expect(code).toEqual(["```\ndef largest_gap(nums):\n    if len(nums) < 2:\n        return 0\n    ordered = sorted(nums)\n    best = 0\n    for i in range(1, len(ordered)):\n        best = max(best, ordered[i] - ordered[i - 1])\n    return best\n```"]);
    expect(segmentTraceWithStats(SAMPLE_REASONING).stats).toMatchObject({ codeParagraphs: 1, codeFenced: 1 });
  });

  it("fences a flush-left run of statements (two or more lines)", () => {
    const raw = "We set the pointers like this.\nlow = 0\nhigh = len(arr) - 1\nThen we loop.";
    expect(segmentTrace(raw)).toEqual(["We set the pointers like this.", "```\nlow = 0\nhigh = len(arr) - 1\n```", "Then we loop."]);
    const raw2 = "The update.\nif arr[mid] < target:\nlow = mid + 1\nelse:\nhigh = mid - 1\nDone here.";
    expect(segmentTrace(raw2)[1]).toBe("```\nif arr[mid] < target:\nlow = mid + 1\nelse:\nhigh = mid - 1\n```");
    const raw3 = "Loop below.\nfor i in range(1, len(ordered)):\n    best = max(best, ordered[i] - ordered[i - 1])\nAnd return it.";
    expect(segmentTrace(raw3)[1]).toBe("```\nfor i in range(1, len(ordered)):\n    best = max(best, ordered[i] - ordered[i - 1])\n```");
  });

  it("does not fence a single code-like line, prose, or lines that end like sentences", () => {
    for (const raw of [
      "We set x first.\nlow = 0\nThen we think about it for a while.",
      "The gap is 3.\nThen we continue with the next pair of numbers.\nThe answer is 3 in the end.",
      "x = 3 is the start.\ny = 4 is the end.",
      "Keep going while the range is not empty\nand then return the best value so far",
    ]) {
      expect(segmentTrace(raw).some((p) => p.includes("```"))).toBe(false);
    }
  });

  it("leaves a block the model already fenced as it is (no second fence)", () => {
    const fence = "```python\nlow = 0\nhigh = 5\n```";
    expect(segmentTrace(`Look.\n${fence}\nDone.`)).toEqual(["Look.", fence, "Done."]);
    expect(segmentTraceWithStats(`Look.\n${fence}\nDone.`).stats.codeFenced).toBe(0);
  });

  it("is idempotent for its own output and loses no words", () => {
    const once = segmentTrace(SAMPLE_REASONING);
    const twice = segmentTrace(once.join("\n\n"));
    expect(twice).toEqual(once);
    expect(norm(once.join(" ").replace(/```/g, ""))).toBe(norm(SAMPLE_REASONING));
  });

  it("the fenced paragraph reads back through the page's parser as one plain paragraph", () => {
    const paragraphs = segmentTrace(SAMPLE_REASONING);
    const parsed = parseContent(toContent(paragraphs));
    expect(parsed).toHaveLength(paragraphs.length);
    const codeIndex = paragraphs.findIndex((p) => p.startsWith("```"));
    expect(parsed[codeIndex]).toEqual([{ type: "text", text: paragraphs[codeIndex] }]);
  });
});

describe("short lead-in paragraphs ending in a colon", () => {
  it("merges a lead-in under 8 words with the paragraph after it", () => {
    expect(segmentTrace("Here is the idea:\n\nSort the list first and then compare each pair of neighbours.", PER_SENTENCE)).toEqual([
      "Here is the idea: Sort the list first and then compare each pair of neighbours.",
    ]);
    expect(segmentTraceWithStats("Steps:\n\nSort it.", PER_SENTENCE).stats.leadInsMerged).toBe(1);
  });

  it("merges with a code paragraph after it, with a blank line between", () => {
    expect(segmentTrace("Here is the whole function:\n    a = 1\n    b = 2")).toEqual(["Here is the whole function:\n\n```\n    a = 1\n    b = 2\n```"]);
  });

  it("keeps the lead-in for the next paragraph instead of merging it backwards as a short tail", () => {
    const long = sentence(45, "a");
    // the lead-in would be a short tail of the prose block, which is normally merged backwards
    expect(segmentTrace(`${long}\n\nNow the code:\n    a = 1\n    b = 2`)).toEqual([long, "Now the code:\n\n```\n    a = 1\n    b = 2\n```"]);
  });

  it("handles a lead-in chain and a lead-in at the very end", () => {
    expect(segmentTrace("First:\n\nThen:\n\nBody of the text here.", PER_SENTENCE)).toEqual(["First: Then: Body of the text here."]);
    expect(segmentTrace("Some text is here.\n\nThe end:", PER_SENTENCE)).toEqual(["Some text is here.", "The end:"]);
  });

  it("leaves a colon inside a longer paragraph, and a lead-in of 8 or more words, untouched", () => {
    const long = "There is one more thing to check here: the list may be empty or hold a single value only.";
    expect(segmentTrace(`${long}\n\nNext paragraph follows with more words in it.`, PER_SENTENCE)).toEqual([long, "Next paragraph follows with more words in it."]);
    const eight = "We now look at the code like so:";
    expect(words(eight)).toBe(8);
    expect(segmentTrace(`${eight}\n\nThe code comes after this sentence.`, PER_SENTENCE)).toEqual([eight, "The code comes after this sentence."]);
    expect(isLeadIn("Seven words are in this lead in:")).toBe(true);
    expect(isLeadIn("No colon at the end")).toBe(false);
    expect(isLeadIn("a: b is not a lead-in.")).toBe(false);
  });

  it("keeps all words, and the sample steps text still ends in code with its lead-in sentence inside a paragraph", () => {
    const paragraphs = segmentTrace(SAMPLE_STEPS);
    expect(norm(paragraphs.join(" ").replace(/```[a-z]*/g, ""))).toBe(norm(SAMPLE_STEPS.replace(/```[a-z]*/g, "")));
  });
});
