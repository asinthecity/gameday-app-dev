// Builds each screen from the current state. Nothing here saves anything: taps
// go to the `actions` that main.js passes in.
//
// Names only ever reach the page as plain text (never as HTML), so a name
// containing < or & just shows as typed.

import { hasRecord, scorerSummary, csvFileName } from "./record-rules.js";
import { FINISHED, startedAtOf, endedAtOf, benchSeconds, benchTimerText, canCreateGame, clockText, isBenchLate, ringFraction, formatGameDate, formatKickOff, isBlank, isTimeUp, lineUpView, swapMessage, pairsOf, benchNumberOf, rotationOf, MIN_ROTATION, MAX_ROTATION, scoreOf, scoreText, canAddGoal, canRemoveLastGoal, fieldPlayerIds, lastGoal, US, goalsOf } from "./game-rules.js";
import { archiveWarning, canDeleteGame, sheetStatus } from "./sheet-rules.js";
import { canSaveName, initialsFor } from "./squad-rules.js";
import { UPGRADE_FAILED_MESSAGE } from "./team-rules.js";

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

function header(title, onBack, right = null, extra = null) {
  const back = onBack ? h("button", { class: "back", "aria-label": "Back", onclick: onBack }, "‹") : null;
  return h("div", { class: "hdr" }, back, h("h1", {}, title), right, extra);
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

/** The ⋯ button in its own area, so tapping it never opens the game (GDA-69). */
function menuButton(game, actions) {
  return h("button", { class: "ic menuBtn", "aria-label": "Game menu", onclick: () => actions.openMenu(game.id) }, "\u22ef");
}

/** The small menu under a card's ⋯ button. A transparent cover behind it closes it when I tap away. */
function cardMenu(game, state, actions, items) {
  if (state.menuId !== game.id) {
    return null;
  }
  return h(
    "div",
    {},
    h("div", { class: "menuCover", onclick: actions.closeMenu }),
    h("div", { class: "pop cardMenu" }, ...items)
  );
}

function gameCard(game, state, actions) {
  // Only a game not started has a menu (Delete). A game in progress has none.
  const hasMenu = canDeleteGame(game);
  return h(
    "div",
    { class: "card game" },
    h(
      "div",
      { class: "head" },
      h("div", { class: "info" }, h("b", {}, `vs ${game.opposition}`), h("div", {}, `${formatGameDate(game.date)} \u00b7 ${formatKickOff(game.kickOff)}`), h("div", {}, game.venue)),
      hasMenu ? h("div", { class: "menuwrap" }, menuButton(game, actions)) : null
    ),
    hasMenu
      ? cardMenu(game, state, actions, [h("button", { class: "mi d deleteGame", onclick: () => actions.askDelete(game.id) }, "Delete")])
      : null,
    h("button", { class: "btn", onclick: () => actions.openLineUp(game.id) }, "Line-up")
  );
}

const FILE_PROBLEM = "Could not make the file. The game itself is saved. Try Save file again.";

/** The Sheet line on a finished game (GDA-47): Sent / Sending / Not sent yet + Send now / Sheet not set up. */
function sheetLine(game, state, actions) {
  const status = sheetStatus(game, state.sheetSettings, state.sendingId, state.sheetProblem[game.id]);
  if (!status) {
    return [];
  }
  const line = (text) => h("div", { class: "sheetStatus", "data-status": status.kind }, h("b", {}, text));
  if (status.kind === "sent") {
    return [h("div", { class: "sheetStatus ok", "data-status": "sent" }, h("b", {}, "\u2713 Sent to the Sheet"))];
  }
  if (status.kind === "sending") {
    return [line("Sending\u2026")];
  }
  if (status.kind === "notSetUp") {
    return [line("Sheet not set up"), h("button", { class: "btn", onclick: actions.openSheetSettings }, "Sheet settings")];
  }
  return [
    h("div", { class: "sheetStatus err", "data-status": "notSent" }, h("b", {}, status.checkSettings ? "Not sent yet - check Sheet settings" : "Not sent yet")),
    h("button", { class: "btn pri sendNow", onclick: () => actions.sendNow(game.id) }, "Send now"),
  ];
}

/** A finished game on Home: the result, its Sheet status and a ⋯ menu (Save file, Archive). No history screen. */
function finishedCard(game, state, actions) {
  const failed = state.fileProblemFor === game.id;
  return h(
    "div",
    { class: "card finished", "data-game": game.id },
    h(
      "div",
      { class: "head" },
      h("div", { class: "info" }, h("b", {}, `vs ${game.opposition} \u00b7 ${game.record.us} - ${game.record.them}`), h("div", {}, `${formatGameDate(game.date)} \u00b7 Finished`)),
      h("div", { class: "menuwrap" }, menuButton(game, actions))
    ),
    cardMenu(game, state, actions, [
      h("button", { class: "mi saveFile", onclick: () => actions.saveFile(game.id) }, "Save file"),
      h("button", { class: "mi d archiveGame", onclick: () => actions.askArchive(game.id) }, "Archive"),
    ]),
    ...sheetLine(game, state, actions),
    failed ? h("p", { class: "problem", role: "alert" }, FILE_PROBLEM) : null
  );
}

const ARCHIVE_WARNINGS = {
  notInSheet: "Warning: this game is not in the Sheet yet. Tap Cancel, then Send now or Save file first.",
  noStatus: "Warning: this older game has no Sheet record. Tap Cancel and Save file first.",
};

/** "Archive v Eagles from the list?" with one confirm and, if the game is not in the Sheet, a red warning (GDA-69). */
function archiveSheet(state, actions) {
  const game = state.games.find((g) => g.id === state.archiveId);
  if (!game) {
    return null;
  }
  const warning = archiveWarning(game);
  return h(
    "div",
    { class: "scrim", id: "archiveConfirm" },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, `Archive v ${game.opposition} from the list?`),
      h("p", { class: "archiveNote" }, warning === null ? "It stays saved on this phone and in the Sheet." : "It stays saved on this phone."),
      warning ? h("p", { class: "archiveWarn", role: "alert" }, ARCHIVE_WARNINGS[warning]) : null,
      h("button", { class: "btn del", id: "confirmArchive", onclick: actions.confirmArchive }, "Archive"),
      h("button", { class: "btn", id: "cancelArchive", onclick: actions.cancelArchive }, "Cancel")
    )
  );
}

