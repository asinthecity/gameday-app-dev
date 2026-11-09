// Saving and loading players. Each change here is one transaction, so a player
// is either fully saved or not changed at all.
//
// A player is { id, name, colour, active }. Removing sets active to false and
// keeps the record, because past game records still need the name (GDA-46).
//
// Adding or renaming a player needs no change to any game: games hold player ids,
// and the bench is worked out from the squad. Only removing has to touch games.

import { change, read } from "./db.js";
import { NOT_STARTED, withoutRemovedPlayer } from "./game-rules.js";
import { colourForNewPlayer, squadInOrder } from "./squad-rules.js";
import { ofTeam, sameTeam, withTeamId } from "./team-rules.js";

/** The squad of ONE team, in the order it is shown. */
export function loadSquad(db, teamId, firstTeamId) {
  return read(db, ["players"], (tx, answer) => {
    tx.objectStore("players").getAll().onsuccess = (event) => answer(squadInOrder(ofTeam(event.target.result, teamId, firstTeamId)));
  });
}

/** Finishes with the new player's id, once the player is saved. */
export function addPlayer(db, name, teamId, firstTeamId) {
  return change(db, ["players"], (tx, answer) => {
    const players = tx.objectStore("players");
    players.getAll().onsuccess = (event) => {
      const count = ofTeam(event.target.result, teamId, firstTeamId).length;
      const player = withTeamId({ name, colour: colourForNewPlayer(count), active: true }, teamId);
      players.add(player).onsuccess = (added) => answer(added.target.result);
    };
  });
}

/** Reads one player and writes back the changes, all in one transaction. */
function updatePlayer(db, id, changes) {
  return change(db, ["players"], (tx) => {
    const players = tx.objectStore("players");
    players.get(id).onsuccess = (event) => {
      const player = event.target.result;
      if (player) {
        players.put({ ...player, ...changes });
      } else {
        tx.abort();
      }
    };
  });
}

export function renamePlayer(db, id, name) {
  return updatePlayer(db, id, { name });
}

/** Takes the player out of the squad and out of every game not yet started, in one transaction. */
export function removePlayer(db, id) {
  return change(db, ["players", "games", "photos"], (tx) => {
    const players = tx.objectStore("players");
    const games = tx.objectStore("games");
    players.get(id).onsuccess = (event) => {
      const player = event.target.result;
      if (!player) {
        tx.abort();
        return;
      }
      players.put({ ...player, active: false });
      tx.objectStore("photos").delete(id); // The photo goes with the player (GDA-52).
      games.getAll().onsuccess = (found) => {
        found.target.result
          .filter((game) => game.state === NOT_STARTED && sameTeam(game, player))
          .forEach((game) => games.put(withoutRemovedPlayer(game, id)));
      };
    };
  });
}
