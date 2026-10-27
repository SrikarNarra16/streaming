// The typing clock: how many characters may be shown, from the ACTIVE time that has passed.
// Pure: no timers, no DOM. The page feeds it the timestamps of requestAnimationFrame.
import { nextToken, type ContentToken } from "./content";
//
//   characters shown = floor(active time x CHARS_PER_SECOND)
//
// Active time only grows while the text is really typing: a pause, a blank input, the feedback box and a hidden
// tab all freeze it (the caller passes running = false), and the next running frame continues from the same place
// without any catch-up. A single very long frame counts for at most MAX_FRAME_GAP_MS.

/**
 * Characters per second.
 *
 * THIS IS THE NOMINAL 100 PER SECOND (one character every 10 ms), NOT A MEASURED NUMBER. No measurement of the
 * old typewriter is stored in this repository (local-setup/measure-typing.js only prints a result when you run it
 * in a browser). The old loop really waits 10 ms plus a React render per character, so its real speed is probably
 * lower than 100.
 *
 * DO NOT switch TYPING_CLOCK to "raf" in app/streaming/page.tsx until this has been set from a measurement of the
 * LEGACY loop with local-setup/measure-typing.js: run it with TYPING_CLOCK = "legacy" and use its "characters per
 * second (while typing)". A guard test (lib/typing-clock-guard.test.ts) fails while the clock is "raf" and this is
 * still 100.
 */
export const CHARS_PER_SECOND = 100;

/** The most that one frame can add to the active time. Bigger gaps (a stalled frame) are cut to this. */
export const MAX_FRAME_GAP_MS = 100;

export interface TypingClock {
  /** Active time so far, in milliseconds. Never decreases except through discardUnusedChars. */
  activeMs: number;
  /** The timestamp of the previous running frame, or null when the clock was frozen (the next frame adds nothing). */
  lastTimestamp: number | null;
}

export const newTypingClock = (): TypingClock => ({ activeMs: 0, lastTimestamp: null });

/**
 * Moves the clock to the frame at `now` (milliseconds, from requestAnimationFrame / performance.now).
 * running = false freezes it and forgets the last timestamp, so resuming never adds the time that passed.
 * A zero or negative step adds nothing; a step over maxGapMs adds maxGapMs.
 */
export function tickTypingClock(clock: TypingClock, now: number, running: boolean, maxGapMs: number = MAX_FRAME_GAP_MS): TypingClock {
  if (!Number.isFinite(now)) return clock;
  if (!running) return clock.lastTimestamp === null ? clock : { activeMs: clock.activeMs, lastTimestamp: null };
  if (clock.lastTimestamp === null) return { activeMs: clock.activeMs, lastTimestamp: now }; // first running frame
  const step = now - clock.lastTimestamp;
  if (!(step > 0)) return { activeMs: clock.activeMs, lastTimestamp: now }; // zero, negative: no time passed
  return { activeMs: clock.activeMs + Math.min(step, maxGapMs), lastTimestamp: now };
}

const EPSILON = 1e-9; // so that 0.07 s x 100 characters per second is 7, not 6.999999

/** How many characters may have been shown by now: floor(active time x rate), at most `total`. */
export function charsAllowed(clock: TypingClock, charsPerSecond: number = CHARS_PER_SECOND, total: number = Infinity): number {
  const chars = Math.floor((clock.activeMs / 1000) * charsPerSecond + EPSILON);
  return Math.max(0, Math.min(chars, total));
}

/**
 * When typing stops (at a blank, a paragraph break or the end) characters that were allowed but not shown are
 * dropped, so typing later continues at the normal pace instead of releasing them at once. The fraction of a
 * character is kept.
 */
export function discardUnusedChars(clock: TypingClock, shown: number, charsPerSecond: number = CHARS_PER_SECOND): TypingClock {
  const allowed = charsAllowed(clock, charsPerSecond);
  if (allowed <= shown) return clock;
  return { ...clock, activeMs: clock.activeMs - ((allowed - shown) * 1000) / charsPerSecond };
}

export type TypingStop = Exclude<ContentToken, { kind: "char" }>;

export interface TakeResult {
  /** The characters to add to the paragraph. */
  text: string;
  /** The new position in the content (past a blank or `$$` when it stopped at one). */
  position: number;
  /** The new count of characters shown. */
  shown: number;
  /** What ended the run: a blank, a paragraph break or the end of the content. null: all allowed characters were typed. */
  stop: TypingStop | null;
}

/**
 * Types characters from `content`, starting at `position`, until `shown` reaches `allowed` or something that is not
 * plain text comes up (a BLANK(...), a `$$`, or the end). The token rules are those of lib/content.ts. A blank or
 * paragraph break is consumed, and returned as `stop`; the caller decides what the page does at that stop.
 */
export function takeAllowedChars(content: string, position: number, shown: number, allowed: number): TakeResult {
  let text = "";
  while (shown < allowed) {
    const token = nextToken(content, position, 1);
    if (token.kind === "char") {
      text += token.text;
      position += token.length;
      shown += token.text.length;
      continue;
    }
    if (token.kind !== "end") position += token.length;
    return { text, position, shown, stop: token };
  }
  return { text, position, shown, stop: null };
}
