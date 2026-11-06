// Builds each screen from the current state. Nothing here saves anything: taps
// go to the `actions` that main.js passes in.
//
// Names only ever reach the page as plain text (never as HTML), so a name
// containing < or & just shows as typed.

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

function header(title, onBack) {
  const back = onBack ? h("button", { class: "back", "aria-label": "Back", onclick: onBack }, "‹") : null;
  return h("div", { class: "hdr" }, back, h("h1", {}, title));
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

function homeScreen(state, actions) {
  const hasPlayers = state.players.length > 0;
  const squadPart = hasPlayers
    ? [h("button", { class: "btn", onclick: actions.openSquad }, `Squad (${state.players.length})`)]
    : [
        h("div", { class: "msg" }, "Add your players"),
        h("button", { class: "btn pri big", onclick: actions.addFromHome }, "+ Add players"),
      ];
  return {
    nodes: [header("Game Day v2"), h("div", { class: "body" }, updateCard(state.updateNotice, actions), ...squadPart)],
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

function cannotOpenScreen(state, actions) {
  return {
    nodes: [
      header("Game Day v2"),
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
  cannotOpen: cannotOpenScreen,
};

/** Replaces what is on screen with the screen named in state.screen. */
export function drawScreen(state, actions) {
  const view = SCREENS[state.screen](state, actions);
  document.getElementById("screen").replaceChildren(...view.nodes);
  document.getElementById("frame").className = view.fixed ? "fix" : "flow";
  document.body.className = view.fixed ? "lock" : "";
}
