// Taps and drags on the line-up's circles: one path for finger and mouse, using
// pointer events. This is the handling tried and approved on the test iPhone in the
// clickable mock-up, so its numbers and order of steps are carried over unchanged.
//
// Nothing here knows the game rules, and nothing here saves: main.js passes those in.

// The floating circle sits this far above the thumb, so the thumb does not hide it.
export const GHOST_LIFT = 36;
// The floating circle is 56px wide (see #ghost in style.css).
const GHOST_RADIUS = 28;
// How close to a circle's centre the floating circle must be to count as "on" it.
export const DROP_RADIUS = 46;
// A press that moves this far is a drag. Less than this it is still a tap.
export const DRAG_START_DISTANCE = 8;

/** The target nearest to this point, within DROP_RADIUS, or null. */
export function nearestTarget(targets, x, y) {
  let best = null;
  let bestDistance = DROP_RADIUS * DROP_RADIUS;
  for (const target of targets) {
    // A whole row (ABSENT, bench) counts as hit anywhere inside it.
    const inside = target.box && x >= target.box.left && x <= target.box.right && y >= target.box.top && y <= target.box.bottom;
    const distance = inside ? 0 : (target.x - x) ** 2 + (target.y - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  return best;
}

/**
 * A line between two circle centres, shortened so it starts at the edge of the first circle and
 * ends at the edge of the second (radii r1, r2). Gives null when the circles touch or overlap.
 */
export function trimmedLine(a, b, r1, r2) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= r1 + r2) {
    return null;
  }
  return { x1: a.x + (dx / length) * r1, y1: a.y + (dy / length) * r1, x2: b.x - (dx / length) * r2, y2: b.y - (dy / length) * r2 };
}

/** True once a finger has moved far enough from where it went down. */
export function movedFarEnough(startX, startY, x, y) {
  return (x - startX) ** 2 + (y - startY) ** 2 >= DRAG_START_DISTANCE ** 2;
}

/** Reads what screens.js put on a slot: { playerId } or, for an empty position, { place }. */
function spotOf(slot) {
  if (slot.dataset.zone) {
    return { zone: slot.dataset.zone }; // A whole row: "absent" or "bench" (GDA-62).
  }
  return slot.dataset.player !== undefined ? { playerId: Number(slot.dataset.player) } : { place: Number(slot.dataset.place) };
}

