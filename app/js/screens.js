// Builds each screen from the current state. Nothing here saves anything: taps
// go to the `actions` that main.js passes in.
//
// Names only ever reach the page as plain text (never as HTML), so a name
// containing < or & just shows as typed.

import { FINISHED, startedAtOf, endedAtOf, benchSeconds, benchTimerText, canCreateGame, clockText, isBenchLate, ringFraction, formatGameDate, formatKickOff, isBlank, isTimeUp, lineUpView, swapMessage, pairsOf, hasHadTurn, rotationOf, MIN_ROTATION, MAX_ROTATION } from "./game-rules.js";
import { canSaveName, initialsFor } from "./squad-rules.js";

/** Makes one element. Props starting "on" are tap or typing handlers. */
function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) {
      element.addEventListener(key.slice(2), value);
    } else if (key === "class") {
      element.className = value;
    } else if (typeof value === "boolean") {
      element[key] = value;
    } else {
      element.setAttribute(key, value);
    }
  }
  element.append(...children.filter((child) => child !== null));
  return element;
}

function header(title, onBack, right = null) {
  const back = onBack ? h("button", { class: "back", "aria-label": "Back", onclick: onBack }, "‹") : null;
  return h("div", { class: "hdr" }, back, h("h1", {}, title), right);
}

function problemLine(text) {
  return text ? h("p", { class: "problem", role: "alert" }, text) : null;
}

function avatar(player) {
  return h("div", { class: "av c" + player.colour }, initialsFor(player.name));
}

function updateCard(notice, actions) {
  if (!notice.show) {
    return null;
  }
  const button = notice.canUpdate ? h("button", { class: "btn", onclick: actions.applyUpdate }, "Update") : null;
  return h("div", { class: "card" }, h("b", {}, notice.text), problemLine(notice.problem), button);
}

function gameCard(game, actions) {
  return h(
    "div",
    { class: "card game" },
    h("b", {}, `vs ${game.opposition}`),
    h("div", {}, `${formatGameDate(game.date)} · ${formatKickOff(game.kickOff)}`),
    h("div", {}, game.venue),
    h("button", { class: "btn", onclick: () => actions.openLineUp(game.id) }, "Line-up")
  );
}

function homeScreen(state, actions) {
  const hasPlayers = state.players.length > 0;
  const createButton = hasPlayers
    ? h("button", { class: "btn pri big", onclick: actions.openCreateGame }, "+ Create game")
    : null;
  const cards = state.games.filter((game) => game.state !== FINISHED).map((game) => gameCard(game, actions));
  const squadPart = hasPlayers
    ? [h("button", { class: "btn", onclick: actions.openSquad }, `Squad (${state.players.length})`)]
    : [
        h("div", { class: "msg" }, "Add your players"),
        h("button", { class: "btn pri big", onclick: actions.addFromHome }, "+ Add players"),
      ];
  return {
    nodes: [
      header("Game Day"),
      h(
        "div",
        { class: "body" },
        updateCard(state.updateNotice, actions),
        problemLine(state.problem),
        createButton,
        ...cards,
        ...squadPart
      ),
    ],
  };
}

function squadScreen(state, actions) {
  const rows = state.players.map((player) =>
    h(
      "div",
      { class: "prow", "data-player": player.id },
      avatar(player),
      h("span", { class: "pn" }, player.name),
      h("button", { class: "btn", onclick: () => actions.openEdit(player.id) }, "Edit")
    )
  );
  return {
    fixed: true, // The list scrolls; + Add player stays on screen.
    nodes: [
      header(`Squad (${state.players.length})`, actions.goHome),
      h("div", { class: "list" }, ...rows),
      h("div", { class: "acts" }, h("button", { class: "btn pri", onclick: actions.addFromSquad }, "+ Add player")),
    ],
  };
}

