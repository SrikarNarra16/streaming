import { describe, expect, it, vi } from "vitest";

// If blank generation throws, the plain paragraphs are used.
vi.mock("../blanks/propose", () => ({
  proposeBlanks: () => {
    throw new Error("boom");
  },
}));

import { traceToPageContent } from "./to-page-content";

describe("traceToPageContent when the generator throws", () => {
  it("uses the paragraphs without blanks", () => {
    expect(traceToPageContent(["First paragraph.", "Second paragraph."], 1)).toEqual({ content: "First paragraph.$$Second paragraph.", blankCount: 0 });
  });
});
