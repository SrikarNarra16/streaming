import { describe, expect, it } from "vitest";
import { CHARS_PER_SECOND, charsAllowed, discardUnusedChars, MAX_FRAME_GAP_MS, newTypingClock, takeAllowedChars, tickTypingClock, type TypingClock } from "./typing-clock";

// Runs frames of `stepMs` from `start`, all running, and returns the clock and the timestamp of the last frame.
function run(clock: TypingClock, start: number, frames: number, stepMs: number, running = true) {
  let t = start;
  let c = clock;
  for (let i = 0; i < frames; i++) {
    c = tickTypingClock(c, t, running);
    t += stepMs;
  }
  return { clock: c, next: t };
}

describe("rate", () => {
  it("is the nominal rate of the old loop: one character every 10 ms", () => {
    expect(CHARS_PER_SECOND).toBe(100);
  });

  it("shows floor(active seconds x rate) characters", () => {
    expect(charsAllowed({ activeMs: 0, lastTimestamp: null })).toBe(0);
    expect(charsAllowed({ activeMs: 9, lastTimestamp: null })).toBe(0);
    expect(charsAllowed({ activeMs: 10, lastTimestamp: null })).toBe(1);
    expect(charsAllowed({ activeMs: 1000, lastTimestamp: null })).toBe(100);
    expect(charsAllowed({ activeMs: 70, lastTimestamp: null })).toBe(7); // no floating-point shortfall
    expect(charsAllowed({ activeMs: 1000, lastTimestamp: null }, 40)).toBe(40);
  });

  it("is independent of the frame rate: 60, 30, 144 and 10 frames per second show the same count after 2 s", () => {
    for (const stepMs of [1000 / 144, 1000 / 60, 1000 / 30, 100]) {
      const frames = Math.round(2000 / stepMs) + 1; // the first frame only starts the clock
      const { clock } = run(newTypingClock(), 5000, frames, stepMs);
      expect(Math.abs(charsAllowed(clock) - 200), `step ${stepMs}`).toBeLessThanOrEqual(1);
    }
  });

  it("never exceeds the text length", () => {
    const clock = { activeMs: 10_000, lastTimestamp: null };
    expect(charsAllowed(clock, 100, 40)).toBe(40);
    expect(charsAllowed(clock, 100, 0)).toBe(0);
    expect(charsAllowed({ activeMs: -5, lastTimestamp: null })).toBe(0);
  });
});

describe("the first frame, pause and resume", () => {
  it("the first running frame only starts the clock", () => {
    const c = tickTypingClock(newTypingClock(), 1000, true);
    expect(c).toEqual({ activeMs: 0, lastTimestamp: 1000 });
  });

  it("pause freezes the clock, and resume continues from the same place without the paused time", () => {
    let { clock, next } = run(newTypingClock(), 0, 51, 20); // 1000 ms active
    expect(charsAllowed(clock)).toBe(100);
    const before = clock.activeMs;
    ({ clock, next } = run(clock, next, 500, 20, false)); // 10 s paused
    expect(clock.activeMs).toBe(before);
    expect(clock.lastTimestamp).toBeNull();
    clock = tickTypingClock(clock, next, true); // resume: first frame adds nothing
    expect(clock.activeMs).toBe(before);
    clock = tickTypingClock(clock, next + 20, true);
    expect(clock.activeMs).toBe(before + 20);
    expect(charsAllowed(clock)).toBe(102);
  });

  it("freezing twice in a row changes nothing", () => {
    const frozen = tickTypingClock({ activeMs: 500, lastTimestamp: 100 }, 200, false);
    expect(tickTypingClock(frozen, 300, false)).toBe(frozen);
  });
});