/** The name box and Save button, shared by the add and edit screens. */
function nameForm(startingName, onSave) {
  const save = h("button", { class: "btn pri", id: "save", disabled: !canSaveName(startingName), onclick: onSave }, "Save");
  const input = h("input", {
    id: "nm",
    type: "text",
    autocomplete: "off",
    autocapitalize: "words",
    autocorrect: "off",
    spellcheck: "false",
    oninput: () => {
      save.disabled = !canSaveName(input.value);
    },
  });
  input.value = startingName;
  const field = h("div", { class: "f" }, h("label", { for: "nm" }, h("span", {}, "First name")), input);
  return [field, save];
}

function addScreen(state, actions) {
  return {
    nodes: [
      header("Add player", actions.leaveAdd),
      h("div", { class: "body" }, ...nameForm("", actions.saveNew), problemLine(state.problem)),
    ],
  };
}

function editScreen(state, actions) {
  const player = state.players.find((candidate) => candidate.id === state.editId);
  const warning = state.showRemoveWarning
    ? h(
        "div",
        { class: "scrim" },
        h(
          "div",
          { class: "sheet" },
          h("h2", {}, `Remove ${player.name}?`),
          h("button", { class: "btn del", onclick: actions.confirmRemove }, "Remove"),
          h("button", { class: "btn", onclick: actions.cancelRemove }, "Cancel")
        )
      )
    : null;
  return {
    nodes: [
      header("Edit player", actions.backToSquad),
      h(
        "div",
        { class: "body" },
        ...nameForm(player.name, actions.saveRename),
        problemLine(state.problem),
        h("button", { class: "btn gapbig", onclick: actions.askRemove }, "Remove from squad")
      ),
      warning,
    ].filter(Boolean),
  };
}

/**
 * One box on the New game screen. It keeps state.form up to date as it changes,
 * and marks itself Needed when left blank. Fields not reached are never marked.
 */
function detailField(form, key, label, inputProps, onChange) {
  const needed = h("span", { class: "nw", hidden: !form.marked[key] }, "Needed");
  const input = h("input", { id: "i-" + key, ...inputProps });
  input.value = form[key];
  const field = h(
    "div",
    { class: form.marked[key] ? "f need" : "f", id: "f-" + key },
    h("label", { for: "i-" + key }, h("span", {}, label), needed),
    input
  );

  function mark(on) {
    form.marked[key] = on;
    field.classList.toggle("need", on);
    needed.hidden = !on;
  }
  function changed() {
    form[key] = input.value;
    if (!isBlank(input.value)) {
      mark(false);
    }
    onChange();
  }
  // Date and time pickers may report through either event, so both are heard.
  input.addEventListener("input", changed);
  input.addEventListener("change", changed);
  input.addEventListener("focusout", () => {
    changed(); // In case a picker was cleared without reporting it.
    if (isBlank(input.value)) {
      mark(true);
    }
  });
  return field;
}

/**
 * The rotation stepper: - and + around the number of minutes. `value` is read each
 * time; `onStep(change)` is told -1 or +1. Both buttons grey out at the ends (1 and 25).
 */
function rotationStepper(value, onStep) {
  const number = h("div", { class: "val", id: "rotValue" });
  const less = h("button", { class: "btn", id: "rotLess", "aria-label": "Shorter", onclick: () => step(-1) }, "\u2212");
  const more = h("button", { class: "btn", id: "rotMore", "aria-label": "Longer", onclick: () => step(1) }, "+");
  const show = () => {
    number.textContent = `${value()} min`;
    less.disabled = value() <= MIN_ROTATION;
    more.disabled = value() >= MAX_ROTATION;
  };
  const step = (change) => {
    onStep(change);
    show();
  };
  show();
  return h("div", { class: "step" }, less, number, more);
}

