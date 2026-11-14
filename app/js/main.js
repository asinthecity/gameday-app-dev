// Starts the app and holds what is on screen. The order for every change is:
// save it, read the saved data back, then draw. So the screen only ever shows
// what is really stored.

import { getMeta, openDatabase } from "./db.js";
import { watchLineUpPresses } from "./drag.js";
import { sortAfterTap } from "./interchange-rules.js";
import { NO_SWIPE_START, POPUP_OPEN, swipeOf } from "./swipe-rules.js";
import {
  afterTap,
  blankGameForm,
  canCreateGame,
  canDrag,
  canReorderBench,
  canTapLive,
  canAddGoal,
  canEditNotes,
  HOLD_MS,
  noteOf,
  potdOf,
  withNote,
  withPotd,
  lastGoal,
  THEM,
  US,
  clampRotation,
  liveAction,
  markedAbsent,
  markedBackIn,
  movedOnto,
  lineUpMoved,
  planMoved,
  planView,
  needsPrePlacing,
  halfOf,
  formationRowHalf,
  withFormation,
  NOT_STARTED,
  FINISHED,
  gameToResume,
  screenForOpening,
  phaseOf,
  backScreen,
  nextScreen,
  IN_PROGRESS_PHASE,
  NOT_STARTED_PHASE,
  withRotation,
  withCarryOver,
  carriesRotationOrder,
  carriesBenchTime,
  withVenue,
  hereDifferences,
} from "./game-rules.js";
import { loadGameEvents, archiveGame, deleteGame, markSentToSheet, addGame, addGoal, removeGoal, changeGame, endHalf, fullTime, loadGames, moveFieldPlayer, movePlan, movePlayer, planPair, prePlaceGame, reopenHalf, reorderBench, reorderPlanBench, startFirstHalf, startSecondHalf, undoKickOff, swapPlayers, toggleHere, undoSwap, unplanPair } from "./game-store.js";
import { canSend, checkMessage, parseSetupCode, SETTINGS_KEY, sheetTabOf } from "./sheet-rules.js";
import { checkSheetConnection, sendGameToSheet } from "./sheet-send.js";
import { shareCsv } from "./share-file.js";
import { askToKeepDataOnce } from "./persistence.js";
import { drawClock, drawLineUpActions, drawPairLines, drawScreen, screenHalf, setLogos, setPhotos, startScoreFlash } from "./screens.js";
import { shrinkPhoto } from "./photo-image.js";
import { PHOTO_PROBLEM } from "./photo-rules.js";
import { loadPhotos, removePhoto, savePhoto } from "./photo-store.js";
import { loadLogos, removeLogo, saveLogo } from "./logo-store.js";
import { csvFileName, recordToCsv } from "./record-rules.js";
import { cleanName } from "./squad-rules.js";
import { addPlayer, loadSquad, removePlayer, renamePlayer } from "./squad-store.js";
import { fitsTeam, startingFormation } from "./formation-rules.js";
import { addTeam, deleteTeam, loadTeams, switchTeam, updateTeam } from "./team-store.js";
import { rememberFirstTeamId, canSwitchTeams, cleanTeamForm, deleteRefusal, firstTeamIdOf, sheetOf } from "./team-rules.js";
import { applyUpdate, currentUpdateNotice, startUpdates } from "./updates.js";

