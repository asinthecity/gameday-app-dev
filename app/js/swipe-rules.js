// GDA-122: when does a finger movement count as a swipe between the game screens?
// Pure sums only (no screen, no saving), so they can be tested on their own.

// A swipe moves at least this far sideways (px) ...
export const SWIPE_MIN_DISTANCE = 60;
// ... and the sideways distance must be more than this many times the up/down distance.
export const SWIPE_SIDEWAYS_RATIO = 2;
// Anything that starts on one of these is a drag, tap or hold (drag.js), never a swipe.
export const NO_SWIPE_START = "[data-player], [data-place], [data-zone], [data-note], input, select, textarea, .step";
// A pop-up or sheet is open when one of these is on the screen.
export const POPUP_OPEN = ".scrim, .pop, .menuCover";

/**
 * What a finger did, decided when it lifts. dx, dy = lift point minus touch-down point.
 * Gives "next" (moved left, like ›), "back" (moved right, like ‹), or null (not a swipe).
 */
export function swipeOf(dx, dy) {
  const sideways = Math.abs(dx);
  if (sideways < SWIPE_MIN_DISTANCE || sideways <= SWIPE_SIDEWAYS_RATIO * Math.abs(dy)) {
    return null;
  }
  return dx < 0 ? "next" : "back";
}