function createGameScreen(state, actions) {
  const form = state.form;
  const make = h(
    "button",
    { class: "btn pri big", id: "make", disabled: !canCreateGame(form), onclick: actions.makeGame },
    "Create game"
  );
  const onChange = () => {
    make.disabled = !canCreateGame(form);
  };
  const text = { type: "text", autocomplete: "off", autocapitalize: "words", autocorrect: "off", spellcheck: "false" };
  return {
    nodes: [
      header("New game", actions.leaveCreateGame),
      h(
        "div",
        { class: "body" },
        detailField(form, "date", "Date", { type: "date" }, onChange),
        detailField(form, "kickOff", "Kick-off", { type: "time" }, onChange),
        detailField(form, "opposition", "Opposition", text, onChange),
        detailField(form, "venue", "Venue", text, onChange),
        h(
          "div",
          { class: "f" },
          h("div", { class: "lb" }, h("span", {}, "Rotation")),
          rotationStepper(
            () => form.rotationMinutes,
            (change) => {
              form.rotationMinutes = Math.min(MAX_ROTATION, Math.max(MIN_ROTATION, form.rotationMinutes + change));
            }
          )
        ),
        make,
        problemLine(state.problem)
      ),
    ],
  };
}

/**
 * One player on the pitch, the bench or the ABSENT row. There is no tap handler
 * here: drag.js reads data-player and data-place, so a tap and a drag take one
 * path. Slots without them, on the before-kick-off screen, do nothing.
 */
function playerSlot(player, state, canMove, isKeeper = false, benchTimer = false) {
  const planned = state.screen === "game" && pairsOf(openGame(state)).some((pair) => pair.benchId === player.id || pair.fieldId === player.id);
  // The 'had a turn' tick (GDA-27): shown on field and bench circles during a game. A shape, not just colour.
  const turnMark =
    (state.screen === "game" || state.screen === "halfTime") && hasHadTurn(openGame(state), player.id)
      ? h("span", { class: "turn", "aria-label": "Has had a bench turn", title: "Has had a bench turn" }, "\u2713")
      : null;
  return h(
    "div",
    {
      class: ["slot", player.id === state.selectedId ? "sel" : "", planned ? "plan" : ""].join(" ").trim(),
      ...(canMove ? { "data-player": player.id } : {}),
      ...(benchTimer ? { "data-bench": player.id } : {}), // Marks a timer circle; it is not draggable.
    },
    h(
      "div",
      { class: "ci" },
      avatar(player),
      benchTimer ? ring() : null,
      benchTimer ? h("span", { class: "tm" }) : null,
      turnMark,
      isKeeper ? h("span", { class: "gk" }, "\u{1F9E4}") : null
    ),
    h("div", { class: "nm" }, player.name)
  );
}

/** The ring round a bench circle. Its fill is set by drawBenchTimers, not here. */
const RING_LENGTH = 2 * Math.PI * 23;
function ring() {
  // Parsed as HTML so the browser puts the SVG parts in the right namespace.
  const holder = document.createElement("div");
  holder.innerHTML =
    '<svg class="rg" viewBox="0 0 52 52">' +
    '<circle class="r0" cx="26" cy="26" r="23"></circle>' +
    '<circle class="r1" cx="26" cy="26" r="23" transform="rotate(-90 26 26)"></circle></svg>';
  return holder.firstChild;
}

/** A position with nobody in it. The no-break space keeps it the same height as a filled one. */
function emptySlot(place, canMove, state) {
  const planned = state.screen === "game" && pairsOf(openGame(state)).some((pair) => pair.fieldId === null && pair.place === place);
  return h(
    "div",
    { class: planned ? "slot plan" : "slot", ...(canMove ? { "data-place": place } : {}) },
    h("div", { class: "ci" }, h("div", { class: "av em" })),
    h("div", { class: "nm" }, "\u00a0")
  );
}

function lineUpRow(title, rowClass, players, state, canMove, benchTimers = false) {
  const slots = players.map((player) => playerSlot(player, state, canMove, false, benchTimers));
  return h("div", { class: rowClass }, h("span", { class: "t" }, title), ...slots);
}

/** The bottom button. While a player is selected it acts on them instead. */
function lineUpButton(view, state, actions) {
  if (state.selectedId === null) {
    return h("button", { class: "btn pri", onclick: actions.readyForKickOff }, "Ready for kick-off");
  }
  return view.absent.some((player) => player.id === state.selectedId)
    ? h("button", { class: "btn pri", onclick: actions.markBackIn }, "Back in")
    : h("button", { class: "btn pri", onclick: actions.markAbsent }, "Absent");
}

