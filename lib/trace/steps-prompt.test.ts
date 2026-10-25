import { describe, expect, it } from "vitest";
import {
  buildStepsPrompt,
  STEPS_PROMPT_INTRO,
  STEPS_PROMPT_QUESTION_LABEL,
  STEPS_PROMPT_RULES,
  STEPS_WORD_TARGET,
} from "./steps-prompt";

const QUESTION = "Write a Python function spiral_order(matrix) that returns the elements of an m x n matrix in spiral order.";

describe("buildStepsPrompt", () => {
  it("includes the question text, at the end", () => {
    const prompt = buildStepsPrompt(QUESTION);
    expect(prompt).toContain(QUESTION);
    expect(prompt.endsWith(QUESTION)).toBe(true);
    expect(prompt).toContain(`${STEPS_PROMPT_QUESTION_LABEL}\n${QUESTION}`);
  });

  it("trims whitespace around the question but keeps its inner line breaks", () => {
    expect(buildStepsPrompt("  line one\n\nline two \n")).toMatch(/line one\n\nline two$/);
  });

  it("states the word targets", () => {
    expect(STEPS_WORD_TARGET).toEqual({ min: 300, max: 400 });
    const prompt = buildStepsPrompt(QUESTION);
    expect(prompt).toContain("300 to 400 words");
  });

  it("asks for step-by-step thinking, short explanations, a worked example, code at the end and plain paragraphs", () => {
    const prompt = buildStepsPrompt(QUESTION);
    expect(prompt).toContain("step by step");
    expect(prompt).toContain("one to three sentences");
    expect(prompt).toContain("worked example with concrete values");
    expect(prompt).toContain("Finish with the code");
    expect(prompt).toContain("paragraphs separated by blank lines");
    expect(prompt).toMatch(/Do not use headings, bullet points or bold text/);
  });

  it("is built only from the exported constants plus the question", () => {
    const expectedInstructions = [STEPS_PROMPT_INTRO, ...STEPS_PROMPT_RULES].join(" ");
    expect(buildStepsPrompt(QUESTION)).toBe(`${expectedInstructions}\n\n${STEPS_PROMPT_QUESTION_LABEL}\n${QUESTION}`);
  });

  it("does not add a system-style preamble or markdown of its own", () => {
    const instructions = buildStepsPrompt(QUESTION).split("\n\n")[0];
    expect(instructions).not.toMatch(/[*#`]|^- /m);
  });
});
