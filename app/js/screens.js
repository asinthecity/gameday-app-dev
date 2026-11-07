// Builds each screen from the current state. Nothing here saves anything: taps
// go to the `actions` that main.js passes in.
//
// Names only ever reach the page as plain text (never as HTML), so a name
// containing < or & just shows as typed.

import { canCreateGame, formatGameDate, formatKickOff, isBlank, lineUpView } from "./game-rules.js";
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
  const cards = state.games.map((game) => gameCard(game, actions));
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
function playerSlot(player, state, canMove, isKeeper = false) {
  return h(
    "div",
    {
      class: player.id === state.selectedId ? "slot sel" : "slot",
      ...(canMove ? { "data-player": player.id } : {}),
    },
    h("div", { class: "ci" }, avatar(player), isKeeper ? h("span", { class: "gk" }, "\u{1F9E4}") : null),
    h("div", { class: "nm" }, player.name)
  );
}

/** A position with nobody in it. The no-break space keeps it the same height as a filled one. */
function emptySlot(place, canMove) {
  return h(
    "div",
    { class: "slot", ...(canMove ? { "data-place": place } : {}) },
    h("div", { class: "ci" }, h("div", { class: "av em" })),
    h("div", { class: "nm" }, "\u00a0")
  );
}

function lineUpRow(title, rowClass, players, state, canMove) {
  const slots = players.map((player) => playerSlot(player, state, canMove));
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
function pitchAndBench(view, state, canMove, crowded) {
  const line = (places) =>
    h(
      "div",
      { class: "line" },
      ...places.map((place) => {
        const player = view.positions[place];
        return player ? playerSlot(player, state, canMove, place === 0) : emptySlot(place, canMove);
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

/** Before kick-off: look, but not touch. The game has not started and nothing here is saved. */
function readyScreen(state, actions) {
  const game = openGame(state);
  const view = lineUpView(game, state.players);
  return {
    fixed: true,
    noMove: true,
    nodes: [
      header(`vs ${game.opposition}`),
      h("div", { class: "lu" }, ...pitchAndBench(view, state, false, view.bench.length > 6)),
      h("div", { class: "acts" }, h("button", { class: "btn", onclick: actions.backToLineUp }, "Line-up")),
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
  cannotOpen: cannotOpenScreen,
};

/** Replaces what is on screen with the screen named in state.screen. */
export function drawScreen(state, actions) {
  const view = SCREENS[state.screen](state, actions);
  document.getElementById("screen").replaceChildren(...view.nodes);
  document.getElementById("frame").className = view.fixed ? "fix" : "flow";
  document.body.classList.toggle("lock", Boolean(view.fixed));
  document.body.classList.toggle("nomove", Boolean(view.noMove));
}

/**
 * Redraws only the bottom of the line-up. A drag starting needs this: redrawing the
 * whole screen would remove the circle under the finger and end the drag.
 */
export function drawLineUpActions(state, actions) {
  const view = lineUpView(openGame(state), state.players);
  document.querySelector(".acts").replaceChildren(...lineUpActions(view, state, actions));
}
