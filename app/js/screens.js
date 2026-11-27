// Builds each screen from the current state. Nothing here saves anything: taps
// go to the `actions` that main.js passes in.
//
// Names only ever reach the page as plain text (never as HTML), so a name
// containing < or & just shows as typed.

import { trimmedLine } from "./drag.js";
import { canDeleteGame, canArchiveGame, FINISHED, FIRST_HALF, SECOND_HALF, canPlan, IN_PROGRESS_PHASE, NOT_STARTED_PHASE, phaseOf, canStartHalf, canResumeHalf, halfLineUpView, nextScreen, lineupKey, canChangeWhoIsHere, startedAtOf, endedAtOf, canUndoKickOff, canRestartGame, formationRowHalf, shownFormation, benchSeconds, benchTimerText, canCreateGame, VENUE_TAGS, venueLine, clockText, isBenchLate, ringFraction, planFigures, planFiguresFor, firstHalfFigures, firstHalfCopyOf, dotsFor, dotsLabel, showsSeasonChart, showsRotationCounts, formatGameDate, formatShortDate, formatKickOff, isBlank, isTimeUp, lineUpView, swapMessage, pairsOf, benchNumberOf, rotationSecondsOf, rotationText, ROTATION_EXTRA_SECONDS, snappedSeconds, clampRotation, halfOf, carriesRotationOrder, carriesBenchTime, canChangeCarryOver, MIN_ROTATION, MAX_ROTATION, NOT_STARTED, scoreOf, canAddGoal, scorerChoices, undoLineOf, lastGoal, US, canEditNotes, canCorrect, canCorrectFinished, noteOf, potdOf, summaryOf, goalFixOf } from "./game-rules.js";
import { TALLY_COLUMNS, interchangeRows, sortTally, tallyRows } from "./interchange-rules.js";
import { LIST_COLUMNS, listMeasure, listRows } from "./season-list-rules.js";
import { AREAS, seasonTotals, potdListRows } from "./season-rules.js";
import { gamesPlayed, goalDifferenceText, historyRows, resultRows, teamRecord } from "./history-rules.js";
import { checkFormation, formatFormationDigits, formationOf, pitchRows } from "./formation-rules.js";
import { EXPORT_HINT } from "./export-rules.js";
import { canSaveName, initialsFor } from "./squad-rules.js";
import { RESTORE_ASK } from "./backup-rules.js";
import { MIN_SIDE, MAX_SIDE, formationAfterSizeChange, canSwitchTeams, deleteRefusal, deleteSummary, IN_PROGRESS_REFUSAL, LAST_TEAM_MESSAGE, LOCKED_MESSAGE, plural, UPGRADE_FAILED_MESSAGE } from "./team-rules.js";

/** One small inline SVG icon (24px, 2.2 stroke, round ends, takes the text colour). GDA-74. */
const ICONS = {
  // Settings: two sliders.
  settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M13 4v6", "M7 14v6"],
  // Back arrow (GDA-75) and End half flag.
  back: ["M15 5l-7 7 7 7"],
  next: ["M9 5l7 7-7 7"],
  // GDA-211: the Home team-switch chevron, drawn like back and next (no font size).
  chevDown: ["M6 9l6 6 6-6"],
  chevUp: ["M6 15l6-6 6 6"],
  close: ["M6 6l12 12", "M18 6L6 18"], // GDA-149: Close game on a finished game's Full Time page
  // GDA-166: stopwatch with a tick inside the face (Full time).
  stopwatch: ["M12 6a8 8 0 1 0 0 16a8 8 0 1 0 0-16", "M10 2.5h4", "M12 2.5V6", "M18.5 7l1.5-1.5", "M8.5 14.3l2.4 2.4 4.6-5"],
  flag: ["M6 21V4", "M6 5h11l-2.5 4 2.5 4H6"],
  // Start triangle and Stop square on the head bar chip (GDA-120). "F " paths are filled.
  play: ["F M8 5l11 7-11 7z"],
  stop: ["F M6 6h12v12H6z"],
  // Undo arrow (GDA-125): the swap pill after a swap.
  undo: ["M9 14L4 9l5-5", "M4 9h10a6 6 0 0 1 0 12h-3"],
  // Goalkeeper glove (GDA-85): three fingers, a thumb and a cuff.
  // Football (GDA-108): a circle with a centre patch and seam lines.
  // A path starting with "F " is filled (the solid centre patch makes it read as a ball, not a wheel, at text size).
  ball: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18", "F M12 7.8L16 10.7L14.47 15.4H9.53L8 10.7Z", "M12 7.8V3", "M16 10.7L20.56 9.22", "M14.47 15.4L17.29 19.28", "M9.53 15.4L6.71 19.28", "M8 10.7L3.44 9.22"],
  // GDA-121: the Interchange history arrows (down = off, up = on).
  arrowDown: ["M12 4v16", "M6 14l6 6 6-6"],
  arrowUp: ["M12 20V4", "M6 10l6-6 6 6"],
  // GDA-48: the Pitch / List switch shows the view it switches TO (list lines, or a small pitch).
  list: ["M5 7h.01", "M5 12h.01", "M5 17h.01", "M9 7h11", "M9 12h11", "M9 17h11"],
  pitch: ["M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4z", "M12 4v16", "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6"],
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
function arrowButton(kind, onClick, { iconName = kind, label = kind === "back" ? "Back" : "Next" } = {}) {
  const props = { class: onClick ? "arrow" : "arrow off", id: kind === "back" ? "navBack" : "navNext", "aria-label": label };
  if (onClick) {
    props.onclick = onClick;
  } else {
    props["aria-disabled"] = "true";
  }
  return h("button", props, icon(iconName));
}

/** The arrows for a game screen: Back always works; Next works where the rules say there is a screen to go to. */
function navArrows(state, actions, nextGo = false) {
  const game = openGame(state);
  const hasNext = state.screen === "createGame" ? true : !!game && nextScreen(game, state.screen) !== null;
  // GDA-166: on the 2nd Half the Next arrow is the Full time stopwatch (same button, same action and availability).
  const toFullTime = state.screen === "half2";
  let next = arrowButton("next", hasNext ? actions.goNext : null, toFullTime ? { iconName: "stopwatch", label: "Full time" } : {});
  if (state.screen === "fullTime" && state.viewId) {
    // GDA-149: a finished game looked at from Home: the inactive next arrow becomes Close game (same 44px slot).
    next = h("button", { class: "back", id: "closeGameTop", "aria-label": "Close game", onclick: actions.closeGame }, icon("close"));
  }
  if (nextGo) {
    next.classList.add("go"); // GDA-120: at Half Time the next arrow is the solid dark "go" style
  }
  return [arrowButton("back", actions.goBack), next];
}

/** The top row of a screen with no clock: arrow, title (and a small state tag), arrow. Same box as the game header card. */
function navBar(title, tag, state, actions, pinned = false) {
  const [back, next] = navArrows(state, actions);
  return h("div", { class: pinned ? "clk bar ctr pinned" : "clk bar ctr" }, back, h("h1", {}, title), tag ? h("span", { class: "tag" }, tag) : null, next);
}

/** The player's photo if they have one (GDA-52), otherwise their coloured initials. */
function avatar(player, photos = currentPhotos) {
  const photo = photos[player.id];
  if (photo) {
    return h("div", { class: "av pic" }, h("img", { src: photo, alt: "", draggable: false }));
  }
  return h("div", { class: "av c" + player.colour }, h("span", { class: "in" }, initialsFor(player.name)));
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

/**
 * GDA-185: one not-finished game as a two-line row in Home's games tile: date, "v Opponent" with the venue under it, and the
 * kick-off time (the live score once started) with the status text under that. The whole row opens the game as the old
 * Line-up button did. Upcoming / In progress is worked out from the saved game each time Home is drawn (never stored).
 */
function gameRow(game, actions) {
  const notStarted = game.state === NOT_STARTED;
  const label = notStarted ? "Upcoming" : "In progress";
  const score = scoreOf(game);
  const venue = venueLine(game);
  return h(
    "li",
    { class: "gameRow", "data-game": game.id, role: "button", tabindex: "0", onclick: () => actions.openLineUp(game.id) },
    h("span", { class: "d" }, formatShortDate(game.date)),
    h("span", { class: "o" }, `v ${game.opposition}`, venue ? h("small", {}, venue) : null),
    h("span", { class: "s" }, notStarted ? formatKickOff(game.kickOff) : `${score.us}\u2013${score.them}`, h("small", { class: "stx" + (notStarted ? "" : " live"), "data-status-tag": label }, label))
  );
}

/** "Archive v Eagles?" with one confirm (GDA-185: asked from the finished game's Settings sheet, so it shows there). */
function archiveSheet(state, actions) {
  const game = state.games.find((g) => g.id === state.archiveId);
  if (!game) {
    return null;
  }
  return h(
    "div",
    { class: "scrim", id: "archiveConfirm" },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, `Archive v ${game.opposition}?`),
      h("p", { class: "archiveNote" }, "It will no longer count in the season figures, Season history or the export. It stays saved on this phone."),
      h("button", { class: "btn pri", id: "confirmArchive", onclick: actions.confirmArchive }, "Archive"),
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

/** "Restore will replace all data..." (GDA-153): one confirm, shown before the file picker opens. */
function restoreSheet(state, actions) {
  if (!state.restoreAsk) {
    return null;
  }
  return h(
    "div",
    { class: "scrim", id: "restoreConfirm" },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, RESTORE_ASK),
      h("button", { class: "btn del", id: "confirmRestore", onclick: actions.confirmRestore }, "Continue"),
      h("button", { class: "btn", id: "cancelRestore", onclick: actions.cancelRestore }, "Cancel")
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
  const defaults = form.values.defaults; // GDA-167: the default game settings, edited in place and saved with Save
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
          if (key === "size") {
            // GDA-167: correcting Players per side resets the default Formation to a split that fits (back to the team's own if undone).
            form.values.defaults.formation = formationAfterSizeChange(adding ? null : state.teams.find((t) => t.id === state.currentTeamId), Number(form.values.size));
            const box = document.getElementById("formation");
            if (box) {
              box.value = form.values.defaults.formation;
              box.classList.remove("bad");
            }
          }
        },
      })
    );
  const refusal = deleteRefusal(state.teams, state.games);
  const deleteArea = adding
    ? null
    : refusal === "only"
      ? h("p", { class: "hint", id: "onlyTeam" }, LAST_TEAM_MESSAGE)
      : h(
          "div",
          {},
          // GDA-208: plain style (not red), just above Delete team. Not offered for the only team (that case is the hint above).
          h("button", { class: "btn gapbig", id: "archiveTeam", onclick: actions.askArchiveTeam }, "Archive team"),
          h("button", { class: "btn redtext", id: "deleteTeam", onclick: actions.askDeleteTeam }, "Delete team")
        );
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
        // GDA-167: the usual settings a new game starts from; each can still be changed on the New game form.
        h("div", { class: "swhead" }, "Default game settings"),
        setCard(
          h(
            "div",
            { class: "f" },
            h("span", {}, "Rotation"),
            rotationPicker(defaults.rotationMinutes, defaults.rotationExtraSeconds ?? 0, MAX_ROTATION, (minutes, seconds) => {
              defaults.rotationMinutes = minutes;
              defaults.rotationExtraSeconds = snappedSeconds(seconds, minutes, MAX_ROTATION);
            })
          ),
          formationBox({ size: () => Number(form.values.size), shown: defaults.formation, disabled: false, onValid: (formation) => { defaults.formation = formation; } })
        ),
        carryOverSwitches(defaults, false, { toggleCarryOver: (which) => { defaults[which] = !defaults[which]; } }),
        // GDA-177: what is drawn on the pitch; each game can still change its own in Game settings.
        setCard(
          displaySwitch("showSeasonChart", "Season chart on line-up", defaults.showSeasonChart, () => { defaults.showSeasonChart = !defaults.showSeasonChart; }),
          displaySwitch("showRotationCounts", "Rotation counts", defaults.showRotationCounts, () => { defaults.showRotationCounts = !defaults.showRotationCounts; })
        ),
        adding ? null : h("p", { class: "hint" }, "Size, half length and default game settings apply to new games only. Existing games keep theirs."),
        problemLine(state.problem),
        h("button", { class: "btn pri big", id: "saveTeam", onclick: actions.saveTeam }, "Save"),
        deleteArea ? h("div", { class: "gapbig" }, deleteArea) : null
      ),
      state.deleteTeamOpen ? deleteTeamSheet(state, actions, refusal) : null,
      state.archiveTeamOpen ? archiveTeamSheet(state, actions, refusal) : null,
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
      h("p", { id: "deleteTeamCounts" }, `This erases ${plural(counts.players, "player")}, ${plural(counts.games, "game")} (archived games included), and their events. It can't be undone.`),
      h("p", { id: "deleteTeamWarn" }, "Back up data first if you want to keep a copy."),
      h("button", { class: "btn del", id: "confirmDeleteTeam", onclick: actions.confirmDeleteTeam }, "Delete team"),
      h("button", { class: "btn", id: "cancelDeleteTeam", onclick: actions.cancelDeleteTeam }, "Cancel")
    )
  );
}

