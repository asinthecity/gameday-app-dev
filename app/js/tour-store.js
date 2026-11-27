// The App tour's saving (GDA-212): the first-open decision, making the Demo team, and the "seen" marks.
//
// The Demo team is made ONLY with the app's own team, player and game functions (no demo-only data paths),
// so it follows every rule a real team does. Each step is its own saved change, as everywhere else, so a failure
// part-way is undone here by deleting the half-made team (deleteTeam removes a team with all its records at once).

import { getMeta, read, setMeta } from "./db.js";
import { addGame, addGoal, changeGame, endHalf, fullTime, startFirstHalf, startSecondHalf } from "./game-store.js";
import { withPotd } from "./game-rules.js";
import { addPlayer, loadSquad } from "./squad-store.js";
import { addTeam, deleteTeam, loadTeams } from "./team-store.js";
import { newGameFormFor, teamValuesToSave } from "./team-rules.js";
import { cleanSeen, DEMO_PLAYERS, DEMO_TEAM, demoFinishedPlan, demoGames, demoTeamExists, isFreshInstall, SEEN_KEY, TOUR_FLAG } from "./tour-rules.js";

/** Reads what the fresh-install rule needs, in ONE read: every team, player and game record, and the flag. */
function readFacts(db) {
  return read(db, ["teams", "players", "games", "meta"], (tx, answer) => {
    const facts = {};
    let waiting = 4;
    const done = () => {
      waiting -= 1;
      if (waiting === 0) {
        answer(facts);
      }
    };
    for (const [store, key] of [["teams", "teams"], ["players", "players"], ["games", "games"]]) {
      tx.objectStore(store).getAll().onsuccess = (found) => {
        facts[key] = found.target.result;
        done();
      };
    }
    tx.objectStore("meta").get(TOUR_FLAG).onsuccess = (found) => {
      facts.flag = found.target.result?.value;
      done();
    };
  });
}

/**
 * Makes the Demo team, its squad of 12, a ready game v "Sample FC" and a finished game v "Example United"
 * (won 3-2, with goals, minutes and a Player of the day). The Demo team becomes the current team (addTeam does it).
 * If any step fails, the half-made team is deleted and the error is thrown: nothing half-made is left.
 */
export async function createDemoTeam(db, now = new Date()) {
  let teamId = null;
  try {
    teamId = await addTeam(db, teamValuesToSave({ name: DEMO_TEAM.name, playersPerSide: DEMO_TEAM.playersPerSide, halfMinutes: DEMO_TEAM.halfMinutes }, null, null));
    const { teams, firstTeamId } = await loadTeams(db);
    const team = teams.find((candidate) => candidate.id === teamId);
    for (const name of DEMO_PLAYERS) {
      await addPlayer(db, name, teamId, firstTeamId);
    }
    const squad = await loadSquad(db, teamId, firstTeamId);
    const games = demoGames(now);

    // The finished game, played a week ago: kick-off, goals, half time, 2nd half, Full Time.
    const plan = demoFinishedPlan(games.kickOffAt, team.halfMinutes);
    const finishedId = await addGame(db, { ...newGameFormFor(team), ...games.finished }, team, firstTeamId);
    await startFirstHalf(db, finishedId, plan.firstHalfStart);
    const addGoals = async (half) => {
      for (const goal of plan.goals.filter((g) => g.half === half)) {
        const scorerId = goal.scorer === null ? null : squad[goal.scorer].id;
        await addGoal(db, finishedId, { id: crypto.randomUUID(), side: goal.side, scorerId, at: goal.at });
      }
    };
    await addGoals(1);
    await endHalf(db, finishedId, plan.firstHalfEnd);
    await startSecondHalf(db, finishedId, plan.secondHalfStart);
    await addGoals(2);
    await endHalf(db, finishedId, plan.secondHalfEnd);
    await changeGame(db, finishedId, (game) => withPotd(game, squad[plan.potd].id, true));
    await fullTime(db, finishedId);

    // The ready game: today, line-up set by the game's own pre-placing (9 on the pitch, 3 on the bench).
    await addGame(db, { ...newGameFormFor(team), ...games.ready }, team, firstTeamId);
    return teamId;
  } catch (error) {
    if (teamId !== null) {
      try {
        await deleteTeam(db, teamId); // undo: the team and everything made for it go together
      } catch (undoError) {
        console.warn("Could not undo the half-made Demo team", undoError);
      }
    }
    throw error;
  }
}

/**
 * Runs once on every start, before the first screen. Fresh install: make the Demo team and set the flag.
 * Any other phone with no flag yet (Ben's, with a player, a game or a second team): set the flag and change
 * nothing else. A phone with the flag: nothing at all. Never throws: a problem must not stop the app opening.
 * Finishes with "demo", "flagged" or "none".
 */
export async function runFirstOpen(db, now = new Date()) {
  try {
    const facts = await readFacts(db);
    if (facts.flag !== undefined) {
      return "none";
    }
    if (isFreshInstall(facts)) {
      try {
        await createDemoTeam(db, now);
        await setMeta(db, TOUR_FLAG, true);
        return "demo";
      } catch (error) {
        console.warn("Could not make the Demo team; opening normally", error);
        await setMeta(db, TOUR_FLAG, true).catch(() => {});
        return "none";
      }
    }
    await setMeta(db, TOUR_FLAG, true); // an existing phone: silent, nothing else changes
    return "flagged";
  } catch (error) {
    console.warn("App tour start-up check failed", error);
    return "none";
  }
}

/** The tips already closed. */
export async function loadSeen(db) {
  return cleanSeen(await getMeta(db, SEEN_KEY));
}

/** Saves the list of closed tips. */
export function saveSeen(db, seen) {
  return setMeta(db, SEEN_KEY, seen);
}

/**
 * ☰ > App tour: clears every seen mark, and makes the Demo team again if there is none (deleted), as at first open.
 * Finishes with true when a Demo team was made. `teams` is every team including archived ones.
 */
export async function restartTour(db, teams, now = new Date()) {
  await saveSeen(db, []);
  if (demoTeamExists(teams)) {
    return false;
  }
  await createDemoTeam(db, now);
  return true;
}
