// Game rules. No screen code and no storage here, so they run under `node --test`.
//
// Dates and times are kept exactly as the date and time boxes give them, as plain
// text ("2026-11-14", "08:30"). They never pass through a time zone, so a game
// cannot slip to the day before or after, whatever the phone's zone or region.

import { placeCount, startingFormation } from "./formation-rules.js";

// Fixed for now (J1-S5 is on the Later list). Stored on each game, so changing
// them later leaves old games correct.
export const FORMATION = "3-3-2";
export const HALF_MINUTES = 25;
// Line-up places in 3-3-2: 0 goal, 1-3 defence, 4-6 midfield, 7-8 forwards, each left to right.
export const POSITION_COUNT = 9;

// A game's `state`. NOT_STARTED covers "Ready for kick-off" too: nothing is saved
// until START 1ST HALF. GDA-36 adds half time and ends a game with FINISHED.
export const NOT_STARTED = "not started";
export const FIRST_HALF = "first half";
export const SECOND_HALF = "second half";
export const FINISHED = "finished";
export const NOT_PLANNED = "not planned";
export const PLANNED = "planned";

// Where a player can be, besides a place number.
export const BENCH = "bench";
export const ABSENT = "absent";

// Kinds of event in the event log. See positionChangeEvent.
export const POSITION_CHANGE = "position-change";
export const HALF_START = "half-start";
export const HALF_END = "half-end";
export const HALF_END_CANCELLED = "half-end-cancelled";
export const SWAP = "swap";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function cleanText(text) {
  return String(text ?? "").trim();
}

/** A blank detail, or one holding only spaces. */
export function isBlank(text) {
  return cleanText(text).length === 0;
}

/** What the New game screen holds before anything is typed. `marked` lists fields showing Needed. */
export function blankGameForm() {
  return { date: "", kickOff: "", opposition: "", venue: "", rotationMinutes: ROTATION_MINUTES, marked: {} };
}

/** All four details are needed. There is no minimum squad size and no date check. */
export function canCreateGame(form) {
  return [form.date, form.kickOff, form.opposition, form.venue].every((detail) => !isBlank(detail));
}

/** A line-up with every place empty. Each call gives a separate one. */
function emptyLineUp(places = POSITION_COUNT) {
  return { status: NOT_PLANNED, positions: new Array(places).fill(null) };
}

/**
 * The saved game. Later stories build on this shape:
 * - `id` never changes. It is random rather than 1, 2, 3 so that it stays unique
 *   even if the phone's data is lost and counting would start again: the Sheet
 *   uses it to skip games it already holds. Event log entries will point to it.
 * - `lineups` has one line-up per half. `positions` holds player ids, or null for
 *   an empty place. The bench is whoever is neither placed nor absent.
 *   So a player added to the squad is on the bench with nothing to save.
 *   `positions` is always where everyone is now. The event log, in its own store,
 *   is how they got there.
 * - `absent` holds player ids, on the game and not on a half (GDA-18).
 * - `benchOrder` holds the bench player ids in Ben's order (GDA-61). Nothing
 *   re-sorts it. Games saved before GDA-61 have none: benchIds starts them A to Z.
 * - `rotationMinutes` is the rotation length, 1 to 25. Games saved before GDA-32 have none and use 6.
 *
 * `squad` is the squad in alphabetical order. It fills the first half only.
 */
export function newGame(form, id, createdOrder, squad, team = null) {
  // GDA-22: the game takes the team's size, half length and starting shape, fixed for this game.
  // With no team given (older callers and tests) it is the old 9 a side, 3-3-2, 25 minutes.
  const halfMinutes = team?.halfMinutes ?? HALF_MINUTES;
  const formation = team ? startingFormation(team) : FORMATION;
  const game = {
    id,
    createdOrder,
    state: NOT_STARTED,
    date: form.date,
    kickOff: form.kickOff,
    opposition: cleanText(form.opposition),
    venue: cleanText(form.venue),
    formation,
    halfMinutes,
    rotationMinutes: clampRotation(form.rotationMinutes, halfMinutes),
    absent: [],
    lineups: { firstHalf: emptyLineUp(placeCount(formation)), secondHalf: emptyLineUp(placeCount(formation)) },
  };
  return prePlaced(game, squad);
}

/** Copies a game with a different first-half line-up. */
function withFirstHalf(game, changes) {
  const key = lineupKey(game);
  return { ...game, lineups: { ...game.lineups, [key]: { ...game.lineups[key], ...changes } } };
}

/**
 * Which line-up the line-up rules work on (GDA-20): the second half's from Half Time
 * on, the first half's before that. So the first-half line-up is never touched once
 * the second half's has been made from it. (The name withFirstHalf is older than this.)
 */
export function lineupKey(game) {
  return game.state === SECOND_HALF || isHalfTime(game) ? "secondHalf" : "firstHalf";
}
function activePositions(game) {
  return game.lineups[lineupKey(game)].positions;
}

/**
 * True until the first half has been filled. Games made before GDA-18 are saved
 * with an empty first half marked "not planned", so they are placed the first
 * time their line-up opens.
 */
export function needsPrePlacing(game) {
  return game.lineups.firstHalf.status === NOT_PLANNED;
}

/**
 * Fills the first half in squad order: goal, then defence, midfield and forwards,
 * each left to right. Whoever is left is on the bench. This runs once per game:
 * after that the line-up belongs to the coach, so it never runs again. With no
 * players there is nothing to place, so the game waits until there are some.
 */
