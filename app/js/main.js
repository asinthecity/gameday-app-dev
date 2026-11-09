// Starts the app and holds what is on screen. The order for every change is:
// save it, read the saved data back, then draw. So the screen only ever shows
// what is really stored.

import { getMeta, openDatabase } from "./db.js";
import { watchLineUpPresses } from "./drag.js";
import {
  afterTap,
  blankGameForm,
  canCreateGame,
  canDrag,
  canReorderBench,
  canTapLive,
  canAddGoal,
  canRemoveLastGoal,
  lastGoal,
  THEM,
  US,
  clampRotation,
  liveAction,
  markedAbsent,
  markedBackIn,
  movedOnto,
  lineUpMoved,
  needsPrePlacing,
  rotationOf,
  halfOf,
  withFormation,
  NOT_STARTED,
  gameToResume,
  screenForOpening,
  withRotation,
} from "./game-rules.js";
import { archiveGame, deleteGame, markSentToSheet, addGame, addGoal, removeGoal, changeGame, endHalf, fullTime, loadGames, moveFieldPlayer, movePlayer, planPair, prePlaceGame, reopenHalf, reorderBench, startFirstHalf, startSecondHalf, swapPlayers, undoSwap, unplanPair } from "./game-store.js";
import { cleanSheetSettings, canSend, SETTINGS_KEY } from "./sheet-rules.js";
import { sendGameToSheet } from "./sheet-send.js";
import { shareCsv } from "./share-file.js";
import { askToKeepDataOnce } from "./persistence.js";
import { drawClock, drawLineUpActions, drawPairLines, drawPitch, drawScreen, setPhotos } from "./screens.js";
import { shrinkPhoto } from "./photo-image.js";
import { PHOTO_PROBLEM } from "./photo-rules.js";
import { loadPhotos, removePhoto, savePhoto } from "./photo-store.js";
import { csvFileName, recordToCsv } from "./record-rules.js";
import { cleanName } from "./squad-rules.js";
import { addPlayer, loadSquad, removePlayer, renamePlayer } from "./squad-store.js";
import { addTeam, deleteTeam, loadTeams, switchTeam, updateTeam } from "./team-store.js";
import { rememberFirstTeamId, canSwitchTeams, cleanTeamForm, deleteRefusal, firstTeamIdOf, sheetOf } from "./team-rules.js";
import { applyUpdate, currentUpdateNotice, startUpdates } from "./updates.js";

const SAVE_PROBLEM = "That did not save. Please try again.";
const FULL_TIME_PROBLEM = "Not saved. The game is still open. Tap FULL TIME to try again.";
// After a screen change, ignore taps briefly, so the second half of a fast
// double tap cannot land on whatever is now under the finger.
const TAP_PAUSE_MS = 300;

const WELCOME_MS = 5000;

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
  photos: {}, // playerId -> small photo, kept on this phone only (GDA-52).
  addCameFrom: "home",
  showRemoveWarning: false,
  rotationOpen: false, // The rotation stepper sheet on the ready and game screens.
  welcome: false, // The "Welcome back" banner after a restart. Never saved.
  goalToast: null, // After a goal, for about 5 seconds: { goalId, text, until }. Never saved.
  goalSheet: false, // The "Who scored?" sheet.
  removeOpen: false, // The "Remove last goal?" confirm.
  undo: null, // After Swap, for about 5 seconds: { before, eventId, until }. Never saved.
  problem: "",
  fileProblemFor: null, // The finished game whose Save file just failed.
  teams: [], // Every team, oldest first (GDA-68).
  currentTeamId: null, // The team Home, Squad and Sheet settings show.
  firstTeamId: null, // What a record with no team ID belongs to.
  legacySheet: null, // The old shared Sheet setting, read only for the first team if it has none.
  teamForm: null, // The Add / Team settings form: { mode, values, errors }. Never saved until Save.
  deleteTeamOpen: false, // The "Delete team?" confirm. Never saved.
  sheetSettings: null, // { url, secret } of the CURRENT team. Stored only on this phone.
  sheetDraft: null, // What is typed on Sheet settings when a message is shown. Never saved.
  sheetSaved: false, // "Saved" note on the Sheet settings screen.
  sendingId: null, // The game being sent to the Sheet right now. Never saved.
  sheetProblem: {}, // gameId -> "secret" after the script refused the secret. Never saved.
  menuId: null, // The game whose ⋯ menu is open. Never saved.
  topMenuOpen: false, // The ☰ menu on Home. Never saved.
  archiveId: null, // The finished game being asked about ("Archive?"). Never saved.
  deleteId: null, // The not-started game being asked about ("Delete?"). Never saved.
  updateNotice: currentUpdateNotice(),
};

