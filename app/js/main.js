// Starts the app and holds what is on screen. The order for every change is:
// save it, read the saved data back, then draw. So the screen only ever shows
// what is really stored.

import { openDatabase } from "./db.js";
import { watchLineUpPresses } from "./drag.js";
import {
  afterTap,
  blankGameForm,
  canCreateGame,
  canDrag,
  markedAbsent,
  markedBackIn,
  movedOnto,
  needsPrePlacing,
} from "./game-rules.js";
import { addGame, changeGame, loadGames, movePlayer, prePlaceGame } from "./game-store.js";
import { askToKeepDataOnce } from "./persistence.js";
import { drawLineUpActions, drawScreen } from "./screens.js";
import { cleanName } from "./squad-rules.js";
import { addPlayer, loadSquad, removePlayer, renamePlayer } from "./squad-store.js";
import { applyUpdate, currentUpdateNotice, startUpdates } from "./updates.js";

const SAVE_PROBLEM = "That did not save. Please try again.";
// After a screen change, ignore taps briefly, so the second half of a fast
// double tap cannot land on whatever is now under the finger.
const TAP_PAUSE_MS = 300;

let db = null;
let ignoreTapsUntil = 0;
let ignoreReadyUntil = 0;
let saving = false;
let listScroll = 0; // Where the Squad list was, for coming back to it.

const state = {
  screen: "home",
  players: [],
  games: [],
  form: null, // What is typed on the New game screen, until it is saved or left.
  gameId: null, // The game whose line-up is open.
  selectedId: null, // The player selected on the line-up. Never saved.
  editId: null,
  addCameFrom: "home",
  showRemoveWarning: false,
  problem: "",
  updateNotice: currentUpdateNotice(),
};

function draw() {
  state.updateNotice = currentUpdateNotice();
  drawScreen(state, actions);
}

function goTo(screen) {
  state.screen = screen;
  state.problem = "";
  state.showRemoveWarning = false;
  state.selectedId = null;
  ignoreTapsUntil = Date.now() + TAP_PAUSE_MS;
  draw();
  window.scrollTo(0, 0);
  if (screen === "squad") {
    document.querySelector(".list").scrollTop = listScroll;
  }
}

/** Call just before leaving the Squad list for a screen that comes back to it. */
function rememberListScroll() {
  listScroll = document.querySelector(".list").scrollTop;
}

function readyForTaps() {
  return !saving && Date.now() >= ignoreTapsUntil;
}

/**
 * Wraps a tap handler so it is ignored during a save, just after a screen change,
 * or while another finger is on a player: a button must not redraw the screen
 * under a drag.
 */
function tap(handler) {
  return (...args) => {
    if (!readyForTaps() || presses.isActive()) {
      return;
    }
    handler(...args);
  };
}

function nameTyped() {
  return cleanName(document.getElementById("nm").value);
}

function showCannotOpen(error) {
  console.warn("Could not read the database", error);
  state.screen = "cannotOpen";
  draw();
}

/** Redraws the add or edit screen without losing what is typed in the name box. */
function drawKeepingTypedName() {
  const typed = document.getElementById("nm").value;
  draw();
  const box = document.getElementById("nm");
  box.value = typed;
  box.dispatchEvent(new Event("input")); // Keeps Save available or unavailable to match.
}

/**
 * Saves one change. The list screen appears only after it is safely stored.
 * saveChange may finish with a player's id, to bring that player into view.
 */
async function saveThenShowSquad(saveChange) {
  saving = true;
  let playerToShow;
  try {
    playerToShow = await saveChange();
  } catch (error) {
    console.warn("Save failed", error);
    saving = false;
    state.problem = SAVE_PROBLEM;
    state.showRemoveWarning = false;
    drawKeepingTypedName();
    return;
  }
  try {
    state.players = await loadSquad(db);
    state.games = await loadGames(db); // Removing a player changes games too.
    saving = false;
    goTo("squad");
    if (playerToShow !== undefined) {
      document.querySelector(`[data-player="${playerToShow}"]`).scrollIntoView({ block: "nearest" });
    }
  } catch (error) {
    saving = false;
    showCannotOpen(error);
  }
}

/** Saves a new game. Its line-up appears only after it is safely stored. */
async function saveGameThenShowLineUp() {
  saving = true;
  let gameId;
  try {
    gameId = await addGame(db, state.form);
  } catch (error) {
    console.warn("Save failed", error);
    saving = false;
    state.problem = SAVE_PROBLEM;
    draw(); // Built from state.form, so nothing typed is lost.
    return;
  }
  try {
    state.games = await loadGames(db);
    saving = false;
    state.form = null;
    state.gameId = gameId;
    goTo("lineUp");
  } catch (error) {
    saving = false;
    showCannotOpen(error);
  }
}

/** Opens a game's line-up from Home, first placing the squad if the game is from before GDA-18. */
async function openLineUp(gameId) {
  saving = true;
  try {
    if (needsPrePlacing(state.games.find((game) => game.id === gameId))) {
      await prePlaceGame(db, gameId);
    }
  } catch (error) {
    console.warn("Save failed", error);
    saving = false;
    state.problem = SAVE_PROBLEM;
    draw();
    return;
  }
  try {
    state.games = await loadGames(db);
    saving = false;
    state.gameId = gameId;
    goTo("lineUp");
  } catch (error) {
    saving = false;
    showCannotOpen(error);
  }
}

