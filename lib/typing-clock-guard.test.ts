import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARS_PER_SECOND } from "./typing-clock";

// Makes it impossible to switch the typing clock to "raf" by accident, before it has been calibrated.
const page = readFileSync(join(__dirname, "../app/streaming/page.tsx"), "utf8").replace(/\/\/.*$/gm, "");
const clock = page.match(/const TYPING_CLOCK = "(raf|legacy)" as "raf" \| "legacy";/)?.[1];

describe("typing clock calibration guard", () => {
  it("can read the TYPING_CLOCK constant from the page", () => {
    expect(["raf", "legacy"]).toContain(clock);
  });

  it('TYPING_CLOCK is not "raf" while CHARS_PER_SECOND is still the nominal 100', () => {
    if (clock === "raf" && CHARS_PER_SECOND === 100) {
      throw new Error(
        'TYPING_CLOCK is "raf" but CHARS_PER_SECOND is still 100, the NOMINAL rate that was never measured. ' +
          'The old typewriter probably ran slower, so learners would see faster typing and time_spent would change. ' +
          'Run local-setup/measure-typing.js with TYPING_CLOCK = "legacy", set CHARS_PER_SECOND in lib/typing-clock.ts to its ' +
          '"characters per second (while typing)", and only then switch to "raf" (see docs/BACKLOG.md).'
      );
    }
    expect(true).toBe(true);
  });
});
