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

describe("streaming page typing clock", () => {
  it('has the TYPING_CLOCK switch, "legacy" by default (what learners have always seen), and no environment variable for it', () => {
    expect(code).toContain('const TYPING_CLOCK = "legacy" as "raf" | "legacy";');
    expect(code).not.toMatch(/process\.env/);
  });

  it("the legacy loop only runs for the legacy clock and the raf loop only for raf", () => {
    expect(code).toContain('if (TYPING_CLOCK !== "legacy" || !isTyping || isPaused)');
    expect(code).toContain('if (TYPING_CLOCK !== "raf" || !isTyping || isPaused) return;');
  });

  it("the raf loop freezes the clock on cleanup and when the tab is hidden, and reads no reduced-motion setting", () => {
    expect(code).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(code).toContain("cancelAnimationFrame(frameId)");
    expect(code).toContain("tickTypingClock(typingClockRef.current, performance.now(), false)");
    const loop = code.slice(code.indexOf("// --- TYPING CLOCK"), code.indexOf("// --- DISPLAY ANIMATION"));
    expect(loop).not.toMatch(/reduced-motion|matchMedia/);
  });

  it("Reset restarts the clock and the count of characters shown", () => {
    const reset = code.slice(code.indexOf("const resetStreamingState"), code.indexOf("const handleReset"));
    expect(reset).toContain("typingClockRef.current = newTypingClock()");
    expect(reset).toContain("typedCharsRef.current = 0");
  });

  it("the typed paragraph is a memoised component", () => {
    expect(code).toContain("const TypedText = React.memo(");
    expect(code).toContain("<TypedText text={displayedCurrentParagraph} />");
  });

  it("the AI answer reveal still waits 15 ms per character", () => {
    expect(code).toContain("setTimeout(res, 15)");
  });
});

