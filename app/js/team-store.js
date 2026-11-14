// Saving and loading teams (GDA-68). Each change is one transaction.
// Players and games live in their own stores and carry a teamId.

import { change, read } from "./db.js";
import { firstFormationFor } from "./formation-rules.js";
import { anyInProgress } from "./game-rules.js";
import { firstTeamIdOf, ofTeam } from "./team-rules.js";

const CURRENT = "currentTeamId";

/** Every team (oldest first) and which one is current. The current one is always a real team. */
export function loadTeams(db) {
  return read(db, ["teams", "meta"], (tx, answer) => {
    tx.objectStore("teams").getAll().onsuccess = (found) => {
      const teams = found.target.result.sort((a, b) => a.id - b.id);
      tx.objectStore("meta").get(CURRENT).onsuccess = (saved) => {
        const wanted = saved.target.result?.value;
        const current = teams.find((team) => team.id === wanted) ?? teams[0];
        answer({ teams, currentTeamId: current?.id });
      };
    };
  });
}

/** Makes a new team and makes it current, together. Finishes with its id. */
export function addTeam(db, values) {
  return change(db, ["teams", "meta"], (tx, answer) => {
    const team = { ...values, formation: firstFormationFor(values.playersPerSide), sheet: null };
    tx.objectStore("teams").add(team).onsuccess = (added) => {
      tx.objectStore("meta").put({ key: CURRENT, value: added.target.result });
      answer(added.target.result);
    };
  });
}

/** Saves changes (name, size, half length, Sheet settings) to one team. */
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
 * with a game in progress. Other teams' records are never touched. The Sheet is never touched.
 */
export function deleteTeam(db, id) {
  return change(db, ["teams", "players", "games", "events", "meta", "photos", "logos"], (tx) => {
    const teams = tx.objectStore("teams");
    teams.getAll().onsuccess = (foundTeams) => {
      const all = foundTeams.target.result.sort((a, b) => a.id - b.id);
      const firstId = firstTeamIdOf(all);
      const remaining = all.filter((team) => team.id !== id);
      if (remaining.length === all.length || remaining.length === 0) {
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
