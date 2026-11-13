// Saving and loading games. Each change is one transaction, so a game is either
// fully saved or not changed at all. See game-rules.js for what a game holds.

import { change, read } from "./db.js";
import { isInProgress, hereToggled, benchStints, lineUpMoved, SECOND_HALF, goalAdded, goalRemoved, playedToday, lineupKey, startedSecondHalf, undoneKickOff, isRemovedByUndo, endedHalf, reopenedHalf, benchReordered, planMoved, planBenchReordered, fieldMoved, pairPlanned, pairRemoved, swapEvent, swapUndone, swapped, gamesInOrder, halfEndCancelledEvent, halfEndEvent, halfStartEvent, movedOnto, newGame, nextCreatedOrder, positionChangeEvent, prePlaced, startedFirstHalf, withBenchOrder } from "./game-rules.js";
import { buildRecord, gameAtFullTime } from "./record-rules.js";
import { canDeleteGame, gameArchived } from "./sheet-rules.js";
import { squadInOrder } from "./squad-rules.js";
import { ofTeam, sameTeam, withTeamId } from "./team-rules.js";

/** The squad of the game's own team: a game never sees another team's players. */
function squadOf(allPlayers, game) {
  return squadInOrder(allPlayers.filter((player) => sameTeam(player, game)));
}

/** The games of ONE team, in the order Home shows them. */
export function loadGames(db, teamId, firstTeamId) {
  return read(db, ["games", "events"], (tx, answer) => {
    tx.objectStore("games").getAll().onsuccess = (event) => {
      const games = gamesInOrder(ofTeam(event.target.result, teamId, firstTeamId));
      // GDA-80: a game under way also carries `benchStints`, worked out from its saved events
      // for the frozen bench rings. It is only added to the copy in memory; nothing new is saved.
      const running = games.filter(isInProgress);
      if (running.length === 0) {
        answer(games);
        return;
      }
      let waiting = running.length;
      for (const game of running) {
        tx.objectStore("events").index("gameId").getAll(game.id).onsuccess = (found) => {
          game.benchStints = benchStints(game, found.target.result);
          game.played = [...playedToday(game, found.target.result)]; // GDA-90: who the Who scored? dialog may offer, in memory only
          waiting -= 1;
          if (waiting === 0) {
            answer(games);
          }
        };
      }
    };
  });
}

