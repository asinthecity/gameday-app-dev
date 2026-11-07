// Taps and drags on the line-up's circles: one path for finger and mouse, using
// pointer events. This is the handling tried and approved on the test iPhone in the
// clickable mock-up, so its numbers and order of steps are carried over unchanged.
//
// Nothing here knows the game rules, and nothing here saves: main.js passes those in.

// The floating circle sits this far above the thumb, so the thumb does not hide it.
export const GHOST_LIFT = 36;
// How close to a circle's centre the floating circle must be to count as "on" it.
export const DROP_RADIUS = 46;
// A press that moves this far is a drag. Less than this it is still a tap.
export const DRAG_START_DISTANCE = 8;

/** The target nearest to this point, within DROP_RADIUS, or null. */
export function nearestTarget(targets, x, y) {
  let best = null;
  let bestDistance = DROP_RADIUS * DROP_RADIUS;
  for (const target of targets) {
    const distance = (target.x - x) ** 2 + (target.y - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  return best;
}

/** True once a finger has moved far enough from where it went down. */
export function movedFarEnough(startX, startY, x, y) {
  return (x - startX) ** 2 + (y - startY) ** 2 >= DRAG_START_DISTANCE ** 2;
}

/** Reads what screens.js put on a slot: { playerId } or, for an empty position, { place }. */
function spotOf(slot) {
  return slot.dataset.player !== undefined ? { playerId: Number(slot.dataset.player) } : { place: Number(slot.dataset.place) };
}

function centreOf(slot) {
  const box = slot.querySelector(".ci").getBoundingClientRect();
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
    press.targets = [...document.querySelectorAll("[data-player], [data-place]")]
      .filter((slot) => slot !== press.slot)
      .map((slot) => ({ slot, spot: spotOf(slot), ...centreOf(slot) }))
      .filter((target) => rules.canDrop(press.spot.playerId, target.spot));
    ghost.replaceChildren(press.slot.querySelector(".av").cloneNode(true));
    const start = centreOf(press.slot);
    line.setAttribute("x1", start.x);
    line.setAttribute("y1", start.y);
    layer.hidden = false;
  }

  function moveDrag(x, y) {
    const ghostY = y - press.lift;
    ghost.style.transform = `translate(${x}px,${ghostY}px)`;
    line.setAttribute("x2", x);
    line.setAttribute("y2", ghostY);
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
    if (press || !rules.canPress() || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    const slot = event.target.closest?.("[data-player], [data-place]");
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

  return { isActive: () => press !== null };
}