const SAVE_PROBLEM = "That did not save. Please try again.";
const FULL_TIME_PROBLEM = "Not saved. The game is still open. Tap End game and save to try again.";
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
  viewId: null, // GDA-100: the finished game being looked at from Home. Never saved; gameId (a game in progress) is not touched.
  selectedId: null, // The player selected on the line-up. Never saved.
  editId: null,
  photos: {}, // playerId -> small photo, kept on this phone only (GDA-52).
  logos: {}, // teamId -> small logo, kept on this phone only (GDA-126).
  addCameFrom: "home",
  showRemoveWarning: false,
  hereDraft: null, // GDA-43: the Who is here picker's unsaved draft (a Set of player ids), or null when closed.
  undoKickOffAsk: false, // Undo kick-off confirm showing in the Game details sheet.
  rotationOpen: false, // The rotation stepper sheet on the ready and game screens.
  goalOpen: false, // The "Who scored?" dialog (GDA-90).
  interchange: null, // GDA-121: { events } read when Interchange history opens. Never saved.
  interchangeBack: null, // The screen Interchange history returns to. Never saved.
  tallySort: { column: "name", descending: false }, // The bench time table's sort. Not remembered.
  summaryBack: null, // The game screen the mid-game Summary returns to (GDA-108). Never saved.
  noteFor: null, // The player whose hold sheet is open (GDA-81), or null. Never saved.
  noteDraft: null, // What is typed in the note box, until Done (null = not typed yet). Never saved.
  potdOpen: false, // The Player of the day picker (GDA-110). Never saved.
  undo: null, // After Swap, for about 5 seconds: { before, eventId, until }. Never saved.
  problem: "",
  fileProblemFor: null, // The finished game whose Save file just failed.
  teams: [], // Every team, oldest first (GDA-68).
  currentTeamId: null, // The team Home, Squad and Sheet settings show.
  firstTeamId: null, // What a record with no team ID belongs to.
  legacySheet: null, // The old shared Sheet setting, read only for the first team if it has none.
  teamForm: null, // The Add / Team settings form: { mode, values, errors }. Never saved until Save.
  deleteTeamOpen: false, // The "Delete team?" confirm. Never saved.
  sheetSettings: null, // { url, secret, setup: 2 } of the CURRENT team. Stored only on this phone.
  sheetDraft: null, // What is typed on Sheet settings when a message is shown. Never saved.
  sheetResult: null, // { ok, text }: the connection message on the Sheet settings screen. Never saved.
  sendingId: null, // The game being sent to the Sheet right now. Never saved.
  sheetProblem: {}, // gameId -> "secret" after the script refused the secret. Never saved.
  menuId: null, // The game whose ⋯ menu is open. Never saved.
  topMenuOpen: false, // The ☰ menu on Home. Never saved.
  fullTimeAsk: false, // "End the game?" is showing on Full Time. Never saved.
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
  state.logos = await loadLogos(db);
  setLogos(state.logos);
  state.games = await gamesNow();
  state.sheetSettings = sheetOf(currentTeam(), state.legacySheet, state.firstTeamId);
}

const LOGO_PROBLEM = "Couldn't save the logo";

/** Writes the form's logo choice for a team that is already saved. Finishes with a message if it failed, else nothing. */
async function applyLogo(teamId, logo) {
  if (logo === undefined) {
    return null;
  }
  try {
    await (logo === null ? removeLogo(db, teamId) : saveLogo(db, teamId, logo));
    return null;
  } catch (error) {
    console.warn("Logo not saved", error);
    return LOGO_PROBLEM;
  }
}

/** Redraws the team form after a logo change, keeping what was typed in the name box. */
function drawKeepingTypedTeamName() {
  const box = document.getElementById("teamName");
  if (box) {
    state.teamForm.values.name = box.value;
  }
  draw();
}

