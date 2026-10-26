// Rules for following the typed text with the page scroll. Pure, so they can be tested without a browser.

/** The user counts as "near the bottom" within this many pixels of the end of the page. */
export const NEAR_BOTTOM_PX = 120;

export interface ScrollSample {
  /** Current scroll position and the one at the previous scroll event. */
  y: number;
  lastY: number;
  /** Pixels between the bottom of the viewport and the bottom of the page. */
  distanceFromBottom: number;
}

/**
 * Is the user still following the bottom of the page? Called on every scroll event.
 * - within the threshold: yes
 * - scrolled up and now far from the bottom: no
 * - scrolling down but still far away (for example our own smooth scroll under way): unchanged
 */
export function nextNearBottom(previous: boolean, sample: ScrollSample, threshold: number = NEAR_BOTTOM_PX): boolean {
  if (sample.distanceFromBottom <= threshold) return true;
  if (sample.y < sample.lastY) return false;
  return previous;
}

/** Smooth only for a whole block appearing, and never when the user prefers reduced motion. */
export function scrollBehaviorFor(smoothRequested: boolean, reducedMotion: boolean): "smooth" | "auto" {
  return smoothRequested && !reducedMotion ? "smooth" : "auto";
}
