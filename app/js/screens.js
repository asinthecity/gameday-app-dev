// Builds each screen from the current state. Nothing here saves anything: taps
// go to the `actions` that main.js passes in.
//
// Names only ever reach the page as plain text (never as HTML), so a name
// containing < or & just shows as typed.

import { hasRecord, scorerSummary, csvFileName } from "./record-rules.js";
import { trimmedLine } from "./drag.js";
import { FINISHED, canChangeWhoIsHere, startedAtOf, endedAtOf, benchSeconds, benchTimerText, canCreateGame, clockText, isBenchLate, ringFraction, frozenRingLook, formatGameDate, formatKickOff, isBlank, isTimeUp, lineUpView, swapMessage, pairsOf, benchNumberOf, rotationOf, halfOf, MIN_ROTATION, NOT_STARTED, scoreOf, scoreText, canAddGoal, canRemoveLastGoal, fieldPlayerIds, lastGoal, US, goalsOf } from "./game-rules.js";
import { checkFormation, formatFormationDigits, pitchRows } from "./formation-rules.js";
import { archiveWarning, canDeleteGame, sheetStatus } from "./sheet-rules.js";
import { canSaveName, initialsFor } from "./squad-rules.js";
import { canSwitchTeams, deleteRefusal, deleteSummary, IN_PROGRESS_REFUSAL, LAST_TEAM_MESSAGE, LOCKED_MESSAGE, plural, UPGRADE_FAILED_MESSAGE } from "./team-rules.js";

/** One small inline SVG icon (24px, 2.2 stroke, round ends, takes the text colour). GDA-74. */
const ICONS = {
  // Settings: two sliders.
  settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M13 4v6", "M7 14v6"],
  // Back arrow (GDA-75) and End half flag.
  back: ["M15 5l-7 7 7 7"],
  flag: ["M6 21V4", "M6 5h11l-2.5 4 2.5 4H6"],
  // Goalkeeper glove (GDA-85): three fingers, a thumb and a cuff.
  glove: ["M9 13V6.5a1.5 1.5 0 0 1 3 0V11", "M12 11V5a1.5 1.5 0 0 1 3 0v6", "M15 11V6.5a1.5 1.5 0 0 1 3 0V15c0 3-2 5-5 5h-1.5c-2 0-3-1-4-2.5l-3-4.5a1.5 1.5 0 0 1 2.4-1.8L9 13", "M8.5 22h8"],
};
function icon(name) {
  // The HTML parser makes a real SVG element from this text; no web address is needed.
  const holder = document.createElement("span");
  const paths = ICONS[name].map((d) => `<path d="${d}"/>`).join("");
  holder.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return holder.firstChild;
}

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
  const back = onBack ? h("button", { class: "back", "aria-label": "Back", onclick: onBack }, icon("back")) : null;
  return h("div", { class: "hdr" }, back, h("h1", {}, title), right, extra);
}

function problemLine(text) {
  return text ? h("p", { class: "problem", role: "alert" }, text) : null;
}

/** The player's photo if they have one (GDA-52), otherwise their coloured initials. */
function avatar(player, photos = currentPhotos) {
  const photo = photos[player.id];
  if (photo) {
    return h("div", { class: "av pic" }, h("img", { src: photo, alt: "", draggable: false }));
  }
  return h("div", { class: "av c" + player.colour }, initialsFor(player.name));
}