/** "Delete the game v Eagles on Sun 15 Nov?" with one confirm (GDA-66). */
function deleteSheet(state, actions) {
  const game = state.games.find((g) => g.id === state.deleteId);
  if (!game) {
    return null;
  }
  return h(
    "div",
    { class: "scrim", id: "deleteConfirm" },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, `Delete the game v ${game.opposition} on ${formatGameDate(game.date)}? This can't be undone.`),
      h("button", { class: "btn del", id: "confirmDelete", onclick: actions.confirmDelete }, "Delete"),
      h("button", { class: "btn", id: "cancelDelete", onclick: actions.cancelDelete }, "Cancel")
    )
  );
}

/** Sheet settings (GDA-47): the script's web address and secret, kept only on this phone. */
function sheetSettingsScreen(state, actions) {
  const settings = state.sheetDraft ?? state.sheetSettings ?? {};
  const field = (id, label, value, type) => {
    const input = h("input", { id, type, autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false" });
    input.value = value ?? "";
    return h("div", { class: "f" }, h("label", { for: id }, h("span", {}, label)), input);
  };
  return {
    nodes: [
      header("Sheet settings", actions.goHome),
      h(
        "div",
        { class: "body" },
        field("sheetUrl", "Sheet web address", settings.url, "text"),
        field("sheetSecret", "Secret", settings.secret, "password"),
        problemLine(state.problem),
        state.sheetSaved ? h("p", { id: "sheetSaved" }, 'Saved. Games marked "Sheet not set up" now show Send now.') : null,
        h("button", { class: "btn pri big", id: "saveSheet", onclick: actions.saveSheetSettings }, "Save")
      ),
    ],
  };
}

function homeScreen(state, actions) {
  // The saved data could not be upgraded and was left as it was: say so, and never show an empty squad.
  if (state.upgradeFailed) {
    return {
      nodes: [header("Game Day"), h("div", { class: "body" }, h("div", { class: "problem upgradeFailed" }, UPGRADE_FAILED_MESSAGE))],
    };
  }
  const hasPlayers = state.players.length > 0;
  const createButton = hasPlayers
    ? h("button", { class: "btn pri big", onclick: actions.openCreateGame }, "+ Create game")
    : null;
  const cards = state.games.filter((game) => game.state !== FINISHED).map((game) => gameCard(game, state, actions));
  // Finished games with a record keep one Save file button. Old test games (no record) stay hidden.
  const finished = state.games.filter((game) => hasRecord(game) && !game.archived).map((game) => finishedCard(game, state, actions));
  const addPlayers = hasPlayers
    ? []
    : [
        h("div", { class: "msg" }, "Add your players"),
        h("button", { class: "btn pri big", onclick: actions.addFromHome }, "+ Add players"),
      ];
  // The ☰ menu at the top holds Squad and Sheet settings (GDA-69).
  const topMenu = h(
    "div",
    { class: "menuwrap topMenuWrap" },
    h("button", { class: "ic topMenuBtn", "aria-label": "Menu", onclick: actions.openTopMenu }, "\u2630"),
    // The items stay in the page but hidden until ☰ is tapped.
    h(
      "div",
      {},
      state.topMenuOpen ? h("div", { class: "menuCover", onclick: actions.closeMenu }) : null,
      h(
        "div",
        { class: "pop topMenu" + (state.topMenuOpen ? " show" : "") },
        // With no players, "+ Add players" on Home does the job, so the Squad item waits until there is a squad.
        hasPlayers ? h("button", { class: "mi squadItem", onclick: actions.openSquad }, `Squad (${state.players.length})`) : null,
        h("button", { class: "mi sheetSettings", onclick: actions.openSheetSettings }, "Sheet settings")
      )
    )
  );
  return {
    nodes: [
      header("Game Day", null, topMenu),
      h(
        "div",
        { class: "body" },
        updateCard(state.updateNotice, actions),
        problemLine(state.problem),
        createButton,
        ...cards,
        ...finished,
        ...addPlayers
      ),
      deleteSheet(state, actions),
      archiveSheet(state, actions),
    ].filter(Boolean),
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
  // The bench-order number (GDA-56): shown on field and bench circles during a game. A number, not just colour.
  const number = (state.screen === "game" || state.screen === "halfTime") ? benchNumberOf(openGame(state), player.id) : null;
  const turnMark = number ? h("span", { class: "turn", "aria-label": `Bench order ${number}`, title: `Bench order ${number}` }, String(number)) : null;
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

function lineUpRow(title, rowClass, players, state, canMove, benchTimers = false, zone = null) {
  const slots = players.map((player) => playerSlot(player, state, canMove, false, benchTimers));
  // `zone` makes the whole row a drop target (GDA-62): "absent" or "bench", line-up screen only.
  return h("div", { class: rowClass, ...(zone ? { "data-zone": zone } : {}) }, h("span", { class: "t" }, title), ...slots);
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
  return [pitch, lineUpRow("BENCH", "row", view.bench, state, canMove, false, state.screen === "lineUp" ? "bench" : null)];
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
      header("1st-half line-up", actions.goHome, h("span", { class: "tag" }, game.formation), cogButton(actions)),
      h(
        "div",
        { class: "lu" },
        ...pitchAndBench(view, state, true, view.bench.length > 6 || view.absent.length > 6),
        // GDA-62: always there, below the bench, even when empty (then slim).
        lineUpRow("ABSENT", view.absent.length > 0 ? "row ab" : "row ab empty", view.absent, state, true, false, "absent")
      ),
      h("div", { class: "acts" }, ...lineUpActions(view, state, actions)),
      gameDetailsSheet(state, game, actions),
    ],
  };
}

/** The settings cog (GDA-64): opens the Game details sheet. Sits at the far edge, away from the game buttons. */
function cogButton(actions) {
  return h("button", { class: "cog", id: "cog", "aria-label": "Game details", onclick: actions.openRotation }, "\u2699");
}

/**
 * The Game details sheet (GDA-64), drawn only while open: the rotation length stepper,
 * opposition and date as read-only text, and Done. Each tap on - or + is saved at once;
 * Done only closes the sheet.
 */
function gameDetailsSheet(state, game, actions) {
  if (!state.rotationOpen) {
    return null;
  }
  return h(
    "div",
    { class: "scrim", id: "rotSheet" },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, "Game details"),
      h("div", { class: "lbl" }, "Rotation length"),
      rotationStepper(() => rotationOf(openGame(state)), actions.stepRotation),
      h("div", { class: "ro", id: "detOpp" }, `Opposition: ${game.opposition}`),
      h("div", { class: "ro", id: "detDate" }, `Date: ${formatGameDate(game.date)}`),
      h("button", { class: "btn pri", id: "rotDone", onclick: actions.closeRotation }, "Done")
    )
  );
}

