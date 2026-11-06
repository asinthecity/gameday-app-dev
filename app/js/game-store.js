// Saving and loading games. Creating a game is one transaction, so a game is
// either fully saved or not there at all. See game-rules.js for what a game holds.

import { change, read } from "./db.js";
import { gamesInOrder, newGame, nextCreatedOrder } from "./game-rules.js";

/** Every game, in the order Home shows them. */
export function loadGames(db) {
  return read(db, ["games"], (tx, answer) => {
    tx.objectStore("games").getAll().onsuccess = (event) => answer(gamesInOrder(event.target.result));
  });
}

/** Saves a new game from what was entered on the New game screen. */
export function addGame(db, form) {
  const id = crypto.randomUUID();
  return change(db, ["games"], (tx) => {
    const games = tx.objectStore("games");
    games.getAll().onsuccess = (event) => {
      games.add(newGame(form, id, nextCreatedOrder(event.target.result)));
    };
  });
}
