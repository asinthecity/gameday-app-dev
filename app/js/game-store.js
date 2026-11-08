// Saving and loading games. Each change is one transaction, so a game is either
// fully saved or not changed at all. See game-rules.js for what a game holds.

import { change, read } from "./db.js";
import { lineUpMoved, SECOND_HALF, goalAdded, goalRemoved, lineupKey, startedSecondHalf, endedHalf, reopenedHalf, benchReordered, fieldMoved, pairPlanned, pairRemoved, swapEvent, swapUndone, swapped, gamesInOrder, halfEndCancelledEvent, halfEndEvent, halfStartEvent, movedOnto, newGame, nextCreatedOrder, positionChangeEvent, prePlaced, startedFirstHalf, withBenchOrder } from "./game-rules.js";
import { buildRecord, gameAtFullTime } from "./record-rules.js";
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
  return change(db, ["games", "events", "players"], (tx) => {
    const games = tx.objectStore("games");
    tx.objectStore("players").getAll().onsuccess = (players) => {
      games.get(gameId).onsuccess = (event) => {
        // Complete the bench order first: a game saved before GDA-61 has none.
        const saved = event.target.result;
        const ready = saved ? withBenchOrder(saved, squadInOrder(players.target.result)) : null;
        const moved = ready ? lineUpMoved(ready, playerId, spot, squadInOrder(players.target.result)) : null;
        if (moved) {
          games.put(moved.game);
          // Marking absent or back in logs nothing, as the Absent button does not.
          if (moved.changes.length > 0) {
            tx.objectStore("events").add(positionChangeEvent(gameId, moved.changes, at, lineupKey(ready)));
          }
        } else {
          tx.abort();
        }
      };
    };
  });
}

/**
 * One change during a game (GDA-30), in one transaction. `rule(game)` gets the saved
 * game with its bench order complete and gives { game, event, answer, deleteEventId }
 * or null to change nothing. The game, its log entry (or the removal of one, for
 * Undo) are saved together, so a swap is never half done. Finishes with `answer`.
 */
function changeLive(db, gameId, rule) {
  return change(db, ["games", "events", "players"], (tx, answer) => {
    const games = tx.objectStore("games");
    tx.objectStore("players").getAll().onsuccess = (players) => {
      games.get(gameId).onsuccess = (event) => {
        const saved = event.target.result;
        const ready = saved ? withBenchOrder(saved, squadInOrder(players.target.result)) : null;
        const outcome = ready ? rule(ready) : null;
        if (!outcome) {
          tx.abort();
          return;
        }
        games.put(outcome.game);
        if (outcome.deleteEventId !== undefined) {
          tx.objectStore("events").delete(outcome.deleteEventId);
        }
        if (outcome.event) {
          tx.objectStore("events").add(outcome.event).onsuccess = (added) => answer({ ...outcome.answer, eventId: added.target.result });
        } else {
          answer(outcome.answer);
        }
      };
    };
  });
}

/** Plans a pair (a bench player and a field player or empty position). Nothing moves. */
export function planPair(db, gameId, playerId, spot) {
  return changeLive(db, gameId, (game) => {
    const planned = pairPlanned(game, playerId, spot);
    return planned && { game: planned };
  });
}

/** The cross on a planned line. */
export function unplanPair(db, gameId, benchId) {
  return changeLive(db, gameId, (game) => ({ game: pairRemoved(game, benchId) }));
}

/** A field player moves onto another or an empty position, logged with the time. */
export function moveFieldPlayer(db, gameId, playerId, spot, at) {
  return changeLive(db, gameId, (game) => {
    const moved = fieldMoved(game, playerId, spot);
    return moved && { game: moved.game, event: positionChangeEvent(gameId, moved.changes, at, lineupKey(game)) };
  });
}

/** Swap. Finishes with { before, eventId }, which is what Undo needs. */
export function swapPlayers(db, gameId, at) {
  return changeLive(db, gameId, (game) => {
    const done = swapped(game, at);
    return done && { game: done.game, event: swapEvent(gameId, done.changes, at, lineupKey(game)), answer: { before: game } };
  });
}

/** Undo after Swap: puts the game back and removes the saved swap, together. */
export function undoSwap(db, gameId, before, eventId) {
  return changeLive(db, gameId, (game) => ({ game: swapUndone(game, before), deleteEventId: eventId }));
}