/** The pitch and bench, shared by the line-up and the before-kick-off screen. */
function pitchAndBench(view, state, canMove, crowded, live = false) {
  const line = (places) =>
    h(
      "div",
      { class: "line" },
      ...places.map((place) => {
        const player = view.positions[place];
        return player ? playerSlot(player, state, canMove, place === 0) : emptySlot(place, canMove, state);
      })
    );
  // Forwards at the top and goal at the bottom. Place numbers are in game-rules.js.
  const pitch = h(
    "div",
    { class: crowded ? "pitch tight" : "pitch" },
    line([7, 8]),
    line([4, 5, 6]),
    line([1, 2, 3]),
    line([0])
  );
  if (live) {
    // Game under way: bench circles carry timers; nobody on the bench means no bench row.
    const rowClass = view.bench.length > 6 ? "row live many" : "row live";
    return view.bench.length > 0 ? [pitch, lineUpRow("BENCH", rowClass, view.bench, state, canMove, true)] : [pitch];
  }
  return [pitch, lineUpRow("BENCH", "row", view.bench, state, canMove)];
}

function openGame(state) {
  return state.games.find((candidate) => candidate.id === state.gameId);
}

function lineUpActions(view, state, actions) {
  return [problemLine(state.problem), lineUpButton(view, state, actions)].filter(Boolean);
}

function lineUpScreen(state, actions) {
  const game = openGame(state);
  const view = lineUpView(game, state.players);
  return {
    fixed: true,
    noMove: true,
    nodes: [
      header("1st-half line-up", actions.goHome, h("span", { class: "tag" }, game.formation)),
      h(
        "div",
        { class: "lu" },
        ...pitchAndBench(view, state, true, view.bench.length > 6 || view.absent.length > 6),
        view.absent.length > 0 ? lineUpRow("ABSENT", "row ab", view.absent, state, true) : null
      ),
      h("div", { class: "acts" }, ...lineUpActions(view, state, actions)),
    ],
  };
}

/** The row under the clock with the rotation chip. Tapping the chip opens the stepper. */
function rotationStrip(game, actions) {
  // The swap message (GDA-35) shares the strip with the chip; drawClock fills it in and hides it when empty.
  return h(
    "div",
    { class: "strip", id: "rotStrip" },
    h("button", { class: "chip", id: "rotChip", onclick: actions.openRotation }, `${rotationOf(game)} min`),
    h("div", { class: "sl", id: "swapMsg", hidden: true })
  );
}

/** The stepper sheet, drawn only while open. Done is the only way to close it. */
function rotationSheet(state, game, actions) {
  if (!state.rotationOpen) {
    return null;
  }
  return h(
    "div",
    { class: "scrim", id: "rotSheet" },
    h(
      "div",
      { class: "sheet" },
      rotationStepper(() => rotationOf(openGame(state)), actions.stepRotation),
      h("button", { class: "btn pri", id: "rotDone", onclick: actions.closeRotation }, "Done")
    )
  );
}

/** The clock bar at the top of the game screens: the half on the left, the time in the middle. */
function clockBar(text, half = "1ST HALF") {
  return h("div", { class: "clk" }, h("span", { class: "hf" }, half), h("b", { id: "clock" }, text));
}

