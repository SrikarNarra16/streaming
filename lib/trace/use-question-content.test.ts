import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useQuestionContent, type UseQuestionContentOptions } from "./use-question-content";

// This repo has no DOM test setup (no jsdom, no React Testing Library), and nothing may be added without asking.
// So the hook is rendered on the server with react-dom/server: that runs the first render of the hook, but not
// its effects. The effect side is covered by a source check below and by the pure selector tests.
const QUESTION = { id: 4, content: "First paragraph.$$Second BLANK(one) paragraph." };

function render(question: typeof QUESTION | null, options: UseQuestionContentOptions) {
  let seen: ReturnType<typeof useQuestionContent> | undefined;
  function Probe() {
    seen = useQuestionContent(question, options);
    return createElement("span", null, seen.content);
  }
  renderToString(createElement(Probe));
  return seen!;
}

describe("useQuestionContent, flag off", () => {
  it("returns the stored content at once, as stored, not loading, and calls fetch never", () => {
    const fetchImpl = vi.fn();
    const result = render(QUESTION, { enabled: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual({ content: QUESTION.content, source: "stored", loading: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is off when the environment variable is not set (the default)", () => {
    delete process.env.NEXT_PUBLIC_LIVE_TRACE;
    const fetchImpl = vi.fn();
    expect(render(QUESTION, { fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ content: QUESTION.content, source: "stored", loading: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no question yet: empty content, as the page had before", () => {
    expect(render(null, { enabled: false })).toEqual({ content: "", source: "stored", loading: false });
  });

  it("an empty stored content stays empty", () => {
    expect(render({ id: 1, content: "" }, { enabled: false }).content).toBe("");
  });
});

describe("useQuestionContent, flag on (first render)", () => {
  it("is loading with the stored content until the trace is ready, and still makes no request while rendering", () => {
    const fetchImpl = vi.fn();
    expect(render(QUESTION, { enabled: true, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ content: QUESTION.content, source: "stored", loading: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no question yet: nothing to wait for, so not loading", () => {
    expect(render(null, { enabled: true })).toEqual({ content: "", source: "stored", loading: false });
  });
});

describe("source of the hook", () => {
  const source = readFileSync(join(__dirname, "use-question-content.ts"), "utf8").replace(/\/\/.*$/gm, "");

  it("both effects return before doing anything when the flag is off", () => {
    expect(source).toContain("if (!enabled || questionId === null) return;");
    expect(source).toContain("if (!waiting || questionId === null) return;");
    expect(source.indexOf("if (!enabled || questionId === null) return;")).toBeLessThan(source.indexOf("start(questionId)"));
  });

  it("starts the trace from a timer that the effect clears (strict mode sends one request), never directly", () => {
    expect(source).toMatch(/const startTimer = setTimeout\(\(\) => start\(questionId\), 0\);/);
    expect(source).toContain("return () => clearTimeout(startTimer);");
    expect(source.match(/\bstart\(/g)).toHaveLength(1);
  });

  it("starts only when the question id changes, not on tab changes or Reset", () => {
    expect(source).toContain("}, [enabled, questionId, start]);");
  });

  it("does not log or store anything", () => {
    expect(source).not.toMatch(/api\/logs|logButtonClick|localStorage|sessionStorage|console\./);
  });
});