/**
 * The score for the top band (GDA-40): "US 2 - 1 THEM", counted from the saved goals,
 * always labelled. With `actions` it is a button (tap = Remove last goal, GDA-39);
 * without, it is plain text (before kick-off, nothing to remove).
 */
function scoreBox(game, actions) {
  const score = scoreOf(game);
  const side = (label, n, id) => h("span", { class: "s" }, h("small", {}, label), h("span", { id }, String(n)));
  const parts = [side("US", score.us, "scoreUs"), h("span", { class: "dash" }, "-"), side("THEM", score.them, "scoreThem")];
  if (!actions) {
    return h("div", { class: "score", id: "score" }, ...parts);
  }
  return h("button", { class: "score", id: "score", "aria-label": `Score, us ${score.us}, them ${score.them}. Tap to remove the last goal`, onclick: actions.openRemoveGoal }, ...parts);
}

/** The bar at the top of the game screens: the score on the left, the half and the time on the right. */
function clockBar(text, half, game, actions, cogActions) {
  return h("div", { class: "clk" }, scoreBox(game, actions), h("div", { class: "ck" }, h("span", { class: "hf" }, half), h("b", { id: "clock" }, text)), cogButton(cogActions));
}

/** Before kick-off: look, but not touch. The game has not started and nothing here is saved. */
function readyScreen(state, actions) {
  const game = openGame(state);
  const view = lineUpView(game, state.players);
  return {
    fixed: true,
    noMove: true,
    nodes: [
      clockBar("0:00", "1ST HALF", game, null, actions),
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
      gameDetailsSheet(state, game, actions),
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
      clockBar(clockText(startedAtOf(game), Date.now()), game.state === "second half" ? "2ND HALF" : "1ST HALF", game, actions, actions),
      swapStrip(game, state, actions),
      h("div", { class: "lu" }, ...pitchAndBench(view, state, true, view.bench.length > 6, true)),
      h(
        "div",
        { class: "acts" },
        problemLine(state.problem),
        h(
          "div",
          { class: "gr" },
          h("button", { class: "btn pri", id: "goalUs", onclick: actions.goalUs }, "GOAL - US"),
          h("button", { class: "btn", id: "goalThem", onclick: actions.goalAgainst }, "Goal against"),
          h("button", { class: "btn eh", id: "endHalf", onclick: actions.endHalf }, "End Half")
        )
      ),
      goalToast(state, actions),
      gameDetailsSheet(state, game, actions),
      goalSheet(state, game, actions),
      removeGoalSheet(state, game, actions),
    ].filter(Boolean),
    after: () => {
      drawClock(state);
      drawPairLines(state);
    },
  };
}

