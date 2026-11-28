// The App tour's tips on screen (GDA-212). One small bubble with a ring round the control it talks about,
// drawn in its own layer on top of the real screen. A tip never changes any data, never blocks the control it
// points at (the ring and the drag picture let taps through), and never touches the clock or the swap alert:
// it only looks at the screen and draws. Which tip is due is decided by tour-rules.js.

import { isDemoTeam, dueTip, TIPS, TIP_COUNT } from "./tour-rules.js";
import { IN_PROGRESS_PHASE, NOT_STARTED, pairsOf, phaseOf } from "./game-rules.js";

const LAYER_ID = "tipLayer";
const GAP = 12; // space between the ring and the bubble (px, measured from the real screen, not a style)

let shown = null; // { n, targets, layout } for the tip on screen now, so scrolling or turning the phone can re-place it

/** What the rules need to know about the screen right now. Reads state only. */
function contextOf(state) {
  const team = state.teams.find((candidate) => candidate.id === state.currentTeamId);
  const game = state.games.find((candidate) => candidate.id === (state.viewId ?? state.gameId));
  const half = state.screen === "half1" ? 1 : state.screen === "half2" ? 2 : 0;
  const inGameScreen = half !== 0 && Boolean(game);
  return {
    demo: isDemoTeam(team) && !state.upgradeFailed,
    off: state.tourOff || state.welcomeOpen, // the welcome is showing, or the coach chose Explore on my own
    screen: state.screen,
    seen: state.tourSeen,
    profileOpen: state.noteFor !== null,
    sheetOpen: false, // any other open sheet is found on the real screen below (a .scrim that is not the player card)
    notStarted: inGameScreen && game.state === NOT_STARTED,
    running: inGameScreen && phaseOf(game, half) === IN_PROGRESS_PHASE,
    planned: inGameScreen && pairsOf(game).length > 0,
    swapMade: inGameScreen && (game.swapCount ?? 0) > 0, // counted from the saved swap events: only a real Swap makes one
    viewing: Boolean(state.viewId),
  };
}

const all = (selector) => [...document.querySelectorAll(selector)];
const first = (selector) => document.querySelector(selector);
/** The first bench circle in a running game that is not already in a planned swap (the next one to drag). */
const nextBenchCircle = () => all("#screen .slot[data-bench]:not(.plan)").map((slot) => slot.querySelector(".ci")).find(Boolean) ?? null;
/** The first pitch player (not the keeper) not already in a planned swap: where the animation drops the circle. */
const dropSpot = () => all("#screen .pitch .slot:not(.keeper):not(.plan)").map((slot) => slot.querySelector(".ci")).find(Boolean) ?? null;

/**
 * The real controls tip `n` points at: { ring: [elements the ring wraps], from, to } or null when they are not on
 * screen (the tip then simply waits). `from` and `to` are the circles of the drag animation.
 */
function targetsFor(n, state) {
  const one = (el) => (el ? { ring: [el] } : null);
  switch (n) {
    case 1: {
      if (state.topMenuOpen) {
        const rows = ["#screen .topMenu .teamSettings", "#screen .topMenu .squadItem", "#screen .topMenu .historyItem"].map(first).filter(Boolean);
        return rows.length ? { ring: rows, atBottom: true } : null;
      }
      return one(first("#screen .topMenuBtn"));
    }
    case 2:
      return one(first("#newGame"));
    case 3:
      return one(first("#screen .gamesTile .gameRow")); // the Sample FC card (the Demo team's only upcoming game)
    case 4: {
      const bench = first('#screen [data-zone="bench"]');
      const from = bench?.querySelector(".slot .ci");
      const to = dropSpot();
      return bench ? { ring: [bench], from, to } : null;
    }
    case 5:
      return one(first("#screen .pitch .sch"));
    case 6:
      return one(first("#noteSheet .pchart") ?? first("#noteSheet #profileNone"));
    case 7:
    case 8: {
      const from = nextBenchCircle();
      return from ? { ring: [from], from, to: dropSpot() } : null;
    }
    case 9:
      return one(first("#swapPill"));
    case 10:
      return one(first("#score"));
    case 11:
      return one(first("#fullTime"));
    default:
      return null;
  }
}

/** The box that contains every element (viewport coordinates). */
function unionRect(elements) {
  const boxes = elements.map((el) => el.getBoundingClientRect());
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.right));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const grown = (rect, by) => ({ left: rect.left - by, top: rect.top - by, right: rect.right + by, bottom: rect.bottom + by });