export function prePlaced(game, squad) {
  if (!needsPrePlacing(game) || squad.length === 0) {
    return game;
  }
  const positions = game.lineups.firstHalf.positions.map((_, place) => squad[place]?.id ?? null);
  const placed = withFirstHalf(game, { status: PLANNED, positions });
  return withBenchOrder(placed, squad); // The bench starts A to Z.
}

/**
 * The bench player ids in order. The saved `benchOrder` comes first, skipping anyone
 * who is no longer on the bench (placed, absent, removed from the squad) or listed
 * twice. Anyone on the bench who is not in it (a new player, or a game saved before
 * GDA-61) follows in squad order. So nobody is lost or doubled, whatever was saved.
 */
export function benchIds(game, squad) {
  const positions = activePositions(game);
  const onBench = (id) => squad.some((player) => player.id === id) && !positions.includes(id) && !game.absent.includes(id);
  const ids = [];
  for (const id of [...(game.benchOrder ?? []), ...squad.map((player) => player.id)]) {
    if (onBench(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/** The game with its bench order saved in full, so later moves can change it in place. */
export function withBenchOrder(game, squad) {
  return { ...game, benchOrder: benchIds(game, squad) };
}

/** What the line-up shows. The bench is in Ben's order; the squad and ABSENT row are A to Z. */
export function lineUpView(game, squad) {
  const positions = activePositions(game);
  return {
    positions: positions.map((id) => squad.find((player) => player.id === id) ?? null),
    bench: benchIds(game, squad).map((id) => squad.find((player) => player.id === id)),
    absent: squad.filter((player) => game.absent.includes(player.id)),
  };
}

function firstHalfWithout(game, playerId) {
  const positions = activePositions(game).map((id) => (id === playerId ? null : id));
  return withFirstHalf(game, { positions });
}

/** Absent leaves the player's position empty. Nobody moves in by themselves. */
export function markedAbsent(game, playerId) {
  const absent = game.absent.includes(playerId) ? game.absent : [...game.absent, playerId];
  const marked = { ...firstHalfWithout(game, playerId), absent };
  return withoutFromBench(marked, playerId); // Back in puts them at the end of the bench.
}

function withoutFromBench(game, playerId) {
  return game.benchOrder ? { ...game, benchOrder: game.benchOrder.filter((id) => id !== playerId) } : game;
}

/** Back in means the bench: not being placed or absent is what puts a player there. */
export function markedBackIn(game, playerId) {
  return { ...game, absent: game.absent.filter((id) => id !== playerId) };
}

/** A player removed from the squad leaves an empty position, or simply leaves their row. */
export function withoutRemovedPlayer(game, playerId) {
  return markedBackIn(withoutFromBench(firstHalfWithout(game, playerId), playerId), playerId);
}

/** Where a player is in the first half: a place number, BENCH or ABSENT. */
export function whereIs(game, playerId) {
  if (game.absent.includes(playerId)) {
    return ABSENT;
  }
  const place = activePositions(game).indexOf(playerId);
  return place === -1 ? BENCH : place;
}

/**
 * A spot on the line-up is { playerId } for a player, or { place } for an empty
 * position. This gives the player in a spot, or null if it is empty.
 */
function playerIn(game, spot) {
  if (spot.zone) {
    return null; // The ABSENT or BENCH row itself (GDA-62): no player in it.
  }
  return spot.playerId ?? activePositions(game)[spot.place] ?? null;
}

/**
 * Moves a player onto a spot, for drag and tap alike. A player on the spot swaps
 * with them. An empty position is simply taken, leaving the old position empty.
 * Whoever leaves the pitch is on the bench with nothing to save, because the
 * bench is everyone not placed and not absent.
 *
 * Gives { game, changes }, where changes lists everyone who moved, or null if this
 * move is not allowed: anything involving an absent player, bench onto bench, or
 * a player onto themselves.
 */
export function movedOnto(game, playerId, spot) {
  const otherId = playerIn(game, spot);
  const from = whereIs(game, playerId);
  const to = otherId === null ? spot.place : whereIs(game, otherId);
  if (from === ABSENT || to === ABSENT || from === to) {
    return null;
  }
  const positions = [...activePositions(game)];
  if (from !== BENCH) {
    positions[from] = otherId;
  }
  if (to !== BENCH) {
    positions[to] = playerId;
  }
  const changes = [{ playerId, from, to }];
  if (otherId !== null) {
    changes.push({ playerId: otherId, from: to, to: from });
  }
  const moved = withFirstHalf(game, { positions });
  return { game: { ...moved, benchOrder: benchAfterMove(game.benchOrder ?? [], playerId, otherId, from, to) }, changes };
}

/**
 * The line-up screen's move (GDA-62): like movedOnto, but ABSENT is allowed, from anywhere
 * to anywhere, before kick-off. A spot can also be a whole row: { zone: "absent" } or
 * { zone: "bench" }.
 * - Onto the ABSENT row (or a player in it): marks absent. Nothing else moves.
 * - An absent player onto the bench row or a bench player: back in, at the end of the bench.
 * - An absent player onto an empty position: takes it. Onto a player: takes it and that
 *   player goes to the bench (never to ABSENT, so nobody is marked absent by accident).
 * Gives { game, changes } like movedOnto (changes is empty when only absence changed),
 * or null if the move is not allowed. After kick-off it is exactly movedOnto.
 */
export function lineUpMoved(game, playerId, spot, squad) {
  if (game.state !== NOT_STARTED) {
    return spot.zone ? null : movedOnto(game, playerId, spot);
  }
  const from = whereIs(game, playerId);
  const targetId = playerIn(game, spot);
  const toAbsent = spot.zone === "absent" || (targetId !== null && whereIs(game, targetId) === ABSENT);
  if (toAbsent) {
    return from === ABSENT ? null : { game: markedAbsent(game, playerId), changes: [] };
  }
  if (from !== ABSENT) {
    return spot.zone ? null : movedOnto(game, playerId, spot);
  }
  // An absent player coming back in: bench first (order completed so they land at the end).
  const back = withBenchOrder(markedBackIn(game, playerId), squad);
  if (spot.zone === "bench" || (targetId !== null && whereIs(back, targetId) === BENCH)) {
    return { game: back, changes: [] };
  }
  return movedOnto(back, playerId, spot);
}

/**
 * The bench order after a move (GDA-61): whoever comes off takes the exact spot of
 * whoever goes on, and nobody else moves. A bench player onto an empty position
 * just leaves the bench. `order` must already be complete (see withBenchOrder).
 */
function benchAfterMove(order, playerId, otherId, from, to) {
  if (from === BENCH) {
    return otherId === null ? order.filter((id) => id !== playerId) : order.map((id) => (id === playerId ? otherId : id));
  }
  if (to === BENCH) {
    return order.map((id) => (id === otherId ? playerId : id));
  }
  return order;
}

/** True if both players are on the bench, so dragging one onto the other re-orders it. */
export function canReorderBench(game, playerId, targetId) {
  // An empty position has no player (targetId undefined): that is a move, not a reorder.
  return typeof targetId === "number" && playerId !== targetId && whereIs(game, playerId) === BENCH && whereIs(game, targetId) === BENCH;
}

/**
 * Drags a bench player along the bench: they take the spot of the player they are
 * dropped on, and those between shift along by one. Gives null if not allowed.
 * `order` must already be complete (see withBenchOrder).
 */
export function benchReordered(game, playerId, targetId) {
  if (!canReorderBench(game, playerId, targetId)) {
    return null;
  }
  const order = (game.benchOrder ?? []).filter((id) => id !== playerId);
  order.splice((game.benchOrder ?? []).indexOf(targetId), 0, playerId);
  return { ...game, benchOrder: order };
}

/** Only a player who is not absent can be dragged. An empty position cannot. */
export function canDrag(game, spot) {
  // Before kick-off an absent player can be dragged too (GDA-62).
  return spot.playerId !== undefined && (game.state === NOT_STARTED || whereIs(game, spot.playerId) !== ABSENT);
}

/**
 * What a tap on a spot does: gives the player selected afterwards, and whether the
 * selected player moves onto the spot. A second tap on a player cancels. A tap on
 * another player in the same row moves the selection. A tap that cannot be a move
 * changes nothing, so the first player stays selected.
 */
export function afterTap(game, selectedId, spot, canMoveOnto = (g, id, s) => movedOnto(g, id, s) !== null) {
  const tappedId = playerIn(game, spot);
  if (selectedId === null) {
    return { selectedId: tappedId, move: false };
  }
  if (selectedId === tappedId) {
    return { selectedId: null, move: false };
  }
  if (canMoveOnto(game, selectedId, spot)) {
    return { selectedId, move: true };
  }
  const sameRow = tappedId !== null && whereIs(game, tappedId) === whereIs(game, selectedId);
  return { selectedId: sameRow ? tappedId : selectedId, move: false };
}

/**
 * One record in the event log. Every event has `gameId`, `type` and `at`, the real
 * time in milliseconds. The game clock is worked out from `at` and the half's real
 * start time, so position time needs nothing more once the clock exists (GDA-24).
 * `changes` is what movedOnto gives, so a swap is one event with one time for both
 * players. `from` and `to` are place numbers or BENCH.
 */
export function positionChangeEvent(gameId, changes, at, half = "firstHalf") {
  return { gameId, type: POSITION_CHANGE, at, half, changes };
}

/**
 * START 1ST HALF. The real start time (milliseconds) is saved on the game, and the
 * clock is always worked out from it. Starting a game that has already started
 * gives the game back unchanged, so a second tap can never restart the clock.
 */
export function startedFirstHalf(game, at) {
  if (game.state !== NOT_STARTED) {
    return game;
  }
  return { ...game, state: FIRST_HALF, firstHalfStartedAt: at };
}

/** The event log entry for a half starting, at the real time `at`. */
export function halfStartEvent(gameId, at, half = "firstHalf") {
  return { gameId, type: HALF_START, at, half };
}

/**
 * Is this game under way? From START 1ST HALF until the game is closed, half time
 * included. Ready for kick-off is not. A state this code does not know counts as
 * under way: if we cannot tell, an update must not go on mid-game.
 */
export function isInProgress(game) {
  return game.state !== NOT_STARTED && game.state !== FINISHED;
}

/** True if any saved game is under way. */
export function anyInProgress(games) {
  return games.some(isInProgress);
}

/**
 * The clock text, "12:34", worked out from the saved real start time and the real
 * time now (both in milliseconds), never from counting ticks. A phone clock set
 * back cannot make it negative. The clock keeps running past the half length and
 * then shows the time over, "+0:01" (GDA-36); at exactly 25:00 it shows "25:00".
 */
export function clockText(startedAt, now, halfMinutes = HALF_MINUTES) {
  const elapsed = Math.floor((now - startedAt) / 1000);
  const seconds = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const text = (total) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  const half = halfMinutes * 60;
  return seconds > half ? "+" + text(seconds - half) : text(seconds);
}

/**
 * Has the clock reached the half length? Worked out from the same saved start time
 * as the clock, so a locked phone cannot miss it. Drives the TIME strip.
 */
export function isTimeUp(startedAt, now, halfMinutes = HALF_MINUTES) {
  const elapsed = Math.floor((now - startedAt) / 1000);
  return Number.isFinite(elapsed) && elapsed >= halfMinutes * 60;
}

/** A new game starts with this rotation length, and so does a game saved before GDA-32. */
export const ROTATION_MINUTES = 6;
export const MIN_ROTATION = 1;
export const MAX_ROTATION = 25; // The most a half can be, and so the most any rotation can be.

/** A whole number of minutes from 1 to 25. Anything else becomes the default 6. */
export function clampRotation(minutes, halfMinutes = MAX_ROTATION) {
  // GDA-22: never longer than the game's half. The default 6 is also held to it.
  const top = Math.max(MIN_ROTATION, Math.min(MAX_ROTATION, halfMinutes));
  if (!Number.isFinite(minutes)) {
    return Math.min(ROTATION_MINUTES, top);
  }
  return Math.min(top, Math.max(MIN_ROTATION, Math.round(minutes)));
}

/** The game's rotation length in minutes; 6 for games saved without one. */
export function rotationOf(game) {
  return clampRotation(game?.rotationMinutes ?? ROTATION_MINUTES, halfOf(game));
}

/** The game's own half length in minutes (25 for games saved without one). */
export function halfOf(game) {
  return game?.halfMinutes ?? HALF_MINUTES;
}

/** Copies a game with a different formation. Only the grouping changes: the same places, so nobody moves. */
export function withFormation(game, formation) {
  return { ...game, formation };
}

/** Copies a game with a new rotation length. Timers are not touched: they are measured against it from now on. */
export function withRotation(game, minutes) {
  return { ...game, rotationMinutes: clampRotation(minutes, halfOf(game)) };
}

/**
 * How long a bench player has been on the bench, in whole seconds. Worked out from
 * saved times, never from ticks: the clock time they went to the bench (`benchSince`,
 * saved by Swap in GDA-30; until then everyone has been there since kick-off) up to
 * now, or up to End Half when the half is over, so the timers stop with the clock.
 */
export function benchSeconds(game, playerId, now) {
  const since = game.benchSince?.[playerId] ?? startedAtOf(game);
  const until = isHalfEnded(game) ? endedAtOf(game) : now;
  const seconds = Math.floor((until - since) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

/** "2:05". Past the rotation length it just keeps counting, e.g. "7:10". */
export function benchTimerText(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** How full the ring is, 0 to 1: half full at half the rotation, full at the rotation length. */
export function ringFraction(seconds, rotationMinutes = ROTATION_MINUTES) {
  return Math.min(1, Math.max(0, seconds / (rotationMinutes * 60)));
}

/** Is the player past the rotation length? */
export function isBenchLate(seconds, rotationMinutes = ROTATION_MINUTES) {
  return seconds > rotationMinutes * 60;
}

/** A finished stint within this many seconds of the rotation length counts as a full rotation (GDA-84). */
export const FROZEN_RING_TOLERANCE_SECONDS = 60;

/**
 * How a frozen ring (a finished bench stint on a field player) looks, rounded out:
 * within 1 minute of the rotation length (either side) = full ring, not late;
 * over rotation + 1 minute = full and late; under rotation - 1 minute = part ring.
 * The live bench ring and swap message do not use this.
 */
export function frozenRingLook(seconds, rotationMinutes = ROTATION_MINUTES) {
  const full = rotationMinutes * 60;
  if (seconds > full + FROZEN_RING_TOLERANCE_SECONDS) return { fraction: 1, late: true };
  if (seconds >= full - FROZEN_RING_TOLERANCE_SECONDS) return { fraction: 1, late: false };
  return { fraction: ringFraction(seconds, rotationMinutes), late: false };
}

/** The swap warning starts this many seconds before a bench player is due (fixed in the MVP). */
export const WARN_SECONDS = 30;

/**
 * The swap message (GDA-35), worked out from the saved bench times and the rotation
 * length every time, with nothing stored, so it is right after a lock, a reload, an
 * Undo or a changed length. Gives null when nothing is due or near, else
 * { phase: "warn" | "due", countdown (warn), late (due), onIds, offIds, paired }:
 * `onIds` are the bench players to name, in bench order; `paired` is the list of
 * { offId, onId } for those who have a planned partner. Due players always win over
 * players only near their time. No message once the half is over.
 */
export function swapMessage(game, squad, now) {
  if (isHalfEnded(game)) {
    return null;
  }
  const limit = rotationOf(game) * 60;
  const timed = benchIds(game, squad).map((id) => ({ id, seconds: benchSeconds(game, id, now) }));
  const due = timed.filter((entry) => entry.seconds >= limit);
  const near = timed.filter((entry) => entry.seconds >= limit - WARN_SECONDS && entry.seconds < limit);
  const named = due.length > 0 ? due : near;
  if (named.length === 0) {
    return null;
  }
  const paired = [];
  for (const entry of named) {
    const pair = pairsOf(game).find((one) => one.benchId === entry.id && one.fieldId !== null);
    if (pair) {
      paired.push({ offId: pair.fieldId, onId: entry.id });
    }
  }
  const message = { onIds: named.map((entry) => entry.id), paired };
  if (due.length > 0) {
    return { ...message, phase: "due", late: Math.max(...due.map((entry) => entry.seconds)) - limit };
  }
  return { ...message, phase: "warn", countdown: limit - Math.max(...near.map((entry) => entry.seconds)) };
}

/**
 * End Half in the first half: saves the real time it was tapped (`at`) and opens Half
 * Time (GDA-31). The state stays FIRST_HALF on purpose, so the game still counts as in
 * progress for updates. The second-half line-up is made now as a copy of where
 * everyone stands, and the bench order is kept so the back arrow can put it back
 * (GDA-20). Ending twice, or a game not in its first half, gives the game back
 * unchanged: the first End Half time is kept.
 */
export function endedFirstHalf(game, at) {
  if (game.state !== FIRST_HALF || isHalfEnded(game)) {
    return game;
  }
  const positions = [...game.lineups.firstHalf.positions];
  return {
    ...game,
    firstHalfEndedAt: at,
    plannedPairs: [], // Planned pairs do not survive End Half, and do not come back with the back arrow (GDA-36).
    benchOrderAtEndHalf: game.benchOrder ?? [],
    lineups: { ...game.lineups, secondHalf: { status: PLANNED, positions } },
  };
}

/**
 * The back arrow on Half Time: takes the end time away, so the first half is running
 * again as if End Half was never tapped, and throws the half-time changes away (Ben,
 * 2026-11-08). The start time and the first-half line-up are never touched.
 */
export function reopenedFirstHalf(game) {
  if (!isHalfTime(game)) {
    return game;
  }
  const { benchOrderAtEndHalf, ...rest } = game;
  return {
    ...rest,
    firstHalfEndedAt: null,
    benchOrder: benchOrderAtEndHalf ?? game.benchOrder,
    lineups: { ...game.lineups, secondHalf: emptyLineUp(game.lineups?.firstHalf?.positions?.length) },
  };
}

/**
 * Start 2nd Half (GDA-31): the second half's clock starts at once from `at`. Bench
 * timers start again from 0:00 for everyone on the bench (benchSince is cleared, so
 * they fall back to the half's start). Bench numbers (benchNumbers) are left alone. Gives the
 * game back unchanged if it is not at Half Time, so a double tap starts it once.
 */
export function startedSecondHalf(game, at) {
  if (!isHalfTime(game)) {
    return game;
  }
  const { benchOrderAtEndHalf, ...rest } = game;
  // Bench time (GDA-29): the first half's bench time carries on. Everyone who was on the bench when the
  // half ended gets that last stint added now; the half-time break itself adds nothing (it stops at End Half).
  const benchTotals = { ...game.benchTotals };
  for (const id of benchOrderAtEndHalf ?? []) {
    benchTotals[id] = benchTotalSeconds(game, id, at);
  }
  return { ...rest, state: SECOND_HALF, secondHalfStartedAt: at, benchSince: {}, benchTotals, plannedPairs: [] };
}

/** End Half in the second half: saves the time. The full-time screen is GDA-50. */
export function endedSecondHalf(game, at) {
  if (game.state !== SECOND_HALF || isHalfEnded(game)) {
    return game;
  }
  return { ...game, secondHalfEndedAt: at, plannedPairs: [] };
}

/** The back arrow after a second-half End Half: the half runs again. */
export function reopenedSecondHalf(game) {
  return game.state === SECOND_HALF && isHalfEnded(game) ? { ...game, secondHalfEndedAt: null } : game;
}

/** End Half, whichever half is running. */
export function endedHalf(game, at) {
  return game.state === SECOND_HALF ? endedSecondHalf(game, at) : endedFirstHalf(game, at);
}

/** The back arrow after End Half, whichever half it was. */
export function reopenedHalf(game) {
  return game.state === SECOND_HALF ? reopenedSecondHalf(game) : reopenedFirstHalf(game);
}

/** The real start time of the half being played (or just ended). */
export function startedAtOf(game) {
  return game.state === SECOND_HALF ? game.secondHalfStartedAt : game.firstHalfStartedAt;
}

/** The real End Half time of the half being played, or undefined/null if it has not ended. */
export function endedAtOf(game) {
  return game.state === SECOND_HALF ? game.secondHalfEndedAt : game.firstHalfEndedAt;
}

/** True once End Half has been tapped for the current half and not taken back. */
export function isHalfEnded(game) {
  return typeof endedAtOf(game) === "number";
}

/** Half Time: the first half has ended and the second has not started. */
export function isHalfTime(game) {
  return game.state === FIRST_HALF && typeof game.firstHalfEndedAt === "number";
}

/**
 * Which screen a game in progress opens on: Half Time after the first half's End Half,
 * the Full Time screen after the second half's, otherwise the game.
 */
export function screenForOpening(game) {
  if (!isInProgress(game)) {
    return "lineUp";
  }
  if (isHalfTime(game)) {
    return "halfTime";
  }
  return isHalfEnded(game) ? "over" : "game";
}

/**
 * After a restart: which saved game must open straight back up? The one under way
 * (the one started last, if there are several), or null if none. `ok` says whether
 * its saved data can be shown; if not, the app must not open a broken game screen
 * (it goes to Home instead, and updates stay held back because the game still counts
 * as under way).
 */
export function gameToResume(games) {
  const live = games.filter(isInProgress);
  if (live.length === 0) {
    return null;
  }
  const last = [...live].sort((a, b) => (Number(b.firstHalfStartedAt) || 0) - (Number(a.firstHalfStartedAt) || 0))[0];
  const positions = last.lineups?.[lineupKey(last)]?.positions;
  const ok =
    Number.isFinite(last.firstHalfStartedAt) &&
    (last.state !== SECOND_HALF || Number.isFinite(last.secondHalfStartedAt)) &&
    Array.isArray(positions) &&
    (lineupKey(last) === "firstHalf" || last.lineups.secondHalf.status === PLANNED) &&
    Array.isArray(last.benchOrder) &&
    [last.firstHalfEndedAt, last.secondHalfEndedAt].every((end) => end === undefined || end === null || Number.isFinite(end));
  return { game: last, ok, screen: screenForOpening(last) };
}

/** The event log entries for End Half, and for taking it back. */
export function halfEndEvent(gameId, at, half = "firstHalf") {
  return { gameId, type: HALF_END, at, half };
}
export function halfEndCancelledEvent(gameId, at, half = "firstHalf") {
  return { gameId, type: HALF_END_CANCELLED, at, half };
}

/** The number for a new game: one more than the highest so far. */
export function nextCreatedOrder(games) {
  return games.reduce((highest, game) => Math.max(highest, game.createdOrder), 0) + 1;
}

/** Soonest kick-off first. With the same kick-off, the one created first comes first. */
export function gamesInOrder(games) {
  return [...games].sort((a, b) => {
    const first = a.date + " " + a.kickOff;
    const second = b.date + " " + b.kickOff;
    if (first === second) {
      return a.createdOrder - b.createdOrder;
    }
    return first < second ? -1 : 1;
  });
}

/** "2026-11-14" becomes "Sat 14 Nov". Worked out in UTC only so no time zone can move the day. */
export function formatGameDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  const calendarDay = new Date(0);
  calendarDay.setUTCFullYear(year, month - 1, day);
  return `${DAYS[calendarDay.getUTCDay()]} ${day} ${MONTHS[month - 1]}`;
}

/** "08:30" becomes "8:30 am". Written out by hand so the phone's region cannot change it. */
export function formatKickOff(kickOff) {
  const [hours, minutes] = kickOff.split(":");
  const hour = Number(hours);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minutes} ${hour < 12 ? "am" : "pm"}`;
}

// ---------------------------------------------------------------------------
// Changes during a game (GDA-30). Before kick-off a bench player moves onto the
// pitch at once (movedOnto). During a game they only come on through the plan and
// Swap. A planned pair is { benchId, fieldId, place }: the bench player, and either
// the field player they replace (fieldId, so the pair follows that child if they
// move) or an empty position (fieldId null, place set). Saved as `plannedPairs`.
// ---------------------------------------------------------------------------

export function pairsOf(game) {
  return game.plannedPairs ?? [];
}

/**
 * What dropping or tapping a player on a spot does during a game, or null if nothing:
 * "reorder" (bench onto bench: re-orders only), "move" (field to field, at once) or
 * "plan" (bench with field or an empty position: planned, nothing moves).
 */
export function liveAction(game, playerId, spot) {
  const targetId = playerIn(game, spot);
  if (canReorderBench(game, playerId, targetId ?? undefined)) {
    return "reorder";
  }
  const from = whereIs(game, playerId);
  const to = targetId === null ? spot.place : whereIs(game, targetId);
  if (from === ABSENT || to === ABSENT || from === to) {
    return null;
  }
  return from === BENCH || to === BENCH ? "plan" : "move";
}

/** True for the actions that have a tap version. Bench re-ordering is drag only (Ben, GDA-61). */
export function canTapLive(game, playerId, spot) {
  const action = liveAction(game, playerId, spot);
  return action === "plan" || action === "move";
}

/**
 * Plans a pair. A new pair replaces an old one that has the same bench player or the
 * same target, so each child and each position is in at most one pair.
 */
export function pairPlanned(game, playerId, spot) {
  if (liveAction(game, playerId, spot) !== "plan") {
    return null;
  }
  const targetId = playerIn(game, spot);
  const benchId = whereIs(game, playerId) === BENCH ? playerId : targetId;
  const pair =
    benchId === playerId
      ? { benchId, fieldId: targetId, place: targetId === null ? spot.place : null }
      : { benchId, fieldId: playerId, place: null };
  const kept = pairsOf(game).filter((old) => old.benchId !== benchId && (pair.fieldId !== null ? old.fieldId !== pair.fieldId : old.place !== pair.place));
  return { ...game, plannedPairs: [...kept, pair] };
}

/** The cross on a line: takes that bench player's pair away. */
export function pairRemoved(game, benchId) {
  return { ...game, plannedPairs: pairsOf(game).filter((pair) => pair.benchId !== benchId) };
}

/**
 * A field player moves onto another or onto an empty position, at once. Gives
 * { game, changes } like movedOnto, or null. Pairs stay with their child; a pair that
 * aimed at the empty position just filled now points at the player who filled it.
 */
export function fieldMoved(game, playerId, spot) {
  if (liveAction(game, playerId, spot) !== "move") {
    return null;
  }
  const moved = movedOnto(game, playerId, spot);
  const pairs = pairsOf(game).map((pair) => (pair.fieldId === null && pair.place === spot.place ? { ...pair, fieldId: playerId, place: null } : pair));
  return { game: { ...moved.game, plannedPairs: pairs }, changes: moved.changes };
}

/**
 * Swap: carries out every planned pair at the real time `at`, in one go. Whoever
 * comes off takes the exact bench spot of whoever goes on (GDA-61) and starts at
 * 0:00 on the bench (benchSince, GDA-23); whoever goes on loses their timer.
 * Gives { game, changes } or null if there is nothing to swap. A pair that no longer
 * fits (should not happen) is dropped rather than half done.
 * `game.benchOrder` must already be complete (see withBenchOrder).
 */
export function swapped(game, at) {
  const positions = [...activePositions(game)];
  let order = [...(game.benchOrder ?? [])];
  const benchSince = { ...game.benchSince };
  // Bench numbers (GDA-56): { playerId: 1, 2, 3... } in the order players first came off the bench.
  // Kept for the whole game; a player keeps their first number. Pairs are handled in strip order.
  const benchNumbers = { ...game.benchNumbers };
  // Bench time (GDA-29): seconds of finished bench stints, per player. A stint is added when the player goes on.
  const benchTotals = { ...game.benchTotals };
  let nextNumber = Math.max(0, ...Object.values(benchNumbers)) + 1;
  const changes = [];
  for (const pair of pairsOf(game)) {
    const place = pair.fieldId !== null ? positions.indexOf(pair.fieldId) : pair.place;
    const fits = order.includes(pair.benchId) && place !== -1 && positions[place] === pair.fieldId;
    if (!fits) {
      continue;
    }
    positions[place] = pair.benchId;
    order = benchAfterMove(order, pair.benchId, pair.fieldId, BENCH, place);
    benchTotals[pair.benchId] = (benchTotals[pair.benchId] ?? 0) + benchSeconds(game, pair.benchId, at);
    delete benchSince[pair.benchId];
    if (!benchNumbers[pair.benchId]) {
      benchNumbers[pair.benchId] = nextNumber++; // First time off the bench: takes the next number.
    }
    changes.push({ playerId: pair.benchId, from: BENCH, to: place });
    if (pair.fieldId !== null) {
      benchSince[pair.fieldId] = at;
      changes.push({ playerId: pair.fieldId, from: place, to: BENCH });
    }
  }
  if (changes.length === 0) {
    return null;
  }
  return { game: { ...withFirstHalf(game, { positions }), benchOrder: order, benchSince, benchNumbers, benchTotals, plannedPairs: [] }, changes };
}

/**
 * Undo after Swap: puts back the players, the bench order, the bench times and the
 * planned pairs and the bench numbers, from `before`, the game as it was just before Swap.
 */
export function swapUndone(game, before) {
  const restored = withFirstHalf(game, { positions: before.lineups[lineupKey(before)].positions });
  return { ...restored, benchOrder: before.benchOrder, benchSince: before.benchSince, benchNumbers: before.benchNumbers ?? {}, benchTotals: before.benchTotals ?? {}, plannedPairs: before.plannedPairs ?? [] };
}

/**
 * Can Ben change who is here (GDA-43)? Once the game has started, until Full Time.
 * Before kick-off the line-up screen does it; after Full Time it is final.
 */
export function canChangeWhoIsHere(game) {
  return game.state === FIRST_HALF || game.state === SECOND_HALF;
}

/**
 * The picker's Done (GDA-43): which players need toggling so the game matches the draft.
 * `hereIds` is the set of players ticked as here. Gives ids in squad order, only those that differ.
 */
export function hereDifferences(game, squadIds, hereIds) {
  return squadIds.filter((id) => hereIds.has(id) === game.absent.includes(id));
}

/**
 * One tap on a player in the Here / Not here list (GDA-43), during a game. `game.benchOrder`
 * must already be complete (see withBenchOrder). Gives { game, changes } or null if not allowed.
 * - Not here -> Here: end of the bench, bench timer from 0:00 at `at`, no turn counted.
 * - Bench -> Not here: leaves the bench; the others keep their order and timers. The time on
 *   the bench so far is kept in benchTotals, so it is not lost if they come back.
 * - Pitch -> Not here: the position is left empty and nobody moves in. The leaving is logged as
 *   a move to the bench (`changes`), so the record still counts the time they played.
 * Tapping again reverses it. A leaver's planned swap line is dropped.
 */
export function hereToggled(game, playerId, at) {
  if (!canChangeWhoIsHere(game)) {
    return null;
  }
  if (game.absent.includes(playerId)) {
    const benchSince = { ...game.benchSince, [playerId]: at };
    const order = (game.benchOrder ?? []).filter((id) => id !== playerId);
    return { game: { ...markedBackIn(game, playerId), benchOrder: [...order, playerId], benchSince }, changes: [] };
  }
  const place = activePositions(game).indexOf(playerId);
  const onBench = (game.benchOrder ?? []).includes(playerId);
  if (place === -1 && !onBench) {
    return null;
  }
  const benchTotals = { ...game.benchTotals };
  const benchSince = { ...game.benchSince };
  if (onBench) {
    benchTotals[playerId] = (benchTotals[playerId] ?? 0) + benchSeconds(game, playerId, at);
    delete benchSince[playerId];
  }
  const away = pairRemoved(markedAbsent(game, playerId), playerId);
  const gone = { ...away, plannedPairs: pairsOf(away).filter((pair) => pair.fieldId !== playerId), benchTotals, benchSince };
  return { game: gone, changes: place === -1 ? [] : [{ playerId, from: place, to: BENCH }] };
}

/** The event log entry for a Swap: one event, one time, all the players who moved. */
export function swapEvent(gameId, changes, at, half = "firstHalf") {
  return { gameId, type: SWAP, at, half, changes };
}

/**
 * Bench time this game (GDA-29), in seconds, across both halves: the finished stints
 * (`benchTotals`) plus the stint the player is in now, if they are on the bench. Worked out
 * from saved times every time, so it is right after a reload or with the app closed (real
 * time keeps counting, like the bench timers). At Half Time the bench is the one saved at
 * End Half, and the stint stops there, so the break adds nothing.
 */
export function benchTotalSeconds(game, playerId, now) {
  const benchNow = isHalfTime(game) ? game.benchOrderAtEndHalf ?? game.benchOrder : game.benchOrder;
  const current = (benchNow ?? []).includes(playerId) ? benchSeconds(game, playerId, now) : 0;
  return (game.benchTotals?.[playerId] ?? 0) + current;
}

/**
 * The frozen bench rings (GDA-80): for each player who has come on from the bench in the half being
 * played, a list with one entry per stint on the bench, oldest first: how many seconds it lasted, up
 * to the moment they came on. Worked out from the saved event log (swaps and instant moves), so nothing
 * extra is stored and Undo (which deletes the swap's event) takes the ring away again. A stint starts
 * when the player went to the bench in this half, or at the half's start. Players who never came on
 * from the bench have no entry. `events` are this game's events, any order.
 */
export function benchStints(game, events) {
  const half = lineupKey(game);
  const start = startedAtOf(game);
  if (typeof start !== "number") {
    return {};
  }
  const live = events
    .filter((e) => (e.type === SWAP || e.type === POSITION_CHANGE) && e.half === half && e.at >= start)
    .sort((a, b) => a.at - b.at || (a.id ?? 0) - (b.id ?? 0));
  const benchedAt = {}; // playerId -> when the current stint began
  const stints = {};
  for (const event of live) {
    for (const change of event.changes) {
      if (change.to === BENCH && change.from !== BENCH) {
        benchedAt[change.playerId] = event.at;
      } else if (change.from === BENCH && typeof change.to === "number") {
        const seconds = Math.max(0, Math.floor((event.at - (benchedAt[change.playerId] ?? start)) / 1000));
        (stints[change.playerId] ??= []).push(seconds);
        delete benchedAt[change.playerId];
      }
    }
  }
  return stints;
}

/** "4m": whole minutes, rounded down. Under a minute gives "" (nothing shown). */
export function benchTotalText(seconds) {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 1 ? `${minutes}m` : "";
}

/** The player's bench-order number (GDA-56), or null if they have not come off the bench. */
export function benchNumberOf(game, playerId) {
  return game.benchNumbers?.[playerId] ?? null;
}

// ---- Goals (GDA-37, 38, 39, 40) ----
// `game.goals` is a list, oldest first. Each goal is { id, side, scorerId, half }:
// side is "us" or "them"; scorerId is a player id, or null for "Not sure" and for goals
// against; half is "firstHalf" or "secondHalf" (so the record, GDA-46, can show it).
// The score is never stored: it is counted from this list, so it can never disagree
// with it. Games saved before goals existed have no list and score 0-0.
export const US = "us";
export const THEM = "them";

/** The goals of a game, oldest first. */
export function goalsOf(game) {
  return game.goals ?? [];
}

/** The score, counted from the goals: { us, them }. Never below 0. */
export function scoreOf(game) {
  const goals = goalsOf(game);
  return { us: goals.filter((goal) => goal.side === US).length, them: goals.filter((goal) => goal.side === THEM).length };
}

/** "2 - 1" style text for the score, used in the remove confirm. */
export function scoreText(score) {
  return `${score.us}-${score.them}`;
}

/** Goals can be added only while a half is running (not before kick-off, at Half Time, after End Half or Full Time). */
export function canAddGoal(game) {
  return (game.state === FIRST_HALF || game.state === SECOND_HALF) && !isHalfEnded(game);
}

/** The player ids on the field right now, in position order. Only these can be offered as scorer. */
export function fieldPlayerIds(game) {
  return activePositions(game).filter((id) => id !== null && id !== undefined);
}

/** Adds a goal. `goal` is { id, side, scorerId }. Gives the game unchanged if goals are not allowed now. */
export function goalAdded(game, goal) {
  if (!canAddGoal(game)) {
    return game;
  }
  const side = goal.side === THEM ? THEM : US;
  const scorerId = side === US && fieldPlayerIds(game).includes(goal.scorerId) ? goal.scorerId : null;
  const half = game.state === SECOND_HALF ? "secondHalf" : "firstHalf";
  return { ...game, goals: [...goalsOf(game), { id: goal.id, side, scorerId, half }] };
}

/** Takes away the goal with this id (Undo on the toast). An id that is not there changes nothing. */
export function goalRemoved(game, goalId) {
  return { ...game, goals: goalsOf(game).filter((goal) => goal.id !== goalId) };
}

/** The most recent goal, or null if there are none. */
export function lastGoal(game) {
  const goals = goalsOf(game);
  return goals.length > 0 ? goals[goals.length - 1] : null;
}

/** "Remove last goal" works in any half and at Half Time, but not after Full Time, and needs a goal to remove. */
export function canRemoveLastGoal(game) {
  return isInProgress(game) && lastGoal(game) !== null;
}