/** GDA-208: the Archive team confirm, or the refusal when a game is in progress in that team. */
function archiveTeamSheet(state, actions, refusal) {
  const team = state.teams.find((t) => t.id === state.currentTeamId);
  if (refusal) {
    return h("div", { class: "scrim", id: "archiveTeamConfirm" }, h("div", { class: "sheet" }, h("h2", {}, `Can't archive ${team.name}`), h("p", { class: "refuse" }, IN_PROGRESS_REFUSAL + "."), h("button", { class: "btn", id: "cancelArchiveTeam", onclick: actions.cancelArchiveTeam }, "OK")));
  }
  return h(
    "div",
    { class: "scrim", id: "archiveTeamConfirm" },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, `Archive ${team.name}?`),
      h("p", { id: "archiveTeamText" }, "The team leaves the team list. Its players and games stay saved on this phone and still go into Back up data and Export to spreadsheet. You can bring it back from Archived teams."),
      h("button", { class: "btn pri", id: "confirmArchiveTeam", onclick: actions.confirmArchiveTeam }, "Archive team"),
      h("button", { class: "btn", id: "cancelArchiveTeam", onclick: actions.cancelArchiveTeam }, "Cancel")
    )
  );
}

/** The team line on Home's white team card (GDA-157, GDA-185): crest, name, "N players" and a bare ▾. The whole line is one tap target that opens the team list. */
function teamLine(state, actions) {
  const team = currentTeamOf(state);
  if (!team) {
    return null;
  }
  return h(
    "button",
    { class: "team", id: "teamLine", "aria-label": `Team: ${team.name}. Change team`, onclick: actions.openTeamList },
    teamLogo(team.name, currentLogos[state.currentTeamId], "homeLogo"),
    h("span", { class: "tx" }, h("b", {}, team.name), h("span", { class: "tsize" }, plural(state.players.length, "player"))),
    h("span", { class: "chev", "aria-hidden": "true" }, icon(state.teamListOpen ? "chevUp" : "chevDown"))
  );
}

/** The team list under the team line: tick on the current team, "+ Add team" last, locked while a game is in progress. */
function teamMenuItems(state, actions) {
  const locked = !canSwitchTeams(state.games);
  const items = state.teams.map((team) => {
    // The tick (violet) goes before the current team; the others get blank space of the same width so names line up.
    const mark = team.id === state.currentTeamId ? h("span", { class: "tickMark tickCol" }, "\u2713") : h("span", { class: "tickCol" });
    return h("button", { class: "mi teamItem", "data-team": team.id, disabled: locked, onclick: () => actions.switchTeam(team.id) }, mark, teamLogo(team.name, currentLogos[team.id], "rowLogo"), h("span", { class: "tmName" }, team.name, h("span", { class: "tsize" }, ` \u00b7 ${team.playersPerSide} a side`)));
  });
  return [
    locked ? h("div", { class: "mlock", id: "teamLock" }, LOCKED_MESSAGE) : null,
    ...items,
    h("button", { class: "mi addTeam", disabled: locked, onclick: actions.openAddTeam }, "+ Add team"),
    // GDA-208: only once a team is archived. Tapping it shows the archived teams; tapping one brings it back and makes it current.
    state.archivedTeams.length ? h("button", { class: "mi archivedTeams", id: "archivedTeams", disabled: locked, onclick: actions.openArchivedTeams }, `Archived teams (${state.archivedTeams.length})`) : null,
    ...(state.archivedListOpen && !locked
      ? state.archivedTeams.map((team) =>
          h("button", { class: "mi teamItem", "data-archived-team": team.id, onclick: () => actions.bringBackTeam(team.id) }, h("span", { class: "tickCol" }), teamLogo(team.name, currentLogos[team.id], "rowLogo"), h("span", { class: "tmName" }, team.name, h("span", { class: "tsize" }, ` \u00b7 ${team.playersPerSide} a side`)))
        )
      : []),
  ].filter(Boolean);
}

/**
 * The season section of Home (GDA-185): the tally row, then one card with Results (first) and Players tabs. It reuses Season
 * history's own pieces (historyPlayers, historyResults), so Home and that page always show the same games and figures.
 */