/** Saves a bench player dragged along the bench. Positions do not change, so nothing is logged. */
export function reorderBench(db, gameId, playerId, targetId) {
  return change(db, ["games", "players"], (tx) => {
    const games = tx.objectStore("games");
    tx.objectStore("players").getAll().onsuccess = (players) => {
      games.get(gameId).onsuccess = (event) => {
        const saved = event.target.result;
        const ready = saved ? withBenchOrder(saved, squadInOrder(players.target.result)) : null;
        const reordered = ready ? benchReordered(ready, playerId, targetId) : null;
        if (reordered) {
          games.put(reordered);
        } else {
          tx.abort();
        }
      };
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

/**
 * START 1ST HALF: saves the start time on the game and in the event log, in one
 * transaction. The game screen appears only once this has finished.
 */
export function startFirstHalf(db, gameId, at) {
  return change(db, ["games", "events"], (tx) => {
    const games = tx.objectStore("games");
    games.get(gameId).onsuccess = (event) => {
      const saved = event.target.result;
      const started = saved ? startedFirstHalf(saved, at) : null;
      if (!started) {
        tx.abort();
      } else if (started !== saved) {
        games.put(started);
        tx.objectStore("events").add(halfStartEvent(gameId, at));
      }
    };
  });
}

/**
 * One change to which half is running, saved with its log entry in one transaction.
 * `rule` gives the changed game (or the same game back, which saves nothing);
 * `eventFor(saved)` gives the log entry. The next screen appears only once this has finished.
 */
function changeHalf(db, gameId, rule, eventFor) {
  return change(db, ["games", "events"], (tx) => {
    const games = tx.objectStore("games");
    games.get(gameId).onsuccess = (event) => {
      const saved = event.target.result;
      const changed = saved ? rule(saved) : null;
      if (!changed) {
        tx.abort();
      } else if (changed !== saved) {
        games.put(changed);
        tx.objectStore("events").add(eventFor(saved));
      }
    };
  });
}

/** End Half (either half): saves the real time of the tap. In the first half this opens Half Time. */
export function endHalf(db, gameId, at) {
  return changeHalf(db, gameId, (game) => endedHalf(game, at), (game) => halfEndEvent(gameId, at, game.state === SECOND_HALF ? "secondHalf" : "firstHalf"));
}

/** The back arrow after End Half: the half runs again from its original start time. */
export function reopenHalf(db, gameId, at) {
  return changeHalf(db, gameId, reopenedHalf, (game) => halfEndCancelledEvent(gameId, at, game.state === SECOND_HALF ? "secondHalf" : "firstHalf"));
}

/** Start 2nd Half: saves the start time on the game and in the event log, in one transaction. */
export function startSecondHalf(db, gameId, at) {
  return changeHalf(db, gameId, (game) => startedSecondHalf(game, at), () => halfStartEvent(gameId, at, "secondHalf"));
}

/**
 * FULL TIME (GDA-46, GDA-50): builds the record from the saved game and its event log
 * and stores it with the closed game, all in ONE transaction. Finishes only once it is
 * stored, so the Saved screen can never show for a record that does not exist. If
 * anything is wrong nothing changes and the game stays open. A game already closed
 * (a double tap) is left exactly as it is: one record only.
 */
export function fullTime(db, gameId) {
  return change(db, ["games", "events", "players"], (tx) => {
    const games = tx.objectStore("games");
    games.get(gameId).onsuccess = (found) => {
      const game = found.target.result;
      if (!game) {
        tx.abort();
        return;
      }
      if (game.record) {
        return; // Already closed.
      }
      tx.objectStore("players").getAll().onsuccess = (players) => {
        tx.objectStore("events").index("gameId").getAll(gameId).onsuccess = (events) => {
          const record = buildRecord(game, squadInOrder(players.target.result), events.target.result);
          if (record) {
            games.put(gameAtFullTime(game, record));
          } else {
            tx.abort();
          }
        };
      };
    };
  });
}

/** Saves a goal on the game at once. Each tap is one transaction, so a goal is saved or not at all. */
export function addGoal(db, gameId, goal) {
  return changeGame(db, gameId, (game) => goalAdded(game, goal));
}

/** Saves the removal of one goal (Undo, or Remove last goal) at once. */
export function removeGoal(db, gameId, goalId) {
  return changeGame(db, gameId, (game) => goalRemoved(game, goalId));
}