/** The toast after a goal: what happened, and Undo for about 5 seconds (GDA-37/38/39). Floats, so nothing moves. */
function goalToast(state, actions) {
  const toast = state.goalToast;
  if (!toast || Date.now() >= toast.until) {
    return null;
  }
  return h("div", { class: "toast", id: "goalToast" }, h("span", {}, toast.text), h("button", { id: "goalUndo", onclick: actions.undoGoal }, "Undo"));
}

/** "Who scored?": the players on the field now, plus Not sure. Cancel or a tap outside adds nothing. */
function goalSheet(state, game, actions) {
  if (!state.goalSheet || !canAddGoal(game)) {
    return null;
  }
  const names = fieldPlayerIds(game).map((id) => state.players.find((player) => player.id === id)).filter(Boolean);
  return h(
    "div",
    { class: "scrim goal", id: "goalSheet", onclick: (event) => event.target === event.currentTarget && actions.closeGoalSheet() },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, "Who scored?"),
      h("div", { class: "grid" }, ...names.map((player) => h("button", { class: "btn", "data-scorer": player.id, onclick: () => actions.chooseScorer(player.id) }, player.name)), h("button", { class: "btn", id: "notSure", onclick: () => actions.chooseScorer(null) }, "Not sure")),
      h("button", { class: "btn", id: "goalCancel", onclick: actions.closeGoalSheet }, "Cancel")
    )
  );
}

