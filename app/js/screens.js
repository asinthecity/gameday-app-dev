// Builds each screen from the current state. Nothing here saves anything: taps
// go to the `actions` that main.js passes in.
//
// Names only ever reach the page as plain text (never as HTML), so a name
// containing < or & just shows as typed.

import { hasRecord } from "./record-rules.js";
import { trimmedLine } from "./drag.js";
import { FINISHED, FIRST_HALF, SECOND_HALF, canPlan, IN_PROGRESS_PHASE, NOT_STARTED_PHASE, phaseOf, canStartHalf, canResumeHalf, halfLineUpView, nextScreen, lineupKey, canChangeWhoIsHere, startedAtOf, endedAtOf, canUndoKickOff, formationRowHalf, shownFormation, benchSeconds, benchTimerText, canCreateGame, VENUE_TAGS, venueLine, clockText, isBenchLate, ringFraction, planFigures, planFiguresFor, firstHalfFigures, firstHalfCopyOf, frozenRingLook, formatGameDate, formatKickOff, isBlank, isTimeUp, lineUpView, swapMessage, pairsOf, benchNumberOf, rotationSecondsOf, rotationText, ROTATION_EXTRA_SECONDS, snappedSeconds, clampRotation, halfOf, carriesRotationOrder, carriesBenchTime, canChangeCarryOver, MIN_ROTATION, MAX_ROTATION, NOT_STARTED, scoreOf, canAddGoal, scorerChoices, undoLineOf, lastGoal, US, canEditNotes, noteOf, potdOf, summaryOf } from "./game-rules.js";
import { TALLY_COLUMNS, interchangeRows, sortTally, tallyRows } from "./interchange-rules.js";
import { checkFormation, formatFormationDigits, formationOf, pitchRows } from "./formation-rules.js";
import { archiveWarning, canDeleteGame, setupCodeOf, sheetStatus } from "./sheet-rules.js";
import { canSaveName, initialsFor } from "./squad-rules.js";
import { MIN_SIDE, MAX_SIDE, canSwitchTeams, deleteRefusal, deleteSummary, IN_PROGRESS_REFUSAL, LAST_TEAM_MESSAGE, LOCKED_MESSAGE, plural, UPGRADE_FAILED_MESSAGE } from "./team-rules.js";