describe("hidden tab", () => {
  it("is a frozen clock: coming back adds no catch-up, however long the tab was hidden", () => {
    const started = run(newTypingClock(), 0, 26, 20); // 500 ms
    const next = started.next;
    let clock = started.clock;
    const before = clock.activeMs;
    clock = tickTypingClock(clock, next, false); // visibilitychange: hidden
    const back = next + 5 * 60 * 1000; // five minutes later
    clock = tickTypingClock(clock, back, true);
    clock = tickTypingClock(clock, back + 16, true);
    expect(clock.activeMs).toBe(before + 16);
    expect(charsAllowed(clock) - charsAllowed({ activeMs: before, lastTimestamp: null })).toBeLessThanOrEqual(2);
  });

  it("even when the hidden event was missed, one frame adds at most MAX_FRAME_GAP_MS", () => {
    const clock = tickTypingClock({ activeMs: 500, lastTimestamp: 1000 }, 1000 + 60_000, true);
    expect(clock.activeMs).toBe(500 + MAX_FRAME_GAP_MS);
  });
});

describe("large, zero and negative frame gaps", () => {
  it("a large gap is cut to the maximum (and the maximum can be given)", () => {
    expect(tickTypingClock({ activeMs: 0, lastTimestamp: 0 }, 5000, true).activeMs).toBe(MAX_FRAME_GAP_MS);
    expect(tickTypingClock({ activeMs: 0, lastTimestamp: 0 }, 5000, true, 30).activeMs).toBe(30);
    expect(tickTypingClock({ activeMs: 0, lastTimestamp: 0 }, MAX_FRAME_GAP_MS, true).activeMs).toBe(MAX_FRAME_GAP_MS); // exactly the maximum
  });

  it("a zero gap adds nothing", () => {
    expect(tickTypingClock({ activeMs: 70, lastTimestamp: 500 }, 500, true)).toEqual({ activeMs: 70, lastTimestamp: 500 });
  });

  it("a negative gap (a timestamp that went backwards) adds nothing and later frames count from the new timestamp", () => {
    let c = tickTypingClock({ activeMs: 70, lastTimestamp: 500 }, 400, true);
    expect(c).toEqual({ activeMs: 70, lastTimestamp: 400 });
    c = tickTypingClock(c, 416, true);
    expect(c.activeMs).toBe(86);
  });

  it("NaN and Infinity timestamps are ignored", () => {
    const c = { activeMs: 70, lastTimestamp: 500 };
    expect(tickTypingClock(c, NaN, true)).toBe(c);
    expect(tickTypingClock(c, Infinity, true)).toBe(c);
    expect(tickTypingClock(c, -Infinity, false)).toBe(c);
  });
});

describe("the number of characters never goes backwards or past the text", () => {
  it("over thousands of random frames, including pauses, gaps, zero and negative steps", () => {
    let seed = 7;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed / 2 ** 32);
    let clock = newTypingClock();
    let t = 1000;
    let last = 0;
    const total = 300;
    for (let i = 0; i < 5000; i++) {
      const roll = random();
      t += roll < 0.05 ? -random() * 50 : roll < 0.1 ? 0 : roll < 0.15 ? random() * 10_000 : random() * 40;
      clock = tickTypingClock(clock, t, random() > 0.2);
      const shown = charsAllowed(clock, CHARS_PER_SECOND, total);
      expect(shown).toBeGreaterThanOrEqual(last);
      expect(shown).toBeLessThanOrEqual(total);
      last = shown;
    }
  });
});

