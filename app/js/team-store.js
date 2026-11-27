// Saving and loading teams (GDA-68). Each change is one transaction.
// Players and games live in their own stores and carry a teamId.

import { change, read } from "./db.js";
import { firstFormationFor } from "./formation-rules.js";
import { anyInProgress } from "./game-rules.js";
import { chooseCurrentTeamId, firstTeamIdOf, ofTeam, splitTeams } from "./team-rules.js";
import { OLD_SHEET_KEY, teamWithoutSheet } from "./export-rules.js";

const CURRENT = "currentTeamId";

/**
 * Every team in the list (oldest first, archived ones left out), the archived teams, and which team is current
 * (never an archived one). `firstTeamId` is the first-made team across ALL teams, archived or not (GDA-208), because
 * a record with no teamId belongs to it.
 */
export async function loadTeams(db) {
  const found = await read(db, ["teams", "meta"], (tx, answer) => {
    tx.objectStore("teams").getAll().onsuccess = (all) => {
      const teams = all.target.result.sort((a, b) => a.id - b.id);
      tx.objectStore("meta").get(CURRENT).onsuccess = (saved) => answer({ all: teams, wanted: saved.target.result?.value });
    };
  });
  const { active, archived, revived } = splitTeams(found.all);
  if (revived) {
    await updateTeam(db, revived.id, { archived: false }); // every team was archived: the first-made comes back
  }
  return { teams: active, archivedTeams: archived, currentTeamId: chooseCurrentTeamId(active, found.wanted), firstTeamId: firstTeamIdOf(found.all) };
}

/** Makes a new team and makes it current, together. Finishes with its id. */
export function addTeam(db, values) {
  return change(db, ["teams", "meta"], (tx, answer) => {
    const team = { formation: firstFormationFor(values.playersPerSide), ...values }; // GDA-167: a chosen default Formation wins
    tx.objectStore("teams").add(team).onsuccess = (added) => {
      tx.objectStore("meta").put({ key: CURRENT, value: added.target.result });
      answer(added.target.result);
    };
  });
}

/** Saves changes (name, size, half length) to one team. */
export function updateTeam(db, id, changes) {
  return change(db, ["teams"], (tx) => {
    const teams = tx.objectStore("teams");
    teams.get(id).onsuccess = (found) => {
      if (found.target.result) {
        teams.put({ ...found.target.result, ...changes });
      } else {
        tx.abort();
      }
    };
  });
}

/** Switches the current team. Refused (nothing changes) while any game is in progress. */
export function switchTeam(db, id) {
  return change(db, ["teams", "games", "meta"], (tx) => {
    tx.objectStore("games").getAll().onsuccess = (games) => {
      tx.objectStore("teams").get(id).onsuccess = (team) => {
        if (!team.target.result || anyInProgress(games.target.result)) {
          tx.abort();
          return;
        }
        tx.objectStore("meta").put({ key: CURRENT, value: id });
      };
    };
  });
}

/**
 * Deletes ONE team with its players, games and event logs, in one transaction, then makes
 * the first remaining team current. Refused (nothing changes) for the last team or a team
 * with a game in progress. Other teams' records are never touched.
 */
export function deleteTeam(db, id) {
  return change(db, ["teams", "players", "games", "events", "meta", "photos", "logos"], (tx) => {
    const teams = tx.objectStore("teams");
    teams.getAll().onsuccess = (foundTeams) => {
      const all = foundTeams.target.result.sort((a, b) => a.id - b.id);
      const firstId = firstTeamIdOf(all);
      const remaining = all.filter((team) => team.id !== id && !team.archived); // GDA-208: archived teams never become current
      if (!all.some((team) => team.id === id) || remaining.length === 0) {
        tx.abort();
        return;
      }
      tx.objectStore("games").getAll().onsuccess = (foundGames) => {
        const games = ofTeam(foundGames.target.result, id, firstId);
        if (anyInProgress(games)) {
          tx.abort();
          return;
        }
        const events = tx.objectStore("events");
        for (const game of games) {
          tx.objectStore("games").delete(game.id);
          events.index("gameId").getAllKeys(game.id).onsuccess = (keys) => {
            keys.target.result.forEach((key) => events.delete(key));
          };
        }
        tx.objectStore("players").getAll().onsuccess = (foundPlayers) => {
          ofTeam(foundPlayers.target.result, id, firstId).forEach((player) => {
            tx.objectStore("players").delete(player.id);
            tx.objectStore("photos").delete(player.id); // Their photos go too (GDA-52).
          });
        };
        teams.delete(id);
        tx.objectStore("logos").delete(id); // Its logo goes too (GDA-126).
        tx.objectStore("meta").put({ key: CURRENT, value: remaining[0].id });
      };
    };
  });
}

/**
 * GDA-208: hides ONE team from the team list; every player, game and event is kept. If it was the current team, the
 * first team left in the list becomes current. Refused (nothing changes) for the last team in the list, an archived
 * or missing team, or a team with a game in progress.
 */
export function archiveTeam(db, id) {
  return change(db, ["teams", "games", "meta"], (tx) => {
    const teams = tx.objectStore("teams");
    teams.getAll().onsuccess = (foundTeams) => {
      const all = foundTeams.target.result.sort((a, b) => a.id - b.id);
      const target = all.find((team) => team.id === id);
      const remaining = all.filter((team) => team.id !== id && !team.archived);
      if (!target || target.archived || remaining.length === 0) {
        tx.abort();
        return;
      }
      tx.objectStore("games").getAll().onsuccess = (foundGames) => {
        if (anyInProgress(ofTeam(foundGames.target.result, id, firstTeamIdOf(all)))) {
          tx.abort();
          return;
        }
        teams.put({ ...target, archived: true });
        tx.objectStore("meta").get(CURRENT).onsuccess = (saved) => {
          if (saved.target.result?.value === id) {
            tx.objectStore("meta").put({ key: CURRENT, value: remaining[0].id });
          }
        };
      };
    };
  });
}

/** GDA-208: puts an archived team back in the list and makes it current. Refused while any game is in progress. */
export function bringBackTeam(db, id) {
  return change(db, ["teams", "games", "meta"], (tx) => {
    tx.objectStore("games").getAll().onsuccess = (games) => {
      tx.objectStore("teams").get(id).onsuccess = (found) => {
        const team = found.target.result;
        if (!team || !team.archived || anyInProgress(games.target.result)) {
          tx.abort();
          return;
        }
        tx.objectStore("teams").put({ ...team, archived: false });
        tx.objectStore("meta").put({ key: CURRENT, value: id });
      };
    };
  });
}

/**
 * GDA-189: the Google Sheet connection is gone, so its saved address and secret are deleted: the app-wide
 * setting in meta and each team's own `sheet` copy. Runs on every start (a restored older backup may bring
 * one back). Only a record that holds one is written; nothing else is changed.
 */
export function removeOldSheetSetting(db) {
  return change(db, ["teams", "meta"], (tx) => {
    tx.objectStore("meta").delete(OLD_SHEET_KEY);
    const teams = tx.objectStore("teams");
    teams.getAll().onsuccess = (found) => {
      for (const team of found.target.result) {
        const cleaned = teamWithoutSheet(team);
        if (cleaned !== team) {
          teams.put(cleaned);
        }
      }
    };
  });
}