/** The one confirm for Remove last goal: names the goal and the new score. */
function removeGoalSheet(state, game, actions) {
  const goal = lastGoal(game);
  if (!state.removeOpen || !goal) {
    return null;
  }
  const score = scoreOf(game);
  const after = { us: score.us - (goal.side === US ? 1 : 0), them: score.them - (goal.side === US ? 0 : 1) };
  const scorer = state.players.find((player) => player.id === goal.scorerId)?.name;
  const what = goal.side === US ? (scorer ? `${scorer}'s goal for us.` : "A goal for us (scorer not sure).") : "A goal against us.";
  return h(
    "div",
    { class: "scrim goal", id: "removeSheet", onclick: (event) => event.target === event.currentTarget && actions.closeRemoveGoal() },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, "Remove last goal?"),
      h("p", { class: "rmtext" }, what, h("br"), h("b", {}, `Score goes from ${scoreText(score)} to ${scoreText(after)}.`)),
      h("div", { class: "pair" }, h("button", { class: "btn", id: "removeCancel", onclick: actions.closeRemoveGoal }, "Cancel"), h("button", { class: "btn pri", id: "removeConfirm", onclick: actions.confirmRemoveGoal }, "Remove goal"))
    )
  );
}

/**
 * The one fixed-height strip under the clock (GDA-63). It holds, one at a time, the Swap
 * Time message (drawSwapMessage fills it in), "Swap done / Undo" for about 5 seconds after
 * a Swap, or TIME when the half is over (drawClock shows it). The Swap button sits beside
 * the message or TIME while pairs are planned. The height never changes, so the pitch and
 * bench never move. The rules for Swap, Undo and the message are unchanged.
 */
function swapStrip(game, state, actions) {
  const planned = pairsOf(game).length > 0;
  const undoShown = !planned && state.undo && Date.now() < state.undo.until;
  return h(
    "div",
    { class: "strip", id: "strip" },
    h("div", { class: "sl", id: "swapMsg", hidden: true }),
    h("div", { class: "sl time", id: "timeStrip", hidden: true }, h("span", { class: "big" }, "TIME")),
    undoShown ? h("div", { class: "undo", id: "undo" }, h("span", {}, "Swap done"), h("button", { onclick: actions.undo }, "Undo")) : null,
    planned ? h("button", { class: "btn pri swp", id: "swap", onclick: actions.swap }, "Swap") : null
  );
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
    document.getElementById("timeStrip").hidden = !timeUp; // TIME takes the message's place in the same strip.
    document.getElementById("endHalf").classList.toggle("pri", timeUp);
    drawBenchTimers(game, now);
    drawSwapMessage(game, state.players, now, timeUp);
    // The strip never changes height, so the pair lines never need redrawing here.
  }
}