/** Saves a team change, reloads everything, then shows Home. A failed save shows a message and keeps the form. */
async function saveTeamThenHome(save) {
  saving = true;
  try {
    // save() may finish with a plain message (a logo that could not be saved after the team was).
    const logoProblem = await save();
    await loadEverything();
    saving = false;
    if (logoProblem) {
      // The team is saved; stay on its settings so the coach sees why the logo is not there.
      const team = currentTeam();
      state.teamForm = { mode: "edit", values: { name: team.name, size: String(team.playersPerSide), minutes: String(team.halfMinutes) }, errors: {} };
      state.problem = logoProblem;
      draw();
      return;
    }
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
  if (screen === "home") {
    state.viewId = null; // Leaving a finished game's view.
  }
  state.problem = "";
  state.showRemoveWarning = false;
  state.rotationOpen = false;
  state.undoKickOffAsk = false;
  state.hereDraft = null;
  state.selectedId = null;
  state.undo = null;
  state.goalOpen = false;
  state.noteFor = null;
  state.noteDraft = null;
  state.potdOpen = false;
  state.fileProblemFor = null;
  state.sheetResult = null;
  state.sheetDraft = null;
  state.deleteId = null;
  state.menuId = null;
  state.topMenuOpen = false;
  state.archiveId = null;
  state.fullTimeAsk = false;
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
    // GDA-127: a different shape typed on the form becomes the team's last-used shape.
    const team = currentTeam();
    const chosen = state.form.formation;
    if (chosen && chosen !== team.formation && fitsTeam(chosen, team.playersPerSide)) {
      await updateTeam(db, team.id, { formation: chosen });
      state.teams = state.teams.map((t) => (t.id === team.id ? { ...t, formation: chosen } : t));
    }
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
      if (isLiveScreen() && !presses.isActive()) {
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
 * A goal: saved first, shown after (the score is counted from the saved goals). The dialog closes.
 * `scorerId` is a player id, or null for a goal against and for "Own goal".
 */
async function saveGoal(side, scorerId) {
  const game = openGame();
  state.goalOpen = false;
  if (!game || !canAddGoal(game)) {
    draw();
    return;
  }
  const goal = { id: crypto.randomUUID(), side, scorerId, at: Date.now() }; // `at` gives the minute within the half (GDA-82)
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
  ignoreTapsUntil = Date.now() + TAP_PAUSE_MS; // A double tap must not land on whatever is under the closed dialog.
  startScoreFlash();
  draw();
}

/** Undo last goal: saves the removal, closes the dialog, then draws the corrected score. */
async function saveGoalRemoval(goalId) {
  state.goalOpen = false;
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
  ignoreTapsUntil = Date.now() + TAP_PAUSE_MS; // A double tap on Undo removes one goal only.
  startScoreFlash();
  draw();
}

/** Saves a change to the open game (notes, Player of the day), then redraws. Gives false (and a message) if it did not save. */
async function saveGameChange(change) {
  saving = true;
  try {
    await changeGame(db, state.gameId, change);
    state.games = await gamesNow();
  } catch (error) {
    console.warn("Change did not save", error);
    saving = false;
    state.problem = SAVE_PROBLEM;
    draw();
    return false;
  }
  saving = false;
  state.problem = "";
  draw();
  return true;
}

function saveBenchMove(playerId, targetId) {
  return saveThenShowLineUp(() => reorderBench(db, state.gameId, playerId, targetId));
}

/** The current value of a GDA-86 switch. */
function carryValue(game, which) {
  return which === "carryRotationOrder" ? carriesRotationOrder(game) : carriesBenchTime(game);
}

function openGame() {
  return state.games.find((game) => game.id === (state.viewId ?? state.gameId));
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
    state.form.playersPerSide = currentTeam().playersPerSide;
    state.form.formation = startingFormation(currentTeam()); // GDA-127
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
  // The ‹ and › arrows (GDA-95). They only change which screen is shown: nothing is saved, and the
  // clock, swap alert and bench timers (all worked out from saved times) carry on underneath.
  // GDA-100: open a finished game for looking. It starts on 1st Half; ‹ there goes back to Home. Nothing is written.
  viewGame: tap((gameId) => {
    const game = state.games.find((g) => g.id === gameId);
    if (!game || !game.record || game.archived) {
      return;
    }
    state.viewId = gameId;
    goTo("half1");
  }),
  goBack: tap(() => {
    const to = state.viewId && state.screen === "half1" ? "home" : backScreen(state.screen);
    if (to) {
      goTo(to);
    }
  }),
  goNext: tap(() => {
    const to = openGame() ? nextScreen(openGame(), state.screen) : null;
    if (to) {
      goTo(to);
    }
  }),
  openRotation: tap(() => {
    state.rotationOpen = true;
    draw();
  }),
  // GDA-106: a new minutes or seconds choice is saved at once (NFR-2). The clock and timers keep running underneath.
  setRotation: (minutes, extraSeconds) => {
    const id = state.gameId;
    changeGame(db, id, (game) => withRotation(game, minutes, extraSeconds))
      .then(() => gamesNow())
      .then((games) => {
        state.games = games;
        drawClock(state);
      })
      .catch((error) => console.warn("Could not save the rotation length", error));
    // Show the new length straight away; the save follows within milliseconds.
    state.games = state.games.map((game) => (game.id === id ? withRotation(game, minutes, extraSeconds) : game));
    drawClock(state);
  },
  // GDA-86: a carry-over switch. On New game it only changes the form; on a saved game it is saved at once,
  // and only while the 2nd half has not started (a locked game comes back unchanged).
  toggleCarryOver: (which) => {
    const game = state.form ? null : openGame();
    if (state.form) {
      state.form[which] = !state.form[which];
      draw();
      return;
    }
    if (!game) {
      return;
    }
    state.games = state.games.map((g) => (g.id === game.id ? withCarryOver(g, which, !carryValue(g, which)) : g));
    draw();
    changeGame(db, game.id, (g) => withCarryOver(g, which, !carryValue(game, which))).catch((error) => console.warn("Could not save the choice", error));
  },
  // GDA-88: the Home / Away / Other tag or the Field text, saved at once from the Game details sheet.
  changeVenue: (change) => {
    const game = openGame();
    if (!game || game.state === FINISHED) {
      return; // Not offered after Full Time.
    }
    state.games = state.games.map((g) => (g.id === game.id ? withVenue(g, change) : g));
    changeGame(db, game.id, (g) => (g.state === FINISHED ? g : withVenue(g, change)))
      .catch((error) => console.warn("Could not save the venue", error));
  },
  // GDA-22, GDA-127: a valid typed shape for the next half to be played (see formationRowHalf). Same places, so
  // nobody moves. It is also the team's last-used shape. A stale screen (row now read-only) changes nothing.
  setFormation: (formation) => {
    const game = openGame();
    if (!game || formationRowHalf(game) === null) {
      return;
    }
    state.games = state.games.map((g) => (g.id === game.id ? withFormation(g, formation) : g));
    let applied = false;
    changeGame(db, game.id, (g) => {
      applied = formationRowHalf(g) !== null;
      return withFormation(g, formation);
    })
      .then(() => (applied ? updateTeam(db, state.currentTeamId, { formation }) : null))
      .then(() => {
        if (applied) {
          state.teams = state.teams.map((team) => (team.id === state.currentTeamId ? { ...team, formation } : team));
        }
      })
      .catch((error) => console.warn("Could not save the formation", error));
  },
  // GDA-98: Undo kick-off asks first; Keep playing changes nothing.
  askUndoKickOff: tap(() => {
    state.undoKickOffAsk = true;
    draw();
  }),
  keepPlaying: tap(() => {
    state.undoKickOffAsk = false;
    draw();
  }),
  confirmUndoKickOff: tap(async () => {
    const half = screenHalf(state.screen);
    state.undoKickOffAsk = false;
    // Saved first (all or nothing); a screen that is out of date changes nothing. Then the screen the saved game opens on.
    await saveThenGoTo(() => undoKickOff(db, state.gameId, half), state.screen);
  }),
  closeRotation: tap(() => {
    state.rotationOpen = false;
    state.undoKickOffAsk = false;
    state.hereDraft = null;
    draw();
  }),
  // GDA-43 picker: the draft is the set of players ticked as here. Nothing is saved until Done.
  openHere: tap(() => {
    const game = openGame();
    state.hereDraft = new Set(state.players.filter((p) => !game.absent.includes(p.id)).map((p) => p.id));
    draw();
  }),
  toggleHereDraft: (playerId) => {
    if (!state.hereDraft) {
      return;
    }
    const grid = document.querySelector(".pgrid");
    const scrolled = grid ? grid.scrollTop : 0;
    state.hereDraft.has(playerId) ? state.hereDraft.delete(playerId) : state.hereDraft.add(playerId);
    draw();
    const again = document.querySelector(".pgrid"); // draw() rebuilds the grid; keep its scroll place
    if (again) {
      again.scrollTop = scrolled;
    }
  },
  cancelHere: tap(() => {
    state.hereDraft = null;
    draw();
  }),
  // Done: each changed player goes through the same toggleHere rules, then back to the Game details sheet.
  doneHere: tap(async () => {
    const draft = state.hereDraft;
    state.hereDraft = null;
    try {
      const ids = hereDifferences(openGame(), state.players.map((p) => p.id), draft);
      for (const id of ids) {
        await toggleHere(db, state.gameId, id, Date.now());
        state.games = await gamesNow();
      }
      if (ids.length > 0) {
        state.undo = null; // A Swap's Undo would put the old line-up back over this change.
        state.selectedId = null;
      }
      state.problem = "";
    } catch (error) {
      console.warn("Who is here did not save", error);
      state.games = await gamesNow();
      state.problem = SAVE_PROBLEM;
    }
    draw();
  }),
  startFirstHalf: tap(() => {
    // The button under a selected player is Absent / Back in, which pauses briefly after it changes (see saveSelectedPlayer).
    if (Date.now() >= ignoreReadyUntil) {
      startGame();
    }
  }),
  swap: tap(() => saveSwap()),
  // GDA-90: the score header opens "Who scored?" while a half runs and at Half Time.
  openGoalDialog: tap(() => {
    if (canAddGoal(openGame())) {
      state.goalOpen = true;
      draw();
    }
  }),
  chooseScorer: tap((playerId) => saveGoal(US, playerId)),
  closeGoalDialog: tap(() => {
    state.goalOpen = false;
    draw();
  }),
  goalAgainst: tap(() => saveGoal(THEM, null)),
  // GDA-91: removes the newest goal (either side); the dialog closes.
  undoLastGoal: tap(() => {
    const goal = lastGoal(openGame());
    if (goal && canAddGoal(openGame())) {
      saveGoalRemoval(goal.id);
    }
  }),
  // GDA-108: the Summary opens from "Who scored?" (which closes); Back returns to the game. Nothing is paused or saved.
  openSummary: tap(() => {
    state.summaryBack = state.screen;
    goTo("summary");
  }),
  closeSummary: tap(() => goTo(state.summaryBack ?? "half1")),
  // GDA-121: Interchange history. Reads the saved swaps once when it opens; nothing is saved. Back returns to the screen it came from.
  openInterchange: tap(async () => {
    const id = state.viewId ?? state.gameId;
    try {
      const events = await loadGameEvents(db, id);
      state.interchangeBack = state.screen;
      state.interchange = { events };
      state.tallySort = { column: "name", descending: false };
      goTo("interchange");
    } catch (error) {
      console.warn("Could not read the swaps", error);
      state.problem = "Could not open the interchange history. Try again.";
      draw();
    }
  }),
  closeInterchange: tap(() => goTo(state.interchangeBack ?? "half1")),
  sortTally: tap((column) => {
    state.tallySort = sortAfterTap(state.tallySort, column);
    draw();
  }),
  // GDA-81: the hold sheet. The note is saved when Done is tapped (typing alone changes nothing stored).
  noteTyped: (text) => {
    state.noteDraft = text;
  },
  closeNote: tap(async () => {
    const playerId = state.noteFor;
    const text = state.noteDraft;
    if (text !== null && !(await saveGameChange((game) => withNote(game, playerId, text)))) {
      return; // Not saved: the sheet stays open with a message and the typed text.
    }
    state.noteFor = null;
    state.noteDraft = null;
    state.problem = "";
    draw();
  }),
  // GDA-110: the switch in the hold sheet and the tiles in the picker. Each change is saved at once.
  setPotd: (playerId, on) => {
    if (readyForTaps()) {
      saveGameChange((game) => withPotd(game, playerId, on));
    }
  },
  openPotdPicker: tap(() => {
    state.potdOpen = true;
    draw();
  }),
  closePotdPicker: tap(() => {
    state.potdOpen = false;
    draw();
  }),
  pickPotd: tap(async (playerId) => {
    state.potdOpen = false;
    await saveGameChange((game) => withPotd(game, playerId, potdOf(game) !== playerId)); // The chosen player's tile again clears it.
  }),
  undo: tap(() => saveUndo()),
  unpair: tap((benchId) => {
    state.undo = null;
    saveThenShowLineUp(() => unplanPair(db, state.gameId, benchId));
  }),
  // End Half stays on the same screen, which now shows that half Ended. `half` is the half the screen
  // shows: the save checks the saved game still agrees, so an out-of-date screen does nothing wrong.
  endHalf: tap(() => {
    const half = screenHalf(state.screen);
    saveThenGoTo(() => endHalf(db, state.gameId, Date.now(), half), state.screen);
  }),
  // Resume half: the Ended half runs again (only while the next half has not started).
  resumeHalf: tap(() => {
    const half = screenHalf(state.screen);
    saveThenGoTo(() => reopenHalf(db, state.gameId, Date.now(), half), state.screen);
  }),
  startSecondHalf: tap(() => saveThenGoTo(() => startSecondHalf(db, state.gameId, Date.now()), "half2")),
  askFullTime: tap(() => {
    state.fullTimeAsk = true;
    draw();
  }),
  cancelFullTime: tap(() => {
    state.fullTimeAsk = false;
    draw();
  }),
  fullTime: tap(async () => {
    state.fullTimeAsk = false;
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
  // Logo (GDA-126): the picture is held in the form and saved with the team when Save is tapped.
  logoPicked: async (file) => {
    if (!file || saving) {
      return; // The picker was cancelled: nothing changes.
    }
    try {
      state.teamForm.logo = await shrinkPhoto(file);
      state.problem = "";
    } catch (error) {
      console.warn("Logo not read", error);
      state.problem = LOGO_PROBLEM;
    }
    drawKeepingTypedTeamName();
  },
  removeLogo: tap(() => {
    state.teamForm.logo = null;
    drawKeepingTypedTeamName();
  }),
  saveTeam: tap(() => {
    // Size and half length are steppers, so their values are already in the form (name is the only text box).
    const typed = { name: document.getElementById("teamName").value, size: state.teamForm.values.size, minutes: state.teamForm.values.minutes };
    const cleaned = cleanTeamForm(typed.name, typed.size, typed.minutes);
    if (!cleaned.ok) {
      state.teamForm = { ...state.teamForm, values: typed, errors: cleaned.errors };
      draw();
      return;
    }
    const logo = state.teamForm.logo; // undefined = unchanged, a picture, or null = remove
    if (state.teamForm.mode === "add") {
      saveTeamThenHome(async () => applyLogo(await addTeam(db, cleaned.values), logo));
    } else {
      saveTeamThenHome(async () => {
        await updateTeam(db, state.currentTeamId, cleaned.values);
        return applyLogo(state.currentTeamId, logo);
      });
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
    const typed = document.getElementById("sheetCode").value;
    const parsed = parseSetupCode(typed);
    state.sheetResult = null;
    if (!parsed.ok) {
      // Keep what was typed, so a message does not wipe the box. Nothing is stored.
      state.sheetDraft = typed;
      state.problem = parsed.message;
      draw();
      return;
    }
    const settings = { ...parsed.settings, setup: 2 }; // setup 2 = saved from a GDA-89 setup code.
    try {
      await updateTeam(db, state.currentTeamId, { sheet: settings }); // Each team has its own.
    } catch (error) {
      console.warn("Could not save the Sheet settings", error);
      state.problem = SAVE_PROBLEM;
      draw();
      return;
    }
    state.sheetSettings = settings;
    state.teams = state.teams.map((team) => (team.id === state.currentTeamId ? { ...team, sheet: settings } : team));
    state.sheetProblem = {};
    state.problem = "";
    state.sheetDraft = null;
    state.sheetResult = { ok: true, text: "Checking the connection..." };
    draw();
    // The check writes no row. Whatever it says, the code stays saved.
    const kind = await checkSheetConnection(settings);
    if (state.screen === "sheetSettings") {
      state.sheetResult = { ok: kind === "connected", text: checkMessage(kind, sheetTabOf(self.GAMEDAY_CONFIG)) };
      draw();
    }
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

// Which way the circles on the current screen work (GDA-95):
//   "live"  - a half In progress: plan a swap pair, move a field player, re-order the bench.
//   "edit"  - the 1st half before kick-off.
//   "plan"  - the 2nd half Not started (GDA-97): the 2nd-half plan, from before kick-off until Start 2nd half.
//   null    - nothing to move (Ended halves).
function circleMode() {
  const half = screenHalf(state.screen);
  const game = half === 0 ? null : openGame();
  if (!game) {
    return null;
  }
  const phase = phaseOf(game, half);
  if (phase === IN_PROGRESS_PHASE) {
    return "live";
  }
  if (phase !== NOT_STARTED_PHASE) {
    return null;
  }
  return half === 1 ? "edit" : "plan";
}
const isLiveScreen = () => circleMode() === "live";

// Taps and drags on the line-up's circles. See drag.js.
// On the plan the rules run on the plan view (GDA-97), so they never touch the running half.
const onPlan = () => circleMode() === "plan";
const ruleGame = () => (onPlan() ? planView(openGame(), state.players) : openGame());
const canMoveOnLineUp = (game, id, spot) => (onPlan() ? planMoved(openGame(), id, spot, state.players) !== null : lineUpMoved(game, id, spot, state.players) !== null);
function saveEdit(playerId, spot) {
  return onPlan() ? saveThenShowLineUp(() => movePlan(db, state.gameId, playerId, spot)) : saveMove(playerId, spot);
}
function saveEditBench(playerId, targetId) {
  return onPlan() ? saveThenShowLineUp(() => reorderPlanBench(db, state.gameId, playerId, targetId)) : saveBenchMove(playerId, targetId);
}
const presses = watchLineUpPresses({
  // GDA-81: press and hold on a circle (any game screen, from kick-off until End game and save; not a viewed game).
  holdMs: HOLD_MS,
  canHold: () => readyForTaps() && screenHalf(state.screen) !== 0 && !state.viewId && state.noteFor === null && canEditNotes(openGame()),
  held(spot) {
    state.selectedId = null;
    state.noteFor = spot.playerId;
    state.noteDraft = null;
    state.problem = "";
    draw();
  },
  canPress: () => circleMode() !== null && readyForTaps(),
  canDrag: (spot) => canDrag(ruleGame(), spot),
  canDrop: (playerId, spot) =>
    isLiveScreen() ? liveAction(openGame(), playerId, spot) !== null : canMoveOnLineUp(openGame(), playerId, spot) || canReorderBench(ruleGame(), playerId, spot.playerId),
  tapped(spot) {
    const live = isLiveScreen();
    const outcome = live ? afterTap(openGame(), state.selectedId, spot, canTapLive) : afterTap(ruleGame(), state.selectedId, spot, canMoveOnLineUp);
    state.problem = "";
    if (outcome.move) {
      live ? saveLive(state.selectedId, spot) : saveEdit(state.selectedId, spot);
    } else {
      state.selectedId = outcome.selectedId;
      draw();
    }
  },
  dragStarted() {
    state.selectedId = null;
    state.problem = "";
    // The live screen is not redrawn here: that would remove the circle under the finger.
    if (state.screen === "half1" && !isLiveScreen()) {
      drawLineUpActions(state, actions);
    }
  },
  dropped(playerId, spot) {
    if (isLiveScreen()) {
      spot ? saveLive(playerId, spot) : draw();
    } else if (spot && canReorderBench(ruleGame(), playerId, spot.playerId)) {
      saveEditBench(playerId, spot.playerId);
    } else if (spot) {
      saveEdit(playerId, spot);
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

/** Start 1st half. The running half appears only after the start time is safely saved. */
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
  goTo("half1");
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
 * GDA-33: a game under way opens straight back to the right screen for its saved state (GDA-95:
 * 1st Half, 2nd Half or Full Time). Home and Squad are not shown until the game is
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

// GDA-122: swipe left or right to move between the game screens, exactly as the › and ‹ arrows do.
// Decided when the finger lifts. Touch events (not pointer events) so it never interferes with drag.js,
// which owns every press that starts on a circle. A swipe saves nothing: it calls the same actions as the arrows.
const SWIPE_SCREENS = ["newGame", "half1", "half2", "fullTime"];
let swipeStart = null; // Where the one finger went down, or null when this touch cannot be a swipe.
document.addEventListener("touchstart", (event) => {
  const blocked = event.touches.length !== 1 || !SWIPE_SCREENS.includes(state.screen) || event.target.closest(NO_SWIPE_START) || document.querySelector(POPUP_OPEN);
  swipeStart = blocked ? null : { x: event.touches[0].clientX, y: event.touches[0].clientY };
}, { passive: true });
document.addEventListener("touchmove", (event) => {
  if (event.touches.length > 1) {
    swipeStart = null; // A second finger joined: not a swipe.
  }
}, { passive: true });
document.addEventListener("touchcancel", () => { swipeStart = null; }, { passive: true });
document.addEventListener("touchend", (event) => {
  const from = swipeStart;
  swipeStart = null;
  const lift = event.changedTouches[0];
  const way = from && event.touches.length === 0 && !presses.isActive() && !document.querySelector(POPUP_OPEN) ? swipeOf(lift.clientX - from.x, lift.clientY - from.y) : null;
  if (!way) {
    return;
  }
  const before = state.screen;
  if (way === "next") {
    actions.goNext();
  } else {
    actions.goBack();
  }
  if (state.screen !== before) {
    // Slide the new screen in from the side the finger moved towards. Restarting the animation needs a reflow.
    const screen = document.getElementById("screen");
    screen.classList.remove("slideFromRight", "slideFromLeft");
    void screen.offsetWidth;
    screen.classList.add(way === "next" ? "slideFromRight" : "slideFromLeft");
  }
}, { passive: true });

start();