/** Builds the layer's pieces (ring, optional drag picture, bubble) once per tip. */
function buildLayer(tip, targets, actions) {
  const layer = document.createElement("div");
  layer.id = LAYER_ID;
  const ring = document.createElement("div");
  ring.className = "tipRing";
  const box = document.createElement("div");
  box.className = "tipBox";
  box.id = "tipBox";
  box.setAttribute("role", "status");
  const text = document.createElement("p");
  text.textContent = tip.text;
  const row = document.createElement("div");
  row.className = "tipRow";
  const count = document.createElement("span");
  count.className = "tipCount";
  count.textContent = `${tip.n} of ${TIP_COUNT}`;
  const got = document.createElement("button");
  got.className = "btn pri tipGot";
  got.id = "tipGot";
  got.textContent = "Got it";
  got.onclick = () => actions.tipGotIt(tip.n);
  row.append(count, got);
  box.append(text, row);
  layer.append(ring);
  let drag = null;
  if (tip.animated && targets.from && targets.to) {
    // A copy of the real player circle (its picture or initials), gliding to the drop spot: a copy only, the real players never move.
    const copy = targets.from.querySelector(".av")?.cloneNode(true);
    if (copy) {
      drag = document.createElement("div");
      drag.className = "tipDrag";
      drag.setAttribute("aria-hidden", "true");
      const finger = document.createElement("i");
      drag.append(copy, finger);
      layer.append(drag);
    }
  }
  layer.append(box);
  return { layer, ring, box, drag };
}

/** Puts the ring, the drag picture and the bubble in place from where the real controls are now. */
function place(parts, targets) {
  const { ring, box, drag } = parts;
  if (!targets.ring.every((el) => el.isConnected)) {
    return;
  }
  const target = unionRect(targets.ring);
  const pad = GAP / 4;
  ring.style.left = `${target.left - pad}px`;
  ring.style.top = `${target.top - pad}px`;
  ring.style.width = `${target.width + 2 * pad}px`;
  ring.style.height = `${target.height + 2 * pad}px`;
  const round = targets.ring.length === 1 && Math.abs(target.width - target.height) < 2 && target.width > 0;
  ring.classList.toggle("round", round);

  // The drag picture: starts on the circle being dragged, ends on the drop spot (the movement is a CSS animation).
  let end = null;
  if (drag && targets.from?.isConnected && targets.to?.isConnected) {
    const a = targets.from.getBoundingClientRect();
    const b = targets.to.getBoundingClientRect();
    drag.style.width = `${a.width}px`;
    drag.style.height = `${a.height}px`;
    drag.style.left = `${a.left}px`;
    drag.style.top = `${a.top}px`;
    drag.style.setProperty("--dx", `${b.left + b.width / 2 - (a.left + a.width / 2)}px`);
    drag.style.setProperty("--dy", `${b.top + b.height / 2 - (a.top + a.height / 2)}px`);
    end = b;
  }

  // The bubble sits across the frame, never over the ringed control. Try below, above, at the top and at the bottom of
  // the screen; take the first that keeps off the ring, the drop spot, the swap pill and the score, otherwise the least bad.
  const frame = document.getElementById("frame").getBoundingClientRect();
  box.style.setProperty("--fl", `${frame.left}px`);
  box.style.setProperty("--fw", `${frame.width}px`);
  const height = box.getBoundingClientRect().height;
  const view = window.innerHeight;
  const margin = GAP;
  const clampTop = (top) => Math.max(margin, Math.min(top, view - height - margin));
  const candidates = [
    { top: target.bottom + GAP + pad, side: "up" }, // below the ring: the arrow points up at it
    { top: target.top - GAP - pad - height, side: "down" }, // above the ring: the arrow points down
    { top: margin, side: "none" },
    { top: view - height - margin, side: "none" },
  ];
  const bottomOf = (selector) => first(selector)?.getBoundingClientRect().bottom ?? 0;
  const headBottom = Math.max(bottomOf("#screen .clk"), bottomOf("#score"));
  const pillTop = first("#swapPill")?.getBoundingClientRect().top;
  candidates.push({ top: headBottom + GAP, side: "none" }); // just under the head row and score bar
  if (pillTop !== undefined) {
    candidates.push({ top: pillTop - GAP - height, side: "none" }); // just above the swap pill
  }
  if (targets.atBottom) {
    candidates.unshift({ top: view - height - margin, side: "none" });
  }
  const boxBox = box.getBoundingClientRect(); // its left and width come from the stylesheet
  const boxLeft = boxBox.left;
  const hard = [grown(target, pad)];
  // In a game the bubble never covers the swap pill (in any state), the head row or the score bar, as well as its own control.
  const keepClear = ["#swapPill", "#score", "#noteDone", "#screen .clk"].map((selector) => first(selector)).filter((el) => el && !targets.ring.includes(el));
  keepClear.forEach((el) => hard.push(el.getBoundingClientRect()));
  const soft = [end].filter(Boolean);
  let best = null;
  for (const candidate of candidates) {
    const top = clampTop(candidate.top);
    const rect = { left: boxLeft, right: boxLeft + boxBox.width, top, bottom: top + height };
    const score = hard.filter((area) => overlaps(rect, area)).length * 100 + soft.filter((area) => overlaps(rect, area)).length;
    if (!best || score < best.score) {
      best = { score, top, side: candidate.side };
    }
  }
  box.style.top = `${best.top}px`;
  box.className = `tipBox ${best.side}`;
  const centre = target.left + target.width / 2 - boxLeft;
  box.style.setProperty("--ax", `${Math.max(24, Math.min(centre, boxBox.width - 24))}px`);
}

