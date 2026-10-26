import { describe, expect, it } from "vitest";
import { NEAR_BOTTOM_PX, nextNearBottom, scrollBehaviorFor } from "./scroll";

describe("nextNearBottom", () => {
  it("is near the bottom within 120 px, whatever happened before", () => {
    expect(NEAR_BOTTOM_PX).toBe(120);
    expect(nextNearBottom(false, { y: 900, lastY: 880, distanceFromBottom: 120 })).toBe(true);
    expect(nextNearBottom(false, { y: 900, lastY: 900, distanceFromBottom: 0 })).toBe(true);
    expect(nextNearBottom(true, { y: 800, lastY: 900, distanceFromBottom: 100 })).toBe(true); // scrolled up a little
  });

  it("stops following when the user scrolls up and ends up far from the bottom", () => {
    expect(nextNearBottom(true, { y: 500, lastY: 900, distanceFromBottom: 400 })).toBe(false);
    expect(nextNearBottom(true, { y: 899, lastY: 900, distanceFromBottom: 121 })).toBe(false);
  });

  it("resumes when the user scrolls back down to within 120 px", () => {
    expect(nextNearBottom(false, { y: 700, lastY: 600, distanceFromBottom: 300 })).toBe(false); // still far
    expect(nextNearBottom(false, { y: 880, lastY: 700, distanceFromBottom: 119 })).toBe(true);
  });

  it("leaves the answer unchanged while scrolling down but still far away (our own smooth scroll)", () => {
    expect(nextNearBottom(true, { y: 300, lastY: 200, distanceFromBottom: 500 })).toBe(true);
    expect(nextNearBottom(false, { y: 300, lastY: 200, distanceFromBottom: 500 })).toBe(false);
  });

  it("does not move when the position did not change and the page is far from the bottom", () => {
    expect(nextNearBottom(true, { y: 300, lastY: 300, distanceFromBottom: 500 })).toBe(true);
    expect(nextNearBottom(false, { y: 300, lastY: 300, distanceFromBottom: 500 })).toBe(false);
  });

  it("accepts another threshold", () => {
    expect(nextNearBottom(false, { y: 10, lastY: 0, distanceFromBottom: 40 }, 50)).toBe(true);
    expect(nextNearBottom(false, { y: 10, lastY: 0, distanceFromBottom: 60 }, 50)).toBe(false);
  });
});

describe("scrollBehaviorFor", () => {
  it("is smooth only for a whole block, and only without reduced motion", () => {
    expect(scrollBehaviorFor(true, false)).toBe("smooth");
    expect(scrollBehaviorFor(false, false)).toBe("auto");
    expect(scrollBehaviorFor(true, true)).toBe("auto");
    expect(scrollBehaviorFor(false, true)).toBe("auto");
  });
});