/** Before kick-off: look, but not touch. The game has not started and nothing here is saved. */
function readyScreen(state, actions) {
  const game = openGame(state);
  const view = lineUpView(game, state.players);
  return {
    fixed: true,
    noMove: true,
    nodes: [
      clockBar("0:00"),
      rotationStrip(game, actions),
      h(
        "div",
        { class: "lu" },
        ...pitchAndBench(view, state, false, view.bench.length > 6 || view.absent.length > 6),
        // GDA-41: display only (canMove false), so a tap or drag on these does nothing.
        view.absent.length > 0 ? lineUpRow("ABSENT", "row ab", view.absent, state, false) : null
      ),
      h(
        "div",
        { class: "acts two" },
        problemLine(state.problem),
        h(
          "div",
          { class: "pair" },
          h("button", { class: "btn", onclick: actions.backToLineUp }, "Line-up"),
          h("button", { class: "btn pri", onclick: actions.startFirstHalf }, "START 1ST HALF")
        )
      ),
      rotationSheet(state, game, actions),
    ].filter(Boolean),
  };
}

/**
 * The game under way. The time is worked out from the saved start time every time
 * it is drawn. There is no Back arrow and no pause. End Half is always in the
 * bottom bar, one tap, no confirmation. The TIME strip and the black End Half are
 * always drawn but hidden, and drawClock shows them, so nothing is rebuilt as the
 * clock runs.
 */
function gameScreen(state, actions) {
  const game = openGame(state);
  const view = lineUpView(game, state.players);
  return {
    fixed: true,
    noMove: true,
    nodes: [
      state.welcome ? h("div", { class: "welcome", id: "welcome" }, "Welcome back") : null,
      clockBar(clockText(startedAtOf(game), Date.now()), game.state === "second half" ? "2ND HALF" : "1ST HALF"),
      rotationStrip(game, actions),
      h("div", { class: "strip time", id: "timeStrip", hidden: true }, h("span", { class: "big" }, "TIME")),
      h("div", { class: "lu" }, ...pitchAndBench(view, state, true, view.bench.length > 6, true)),
      swapRow(game, state, actions),
      h(
        "div",
        { class: "acts" },
        problemLine(state.problem),
        h("button", { class: "btn eh", id: "endHalf", onclick: actions.endHalf }, "End Half")
      ),
      rotationSheet(state, game, actions),
    ].filter(Boolean),
    after: () => {
      drawClock(state);
      drawPairLines(state);
    },
  };
}

/**
 * Above End Half: the Swap button while pairs are planned, or the Undo bar for about
 * 5 seconds after a Swap. Nothing when neither applies. (GDA-27 and GDA-35 add their
 * parts of the game screen next to this row; this row is the only one GDA-30 owns.)
 */
function swapRow(game, state, actions) {
  if (pairsOf(game).length > 0) {
    return h("div", { class: "swr" }, h("button", { class: "btn pri swp", id: "swap", onclick: actions.swap }, "Swap"));
  }
  if (state.undo && Date.now() < state.undo.until) {
    return h("div", { class: "swr" }, h("div", { class: "undo", id: "undo" }, h("span", {}, "Swap done"), h("button", { onclick: actions.undo }, "Undo")));
  }
  return null;
}

let lastActions = null;

/**
 * Draws a dotted line for each planned pair, from the bench circle to the position,
 * with a cross where the line leaves the bench. Worked out from where the circles
 * really are, so it also follows a pair when its child moves position.
 */
export function drawPairLines(state, actions = lastActions) {
  const area = document.querySelector(".lu");
  const game = openGame(state);
  area?.querySelectorAll(".pl, .px").forEach((old) => old.remove());
  if (!area || !game || state.screen !== "game" || pairsOf(game).length === 0) {
    return;
  }
  const box = area.getBoundingClientRect();
  const centre = (slot) => {
    const c = slot.querySelector(".ci").getBoundingClientRect();
    return { x: c.left + c.width / 2 - box.left, y: c.top + c.height / 2 - box.top };
  };
  const edge = (area.querySelector(".row.live")?.getBoundingClientRect().top ?? box.bottom) - box.top;
  let lines = "";
  const crosses = h("div", { class: "px" });
  for (const pair of pairsOf(game)) {
    const from = area.querySelector(`.row.live [data-player="${pair.benchId}"]`);
    const to = area.querySelector(pair.fieldId !== null ? `.pitch [data-player="${pair.fieldId}"]` : `.pitch [data-place="${pair.place}"]`);
    if (!from || !to) {
      continue;
    }
    const a = centre(from);
    const b = centre(to);
    lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#111" stroke-width="4" stroke-dasharray="3 7" stroke-linecap="round"></line>`;
    const along = b.y === a.y ? 0.5 : (edge - a.y) / (b.y - a.y);
    const x = Math.max(22, Math.min(box.width - 22, a.x + (b.x - a.x) * along));
    crosses.append(
      h("button", { class: "xx", "aria-label": "Remove pair", style: `left:${x}px;top:${edge}px`, onclick: () => actions.unpair(pair.benchId) }, h("span", {}, "\u00d7"))
    );
  }
  // Parsed as HTML so the browser puts the SVG parts in the right namespace.
  const holder = document.createElement("div");
  holder.innerHTML = `<svg class="pl">${lines}</svg>`;
  area.append(holder.firstChild, crosses);
}

