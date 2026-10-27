import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static guard for app/streaming/page.tsx: its timers stay cancellable and the logged action names do not change.
const source = readFileSync(join(__dirname, "../app/streaming/page.tsx"), "utf8");
const code = source.replace(/\/\/.*$/gm, "");

describe("streaming page timers", () => {
  it("the flow's one-off timers go through the timer set", () => {
    expect(code).toContain('timers.set(');
    expect(code).toContain('"paragraph-end"');
    expect(code).toContain('"show-ai-prompt"');
    expect(code).toContain('"blank-feedback"');
  });

  it("only the typing tick, the display interval and the 15 ms answer reveal use setTimeout/setInterval directly", () => {
    const direct = code.match(/\b(?:setTimeout|setInterval)\(/g) ?? [];
    expect(direct).toHaveLength(3); // typing tick (cleaned by its effect), display interval (cleaned by its effect), answer reveal (cancelled by its token)
    expect(code).toContain("clearTimeout(timeoutId)");
    expect(code).toContain("clearInterval(intervalId)");
  });

  it("reset (also used for the next question) and unmount cancel every pending timer", () => {
    const reset = code.slice(code.indexOf("const resetStreamingState"), code.indexOf("const handleReset"));
    expect(reset).toContain("timers.clearAll()");
    const unmount = code.slice(code.indexOf("answerStreamTokenRef.current += 1;\n            timers.clearAll();"));
    expect(unmount.length).toBeGreaterThan(0);
  });

  it("a timer that fires later reads the newest pause state, not the one of the render that set it", () => {
    expect(code).toContain("latestRef.current.isPaused");
    expect(code).toContain("latestRef.current.isWaitingForBlankFill");
  });

  it("Resume goes through shouldTypeOnResume", () => {
    expect(code).toContain("shouldTypeOnResume(");
  });

  it("the logged action names are unchanged", () => {
    for (const name of ["start_button_click", "resume_button_click", "pause_button_click", "reset_button_click", "understand_button_click", "dont_understand_button_click", "blank_answer_submit", "ok_ai_output_button_click", "logout_button_click"]) {
      expect(code, name).toContain(name);
    }
  });

  it("the typing speed constants are unchanged", () => {
    expect(code).toContain("const TYPING_INTERVAL_MS = 10;");
    expect(code).toContain("const CHARS_PER_TYPE_INTERVAL = 1;");
    expect(code).toContain("const FEEDBACK_DURATION_MS = 1500;");
  });
});