// The current team's squad and games (never another team's).
const squadNow = () => loadSquad(db, state.currentTeamId, state.firstTeamId);
const gamesNow = () => loadGames(db, state.currentTeamId, state.firstTeamId);

/** The current team's record, or undefined. */
function currentTeam() {
  return state.teams.find((team) => team.id === state.currentTeamId);
}

/** Reads teams, then the current team's squad, games and Sheet settings. */
async function loadEverything() {
  const { teams, currentTeamId } = await loadTeams(db);
  state.teams = teams;
  state.currentTeamId = currentTeamId;
  state.firstTeamId = firstTeamIdOf(teams);
  rememberFirstTeamId(state.firstTeamId);
  state.players = await squadNow();
  state.photos = await loadPhotos(db);
  setPhotos(state.photos);
  state.games = await gamesNow();
  state.sheetSettings = sheetOf(currentTeam(), state.legacySheet, state.firstTeamId);
}

/** Saves a team change, reloads everything, then shows Home. A failed save shows a message and keeps the form. */
async function saveTeamThenHome(save) {
  saving = true;
  try {
    await save();
    await loadEverything();
    saving = false;
    state.teamForm = null;
    goTo("home");
  } catch (error) {
    console.warn("Team change failed", error);
    saving = false;
    state.problem = SAVE_PROBLEM;
    draw();
  }
}

function draw() {
  state.updateNotice = currentUpdateNotice();
  drawScreen(state, actions);
}