/** Moves the clock, the TIME strip and the End Half colour on, without redrawing the screen. Safe at any moment. */
export function drawClock(state) {
  const game = openGame(state);
  const clock = document.getElementById("clock");
  if (state.screen === "game" && game && clock) {
    const now = Date.now();
    clock.textContent = clockText(startedAtOf(game), now);
    const timeUp = isTimeUp(startedAtOf(game), now);
    const stripChanged = document.getElementById("timeStrip").hidden === timeUp;
    document.getElementById("timeStrip").hidden = !timeUp;
    document.getElementById("rotStrip").hidden = timeUp; // The TIME strip takes its place.
    document.getElementById("endHalf").classList.toggle("pri", timeUp);
    drawBenchTimers(game, now);
    const msgChanged = drawSwapMessage(game, state.players, now, timeUp);
    if (stripChanged || msgChanged) {
      drawPairLines(state); // The strip changes the height above, so the lines move with it.
    }
  }
}

/**
 * Fills the swap message into the strip: yellow "SWAP IN 0:30" as a warning, black
 * "SWAP TIME" when due, red with "+1:10" once it is late (30 seconds or more; before
 * that the plus shows but the colour stays black). The words carry the message, not
 * colour alone. Gives true when the strip changed height, so the pair lines can follow.
 */
function drawSwapMessage(game, squad, now, timeUp) {
  const strip = document.getElementById("rotStrip");
  const box = document.getElementById("swapMsg");
  const message = timeUp ? null : swapMessage(game, squad, now);
  const wasShown = !box.hidden;
  if (!message) {
    box.hidden = true;
    box.textContent = "";
    strip.className = "strip";
    return wasShown;
  }
  const name = (id) => squad.find((player) => player.id === id)?.name ?? "";
  const mmss = (total) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  const title = message.phase === "warn" ? `SWAP IN ${mmss(message.countdown)}` : message.late > 0 ? `SWAP TIME +${mmss(message.late)}` : "SWAP TIME";
  // Lines: "Off A, B -> On C, D" for planned partners, then "On ..." for due players with no plan.
  const lines = [];
  const planned = message.paired;
  if (planned.length > 0) {
    lines.push({ off: planned.map((pair) => name(pair.offId)).join(", "), on: planned.map((pair) => name(pair.onId)).join(", ") });
  }
  const unplanned = message.onIds.filter((id) => !planned.some((pair) => pair.onId === id));
  if (unplanned.length > 0) {
    lines.push({ off: null, on: unplanned.map(name).join(", ") });
  }
  const key = title + "|" + lines.map((line) => `${line.off}>${line.on}`).join("|");
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    const row = (line) =>
      line.off === null
        ? h("div", {}, h("b", {}, "On"), ` ${line.on}`)
        : h("div", {}, h("b", {}, "Off"), ` ${line.off} \u2192 `, h("b", {}, "On"), ` ${line.on}`);
    box.replaceChildren(h("div", { class: "big" }, title), ...lines.map(row));
  }
  box.hidden = false;
  strip.className = "strip " + (message.phase === "warn" ? "warn" : message.late >= 30 ? "late" : "swap");
  return !wasShown;
}