function centreOf(slot) {
  const box = (slot.querySelector(".ci") ?? slot).getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/**
 * Starts listening. `rules` holds:
 * - canPress(): whether the line-up is on screen and ready for a press.
 * - canDrag(spot) and canDrop(playerId, spot).
 * - tapped(spot): a press that did not become a drag.
 * - dragStarted(): must not redraw the slots. On an iPhone, removing the circle under
 *   the finger ends the drag. The screen is redrawn only after the finger lifts.
 * - dropped(playerId, spot): spot is null if the drop landed on nothing.
 *
 * Gives { isActive }, which is true while a finger is on a player.
 */
export function watchLineUpPresses(rules) {
  const layer = document.getElementById("layer");
  const ghost = document.getElementById("ghost");
  const line = document.getElementById("ln");
  let press = null; // The press in progress, or null.

  function startDrag() {
    press.dragging = true;
    rules.dragStarted();
    document.querySelector(".slot.sel")?.classList.remove("sel");
    press.slot.classList.add("src");
    // Measured after dragStarted, which can change the height of the bottom bar.
    press.targets = [...document.querySelectorAll("[data-player], [data-place], [data-zone]")]
      .filter((slot) => slot !== press.slot)
      .map((slot) => ({ slot, spot: spotOf(slot), box: slot.dataset.zone ? slot.getBoundingClientRect() : null, ...centreOf(slot) }))
      .filter((target) => rules.canDrop(press.spot.playerId, target.spot));
    ghost.replaceChildren(press.slot.querySelector(".av").cloneNode(true));
    const start = centreOf(press.slot);
    press.start = start;
    press.startRadius = (press.slot.querySelector(".av") ?? press.slot).getBoundingClientRect().width / 2 + 2;
    line.setAttribute("x2", start.x); // No line until the circle has moved clear of its start
    line.setAttribute("y2", start.y);
    line.setAttribute("x1", start.x);
    line.setAttribute("y1", start.y);
    layer.hidden = false;
  }

  function moveDrag(x, y) {
    const ghostY = y - press.lift;
    ghost.style.transform = `translate(${x}px,${ghostY}px)`;
    // The line runs from the edge of the circle being dragged to the edge of the floating circle (radius half of 56).
    const cut = trimmedLine(press.start, { x, y: ghostY }, press.startRadius, GHOST_RADIUS);
    for (const [name, value] of Object.entries(cut ?? { x1: 0, y1: 0, x2: 0, y2: 0 })) {
      line.setAttribute(name, value);
    }
    const best = nearestTarget(press.targets, x, ghostY);
    if (best !== press.hit) {
      press.hit?.slot.classList.remove("drop");
      best?.slot.classList.add("drop");
      press.hit = best;
    }
  }

  /** The finger has lifted (`apply`) or the phone took the touch away (not `apply`). */
  function finish(apply) {
    const ended = press;
    press = null;
    if (ended.dragging) {
      layer.hidden = true;
      rules.dropped(ended.spot.playerId, apply ? (ended.hit?.spot ?? null) : null);
    } else if (apply && !ended.moved) {
      rules.tapped(ended.spot);
    }
  }

  document.addEventListener("pointerdown", (event) => {
    // GDA-72: if the phone loses a touch (app switch, system swipe, a press whose circle was redrawn),
    // no pointerup or pointercancel ever arrives and `press` would stay set for good: every circle and every
    // button then ignores taps (isActive) until the app is reopened. A new FIRST finger cannot belong to the
    // old press, so the old one is dropped here. A second finger (not primary) is still ignored.
    if (press && event.isPrimary !== false) {
      finish(false);
    }
    if (press || !rules.canPress() || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    const slot = event.target.closest?.("[data-player], [data-place], [data-zone]");
    if (!slot) {
      return;
    }
    press = {
      id: event.pointerId,
      slot,
      spot: spotOf(slot),
      x: event.clientX,
      y: event.clientY,
      lift: event.pointerType === "mouse" ? 0 : GHOST_LIFT,
      moved: false, // Moved too far to be a tap, even if it cannot be a drag.
      dragging: false,
      targets: [],
      hit: null,
    };
  });

  document.addEventListener("pointermove", (event) => {
    if (!press || event.pointerId !== press.id) {
      return;
    }
    if (!press.dragging) {
      if (!movedFarEnough(press.x, press.y, event.clientX, event.clientY)) {
        return;
      }
      press.moved = true;
      if (!rules.canDrag(press.spot)) {
        return;
      }
      startDrag();
    }
    event.preventDefault();
    moveDrag(event.clientX, event.clientY);
  });

  document.addEventListener("pointerup", (event) => {
    if (press && event.pointerId === press.id) {
      finish(true);
    }
  });
  document.addEventListener("pointercancel", (event) => {
    if (press && event.pointerId === press.id) {
      finish(false);
    }
  });

  // The app going to the background mid-press also loses the touch. Let go cleanly.
  const letGo = () => {
    if (press) {
      finish(false);
    }
  };
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && letGo());
  window.addEventListener("pagehide", letGo);

  // Guards so the page cannot scroll, zoom or select text on the line-up. These
  // must not be passive, or preventDefault is ignored.
  const guarded = () => document.body.classList.contains("nomove");
  for (const type of ["touchmove", "gesturestart", "selectstart", "contextmenu", "dragstart"]) {
    document.addEventListener(
      type,
      (event) => {
        if (guarded()) {
          event.preventDefault();
        }
      },
      { passive: false }
    );
  }

  return {
    isActive() {
      // A press that never became a drag and whose circle has been redrawn away can never finish (its
      // pointerup goes to the removed circle, not to the page), so it must not block the buttons.
      if (press && !press.dragging && !press.slot.isConnected) {
        press = null;
      }
      return press !== null;
    },
  };
}