/** Saves a new game, pre-placed from the squad. Finishes with its id, once it is saved. */
export function addGame(db, form, team, firstTeamId) {
  const teamId = team.id;
  const id = crypto.randomUUID();
  return change(db, ["games", "players"], (tx, answer) => {
    const games = tx.objectStore("games");
    tx.objectStore("players").getAll().onsuccess = (players) => {
      games.getAll().onsuccess = (event) => {
        const squad = squadInOrder(ofTeam(players.target.result, teamId, firstTeamId));
        games.add(withTeamId(newGame(form, id, nextCreatedOrder(event.target.result), squad, team), teamId));
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
        const ready = saved ? withBenchOrder(saved, squadOf(players.target.result, saved)) : null;
        const moved = ready ? lineUpMoved(ready, playerId, spot, squadOf(players.target.result, ready)) : null;
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
        const ready = saved ? withBenchOrder(saved, squadOf(players.target.result, saved)) : null;
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

/** One tap in the Here / Not here list (GDA-43), saved at once. A player leaving the pitch is logged with the time. */
export function toggleHere(db, gameId, playerId, at) {
  return changeLive(db, gameId, (game) => {
    const done = hereToggled(game, playerId, at);
    return done && { game: done.game, event: done.changes.length > 0 ? positionChangeEvent(gameId, done.changes, at, lineupKey(game)) : undefined };
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
        const ready = saved ? withBenchOrder(saved, squadOf(players.target.result, saved)) : null;
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

/**
 * A move or a bench re-order on the 2nd-half plan (GDA-97). `rule(game, squad)` gives the changed game or
 * null. Only the plan is saved: no event is logged, and the running half, bench order and timers are untouched.
 */
function changePlan(db, gameId, rule) {
  return change(db, ["games", "players"], (tx) => {
    const games = tx.objectStore("games");
    tx.objectStore("players").getAll().onsuccess = (players) => {
      games.get(gameId).onsuccess = (event) => {
        const saved = event.target.result;
        const changed = saved ? rule(saved, squadOf(players.target.result, saved)) : null;
        if (changed) {
          games.put(changed);
        } else {
          tx.abort();
        }
      };
    };
  });
}

/** A player moved on the 2nd-half plan. */
export function movePlan(db, gameId, playerId, spot) {
  return changePlan(db, gameId, (game, squad) => planMoved(game, playerId, spot, squad));
}

/** A bench player dragged along the 2nd-half plan's bench. */
export function reorderPlanBench(db, gameId, playerId, targetId) {
  return changePlan(db, gameId, (game, squad) => planBenchReordered(game, playerId, targetId, squad));
}

/** Places the squad in a game made before pre-placing existed. */
export function prePlaceGame(db, id) {
  return change(db, ["games", "players"], (tx) => {
    const games = tx.objectStore("games");
    tx.objectStore("players").getAll().onsuccess = (players) => {
      games.get(id).onsuccess = (event) => {
        games.put(prePlaced(event.target.result, squadOf(players.target.result, event.target.result)));
      };
    };
  });
}

/**
 * START 1ST HALF: saves the start time on the game and in the event log, in one
 * transaction. The game screen appears only once this has finished.
 */
export function startFirstHalf(db, gameId, at) {
  return change(db, ["games", "events", "players"], (tx) => {
    const games = tx.objectStore("games");
    games.get(gameId).onsuccess = (event) => {
      const saved = event.target.result;
      // The squad is read too, so the bench can be numbered at kick-off (GDA-103).
      tx.objectStore("players").getAll().onsuccess = (players) => {
        const started = saved ? startedFirstHalf(saved, at, squadOf(players.target.result, saved)) : null;
        if (!started) {
          tx.abort();
        } else if (started !== saved) {
          games.put(started);
          tx.objectStore("events").add(halfStartEvent(gameId, at));
        }
      };
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

/** End Half (either half): saves the real time of the tap. `half` is the half the screen shows; a screen that is out of date does nothing. */
export function endHalf(db, gameId, at, half = null) {
  return changeHalf(db, gameId, (game) => endedHalf(game, at, half), (game) => halfEndEvent(gameId, at, game.state === SECOND_HALF ? "secondHalf" : "firstHalf"));
}

/** Resume half: the half runs again from its original start time. Only while the next half has not started. */
export function reopenHalf(db, gameId, at, half = null) {
  return changeHalf(db, gameId, (game) => reopenedHalf(game, half), (game) => halfEndCancelledEvent(gameId, at, game.state === SECOND_HALF ? "secondHalf" : "firstHalf"));
}

/** Start 2nd Half: saves the start time on the game and in the event log, in one transaction. */
export function startSecondHalf(db, gameId, at) {
  return changeHalf(db, gameId, (game) => startedSecondHalf(game, at), () => halfStartEvent(gameId, at, "secondHalf"));
}

/**
 * Undo kick-off (GDA-98) for half 1 or 2, all or nothing in ONE transaction: the game goes back to its
 * copy from kick-off and that half's log entries are removed. A stale screen (half not running, no copy)
 * changes nothing.
 */
export function undoKickOff(db, gameId, half) {
  return change(db, ["games", "events"], (tx) => {
    const games = tx.objectStore("games");
    games.get(gameId).onsuccess = (found) => {
      const saved = found.target.result;
      const undone = saved ? undoneKickOff(saved, half) : null;
      if (!undone) {
        tx.abort();
        return;
      }
      if (undone === saved) {
        return; // Stale screen: nothing to undo, nothing changed.
      }
      games.put(undone);
      tx.objectStore("events").index("gameId").openCursor(gameId).onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (isRemovedByUndo(saved, half, cursor.value)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
    };
  });
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
          const record = buildRecord(game, squadOf(players.target.result, game), events.target.result);
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

/** Marks a game as sent, once Google has confirmed it. Only a game marked "to send" can be marked. */
export function markSentToSheet(db, gameId) {
  return changeGame(db, gameId, (game) => (game.toSend ? { ...game, sentToSheet: true } : game));
}

/**
 * Deletes ONE game that has not started (GDA-66), with its event log, in one transaction.
 * A game that has started or finished is refused (nothing changes). Nothing is sent anywhere.
 */
export function deleteGame(db, gameId) {
  return change(db, ["games", "events"], (tx) => {
    const games = tx.objectStore("games");
    games.get(gameId).onsuccess = (found) => {
      const game = found.target.result;
      if (!game || !canDeleteGame(game)) {
        tx.abort();
        return;
      }
      games.delete(gameId);
      const events = tx.objectStore("events");
      events.index("gameId").getAllKeys(gameId).onsuccess = (keys) => {
        keys.target.result.forEach((key) => events.delete(key));
      };
    };
  });
}

/** Archives ONE finished game (GDA-69): sets a flag on it. Nothing is erased, sent or changed in the Sheet. */
export function archiveGame(db, gameId) {
  return changeGame(db, gameId, gameArchived);
}