function goTo(screen) {
  state.screen = screen;
  state.problem = "";
  state.showRemoveWarning = false;
  state.rotationOpen = false;
  state.selectedId = null;
  state.undo = null;
  state.goalToast = null;
  state.goalSheet = false;
  state.removeOpen = false;
  state.fileProblemFor = null;
  state.sheetSaved = false;
  state.sheetDraft = null;
  state.deleteId = null;
  state.menuId = null;
  state.topMenuOpen = false;
  state.archiveId = null;
  state.deleteTeamOpen = false;
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
 * Adds, replaces (file) or removes (null) the edited player's photo (GDA-52). Only the photo is
 * written, so a failure shows one message and leaves the player, squad and games as they were.
 */
async function changePhoto(file) {
  if (!file || saving) {
    return; // The picker was cancelled: nothing changes.
  }
  const playerId = state.editId;
  saving = true;
  try {
    const next = { ...state.photos };
    if (file === "remove") {
      await removePhoto(db, playerId);
      delete next[playerId];
    } else {
      const data = await shrinkPhoto(file);
      await savePhoto(db, playerId, data);
      next[playerId] = data;
    }
    state.photos = next;
    setPhotos(next);
    state.problem = "";
  } catch (error) {
    console.warn("Photo not saved", error);
    state.problem = PHOTO_PROBLEM;
  }
  saving = false;
  drawKeepingTypedName();
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
    state.players = await squadNow();
    state.games = await gamesNow(); // Removing a player changes games too.
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
    gameId = await addGame(db, state.form, currentTeam(), state.firstTeamId);
  } catch (error) {
    console.warn("Save failed", error);
    saving = false;
    state.problem = SAVE_PROBLEM;
    draw(); // Built from state.form, so nothing typed is lost.
    return;
  }
  try {
    state.games = await gamesNow();
    saving = false;
    state.form = null;
    state.gameId = gameId;
    // A game already started cannot go back to its line-up (full resume is GDA-33).
    goTo(screenForOpening(state.games.find((game) => game.id === gameId)));
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
    state.games = await gamesNow();
    saving = false;
    state.gameId = gameId;
    // A game already started cannot go back to its line-up (full resume is GDA-33).
    goTo(screenForOpening(state.games.find((game) => game.id === gameId)));
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
    state.games = await gamesNow();
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

/**
 * A change on the game screen (GDA-30): plan a pair, move a field player, or re-order
 * the bench. Anything but Swap itself makes Undo go.
 */
function saveLive(playerId, spot) {
  const gameId = state.gameId;
  state.undo = null;
  const action = liveAction(openGame(), playerId, spot);
  if (action === "plan") {
    return saveThenShowLineUp(() => planPair(db, gameId, playerId, spot));
  }
  if (action === "move") {
    return saveThenShowLineUp(() => moveFieldPlayer(db, gameId, playerId, spot, Date.now()));
  }
  if (action === "reorder") {
    return saveThenShowLineUp(() => reorderBench(db, gameId, playerId, spot.playerId));
  }
  draw();
}

/** Swap, then Undo: saved first, shown after. Undo stays for about 5 seconds. */
const UNDO_MS = 5000;
async function saveSwap() {
  saving = true;
  try {
    const done = await swapPlayers(db, state.gameId, Date.now());
    state.games = await gamesNow();
    state.undo = { before: done.before, eventId: done.eventId, until: Date.now() + UNDO_MS };
  } catch (error) {
    console.warn("Swap did not save", error);
    saving = false;
    state.problem = SAVE_PROBLEM;
    draw();
    return;
  }
  saving = false;
  state.selectedId = null;
  state.problem = "";
  ignoreTapsUntil = Date.now() + TAP_PAUSE_MS; // Undo appears where Swap was: a double tap must not hit it.
  draw();
  const shown = state.undo;
  setTimeout(() => {
    if (state.undo === shown) {
      state.undo = null;
      if (state.screen === "game" && !presses.isActive()) {
        draw();
      }
    }
  }, UNDO_MS);
}

async function saveUndo() {
  const undo = state.undo;
  state.undo = null;
  saving = true;
  try {
    await undoSwap(db, state.gameId, undo.before, undo.eventId);
    state.games = await gamesNow();
  } catch (error) {
    console.warn("Undo did not save", error);
    saving = false;
    state.problem = SAVE_PROBLEM;
    draw();
    return;
  }
  saving = false;
  state.problem = "";
  draw();
}

/**
 * A goal: saved first, shown after (the score is counted from the saved goals).
 * `scorerId` is a player id, or null for "Not sure" and for a goal against. The toast
 * with Undo then shows for about 5 seconds; it is taken off the page without a redraw.
 */
async function saveGoal(side, scorerId) {
  const game = openGame();
  state.goalSheet = false;
  if (!game || !canAddGoal(game)) {
    draw();
    return;
  }
  const goal = { id: crypto.randomUUID(), side, scorerId };
  saving = true;
  try {
    await addGoal(db, state.gameId, goal);
    state.games = await gamesNow();
  } catch (error) {
    console.warn("Goal did not save", error);
    saving = false;
    state.problem = SAVE_PROBLEM;
    draw();
    return;
  }
  saving = false;
  state.problem = "";
  const name = state.players.find((player) => player.id === scorerId)?.name;
  const text = side === THEM ? "Goal against" : `Goal: ${name ?? "Not sure"}`;
  const shown = { goalId: goal.id, text, until: Date.now() + UNDO_MS };
  state.goalToast = shown;
  ignoreTapsUntil = Date.now() + TAP_PAUSE_MS; // The toast appears near the buttons: a double tap must not hit Undo.
  draw();
  setTimeout(() => {
    if (state.goalToast === shown) {
      state.goalToast = null;
      document.getElementById("goalToast")?.remove();
    }
  }, UNDO_MS);
}

/** Undo (the toast) or Remove last goal (the confirm): saves the removal, then draws the corrected score. */
async function saveGoalRemoval(goalId) {
  state.goalToast = null;
  state.removeOpen = false;
  saving = true;
  try {
    await removeGoal(db, state.gameId, goalId);
    state.games = await gamesNow();
  } catch (error) {
    console.warn("Goal removal did not save", error);
    saving = false;
    state.problem = SAVE_PROBLEM;
    draw();
    return;
  }
  saving = false;
  state.problem = "";
  draw();
}

function saveBenchMove(playerId, targetId) {
  return saveThenShowLineUp(() => reorderBench(db, state.gameId, playerId, targetId));
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
      saveThenShowSquad(() => addPlayer(db, name, state.currentTeamId, state.firstTeamId));
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
  photoPicked: (file) => changePhoto(file),
  removePhoto: tap(() => changePhoto("remove")),
  confirmRemove: tap(() => saveThenShowSquad(() => removePlayer(db, state.editId))),
  openCreateGame: tap(() => {
    // GDA-22: the game takes the team's half length. A rotation longer than it is lowered, with a note.
    const half = currentTeam().halfMinutes;
    state.form = blankGameForm();
    state.form.halfMinutes = half;
    if (state.form.rotationMinutes > half) {
      state.form.rotationNote = `Rotation lowered to ${half} min to fit the half.`;
      state.form.rotationMinutes = clampRotation(state.form.rotationMinutes, half);
    }
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
  openRotation: tap(() => {
    state.rotationOpen = true;
    draw();
  }),
  // Each tap on - or + is saved at once (NFR-2). The clock and timers keep running underneath.
  stepRotation: (change) => {
    const minutes = clampRotation(rotationOf(openGame()) + change, halfOf(openGame()));
    changeGame(db, state.gameId, (game) => withRotation(game, minutes))
      .then(() => gamesNow())
      .then((games) => {
        state.games = games;
        drawClock(state);
      })
      .catch((error) => console.warn("Could not save the rotation length", error));
    // Show the new number straight away; the save follows within milliseconds.
    state.games = state.games.map((game) => (game.id === state.gameId ? withRotation(game, minutes) : game));
    drawClock(state);
  },
  // GDA-22: a valid typed shape. Only before kick-off. Same places, so nobody moves. It is also the team's last-used shape.
  setFormation: (formation) => {
    const game = openGame();
    if (!game || game.state !== NOT_STARTED || state.screen !== "lineUp") {
      return;
    }
    state.games = state.games.map((g) => (g.id === game.id ? withFormation(g, formation) : g));
    drawPitch(state);
    changeGame(db, game.id, (g) => (g.state === NOT_STARTED ? withFormation(g, formation) : g))
      .then(() => updateTeam(db, state.currentTeamId, { formation }))
      .then(() => {
        state.teams = state.teams.map((team) => (team.id === state.currentTeamId ? { ...team, formation } : team));
      })
      .catch((error) => console.warn("Could not save the formation", error));
  },
  closeRotation: tap(() => {
    state.rotationOpen = false;
    draw();
  }),
  backToLineUp: tap(() => goTo("lineUp")),
  startFirstHalf: tap(() => startGame()),
  swap: tap(() => saveSwap()),
  goalUs: tap(() => {
    if (canAddGoal(openGame())) {
      state.goalSheet = true;
      draw();
    }
  }),
  chooseScorer: tap((playerId) => saveGoal(US, playerId)),
  closeGoalSheet: tap(() => {
    state.goalSheet = false;
    draw();
  }),
  goalAgainst: tap(() => saveGoal(THEM, null)),
  undoGoal: tap(() => state.goalToast && saveGoalRemoval(state.goalToast.goalId)),
  openRemoveGoal: tap(() => {
    if (canRemoveLastGoal(openGame())) {
      state.removeOpen = true;
      draw();
    }
  }),
  closeRemoveGoal: tap(() => {
    state.removeOpen = false;
    draw();
  }),
  confirmRemoveGoal: tap(() => {
    const goal = lastGoal(openGame());
    if (goal && canRemoveLastGoal(openGame())) {
      saveGoalRemoval(goal.id);
    } else {
      state.removeOpen = false;
      draw();
    }
  }),
  undo: tap(() => saveUndo()),
  unpair: tap((benchId) => {
    state.undo = null;
    saveThenShowLineUp(() => unplanPair(db, state.gameId, benchId));
  }),
  // First half: opens Half Time. Second half: the temporary full-time screen (GDA-50).
  endHalf: tap(() => saveThenGoTo(() => endHalf(db, state.gameId, Date.now()), openGame().state === "second half" ? "over" : "halfTime")),
  // The back arrow on Half Time (throws the half-time changes away) or on the temporary full-time screen.
  backToGame: tap(() => saveThenGoTo(() => reopenHalf(db, state.gameId, Date.now()), "game")),
  startSecondHalf: tap(() => saveThenGoTo(() => startSecondHalf(db, state.gameId, Date.now()), "game")),
  fullTime: tap(async () => {
    const gameId = state.gameId;
    await saveThenGoTo(() => fullTime(db, gameId), "saved", FULL_TIME_PROBLEM);
    // One try only, after the game is safely saved. Never waits for it, never retries (GDA-47).
    if (state.games.find((g) => g.id === gameId)?.toSend) {
      sendToSheet(gameId);
    }
  }),
  sendNow: tap((gameId) => sendToSheet(gameId)),
  openSheetSettings: tap(() => goTo("sheetSettings")),
  // ---- Teams (GDA-68) ----
  switchTeam: tap(async (id) => {
    if (!canSwitchTeams(state.games)) {
      return; // Locked while a game is in progress.
    }
    if (id === state.currentTeamId) {
      state.topMenuOpen = false;
      draw();
      return;
    }
    await saveTeamThenHome(() => switchTeam(db, id));
  }),
  openAddTeam: tap(() => {
    if (!canSwitchTeams(state.games)) {
      return;
    }
    state.teamForm = { mode: "add", values: { name: "", size: "9", minutes: "25" }, errors: {} };
    goTo("teamForm");
  }),
  openTeamSettings: tap(() => {
    const team = currentTeam();
    state.teamForm = { mode: "edit", values: { name: team.name, size: String(team.playersPerSide), minutes: String(team.halfMinutes) }, errors: {} };
    goTo("teamForm");
  }),
  saveTeam: tap(() => {
    const typed = { name: document.getElementById("teamName").value, size: document.getElementById("teamSize").value, minutes: document.getElementById("teamMinutes").value };
    const cleaned = cleanTeamForm(typed.name, typed.size, typed.minutes);
    if (!cleaned.ok) {
      state.teamForm = { ...state.teamForm, values: typed, errors: cleaned.errors };
      draw();
      return;
    }
    if (state.teamForm.mode === "add") {
      saveTeamThenHome(() => addTeam(db, cleaned.values));
    } else {
      saveTeamThenHome(() => updateTeam(db, state.currentTeamId, cleaned.values));
    }
  }),
  cancelTeamForm: tap(() => {
    state.teamForm = null;
    goTo("home");
  }),
  askDeleteTeam: tap(() => {
    state.deleteTeamOpen = true;
    draw();
  }),
  cancelDeleteTeam: tap(() => {
    state.deleteTeamOpen = false;
    draw();
  }),
  confirmDeleteTeam: tap(() => {
    if (deleteRefusal(state.teams, state.games)) {
      return;
    }
    saveTeamThenHome(() => deleteTeam(db, state.currentTeamId));
  }),
  saveSheetSettings: tap(async () => {
    const cleaned = cleanSheetSettings(document.getElementById("sheetUrl").value, document.getElementById("sheetSecret").value);
    if (!cleaned.ok) {
      // Keep what was typed, so a message does not wipe the box.
      state.sheetDraft = { url: document.getElementById("sheetUrl").value, secret: document.getElementById("sheetSecret").value };
      state.problem = cleaned.message;
      draw();
      return;
    }
    try {
      await updateTeam(db, state.currentTeamId, { sheet: cleaned.settings }); // Each team has its own.
    } catch (error) {
      console.warn("Could not save the Sheet settings", error);
      state.problem = SAVE_PROBLEM;
      draw();
      return;
    }
    state.sheetSettings = cleaned.settings;
    state.teams = state.teams.map((team) => (team.id === state.currentTeamId ? { ...team, sheet: cleaned.settings } : team));
    state.sheetProblem = {};
    state.problem = "";
    state.sheetSaved = true;
    state.sheetDraft = null;
    draw();
  }),
  openMenu: tap((gameId) => {
    state.topMenuOpen = false;
    state.menuId = state.menuId === gameId ? null : gameId;
    draw();
  }),
  openTopMenu: tap(() => {
    state.menuId = null;
    state.topMenuOpen = !state.topMenuOpen;
    draw();
  }),
  closeMenu: tap(() => {
    state.menuId = null;
    state.topMenuOpen = false;
    draw();
  }),
  askArchive: tap((gameId) => {
    state.menuId = null;
    state.archiveId = gameId;
    draw();
  }),
  cancelArchive: tap(() => {
    state.archiveId = null;
    draw();
  }),
  confirmArchive: tap(() => {
    const gameId = state.archiveId;
    state.archiveId = null;
    saveThenGoTo(() => archiveGame(db, gameId), "home");
  }),
  askDelete: tap((gameId) => {
    state.menuId = null;
    state.deleteId = gameId;
    draw();
  }),
  cancelDelete: tap(() => {
    state.deleteId = null;
    draw();
  }),
  confirmDelete: tap(() => {
    const gameId = state.deleteId;
    state.deleteId = null;
    saveThenGoTo(() => deleteGame(db, gameId), "home");
  }),
  saveFile: tap((gameId) => {
    state.menuId = null; // The menu closes when I choose an item.
    saveFile(gameId);
  }),
  applyUpdate: tap(() => applyUpdate()),
  tryAgain: tap(() => window.location.reload()),
};

// Taps and drags on the line-up's circles. See drag.js.
const presses = watchLineUpPresses({
  canPress: () => (state.screen === "lineUp" || state.screen === "halfTime" || state.screen === "game") && readyForTaps(),
  canDrag: (spot) => canDrag(openGame(), spot),
  canDrop: (playerId, spot) =>
    state.screen === "game"
      ? liveAction(openGame(), playerId, spot) !== null
      : lineUpMoved(openGame(), playerId, spot, state.players) !== null || canReorderBench(openGame(), playerId, spot.playerId),
  tapped(spot) {
    const live = state.screen === "game";
    const outcome = live ? afterTap(openGame(), state.selectedId, spot, canTapLive) : afterTap(openGame(), state.selectedId, spot, (game, id, target) => lineUpMoved(game, id, target, state.players) !== null);
    state.problem = "";
    if (outcome.move) {
      live ? saveLive(state.selectedId, spot) : saveMove(state.selectedId, spot);
    } else {
      state.selectedId = outcome.selectedId;
      draw();
    }
  },
  dragStarted() {
    state.selectedId = null;
    state.problem = "";
    // The game screen is not redrawn here: that would remove the circle under the finger.
    if (state.screen === "lineUp") {
      drawLineUpActions(state, actions);
    }
  },
  dropped(playerId, spot) {
    if (state.screen === "game") {
      spot ? saveLive(playerId, spot) : draw();
    } else if (spot && canReorderBench(openGame(), playerId, spot.playerId)) {
      saveBenchMove(playerId, spot.playerId);
    } else if (spot) {
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

/** START 1ST HALF. The game screen appears only after the start time is safely saved. */
async function startGame() {
  saving = true;
  try {
    await startFirstHalf(db, state.gameId, Date.now());
    state.games = await gamesNow();
  } catch (error) {
    console.warn("Could not start the game", error);
    saving = false;
    state.problem = SAVE_PROBLEM;
    draw();
    return;
  }
  saving = false;
  goTo("game");
}

/**
 * End Half, its back arrow and Finish test game: save, read back, then show the
 * next screen. The screen changes only once the change is safely stored, so the
 * clock cannot show one thing while the saved game says another.
 */
async function saveThenGoTo(saveChange, screen, problem = SAVE_PROBLEM) {
  saving = true;
  try {
    await saveChange();
    state.games = await gamesNow();
  } catch (error) {
    console.warn("Could not save", error);
    saving = false;
    state.problem = problem;
    draw();
    return;
  }
  saving = false;
  goTo(screen);
}

/**
 * Sends one finished game to the season Sheet. It counts as sent only when Google's reply
 * says so, and only then is it marked in the saved game. A second tap while sending is
 * ignored. Sending the same game again is safe: the script knows the game ID.
 */
async function sendToSheet(gameId) {
  const game = state.games.find((g) => g.id === gameId);
  // A game is sent with its own team's address and secret.
  const sheet = sheetOf(state.teams.find((team) => team.id === (game?.teamId ?? state.firstTeamId)), state.legacySheet, state.firstTeamId);
  if (!game || state.sendingId || !canSend(game, sheet)) {
    return;
  }
  state.sendingId = gameId;
  delete state.sheetProblem[gameId];
  draw();
  const result = await sendGameToSheet(sheet, game);
  state.sendingId = null;
  if (result.ok) {
    try {
      await markSentToSheet(db, gameId);
      state.games = await gamesNow();
    } catch (error) {
      console.warn("Could not mark the game as sent", error);
    }
  } else if (result.reason === "secret") {
    state.sheetProblem[gameId] = "secret";
  }
  // Only Home shows the Sheet status, so only redraw if we are there.
  if (state.screen === "home") {
    draw();
  }
}

/**
 * Save file (Saved screen and Home): the CSV for one finished game, from its stored
 * record, through the phone's share / save panel. A failure never touches the game.
 */
async function saveFile(gameId) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game?.record) {
    return;
  }
  state.fileProblemFor = null;
  try {
    await shareCsv(recordToCsv(game.record), csvFileName(game.record));
  } catch (error) {
    console.warn("Could not save the file", error);
    state.fileProblemFor = gameId;
  }
  draw();
}

/** A new version may be noticed at any moment. Only Home shows it, so only Home redraws. */
function onUpdateNews() {
  if (state.screen === "home") {
    draw();
  }
}

/**
 * GDA-33: a game under way opens straight back into the game (or the half-over
 * screen if End Half was saved). Home and Squad are not shown until the game is
 * closed. A game whose saved data cannot be shown falls back to Home so Ben is
 * never stuck on a broken screen.
 */
function resumeGameIfAny() {
  const resume = gameToResume(state.games);
  if (!resume || !resume.ok) {
    return;
  }
  state.gameId = resume.game.id;
  state.screen = resume.screen;
  if (resume.screen === "game") {
    state.welcome = true;
    // "Welcome back" goes after 5 seconds or at the first tap.
    setTimeout(hideWelcome, WELCOME_MS);
    document.addEventListener("pointerdown", hideWelcome, { once: true, capture: true });
  }
}

function hideWelcome() {
  state.welcome = false;
  document.getElementById("welcome")?.remove();
}

async function start() {
  document.documentElement.dataset.version = self.GAMEDAY_VERSION;
  try {
    db = await openDatabase(self.GAMEDAY_CONFIG.storageName);
    state.legacySheet = (await getMeta(db, SETTINGS_KEY)) ?? null;
    await loadEverything();
    resumeGameIfAny();
    draw();
  } catch (error) {
    if (error.upgradeFailed) {
      // The upgrade was undone, so the saved data is as it was. Say so on Home.
      state.upgradeFailed = true;
      state.screen = "home";
      draw();
      db = null;
    } else {
      showCannotOpen(error);
    }
  }
  // Neither of these may hold up or stop the app.
  startUpdates(onUpdateNews);
  if (db) {
    askToKeepDataOnce(db);
  }
}

// The clock is worked out from the saved start time each time it is drawn, so a
// locked phone cannot make it wrong. These only keep the number moving, and bring
// it right the moment the app comes back to the front.
setInterval(() => drawClock(state), 250);
document.addEventListener("visibilitychange", () => drawClock(state));
window.addEventListener("pageshow", () => drawClock(state));
// GDA-80: the planned-swap lines follow the circles when the window changes size or turns.
window.addEventListener("resize", () => drawPairLines(state));

start();