/**
 * Fills the swap message into the strip: yellow "SWAP IN 0:30" as a warning, black
 * "SWAP TIME" when due, red with "+1:10" once it is late (30 seconds or more; before
 * that the plus shows but the colour stays black). The words carry the message, not
 * colour alone. Gives true when the strip changed height, so the pair lines can follow.
 */
function drawSwapMessage(game, squad, now, timeUp) {
  const strip = document.getElementById("strip");
  const box = document.getElementById("swapMsg");
  const message = timeUp ? null : swapMessage(game, squad, now);
  const wasShown = !box.hidden;
  if (!message) {
    box.hidden = true;
    box.textContent = "";
    strip.className = timeUp ? "strip timeup" : "strip";
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
 * Full Time (GDA-50): shown after the second half's End Half. FULL TIME saves the
 * record and closes the game for good. Back returns to the game (for a last goal).
 */
function halfOverScreen(state, actions) {
  const game = openGame(state);
  const score = scoreOf(game);
  const nameOf = (id) => state.players.find((p) => p.id === id)?.name ?? null;
  const { named, unsure } = scorerSummary(goalsOf(game).map((g) => ({ side: g.side, scorer: g.side === US && g.scorerId !== null ? nameOf(g.scorerId) : null })));
  return {
    nodes: [
      header("Full Time", actions.backToGame),
      h(
        "div",
        { class: "body" },
        h("div", { class: "lbl" }, `FINAL SCORE v ${game.opposition}`),
        h("div", { class: "bigscore", id: "finalScore" }, `${score.us} - ${score.them}`),
        h("div", { class: "card", id: "scorers" }, h("b", {}, "Scorers"), h("div", {}, named || "No goals for us"), h("div", {}, `Not sure ${unsure}`)),
        h("p", { class: "final" }, "Cannot be reopened. Need a last goal? Tap Back first."),
        problemLine(state.problem),
        h("button", { class: "btn pri big", id: "fullTime", onclick: actions.fullTime }, "FULL TIME")
      ),
    ],
  };
}

/** Saved (GDA-50): the record is stored. Save file offers the CSV; Done goes Home. */
function savedScreen(state, actions) {
  const game = state.games.find((g) => g.id === state.gameId);
  const record = game?.record;
  return {
    nodes: [
      header("Saved"),
      h(
        "div",
        { class: "body" },
        h("div", { class: "lbl" }, `Game saved v ${game?.opposition ?? ""}`),
        h("div", { class: "bigscore", id: "finalScore" }, record ? `${record.us} - ${record.them}` : ""),
        record ? h("div", { class: "fname" }, `File name: ${csvFileName(record)}`) : null,
        h("p", {}, "Your game is safe on this phone. No swap, goal or Undo can be reached now. You can save the file later from Home."),
        state.fileProblemFor === game?.id ? h("p", { class: "problem", role: "alert" }, FILE_PROBLEM) : null,
        h("button", { class: "btn pri big saveFile", onclick: () => actions.saveFile(game.id) }, state.fileProblemFor === game?.id ? "Save file again" : "Save file"),
        h("button", { class: "btn big", id: "done", onclick: actions.goHome }, "Done")
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
      h("div", { class: "hdr ht" }, h("button", { class: "back", "aria-label": "Back", onclick: actions.backToGame }, "\u2039"), h("h1", {}, "HALF TIME"), scoreBox(game, canRemoveLastGoal(game) ? actions : null), cogButton(actions)),
      h("div", { class: "lu" }, ...pitchAndBench(view, state, true, view.bench.length > 6)),
      h("div", { class: "acts" }, problemLine(state.problem), h("button", { class: "btn pri", id: "startSecond", onclick: actions.startSecondHalf }, "Start 2nd Half")),
      removeGoalSheet(state, game, actions),
      gameDetailsSheet(state, game, actions),
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
  saved: savedScreen,
  sheetSettings: sheetSettingsScreen,
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