function seasonOnHome(state, actions, record) {
  const figure = (label, value) => h("div", {}, h("span", {}, label), h("b", {}, String(value)));
  const tally = h(
    "div",
    { class: "card tally", id: "homeTally" },
    h("div", { class: "lt" }, figure("P", record.played), figure("W", record.won), figure("D", record.drawn), figure("L", record.lost), figure("GF", record.goalsFor), figure("GA", record.goalsAgainst), figure("GD", goalDifferenceText(record.goalDifference)))
  );
  return [
    tally,
    h(
      "div",
      { class: "card hcard", id: "homeSeason" },
      ...seasonTabs(state, actions)
    ),
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
  // GDA-185: the floating pink "+ New game" pill replaces the "+ Create game" button (not shown with no players).
  const newGamePill = hasPlayers
    ? h("div", { class: "fabWrap" }, h("button", { class: "fab", id: "newGame", onclick: actions.openCreateGame }, "+ New game"))
    : null;
  // Upcoming and in-progress games share one tile (GDA-185); no tile when there are none.
  const unfinished = state.games.filter((game) => game.state !== FINISHED);
  const gamesTile = unfinished.length > 0 ? h("div", { class: "card gamesTile" }, h("ul", { class: "res" }, ...unfinished.map((game) => gameRow(game, actions)))) : null;
  // The season on Home (GDA-185): the same counted games as Season history (history-rules.js), hidden until one has finished.
  const record = teamRecord(state.games);
  const season = record.played > 0 ? seasonOnHome(state, actions, record) : [];
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
        h("div", { class: "mhd" }, "Team"),
        h("button", { class: "mi teamSettings", onclick: actions.openTeamSettings }, "Team settings"),
        // With no players, "+ Add players" on Home does the job, so the Squad item waits until there is a squad.
        hasPlayers ? h("button", { class: "mi squadItem", onclick: actions.openSquad }, `Squad (${state.players.length})`) : null,
        h("button", { class: "mi historyItem", onclick: actions.openHistory }, "Season history"), // GDA-187
        h("div", { class: "mhd" }, "App"),
        // GDA-189: one CSV of every team's finished games, with a one-line hint on what to do with it.
        h("button", { class: "mi exportData", onclick: actions.exportData }, "Export to spreadsheet"),
        h("div", { class: "exportHint" }, EXPORT_HINT),
        // GDA-153: one file with everything on the phone.
        h("button", { class: "mi backUpData", onclick: actions.backUpData }, "Back up data"),
        h("button", { class: "mi d restoreData", onclick: actions.askRestore }, "Restore data"),
        h("div", { class: "ver" }, `Version ${self.GAMEDAY_VERSION}`)
      )
    )
  );
  return {
    nodes: [
      // Home's band (GDA-157): small app header (clock logo, Game Day, menu button), then the team line that opens the team list.
      h("div", { class: "hdr homeHdr" }, h("div", { class: "hrow" }, h("img", { class: "appLogo", src: "icons/icon-180.png", alt: "", draggable: false }), h("h1", {}, "Game Day"), topMenu)),
      // GDA-185: the team line sits on a white card that overlaps the slim band; the team list drops down from it.
      h(
        "div",
        { class: "teamCard" },
        teamLine(state, actions),
        h(
          "div",
          {},
          state.teamListOpen ? h("div", { class: "menuCover", onclick: actions.closeMenu }) : null,
          h("div", { class: "pop teamList" + (state.teamListOpen ? " show" : "") }, ...teamMenuItems(state, actions))
        )
      ),
      h("div", { class: "body homeBody" }, updateCard(state.updateNotice, actions), problemLine(state.problem), gamesTile, ...season, ...addPlayers),
      newGamePill,
      noteSheet(state, null, actions), // a player's profile opened from the Players tab (figures only)
      restoreSheet(state, actions),
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
      h("div", { class: "clk bar ctr" }, arrowButton("back", actions.leaveCreateGame), h("h1", {}, "New game"), nextArrow),
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
 * The game details page (GDA-95, GDA-210): this game's details and all its settings. Reached with ‹ from the 1st Half (the
 * 2nd Half goes via the 1st). Every setting is changeable exactly when it was in the old cog sheet (game-rules.js decides),
 * and a game that is running keeps running underneath. Delete game is at the bottom, before kick-off only.
 */
function newGameScreen(state, actions) {
  const game = openGame(state);
  const finished = game.state === FINISHED;
  return {
    nodes: [
      navBar("Game details", null, state, actions, true), // GDA-210: pinned while the page scrolls
      h(
        "div",
        { class: "body" },
        setCard(
          // GDA-199: editable until Full Time, read-only after.
          ...(finished
            ? [
                factRow("Date", formatGameDate(game.date), "ngDate"),
                factRow("Kick-off", formatKickOff(game.kickOff), "ngKickOff"),
                factRow("Opposition", game.opposition, "ngOpposition"),
              ]
            : [
                detailEditor(game, "date", "Date", { type: "date" }, actions),
                detailEditor(game, "kickOff", "Kick-off", { type: "time" }, actions),
                detailEditor(game, "opposition", "Opposition", { type: "text", autocomplete: "off", autocapitalize: "words", autocorrect: "off", spellcheck: "false" }, actions),
              ]),
          // GDA-105: Home / Away and Field are changed here (they used to be in the cog sheet); locked after Full Time.
          ...(finished
            ? [factRow("Home or away", game.venueTag || "Not set", "ngVenueTag"), factRow("Field", game.venue || "Not set", "ngVenue")]
            : venueEditor(game, actions))
        ),
        setCard(
          factRow("Half length", `${halfOf(game)} min`, "halfInfo"),
          // GDA-210: the rotation length picker (same picker and limits as the old cog sheet), read-only once the game is saved.
          finished
            ? factRow("Rotation", rotationText(rotationSecondsOf(game)), "ngRotation")
            : h("div", { class: "setrow" }, h("span", {}, "Rotation length"), rotationPicker(clampRotation(game.rotationMinutes ?? 6, halfOf(game)), snappedSeconds(game.rotationExtraSeconds, clampRotation(game.rotationMinutes ?? 6, halfOf(game)), halfOf(game)), halfOf(game), actions.setRotation)),
          formationRow(game, actions),
          hereRow(state, game, actions),
          // GDA-177: only the row that matters now: the season chart before kick-off, the rotation counts from kick-off until saved.
          game.state === NOT_STARTED ? displaySwitch("showSeasonChart", "Season chart on line-up", showsSeasonChart(game, currentTeamOf(state)), () => actions.setDisplayChoice("showSeasonChart")) : null,
          canEditNotes(game) ? displaySwitch("showRotationCounts", "Rotation counts", showsRotationCounts(game, currentTeamOf(state)), () => actions.setDisplayChoice("showRotationCounts")) : null
        ),
        carryOverSwitches(carryValuesOf(game), !canChangeCarryOver(game), actions),
        // Set apart at the bottom: Restart game (from kick-off until End game and save) or Delete game (before kick-off); never both.
        !finished && canRestartGame(game) ? h("div", { class: "gapbig" }, setCard(h("button", { class: "btn redtext", id: "restartGame", onclick: () => actions.askRestart("game") }, "Restart game"))) : null,
        canDeleteGame(game) ? h("button", { class: "btn redtext gapbig", id: "deleteGame", onclick: () => actions.askDelete(game.id) }, "Delete game") : null
      ),
      state.deleteId ? deleteSheet(state, actions) : null,
      state.hereDraft ? hereDraftPicker(state, actions) : null,
      restartAskSheet(state, actions),
    ],
  };
}

/**
 * One player on the pitch, the bench or the ABSENT row. There is no tap handler
 * here: drag.js reads data-player and data-place, so a tap and a drag take one
 * path. Slots without them, on the before-kick-off screen, do nothing.
 */
/** GDA-57: season levels (id -> {Goal, Defence, ...}) for the circles of the 1st half's line-up before kick-off; null everywhere else. Set by planBody. */
let chartLevels = null;

/** GDA-57: the small season chart on a circle: four columns (Goal, Defence, Midfield, Attack), height by level 0 to 3. Only worked out by seasonTotals (GDA-173). */
function seasonChart(levels) {
  return h("span", { class: "sch", "aria-hidden": "true" }, ...AREAS.map((area) => h("i", { class: "l" + levels[area] })));
}

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
  // GDA-156: the bench-turn dots under the circle replace the frozen rings, the number badge and the glove badge.
  // GDA-107: the 2nd Half plan shows the 1st half's turns (moving while it runs, frozen at the whistle), by the player.
  const figures = afterHalf ? firstHalfFigures(openGame(state)) : screenHalf(state.screen) === 2 && started ? planFigures(openGame(state), Date.now()) : null;
  const shown = figures ? planFiguresFor(figures, player.id, onPitch) : null;
  const dotData = !started || !player.id ? null : afterHalf ? openGame(state).firstHalfDotTurns : figures || (screenHalf(state.screen) === 2) === (lineupKey(openGame(state)) === "secondHalf") ? openGame(state).dotTurns : null;
  const countsOn = !dotData || showsRotationCounts(openGame(state), currentTeamOf(state)); // GDA-177: Off hides the whole row (dots, glove dot, bench number); the turns are still counted
  const dots = dotData && countsOn ? dotRow(dotsFor(dotData, player.id, number)) : null;
  // Plan bench: the existing bench ring, filled to the spell running at the whistle, and the .tm tag (none if not on the bench then).
  const planBench = shown && !onPitch && (!benchTimer || afterHalf);
  // GDA-116: the 1st half's bench circles are drawn as it ended and do not tick (no data-plan-bench, so drawBenchTimers leaves them).
  const rotation = rotationSecondsOf(openGame(state));
  // A planned swap: OFF and ON tags on the circles (GDA-75), and a dotted line between them (GDA-80, drawPairLines).
  const planTag = plannedOff ? h("span", { class: "pt" }, "OFF") : null; // GDA-165: no ON tag; the dotted line pairs the players
  // The keeper is shown by a glove dot under the circle (GDA-99: no "GK" text after the name).
  const nameLine = h("div", { class: "nm" }, player.name);
  return h(
    "div",
    {
      class: ["slot", planned ? "plan" : "", isKeeper ? "keeper" : "", planBench && shown.seconds !== null && ringFraction(shown.seconds, rotation) >= PILL_WHITE_FROM ? "wh" : ""].join(" ").trim(),
      ...(planBench && shown.seconds !== null ? { style: `--wait-fade: ${ringFraction(shown.seconds, rotation).toFixed(3)}` } : {}), // GDA-160: ring and tag colour for a frozen plan circle
      ...(canMove ? { "data-player": player.id } : {}),
      ...((!state.viewId || canCorrectFinished(openGame(state))) && (canCorrect(openGame(state)) || (openGame(state).state === NOT_STARTED && !openGame(state).absent.includes(player.id))) ? { "data-note": player.id } : {}), // GDA-81/109: can be held for the profile (not an Absent circle, not a saved game)
      ...(planBench && !afterHalf ? { "data-plan-bench": player.id } : {}), // GDA-107: the plan's bench circles move with the 1st half
      ...(benchTimer ? { "data-bench": player.id } : {}), // Marks a timer circle; it is not draggable.
    },
    h("div", { class: dotData ? "ci dotted" : "ci" }, avatar(player), isKeeper && !started ? h("span", { class: "gkb", "aria-hidden": "true" }, icon("glove")) : null, chartLevels && !started && chartLevels.has(player.id) ? seasonChart(chartLevels.get(player.id)) : null, benchTimer && !afterHalf ? ring(dims, 0) : planBench || (afterHalf && benchTimer) ? ring(dims, !shown || shown.seconds === null ? 0 : ringFraction(shown.seconds, rotation)) : null, dots, planTag, benchTimer && !afterHalf ? h("div", { class: "tm" }) : planBench && shown.seconds !== null ? h("div", { class: "tm" }, benchTimerText(shown.seconds)) : null), // Bench time: a small tag at the circle's bottom-right; drawBenchTimers fills it.
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
  get large() { return circleSize("--circle-large", 80); },
  get bench() { return circleSize("--circle-bench", 44); },
  get benchMany() { return circleSize("--circle-bench-many", 36); },
};
function ringCircles(dims, arcs, className, firstSlot = 0) {
  const { size, weight } = dims;
  let out = "";
  arcs.forEach((arc, i) => {
    const r = size / 2 + 2 + weight / 2 + (firstSlot + i) * (weight + 1);
    const length = 2 * Math.PI * r;
    const dash = `${(arc.fraction * length).toFixed(1)} ${length.toFixed(1)}`;
    out +=
      `<circle class="r0" cx="70" cy="70" r="${r}" stroke-width="${weight}"></circle>` +
      `<circle class="r1${arc.late ? " late" : ""}" cx="70" cy="70" r="${r}" stroke-width="${weight}" data-len="${length.toFixed(2)}" transform="rotate(-90 70 70)" stroke-dasharray="${dash}"></circle>`;
  });
  return `<svg class="${className}" viewBox="0 0 140 140" ${arcs.label ? `role="img" aria-label="${arcs.label}"` : 'aria-hidden="true"'}>${out}</svg>`;
}

/** The ring round a bench circle. Its fill is set by drawBenchTimers, not here. */
function ring(dims, fraction = 0, firstSlot = 0) {
  // Parsed as HTML so the browser puts the SVG parts in the right namespace.
  const holder = document.createElement("div");
  holder.innerHTML = ringCircles(dims, [{ fraction, late: false }], "rg", firstSlot);
  return holder.firstChild;
}

/**
 * The row of turn dots under a circle (GDA-156). Dark = bench turn had, glove = keeper turn, light with a dark edge =
 * turn due; the bench order number sits inside the first dot that is not a glove. The glove dot keeps the class `gkb`
 * and a numbered dot the class `turn` (the names the glove and number had before), so the screen checks can find them.
 */
function dotRow(dots) {
  const label = dotsLabel(dots);
  return h(
    "div",
    { class: "dots", role: "img", "aria-label": label, title: label },
    ...dots.map((dot) =>
      dot.kind === "g"
        ? h("span", { class: "dot gl gkb" }, icon("glove"))
        : h("span", { class: `dot ${dot.kind === "d" ? "dk" : "lt"}${dot.number ? " turn" : ""}` }, dot.number ? String(dot.number) : null)
    )
  );
}

/** A position with nobody in it. The no-break space keeps it the same height as a filled one. */
function emptySlot(place, canMove, state) {
  const planned = isLiveView(state) && pairsOf(openGame(state)).some((pair) => pair.fieldId === null && pair.place === place);
  return h(
    "div",
    { class: planned ? "slot plan" : "slot", ...(canMove ? { "data-place": place } : {}) },
    h("div", { class: "ci" }, h("div", { class: "av em" })),
    h("div", { class: "nm none" }, "\u00a0") // GDA-139: keeps the height, shows no plate
  );
}

function lineUpRow(title, rowClass, players, state, canMove, benchTimers = false, zone = null) {
  // Circle size and ring weight (GDA-85): a crowded live bench has smaller circles and thinner rings.
  const dims = { size: rowClass.includes("many") ? CIRCLE_SIZES.benchMany : CIRCLE_SIZES.bench, weight: RING_WEIGHT };
  const slots = players.map((player) => playerSlot(player, state, canMove, false, benchTimers, false, dims));
  // An empty BENCH row keeps its normal height (Ben, 2026-11-14): one invisible stand-in slot, built like a real one,
  // so the row measures the same with or without players. It carries no player id, so it can't be dragged or tapped.
  if (title === "BENCH" && slots.length === 0) {
    const ghost = playerSlot({ id: "", name: "Bench" }, state, false, false, false, false, dims);
    ghost.removeAttribute("data-player");
    ghost.classList.add("ghost");
    ghost.setAttribute("aria-hidden", "true");
    slots.push(ghost);
  }
  // `zone` makes the whole row a drop target (GDA-62): "absent" or "bench", line-up screen only.
  return h("div", { class: rowClass, ...(rowClass.includes("live") ? { style: `--subs: ${Math.max(players.length, 4)}` } : {}), ...(zone ? { "data-zone": zone } : {}) }, h("span", { class: "t" }, title), ...slots);
}

/** The pitch and bench, shared by the line-up and the before-kick-off screen. */
function openRowsTight(shape) {
  return pitchRows(shape).length >= 5;
}
function pitchAndBench(view, state, canMove, crowded, live = false, benchZone = false, overlay = null, actions = null, switchBtn = null) {
  const game = openGame(state);
  // GDA-127: the pitch draws the Formation of the half the screen shows.
  const shape = formationOf(game, screenHalf(state.screen) || 1);
  // GDA-162: 3 rows or fewer (the keeper's row counts) get the large circles; the same row count decides 58px / 52px.
  const roomy = pitchRows(shape).length <= 3;
  const tight = !roomy && (crowded || openRowsTight(shape));
  const dims = { size: roomy ? CIRCLE_SIZES.large : tight ? CIRCLE_SIZES.pitchTight : CIRCLE_SIZES.pitch, weight: RING_WEIGHT };
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
    // GDA-48: a top row of 3 or more would run under the corner switch, so the rows start lower (padding only; the pitch keeps its height).
    { class: (tight ? "pitch tight" : roomy ? "pitch roomy" : "pitch") + (overlay ? " pilled" : "") + (switchBtn && rows[0].length >= 3 ? " push" : ""), style: `grid-template-rows: repeat(${rows.length}, minmax(0, 1fr))` },
    ...rows.map(line),
    overlay, // GDA-125: the swap pill sits inside the pitch's bottom-right corner (live half only)
    switchBtn // GDA-48: the Pitch / List switch, top right
  );
  if (live) {
    // Game under way: bench circles carry timers. The row stays when nobody is on the bench, so nothing moves (Ben, 2026-11-14).
    const rowClass = view.bench.length > 6 ? "row live many" : view.bench.length > 4 ? "row live snug" : "row live";
    return [pitch, lineUpRow("BENCH", rowClass, view.bench, state, canMove, true)];
  }
  // GDA-107: the 2nd Half plan at half time carries the bench ring and tag, so its bench row is drawn the way the live one is.
  const atHalfTime = screenHalf(state.screen) === 2 && planFigures(game, 0) !== null;
  const benchClass = atHalfTime ? (view.bench.length > 6 ? "row live many" : view.bench.length > 4 ? "row live snug" : "row live") : view.bench.length > 6 ? "row many" : "row"; // GDA-134: 7 or more subs share one row
  return [pitch, lineUpRow("BENCH", benchClass, view.bench, state, canMove, false, benchZone ? "bench" : null)];
}

/** The game the game screens show: the finished game being looked at (GDA-100), otherwise the open game. */
function openGame(state) {
  return state.games.find((candidate) => candidate.id === (state.viewId ?? state.gameId));
}

/**
 * The row under the pitch (GDA-120). The Start / End Half / Resume half button and the cog have moved to the head bar and
 * the pitch, so this row is normally empty (and takes no room). It only holds an error message.
 */
function bottomBar(state, actions) {
  return h("div", { class: "acts game" }, problemLine(state.problem));
}