/** Saves a change to the line-up. The screen changes only after it is safely stored. */
async function saveThenShowLineUp(saveChange) {
  saving = true;
  try {
    await saveChange();
  } catch (error) {
    console.warn("Save failed", error);
    saving = false;
    state.problem = SAVE_PROBLEM;
    draw(); // A selected player stays selected, so trying again is one tap.
    return;
  }
  try {
    state.games = await loadGames(db);
    saving = false;
    state.selectedId = null;
    state.problem = "";
    draw();
  } catch (error) {
    saving = false;
    showCannotOpen(error);
  }
}

/**
 * Absent and Back in: a rule from game-rules.js applied to the selected player.
 * The bottom button becomes Ready for kick-off under the finger, so that one button
 * pauses briefly: a fast double tap must not go on to tap it too. The circles do
 * not pause, because the next step in a late change is tapping a bench player.
 */
async function saveSelectedPlayer(rule) {
  await saveThenShowLineUp(() => changeGame(db, state.gameId, (game) => rule(game, state.selectedId)));
  ignoreReadyUntil = Date.now() + TAP_PAUSE_MS;
}

function saveMove(playerId, spot) {
  return saveThenShowLineUp(() => movePlayer(db, state.gameId, playerId, spot, Date.now()));
}

function openGame() {
  return state.games.find((game) => game.id === state.gameId);
}

const actions = {
  goHome: tap(() => goTo("home")),
  openSquad: tap(() => {
    listScroll = 0; // From Home, the list starts at the top.
    goTo("squad");
  }),
  backToSquad: tap(() => goTo("squad")),
  addFromHome: tap(() => {
    listScroll = 0;
    openAdd("home");
  }),
  addFromSquad: tap(() => {
    rememberListScroll();
    openAdd("squad");
  }),
  leaveAdd: tap(() => goTo(state.addCameFrom)),
  openEdit: tap((id) => {
    rememberListScroll();
    state.editId = id;
    goTo("edit");
  }),
  saveNew: tap(() => {
    const name = nameTyped();
    if (name) {
      saveThenShowSquad(() => addPlayer(db, name));
    }
  }),
  saveRename: tap(() => {
    const name = nameTyped();
    if (name) {
      saveThenShowSquad(() => renamePlayer(db, state.editId, name));
    }
  }),
  askRemove: tap(() => {
    document.activeElement?.blur(); // Closes the keyboard so the warning can be seen.
    showWarning(true);
  }),
  cancelRemove: tap(() => showWarning(false)),
  confirmRemove: tap(() => saveThenShowSquad(() => removePlayer(db, state.editId))),
  openCreateGame: tap(() => {
    state.form = blankGameForm();
    goTo("createGame");
  }),
  leaveCreateGame: tap(() => {
    state.form = null;
    goTo("home");
  }),
  makeGame: tap(() => {
    if (canCreateGame(state.form)) {
      saveGameThenShowLineUp();
    }
  }),
  openLineUp: tap((gameId) => openLineUp(gameId)),
  markAbsent: tap(() => saveSelectedPlayer(markedAbsent)),
  markBackIn: tap(() => saveSelectedPlayer(markedBackIn)),
  readyForKickOff: tap(() => {
    if (Date.now() >= ignoreReadyUntil) {
      goTo("ready");
    }
  }),
  backToLineUp: tap(() => goTo("lineUp")),
  applyUpdate: tap(() => applyUpdate()),
  tryAgain: tap(() => window.location.reload()),
};

// Taps and drags on the line-up's circles. See drag.js.
const presses = watchLineUpPresses({
  canPress: () => state.screen === "lineUp" && readyForTaps(),
  canDrag: (spot) => canDrag(openGame(), spot),
  canDrop: (playerId, spot) => movedOnto(openGame(), playerId, spot) !== null,
  tapped(spot) {
    const outcome = afterTap(openGame(), state.selectedId, spot);
    state.problem = "";
    if (outcome.move) {
      saveMove(state.selectedId, spot);
    } else {
      state.selectedId = outcome.selectedId;
      draw();
    }
  },
  dragStarted() {
    state.selectedId = null;
    state.problem = "";
    drawLineUpActions(state, actions);
  },
  dropped(playerId, spot) {
    if (spot) {
      saveMove(playerId, spot);
    } else {
      draw();
    }
  },
});

function openAdd(cameFrom) {
  state.addCameFrom = cameFrom;
  goTo("add");
  // Inside the tap itself, because iPhones open the keyboard only during a tap.
  document.getElementById("nm").focus();
}

function showWarning(show) {
  state.showRemoveWarning = show;
  drawKeepingTypedName();
}

/** A new version may be noticed at any moment. Only Home shows it, so only Home redraws. */
function onUpdateNews() {
  if (state.screen === "home") {
    draw();
  }
}

async function start() {
  document.documentElement.dataset.version = self.GAMEDAY_VERSION;
  try {
    db = await openDatabase(self.GAMEDAY_CONFIG.storageName);
    state.players = await loadSquad(db);
    state.games = await loadGames(db);
    draw();
  } catch (error) {
    showCannotOpen(error);
  }
  // Neither of these may hold up or stop the app.
  startUpdates(onUpdateNews);
  if (db) {
    askToKeepDataOnce(db);
  }
}

start();