describe("reset and discardUnusedChars", () => {
  it("a new clock restarts from zero", () => {
    expect(charsAllowed(newTypingClock())).toBe(0);
    expect(newTypingClock()).toEqual({ activeMs: 0, lastTimestamp: null });
  });

  it("drops characters that were allowed but not shown, keeping the fraction", () => {
    const clock = { activeMs: 105, lastTimestamp: 7 }; // 10.5 characters allowed
    const after = discardUnusedChars(clock, 4); // only 4 were shown
    expect(charsAllowed(after)).toBe(4);
    expect(after.activeMs).toBeCloseTo(45, 6); // 4.5 characters
    expect(after.lastTimestamp).toBe(7);
  });

  it("does nothing when everything allowed was shown, and never raises the allowance", () => {
    const clock = { activeMs: 100, lastTimestamp: null };
    expect(discardUnusedChars(clock, 10)).toBe(clock);
    expect(discardUnusedChars(clock, 50)).toBe(clock);
  });

  it("after a stop, the next characters come at the normal pace, not in a burst", () => {
    let clock: TypingClock = { activeMs: 300, lastTimestamp: 1000 }; // 30 allowed
    clock = discardUnusedChars(clock, 12); // stopped at a break after 12
    clock = tickTypingClock(clock, 1016, true);
    expect(charsAllowed(clock) - 12).toBeLessThanOrEqual(2);
  });
});

describe("takeAllowedChars", () => {
  it("types exactly the allowed number of characters and carries on from there", () => {
    const content = "Hello world$$Next";
    const first = takeAllowedChars(content, 0, 0, 5);
    expect(first).toEqual({ text: "Hello", position: 5, shown: 5, stop: null });
    const second = takeAllowedChars(content, first.position, first.shown, 8);
    expect(second).toMatchObject({ text: " wo", position: 8, shown: 8, stop: null });
  });

  it("types nothing when nothing more is allowed", () => {
    expect(takeAllowedChars("abc", 1, 4, 4)).toEqual({ text: "", position: 1, shown: 4, stop: null });
    expect(takeAllowedChars("abc", 1, 4, 2)).toEqual({ text: "", position: 1, shown: 4, stop: null }); // never goes back
  });

  it("stops at a paragraph break, consuming it", () => {
    expect(takeAllowedChars("ab$$cd", 0, 0, 100)).toEqual({ text: "ab", position: 4, shown: 2, stop: { kind: "paragraphBreak", length: 2 } });
  });

  it("stops at a blank, consuming it, and reports its answer", () => {
    expect(takeAllowedChars("a BLANK(low <= high) b", 0, 0, 100)).toEqual({ text: "a ", position: 20, shown: 2, stop: { kind: "blank", answer: "low <= high", length: 18 } });
  });

  it("stops at the end without moving past it, and never types past the text", () => {
    expect(takeAllowedChars("abc", 0, 0, 100)).toEqual({ text: "abc", position: 3, shown: 3, stop: { kind: "end" } });
    expect(takeAllowedChars("abc", 3, 3, 100)).toEqual({ text: "", position: 3, shown: 3, stop: { kind: "end" } });
  });

  it("a stop right at the start (a blank first, an empty paragraph) types nothing", () => {
    expect(takeAllowedChars("BLANK(x)abc", 0, 0, 10).text).toBe("");
    expect(takeAllowedChars("$$abc", 0, 0, 10)).toMatchObject({ text: "", position: 2, stop: { kind: "paragraphBreak" } });
  });

  it("running the whole content frame by frame gives the same text as the content, with the same stops", () => {
    const content = "One two.$$Three BLANK(four) five.$$Six";
    let position = 0;
    let shown = 0;
    let typed = "";
    const stops: string[] = [];
    let clock = newTypingClock();
    for (let t = 0, frames = 0; frames < 2000; t += 16.7, frames++) {
      clock = tickTypingClock(clock, t, true);
      const taken = takeAllowedChars(content, position, shown, charsAllowed(clock));
      typed += taken.text;
      position = taken.position;
      shown = taken.shown;
      if (taken.stop) {
        stops.push(taken.stop.kind);
        clock = discardUnusedChars(clock, shown);
        if (taken.stop.kind === "end") break;
      }
    }
    expect(typed).toBe("One two.Three  five.Six");
    expect(stops).toEqual(["paragraphBreak", "blank", "paragraphBreak", "end"]);
    expect(shown).toBe(typed.length);
  });
});
