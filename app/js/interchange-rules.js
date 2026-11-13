// GDA-121: Interchange history. Pure sums only (no screen, no saving): the list of swaps, the bench time
// tally and its sorting are all worked out from the saved event log and the game. Nothing new is stored.

import { BENCH, FINISHED, POSITION_CHANGE, SECOND_HALF, SWAP, benchTotalSeconds, isHalfTime, minuteOf } from "./game-rules.js";

/** The events in the order they happened (time, then the order they were saved). */
function inOrder(events) {
  return events
    .filter((e) => (e.type === SWAP || e.type === POSITION_CHANGE) && Array.isArray(e.changes))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || (a.id ?? 0) - (b.id ?? 0));
}

/** "1st 12'" like the Summary goal timeline; just "1st" when the swap has no time (older games). */
function whenText(game, event) {
  const minute = minuteOf(game, event.half, event.at);
  return `${event.half === "secondHalf" ? "2nd" : "1st"}${minute === null ? "" : ` ${minute}'`}`;
}

/**
 * One row per swap or instant move that puts a player on the bench or brings one on, oldest first.
 * Each row: { when, pairs: [{ off, on }] } where off / on are player ids (null if only one side moved).
 * A player going off is matched with the one who took the place they left. Pitch-to-pitch moves are left out.
 */
export function interchangeRows(game, events) {
  const rows = [];
  for (const event of inOrder(events)) {
    const offs = event.changes.filter((c) => c.to === BENCH && typeof c.from === "number");
    const ons = event.changes.filter((c) => c.from === BENCH && typeof c.to === "number");
    const pairs = offs.map((off) => {
      const on = ons.find((c) => c.to === off.from);
      return { off: off.playerId, on: on ? on.playerId : null };
    });
    for (const on of ons) {
      if (!offs.some((off) => off.from === on.to)) {
        pairs.push({ off: null, on: on.playerId });
      }
    }
    if (pairs.length > 0) {
      rows.push({ when: whenText(game, event), pairs });
    }
  }
  return rows;
}

/** How many bench spells each player has had this game, from the saved moves: { playerId: count }. */
export function rotationCounts(game, events) {
  const counts = {};
  const state = {}; // playerId -> "bench" or "elsewhere", as far as the moves show
  for (const event of inOrder(events)) {
    for (const change of event.changes) {
      const id = change.playerId;
      if (change.to === BENCH && change.from !== BENCH) {
        counts[id] = (counts[id] ?? 0) + 1; // went to the bench
      } else if (change.from === BENCH && change.to !== BENCH && state[id] !== "bench") {
        counts[id] = (counts[id] ?? 0) + 1; // came off a spell that began where no move shows (kick-off, or the half-time plan)
      }
      state[id] = change.to === BENCH ? "bench" : "elsewhere";
    }
  }
  return counts;
}

/** The game as the bench maths wants it: a finished game is read as its 2nd half ended (the totals then stop). */
function asPlayed(game) {
  return game.state === FINISHED ? { ...game, state: SECOND_HALF } : game;
}

/**
 * The bench time tally: one row per present squad player, { id, name, rotations, seconds }, in name order.
 * `seconds` is the existing whole-game bench total (both halves). A player with no moves at all counts one
 * rotation if they have sat on the bench (now or earlier), because their spell began at kick-off or half time.
 */
export function tallyRows(game, events, players, now) {
  const played = asPlayed(game);
  const counts = rotationCounts(game, events);
  const moved = new Set(events.flatMap((e) => (Array.isArray(e.changes) ? e.changes.map((c) => c.playerId) : [])));
  const kickedOff = typeof game.firstHalfStartedAt === "number";
  const benchNow = new Set((isHalfTime(played) ? played.benchOrderAtEndHalf ?? played.benchOrder : played.benchOrder) ?? []);
  return players
    .filter((player) => !(game.absent ?? []).includes(player.id))
    .map((player) => {
      const seconds = kickedOff ? benchTotalSeconds(played, player.id, now) : 0;
      const sat = !moved.has(player.id) && kickedOff && (seconds > 0 || benchNow.has(player.id));
      return { id: player.id, name: player.name, rotations: sat ? 1 : counts[player.id] ?? 0, seconds };
    })
    .sort(byName);
}

const byName = (a, b) => a.name.localeCompare(b.name);

/** The columns of the tally, in order. */
export const TALLY_COLUMNS = ["name", "rotations", "seconds"];

/**
 * Sorts tally rows by a column. `descending` false = A to Z or lowest first. Ties are always by name A to Z.
 * Gives a new list; the rows are not changed.
 */
export function sortTally(rows, column, descending = false) {
  const way = descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    const diff = column === "name" ? a.name.localeCompare(b.name) : a[column] - b[column];
    return diff * way || byName(a, b);
  });
}

/** The next sort after a heading is tapped: a new column starts A to Z / lowest first; the same column reverses. */
export function sortAfterTap(current, column) {
  return current.column === column ? { column, descending: !current.descending } : { column, descending: false };
}