/** Removes the tip layer, if any. */
function clear() {
  document.getElementById(LAYER_ID)?.remove();
  shown = null;
}

/**
 * Called after every screen is drawn. Shows the one due tip, or none. A tip waits (nothing shows) when its control
 * is not on screen, or when any other sheet or pop-up is open over the screen.
 */
export function drawTip(state, actions) {
  clear();
  const ctx = contextOf(state);
  const n = dueTip(ctx);
  if (n === null) {
    return;
  }
  // Another sheet (Who scored?, restart, menus' confirms...) is open: wait. Tip 6 is the player card itself.
  const sheets = all("#screen .scrim").filter((sheet) => sheet.id !== "noteSheet");
  if (sheets.length > 0 || (n !== 6 && ctx.profileOpen)) {
    return;
  }
  const targets = targetsFor(n, state);
  if (!targets) {
    return;
  }
  const tip = TIPS[n - 1];
  const parts = buildLayer(tip, targets, actions);
  document.body.append(parts.layer);
  place(parts, targets);
  shown = { parts, targets };
}

/** Scrolling or turning the phone moves the controls: put the ring and bubble back on them. The tip is not rebuilt. */
function replace() {
  if (shown) {
    place(shown.parts, shown.targets);
  }
}
window.addEventListener("resize", replace);
window.addEventListener("scroll", replace, true);

const WELCOME_ID = "welcome";
/** The first-open welcome (mock-up welcome.html, option A): a full screen over the app, drawn on top. Changes no data. */
export function drawWelcome(state, actions) {
  document.getElementById(WELCOME_ID)?.remove();
  if (!state.welcomeOpen) {
    return;
  }
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const picture = (file, className) => {
    const img = el("img", className);
    img.src = file;
    img.alt = "";
    img.draggable = false;
    return img;
  };
  const root = el("div", "welcome");
  root.id = WELCOME_ID;
  const title = el("h1");
  title.append("Welcome to", document.createElement("br"), "Game Day"); // a forced break: no word wraps alone
  const who = el("div", "wWho");
  who.append(picture("demo/logo.svg", "wCrest"), picture("demo/alex.svg", "wAv"), picture("demo/finn.svg", "wAv"), picture("demo/kai.svg", "wAv"));
  const demo = el("div", "wDemo");
  const line = el("p");
  line.append("A Demo team is ready to try things on.", document.createElement("br"), "Tips will point the way.");
  demo.append(who, line);
  const start = el("button", "btn big solid", "Start the tour");
  start.id = "welcomeStart";
  start.onclick = () => actions.startTour();
  const explore = el("button", "btn big", "Explore on my own");
  explore.id = "welcomeExplore";
  explore.onclick = () => actions.exploreAlone();
  const buttons = el("div", "wButtons");
  buttons.append(start, explore);
  const main = el("div", "wMain");
  main.append(picture("icons/icon-180.png", "wLogo"), title, el("p", "", "Manage line-ups, rotations and game time."), demo);
  root.append(main, buttons);
  document.body.append(root);
}