/** The pitch, bench and ABSENT row of a half that is Not started. `editable` false shows them for looking only. */
function planBody(game, view, state, actions, { editable, firstHalf, note, overlay = null }) {
  // GDA-165: only the 1st half's line-up before kick-off keeps the "setup" look (name plates). The 2nd half plan uses the live game's name layout.
  const crowded = view.bench.length > 6 || view.absent.length > 6;
  // GDA-48: the 1st half's line-up can show the season List in place of the pitch, bench and Absent row (the Pitch is always how it opens).
  if (firstHalf && state.listView) {
    return h("div", { class: "lu setup" }, seasonList(state, game, actions));
  }
  // GDA-48 (Ben, after Gate R): the 2nd half plan has the switch too; its List is this game's Interchange history, with the plan's bench under it.
  if (!firstHalf && state.listView) {
    const [, bench] = pitchAndBench(view, state, editable, crowded, false, false, null, null);
    return h("div", { class: "lu" }, historyList(state, game, actions, overlay), bench);
  }
  // GDA-57: before kick-off the circles of players who are here carry the season chart (Absent circles do not: their row is built without it).
  // Before kick-off the 2nd half plan shows it too (GDA-109); once the game has kicked off the half time plan has none.
  const totals = (firstHalf ? editable : !gameHasKickedOff(game)) && showsSeasonChart(game, currentTeamOf(state)) ? seasonTotals({ games: state.games, players: state.players, eventsByGame: {} }).players : null;
  chartLevels = totals ? new Map([...totals].map(([id, season]) => [id, season.level])) : null;
  const rows = pitchAndBench(view, state, editable, crowded, false, editable && firstHalf, overlay, actions, viewSwitch(state, actions));
  chartLevels = null; // the ABSENT row below has no chart
  return h(
    "div",
    { class: firstHalf ? "lu setup" : "lu" },
    ...rows,
    // GDA-62: always there, below the bench, even when empty (then slim). Only the 1st half's line-up can change who is absent.
    // 2nd half: no Absent row; leavers are marked through Who is here in Game details (GDA-99).
    firstHalf ? lineUpRow("ABSENT", view.absent.length > 0 ? "row ab" : "row ab empty", view.absent, state, editable, false, editable ? "absent" : null) : null
  );
}

/** GDA-143: true once either half has kicked off (the game details screen is then "Game details", not "New game"). */
function gameHasKickedOff(game) {
  return typeof game.firstHalfStartedAt === "number" || typeof game.secondHalfStartedAt === "number";
}

/** True while the 1st half is In progress (started, not ended). GDA-142 uses it for goals from the 2nd half plan. */
function firstHalfRunning(game) {
  return game.state === FIRST_HALF && typeof game.firstHalfStartedAt === "number" && typeof game.firstHalfEndedAt !== "number";
}

/**
 * A half that is Not started (GDA-95, GDA-120). The head bar has the Start chip (1st Half: always; 2nd Half: greyed out until the
 * 1st half has ended) and a 0:00 clock. 1st Half: the line-up. 2nd Half: the half-time plan, or the line-up for looking at.
 */
function notStartedHalf(state, actions, half) {
  const game = openGame(state);
  const view = halfLineUpView(game, state.players, half);
  const startable = half === 1 ? true : canStartHalf(game, 2);
  const chip = half === 1
    ? headChip("startFirst", "Start 1st half", "play", true, actions.startFirstHalf)
    : headChip("startSecond", "Start 2nd half", "play", true, startable ? actions.startSecondHalf : null);
  // GDA-97: the 2nd half plan can be edited from before kick-off until Start 2nd half.
  const editable = half === 1 ? true : canPlan(game);
  return {
    fixed: true,
    noMove: true,
    nodes: [
      // GDA-142: on the 2nd half plan while the 1st half runs, the score card takes goals (they go to the 1st half).
      ...gameHead(state, actions, { label: half === 1 ? "1st Half" : "2nd Half", clock: "0:00", chip, tapScore: half === 2 && firstHalfRunning(game) }),
      planBody(game, view, state, actions, { editable, firstHalf: half === 1 }), // Absent / Back in is by drag only (Ben, 2026-11-15)
      bottomBar(state, actions), // empty unless there is an error message
      half === 2 && firstHalfRunning(game) ? goalDialog(state, game, actions) : null,
      noteSheet(state, game, actions), // GDA-109: the player profile (before kick-off: figures only)
      potdPicker(state, game, actions), // GDA-175: the 2nd half plan (1st half running, or half time) has the row too
    ],
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
    const result = checkFormation(input.value, typeof size === "function" ? size() : size); // a function when the size can change under the box (team form)
    input.classList.toggle("bad", !result.ok);
    if (result.ok && result.formation !== saved) {
      saved = result.formation;
      onValid(result.formation);
    }
  });
  return h("div", { class: "f" }, h("label", { for: "formation" }, "Formation"), input);
}

/**
 * Settings (GDA-64, GDA-120): a round 56px button that opens the Game details sheet. On a pitch it sits 8px in from the bottom-left
 * corner, mirroring the swap pill; at Full Time it sits left of "End game and save" (see fullTimeScreen).
 */
function settingsButton(actions) {
  return h("button", { class: "cog corner", id: "cog", "aria-label": "Settings", onclick: actions.openRotation }, icon("settings"));
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
 * GDA-199: one editable game detail (date, kick-off, opposition), same inputs as the New game form. Saved when the
 * field is left; a blank value is not saved and the saved one is shown again.
 */
function detailEditor(game, key, label, inputProps, actions) {
  const input = h("input", { id: "ng-" + key, ...inputProps, "aria-label": label });
  let saved = game[key] ?? ""; // the last saved value, shown again if the field is left blank
  input.value = saved;
  input.addEventListener("change", () => {
    if (isBlank(input.value)) {
      input.value = saved;
      return;
    }
    saved = key === "opposition" ? input.value.trim() : input.value;
    input.value = saved;
    actions.changeDetails({ [key]: input.value });
  });
  return h("div", { class: "f" }, h("span", {}, label), input);
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
 * GDA-214: the sheet a long press on the chip or clock opens. 1st half: Restart half. 2nd half: Restart half and Restart game.
 * Nothing is changed by opening or closing it; each choice asks first (restartAskSheet).
 */
function restartMenuSheet(state, actions) {
  if (!state.restartMenu) {
    return null;
  }
  return h(
    "div",
    { class: "scrim", id: "restartMenu" },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, "Restart"),
      h("button", { class: "btn redtext", id: "restartHalf", onclick: () => actions.askRestart("half") }, "Restart half"),
      screenHalf(state.screen) === 2 ? h("button", { class: "btn redtext", id: "restartGameFromSheet", onclick: () => actions.askRestart("game") }, "Restart game") : null,
      h("button", { class: "btn", id: "closeRestartMenu", onclick: actions.closeRestartMenu }, "Cancel")
    )
  );
}

/** GDA-214: the confirm for Restart half or Restart game: one short line, a red confirm (ignores taps for 600 ms, GDA-207) and Cancel. */
function restartAskSheet(state, actions) {
  if (!state.restartAsk) {
    return null;
  }
  const game = state.restartAsk === "game";
  return h(
    "div",
    { class: "scrim", id: "restartAsk" },
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, game ? "Restart game?" : "Restart half?"),
      h("p", {}, game ? "Both halves go back to before kick-off. Goals, swaps and times are removed." : "This half goes back to 0:00. Its goals, swaps and times are removed."),
      h("button", { class: "btn del", id: "confirmRestart", onclick: actions.confirmRestart }, game ? "Restart game" : "Restart half"),
      h("button", { class: "btn", id: "cancelRestart", onclick: actions.cancelRestart }, "Cancel")
    )
  );
}

