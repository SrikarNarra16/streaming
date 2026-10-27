import { describe, expect, it } from "vitest";
import { shouldTypeOnResume, type ResumeState } from "./streaming-flow";

const MID_PARAGRAPH: ResumeState = { isWaitingForBlankFill: false, isWaitingForFeedback: false, hasActiveAccordion: false, isAtParagraphEnd: false, isContentComplete: false };

describe("shouldTypeOnResume", () => {
  it("resumes typing when the pause interrupted typing in the middle of a paragraph", () => {
    expect(shouldTypeOnResume(MID_PARAGRAPH)).toBe(true);
  });

  it.each<[string, Partial<ResumeState>]>([
    ["a blank input is shown (or its message is still showing)", { isWaitingForBlankFill: true }],
    ["the feedback box is shown", { isWaitingForFeedback: true }],
    ["the chat accordion is open", { hasActiveAccordion: true }],
    ["the paragraph has ended and the feedback box is on its way", { isAtParagraphEnd: true }],
    ["all the content has been typed", { isContentComplete: true }],
  ])("does not type on when %s", (_name, over) => {
    expect(shouldTypeOnResume({ ...MID_PARAGRAPH, ...over })).toBe(false);
  });

  it("every single waiting state blocks it, and any combination too", () => {
    const keys = Object.keys(MID_PARAGRAPH) as Array<keyof ResumeState>;
    for (let mask = 1; mask < 1 << keys.length; mask++) {
      const state = { ...MID_PARAGRAPH };
      keys.forEach((key, i) => (state[key] = Boolean(mask & (1 << i))));
      expect(shouldTypeOnResume(state), JSON.stringify(state)).toBe(false);
    }
  });
});
