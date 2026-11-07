// Saving and loading games. Each change is one transaction, so a game is either
// fully saved or not changed at all. See game-rules.js for what a game holds.

import { change, read } from "./db.js";
import { gamesInOrder, movedOnto, newGame, nextCreatedOrder, positionChangeEvent, prePlaced } from "./game-rules.js";
import { squadInOrder } from "./squad-rules.js";

/** Every game, in the order Home shows them. */
export function loadGames(db) {
  return read(db, ["games"], (tx, answer) => {
    tx.objectStore("games").getAll().onsuccess = (event) => answer(gamesInOrder(event.target.result));
  });
}

/** Saves a new game, pre-placed from the squad. Finishes with its id, once it is saved. */
export function addGame(db, form) {
  const id = crypto.randomUUID();
  return change(db, ["games", "players"], (tx, answer) => {
    const games = tx.objectStore("games");
    tx.objectStore("players").getAll().onsuccess = (players) => {
      games.getAll().onsuccess = (event) => {
        games.add(newGame(form, id, nextCreatedOrder(event.target.result), squadInOrder(players.target.result)));
        answer(id);
      };
    };
  });
}

/** Reads one game, applies a rule from game-rules.js and writes it back, in one transaction. */
export function changeGame(db, id, rule) {
  return change(db, ["games"], (tx) => {
    const games = tx.objectStore("games");
    games.get(id).onsuccess = (event) => {
      const game = event.target.result;
      if (game) {
        games.put(rule(game));
      } else {
        tx.abort();
      }
    };
  });
}

/**
 * Moves a player on the line-up and logs it with the time, in one transaction: the
 * game and its event log can never disagree. `at` is the real time in milliseconds.
 */
export function movePlayer(db, gameId, playerId, spot, at) {
  return change(db, ["games", "events"], (tx) => {
    const games = tx.objectStore("games");
    games.get(gameId).onsuccess = (event) => {
      const saved = event.target.result;
      const moved = saved ? movedOnto(saved, playerId, spot) : null;
      if (moved) {
        games.put(moved.game);
        tx.objectStore("events").add(positionChangeEvent(gameId, moved.changes, at));
      } else {
        tx.abort();
      }
    };
  });
}

/** Places the squad in a game made before pre-placing existed. */
export function prePlaceGame(db, id) {
  return change(db, ["games", "players"], (tx) => {
    const games = tx.objectStore("games");
    tx.objectStore("players").getAll().onsuccess = (players) => {
      games.get(id).onsuccess = (event) => {
        games.put(prePlaced(event.target.result, squadInOrder(players.target.result)));
      };
    };
  });
}