/** GDA-177: one native switch row for a "what is drawn" choice (Team settings default, or Game settings for one game). */
function displaySwitch(which, text, on, onchange) {
  return h("label", { class: "swrow", id: "ds-" + which }, h("span", {}, text), h("input", { type: "checkbox", switch: "", id: "dsi-" + which, checked: on, onchange }));
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
 * The Game settings sheet (GDA-210): now only on a saved game's Full Time screen, opened from the cog, and holding one
 * button, Archive game. Everything else moved to the game details page (newGameScreen). Drawn only while open; its
 * confirm replaces it and Cancel brings it back.
 */
function gameDetailsSheet(state, game, actions) {
  if (!state.rotationOpen) {
    return null;
  }
  if (state.archiveId) {
    return archiveSheet(state, actions);
  }
  return h(
    "div",
    { class: "scrim", id: "rotSheet" },
    h(
      "div",
      { class: "sheet" },
      sheetHead("Game settings", actions.closeRotation, "rotX"),
      canArchiveGame(game) ? h("button", { class: "btn", id: "archiveGame", onclick: () => actions.askArchive(game.id) }, "Archive game") : null
    )
  );
}

/**
 * The score for the top band (GDA-40): "US 2 - 1 THEM", counted from the saved goals,
 * always labelled. With `actions` it is a button (tap = Remove last goal, GDA-39);
 * without, it is plain text (before kick-off, nothing to remove).
 */
let scoreFlashAt = 0;
const SCORE_FLASH_MS = 1500; // the score card fades from pink to white over this long (keep in step with scoreFade in style.css)
/** Class (and delay) for a score panel. While the flash runs, a redraw resumes the fade part-way instead of restarting it. */
function scoreFlashProps(cls) {
  const elapsed = Date.now() - scoreFlashAt;
  return elapsed >= 0 && elapsed < SCORE_FLASH_MS ? { class: cls + " flash", style: `animation-delay: -${elapsed}ms` } : { class: cls };
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

/** GDA-214: how long a press must last to count as a hold (a check accepts 500 to 800 ms). */
const HOLD_MS = 600;

/**
 * GDA-214: a press held for HOLD_MS calls `onHold`; the tap that follows the hold is swallowed, so holding never starts or stops the clock.
 * Letting go earlier is a normal tap. A finger that slides away cancels the hold. Text selection and the iOS callout are switched off in CSS (.holdable).
 */
function makeHoldable(element, onHold) {
  let timer = null;
  let held = false;
  let start = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  element.classList.add("holdable");
  element.addEventListener("pointerdown", (event) => {
    held = false;
    start = { x: event.clientX, y: event.clientY };
    cancel();
    timer = setTimeout(() => {
      timer = null;
      held = true;
      onHold();
    }, HOLD_MS);
  });
  element.addEventListener("pointermove", (event) => {
    if (timer && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
      cancel();
    }
  });
  for (const name of ["pointerup", "pointercancel", "pointerleave"]) {
    element.addEventListener(name, cancel);
  }
  element.addEventListener("contextmenu", (event) => event.preventDefault()); // Android's long-press menu
  // Capture: runs before the element's own tap handler, so the tap after a hold does nothing.
  element.addEventListener(
    "click",
    (event) => {
      if (held) {
        held = false;
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true
  );
}

/**
 * One round chip on the head bar (GDA-120): Start (triangle), Stop (square) or Resume half (undo arrow). `go` is the solid dark look.
 * `onClick` null draws it greyed out and inert (aria-disabled). The chip always sits in the same 64px slot.
 */
function headChip(id, label, iconName, go, onClick) {
  const props = { class: (go ? "chip go" : "chip") + (onClick ? "" : " off"), id, "aria-label": label };
  if (onClick) {
    props.onclick = onClick;
  } else {
    props.disabled = true; // a real disabled button: it cannot be tapped or focused, and a screen reader says so
  }
  const chip = h("button", props, icon(iconName));
  chip.tapAction = onClick; // GDA-141: the clock beside it does the same thing
  return chip;
}

/**
 * The clock in the head bar (GDA-141). With a live chip beside it, a tap on the clock does exactly what the chip does (it is the
 * chip's own handler, so a double tap is guarded the same way). With no chip or a greyed one it is plain text and does nothing.
 * Its name is the chip's name, so a screen reader hears the same thing. drawClock only changes its text.
 */
function clockNode(clock, chip, over = false) {
  const action = chip && !chip.disabled ? chip.tapAction : null;
  return action
    ? h("button", { class: "clockBtn", id: "clock", "aria-label": chip.getAttribute("aria-label"), onclick: action }, clock)
    : h("b", { id: "clock" }, clock);
}

/**
 * The top of every half screen (GDA-120), as two rows. Row 1 is the hero band: back arrow, half label (plain text, a fixed 64px slot),
 * the clock (dead centre, never tappable), the chip's 64px slot, next arrow. Row 2 is the white 44px score card: our logo and name on the
 * left, the score in the middle, their name and logo on the right. With `tapScore` (a game that can take goals) the whole card is one
 * button that opens Who scored?. The same sizes in every stage, so nothing moves between them.
 * `chip` null leaves the slot empty (Full Time, or nothing to resume).
 */
function gameHead(state, actions, { label, clock, over = false, chip = null, nextGo = false, tapScore = true, showScore = true }) {
  const game = openGame(state);
  const score = scoreOf(game);
  const team = state.teams.find((t) => t.id === (game.teamId ?? state.currentTeamId));
  const usName = team?.name ?? "Us";
  const [back, next] = navArrows(state, actions, nextGo);
  const words = label.split(" ");
  const labelNode = h("h1", { class: "hl" }, words[0], " ", h("br"), words.slice(1).join(" ")); // the screen's heading, in two lines
  const clockEl = clockNode(clock, chip, over);
  if (chip?.holdAction) {
    // GDA-214: a 600 ms hold on the chip or the clock (when the clock is a button) opens the Restart sheet instead of a tap.
    makeHoldable(chip, chip.holdAction);
    if (clockEl.tagName === "BUTTON") {
      makeHoldable(clockEl, chip.holdAction);
    }
  }
  const band = h("div", { class: over ? "clk bar hb over" : "clk bar hb" }, back, labelNode, h("div", { class: "ck" }, clockEl), h("div", { class: "cs" }, chip), next);
  const parts = [
    h("span", { class: "side l" }, teamLogo(usName, currentLogos[team?.id]), h("span", { class: "tn" }, usName)),
    h("span", { class: "mid" }, h("span", { class: "tg", id: "scoreUs" }, String(score.us)), h("span", { class: "dash", "aria-hidden": "true" }, "\u2013"), h("span", { class: "tg", id: "scoreThem" }, String(score.them))),
    h("span", { class: "side r" }, h("span", { class: "tn" }, game.opposition), teamLogo(game.opposition, null)),
  ];
  const card = tapScore && canAddGoal(game)
    ? h("button", { ...scoreFlashProps("scard"), id: "score", "aria-label": `${usName} ${score.us}, ${game.opposition} ${score.them}. Who scored?`, onclick: actions.openGoalDialog }, ...parts)
    : h("div", { ...scoreFlashProps("scard"), id: "score" }, ...parts);
  // GDA-144: Full Time shows the score once (the big one below), so it asks for no score row here.
  return showScore ? [band, card] : [band];
}

/**
 * A half that is In progress or Ended (GDA-95, GDA-120). In progress: the time is worked out from the saved start
 * time every time it is drawn; the Stop chip (End Half) is on the head bar. Ended: the clock is frozen at the saved end
 * time, there is no swap pill, nothing can be moved, and the chip is Resume half (only while the next half has not
 * started). The head bar and pitch are the same size in both states, so nothing jumps. The Stop chip is always
 * drawn, and drawClock turns it solid dark when time is up and fills in the swap pill, so nothing is rebuilt as the clock runs.
 */
function runningHalf(state, actions, half) {
  const game = openGame(state);
  const live = phaseOf(game, half) === IN_PROGRESS_PHASE;
  const view = halfLineUpView(game, state.players, half);
  const startedAt = half === 2 ? game.secondHalfStartedAt : game.firstHalfStartedAt;
  const endedAt = half === 2 ? game.secondHalfEndedAt : game.firstHalfEndedAt;
  const clock = clockText(startedAt, live ? Date.now() : endedAt, halfOf(game));
  const label = half === 2 ? "2nd Half" : "1st Half";
  let chip = null; // nothing to stop or resume: the slot stays, empty
  if (live) {
    // Stop = End Half (no confirmation; Resume half at Half Time is the way back). drawClock makes it solid dark when time is up.
    chip = headChip("endHalf", "End half", "stop", true, actions.endHalf);
  } else if (canResumeHalf(game, half)) {
    chip = headChip("resumeHalf", "Resume half", "play", false, actions.resumeHalf);
  }
  // GDA-214: holding the chip or the clock opens Restart half / Restart game (only while those are offered).
  if (chip && canUndoKickOff(game, half)) {
    chip.holdAction = actions.openRestartMenu;
  }
  return {
    fixed: true,
    noMove: true,
    nodes: [
      ...gameHead(state, actions, { label, clock, over: isTimeUp(startedAt, live ? Date.now() : endedAt, halfOf(game)), chip, nextGo: !live }),
      // GDA-125: no strip. The swap pill lives on the pitch and only while the half is running.
      h("div", { class: "lu" }, ...gameBody(view, state, game, actions, live)),
      bottomBar(state, actions), // empty unless there is an error message
      goalDialog(state, game, actions),
      noteSheet(state, game, actions),
      potdPicker(state, game, actions), // GDA-175: opened from Game settings; the clock keeps running underneath
      restartMenuSheet(state, actions),
      restartAskSheet(state, actions),
    ],
    after: () => {
      drawClock(state);
      drawPairLines(state);
    },
  };
}

/**
 * GDA-48: the pitch and bench of a running half, or (List view) the Interchange history in the pitch's place with the same bench under it.
 * The swap pill and Settings stay in their corners in both views, so Swap works in either; the view never changes by itself.
 */
function gameBody(view, state, game, actions, live) {
  const pill = live ? swapPill(game, state, actions) : null;
  if (!state.listView) {
    return pitchAndBench(view, state, live, view.bench.length > 6, true, false, pill, actions, viewSwitch(state, actions));
  }
  const [, bench] = pitchAndBench(view, state, live, view.bench.length > 6, true, false, null, null);
  return [historyList(state, game, actions, pill), bench];
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
  if (!state.goalOpen || !(canAddGoal(game) || canCorrectFinished(game))) {
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
    headAction: canCorrectFinished(game) ? null : h("button", { class: "pkx txt", id: "openSummary", onclick: actions.openSummary }, "Summary"), // GDA-155: on a finished game you are already on Full Time
    gridTail: ownGoal,
    middle: h("div", { class: "gagainst" }, h("button", { class: "btn", id: "goalThem", onclick: actions.goalAgainst }, "Opposition goal")),
    footer: h(
      "div",
      { class: "pfoot" },
      h("button", { class: "btn undo2", id: "undoGoal", disabled: undoLine === null, onclick: actions.undoLastGoal }, "Undo last goal", undoLine ? h("small", { id: "undoLine" }, undoLine) : null)
    ),
  });
}

/**
 * The swap button (GDA-125, round 64px since GDA-164), inside the pitch's bottom-right corner, in the keeper's row. It does every job the old
 * swap strip did, at 64 x 64 and never changing size: counts down to the swap (the pill fades from white to pink), shows Swap
 * in the last 30 seconds, SWAP TIME, late, TIME, and Undo for UNDO_MS after a swap. Only drawn while a half runs.
 * drawSwapPill fills in the words each second. The button on top is there only when a tap does something
 * (Swap while a pair is planned, Undo after a swap), so with nothing planned a tap does nothing.
 */
function swapPill(game, state, actions) {
  const planned = pairsOf(game).length > 0;
  const undo = !planned && state.undo && Date.now() < state.undo.until ? state.undo : null;
  return h(
    "span", // not a div: the pitch's last-of-type rules count its lines (divs) only
    { class: undo ? "pill undo" : "pill next", id: "swapPill" },
    undo ? null : pillRing(),
    undo ? h("div", { class: "ptx" }, h("div", { class: "pu" }, icon("undo"), "Undo")) : h("div", { class: "ptx", id: "pillText" }),
    undo
      ? h("button", { class: "pillTap", id: "undo", "aria-label": "Undo the swap", onclick: actions.undo })
      : planned ? h("button", { class: "pillTap", id: "swap", "aria-label": "Swap", onclick: actions.swap }) : null
  );
}

/**
 * The ring round the swap pill (Ben, 2026-11-14): works like the ring round a bench circle. It fills clockwise
 * from the top as the longest-waiting bench player's time runs towards the rotation length, is full when the swap
 * is due, and turns red once it is late. It sits just inside the pill's edge, so the pill never changes size.
 * drawSwapPill sets the fill. The path is measured as 100 long (pathLength), so the fill is a plain percentage.
 */
function pillRing() {
  const w = 3; // stroke width; the path runs down the middle of it
  const [W, H] = [64, 64]; // the button's fixed size (--s64 x --s64): a circle (GDA-164)
  const r = H / 2 - w / 2;
  const [l, t, rt, b] = [w / 2, w / 2, W - w / 2, H - w / 2];
  const d =
    `M ${W / 2} ${t} H ${rt - r} A ${r} ${r} 0 0 1 ${rt - r} ${b} H ${l + r} A ${r} ${r} 0 0 1 ${l + r} ${t} Z`;
  const holder = document.createElement("div");
  holder.innerHTML =
    `<svg class="pr" viewBox="0 0 ${W} ${H}" aria-hidden="true">` +
    `<path class="r0" d="${d}" stroke-width="${w}" pathLength="100"></path>` +
    `<path class="r1" d="${d}" stroke-width="${w}" pathLength="100" stroke-dasharray="0 100"></path></svg>`;
  return holder.firstChild;
}

let lastActions = null;

/** How far a planned-pair line or cross keeps from the swap pill (GDA-125). */
const PILL_CLEAR = 4;

/**
 * The parts of the line `cut` that lie outside `box` (grown by `margin`): none, one or two pieces. Lets a planned-pair
 * line run "behind" the swap pill without ever touching it. Plain rectangle clipping along the line.
 */
function outsideBox(cut, box, margin) {
  const left = box.left - margin, right = box.right + margin, top = box.top - margin, bottom = box.bottom + margin;
  const dx = cut.x2 - cut.x1, dy = cut.y2 - cut.y1;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, cut.x1 - left], [dx, right - cut.x1], [-dy, cut.y1 - top], [dy, bottom - cut.y1]]) {
    if (p === 0) {
      if (q < 0) return [cut]; // parallel to this side and outside it: never inside
    } else if (p < 0) {
      t0 = Math.max(t0, q / p);
    } else {
      t1 = Math.min(t1, q / p);
    }
  }
  if (t0 >= t1) return [cut]; // misses the box
  const piece = (from, to) => ({ x1: cut.x1 + dx * from, y1: cut.y1 + dy * from, x2: cut.x1 + dx * to, y2: cut.y1 + dy * to });
  const parts = [];
  if (t0 > 0) parts.push(piece(0, t0));
  if (t1 < 1) parts.push(piece(t1, 1));
  return parts;
}

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
  if (!area || !game || !isLiveView(state) || pairsOf(game).length === 0 || state.listView) {
    return; // GDA-48: in List view there is no pitch to draw lines on
  }
  const box = area.getBoundingClientRect();
  const centre = (slot) => {
    const c = slot.querySelector(".ci").getBoundingClientRect();
    return { x: c.left + c.width / 2 - box.left, y: c.top + c.height / 2 - box.top };
  };
  const edge = (area.querySelector(".row.live")?.getBoundingClientRect().top ?? box.bottom) - box.top;
  // GDA-125: the swap pill's box (with a small margin), so a line never runs over it and a cross never sits on it.
  const pillRaw = area.querySelector("#swapPill")?.getBoundingClientRect();
  const pill = pillRaw
    ? { left: pillRaw.left - box.left, right: pillRaw.right - box.left, top: pillRaw.top - box.top, bottom: pillRaw.bottom - box.top }
    : null;
  // GDA-120: the same keep-clear for the Settings button in the bottom-left corner.
  const cogRaw = area.querySelector("#cog")?.getBoundingClientRect();
  const cog = cogRaw
    ? { left: cogRaw.left - box.left, right: cogRaw.right - box.left, top: cogRaw.top - box.top, bottom: cogRaw.bottom - box.top }
    : null;
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
        const clearOfPill = pill ? outsideBox(cut, pill, PILL_CLEAR) : [cut];
        for (const part of cog ? clearOfPill.flatMap((piece) => outsideBox(piece, cog, PILL_CLEAR)) : clearOfPill) {
          lines += `<line class="dl plan" x1="${part.x1}" y1="${part.y1}" x2="${part.x2}" y2="${part.y2}" stroke-dasharray="2 6"></line>`;
        }
      }
    }
    const along = !b || b.y === a.y ? 0.5 : (edge - a.y) / (b.y - a.y);
    let x = Math.max(22, Math.min(box.width - 22, b ? a.x + (b.x - a.x) * along : a.x));
    // The cross is 44px wide to tap; if that would touch the pill it moves to just left of it.
    if (pill && edge - 14 + 22 > pill.top - PILL_CLEAR && x + 22 > pill.left - PILL_CLEAR && x - 22 < pill.right + PILL_CLEAR) {
      x = pill.left - PILL_CLEAR - 22;
    }
    // The same for the Settings button: the cross moves to just right of it.
    if (cog && edge - 14 + 22 > cog.top - PILL_CLEAR && x + 22 > cog.left - PILL_CLEAR && x - 22 < cog.right + PILL_CLEAR) {
      x = cog.right + PILL_CLEAR + 22;
    }
    crosses.append(
      h("button", { class: "xx", "aria-label": "Remove pair", style: `left:${x}px;top:${edge - 14}px`, onclick: () => actions.unpair(pair.benchId) }, h("span", {}, "\u00d7"))
    );
  }
  // Parsed as HTML so the browser puts the SVG parts in the right namespace.
  const holder = document.createElement("div");
  holder.innerHTML = `<svg class="pl">${lines}</svg>`;
  area.append(holder.firstChild, crosses);
}