// Photos by player id, kept on this phone. main.js sets them before each draw.
let currentPhotos = {};
export function setPhotos(photos) {
  currentPhotos = photos;
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

/** Add team / Team settings (GDA-68): name, players per side, half length. */
function teamFormScreen(state, actions) {
  const form = state.teamForm;
  const adding = form.mode === "add";
  const field = (id, label, value, error, numeric) => {
    const input = h("input", { id, type: "text", autocomplete: "off", spellcheck: "false", class: error ? "bad" : "" });
    if (numeric) {
      input.setAttribute("inputmode", "numeric");
    }
    input.value = value;
    return h("div", { class: "f" }, h("label", { for: id }, h("span", {}, label)), input, error ? h("p", { class: "problem", role: "alert" }, error) : null);
  };
  const refusal = deleteRefusal(state.teams, state.games);
  const deleteArea = adding
    ? null
    : refusal === "only"
      ? h("p", { class: "hint", id: "onlyTeam" }, LAST_TEAM_MESSAGE)
      : h("button", { class: "btn del", id: "deleteTeam", onclick: actions.askDeleteTeam }, "Delete team");
  return {
    nodes: [
      header(adding ? "Add team" : "Team settings", actions.cancelTeamForm),
      h(
        "div",
        { class: "body" },
        field("teamName", "Team name", form.values.name, form.errors.name),
        field("teamSize", "Players per side (5 to 11)", form.values.size, form.errors.size, true),
        field("teamMinutes", "Half length (minutes)", form.values.minutes, form.errors.minutes, true),
        adding ? null : h("p", { class: "hint" }, "Size and half length apply to new games only. Existing games keep theirs."),
        problemLine(state.problem),
        h("button", { class: "btn pri big", id: "saveTeam", onclick: actions.saveTeam }, "Save"),
        h("button", { class: "btn", id: "cancelTeam", onclick: actions.cancelTeamForm }, "Cancel"),
        deleteArea
      ),
      state.deleteTeamOpen ? deleteTeamSheet(state, actions, refusal) : null,
    ].filter(Boolean),
  };
}

/** The Delete team confirm, or the refusal when a game is in progress in that team. */
function deleteTeamSheet(state, actions, refusal) {
  const team = state.teams.find((t) => t.id === state.currentTeamId);
  if (refusal) {
    return h("div", { class: "scrim", id: "deleteTeamConfirm" }, h("div", { class: "sheet" }, h("h2", {}, `Can't delete ${team.name}`), h("p", { class: "refuse" }, IN_PROGRESS_REFUSAL + "."), h("button", { class: "btn", id: "cancelDeleteTeam", onclick: actions.cancelDeleteTeam }, "OK")));
  }
  const counts = deleteSummary(state.players, state.games);
  return h(
    "div",
    { class: "scrim", id: "deleteTeamConfirm" },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, `Delete team ${team.name}?`),
      h("p", { id: "deleteTeamCounts" }, `This erases ${plural(counts.players, "player")}, ${plural(counts.games, "game")} (archived games included), their events and the Sheet settings for this team. It can't be undone.`),
      counts.notInSheet > 0 ? h("p", { class: "problem", id: "deleteTeamWarn" }, `${counts.notInSheet} of these games are not in the Sheet. Tap Cancel and Save file or Send now first.`) : null,
      h("p", { class: "hint" }, "The Google Sheet itself is not touched. Other teams are not affected."),
      h("button", { class: "btn del", id: "confirmDeleteTeam", onclick: actions.confirmDeleteTeam }, "Delete team"),
      h("button", { class: "btn", id: "cancelDeleteTeam", onclick: actions.cancelDeleteTeam }, "Cancel")
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

/** The current team's name and size under the Game Day heading (cut short if very long). */
function teamLine(state) {
  const team = state.teams.find((t) => t.id === state.currentTeamId);
  return team ? h("p", { class: "team", id: "teamLine" }, h("b", {}, team.name), ` \u00b7 ${team.playersPerSide} a side`) : null;
}

/** The team list at the top of the menu: tick on the current team, locked while a game is in progress. */
function teamMenuItems(state, actions) {
  const locked = !canSwitchTeams(state.games);
  const items = state.teams.map((team) => {
    const label = (team.id === state.currentTeamId ? "\u2713 " : "\u00a0\u00a0\u00a0 ") + team.name;
    return h("button", { class: "mi teamItem", "data-team": team.id, disabled: locked, onclick: () => actions.switchTeam(team.id) }, label);
  });
  return [
    h("div", { class: "mhd" }, "Teams"),
    locked ? h("div", { class: "mlock", id: "teamLock" }, LOCKED_MESSAGE) : null,
    ...items,
    h("button", { class: "mi addTeam", disabled: locked, onclick: actions.openAddTeam }, "+ Add team"),
  ];
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
        ...teamMenuItems(state, actions),
        h("div", { class: "mhd" }, "This team"),
        h("button", { class: "mi teamSettings", onclick: actions.openTeamSettings }, "Team settings"),
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
        teamLine(state),
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

/** The current photo (or initials) with Add / Replace / Remove photo (GDA-52). */
function photoBlock(player, actions) {
  const has = Boolean(currentPhotos[player.id]);
  // A plain file picker: on an iPhone it offers Take photo and Photo library.
  const picker = h("input", { type: "file", accept: "image/*", id: "photoFile", hidden: true, onchange: () => actions.photoPicked(picker.files[0]) });
  return h(
    "div",
    { class: "photoBlock" },
    h("div", { class: "photoBig" }, avatar(player)),
    h("button", { class: "btn", id: "photoBtn", onclick: () => picker.click() }, has ? "Replace photo" : "Add photo"),
    has ? h("button", { class: "btn del", id: "photoRemove", onclick: actions.removePhoto }, "Remove photo") : null,
    picker,
    h("p", { class: "photoNote" }, "Stays on this phone only.")
  );
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
        photoBlock(player, actions),
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
 * time; `onStep(change)` is told -1 or +1. Both buttons grey out at the ends (1 and the half length, at most 25).
 */
function rotationStepper(value, onStep, max) {
  const number = h("div", { class: "val", id: "rotValue" });
  const less = h("button", { class: "btn", id: "rotLess", "aria-label": "Shorter", onclick: () => step(-1) }, "\u2212");
  const more = h("button", { class: "btn", id: "rotMore", "aria-label": "Longer", onclick: () => step(1) }, "+");
  const show = () => {
    number.textContent = `${value()} min`;
    less.disabled = value() <= MIN_ROTATION;
    more.disabled = value() >= max;
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
              form.rotationMinutes = Math.min(Math.min(25, form.halfMinutes), Math.max(MIN_ROTATION, form.rotationMinutes + change));
            },
            Math.min(25, form.halfMinutes)
          )
        ),
        // GDA-22: the half length is the team's, fixed for this game. Shown so it is not a surprise.
        h("div", { class: "ro", id: "halfInfo" }, `Half length: ${form.halfMinutes} min (from the team)`),
        form.rotationNote ? h("div", { class: "ro", id: "rotNote" }, form.rotationNote) : null,
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
function playerSlot(player, state, canMove, isKeeper = false, benchTimer = false, onPitch = false, dims = { size: 48, weight: 4 }) {
  const game = state.screen === "game" ? openGame(state) : null;
  const plannedOff = !!game && pairsOf(game).some((pair) => pair.fieldId === player.id);
  const plannedOn = !!game && pairsOf(game).some((pair) => pair.benchId === player.id);
  const planned = plannedOff || plannedOn;
  // The bench-order number (GDA-56): shown on field and bench circles during a game. A number, not just colour.
  const number = (state.screen === "game" || state.screen === "halfTime") ? benchNumberOf(openGame(state), player.id) : null;
  const turnMark = number ? h("span", { class: "turn", "aria-label": `Bench order ${number}`, title: `Bench order ${number}` }, String(number)) : null;
  // GDA-80: a pitch circle of someone who has been on the bench shows one thin frozen ring per stint (this half),
  // each at how full the bench ring was when they came on. Nobody benched, no rings. (Replaces the "4m" label of GDA-29.)
  const stints = onPitch && (state.screen === "game" || state.screen === "halfTime") ? openGame(state).benchStints?.[player.id] : undefined;
  const frozen = stints ? frozenRings(stints, rotationOf(openGame(state)), dims) : null;
  // Room for the rings above and below the circle so they never cover the name (one ring step is weight + 1px gap).
  const frozenSpace = stints ? Math.min(stints.length, MAX_FROZEN_RINGS) * (dims.weight + 1) : 0;
  // A planned swap: OFF and ON tags on the circles (GDA-75), and a dotted line between them (GDA-80, drawPairLines).
  const planTag = plannedOff ? h("span", { class: "pt" }, "OFF") : plannedOn ? h("span", { class: "pt" }, "ON") : null;
  // The keeper's "GK" sits after the name (a separate span, so the name itself stays just the name).
  const nameLine = isKeeper ? h("div", { class: "nr" }, h("div", { class: "nm" }, player.name), h("span", { class: "gk" }, "GK")) : h("div", { class: "nm" }, player.name);
  return h(
    "div",
    {
      class: ["slot", player.id === state.selectedId ? "sel" : "", planned ? "plan" : "", isKeeper ? "keeper" : ""].join(" ").trim(),
      ...(canMove ? { "data-player": player.id } : {}),
      ...(benchTimer ? { "data-bench": player.id } : {}), // Marks a timer circle; it is not draggable.
    },
    h("div", { class: "ci", ...(frozen ? { style: `margin: ${frozenSpace}px 0` } : {}) }, avatar(player), benchTimer ? ring(dims) : null, frozen, isKeeper ? h("span", { class: "gkb", "aria-hidden": "true" }, icon("glove")) : null, turnMark, planTag),
    nameLine,
    benchTimer ? h("div", { class: "tm" }) : null // Bench time under the name; drawBenchTimers fills it.
  );
}

/**
 * Status rings (GDA-85). One slot sits flush against the circle's white edge (the 2px border plus the 2px halo);
 * extra rings stack outward with a 1px gap. `dims` is the circle's size and the ring weight (4px, 3px when tight).
 * The SVG is a 140px box centred on the circle, so the rings scale with the circle and never move the layout.
 */
function ringCircles(dims, arcs, className) {
  const { size, weight } = dims;
  let out = "";
  arcs.forEach((arc, i) => {
    const r = size / 2 + 2 + weight / 2 + i * (weight + 1);
    const length = 2 * Math.PI * r;
    const dash = `${(arc.fraction * length).toFixed(1)} ${length.toFixed(1)}`;
    out +=
      `<circle class="r0" cx="70" cy="70" r="${r}" stroke-width="${weight}"></circle>` +
      `<circle class="r1${arc.late ? " late" : ""}" cx="70" cy="70" r="${r}" stroke-width="${weight}" data-len="${length.toFixed(2)}" transform="rotate(-90 70 70)" stroke-dasharray="${dash}"></circle>`;
  });
  return `<svg class="${className}" viewBox="0 0 140 140" ${arcs.label ? `role="img" aria-label="${arcs.label}"` : 'aria-hidden="true"'}>${out}</svg>`;
}

/** The ring round a bench circle. Its fill is set by drawBenchTimers, not here. */
function ring(dims) {
  // Parsed as HTML so the browser puts the SVG parts in the right namespace.
  const holder = document.createElement("div");
  holder.innerHTML = ringCircles(dims, [{ fraction: 0, late: false }], "rg");
  return holder.firstChild;
}

/**
 * The frozen rings on a pitch circle (GDA-80), oldest innermost, in the same slot and weight as the live bench
 * ring (paler in CSS so they read as stopped). A stint that ended late stays red. At most MAX_FROZEN_RINGS are
 * drawn, keeping the latest.
 */
const MAX_FROZEN_RINGS = 3;
function frozenRings(stints, rotation, dims) {
  const arcs = stints.slice(-MAX_FROZEN_RINGS).map((seconds) => frozenRingLook(seconds, rotation));
  arcs.label = `Times on the bench: ${stints.map(benchTimerText).join(", ")}`;
  const holder = document.createElement("div");
  holder.innerHTML = ringCircles(dims, arcs, "fz");
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
  // Circle size and ring weight (GDA-85): a crowded live bench has smaller circles and thinner rings.
  const dims = rowClass.includes("many") ? { size: 34, weight: 3 } : { size: 40, weight: 4 };
  const slots = players.map((player) => playerSlot(player, state, canMove, false, benchTimers, false, dims));
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
function openRowsTight(game) {
  return pitchRows(game.formation).length >= 5;
}
function pitchAndBench(view, state, canMove, crowded, live = false) {
  const game = openGame(state);
  const tight = crowded || openRowsTight(game);
  const dims = tight ? { size: 40, weight: 3 } : { size: 48, weight: 4 };
  const line = (places) =>
    h(
      "div",
      { class: places.length >= 4 ? `line across${places.length}` : "line" },
      ...places.map((place) => {
        const player = view.positions[place];
        return player ? playerSlot(player, state, canMove, place === 0, false, true, dims) : emptySlot(place, canMove, state);
      })
    );
  // GDA-22: one row per line of the game's shape, attack at the top and goal at the bottom.
  const rows = pitchRows(game.formation);
  const pitch = h(
    "div",
    // Five or more rows need the smaller circles to fit.
    { class: tight ? "pitch tight" : "pitch", style: `grid-template-rows: repeat(${rows.length}, minmax(0, 1fr))` },
    ...rows.map(line)
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
        formationBox(game, actions),
        ...pitchAndBench(view, state, true, view.bench.length > 6 || view.absent.length > 6),
        // GDA-62: always there, below the bench, even when empty (then slim).
        lineUpRow("ABSENT", view.absent.length > 0 ? "row ab" : "row ab empty", view.absent, state, true, false, "absent")
      ),
      h("div", { class: "acts" }, ...lineUpActions(view, state, actions)),
      gameDetailsSheet(state, game, actions),
    ],
  };
}

/**
 * The formation box (GDA-22). Typing is checked at once against the game's team size
 * (its number of places): a valid shape is saved and the pitch redrawn in place; an
 * invalid one shows what is wrong and the pitch keeps the last valid shape. From
 * kick-off the box is disabled and says so. Only the box locks.
 */
function formationBox(game, actions) {
  const locked = game.state !== NOT_STARTED;
  const size = game.lineups.firstHalf.positions.length;
  const message = h("div", { class: "fmsg", id: "fmMsg", role: "alert" });
  const input = h("input", {
    id: "formation",
    type: "text", // text (not number) so the value can hold dashes
    value: game.formation,
    // GDA-83: the number keypad (it has no "-", which GDA-71 hit); the box adds the dashes itself.
    inputmode: "numeric",
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    "aria-label": "Formation, defence to attack",
    disabled: locked,
  });
  // The formation the pitch is showing now (the closed-over `game` goes stale as Ben types).
  let shownOnPitch = game.formation;
  input.addEventListener("input", () => {
    // Show only the digits joined by dashes; setting the value puts the caret at the end.
    const shown = formatFormationDigits(input.value);
    if (input.value !== shown) {
      input.value = shown;
    }
    const result = checkFormation(input.value, size);
    input.classList.toggle("bad", !result.ok);
    message.textContent = result.ok ? "" : `${result.message} The pitch keeps ${shownOnPitch}.`;
    if (result.ok && result.formation !== shownOnPitch) {
      shownOnPitch = result.formation;
      actions.setFormation(result.formation);
    }
  });
  return h("div", { class: "fm" }, h("label", { for: "formation" }, "Formation"), input, h("span", { class: "fsub" }, locked ? "locked from kick-off" : "defence to attack"), message);
}

/** Redraws only the pitch (line-up screen), so the formation box keeps its focus while typing. */
export function drawPitch(state) {
  const game = openGame(state);
  const view = lineUpView(game, state.players);
  const [pitch] = pitchAndBench(view, state, true, view.bench.length > 6 || view.absent.length > 6);
  document.querySelector(".pitch")?.replaceWith(pitch);
  const tag = document.querySelector(".hdr .tag");
  if (tag) {
    tag.textContent = game.formation;
  }
}

/** The settings cog (GDA-64): opens the Game details sheet. Sits at the far edge, away from the game buttons. */
function cogButton(actions, extra = "") {
  return h("button", { class: ("cog " + extra).trim(), id: "cog", "aria-label": "Game details", onclick: actions.openRotation }, icon("settings"));
}

/**
 * Who is here (GDA-43): every player with Here or Not here; one tap flips it. Only while the
 * game is running (before kick-off the line-up screen does this; after Full Time it is final).
 */
function hereList(state, game, actions) {
  if (!canChangeWhoIsHere(game)) {
    return null;
  }
  return h(
    "div",
    { class: "heres", id: "hereList" },
    h("div", { class: "lbl" }, "Who is here"),
    ...state.players.map((player) => {
      const here = !game.absent.includes(player.id);
      return h(
        "button",
        { class: "here" + (here ? "" : " off"), "data-here": player.id, "aria-label": `${player.name}, ${here ? "here" : "not here"}. Tap to change`, onclick: () => actions.toggleHere(player.id) },
        h("span", {}, player.name),
        h("b", {}, here ? "Here" : "Not here")
      );
    })
  );
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
      rotationStepper(() => rotationOf(openGame(state)), actions.stepRotation, Math.min(25, halfOf(game))),
      h("div", { class: "ro", id: "detOpp" }, `Opposition: ${game.opposition}`),
      h("div", { class: "ro", id: "detDate" }, `Date: ${formatGameDate(game.date)}`),
      hereList(state, game, actions),
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

/** Our crest, or a grey disc with initials for a team with no crest (the opponent, for now). */
function teamLogo(name, isUs) {
  return isUs
    ? h("img", { class: "logo", src: "crest.png", alt: "", draggable: false })
    : h("span", { class: "logo disc", "aria-hidden": "true" }, initialsFor(name));
}

/**
 * The header card at the top of the game screens (GDA-75): half and clock on the left,
 * two team rows (logo, name, score) on the right, and a thin bar along the bottom edge
 * that fills over the half (drawClock moves it). With `actions` the team rows are one
 * button (tap = Remove last goal, GDA-39); without, plain text (before kick-off).
 */
function gameHeader(text, half, game, actions, state) {
  const score = scoreOf(game);
  const team = state.teams.find((t) => t.id === (game.teamId ?? state.currentTeamId));
  const usName = team?.name ?? "Us";
  const row = (name, isUs, n, id) => h("span", { class: "trow" }, teamLogo(name, isUs), h("span", { class: "tn" }, name), h("span", { class: "tg", id }, String(n)));
  const rows = [row(usName, true, score.us, "scoreUs"), row(game.opposition, false, score.them, "scoreThem")];
  const teams = actions
    ? h("button", { class: "teams", id: "score", "aria-label": `Score, ${usName} ${score.us}, ${game.opposition} ${score.them}. Tap to remove the last goal`, onclick: actions.openRemoveGoal }, ...rows)
    : h("div", { class: "teams", id: "score" }, ...rows);
  return h(
    "div",
    { class: "clk" },
    h("div", { class: "ck" }, h("span", { class: "hf" }, half), h("b", { id: "clock" }, text)),
    teams,
    h("div", { class: "hp" }, h("i", { id: "halfBar" }))
  );
}

/** Before kick-off: look, but not touch. The game has not started and nothing here is saved. */
function readyScreen(state, actions) {
  const game = openGame(state);
  const view = lineUpView(game, state.players);
  return {
    fixed: true,
    noMove: true,
    nodes: [
      gameHeader("0:00", "1ST HALF", game, null, state),
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
          h("button", { class: "btn pri", onclick: actions.startFirstHalf }, "START 1ST HALF"),
          cogButton(actions, "bot")
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
      gameHeader(clockText(startedAtOf(game), Date.now(), halfOf(game)), game.state === "second half" ? "2ND HALF" : "1ST HALF", game, actions, state),
      swapStrip(game, state, actions),
      h("div", { class: "lu" }, ...pitchAndBench(view, state, true, view.bench.length > 6, true)),
      h(
        "div",
        { class: "acts game" },
        problemLine(state.problem),
        h(
          "div",
          { class: "gr" },
          h("button", { class: "btn pri", id: "goalUs", onclick: actions.goalUs }, "GOAL - US"),
          h("button", { class: "btn", id: "goalThem", onclick: actions.goalAgainst }, "Goal against"),
          h("button", { class: "btn eh", id: "endHalf", onclick: actions.endHalf }, icon("flag"), "End Half"),
          cogButton(actions, "bot")
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
/**
 * What the strip says when no swap is due (Ben to choose, GDA-75). Change this one word:
 *   "text"  - "NEXT SWAP: Not due yet" (default)
 *   "half"  - "HALF ENDS IN 12:18" (counts down, drawClock fills it)
 *   "quiet" - an empty white strip, no words
 */
const IDLE_STRIP = "text";
const IDLE_LABEL = { text: "NEXT SWAP", half: "HALF ENDS IN", quiet: "" };

function swapStrip(game, state, actions) {
  const planned = pairsOf(game).length > 0;
  const undoShown = !planned && state.undo && Date.now() < state.undo.until;
  return h(
    "div",
    { class: IDLE_STRIP === "quiet" ? "strip quiet" : "strip", id: "strip" },
    h("div", { class: "sl", id: "swapMsg", hidden: true }),
    h("div", { class: "sl time", id: "timeStrip", hidden: true }, h("span", { class: "big" }, "TIME")),
    // Nothing due: a quiet note (see IDLE_STRIP), so the strip is never an empty hole (GDA-75).
    undoShown || IDLE_STRIP === "quiet" ? null : h("div", { class: "sl idle", id: "idleMsg" }, h("div", { class: "lab" }, IDLE_LABEL[IDLE_STRIP]), h("div", { class: "val2", id: "idleVal" }, IDLE_STRIP === "half" ? "" : "Not due yet")),
    undoShown ? h("div", { class: "undo", id: "undo" }, h("span", {}, "Swap done"), h("button", { onclick: actions.undo }, "Undo")) : null,
    planned ? h("button", { class: "btn pri swp", id: "swap", onclick: actions.swap }, "Swap") : null
  );
}

let lastActions = null;

/**
 * Draws a dotted line for each planned pair, from the bench circle to the field player
 * (or empty position), with a cross where the line leaves the bench (GDA-80: the lines are
 * back, next to the OFF and ON tags). Worked out from where the circles really are, so it
 * follows a pair when its child moves position. Called after every draw and on resize.
 * The line look is the same as the drag line (see .dl in style.css).
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
    if (!from) {
      continue;
    }
    const to = area.querySelector(pair.fieldId !== null ? `.pitch [data-player="${pair.fieldId}"]` : `.pitch [data-place="${pair.place}"]`);
    const a = centre(from);
    const b = to ? centre(to) : null;
    if (b) {
      // The line stops at the edge of each circle, not over the initials or photo.
      const radius = (slot) => slot.querySelector(".av").getBoundingClientRect().width / 2 + 2;
      const cut = trimmedLine(a, b, radius(from), radius(to));
      if (cut) {
        lines += `<line class="dl" x1="${cut.x1}" y1="${cut.y1}" x2="${cut.x2}" y2="${cut.y2}" stroke-dasharray="3 7"></line>`;
      }
    }
    const along = !b || b.y === a.y ? 0.5 : (edge - a.y) / (b.y - a.y);
    const x = Math.max(22, Math.min(box.width - 22, b ? a.x + (b.x - a.x) * along : a.x));
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
    clock.textContent = clockText(startedAtOf(game), now, halfOf(game));
    const timeUp = isTimeUp(startedAtOf(game), now, halfOf(game));
    document.getElementById("timeStrip").hidden = !timeUp; // TIME takes the message's place in the same strip.
    document.getElementById("endHalf").classList.toggle("pri", timeUp);
    // The half progress bar along the bottom of the header card.
    const seconds = Math.max(0, (now - startedAtOf(game)) / 1000);
    document.getElementById("halfBar").style.width = Math.min(100, (seconds / (halfOf(game) * 60)) * 100).toFixed(1) + "%";
    drawBenchTimers(game, now);
    drawSwapMessage(game, state.players, now, timeUp);
    const idleVal = document.getElementById("idleVal");
    if (idleVal && IDLE_STRIP === "half") {
      const left = Math.max(0, Math.ceil(halfOf(game) * 60 - seconds));
      idleVal.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    }
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
  const idle = document.getElementById("idleMsg");
  if (idle) {
    idle.hidden = !!message || timeUp; // Idle words give way to the swap message or TIME.
  }
  if (!message) {
    box.hidden = true;
    box.textContent = "";
    strip.className = (timeUp ? "strip timeup" : "strip") + (IDLE_STRIP === "quiet" ? " quiet" : "");
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
    const arc = slot.querySelector(".r1");
    const length = Number(arc.getAttribute("data-len"));
    arc.setAttribute("stroke-dasharray", `${(ringFraction(seconds, rotation) * length).toFixed(1)} ${length.toFixed(1)}`);
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
      h("div", { class: "hdr ht" }, h("button", { class: "back", "aria-label": "Back", onclick: actions.backToGame }, icon("back")), h("h1", {}, "HALF TIME"), scoreBox(game, canRemoveLastGoal(game) ? actions : null), cogButton(actions)),
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
  teamForm: teamFormScreen,
  cannotOpen: cannotOpenScreen,
};

/** Replaces what is on screen with the screen named in state.screen. */
export function drawScreen(state, actions) {
  lastActions = actions;
  const view = SCREENS[state.screen](state, actions);
  document.getElementById("screen").replaceChildren(...view.nodes.filter((n) => n != null)); // GDA-79: a closed sheet is null; never print it as text
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