/** One small inline SVG icon (24px, 2.2 stroke, round ends, takes the text colour). GDA-74. */
const ICONS = {
  // Settings: two sliders.
  settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M13 4v6", "M7 14v6"],
  // Back arrow (GDA-75) and End half flag.
  back: ["M15 5l-7 7 7 7"],
  next: ["M9 5l7 7-7 7"],
  flag: ["M6 21V4", "M6 5h11l-2.5 4 2.5 4H6"],
  // Goalkeeper glove (GDA-85): three fingers, a thumb and a cuff.
  // Football (GDA-108): a circle with a centre patch and seam lines.
  // A path starting with "F " is filled (the solid centre patch makes it read as a ball, not a wheel, at text size).
  ball: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18", "F M12 7.8L16 10.7L14.47 15.4H9.53L8 10.7Z", "M12 7.8V3", "M16 10.7L20.56 9.22", "M14.47 15.4L17.29 19.28", "M9.53 15.4L6.71 19.28", "M8 10.7L3.44 9.22"],
  // GDA-121: the Interchange history arrows (down = off, up = on).
  arrowDown: ["M12 4v16", "M6 14l6 6 6-6"],
  arrowUp: ["M12 20V4", "M6 10l6-6 6 6"],
  glove: ["M9 13V6.5a1.5 1.5 0 0 1 3 0V11", "M12 11V5a1.5 1.5 0 0 1 3 0v6", "M15 11V6.5a1.5 1.5 0 0 1 3 0V15c0 3-2 5-5 5h-1.5c-2 0-3-1-4-2.5l-3-4.5a1.5 1.5 0 0 1 2.4-1.8L9 13", "M8.5 22h8"],
};
function icon(name) {
  // The HTML parser makes a real SVG element from this text; no web address is needed.
  const holder = document.createElement("span");
  const paths = ICONS[name].map((d) => (d.startsWith("F ") ? `<path d="${d.slice(2)}" fill="currentColor"/>` : `<path d="${d}"/>`)).join("");
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

function header(title, onBack, right = null, extra = null, crest = null) {
  const back = onBack ? h("button", { class: "back", "aria-label": "Back", onclick: onBack }, icon("back")) : null;
  return h("div", { class: "hdr" }, back, crest, h("h1", {}, title), right, extra);
}

/** The title sits in the middle of the band (Interchange history, GDA-135). */
function centredHeader(bar) {
  bar.classList.add("mid");
  return bar;
}

function problemLine(text) {
  return text ? h("p", { class: "problem", role: "alert" }, text) : null;
}

// ---- Settings rows and sheets (GDA-99 rules 6 and 7) ----
/** Rows grouped in one white card, a 1px divider between them. */
function setCard(...rows) {
  return h("div", { class: "setcard" }, ...rows.filter((row) => row != null));
}
/** A read-only fact: label left, value right. `id` goes on the value (or on the whole row when `onRow`). */
function factRow(label, value, id, onRow = false) {
  return h("div", { class: "setrow", id: onRow ? id : undefined }, h("span", {}, label), onRow ? h("span", { class: "ro" }, value) : h("span", { class: "ro", id }, value));
}
/** A sheet's top: title on the left, X on the right (the X is how a sheet is dismissed). */
function sheetHead(title, onClose, xid = "sheetX") {
  return h("div", { class: "shead" }, h("h2", {}, title), h("button", { class: "pkx", id: xid, "aria-label": "Close", onclick: onClose }, "\u00d7"));
}

// ---- The four game screens and their arrows (GDA-95) ----
// New game, 1st Half, 2nd Half and Full Time all start with the same row: a ‹ arrow at the left and a
// › arrow at the right, the same box on every screen. The arrows only move between screens.

/** Which half a screen shows: 1, 2, or 0 for a screen that is not a half screen. */
export function screenHalf(screen) {
  return screen === "half1" ? 1 : screen === "half2" ? 2 : 0;
}

/** True when the screen shows a half that is In progress (so the clock, swaps and bench timers are live). */
function isLiveView(state) {
  const half = screenHalf(state.screen);
  const game = half === 0 ? null : openGame(state);
  return !!game && phaseOf(game, half) === IN_PROGRESS_PHASE;
}

/** The same as isLiveView, for a game already in hand (drawClock runs every 250 ms, on any screen). */
function isLiveViewOf(state, game) {
  const half = screenHalf(state.screen);
  return half !== 0 && !!game && phaseOf(game, half) === IN_PROGRESS_PHASE;
}

/** An arrow-only button. `onClick` null makes it greyed out and inert (aria-disabled), not removed. */
function arrowButton(kind, onClick) {
  const props = { class: onClick ? "arrow" : "arrow off", id: kind === "back" ? "navBack" : "navNext", "aria-label": kind === "back" ? "Back" : "Next" };
  if (onClick) {
    props.onclick = onClick;
  } else {
    props["aria-disabled"] = "true";
  }
  return h("button", props, icon(kind));
}

/** The arrows for a game screen: Back always works; Next works where the rules say there is a screen to go to. */
function navArrows(state, actions) {
  const game = openGame(state);
  const hasNext = state.screen === "createGame" ? true : !!game && nextScreen(game, state.screen) !== null;
  return [arrowButton("back", actions.goBack), arrowButton("next", hasNext ? actions.goNext : null)];
}

/** The top row of a screen with no clock: arrow, title (and a small state tag), arrow. Same box as the game header card. */
function navBar(title, tag, state, actions) {
  const [back, next] = navArrows(state, actions);
  return h("div", { class: "clk bar" }, back, h("h1", {}, title), tag ? h("span", { class: "tag" }, tag) : null, next);
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
      h("div", { class: "info" }, h("b", {}, `vs ${game.opposition}`), h("div", {}, `${formatGameDate(game.date)} \u00b7 ${formatKickOff(game.kickOff)}`), h("div", {}, venueLine(game))),
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
    return [h("div", { class: "sheetStatus ok", "data-status": "sent" }, h("b", { class: "tick" }, "\u2713"), h("b", { class: "sentOk" }, " Sent to the Sheet"))];
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
    { class: "card finished", "data-game": game.id, onclick: (event) => {
        // GDA-100: a tap anywhere on the card opens the game, except on its own buttons and menu.
        if (!event.target.closest("button, .menuCover, .cardMenu")) {
          actions.viewGame(game.id);
        }
      },
    },
    h(
      "div",
      { class: "head" },
      h("div", { class: "info" }, h("b", {}, `vs ${game.opposition} \u00b7 ${game.record.us} - ${game.record.them}`), h("div", {}, formatGameDate(game.date))),
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

/** The logo row of the team form (GDA-126): the picture or initials disc, Add / Replace / Remove logo. Like photoBlock. */
function logoBlock(state, actions) {
  const form = state.teamForm;
  // form.logo: undefined = unchanged, a picture = chosen but not saved yet, null = removed.
  const shown = form.logo !== undefined ? form.logo : form.mode === "edit" ? currentLogos[state.currentTeamId] : null;
  const picker = h("input", { type: "file", accept: "image/*", id: "logoFile", hidden: true, onchange: () => actions.logoPicked(picker.files[0]) });
  return h(
    "div",
    { class: "photoBlock" },
    h("div", { class: "photoBig" }, teamLogo(form.values.name, shown, "bigLogo")),
    h("button", { class: "btn", id: "logoBtn", onclick: () => picker.click() }, shown ? "Replace logo" : "Add logo"),
    shown ? h("button", { class: "btn redtext", id: "logoRemove", onclick: actions.removeLogo }, "Remove logo") : null,
    picker,
    h("p", { class: "photoNote" }, "Stays on this phone only.")
  );
}

/** Add team / Team settings (GDA-68): name, players per side, half length. */
function teamFormScreen(state, actions) {
  const form = state.teamForm;
  const adding = form.mode === "add";
  const field = (id, label, value, error) => {
    const input = h("input", { id, type: "text", autocomplete: "off", spellcheck: "false", class: error ? "bad" : "" });
    input.value = value;
    return h("div", { class: "f" }, h("label", { for: id }, h("span", {}, label)), input, error ? h("p", { class: "problem", role: "alert" }, error) : null);
  };
  // Players per side and Half length are steppers (5 to 11; 1 or more). The value lives in form.values.
  const numberRow = (label, key, ids, min, max, text) =>
    h(
      "div",
      { class: "f" },
      h("span", {}, label),
      stepControl({
        ids,
        labels: ["Fewer", "More"],
        get: () => Number(form.values[key]) || min,
        min,
        max,
        text,
        onStep: (change) => {
          form.values[key] = String(Math.min(max, Math.max(min, (Number(form.values[key]) || min) + change)));
        },
      })
    );
  const refusal = deleteRefusal(state.teams, state.games);
  const deleteArea = adding
    ? null
    : refusal === "only"
      ? h("p", { class: "hint", id: "onlyTeam" }, LAST_TEAM_MESSAGE)
      : h("button", { class: "btn redtext", id: "deleteTeam", onclick: actions.askDeleteTeam }, "Delete team");
  return {
    nodes: [
      header(adding ? "Add team" : "Team settings", actions.cancelTeamForm),
      h(
        "div",
        { class: "body" },
        logoBlock(state, actions),
        setCard(
          field("teamName", "Team name", form.values.name, form.errors.name),
          numberRow("Players per side", "size", { less: "teamSizeLess", more: "teamSizeMore", value: "teamSize" }, MIN_SIDE, MAX_SIDE, (n) => String(n)),
          numberRow("Half length", "minutes", { less: "teamMinutesLess", more: "teamMinutesMore", value: "teamMinutes" }, 1, 90, (n) => `${n} min`)
        ),
        adding ? null : h("p", { class: "hint" }, "Size and half length apply to new games only. Existing games keep theirs."),
        problemLine(state.problem),
        h("button", { class: "btn pri big", id: "saveTeam", onclick: actions.saveTeam }, "Save"),
        deleteArea ? h("div", { class: "gapbig" }, deleteArea) : null
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
      h("button", { class: "btn del", id: "confirmDeleteTeam", onclick: actions.confirmDeleteTeam }, "Delete team"),
      h("button", { class: "btn", id: "cancelDeleteTeam", onclick: actions.cancelDeleteTeam }, "Cancel")
    )
  );
}

/** Sheet settings (GDA-47): one pasted setup code (address + secret), kept only on this phone. */
function sheetSettingsScreen(state, actions) {
  // What was typed if a message is showing, else the saved code. Settings saved by the old
  // two-box setup have no setup mark, so the box starts empty and Ben pastes a new code.
  const shown = state.sheetDraft ?? (state.sheetSettings?.setup === 2 ? setupCodeOf(state.sheetSettings) : "");
  const field = (id, label, value, type) => {
    const input = h("input", { id, type, autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false" });
    input.value = value ?? "";
    return h("div", { class: "f wide" }, h("label", { for: id }, h("span", {}, label)), input);
  };
  return {
    nodes: [
      header("Sheet settings", actions.goHome),
      h(
        "div",
        { class: "body" },
        setCard(field("sheetCode", "Setup code", shown, "password")),
        h("p", { class: "hint" }, "In the Sheet: Game Day > Set up. Copy the code it shows and paste it here."),
        problemLine(state.problem),
        state.sheetResult ? h("p", { id: "sheetResult", class: state.sheetResult.ok ? "" : "problem", role: "status" }, state.sheetResult.text) : null,
        h("button", { class: "btn pri big", id: "saveSheet", onclick: actions.saveSheetSettings }, "Save")
      ),
    ],
  };
}

/** The current team's name and size under the Game Day heading (cut short if very long). */
function teamLine(state) {
  const team = state.teams.find((t) => t.id === state.currentTeamId);
  return team ? h("p", { class: "team", id: "teamLine" }, h("b", {}, team.name), h("span", { class: "tsize" }, ` \u00b7 ${team.playersPerSide} a side`)) : null;
}

/** The team list at the top of the menu: tick on the current team, locked while a game is in progress. */
function teamMenuItems(state, actions) {
  const locked = !canSwitchTeams(state.games);
  const items = state.teams.map((team) => {
    // The tick (violet) goes before the current team; the others get blank space of the same width so names line up.
    const mark = team.id === state.currentTeamId ? h("span", { class: "tickMark" }, "\u2713") : "\u00a0\u00a0\u00a0";
    return h("button", { class: "mi teamItem", "data-team": team.id, disabled: locked, onclick: () => actions.switchTeam(team.id) }, mark, " " + team.name);
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
      // Home's band (GDA-131): logo (or initials disc), Game Day and the menu button, with the team line under them.
      h(
        "div",
        { class: "hdr homeHdr" },
        h("div", { class: "hrow" }, teamLogo(currentTeamOf(state)?.name ?? "", currentLogos[state.currentTeamId], "homeLogo"), h("h1", {}, "Game Day"), topMenu),
        teamLine(state)
      ),
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
  return [setCard(field), save];
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
    has ? h("button", { class: "btn redtext", id: "photoRemove", onclick: actions.removePhoto }, "Remove photo") : null,
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
        h("button", { class: "btn redtext gapbig", onclick: actions.askRemove }, "Remove from squad")
      ),
      warning,
    ].filter(Boolean),
  };
}

/**
 * One box on the New game screen. It keeps state.form up to date as it changes,
 * and marks itself Needed when left blank. Fields not reached are never marked.
 */
function detailField(form, key, label, inputProps, onChange, optional = false) {
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
    if (isBlank(input.value) && !optional) {
      mark(true);
    }
  });
  return field;
}

/**
 * One slim stepper row: [-] value [+] with 44px buttons (GDA-99). `get()` is read each time; `onStep(change)` is
 * told -1 or +1. Both buttons grey out at `min` and `max`. `ids` = { less, more, value }.
 */
function stepControl({ ids, labels, get, min, max, text, onStep }) {
  const number = h("div", { class: "val", id: ids.value });
  const less = h("button", { type: "button", class: "btn", id: ids.less, "aria-label": labels[0], onclick: () => step(-1) }, "\u2212");
  const more = h("button", { type: "button", class: "btn", id: ids.more, "aria-label": labels[1], onclick: () => step(1) }, "+");
  const show = () => {
    number.textContent = text(get());
    less.disabled = get() <= min;
    more.disabled = get() >= max;
  };
  const step = (change) => {
    onStep(change);
    show();
  };
  show();
  return h("div", { class: "step" }, less, number, more);
}

/**
 * The rotation length (GDA-106): two of the phone's own pickers, minutes (1 to the half length, at most 25) and
 * seconds (0, 15, 30, 45; only 0 at the longest length). `onChange(minutes, seconds)` is told the new length.
 * `minutes` and `seconds` are the current length; `halfMinutes` sets the longest.
 */
function rotationPicker(minutes, seconds, halfMinutes, onChange) {
  const top = Math.min(MAX_ROTATION, halfMinutes);
  const optionFor = (value, label, chosen) => h("option", { value: String(value), selected: value === chosen }, label);
  const minuteBox = h("select", { class: "pick", id: "rotMinutes", "aria-label": "Rotation minutes" },
    ...Array.from({ length: top - MIN_ROTATION + 1 }, (_, i) => optionFor(MIN_ROTATION + i, `${MIN_ROTATION + i} min`, minutes)));
  const secondBox = h("select", { class: "pick", id: "rotSeconds", "aria-label": "Rotation seconds" },
    ...ROTATION_EXTRA_SECONDS.map((value) => optionFor(value, `${value} s`, seconds)));
  // At the longest length only 0 seconds is allowed.
  const limitSeconds = () => {
    const atTop = Number(minuteBox.value) >= top;
    [...secondBox.options].forEach((option) => (option.disabled = atTop && option.value !== "0"));
    if (atTop) {
      secondBox.value = "0";
    }
  };
  limitSeconds();
  const changed = () => {
    limitSeconds();
    onChange(Number(minuteBox.value), Number(secondBox.value));
  };
  minuteBox.addEventListener("change", changed);
  secondBox.addEventListener("change", changed);
  return h("div", { class: "picks" }, minuteBox, secondBox);
}

/**
 * GDA-88: the Home / Away / Other choice (three buttons, one chosen at most; none at first).
 * `current` is the chosen tag or "". Tapping calls onPick(tag) and moves the highlight here, so the
 * same control serves the Create game form and the Game details sheet.
 */
function venueTagChoice(current, onPick) {
  // Two slim buttons built on native radio inputs (GDA-99): the input sits invisibly over its button.
  const labels = VENUE_TAGS.map((tag) =>
    h(
      "label",
      { class: "vtBtn" + (tag === current ? " vtOn" : "") },
      h("input", { type: "radio", name: "venueTag", value: tag, "data-tag": tag, checked: tag === current, onchange: () => choose(tag) }),
      h("span", {}, tag)
    )
  );
  function choose(tag) {
    for (const label of labels) {
      label.classList.toggle("vtOn", label.querySelector("input").dataset.tag === tag);
    }
    onPick(tag);
  }
  return h("div", { class: "vtChoice", id: "vtChoice", role: "radiogroup", "aria-label": "Home or Away" }, ...labels);
}

function createGameScreen(state, actions) {
  const form = state.form;
  const make = h(
    "button",
    { class: "btn pri big", id: "make", disabled: !canCreateGame(form), onclick: actions.makeGame },
    "Create game"
  );
  // GDA-134: no hint under the form (Ben, 2026-11-14); Create game is simply greyed out until Home or Away is picked.
  // The › arrow does what Create game does, so it is greyed out in the same cases.
  const nextArrow = arrowButton("next", actions.makeGame);
  const syncNext = () => {
    const ok = canCreateGame(form);
    nextArrow.classList.toggle("off", !ok);
    nextArrow.setAttribute("aria-disabled", String(!ok));
  };
  const onChange = () => {
    make.disabled = !canCreateGame(form);
    syncNext();
  };
  syncNext();
  const text = { type: "text", autocomplete: "off", autocapitalize: "words", autocorrect: "off", spellcheck: "false" };
  return {
    nodes: [
      h("div", { class: "clk bar" }, arrowButton("back", actions.leaveCreateGame), h("h1", {}, "New game"), nextArrow),
      h(
        "div",
        { class: "body" },
        setCard(
          detailField(form, "date", "Date", { type: "date" }, onChange),
          detailField(form, "kickOff", "Kick-off", { type: "time" }, onChange),
          detailField(form, "opposition", "Opposition", text, onChange),
          h("div", { class: "f", id: "f-venueTag" }, h("span", {}, "Home or away"), venueTagChoice(form.venueTag, (tag) => { form.venueTag = tag; onChange(); })),
          detailField(form, "venue", "Field", { ...text, placeholder: "Field" }, onChange, true),
          h(
            "div",
            { class: "f" },
            h("span", {}, "Rotation"),
            rotationPicker(form.rotationMinutes, form.rotationExtraSeconds ?? 0, form.halfMinutes, (minutes, seconds) => {
              form.rotationMinutes = clampRotation(minutes, form.halfMinutes);
              form.rotationExtraSeconds = snappedSeconds(seconds, form.rotationMinutes, form.halfMinutes);
            })
          ),
          // GDA-127: the first game's shape, starting from the team's last-used one; never read-only here.
          formationBox({ size: form.playersPerSide, shown: form.formation, disabled: false, onValid: (formation) => { form.formation = formation; } }),
          // GDA-22: the half length is the team's, fixed for this game. Shown so it is not a surprise.
          factRow("Half length", `${form.halfMinutes} min`, "halfInfo")
        ),
        carryOverSwitches(form, false, actions),
        form.rotationNote ? h("div", { class: "ro", id: "rotNote" }, form.rotationNote) : null,
        make,
        problemLine(state.problem)
      ),
    ],
  };
}

/**
 * New game once the game exists (GDA-95): this game's details, read-only. They are changed in the
 * cog's Game details on the half screens. Back goes Home; Next goes to the 1st Half.
 */
function newGameScreen(state, actions) {
  const game = openGame(state);
  return {
    nodes: [
      navBar("New game", null, state, actions),
      h(
        "div",
        { class: "body" },
        setCard(
          factRow("Date", formatGameDate(game.date), "ngDate"),
          factRow("Kick-off", formatKickOff(game.kickOff), "ngKickOff"),
          factRow("Opposition", game.opposition, "ngOpposition"),
          // GDA-105: Home / Away and Field are changed here (they used to be in the cog sheet); locked after Full Time.
          ...(game.state === FINISHED
            ? [factRow("Home or away", game.venueTag || "Not set", "ngVenueTag"), factRow("Field", game.venue || "Not set", "ngVenue")]
            : venueEditor(game, actions)),
          factRow("Rotation", rotationText(rotationSecondsOf(game)), "ngRotation"),
          factRow("Half length", `${halfOf(game)} min`, "halfInfo"),
          formationRow(game, actions)
        ),
        carryOverSwitches(carryValuesOf(game), !canChangeCarryOver(game), actions)
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
  const game = isLiveView(state) ? openGame(state) : null;
  const plannedOff = !!game && pairsOf(game).some((pair) => pair.fieldId === player.id);
  const plannedOn = !!game && pairsOf(game).some((pair) => pair.benchId === player.id);
  const planned = plannedOff || plannedOn;
  // The bench-order number (GDA-56): shown on field and bench circles during a game. A number, not just colour.
  const started = screenHalf(state.screen) !== 0 && openGame(state).state !== NOT_STARTED;
  // GDA-116: the 1st Half screen after the 2nd half has started shows the 1st half as it ended (numbers, rings, bench tag),
  // drawn from the copy saved at kick-off and never moving. An older game without the copy shows none of them.
  const afterHalf = screenHalf(state.screen) === 1 && started && [SECOND_HALF, FINISHED].includes(openGame(state).state);
  const atWhistle = afterHalf ? firstHalfCopyOf(openGame(state)) : null;
  const number = started ? benchNumberOf(afterHalf ? atWhistle ?? {} : openGame(state), player.id) : null;
  const turnMark = number ? h("span", { class: "turn", "aria-label": `Bench order ${number}`, title: `Bench order ${number}` }, String(number)) : null;
  // GDA-80: a pitch circle of someone who has been on the bench shows one thin frozen ring per stint (this half),
  // each at how full the bench ring was when they came on. Nobody benched, no rings. (Replaces the "4m" label of GDA-29.)
  // Frozen rings belong to the half being played, so only that half's screen shows them.
  // GDA-107: the 2nd Half plan draws the 1st half's figures the same way (moving while it runs, frozen at the whistle),
  // by where the player is on the plan now.
  const figures = afterHalf ? firstHalfFigures(openGame(state)) : screenHalf(state.screen) === 2 && started ? planFigures(openGame(state), Date.now()) : null;
  const shown = figures ? planFiguresFor(figures, player.id, onPitch) : null;
  const liveStints = onPitch && started && (screenHalf(state.screen) === 2) === (lineupKey(openGame(state)) === "secondHalf") ? openGame(state).benchStints?.[player.id] : undefined; // (with Carry over bench time ON these already include the 1st half's, GDA-116)
  const stints = shown ? (shown.rings.length > 0 ? shown.rings : undefined) : liveStints;
  const frozen = stints ? frozenRings(stints, rotationSecondsOf(openGame(state)), dims) : null;
  // Plan bench: the existing bench ring, filled to the spell running at the whistle, and the .tm tag (none if not on the bench then).
  const planBench = shown && !onPitch && (!benchTimer || afterHalf);
  // GDA-116: the 1st half's bench circles are drawn as it ended and do not tick (no data-plan-bench, so drawBenchTimers leaves them).
  const rotation = rotationSecondsOf(openGame(state));
  // Room for the rings above and below the circle so they never cover the name (one ring step is weight + 1px gap).
  const frozenSpace = stints ? Math.min(stints.length, MAX_FROZEN_RINGS) * (dims.weight + 1) : 0;
  // A planned swap: OFF and ON tags on the circles (GDA-75), and a dotted line between them (GDA-80, drawPairLines).
  const planTag = plannedOff ? h("span", { class: "pt" }, "OFF") : plannedOn ? h("span", { class: "pt on" }, "ON") : null;
  // The keeper is shown by the glove badge on the circle alone (GDA-99: no "GK" text after the name).
  const nameLine = h("div", { class: "nm" }, player.name);
  return h(
    "div",
    {
      class: ["slot", player.id === state.selectedId ? "sel" : "", planned ? "plan" : "", isKeeper ? "keeper" : "", planBench && shown.seconds !== null && isBenchLate(shown.seconds, rotation) ? "lt" : ""].join(" ").trim(),
      ...(canMove ? { "data-player": player.id } : {}),
      ...(canEditNotes(openGame(state)) && !state.viewId ? { "data-note": player.id } : {}), // GDA-81: can be held for a note
      ...(planBench && !afterHalf ? { "data-plan-bench": player.id } : {}), // GDA-107: the plan's bench circles move with the 1st half
      ...(benchTimer ? { "data-bench": player.id } : {}), // Marks a timer circle; it is not draggable.
    },
    h("div", { class: "ci", ...(frozen ? { style: `margin: ${frozenSpace}px 0` } : {}) }, avatar(player), benchTimer && !afterHalf ? ring(dims) : planBench || (afterHalf && benchTimer) ? ring(dims, !shown || shown.seconds === null ? 0 : ringFraction(shown.seconds, rotation)) : null, frozen, isKeeper || openGame(state).keeperTurns?.includes(player.id) ? h("span", { class: "gkb", "aria-hidden": "true" }, icon("glove")) : null, turnMark, planTag, benchTimer && !afterHalf ? h("div", { class: "tm" }) : planBench && shown.seconds !== null ? h("div", { class: "tm" }, benchTimerText(shown.seconds)) : null), // Bench time: a small tag at the circle's bottom-right; drawBenchTimers fills it.
    nameLine
  );
}

/**
 * Status rings (GDA-85). One slot sits flush against the circle's white edge (the 2px border plus the 2px halo);
 * extra rings stack outward with a 1px gap. `dims` is the circle's size and the ring weight (RING_WEIGHT).
 * The SVG is a 140px box centred on the circle, so the rings scale with the circle and never move the layout.
 */
/** Ring thickness everywhere (GDA-99): thin, about 2px. */
const RING_WEIGHT = 2;
/** Circle widths in px (GDA-118), read from the --circle-* tokens in tokens.css (the one place they are set) so the rings fit. */
function circleSize(token, fallback) {
  const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
  return Number.isFinite(px) ? px : fallback;
}
const CIRCLE_SIZES = {
  get pitch() { return circleSize("--circle-pitch", 50); },
  get pitchTight() { return circleSize("--circle-pitch-tight", 40); },
  get bench() { return circleSize("--circle-bench", 44); },
  get benchMany() { return circleSize("--circle-bench-many", 36); },
};
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
function ring(dims, fraction = 0) {
  // Parsed as HTML so the browser puts the SVG parts in the right namespace.
  const holder = document.createElement("div");
  holder.innerHTML = ringCircles(dims, [{ fraction, late: false }], "rg");
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
  const planned = isLiveView(state) && pairsOf(openGame(state)).some((pair) => pair.fieldId === null && pair.place === place);
  return h(
    "div",
    { class: planned ? "slot plan" : "slot", ...(canMove ? { "data-place": place } : {}) },
    h("div", { class: "ci" }, h("div", { class: "av em" })),
    h("div", { class: "nm" }, "\u00a0")
  );
}

function lineUpRow(title, rowClass, players, state, canMove, benchTimers = false, zone = null) {
  // Circle size and ring weight (GDA-85): a crowded live bench has smaller circles and thinner rings.
  const dims = { size: rowClass.includes("many") ? CIRCLE_SIZES.benchMany : CIRCLE_SIZES.bench, weight: RING_WEIGHT };
  const slots = players.map((player) => playerSlot(player, state, canMove, false, benchTimers, false, dims));
  // `zone` makes the whole row a drop target (GDA-62): "absent" or "bench", line-up screen only.
  return h("div", { class: rowClass, ...(rowClass.includes("live") ? { style: `--subs: ${Math.max(players.length, 4)}` } : {}), ...(zone ? { "data-zone": zone } : {}) }, h("span", { class: "t" }, title), ...slots);
}

/** The 1st Half (Not started) main button: Start 1st half. While a player is selected it acts on them instead. */
function lineUpButton(view, state, actions) {
  if (state.selectedId === null) {
    return h("button", { class: "btn pri main", id: "startFirst", onclick: actions.startFirstHalf }, "Start 1st half");
  }
  return view.absent.some((player) => player.id === state.selectedId)
    ? h("button", { class: "btn pri main", onclick: actions.markBackIn }, "Back in")
    : h("button", { class: "btn pri main", onclick: actions.markAbsent }, "Absent");
}

/** The pitch and bench, shared by the line-up and the before-kick-off screen. */
function openRowsTight(shape) {
  return pitchRows(shape).length >= 5;
}
function pitchAndBench(view, state, canMove, crowded, live = false, benchZone = false) {
  const game = openGame(state);
  // GDA-127: the pitch draws the Formation of the half the screen shows.
  const shape = formationOf(game, screenHalf(state.screen) || 1);
  const tight = crowded || openRowsTight(shape);
  const dims = { size: tight ? CIRCLE_SIZES.pitchTight : CIRCLE_SIZES.pitch, weight: RING_WEIGHT };
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
  const rows = pitchRows(shape);
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
  // GDA-107: the 2nd Half plan at half time carries the bench ring and tag, so its bench row is drawn the way the live one is.
  const atHalfTime = screenHalf(state.screen) === 2 && planFigures(game, 0) !== null;
  const benchClass = atHalfTime ? (view.bench.length > 6 ? "row live many" : "row live") : view.bench.length > 6 ? "row many" : "row"; // GDA-134: 7 or more subs share one row
  return [pitch, lineUpRow("BENCH", benchClass, view.bench, state, canMove, false, benchZone ? "bench" : null)];
}

/** The game the game screens show: the finished game being looked at (GDA-100), otherwise the open game. */
function openGame(state) {
  return state.games.find((candidate) => candidate.id === (state.viewId ?? state.gameId));
}

/** The bottom row of every half screen (GDA-95): the main button, always in the same spot, then the cog. */
function bottomRow(state, actions, main) {
  return [problemLine(state.problem), h("div", { class: "gr" }, main, cogButton(actions, "bot", state))].filter(Boolean);
}
function bottomBar(state, actions, main, setup = false) {
  // setup (GDA-134): the line-up screens' bottom row (56px pill, round settings button); the live game keeps its own.
  return h("div", { class: setup ? "acts game setup" : "acts game" }, ...bottomRow(state, actions, main));
}

/** The pitch, bench and ABSENT row of a half that is Not started. `editable` false shows them for looking only. */
function planBody(game, view, state, actions, { editable, firstHalf, note }) {
  const crowded = view.bench.length > 6 || view.absent.length > 6;
  return h(
    "div",
    { class: "lu setup" },
    ...pitchAndBench(view, state, editable, crowded, false, editable && firstHalf),
    // GDA-62: always there, below the bench, even when empty (then slim). Only the 1st half's line-up can change who is absent.
    // 2nd half: no Absent row; leavers are marked through Who is here in Game details (GDA-99).
    firstHalf ? lineUpRow("ABSENT", view.absent.length > 0 ? "row ab" : "row ab empty", view.absent, state, editable, false, editable ? "absent" : null) : null
  );
}

/**
 * A half that is Not started (GDA-95). 1st Half: the line-up and Start 1st half (today's line-up screen).
 * 2nd Half: once the 1st half has ended, the half-time plan and Start 2nd half; before that, the line-up
 * for looking at, and a greyed-out button saying when it can start.
 */
function notStartedHalf(state, actions, half) {
  const game = openGame(state);
  const view = halfLineUpView(game, state.players, half);
  if (half === 1) {
    return {
      fixed: true,
      noMove: true,
      nodes: [
        navBar("1st Half", null, state, actions),
        planBody(game, view, state, actions, { editable: true, firstHalf: true }),
        bottomBar(state, actions, lineUpButton(view, state, actions), true),
        gameDetailsSheet(state, game, actions),
      ],
    };
  }
  const startable = canStartHalf(game, 2);
  const main = startable
    ? h("button", { class: "btn pri main", id: "startSecond", onclick: actions.startSecondHalf }, "Start 2nd half")
    : h("button", { class: "btn main", id: "startSecond", disabled: true }, "Starts when the 1st half ends");
  // GDA-97: the plan can be edited from before kick-off (frame 4: "Planning" while the 1st half is on) until Start 2nd half.
    return {
    fixed: true,
    noMove: true,
    nodes: [
      navBar("2nd Half", startable ? "Not started" : "Planning", state, actions),
      planBody(game, view, state, actions, { editable: canPlan(game), firstHalf: false }),
      bottomBar(state, actions, main, true),
      gameDetailsSheet(state, game, actions),
    ].filter(Boolean),
  };
}

/**
 * The Formation row (GDA-22, GDA-127), in the New game screen's card and the cog's Game details. It edits the next
 * half to be played (see formationRowHalf) and is read-only (disabled: no keypad) when there is none. Typing is checked
 * at once against the team size (its number of places): a valid shape is saved; an invalid one gets a red outline and
 * the last good shape stays saved.
 */
function formationRow(game, actions) {
  return formationBox({
    size: game.lineups.firstHalf.positions.length,
    shown: shownFormation(game),
    disabled: formationRowHalf(game) === null,
    onValid: actions.setFormation,
  });
}

/** The Formation box itself, used by the game rows above and by the Create game form (GDA-127). */
function formationBox({ size, shown, disabled, onValid }) {
  const input = h("input", {
    id: "formation",
    type: "text", // text (not number) so the value can hold dashes
    value: shown,
    // GDA-83: the number keypad (it has no "-", which GDA-71 hit); the box adds the dashes itself.
    inputmode: "numeric",
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    "aria-label": "Formation",
    disabled,
  });
  // The shape last saved from this box (the closed-over `game` goes stale as Ben types).
  let saved = shown;
  input.addEventListener("input", () => {
    // Show only the digits joined by dashes; setting the value puts the caret at the end.
    const typed = formatFormationDigits(input.value);
    if (input.value !== typed) {
      input.value = typed;
    }
    const result = checkFormation(input.value, size);
    input.classList.toggle("bad", !result.ok);
    if (result.ok && result.formation !== saved) {
      saved = result.formation;
      onValid(result.formation);
    }
  });
  return h("div", { class: "f" }, h("label", { for: "formation" }, "Formation"), input);
}

/** The settings cog (GDA-64): opens the Game details sheet. Sits at the far edge, away from the game buttons. */
function cogButton(actions, extra = "", state = null) {
  // GDA-100: looking at a finished game keeps the cog's place (nothing moves) but it cannot be seen or used.
  if (state?.viewId) {
    return h("span", { class: ("cog gone " + extra).trim(), "aria-hidden": "true" });
  }
  return h("button", { class: ("cog " + extra).trim(), id: "cog", "aria-label": "Game details", onclick: actions.openRotation }, icon("settings"));
}

/**
 * Who is here (GDA-43): one row in the Game details sheet, "Who is here - N of M", that opens the
 * player picker. Only while the game is running (before kick-off the line-up screen does this).
 */
function hereRow(state, game, actions) {
  if (!canChangeWhoIsHere(game)) {
    return null;
  }
  const here = state.players.filter((p) => !game.absent.includes(p.id)).length;
  return h("button", { class: "setrow rowbtn", id: "hereRow", onclick: actions.openHere }, h("span", {}, "Who is here"), h("span", { class: "ro" }, `${here} of ${state.players.length} \u203a`));
}

/** GDA-121: the row that opens Interchange history (Game details sheet, and the bottom of the Summary page). */
function interchangeRow(actions) {
  return h("button", { class: "setrow rowbtn", id: "interchangeRow", onclick: actions.openInterchange }, h("span", {}, "Interchange history"), h("span", { class: "ro" }, "\u203a"));
}

/**
 * A reusable player picker pop-up (GDA-43; Who scored uses it too, GDA-90). Fixed title and footer,
 * only the grid scrolls. The optional gridHead, gridTail, middle and footer let Who scored add its sections. `selected` is a Set of player ids. multi = ticks (here / absent); single =
 * one tap picks and finishes. Taps call onToggle(id); the caller keeps the draft.
 */
export function playerPicker({ title, subtitle, players, selected, multi, doneLabel, onToggle, onDone, onCancel, id = "pickerSheet", columns = 3, gridHead = null, gridTail = null, middle = null, footer = null, headAction = null, chosen = null }) {
  const tile = (player) => {
    const on = selected.has(player.id);
    return h(
      "button",
      { class: "ptile" + (multi ? (on ? " here" : " away") : "") + (chosen === player.id ? " here" : ""), "data-here": player.id, "aria-pressed": multi ? String(on) : undefined, "aria-label": multi ? `${player.name}, ${on ? "here" : "absent"}` : player.name, onclick: () => onToggle(player.id) },
      h("span", { class: "pav" }, avatar(player)),
      h("span", { class: "pnm" }, player.name),
      multi || chosen === player.id ? h("span", { class: "pchk" }, on || chosen === player.id ? "\u2713" : "") : null
    );
  };
  return h(
    "div",
    { class: "scrim", id },
    h(
      "div",
      { class: "sheet picker" },
      h("div", { class: "phead" }, h("h2", {}, title, subtitle ? h("small", { id: "pickerSub" }, subtitle) : null), headAction, h("button", { class: "pkx", id: "pickerX", "aria-label": "Close", onclick: onCancel }, "\u00d7")),
      h("div", { class: "pgrid" + (columns === 4 ? " cols4" : "") }, gridHead, ...players.map(tile), gridTail),
      middle,
      footer ?? (multi ? h("div", { class: "pfoot" }, h("button", { class: "btn pri", id: "pickerDone", onclick: onDone }, doneLabel)) : null)
    )
  );
}

/** The Who is here picker, drawn while state.hereDraft is open. */
function hereDraftPicker(state, actions) {
  const n = state.hereDraft.size;
  const total = state.players.length;
  return playerPicker({
    title: "Who is here?",
    players: state.players,
    selected: state.hereDraft,
    multi: true,
    doneLabel: `Done \u00b7 ${n} here`,
    onToggle: actions.toggleHereDraft,
    onDone: actions.doneHere,
    onCancel: actions.cancelHere,
  });
}

/**
 * GDA-88: change Home / Away / Other and the Field text in the Game details sheet. Each change is
 * saved at once. An older game shows its old venue text in Field and has no tag chosen.
 * (The sheet only opens on the game screens, never after Full Time.)
 */
function venueEditor(game, actions) {
  const input = h("input", { id: "i-detField", type: "text", autocomplete: "off", autocapitalize: "words", autocorrect: "off", spellcheck: "false", "aria-label": "Field" });
  input.value = game.venue ?? "";
  input.addEventListener("input", () => actions.changeVenue({ venue: input.value }));
  return [
    h("div", { class: "setrow" }, h("span", {}, "Home or away"), venueTagChoice(game.venueTag ?? "", (tag) => actions.changeVenue({ venueTag: tag }))),
    h("div", { class: "f" }, h("span", {}, "Field"), input),
  ];
}

/**
 * Undo kick-off (GDA-98): in the Game details sheet only while the half shown is In progress and has a
 * saved copy from its kick-off. Not shown at all otherwise (not just greyed). The first tap asks;
 * "Keep playing" changes nothing; "Undo kick-off" undoes it.
 */
function undoKickOffRow(state, game, actions) {
  if (!canUndoKickOff(game, screenHalf(state.screen))) {
    return null;
  }
  if (!state.undoKickOffAsk) {
    return h("button", { class: "btn redtext", id: "undoKickOff", onclick: actions.askUndoKickOff }, "Undo kick-off");
  }
  return h(
    "div",
    { class: "card undoAsk", id: "undoKickOffAsk" },
    h("b", {}, "Undo kick-off?"),
    h("p", {}, "The clock goes back to 0:00 and this half's swaps and goals are removed."),
    h("button", { class: "btn del", id: "confirmUndoKickOff", onclick: actions.confirmUndoKickOff }, "Undo kick-off"),
    h("button", { class: "btn", id: "keepPlaying", onclick: actions.keepPlaying }, "Cancel")
  );
}

/**
 * GDA-86: the two "Carry over" switches, as native `<input type="checkbox" switch>` (the real iOS switch on
 * iOS Safari 17.4+, a plain checkbox elsewhere). The whole label row is the tap target. Once the 2nd half
 * has started (`locked`) the inputs are disabled and the heading says LOCKED.
 */
function carryOverSwitches(values, locked, actions) {
  const row = (which, text, on) =>
    h(
      "label",
      { class: "swrow", id: "tg-" + which },
      h("span", {}, text),
      h("input", { type: "checkbox", switch: "", id: "tgi-" + which, checked: on, disabled: locked, onchange: () => actions.toggleCarryOver(which) })
    );
  return h(
    "div",
    { class: "swlist", id: "carrySwitches" },
    h("div", { class: "swhead" }, "Carry over from 1st half", locked ? h("span", { class: "swlock" }, " \u00b7 LOCKED") : null),
    setCard(row("carryRotationOrder", "Carry over rotation order", values.carryRotationOrder), row("carryBenchTime", "Carry over bench time", values.carryBenchTime))
  );
}
function carryValuesOf(game) {
  return { carryRotationOrder: carriesRotationOrder(game), carryBenchTime: carriesBenchTime(game) };
}

/**
 * The Game details sheet (GDA-64, GDA-105), drawn only while open: the rotation length, Who is here,
 * the two Carry over switches, Undo kick-off and Done. Opposition, date, Home / Away and Field live on the New game screen. Each tap on - or + is saved at once;
 * Done only closes the sheet.
 */
function gameDetailsSheet(state, game, actions) {
  if (!state.rotationOpen) {
    return null;
  }
  if (state.hereDraft) {
    return hereDraftPicker(state, actions);
  }
  const undoRow = undoKickOffRow(state, game, actions);
  return h(
    "div",
    { class: "scrim", id: "rotSheet" },
    h(
      "div",
      { class: "sheet" },
      sheetHead("Game details", actions.closeRotation, "rotX"),
      setCard(
        h("div", { class: "setrow" }, h("span", {}, "Rotation length"), rotationPicker(clampRotation(game.rotationMinutes ?? 6, halfOf(game)), snappedSeconds(game.rotationExtraSeconds, clampRotation(game.rotationMinutes ?? 6, halfOf(game)), halfOf(game)), halfOf(game), actions.setRotation)),
        formationRow(game, actions),
        hereRow(state, game, actions),
        interchangeRow(actions)
      ),
      // GDA-86, GDA-105: on both half screens (editable until the 2nd half starts, read-only after).
      carryOverSwitches(carryValuesOf(game), !canChangeCarryOver(game), actions),
      undoRow && !state.undoKickOffAsk ? setCard(undoRow) : undoRow,
      h("button", { class: "btn pri", id: "rotDone", onclick: actions.closeRotation }, "Done")
    )
  );
}

/**
 * The score for the top band (GDA-40): "US 2 - 1 THEM", counted from the saved goals,
 * always labelled. With `actions` it is a button (tap = Remove last goal, GDA-39);
 * without, it is plain text (before kick-off, nothing to remove).
 */
let scoreFlashAt = 0;
/** Class (and delay) for a score panel. While the flash runs, a redraw resumes the fade part-way instead of restarting it. */
function scoreFlashProps(cls) {
  const elapsed = Date.now() - scoreFlashAt;
  return elapsed >= 0 && elapsed < 1000 ? { class: cls + " flash", style: `animation-delay: -${elapsed}ms` } : { class: cls };
}
/** Starts the violet outline flash (1 second) on the score panel (GDA-90). Screens are redrawn often, so scoreBox keeps it going. */
export function startScoreFlash() {
  scoreFlashAt = Date.now();
}

/** A team's logo (GDA-126) if it has one, otherwise a grey disc with its initials (always the case for the opposition). */
function teamLogo(name, logo, extraClass = "") {
  return logo
    ? h("img", { class: ("logo pic " + extraClass).trim(), src: logo, alt: "", draggable: false })
    : h("span", { class: ("logo disc " + extraClass).trim(), "aria-hidden": "true" }, initialsFor(name));
}

function currentTeamOf(state) {
  return state.teams.find((t) => t.id === state.currentTeamId);
}

// Team logos by team id, kept on this phone. main.js sets them before each draw (like setPhotos).
let currentLogos = {};
export function setLogos(logos) {
  currentLogos = logos;
}

/**
 * The header card at the top of a half that is In progress or Ended (GDA-75, GDA-95): ‹ arrow, half and
 * clock, two team rows (logo, name, score), › arrow, and a thin bar along the bottom edge that fills over
 * the half (drawClock moves it). With `actions` the team rows are one button (tap = Who scored? / Undo
 * last goal); without, plain text.
 */
function gameHeader(text, label, game, actions, state, arrows) {
  const score = scoreOf(game);
  const team = state.teams.find((t) => t.id === (game.teamId ?? state.currentTeamId));
  const usName = team?.name ?? "Us";
  const row = (name, logo, n, id) => h("span", { class: "trow" }, teamLogo(name, logo), h("span", { class: "tn" }, name), h("span", { class: "tg", id }, String(n)));
  const rows = [row(usName, currentLogos[team?.id], score.us, "scoreUs"), row(game.opposition, null, score.them, "scoreThem")];
  const teams = actions
    ? h("button", { ...scoreFlashProps("teams"), id: "score", "aria-label": `Score, ${usName} ${score.us}, ${game.opposition} ${score.them}. Tap to add or undo a goal`, onclick: actions.openGoalDialog }, ...rows)
    : h("div", { ...scoreFlashProps("teams"), id: "score" }, ...rows);
  return h(
    "div",
    { class: "clk" },
    arrows[0],
    h("div", { class: "ck" }, h("span", { class: "hf" }, label), h("b", { id: "clock" }, text)),
    teams,
    arrows[1],
    h("div", { class: "hp" }, h("i", { id: "halfBar" }))
  );
}

/**
 * A half that is In progress or Ended (GDA-95). In progress: the time is worked out from the saved start
 * time every time it is drawn; End Half is the main button. Ended: the clock is frozen at the saved end
 * time, a note replaces the swap strip, nothing can be moved, and the main button is Resume half (only
 * while the next half has not started). The header, strip, pitch and bottom row are the same size in both
 * states, so nothing jumps. The TIME strip and the black End Half are always drawn but hidden, and
 * drawClock shows them, so nothing is rebuilt as the clock runs.
 */
function runningHalf(state, actions, half) {
  const game = openGame(state);
  const live = phaseOf(game, half) === IN_PROGRESS_PHASE;
  const view = halfLineUpView(game, state.players, half);
  const startedAt = half === 2 ? game.secondHalfStartedAt : game.firstHalfStartedAt;
  const endedAt = half === 2 ? game.secondHalfEndedAt : game.firstHalfEndedAt;
  const clock = clockText(startedAt, live ? Date.now() : endedAt, halfOf(game));
  const label = half === 2 ? "2ND HALF" : "1ST HALF";
  const strip = live
    ? swapStrip(game, state, actions)
    : h("div", { class: "strip", id: "strip" }, h("div", { class: "sl", id: "endedNote" }, h("b", { class: "a" }, `${half === 2 ? "2nd" : "1st"} half ended`)));
  let main;
  if (live) {
    main = h("button", { class: "btn eh wide", id: "endHalf", onclick: actions.endHalf }, icon("flag"), "End Half");
  } else if (canResumeHalf(game, half)) {
    main = h("button", { class: "btn eh wide", id: "resumeHalf", onclick: actions.resumeHalf }, "Resume half");
  } else {
    main = h("div", { class: "mainGap" }); // Keeps the cog where it is when there is nothing to resume.
  }
  return {
    fixed: true,
    noMove: true,
    nodes: [
      gameHeader(clock, label, game, canAddGoal(game) ? actions : null, state, navArrows(state, actions)),
      strip,
      h("div", { class: "lu" }, ...pitchAndBench(view, state, live, view.bench.length > 6, true)),
      bottomBar(state, actions, main),
      gameDetailsSheet(state, game, actions),
      goalDialog(state, game, actions),
      noteSheet(state, game, actions),
    ],
    after: () => {
      drawClock(state);
      drawPairLines(state);
    },
  };
}

/** The 1st Half and 2nd Half screens: Not started, In progress or Ended, whichever the saved game says. */
function halfScreen(state, actions) {
  const half = screenHalf(state.screen);
  return phaseOf(openGame(state), half) === NOT_STARTED_PHASE ? notStartedHalf(state, actions, half) : runningHalf(state, actions, half);
}

/**
 * "Who scored?" (GDA-90/91): the Who is here picker's tiles in single-pick mode, in single-pick mode,
 * a last tile "Their own goal", an Opposition goal button and a footer with Undo last goal and Cancel.
 * Every action (a goal, Undo last goal, Cancel) closes it.
 */
function goalDialog(state, game, actions) {
  if (!state.goalOpen || !canAddGoal(game)) {
    return null;
  }
  const players = scorerChoices(game, state.players, game.played);
  const undoLine = undoLineOf(game, (id) => state.players.find((p) => p.id === id)?.name);
  const ownGoal = h(
    "button",
    { class: "ptile og", id: "ownGoal", onclick: () => actions.chooseScorer(null) },
    h("span", { class: "pav" }, h("span", { class: "av c3" }, "OG")),
    h("span", { class: "pnm" }, "Own goal")
  );
  return playerPicker({
    id: "goalDialog",
    columns: players.length >= 13 ? 4 : 3, // 13 or more players: 4 per row so 15 fit without scrolling (Ben, 2026-11-11)
    title: "Who scored?",
    players,
    selected: new Set(),
    multi: false,
    onToggle: actions.chooseScorer,
    onCancel: actions.closeGoalDialog,
    // GDA-108: opens the Summary (the clock keeps running); Back there returns to the game with this pop-up closed.
    headAction: h("button", { class: "pkx txt", id: "openSummary", onclick: actions.openSummary }, "Summary"),
    gridTail: ownGoal,
    middle: h("div", { class: "gagainst" }, h("button", { class: "btn", id: "goalThem", onclick: actions.goalAgainst }, "Opposition goal")),
    footer: h(
      "div",
      { class: "pfoot" },
      h("button", { class: "btn grey undo2", id: "undoGoal", disabled: undoLine === null, onclick: actions.undoLastGoal }, "Undo last goal", undoLine ? h("small", { id: "undoLine" }, undoLine) : null)
    ),
  });
}

/**
 * The one fixed-height strip under the clock (GDA-63). It holds, one at a time, the Swap
 * Time message (drawSwapMessage fills it in), "Swap done / Undo" for about 5 seconds after
 * a Swap, or TIME when the half is over (drawClock shows it). The Swap button sits beside
 * the message or TIME while pairs are planned. The height never changes, so the pitch and
 * bench never move. The rules for Swap, Undo and the message are unchanged.
 */
/** One names line of the strip: "Off A, B -> On C, D" (or just "On C" when nobody comes off). Used for the swap message and "Swapped". */
function namesLine(off, on) {
  return off === null || off === ""
    ? h("div", { class: "b" }, h("b", {}, "On"), ` ${on}`)
    : h("div", { class: "b" }, h("b", {}, "Off"), ` ${off} \u2192 `, h("b", {}, "On"), ` ${on}`);
}

function swapStrip(game, state, actions) {
  const planned = pairsOf(game).length > 0;
  const undo = !planned && state.undo && Date.now() < state.undo.until ? state.undo : null;
  // GDA-99: the same layout in every state. Words on the left, one button on the right (Swap, or Undo for a few seconds after a swap).
  return h(
    "div",
    { class: "strip", id: "strip" },
    h("div", { class: "sl", id: "swapMsg", hidden: true }),
    h("div", { class: "sl", id: "timeStrip", hidden: true }, h("div", { class: "a" }, "TIME")),
    undo
      ? h("div", { class: "sl", id: "swappedMsg" }, h("div", { class: "a" }, "Swapped"), undo.names ? namesLine(undo.names.off.join(", "), undo.names.on.join(", ")) : null)
      : null,
    undo
      ? h("button", { class: "btn swp undoBtn", id: "undo", onclick: actions.undo }, "Undo")
      : planned ? h("button", { class: "btn swp", id: "swap", onclick: actions.swap }, "Swap") : null
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
  if (!area || !game || !isLiveView(state) || pairsOf(game).length === 0) {
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
        lines += `<line class="dl plan" x1="${cut.x1}" y1="${cut.y1}" x2="${cut.x2}" y2="${cut.y2}" stroke-dasharray="2 6"></line>`;
      }
    }
    const along = !b || b.y === a.y ? 0.5 : (edge - a.y) / (b.y - a.y);
    const x = Math.max(22, Math.min(box.width - 22, b ? a.x + (b.x - a.x) * along : a.x));
    crosses.append(
      h("button", { class: "xx", "aria-label": "Remove pair", style: `left:${x}px;top:${edge - 14}px`, onclick: () => actions.unpair(pair.benchId) }, h("span", {}, "\u00d7"))
    );
  }
  // Parsed as HTML so the browser puts the SVG parts in the right namespace.
  const holder = document.createElement("div");
  holder.innerHTML = `<svg class="pl">${lines}</svg>`;
  area.append(holder.firstChild, crosses);
}

/** Moves the clock, the TIME strip and the End Half colour on, without redrawing the screen. Safe at any moment. */
export function drawClock(state) {
  if (state.screen === "interchange") {
    drawTally(state);
    return;
  }
  const game = openGame(state);
  const clock = document.getElementById("clock");
  if (isLiveViewOf(state, game) && clock) {
    const now = Date.now();
    clock.textContent = clockText(startedAtOf(game), now, halfOf(game));
    const timeUp = isTimeUp(startedAtOf(game), now, halfOf(game));
    // TIME takes the message's place in the same strip (but not while "Swapped / Undo" is showing).
    document.getElementById("timeStrip").hidden = !timeUp || !!document.getElementById("swappedMsg");
    document.getElementById("endHalf").classList.toggle("pri", timeUp);
    // The half progress bar along the bottom of the header card.
    const seconds = Math.max(0, (now - startedAtOf(game)) / 1000);
    document.getElementById("halfBar").style.width = Math.min(100, (seconds / (halfOf(game) * 60)) * 100).toFixed(1) + "%";
    drawBenchTimers(game, now);
    drawSwapMessage(game, state.players, now, timeUp);
    // The strip never changes height, so the pair lines never need redrawing here.
  } else if (clock === null && screenHalf(state.screen) === 2 && game && game.state === FIRST_HALF && typeof game.firstHalfStartedAt === "number" && typeof game.firstHalfEndedAt !== "number") {
    // GDA-107: the 2nd Half plan while the 1st half runs: only the bench rings and tags move (text and ring length, no redraw).
    drawBenchTimers(game, Date.now());
  }
}

/**
 * Fills the swap time into the strip (GDA-104): "SWAP IN 3:20" counting down, yellow for the last
 * 30 seconds, then "SWAP TIME" when due, red with "+1:10" once it is late (30 seconds or more; before
 * that the plus shows but the colour stays black). Time only, no names. The words carry the message,
 * not colour alone. The strip has a fixed height, so the pitch never moves.
 */
function drawSwapMessage(game, squad, now, timeUp) {
  const strip = document.getElementById("strip");
  const box = document.getElementById("swapMsg");
  const swapped = !!document.getElementById("swappedMsg"); // "Swapped / Undo" has the strip for a few seconds.
  const message = timeUp || swapped ? null : swapMessage(game, squad, now);
  if (!message) {
    box.hidden = true;
    box.textContent = "";
    box.dataset.key = "";
    strip.className = timeUp && !swapped ? "strip timeup" : "strip";
    return;
  }
  const mmss = (total) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  const title = message.phase === "due" ? (message.late > 0 ? `SWAP TIME +${mmss(message.late)}` : "SWAP TIME") : `SWAP IN ${mmss(message.countdown)}`;
  if (box.dataset.key !== title) {
    box.dataset.key = title;
    box.replaceChildren(h("div", { class: "a" }, title));
  }
  box.hidden = false;
  strip.className = "strip " + (message.phase === "next" ? "" : message.phase === "warn" ? "warn" : message.late >= 30 ? "late" : "swap");
}

/** Sets each bench circle's time and ring from the saved times. Same path as the clock, so a lock or reload cannot skew it. */
function drawBenchTimers(game, now) {
  const rotation = rotationSecondsOf(game); // Read every tick, so a changed length shows at once.
  for (const slot of document.querySelectorAll(".row.live .slot[data-bench], .row.live .slot[data-plan-bench]")) {
    if (!slot.querySelector(".tm")) continue; // a plan circle with no spell running: empty ring, no tag
    const seconds = benchSeconds(game, slot.dataset.bench ?? slot.dataset.planBench, now);
    slot.querySelector(".tm").textContent = benchTimerText(seconds);
    const arc = slot.querySelector(".r1");
    const length = Number(arc.getAttribute("data-len"));
    arc.setAttribute("stroke-dasharray", `${(ringFraction(seconds, rotation) * length).toFixed(1)} ${length.toFixed(1)}`);
    slot.classList.toggle("lt", isBenchLate(seconds, rotation));
  }
}

/** "End the game?" (GDA-99): asked before End game and save, so a stray tap cannot close the game. */
function fullTimeSheet(actions) {
  return h(
    "div",
    { class: "scrim", id: "fullTimeConfirm" },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, "End the game?"),
      h("p", {}, "It can't be reopened."),
      h("button", { class: "btn del", id: "confirmFullTime", onclick: actions.fullTime }, "End game and save"),
      h("button", { class: "btn", id: "cancelFullTime", onclick: actions.cancelFullTime }, "Cancel")
    )
  );
}

/**
 * The Summary page (GDA-108, GDA-82): score, goal timeline, coach's notes and Player of the day, in that order.
 * Empty sections are hidden, except the Player of the day row while it can still be chosen (it is the way in).
 * `canChoose` is true before End game and save; a finished game shows the page locked (no row if nobody was chosen).
 * Used by the mid-game Summary, the Full Time screen and a finished game opened from Home.
 */
function summaryBody(state, game, actions, { canChoose, soFar }) {
  const ourName = (state.teams.find((t) => t.id === (game.teamId ?? state.currentTeamId))?.name) ?? "Our team";
  const summary = summaryOf(game, state.players);
  const potdPlayer = potdOf(game) === null ? null : state.players.find((p) => p.id === potdOf(game)) ?? null;
  const potdRow = canChoose
    ? h("button", { class: "setrow rowbtn card", id: "potdRow", onclick: actions.openPotdPicker }, h("span", {}, "Player of the day"), h("span", { class: "ro", id: "potdValue" }, potdPlayer ? h("span", { class: "mini" }, avatar(potdPlayer)) : null, summary.potd ? h("b", {}, summary.potd) : "Choose", " \u203a"))
    : summary.potd
      ? h("div", { class: "setrow card", id: "potdRow" }, h("span", {}, "Player of the day"), h("span", { class: "ro", id: "potdValue" }, potdPlayer ? h("span", { class: "mini" }, avatar(potdPlayer)) : null, h("b", {}, summary.potd)))
      : null;
  return [
    h("div", { class: "lbl", id: "fullTimeTitle" }, `${ourName} v ${game.opposition}${soFar ? " \u00b7 so far" : ""}`),
    h("div", { class: "bigscore", id: "finalScore" }, `${summary.score.us} - ${summary.score.them}`),
    summary.goals.length > 0
      ? h("div", { class: "card", id: "timeline" }, ...summary.goals.map((g) => h("div", { class: g.side === US ? "tl" : "tl them" }, h("span", { class: "t" }, g.when), h("span", { class: "ball" }, icon("ball")), h("span", { class: g.side === US ? "" : "ro" }, g.who))))
      : null,
    summary.notes.length > 0 ? h("div", { class: "card nt", id: "notesCard" }, ...summary.notes.map((n) => h("div", {}, h("b", {}, n.name), " ", n.text))) : null,
    potdRow,
    setCard(interchangeRow(actions)),
  ];
}

/** The mid-game Summary (GDA-108): opened from "Who scored?". Back returns to the game; nothing here changes the game except Player of the day. */
function summaryScreen(state, actions) {
  const game = openGame(state);
  return {
    nodes: [
      header("Summary", actions.closeSummary),
      h("div", { class: "body" }, ...summaryBody(state, game, actions, { canChoose: canEditNotes(game), soFar: true }), problemLine(state.problem)),
      potdPicker(state, game, actions),
    ],
  };
}

/**
 * Full Time (GDA-50, GDA-95, GDA-108): reached with \u203a once the 2nd half has ended. It IS the Summary page, plus
 * End game and save, which stores the record and closes the game for good. \u2039 only goes back to the 2nd Half (Ended),
 * where Resume half is still there for a last goal. A finished game opened from Home shows it locked.
 */
function fullTimeScreen(state, actions) {
  const game = openGame(state);
  const open = !state.viewId;
  return {
    nodes: [
      navBar("Full Time", null, state, actions),
      h(
        "div",
        { class: "body" },
        ...summaryBody(state, game, actions, { canChoose: open && canEditNotes(game), soFar: false }),
        problemLine(state.problem),
        open ? h("button", { class: "btn pri big", id: "fullTime", onclick: actions.askFullTime }, "End game and save") : null
      ),
      state.fullTimeAsk ? fullTimeSheet(actions) : null,
      open ? potdPicker(state, game, actions) : null,
    ],
  };
}

/** One player name with its arrow, for an Interchange history row. */
function moveBit(kind, name) {
  return h("span", { class: "mv" }, h("span", { class: "ar " + (kind === "off" ? "off" : "on"), role: "img", "aria-label": kind }, icon(kind === "off" ? "arrowDown" : "arrowUp")), name);
}

/** A bench time in its pill: lilac once above 0:00, plain muted at 0:00 (GDA-135). The text is the same either way. */
function benchPill(seconds) {
  return h("span", { class: "bt" + (seconds > 0 ? " on" : "") }, benchTimerText(seconds));
}

const TALLY_HEADINGS = { name: "Name", rotations: "Rotations", seconds: "Bench time" };

/**
 * Interchange history (GDA-121): the bench time tally (a table that sorts by heading), then every swap, oldest first.
 * Read only: it reads the saved swaps and the game and changes nothing. Opened from the Game details sheet or the Summary page.
 */
function interchangeScreen(state, actions) {
  const game = openGame(state);
  const events = state.interchange?.events ?? [];
  const nameOf = (id) => state.players.find((p) => p.id === id)?.name ?? "Player";
  const sort = state.tallySort;
  const rows = sortTally(tallyRows(game, events, state.players, Date.now()), sort.column, sort.descending);
  const heading = (column) => {
    const sorted = sort.column === column;
    return h(
      "th",
      { class: column === "name" ? "" : "n", scope: "col", ...(sorted ? { "aria-sort": sort.descending ? "descending" : "ascending" } : {}) },
      h("button", { type: "button", class: "sorter", "data-col": column, onclick: () => actions.sortTally(column) }, TALLY_HEADINGS[column], h("span", { class: "so", "aria-hidden": "true" }, sorted ? (sort.descending ? "\u25bc" : "\u25b2") : ""))
    );
  };
  const table = h(
    "table",
    { class: "tally", id: "tally" },
    h("thead", {}, h("tr", {}, ...TALLY_COLUMNS.map(heading))),
    h("tbody", {}, ...rows.map((r) => h("tr", { "data-id": String(r.id) }, h("td", {}, r.name), h("td", { class: "n" }, String(r.rotations)), h("td", { class: "n", "data-sec": "1" }, benchPill(r.seconds)))))
  );
  const swaps = interchangeRows(game, events);
  const list = swaps.length === 0
    ? h("div", { class: "empty", id: "noSwaps" }, "No swaps yet")
    : h(
        "div",
        { id: "swapList" },
        h("div", { class: "colh tl" }, h("span", { class: "t" }), h("span", {}, "Off \u203a On")),
        ...swaps.map((row) =>
          h("div", { class: "tl swapRow" }, h("span", { class: "t" }, row.when), h("span", { class: "pairs" }, ...row.pairs.map((pair) => h("span", { class: "pair" }, pair.off !== null ? moveBit("off", nameOf(pair.off)) : null, pair.off !== null && pair.on !== null ? " \u203a " : null, pair.on !== null ? moveBit("on", nameOf(pair.on)) : null))))
        )
      );
  return {
    nodes: [
      centredHeader(header("Interchange history", actions.closeInterchange)),
      h("div", { class: "body" }, h("div", { class: "card" }, h("div", { class: "hd" }, "Bench time"), table), h("div", { class: "card" }, h("div", { class: "hd" }, "Swaps"), list)),
    ],
  };
}

/** GDA-121: while the game runs the tally keeps counting: the bench time cells change their text only, nothing is redrawn or re-sorted. */
function drawTally(state) {
  const game = openGame(state);
  if (!game) {
    return;
  }
  const now = Date.now();
  for (const row of tallyRows(game, state.interchange?.events ?? [], state.players, now)) {
    const cell = document.querySelector(`#tally tr[data-id="${row.id}"] td[data-sec]`);
    if (cell && cell.textContent !== benchTimerText(row.seconds)) {
      cell.replaceChildren(benchPill(row.seconds));
    }
  }
}

/** Pick the Player of the day (GDA-110): the picker tiles, one tap picks and closes; tapping the chosen tile again clears it. */
function potdPicker(state, game, actions) {
  if (!state.potdOpen || !canEditNotes(game)) {
    return null;
  }
  return playerPicker({
    id: "potdPicker",
    columns: 3,
    title: "Player of the day",
    players: scorerChoices(game, state.players, game.played),
    selected: new Set(),
    chosen: potdOf(game),
    multi: false,
    onToggle: actions.pickPotd,
    onCancel: actions.closePotdPicker,
  });
}

/**
 * The press-and-hold sheet (GDA-81, GDA-110): one player's name, a note box (the phone's own text box) and the
 * Player of the day switch (the phone's own). The note is saved when Done is tapped; the switch saves at once.
 * The typed text is kept in state.noteDraft so a redraw behind the sheet never loses it.
 */
function noteSheet(state, game, actions) {
  const player = state.players.find((p) => p.id === state.noteFor);
  if (state.noteFor === null || !player || !canEditNotes(game)) {
    return null;
  }
  const box = h("textarea", { id: "noteText", rows: "4", "aria-label": `Note about ${player.name}`, oninput: () => actions.noteTyped(box.value) });
  box.value = state.noteDraft ?? noteOf(game, player.id);
  return h(
    "div",
    { class: "scrim", id: "noteSheet" },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, player.name),
      box,
      setCard(
        h("label", { class: "swrow", id: "potdSwitchRow" }, h("span", {}, "Player of the day"), h("input", { type: "checkbox", switch: "", id: "potdSwitch", checked: potdOf(game) === player.id, onchange: () => actions.setPotd(player.id, document.getElementById("potdSwitch").checked) }))
      ),
      problemLine(state.problem),
      h("button", { class: "btn pri big", id: "noteDone", onclick: actions.closeNote }, "Done")
    )
  );
}

/** Saved (GDA-50): the record is stored. Save file offers the CSV; Done goes Home. */
function savedScreen(state, actions) {
  const game = state.games.find((g) => g.id === state.gameId);
  const record = game?.record;
  return {
    nodes: [
      header("Game saved"),
      h(
        "div",
        { class: "body" },
        h("div", { class: "bigscore", id: "finalScore" }, record ? `${record.us} - ${record.them}` : ""),
        h("p", {}, "Your game is safe on this phone. No swap, goal or Undo can be reached now. You can save the file later from Home."),
        state.fileProblemFor === game?.id ? h("p", { class: "problem", role: "alert" }, FILE_PROBLEM) : null,
        h("button", { class: "btn pri big saveFile", onclick: () => actions.saveFile(game.id) }, state.fileProblemFor === game?.id ? "Save file again" : "Save file"),
        h("button", { class: "btn big", id: "done", onclick: actions.goHome }, "Done")
      ),
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
  newGame: newGameScreen,
  half1: halfScreen,
  half2: halfScreen,
  fullTime: fullTimeScreen,
  summary: summaryScreen,
  interchange: interchangeScreen,
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
  document.querySelector(".acts").replaceChildren(...bottomRow(state, actions, lineUpButton(view, state, actions)));
}