/** Moves the clock, the swap pill and the End Half colour on, without redrawing the screen. Safe at any moment. */
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
    clock.closest(".clk")?.classList.toggle("over", timeUp); // marks time up; no look of its own (GDA-154: the pink head bar was removed)
    clock.classList.toggle("pulse", timeUp); // GDA-182: only the clock numbers pulse pink, and only while the half is running (drawClock runs only on a live half)
    // GDA-150: the pill is drawn first and each part on its own, so a problem in one can never leave the pill without its time.
    try { drawSwapPill(game, state.players, now, timeUp); } catch (error) { console.error("swap pill", error); }
    try { drawBenchTimers(game, now); } catch (error) { console.error("bench timers", error); }
    if (state.listView) { try { drawTally(state); } catch (error) { console.error("tally", error); } } // GDA-48: bench time keeps counting in List view
    // The pill never changes size, so the pair lines never need redrawing here.
  } else if (screenHalf(state.screen) === 2 && game && game.state === FIRST_HALF && typeof game.firstHalfStartedAt === "number" && typeof game.firstHalfEndedAt !== "number") {
    // GDA-107: the 2nd Half plan while the 1st half runs: only the bench rings and tags move (text and ring length, no redraw). (GDA-120: this screen now shows a 0:00 clock on the band, so this no longer depends on there being no clock.)
    drawBenchTimers(game, Date.now());
    if (state.listView) { try { drawTally(state); } catch (error) { console.error("tally", error); } }
  }
}

/**
 * Fills the swap pill (GDA-104, GDA-125): "SWAP IN / 3:20" counting down with the lilac fill draining and the ring
 * filling, "SWAP DUE / 0:00" when due, "SWAP DUE / +1:10" once overdue (full strong pink, white words, from then on:
 * no red, no change to light pink; GDA-160), and "TIME" when the half length is reached. While "Undo" is showing the pill is left alone. Time only, no
 * names. The words carry the message, not colour alone. The pill never changes size, so the pitch never moves.
 */
const PILL_WHITE_FROM = 0.85; // how far the white-to-pink fade must have gone (0 to 1) before the pill text turns white
function drawSwapPill(game, squad, now, timeUp) {
  const pill = document.getElementById("swapPill");
  if (!pill || pill.classList.contains("undo")) {
    return;
  }
  const mmss = (total) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  const message = swapMessage(game, squad, now); // GDA-150: still counts when the half is over time (the clock and the solid Stop chip say time is up)
  // [text, size] pairs: sm = 12px words on top, lg = 20px time below. Always that way round, so the time is
  // always the biggest thing and never swaps places (Ben, 2026-11-14).
  let lines;
  let look;
  let fade = 1; // GDA-140: 0 = white (rotation just started) to 1 = pink (Swap Time and later)
  let ring = 0; // how full the ring is, 0 to 1
  if (!message) {
    lines = [["TIME", "lg"]];
    look = "timeup";
  } else if (message.phase === "next" || message.phase === "warn") {
    lines = [["SWAP", "sm"], [mmss(message.countdown), "md"]]; // GDA-164: round 64px button, short words
    look = message.phase;
    ring = 1 - message.countdown / rotationSecondsOf(game);
    fade = ring;
  } else {
    // GDA-160: the same two words from due onwards; "+1:10" shows how long overdue. The look stays full pink with white words.
    lines = [["DUE", "sm"], [message.late > 0 ? `+${mmss(message.late)}` : "0:00", "md"]];
    look = message.late > 0 ? "late" : "swap";
    ring = 1;
  }
  const key = lines.map((line) => line.join(":")).join("|");
  const text = document.getElementById("pillText");
  if (text.dataset.key !== key) {
    text.dataset.key = key;
    text.replaceChildren(...lines.map(([words, size]) => h("div", { class: size }, words)));
    const tap = pill.querySelector(".pillTap");
    if (tap && tap.id === "swap") {
      tap.setAttribute("aria-label", "Swap, " + lines.map((line) => line[0]).join(" "));
    }
  }
  // GDA-140: the words and time go white from the point where the pink is dark enough for white to read (3:1 or better); dark before, so never white on white.
  pill.className = "pill " + look + (look !== "timeup" && fade >= PILL_WHITE_FROM ? " white" : "");
  pill.querySelector(".pr .r1")?.setAttribute("stroke-dasharray", `${(Math.max(0, Math.min(1, ring)) * 100).toFixed(1)} 100`);
  pill.style.setProperty("--pill-fade", Math.max(0, Math.min(1, fade)).toFixed(3)); // the CSS mixes white to pink by this much
}

/**
 * GDA-160: a bench circle's ring and time tag follow the swap pill's white-to-pink fade, for that player's own wait
 * (--wait-fade, 0 to 1; the CSS keeps the ring from going paler than its floor). Once the wait reaches the white-words point
 * the tag's words go white, as the pill's do. Full pink and white words stay for as long as the player is overdue.
 */
function setWaitFade(slot, seconds, rotation) {
  const fade = ringFraction(seconds, rotation);
  slot.style.setProperty("--wait-fade", fade.toFixed(3));
  slot.classList.toggle("wh", fade >= PILL_WHITE_FROM);
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
    setWaitFade(slot, seconds, rotation);
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
      h("button", { class: "btn pri", id: "confirmFullTime", onclick: actions.fullTime }, "End game and save"),
      h("button", { class: "btn", id: "cancelFullTime", onclick: actions.cancelFullTime }, "Cancel")
    )
  );
}

/** GDA-166: the score panel: our logo above our name (left), the score (middle), their logo above their name (right). */
function scorePanel(ourName, ourLogo, theirName, score) {
  const side = (name, logo) => h("div", { class: "pt2" }, teamLogo(name, logo), h("div", { class: "ptn" }, name));
  return h("div", { class: "card pb", id: "scorePanel" }, side(ourName, ourLogo), h("div", { class: "pm", id: "finalScore" }, `${score.us} - ${score.them}`), side(theirName, null));
}

/**
 * The Summary page (GDA-108, GDA-82): score, goal timeline, coach's notes and Player of the day, in that order.
 * Empty sections are hidden, except the Player of the day row while it can still be chosen (it is the way in).
 * `canChoose` is true before End game and save; a finished game shows the page locked (no row if nobody was chosen).
 * Used by the mid-game Summary, the Full Time screen and a finished game opened from Home.
 */
function summaryBody(state, game, actions, { canChoose, soFar, editGoals = false }) {
  const team = state.teams.find((t) => t.id === (game.teamId ?? state.currentTeamId));
  const ourName = team?.name ?? "Our team";
  const summary = summaryOf(game, state.players);
  const potdPlayer = potdOf(game) === null ? null : state.players.find((p) => p.id === potdOf(game)) ?? null;
  const potdRow = canChoose
    ? h("button", { class: "setrow rowbtn card", id: "potdRow", onclick: actions.openPotdPicker }, h("span", {}, "Player of the day"), h("span", { class: "ro", id: "potdValue" }, potdPlayer ? h("span", { class: "mini" }, avatar(potdPlayer)) : null, summary.potd ? h("b", {}, summary.potd) : "Choose", " \u203a"))
    : summary.potd
      ? h("div", { class: "setrow card", id: "potdRow" }, h("span", {}, "Player of the day"), h("span", { class: "ro", id: "potdValue" }, potdPlayer ? h("span", { class: "mini" }, avatar(potdPlayer)) : null, h("b", {}, summary.potd)))
      : null;
  return [
    soFar ? h("div", { class: "lbl", id: "fullTimeTitle" }, "Score so far") : null,
    scorePanel(ourName, currentLogos[team?.id], game.opposition, summary.score),
    summary.goals.length > 0 || editGoals
      ? h("div", { class: "card", id: "timeline" }, ...summary.goals.map((g) => h(canChoose ? "button" : "div", { class: g.side === US ? "tl" : "tl them", ...(canChoose ? { type: "button", "data-goal": g.id, onclick: () => actions.openGoalFix(g.id) } : {}) }, h("span", { class: "t" }, g.when), h("span", { class: "ball" }, icon("ball")), h("span", { class: g.side === US ? "" : "ro" }, g.who))), editGoals ? h("button", { class: "elink", type: "button", id: "editGoals", onclick: actions.openEditGoals }, "Edit goals") : null)
      : null,
    summary.notes.length > 0 ? h("div", { class: "card nt", id: "notesCard" }, ...summary.notes.map((n) => h("div", {}, h("b", {}, n.name), " ", n.text))) : null,
    potdRow,
    setCard(interchangeRow(actions)),
    goalFixSheet(state, game, actions, canChoose),
  ];
}

/**
 * GDA-94: the change/remove pop-up for one goal tapped in the Summary's timeline, and its "Remove this goal?" confirm.
 * Our goal: the "Who scored?" tiles (current scorer ticked), Own goal, and Remove this goal. Opposition goal: Remove only.
 * Shown only while the game can still be corrected (before End game and save).
 */