/** Sets each bench circle's time and ring from the saved times. Same path as the clock, so a lock or reload cannot skew it. */
function drawBenchTimers(game, now) {
  const rotation = rotationOf(game); // Read every tick, so a changed length shows at once.
  for (const slot of document.querySelectorAll(".row.live .slot[data-bench]")) {
    const seconds = benchSeconds(game, slot.dataset.bench, now);
    slot.querySelector(".tm").textContent = benchTimerText(seconds);
    slot.querySelector(".r1").setAttribute("stroke-dasharray", `${(ringFraction(seconds, rotation) * RING_LENGTH).toFixed(1)} ${RING_LENGTH.toFixed(1)}`);
    slot.classList.toggle("lt", isBenchLate(seconds, rotation));
  }
}

/**
 * Temporary (GDA-50 replaces it): the second half's End Half screen with the
 * stopped clock, a back arrow and Finish test game. Remove with GDA-50.
 */
function halfOverScreen(state, actions) {
  const game = openGame(state);
  return {
    nodes: [
      header("", actions.backToGame),
      h(
        "div",
        { class: "body" },
        h("div", { class: "stop", id: "stopped" }, clockText(startedAtOf(game), endedAtOf(game))),
        h("button", { class: "btn pri big", onclick: actions.finishTestGame }, "Finish test game")
      ),
    ],
  };
}

/**
 * Half Time (GDA-31 and GDA-20): the second-half line-up, which starts as a copy of
 * where everyone stood at End Half. Same placing rules as the first-half line-up
 * (placed at once, by drag or tap). No clock, no timers, no ABSENT row (absent stays
 * absent). The back arrow cancels End Half. Start 2nd Half starts the clock at once.
 */
function halfTimeScreen(state, actions) {
  const game = openGame(state);
  const view = lineUpView(game, state.players);
  return {
    fixed: true,
    noMove: true,
    nodes: [
      h("div", { class: "hdr ht" }, h("button", { class: "back", "aria-label": "Back", onclick: actions.backToGame }, "\u2039"), h("h1", {}, "HALF TIME")),
      h("div", { class: "lu" }, ...pitchAndBench(view, state, true, view.bench.length > 6)),
      h("div", { class: "acts" }, problemLine(state.problem), h("button", { class: "btn pri", id: "startSecond", onclick: actions.startSecondHalf }, "Start 2nd Half")),
    ],
  };
}

function cannotOpenScreen(state, actions) {
  return {
    nodes: [
      header("Game Day"),
      h(
        "div",
        { class: "body" },
        h("div", { class: "msg" }, "Could not open your saved players"),
        h("button", { class: "btn pri", onclick: actions.tryAgain }, "Try again")
      ),
    ],
  };
}

const SCREENS = {
  home: homeScreen,
  squad: squadScreen,
  add: addScreen,
  edit: editScreen,
  createGame: createGameScreen,
  lineUp: lineUpScreen,
  ready: readyScreen,
  game: gameScreen,
  halfTime: halfTimeScreen,
  over: halfOverScreen,
  cannotOpen: cannotOpenScreen,
};

/** Replaces what is on screen with the screen named in state.screen. */
export function drawScreen(state, actions) {
  lastActions = actions;
  const view = SCREENS[state.screen](state, actions);
  document.getElementById("screen").replaceChildren(...view.nodes);
  document.getElementById("frame").className = view.fixed ? "fix" : "flow";
  document.body.classList.toggle("lock", Boolean(view.fixed));
  document.body.classList.toggle("nomove", Boolean(view.noMove));
  view.after?.(); // The game screen shows TIME at once if the half is already over time.
}

/**
 * Redraws only the bottom of the line-up. A drag starting needs this: redrawing the
 * whole screen would remove the circle under the finger and end the drag.
 */
export function drawLineUpActions(state, actions) {
  const view = lineUpView(openGame(state), state.players);
  document.querySelector(".acts").replaceChildren(...lineUpActions(view, state, actions));
}
