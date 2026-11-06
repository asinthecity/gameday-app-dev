// Saving and loading players. Each change here is one transaction, so a player
// is either fully saved or not changed at all.
//
// A player is { id, name, colour, active }. Removing sets active to false and
// keeps the record, because past game records still need the name (GDA-46).

import { change, read } from "./db.js";
import { colourForNewPlayer, squadInOrder } from "./squad-rules.js";

/** The squad, in the order it is shown. */
export function loadSquad(db) {
  return read(db, ["players"], (tx, answer) => {
    tx.objectStore("players").getAll().onsuccess = (event) => answer(squadInOrder(event.target.result));
  });
}

/** Finishes with the new player's id, once the player is saved. */
export function addPlayer(db, name) {
  return change(db, ["players"], (tx, answer) => {
    const players = tx.objectStore("players");
    players.count().onsuccess = (event) => {
      const player = { name, colour: colourForNewPlayer(event.target.result), active: true };
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

export function removePlayer(db, id) {
  return updatePlayer(db, id, { active: false });
}