function goalFixSheet(state, game, actions, canChoose) {
  const nameOf = (id) => state.players.find((p) => p.id === id)?.name ?? null;
  const fix = canChoose ? goalFixOf(game, state.goalFixId ?? state.goalRemoveAsk, nameOf) : null;
  if (!fix) {
    return null;
  }
  const remove = h("button", { class: "btn redtext", id: "removeGoal", onclick: actions.askRemoveGoal }, "Remove this goal");
  if (state.goalRemoveAsk !== null) {
    return h(
      "div",
      { class: "scrim", id: "removeGoalConfirm" },
      h(
        "div",
        { class: "sheet" },
        h("h2", {}, "Remove this goal?"),
        h("p", {}, `${fix.title}. The score goes to ${fix.scoreAfter}.`),
        h("button", { class: "btn del", id: "confirmRemoveGoal", onclick: actions.confirmRemoveGoal }, "Remove goal"),
        h("button", { class: "btn", id: "cancelRemoveGoal", onclick: actions.cancelRemoveGoal }, "Cancel")
      )
    );
  }
  if (fix.side !== US) {
    return h(
      "div",
      { class: "scrim", id: "goalFix" },
      h("div", { class: "sheet" }, h("div", { class: "phead" }, h("h2", {}, fix.title), h("button", { class: "pkx", id: "pickerX", "aria-label": "Close", onclick: actions.closeGoalFix }, "\u00d7")), remove)
    );
  }
  const players = scorerChoices(game, state.players, game.played);
  const ownGoal = h(
    "button",
    { class: "ptile og" + (fix.scorerId === null ? " here" : ""), id: "ownGoal", onclick: () => actions.changeGoalScorer(null) },
    h("span", { class: "pav" }, h("span", { class: "av c3" }, "OG")),
    h("span", { class: "pnm" }, "Own goal"),
    fix.scorerId === null ? h("span", { class: "pchk" }, "\u2713") : null
  );
  return playerPicker({
    id: "goalFix",
    columns: players.length >= 13 ? 4 : 3,
    title: fix.title,
    players,
    selected: new Set(),
    multi: false,
    chosen: fix.scorerId,
    onToggle: actions.changeGoalScorer,
    onCancel: actions.closeGoalFix,
    gridTail: ownGoal,
    footer: h("div", { class: "pfoot" }, remove),
  });
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

/** GDA-166: the Full Time header: Back at the left, one centred title with the stopwatch before it, the Close game X (if any) at the right. */
function fullTimeHead(state, actions) {
  const [back, next] = navArrows(state, actions);
  const right = state.viewId ? next : h("div", { class: "hslot" }); // an empty slot keeps the title centred
  return h("div", { class: "clk bar hb ft" }, back, h("h1", { class: "ftt" }, icon("stopwatch"), "Full Time"), right);
}

/**
 * Full Time (GDA-50, GDA-95, GDA-108): reached with \u203a once the 2nd half has ended. It IS the Summary page, plus
 * End game and save, which stores the record and closes the game for good. \u2039 only goes back to the 2nd Half (Ended),
 * where Resume half is still there for a last goal. A finished game opened from Home shows it locked.
 */
function fullTimeScreen(state, actions) {
  const game = openGame(state);
  const open = !state.viewId;
  const corrects = Boolean(state.viewId) && canCorrectFinished(game); // GDA-155: a finished game can still be corrected
  return {
    nodes: [
      fullTimeHead(state, actions),
      h(
        "div",
        { class: "body" },
        state.justSaved ? h("p", { class: "hint", id: "gameSaved", role: "status" }, "Game saved") : null, // GDA-186: only straight after saving
        ...summaryBody(state, game, actions, { canChoose: open ? canEditNotes(game) : corrects, soFar: false, editGoals: corrects }),
        problemLine(state.problem),
        // GDA-210: the cog (bottom-left) is only on a saved game, where its sheet holds Archive game alone.
        h("div", { class: "endrow" }, canArchiveGame(game) ? settingsButton(actions) : null, open ? h("button", { class: "btn pri big", id: "fullTime", onclick: actions.askFullTime }, "End game and save") : h("button", { class: "btn", id: "closeGameBottom", onclick: actions.closeGame }, "Close game"))
      ),
      gameDetailsSheet(state, game, actions),
      state.fullTimeAsk ? fullTimeSheet(actions) : null,
      open || corrects ? potdPicker(state, game, actions) : null,
      corrects ? goalDialog(state, game, actions) : null,
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
 * The bench time table (it sorts by heading) and the swaps, oldest first: the two parts of Interchange history (GDA-121).
 * Shared by that screen and by the game's List view (GDA-48). Read only: it reads the saved swaps and changes nothing.
 */
function tallyAndSwaps(state, game, actions) {
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
  return [table, list];
}

/** Interchange history (GDA-121): opened from the Game details sheet or the Summary page. */
function interchangeScreen(state, actions) {
  const game = openGame(state);
  const [table, list] = tallyAndSwaps(state, game, actions);
  return {
    nodes: [
      centredHeader(header("Interchange history", actions.closeInterchange)),
      h("div", { class: "body" }, h("div", { class: "card" }, h("div", { class: "hd" }, "Bench time"), table), h("div", { class: "card" }, h("div", { class: "hd" }, "Swaps"), list)),
    ],
  };
}

/**
 * GDA-48: the Pitch / List switch, a 44px round icon button in the top right corner of the pitch (and of the List, so it stays put).
 * The icon shows the view it switches to. Switching only changes what is drawn; nothing is saved or moved.
 */
function viewSwitch(state, actions) {
  const toList = !state.listView;
  return h("button", { type: "button", class: "vsw", id: "viewSwitch", "aria-label": toList ? "Show the list" : "Show the pitch", onclick: actions.toggleView }, icon(toList ? "list" : "pitch"));
}

/**
 * The box that takes the pitch's place in List view: a header line (caption on the left, the switch on the right), then a
 * scrolling area. Settings (and in a running game the swap pill) stay in their corners, so the screen's other parts do not move.
 */
function listBox(state, actions, caption, content, pill = null, tabs = null) {
  // GDA-213: in a game the header holds the two tabs; the caption (the season's Halves / Minutes choice) then sits at the top of the scrolling area.
  const head = tabs ? [tabs, viewSwitch(state, actions)] : [h("span", { class: "lvcap", id: "listCaption" }, ...[].concat(caption)), viewSwitch(state, actions)];
  const top = tabs && caption ? [h("div", { class: "lvcap lvtop", id: "listCaption" }, ...[].concat(caption))] : [];
  return h(
    "div",
    { class: "listbox" + (pill ? " pilled" : "") },
    h("div", { class: "lvhead" }, ...head),
    h("div", { class: "lvscroll", id: "listScroll" }, ...top, ...[].concat(content)),
    pill
  );
}

/** GDA-213: the Today / Season tabs in a game's List view (the Results / Players tab look). Opens on Interchange history. */
function listTabs(state, actions) {
  const onSeason = state.listTab === "season";
  const tab = (id, which, text) =>
    h("button", { type: "button", class: "htab", id, role: "tab", "aria-selected": String(onSeason === (which === "season")), onclick: () => actions.setListTab(which) }, text);
  return h("div", { class: "htabs", role: "tablist" }, tab("tabGame", "game", LIST_TAB_LABELS.game), tab("tabSeason", "season", LIST_TAB_LABELS.season));
}
const LIST_TAB_LABELS = { game: "Today", season: "Season" };

/** List view in a running game: the existing Interchange history (GDA-121) in the pitch's place. */
function historyList(state, game, actions, pill) {
  const tabs = listTabs(state, actions);
  if (state.listTab === "season") {
    return seasonList(state, game, actions, { tabs, pill }); // GDA-213: the same list the 1st half's line-up shows
  }
  const [table, list] = tallyAndSwaps(state, game, actions);
  return listBox(state, actions, null, [table, h("div", { class: "lvsub" }, "Swaps"), list], pill, tabs);
}

const AREA_HEADINGS = { name: "Name", Goal: "Keeper", Defence: "Defence", Midfield: "Midfield", Attack: "Attack" };

/**
 * List view before kick-off (GDA-48): every player with the share of halves they played in each area (GDA-173 works the
 * numbers out), A to Z until a heading is tapped. A dash and an empty bar for no halves played; nobody coloured or ranked.
 */
function seasonList(state, game, actions, { tabs = null, pill = null } = {}) {
  const totals = seasonTotals({ games: state.games, players: state.players, eventsByGame: state.seasonEvents ?? {} });
  const sort = state.seasonSort;
  const mode = state.seasonMode === "minutes" ? "minutes" : "halves"; // GDA-176: opens on Halves
  const { here, absent } = listRows(state.players, totals.players, game.absent ?? [], sort, mode);
  // The phone's own select (GDA-176) names the measure; 
  const option = (value) => h("option", { value, selected: value === mode }, listMeasure(value));
  const caption = [
    h("select", { class: "lmode", id: "seasonMode", "aria-label": "Measure", onchange: (e) => actions.setSeasonMode(e.target.value) }, option("halves"), option("minutes")),
  ];
  if (totals.gamesCounted === 0) {
    return listBox(state, actions, caption, h("div", { class: "empty", id: "noSeason" }, "No saved games yet.", h("br"), "This fills in when a game is saved at Full Time."), pill, tabs);
  }
  const heading = (column) => {
    const sorted = sort.column === column;
    return h(
      "th",
      { scope: "col", ...(sorted ? { "aria-sort": sort.descending ? "descending" : "ascending" } : {}) },
      h("button", { type: "button", class: "sorter", "data-col": column, onclick: () => actions.sortSeason(column) }, AREA_HEADINGS[column], h("span", { class: "so", "aria-hidden": "true" }, sorted ? (sort.descending ? "\u25bc" : "\u25b2") : ""))
    );
  };
  const cell = (percent) =>
    h("td", {}, h("span", { class: "pp" }, percent === null ? "\u2013" : `${percent}%`), h("span", { class: "tr" }, percent === null ? null : h("b", { style: `width: ${percent}%` })));
  const row = (r) => h("tr", { "data-id": String(r.id) }, h("td", { class: "who" }, r.name), ...LIST_COLUMNS.slice(1).map((area) => cell(r.percent[area])));
  const table = h(
    "table",
    { class: "season", id: "seasonTable" },
    h("thead", {}, h("tr", {}, ...LIST_COLUMNS.map(heading))),
    h("tbody", {}, ...here.map(row)),
    absent.length > 0 ? h("tbody", {}, h("tr", { class: "sep" }, h("td", { colspan: "5" }, "ABSENT")), ...absent.map(row)) : null
  );
  return listBox(state, actions, caption, table, pill, tabs);
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

/**
 * The Player of the Day list (GDA-174, GDA-175): a sheet like the player profile (same close options: X, swipe down, grey background).
 * One row per player here: picture, name, season count just after the name, tick on today's pick. Tap a heading to sort (GDA-174). Tap a name to pick (replaces any
 * earlier pick) and close; tap the ticked name to clear. The count is saved games only, so today never adds to it.
 */
function potdHeadings(state, actions) {
  const sort = state.potdSort;
  const heading = (column, text) =>
    h("button", { type: "button", class: "sorter" + (sort.column === column ? " on" : ""), "data-col": column, ...(sort.column === column ? { "aria-sort": sort.descending ? "descending" : "ascending" } : {}), onclick: () => actions.sortPotd(column) }, text, h("span", { class: "so", "aria-hidden": "true" }, sort.column === column ? (sort.descending ? "\u25bc" : "\u25b2") : ""));
  return h("div", { class: "potdhead", id: "potdHead" }, h("span", { class: "hp" }), heading("name", "Player"), heading("count", "This season"));
}

function potdPicker(state, game, actions) {
  if (!state.potdOpen || !canCorrect(game)) {
    return null;
  }
  const totals = seasonTotals({ games: state.games, players: state.players, eventsByGame: {} });
  const picked = potdOf(game);
  const rows = potdListRows(state.players, totals, game.absent ?? [], state.potdSort).map(({ player, count }) =>
    h(
      "button",
      { type: "button", class: "potdrow" + (player.id === picked ? " on" : ""), "data-id": String(player.id), "aria-pressed": player.id === picked ? "true" : "false", onclick: () => actions.pickPotd(player.id) },
      avatar(player),
      h("span", { class: "pn" }, player.name),
      h("span", { class: "pc" }, String(count)),
      h("span", { class: "pt tickMark" }, player.id === picked ? "\u2713" : "")
    )
  );
  const onScrim = (event) => {
    if (event.target === event.currentTarget) {
      actions.closePotdPicker(); // only the grey background itself, never the sheet
    }
  };
  return h(
    "div",
    { class: "scrim", id: "potdPicker", onclick: onScrim },
    h(
      "div",
      { class: "sheet profile potd" },
      h("div", { class: "phd" }, h("h2", {}, "Player of the day"), h("button", { class: "pkx", id: "potdClose", "aria-label": "Close", onclick: actions.closePotdPicker }, "\u00d7")),
      potdHeadings(state, actions),
      h("div", { class: "psb potdlist", id: "potdList" }, ...rows)
    )
  );
}

/** GDA-109: "Goal" is stored in games and the export; on screen the position is called Keeper (S8). */
const AREA_LABELS = { Goal: "Keeper", Defence: "Defence", Midfield: "Midfield", Attack: "Attack", Bench: "Bench", Absent: "Absent" };

/** One game line on the profile. Halves: "1st Keeper \u00b7 2nd Bench". Minutes: "Keeper 20 min \u00b7 Bench 20 min" (whole minutes, none left out of order). */
function profileGameText(line, mode) {
  if (mode === "minutes") {
    const parts = [...AREAS, "Bench"].map((area) => [area, Math.round(line.minutes[area])]).filter(([, minutes]) => minutes > 0);
    return parts.length === 0 ? "\u2013" : parts.map(([area, minutes]) => `${AREA_LABELS[area]} ${minutes} min`).join(" \u00b7 ");
  }
  return `1st ${AREA_LABELS[line.halves[0]] ?? line.halves[0]} \u00b7 2nd ${AREA_LABELS[line.halves[1]] ?? line.halves[1]}`;
}

/**
 * The season part of the profile (GDA-109, final layout GDA-174): SEASON heading with the Halves/Minutes select, the column chart
 * (four positions, Goals as a 5th element), ONE "Player of the day" line FIRST (under the note box in a game, under the name before kick-off; the switch is passed in only during a game), then the last 3 games. Only shows numbers (S3, S4).
 */
function profileSeason(state, player, actions, potdSwitch) {
  const season = seasonTotals({ games: state.games, players: state.players, eventsByGame: state.seasonEvents ?? {} }).players.get(player.id);
  const mode = state.seasonMode === "minutes" ? "minutes" : "halves"; // one shared choice with the season List
  const potdLine = h("div", { class: "ppod", id: "profileCounts" }, h("span", {}, "Player of the day"), h("span", { class: "pmuted" }, "\u00b7 ", h("b", { id: "profilePotd" }, String(season.potdCount)), " this season"), potdSwitch ?? null);
  if (season.halvesPlayed === 0) {
    return [
      potdLine,
      h("div", { class: "pcap" }, "SEASON"),
      h("div", { class: "pnone", id: "profileNone" }, `Nothing played yet. Positions and games appear once ${player.name} has played.`),
      h("div", { class: "pgoal", id: "profileGoalsLine" }, "Goals ", h("b", { id: "profileGoals" }, String(season.goals))),
    ];
  }
  const percent = mode === "minutes" ? season.minutesPercent : season.percent;
  const option = (value, text) => h("option", { value, selected: value === mode }, text);
  const column = (area) =>
    h("div", { class: "pcol", "data-area": area }, h("b", { class: "pp" }, percent[area] === null ? "\u2013" : `${percent[area]}%`), h("span", { class: "well" }, percent[area] === null ? null : h("i", { style: `height: ${percent[area]}%` })), h("span", { class: "plab" }, AREA_LABELS[area]));
  // On Minutes a game saved without events has no minutes and is left out (it still counts in halves).
  const games = season.lastGames.filter((line) => mode === "halves" || line.minutes !== null);
  return [
    potdLine,
    h("div", { class: "phead" }, h("span", { class: "pcap" }, "SEASON"), h("select", { class: "lmode", id: "profileMode", "aria-label": "Show as", onchange: (e) => actions.setSeasonMode(e.target.value) }, option("halves", "Halves"), option("minutes", "Minutes"))),
    h("div", { class: "pchart" }, ...AREAS.map(column), h("div", { class: "pcol pgoals" }, h("b", { class: "pp" }, "\u00a0"), h("span", { class: "well" }, h("b", { id: "profileGoals" }, String(season.goals))), h("span", { class: "plab" }, "Goals"))),
    h("div", { class: "pcap" }, "LAST 3 GAMES"),
    h("div", { id: "profileGames" }, ...games.map((line) => h("div", { class: "pgame" }, h("span", { class: "po" }, `v ${line.opposition}`, h("small", {}, formatGameDate(line.date))), h("span", { class: "pr" }, profileGameText(line, mode))))),
  ];
}

/**
 * The player profile (GDA-109, replaces the GDA-81 hold sheet): opened by press and hold on a circle. Always: name, picture,
 * the season figures. In a running game also today's note (the phone's own text box, saved when Done is tapped) and the
 * Player of the day switch (the phone's own, saved at once). Closes with Done, the X, a tap on the background or a swipe down; all save the note. The typed text is kept in state.noteDraft.
 */
function noteSheet(state, game, actions) {
  const player = state.players.find((p) => p.id === state.noteFor);
  if (state.noteFor === null || !player) {
    return null;
  }
  const inGame = Boolean(game) && canCorrect(game); // GDA-187: opened from Season history there is no game, so figures only
  const done = h("button", { class: "btn pri big", id: "noteDone", onclick: actions.closeNote }, "Done");
  // GDA-109: three more ways to close, all saving exactly as Done does: this X, a tap on the grey background, a swipe down (main.js).
  const head = h("div", { class: "phd" }, avatar(player), h("h2", {}, player.name), h("button", { class: "pkx", id: "noteClose", "aria-label": "Close", onclick: actions.closeNote }, "\u00d7"));
  const onScrim = (event) => {
    if (event.target === event.currentTarget) {
      actions.closeNote(); // only the grey background itself, never the sheet
    }
  };
  if (!inGame) {
    return h("div", { class: "scrim", id: "noteSheet", onclick: onScrim }, h("div", { class: "sheet profile" }, head, h("div", { class: "psb" }, ...profileSeason(state, player, actions, null)), done));
  }
  const potdSwitch = h("input", { type: "checkbox", switch: "", id: "potdSwitch", "aria-label": "Player of the day", checked: potdOf(game) === player.id, onchange: () => actions.setPotd(player.id, document.getElementById("potdSwitch").checked) });
  const box = h("textarea", { id: "noteText", rows: "3", "aria-label": `Note about ${player.name}`, oninput: () => actions.noteTyped(box.value) });
  box.value = state.noteDraft ?? noteOf(game, player.id);
  return h(
    "div",
    { class: "scrim", id: "noteSheet", onclick: onScrim },
    h(
      "div",
      { class: "sheet profile" },
      head,
      h(
        "div",
        { class: "psb" },
        h("div", { class: "pcap" }, "TODAY'S NOTE"),
        box,
        problemLine(state.problem),
        ...profileSeason(state, player, actions, potdSwitch)
      ),
      done
    )
  );
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

const HISTORY_HEADINGS = { name: "Player", played: "Played", goals: "Goals", potd: "POD" };
const RESULT_WORDS = { W: "Won", D: "Drawn", L: "Lost" };

/**
 * Season history (GDA-187): the team's season on one page. Read-only. A summary card, then one card with two tabs:
 * Players (a sortable table, a row opens the player's profile) and Results (every counted game, newest first).
 * All figures come from the existing season rules plus history-rules.js, so they count the same games as the profile.
 */
function historyScreen(state, actions) {
  const record = teamRecord(state.games);
  const figure = (value, label, id) => h("div", { class: "hfig" }, h("b", { id }, String(value)), h("span", {}, label));
  const summary = h(
    "div",
    { class: "card hcard", id: "historySummary" },
    h("h2", {}, "Team"),
    h("div", { class: "hsum" }, figure(record.played, "Played", "hPlayed"), figure(record.won, "Won", "hWon"), figure(record.drawn, "Drawn", "hDrawn"), figure(record.lost, "Lost", "hLost")),
    h("div", { class: "hsum three" }, figure(record.goalsFor, "Goals for", "hFor"), figure(record.goalsAgainst, "Goals against", "hAgainst"), figure(goalDifferenceText(record.goalDifference), "Goal difference", "hDiff"))
  );
  return {
    nodes: [
      header("Season history", actions.goHome),
      h(
        "div",
        { class: "body" },
        summary,
        h(
          "div",
          { class: "card hcard" },
          ...seasonTabs(state, actions)
        )
      ),
      noteSheet(state, null, actions), // a row's profile (no game open: figures only)
    ],
  };
}

/**
 * The Results / Players tabs and the open tab's content (GDA-185). ONE implementation, used by Home and the Season history
 * page, so the rows, shades, tab order (Results first) and Players table are identical on both.
 */
function seasonTabs(state, actions) {
  const onPlayers = state.historyTab === "players";
  const tab = (id, which, text) =>
    h("button", { type: "button", class: "htab", id, role: "tab", "aria-selected": String(onPlayers === (which === "players")), onclick: () => actions.setHistoryTab(which) }, text);
  const totals = seasonTotals({ games: state.games, players: state.players, eventsByGame: state.seasonEvents ?? {} });
  return [
    h("div", { class: "htabs", role: "tablist" }, tab("tabResults", "results", "Results"), tab("tabPlayers", "players", "Players")),
    onPlayers ? historyPlayers(state, actions, totals.players) : historyResults(state, actions),
  ];
}

function historyPlayers(state, actions, totals) {
  if (state.players.length === 0) {
    return h("div", { class: "empty", id: "noHistoryPlayers" }, "No players yet.");
  }
  const mode = state.seasonMode === "minutes" ? "minutes" : "halves";
  const sort = state.historySort;
  const rows = historyRows(state.players, totals, gamesPlayed(state.games, state.players), sort, mode);
  const option = (value, text) => h("option", { value, selected: value === mode }, text);
  const heading = (column) => {
    const on = sort.column === column;
    return h(
      "th",
      { scope: "col", class: column === "name" ? "who" : "", ...(on ? { "aria-sort": sort.descending ? "descending" : "ascending" } : {}) },
      h("button", { type: "button", class: "sorter", "data-col": column, onclick: () => actions.sortHistory(column) }, HISTORY_HEADINGS[column], h("span", { class: "so", "aria-hidden": "true" }, on ? (sort.descending ? "\u25bc" : "\u25b2") : ""))
    );
  };
  const chart = (levels) =>
    levels === null
      ? h("span", { class: "hdash" }, "\u2013")
      : h("span", { class: "hchart", role: "img", "aria-label": AREAS.map((a) => `${AREA_LABELS[a]} level ${levels[a]} of 3`).join(", ") }, ...AREAS.map((a) => h("i", { class: "l" + levels[a] })));
  const row = (r) =>
    h(
      "tr",
      { class: "hrow", "data-id": String(r.id), onclick: () => actions.openHistoryProfile(r.id) },
      h("td", { class: "who" }, h("span", { class: "hname" }, r.name), h("span", { class: "chev", "aria-hidden": "true" }, "\u203a")),
      h("td", {}, String(r.played)),
      h("td", {}, String(r.goals)),
      h("td", {}, String(r.potd)),
      h("td", { class: "ch" }, chart(r.levels))
    );
  return h(
    "div",
    { role: "tabpanel" },
    h("select", { class: "lmode", id: "historyMode", "aria-label": "Show as", onchange: (e) => actions.setSeasonMode(e.target.value) }, option("halves", "Halves"), option("minutes", "Minutes")),
    h(
      "table",
      { class: "hist", id: "historyTable" },
      h("thead", {}, h("tr", {}, ...["name", "played", "goals", "potd"].map(heading), h("th", { scope: "col", class: "ch" }, "Positions"))),
      h("tbody", {}, ...rows.map(row))
    )
  );
}

/**
 * Results rows (GDA-185), the same on Home and on Season history: date, "v Opponent" with a small H or A, the W / D / L tag, the
 * score. A tap opens that finished game.
 */
function historyResults(state, actions) {
  const rows = resultRows(state.games);
  if (rows.length === 0) {
    return h("div", { class: "empty", id: "noResults", role: "tabpanel" }, "No finished games yet.");
  }
  return h(
    "ul",
    { class: "hres", id: "historyResults", role: "tabpanel" },
    ...rows.map((r) => {
      const venueTag = state.games.find((g) => g.id === r.id)?.venueTag;
      const side = venueTag === "Home" ? "H" : venueTag === "Away" ? "A" : "";
      return h(
        "li",
        { "data-id": String(r.id), class: "resRow", "data-game": r.id, role: "button", tabindex: "0", onclick: () => actions.viewGame(r.id) },
        h("span", { class: "hd" }, formatShortDate(r.date)),
        h("span", { class: "ho" }, `v ${r.opposition}`, side ? h("span", { class: "ha" }, side) : null),
        h("span", { class: "hr " + r.letter, title: RESULT_WORDS[r.letter], "aria-label": RESULT_WORDS[r.letter] }, r.letter),
        h("span", { class: "hs" }, `${r.us}\u2013${r.them}`)
      );
    })
  );
}

const SCREENS = {
  home: homeScreen,
  squad: squadScreen,
  history: historyScreen,
  add: addScreen,
  edit: editScreen,
  createGame: createGameScreen,
  newGame: newGameScreen,
  half1: halfScreen,
  half2: halfScreen,
  fullTime: fullTimeScreen,
  summary: summaryScreen,
  interchange: interchangeScreen,
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
export function drawLineUpActions() {
  document.querySelector(".acts")?.replaceChildren();
}
