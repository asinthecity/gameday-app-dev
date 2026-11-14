// Game rules. No screen code and no storage here, so they run under `node --test`.
//
// Dates and times are kept exactly as the date and time boxes give them, as plain
// text ("2026-11-14", "08:30"). They never pass through a time zone, so a game
// cannot slip to the day before or after, whatever the phone's zone or region.

import { fitsTeam, formationOf, placeCount, startingFormation } from "./formation-rules.js";

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
  return { date: "", kickOff: "", opposition: "", venueTag: "", venue: "", rotationMinutes: ROTATION_MINUTES, rotationExtraSeconds: 0, carryRotationOrder: true, carryBenchTime: true, marked: {} };
}

/**
 * GDA-88: where the game is played. `venueTag` is one of these three (none chosen at first).
 * `venue` on a game is now the optional "Field" text; games saved before GDA-88 keep their old
 * venue text there and have no tag, so they need no migration.
 */
export const VENUE_TAGS = ["Home", "Away"];

/** Date, kick-off, opposition and a Home / Away / Other choice are needed. Field is optional. */
export function canCreateGame(form) {
  return [form.date, form.kickOff, form.opposition].every((detail) => !isBlank(detail)) && VENUE_TAGS.includes(form.venueTag);
}

/** What the Home card shows where the venue used to be: "Away \u00b7 Field 3", "Away", or an older game's venue text. */
export function venueLine(game) {
  return [VENUE_TAGS.includes(game.venueTag) ? game.venueTag : "", cleanText(game.venue)].filter(Boolean).join(" \u00b7 ");
}

/** Copies a game with a new tag and/or Field text (the Game details sheet). Anything else is untouched. */
export function withVenue(game, change) {
  const next = { ...game };
  if ("venueTag" in change && VENUE_TAGS.includes(change.venueTag)) {
    next.venueTag = change.venueTag;
  }
  if ("venue" in change) {
    next.venue = cleanText(change.venue);
  }
  return next;
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
 * - `rotationMinutes` is the rotation length's whole minutes, 1 to 25, and `rotationExtraSeconds` the 0, 15, 30 or 45
 *   seconds on top (GDA-106). Games saved before GDA-32 have none and use 6; games saved before GDA-106 have no seconds (0).
 *
 * `squad` is the squad in alphabetical order. It fills the first half only.
 */
export function newGame(form, id, createdOrder, squad, team = null) {
  // GDA-22: the game takes the team's size, half length and starting shape, fixed for this game.
  // With no team given (older callers and tests) it is the old 9 a side, 3-3-2, 25 minutes.
  const halfMinutes = team?.halfMinutes ?? HALF_MINUTES;
  // GDA-127: a shape typed on the Create game form is used for both halves if it fits the team.
  const formation = team ? (form.formation && fitsTeam(form.formation, team.playersPerSide) ? form.formation : startingFormation(team)) : FORMATION;
  const game = {
    id,
    createdOrder,
    state: NOT_STARTED,
    date: form.date,
    kickOff: form.kickOff,
    opposition: cleanText(form.opposition),
    venueTag: form.venueTag,
    venue: cleanText(form.venue),
    formation,
    halfMinutes,
    rotationMinutes: clampRotation(form.rotationMinutes, halfMinutes),
    rotationExtraSeconds: snappedSeconds(form.rotationExtraSeconds, clampRotation(form.rotationMinutes, halfMinutes), halfMinutes),
    carryRotationOrder: form.carryRotationOrder !== false, // GDA-86: default ON (today's behaviour)
    carryBenchTime: form.carryBenchTime !== false, // GDA-105: a new game starts ON (games already saved keep their own value)
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
 * Which line-up the line-up rules work on (GDA-97): the second half's while the 2nd half is
 * being played, the first half's before that (so half time no longer switches it). The one
 * other case is the in-memory "plan view" (see planView), which points the rules at the
 * 2nd-half plan so planning can never touch the running 1st half.
 * (The name withFirstHalf is older than this.)
 */
export function lineupKey(game) {
  return game.state === SECOND_HALF || game.planView ? "secondHalf" : "firstHalf";
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

/**
 * What a half screen shows (GDA-95, GDA-97).
 * - 2nd Half before it starts: the 2nd-half plan (see planView), whether or not it has been touched.
 * - 2nd Half once started: the running line-up.
 * - 1st Half: the 1st-half line-up. Once the 2nd half has started, its bench is as the 1st half finished
 *   (`firstHalfBenchOrder`), because the running bench order now belongs to the 2nd half.
 */
export function halfLineUpView(game, squad, half) {
  if (half === 2) {
    return lineUpView(game.state === SECOND_HALF ? game : planView(game, squad), squad);
  }
  if (game.state !== SECOND_HALF) {
    return lineUpView(game, squad);
  }
  const positions = game.lineups.firstHalf.positions;
  const onBench = (id) => squad.some((player) => player.id === id) && !positions.includes(id) && !game.absent.includes(id);
  const ids = [];
  for (const id of [...(game.firstHalfBenchOrder ?? game.benchOrder ?? []), ...squad.map((player) => player.id)]) {
    if (onBench(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return {
    positions: positions.map((id) => squad.find((player) => player.id === id) ?? null),
    bench: ids.map((id) => squad.find((player) => player.id === id)),
    absent: squad.filter((player) => game.absent.includes(player.id)),
  };
}

// ---- The 2nd-half plan (GDA-97) ----
// `lineups.secondHalf` is the plan. Its `status` is the "touched" flag: NOT_PLANNED means nobody has
// touched it, so it simply follows the 1st half as it is now; PLANNED means Ben has moved someone or
// re-ordered the bench on the plan, so it is a copy with its own `positions` and `benchOrder` that
// nothing in the 1st half can change. Looking at the plan never touches it.

/** Can the 2nd-half plan be edited? From before kick-off until the 2nd half starts. */
export function canPlan(game) {
  return game.state === NOT_STARTED || game.state === FIRST_HALF;
}

/**
 * The game as the plan sees it, in memory only: `planView: true` points the line-up rules at the
 * plan's positions, and `benchOrder` is the plan's bench (completed with anyone unplaced and not absent,
 * so a late arrival is at the end). Absent players, and players no longer in the squad, show as empty places.
 * Games saved at half time by version 42 have a plan with no bench of its own: their `benchOrder` was it.
 */
export function planView(game, squad) {
  const plan = game.lineups.secondHalf;
  const touched = plan.status === PLANNED;
  const source = touched ? plan.positions : game.lineups.firstHalf.positions;
  const here = (id) => id !== null && id !== undefined && !game.absent.includes(id) && squad.some((player) => player.id === id);
  const positions = source.map((id) => (here(id) ? id : null));
  const bench = touched ? plan.benchOrder ?? game.benchOrder : game.benchOrder;
  const view = { ...game, planView: true, benchOrder: bench ?? [], lineups: { ...game.lineups, secondHalf: { ...plan, positions } } };
  return { ...view, benchOrder: benchIds(view, squad) };
}

/** Writes a changed plan view back: only the plan's positions and bench, marked touched. Nothing else changes. */
function planSaved(game, view) {
  const before = game.lineups.secondHalf.status === PLANNED ? game.lineups.secondHalf.positions : game.lineups.firstHalf.positions;
  // An absent player's place shows empty; if it is still empty, it stays theirs for when they come back.
  const positions = view.lineups.secondHalf.positions.map((id, place) => (id === null && before[place] != null && game.absent.includes(before[place]) ? before[place] : id));
  return { ...game, lineups: { ...game.lineups, secondHalf: { status: PLANNED, positions, benchOrder: view.benchOrder } } };
}

/** A move on the plan (drag or tap). Gives the changed game, or null if not allowed. Logs nothing: a plan is not something that happened. */
export function planMoved(game, playerId, spot, squad) {
  if (!canPlan(game) || spot.zone) {
    return null;
  }
  const moved = movedOnto(planView(game, squad), playerId, spot);
  return moved && planSaved(game, moved.game);
}

/** A bench player dragged along the plan's bench. Gives the changed game, or null if not allowed. */
export function planBenchReordered(game, playerId, targetId, squad) {
  if (!canPlan(game)) {
    return null;
  }
  const reordered = benchReordered(planView(game, squad), playerId, targetId);
  return reordered && planSaved(game, reordered);
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
export function startedFirstHalf(game, at, squad = null) {
  if (game.state !== NOT_STARTED) {
    return game;
  }
  // GDA-103: with the squad known, the bench is numbered at kick-off, left to right as shown on the bench row.
  const ready = squad ? withBenchOrder(game, squad) : game;
  const numbered = squad ? { ...ready, ...numbersGiven(ready, ready.benchOrder) } : ready;
  // GDA-98: keep a copy of the game just before kick-off, so Undo kick-off can put it back.
  return { ...numbered, state: FIRST_HALF, firstHalfStartedAt: at, atKickOff: { ...game.atKickOff, firstHalf: copyForUndo(game) } };
}

/**
 * GDA-103: bench numbers given to the players in `ids` (in that order) who have none yet. Gives back
 * `{ benchNumbers, recordNumbers? }` to spread onto the game. A player keeps the one number they have.
 * `recordNumbers` (Carry over rotation order OFF, GDA-86) is the whole-game counter and is kept in step.
 */
function numbersGiven(game, ids) {
  const benchNumbers = { ...game.benchNumbers };
  const recordNumbers = game.recordNumbers ? { ...game.recordNumbers } : null;
  let next = Math.max(0, ...Object.values(benchNumbers)) + 1;
  let nextRecord = recordNumbers ? Math.max(0, ...Object.values(recordNumbers)) + 1 : 0;
  for (const id of ids) {
    if (!benchNumbers[id]) {
      benchNumbers[id] = next++;
    }
    if (recordNumbers && !recordNumbers[id]) {
      recordNumbers[id] = nextRecord++;
    }
  }
  return { benchNumbers, ...(recordNumbers ? { recordNumbers } : {}) };
}

/** The game as it is now, without the saved kick-off copies (a copy never holds another copy). */
function copyForUndo(game) {
  const { atKickOff, ...copy } = game;
  return copy;
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

/** The seconds that can be added to the minutes of a rotation (GDA-106). */
export const ROTATION_EXTRA_SECONDS = [0, 15, 30, 45];

/**
 * The seconds part of a rotation length: 0, 15, 30 or 45, else 0. The longest rotation allowed is
 * min(25, half) minutes exactly, so at that many minutes there are no extra seconds.
 */
export function snappedSeconds(seconds, minutes, halfMinutes = MAX_ROTATION) {
  const top = Math.max(MIN_ROTATION, Math.min(MAX_ROTATION, halfMinutes));
  return minutes >= top || !ROTATION_EXTRA_SECONDS.includes(seconds) ? 0 : seconds;
}

/** The game's rotation length in SECONDS (6:00 = 360 for games saved without one). Whole-minute games read as minutes and 0 seconds. */
export function rotationSecondsOf(game) {
  const minutes = clampRotation(game?.rotationMinutes ?? ROTATION_MINUTES, halfOf(game));
  return minutes * 60 + snappedSeconds(game?.rotationExtraSeconds, minutes, halfOf(game));
}

/** "6 min", or "4 min 30 s" when there are seconds. */
export function rotationText(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** The game's own half length in minutes (25 for games saved without one). */
export function halfOf(game) {
  return game?.halfMinutes ?? HALF_MINUTES;
}

/**
 * GDA-127: which half the Formation row edits (the next half to be played), or null when it is read-only.
 * Before kick-off: the 1st half. After kick-off until the 2nd half starts (1st half running or half time): the 2nd half.
 * 2nd half running or Full Time: none.
 */
export function formationRowHalf(game) {
  return game.state === NOT_STARTED ? 1 : game.state === FIRST_HALF ? 2 : null;
}

/** The Formation the row shows: the half it edits, or (read-only) the current half's. */
export function shownFormation(game) {
  return formationOf(game, formationRowHalf(game) ?? 2);
}

/**
 * Copies a game with a different formation for the half the row edits. Only the grouping changes: the same places,
 * so nobody moves. Before kick-off it sets the 1st half's (the 2nd half's follows unless it was set separately).
 * From kick-off it sets the 2nd half's only, always stored on its own so it stays even if equal to the 1st's.
 * A game where the row is read-only comes back unchanged (a stale screen).
 */
export function withFormation(game, formation) {
  const half = formationRowHalf(game);
  if (half === null) {
    return game;
  }
  return half === 1 ? { ...game, formation } : { ...game, formation2: formation };
}

/**
 * GDA-86: the two 2nd-half switches. A game saved before this version has neither value, so it reads as
 * today's behaviour: rotation order carried (ON), bench time not carried (OFF).
 */
export function carriesRotationOrder(game) {
  return game.carryRotationOrder !== false;
}
export function carriesBenchTime(game) {
  return game.carryBenchTime === true;
}

/** The switches can be changed only while the 2nd half has not started (and the game is not finished). */
export function canChangeCarryOver(game) {
  return game.state !== SECOND_HALF && game.state !== FINISHED;
}

/** Copies a game with one switch changed (`which` is "carryRotationOrder" or "carryBenchTime"). Locked games come back unchanged. */
export function withCarryOver(game, which, value) {
  if (!canChangeCarryOver(game) || (which !== "carryRotationOrder" && which !== "carryBenchTime")) {
    return game;
  }
  return { ...game, [which]: Boolean(value) };
}

/** Copies a game with a new rotation length (minutes plus extra seconds). Timers are not touched: they are measured against it from now on. */
export function withRotation(game, minutes, extraSeconds = 0) {
  const clamped = clampRotation(minutes, halfOf(game));
  return { ...game, rotationMinutes: clamped, rotationExtraSeconds: snappedSeconds(extraSeconds, clamped, halfOf(game)) };
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
export function ringFraction(seconds, rotationSeconds = ROTATION_MINUTES * 60) {
  return Math.min(1, Math.max(0, seconds / rotationSeconds));
}

/** Is the player past the rotation length? */
export function isBenchLate(seconds, rotationSeconds = ROTATION_MINUTES * 60) {
  return seconds > rotationSeconds;
}

/** A finished stint within this many seconds of the rotation length counts as a full rotation (GDA-84). */
export const FROZEN_RING_TOLERANCE_SECONDS = 60;

/**
 * How a frozen ring (a finished bench stint on a field player) looks, rounded out:
 * within 1 minute of the rotation length (either side) = full ring, not late;
 * over rotation + 1 minute = full and late; under rotation - 1 minute = part ring.
 * The live bench ring and swap message do not use this.
 */
export function frozenRingLook(seconds, rotationSeconds = ROTATION_MINUTES * 60) {
  const full = rotationSeconds;
  if (seconds > full + FROZEN_RING_TOLERANCE_SECONDS) return { fraction: 1, late: true };
  if (seconds >= full - FROZEN_RING_TOLERANCE_SECONDS) return { fraction: 1, late: false };
  return { fraction: ringFraction(seconds, rotationSeconds), late: false };
}

/** The swap warning starts this many seconds before a bench player is due (fixed in the MVP). */
export const WARN_SECONDS = 30;

/**
 * The swap bar's time (GDA-35, GDA-104), worked out from the saved bench times and the rotation
 * length every time, with nothing stored, so it is right after a lock, a reload, an Undo or a changed
 * length. Time only, never names. The bench player who has waited longest sets it. Gives
 * { phase: "next" | "warn" | "due", countdown (next, warn), late (due) }: "next" is the countdown
 * more than 30 seconds out (with nobody waiting yet it is the full rotation length), "warn" the last
 * 30 seconds, "due" the time since the rotation ran out. Null once the half is over.
 */
export function swapMessage(game, squad, now) {
  if (isHalfEnded(game)) {
    return null;
  }
  const limit = rotationSecondsOf(game);
  // The bench player who has waited longest sets the time of the next swap.
  const longest = Math.max(0, ...benchIds(game, squad).map((id) => benchSeconds(game, id, now)));
  if (longest >= limit) {
    return { phase: "due", late: longest - limit };
  }
  const countdown = limit - longest;
  return { phase: countdown <= WARN_SECONDS ? "warn" : "next", countdown };
}

/**
 * End Half in the first half: saves the real time it was tapped (`at`) and opens Half
 * Time (GDA-31). The state stays FIRST_HALF on purpose, so the game still counts as in
 * progress for updates. Nothing is copied any more (GDA-97): the 2nd-half plan is its own
 * line-up. Ending twice, or a game not in its first half, gives the game back
 * unchanged: the first End Half time is kept.
 */
export function endedFirstHalf(game, at) {
  if (game.state !== FIRST_HALF || isHalfEnded(game)) {
    return game;
  }
  return {
    ...game,
    firstHalfEndedAt: at,
    plannedPairs: [], // Planned pairs do not survive End Half, and do not come back with the back arrow (GDA-36).
  };
}

/**
 * Resume 1st half: takes the end time away, so the first half is running again as if End Half
 * was never tapped. A touched 2nd-half plan stays as it is (GDA-97). The start time and the
 * first-half line-up are never touched.
 */
export function reopenedFirstHalf(game) {
  if (!isHalfTime(game)) {
    return game;
  }
  const { benchOrderAtEndHalf, ...rest } = game;
  if (benchOrderAtEndHalf === undefined) {
    return { ...rest, firstHalfEndedAt: null };
  }
  // A game saved by version 42 at half time: its bench order was the plan's, so give each its own back.
  const plan = game.lineups.secondHalf;
  return {
    ...rest,
    firstHalfEndedAt: null,
    benchOrder: benchOrderAtEndHalf,
    lineups: { ...game.lineups, secondHalf: { ...plan, benchOrder: plan.benchOrder ?? game.benchOrder } },
  };
}

/**
 * Start 2nd Half (GDA-31, GDA-97): the second half's clock starts at once from `at`. It starts from
 * the plan if it was touched, otherwise from the 1st-half line-up and bench as they finished. Anyone
 * absent is taken out of the line-up (their place stays empty). Bench timers start again from 0:00
 * for everyone on the bench (benchSince is cleared, so they fall back to the half's start). Bench
 * numbers (benchNumbers) are left alone. Gives the game back unchanged if it is not at Half Time,
 * so a double tap starts it once, and the 2nd half cannot start while the 1st is running.
 */
export function startedSecondHalf(game, at) {
  if (!isHalfTime(game)) {
    return game;
  }
  const { benchOrderAtEndHalf, ...rest } = game;
  const atKickOff = { ...game.atKickOff, secondHalf: copyForUndo(game) }; // GDA-98: for Undo kick-off.
  // The 1st half's bench: version 42 kept it as benchOrderAtEndHalf; now it is simply benchOrder.
  const firstHalfBenchOrder = benchOrderAtEndHalf ?? game.benchOrder ?? [];
  // Bench time (GDA-29): the first half's bench time carries on. Everyone who was on the bench when the
  // half ended gets that last stint added now; the half-time break itself adds nothing (it stops at End Half).
  const plan = game.lineups.secondHalf;
  const touched = plan.status === PLANNED;
  const positions = (touched ? plan.positions : game.lineups.firstHalf.positions).map((id) => (game.absent.includes(id) ? null : id));
  const planBench = touched ? plan.benchOrder ?? game.benchOrder ?? [] : firstHalfBenchOrder;
  // The plan's bench, then anyone else unplaced and not absent (a late arrival) at the end.
  const benchOrder = [];
  for (const id of [...planBench, ...firstHalfBenchOrder]) {
    if (!positions.includes(id) && !game.absent.includes(id) && !benchOrder.includes(id)) {
      benchOrder.push(id);
    }
  }
  // GDA-86: Carry over bench time ON: each bench timer carries on from what it showed at End Half, so that
  // stint is NOT added to the totals yet (it is added when the player goes on, as normal; adding it now too would count it twice).
  // Anyone who is not on the bench now (absent) has their stint added now, as before.
  const carryTime = carriesBenchTime(game);
  const benchTotals = { ...game.benchTotals };
  const benchSince = {};
  for (const id of firstHalfBenchOrder) {
    if (carryTime && benchOrder.includes(id)) {
      benchSince[id] = at - benchSeconds(game, id, at) * 1000;
    } else {
      benchTotals[id] = benchTotalSeconds(game, id, at);
    }
  }
  // GDA-86: Carry over rotation order OFF: the on-screen numbers clear and restart at 1. The 1st half's numbers
  // are kept as recordNumbers (the whole-game counter, carried on by swapped()) so the Season record keeps whole-game numbering (and Undo kick-off restores all).
  const clearNumbers = !carriesRotationOrder(game);
  // GDA-103: anyone starting the half on the bench without a number takes the next one, left to right as shown.
  const base = clearNumbers ? { ...game, benchNumbers: {}, recordNumbers: { ...game.benchNumbers } } : game;
  const numbers = numbersGiven(base, benchOrder);
  return {
    ...rest,
    atKickOff,
    state: SECOND_HALF,
    secondHalfStartedAt: at,
    benchSince,
    benchTotals,
    ...numbers,
    plannedPairs: [],
    firstHalfBenchOrder,
    benchOrder,
    lineups: { ...game.lineups, secondHalf: { status: PLANNED, positions } },
  };
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

/**
 * End Half, whichever half is running. `half` (1 or 2) is the half the tapped screen shows: if the
 * saved game is no longer in that half, nothing changes (a screen that is out of date cannot end
 * the wrong half). Leave `half` out to end whichever half is running.
 */
export function endedHalf(game, at, half = null) {
  if (half !== null && phaseOf(game, half) !== "inProgress") {
    return game;
  }
  return game.state === SECOND_HALF ? endedSecondHalf(game, at) : endedFirstHalf(game, at);
}

/**
 * Resume half, for the half the screen shows (1 or 2): the half runs again. Allowed only while the
 * next half has not started (see canResumeHalf); otherwise the game comes back unchanged.
 */
export function reopenedHalf(game, half = null) {
  if (half !== null && !canResumeHalf(game, half)) {
    return game;
  }
  return game.state === SECOND_HALF ? reopenedSecondHalf(game) : reopenedFirstHalf(game);
}

// ---- Undo kick-off (GDA-98) ----
const HALF_KEYS = { 1: "firstHalf", 2: "secondHalf" };

/** Undo kick-off is offered only for a half that is In progress and has a saved copy from its kick-off. */
export function canUndoKickOff(game, half) {
  return phaseOf(game, half) === IN_PROGRESS_PHASE && Boolean(game.atKickOff?.[HALF_KEYS[half]]);
}

/**
 * Undo kick-off for half 1 or 2: the game goes back to the copy saved at that kick-off, so that half
 * is Not started (clock, swaps, goals, bench times and late arrivals of that half all gone).
 * Undoing the 1st half keeps the 2nd-half plan as it is NOW (the plan is Ben's work, not something
 * that happened). Undoing the 2nd half leaves the 1st half Ended, with Resume half available.
 * If the half is not running or there is no copy (stale screen, old game) the game comes back unchanged.
 */
export function undoneKickOff(game, half) {
  if (!canUndoKickOff(game, half)) {
    return game;
  }
  const saved = game.atKickOff[HALF_KEYS[half]];
  if (half === 1) {
    // The plan and the GDA-86 switches are Ben's choices, not things that happened, so they stay as they are now.
    // GDA-127: the 2nd half's Formation is the same kind of choice, so it is kept too.
    const second = game.formation2 ? { formation2: game.formation2 } : {};
    return { ...saved, ...second, carryRotationOrder: game.carryRotationOrder, carryBenchTime: game.carryBenchTime, lineups: { ...saved.lineups, secondHalf: game.lineups.secondHalf } };
  }
  // Keep the 1st half's own copy, so the game is exactly as before the 2nd half started.
  return game.atKickOff.firstHalf ? { ...saved, atKickOff: { firstHalf: game.atKickOff.firstHalf } } : saved;
}

/** True for a log entry that Undo kick-off removes: this half's entries from its start on. `game` is the game BEFORE the undo. */
export function isRemovedByUndo(game, half, event) {
  const startedAt = half === 1 ? game.firstHalfStartedAt : game.secondHalfStartedAt;
  return event.half === HALF_KEYS[half] && event.at >= startedAt;
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
 * Which screen a saved game opens on (GDA-95, and after a restart GDA-33): the 1st Half screen
 * before kick-off and while the 1st half runs; the 2nd Half screen (the plan, where the next action
 * is) once the 1st half has ended, and while the 2nd half runs; Full Time once the 2nd half has ended.
 */
export function screenForOpening(game) {
  if (!isInProgress(game)) {
    return "half1";
  }
  if (game.state === SECOND_HALF) {
    return isHalfEnded(game) ? "fullTime" : "half2";
  }
  return isHalfTime(game) ? "half2" : "half1";
}

// ---- The half screens (GDA-95) ----
// Each half is in exactly one of three states. It is worked out from the saved game every time,
// never stored, so a screen can never disagree with the game.
export const NOT_STARTED_PHASE = "notStarted";
export const IN_PROGRESS_PHASE = "inProgress";
export const ENDED_PHASE = "ended";

/** Where half 1 or 2 is: "notStarted", "inProgress" or "ended". A finished game has both halves ended. */
export function phaseOf(game, half) {
  if (game.state === NOT_STARTED) {
    return NOT_STARTED_PHASE;
  }
  if (game.state === FINISHED) {
    return ENDED_PHASE;
  }
  if (game.state === SECOND_HALF) {
    return half === 1 ? ENDED_PHASE : isHalfEnded(game) ? ENDED_PHASE : IN_PROGRESS_PHASE;
  }
  // FIRST_HALF: the 1st half runs or has ended; the 2nd has not started.
  if (half === 2) {
    return NOT_STARTED_PHASE;
  }
  return isHalfEnded(game) ? ENDED_PHASE : IN_PROGRESS_PHASE;
}

/** Start 1st half is on for a game not started; Start 2nd half only once the 1st half has ended (half time). */
export function canStartHalf(game, half) {
  return half === 1 ? game.state === NOT_STARTED : isHalfTime(game);
}

/** Resume half shows only on an Ended half while the next half has not started (the 2nd half: until End game and save). */
export function canResumeHalf(game, half) {
  return phaseOf(game, half) === ENDED_PHASE && (half === 1 ? isHalfTime(game) : game.state === SECOND_HALF);
}

/** The screen the ‹ arrow goes to. null for Home's own screens (not part of the game flow). */
export function backScreen(screen) {
  return { createGame: "home", newGame: "home", half1: "newGame", half2: "half1", fullTime: "half2" }[screen] ?? null;
}

/**
 * The screen the › arrow goes to, or null when it is greyed out: › on the 2nd Half screen is live only
 * once the 2nd half has ended. (Create game's own › is the Create game button, handled by the screen.)
 */
export function nextScreen(game, screen) {
  if (screen === "newGame") {
    return "half1";
  }
  if (screen === "half1") {
    return "half2";
  }
  if (screen === "half2") {
    return phaseOf(game, 2) === ENDED_PHASE ? "fullTime" : null;
  }
  return null;
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
  // Bench numbers (GDA-56, GDA-103): { playerId: 1, 2, 3... } in the order players first went TO the bench.
  // Kept for the whole game; a player keeps their first number.
  // Bench time (GDA-29): seconds of finished bench stints, per player. A stint is added when the player goes on.
  const benchTotals = { ...game.benchTotals };
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
    changes.push({ playerId: pair.benchId, from: BENCH, to: place });
    if (pair.fieldId !== null) {
      benchSince[pair.fieldId] = at;
      changes.push({ playerId: pair.fieldId, from: place, to: BENCH });
    }
  }
  if (changes.length === 0) {
    return null;
  }
  // GDA-103: players who went to the bench take the next number if they have none, in field order as shown.
  const leaving = changes.filter((change) => change.to === BENCH).sort((a, b) => a.from - b.from).map((change) => change.playerId);
  const numbers = numbersGiven(game, leaving);
  return { game: { ...withFirstHalf(game, { positions }), benchOrder: order, benchSince, ...numbers, benchTotals, plannedPairs: [] }, changes };
}

/**
 * Undo after Swap: puts back the players, the bench order, the bench times and the
 * planned pairs and the bench numbers, from `before`, the game as it was just before Swap.
 */
export function swapUndone(game, before) {
  const restored = withFirstHalf(game, { positions: before.lineups[lineupKey(before)].positions });
  return { ...restored, benchOrder: before.benchOrder, benchSince: before.benchSince, benchNumbers: before.benchNumbers ?? {}, ...(before.recordNumbers ? { recordNumbers: before.recordNumbers } : {}), benchTotals: before.benchTotals ?? {}, plannedPairs: before.plannedPairs ?? [] };
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
  if (isHalfTime(game)) {
    // Half time (GDA-97): the 1st half is over, so nothing of it changes. Only who is here changes; the
    // 2nd-half plan shows an absent player's place empty, and Start 2nd half takes them out of the line-up.
    const absent = game.absent.includes(playerId) ? game.absent.filter((id) => id !== playerId) : [...game.absent, playerId];
    return { game: { ...game, absent }, changes: [] };
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
  const firstFrom = {}; // playerId -> where their first move this half started (BENCH means they began the half on the bench)
  const stints = {};
  for (const event of live) {
    for (const change of event.changes) {
      firstFrom[change.playerId] ??= change.from;
      if (change.to === BENCH && change.from !== BENCH) {
        benchedAt[change.playerId] = event.at;
      } else if (change.from === BENCH && typeof change.to === "number") {
        const seconds = Math.max(0, Math.floor((event.at - (benchedAt[change.playerId] ?? start)) / 1000));
        (stints[change.playerId] ??= []).push(seconds);
        delete benchedAt[change.playerId];
      }
    }
  }
  return game.state === SECOND_HALF ? withCarriedRings(game, events, stints, firstFrom) : stints;
}

/** The game as it stood at the 1st-half whistle: the kick-off copy, or (after Full Time, which drops the Undo copies) the one kept under its own name. */
export function firstHalfCopyOf(game) {
  return game.atKickOff?.secondHalf ?? game.firstHalfAtWhistle ?? null;
}

/**
 * The 1st half's frozen rings (GDA-116): the bench spells that ended with a swap on, worked out from the events
 * up to the whistle, for the copy of the game saved at 2nd-half kick-off. Empty for older games without the copy.
 */
export function firstHalfStintsOf(game, events) {
  const copy = firstHalfCopyOf(game);
  if (!copy || typeof copy.firstHalfEndedAt !== "number") {
    return {};
  }
  return benchStints(copy, events.filter((e) => e.at <= copy.firstHalfEndedAt));
}

/**
 * GDA-116: with Carry over bench time ON the live 2nd Half keeps the 1st half's rings and adds its own.
 * Order, oldest first: the 1st half's finished spells; the spell running at the whistle (for someone who began the
 * 2nd half on the pitch, a ring of its own; for someone who began it on the bench, it is added to their first
 * 2nd-half spell, because their timer carried on from it); then the 2nd half's spells. OFF: the 2nd half starts fresh.
 */
function withCarriedRings(game, events, stints, firstFrom) {
  const copy = firstHalfCopyOf(game);
  if (!carriesBenchTime(game) || !copy) {
    return stints;
  }
  const out = {};
  for (const [id, list] of Object.entries(firstHalfStintsOf(game, events))) {
    out[id] = [...list];
  }
  const second = game.lineups.secondHalf.positions;
  const atWhistle = copy.benchOrderAtEndHalf ?? copy.benchOrder ?? [];
  const mine = {};
  for (const [id, list] of Object.entries(stints)) {
    mine[id] = [...list];
  }
  for (const id of atWhistle) {
    const seconds = benchSeconds(copy, id, 0);
    if (firstFrom[id] === BENCH) {
      if (mine[id]?.length) {
        mine[id][0] += seconds;
      }
    } else if (seconds >= 1 && (firstFrom[id] !== undefined || second.includes(id))) {
      (out[id] ??= []).push(seconds);
    }
  }
  for (const [id, list] of Object.entries(mine)) {
    out[id] = [...(out[id] ?? []), ...list];
  }
  return out;
}

/**
 * The 1st half's bench figures for the 2nd-half plan (GDA-107), the same ones the live 1st Half screen shows at
 * `now`: while the 1st half runs they move with it; once it has ended they are frozen at the whistle (benchSeconds
 * stops at End Half). Nothing is stored: `stints` is the in-memory `benchStints` of the 1st half (from the saved
 * events) and `bench` is each bench player's spell so far. Gives null before kick-off and once the 2nd half has started.
 */
export function planFigures(game, now) {
  if (game.state !== FIRST_HALF || typeof game.firstHalfStartedAt !== "number") {
    return null;
  }
  const benchNow = isHalfEnded(game) ? game.benchOrderAtEndHalf ?? game.benchOrder : game.benchOrder;
  const bench = {};
  for (const id of benchNow ?? []) {
    bench[id] = benchSeconds(game, id, now);
  }
  return { stints: game.benchStints ?? {}, bench };
}

/**
 * The 1st Half screen once the 2nd half has started, and in a finished game (GDA-116): the 1st half exactly as it
 * ended, drawn from the copy saved at 2nd-half kick-off, in the same shape as planFigures. `stints` are the 1st
 * half's rings (the game's in-memory `firstHalfStints`). Gives null for an older game that has no copy.
 */
export function firstHalfFigures(game) {
  const copy = firstHalfCopyOf(game);
  if (!copy || (game.state !== SECOND_HALF && game.state !== FINISHED)) {
    return null;
  }
  const figures = planFigures({ ...copy, state: FIRST_HALF }, 0);
  return figures && { ...figures, stints: game.firstHalfStints ?? {} };
}

/**
 * How a player on the plan is drawn from those figures (GDA-107), by where they are now on the plan:
 * - on the pitch: one frozen ring per 1st-half bench spell of 1 second or more, including the spell that was
 *   running at half time if they were on the bench then (as in a live swap);
 * - on the bench: the spell running at half time (ring and time tag), or null for none (empty ring, no tag).
 */
export function planFiguresFor(figures, playerId, onPitch) {
  const running = figures.bench[playerId];
  if (onPitch) {
    const spells = [...(figures.stints[playerId] ?? []), ...(running === undefined ? [] : [running])];
    return { rings: spells.filter((seconds) => seconds >= 1), seconds: null };
  }
  return { rings: [], seconds: running === undefined ? null : running };
}

/**
 * Full turns in goal (GDA-114): the ids of players who have had at least one unbroken spell in the
 * keeper position (place 0) that lasted the rotation length minus 1 minute or more (same tolerance as
 * the frozen ring, GDA-84). Worked out from the saved event log every time, so nothing is stored and
 * Undo swap, Undo kick-off and a reload all give the right answer (an undone event is simply gone).
 * Each half is measured on its own clock (from that half's start to its End Half), so the break adds
 * nothing and two short spells never add up. A spell still running (half not ended) is not counted:
 * the player in goal shows gloves anyway. Games saved by earlier versions work the same way, because
 * the log already holds every move. `events` are this game's events, any order.
 */
export function keeperTurns(game, events) {
  const needed = rotationSecondsOf(game) - FROZEN_RING_TOLERANCE_SECONDS;
  const earned = new Set();
  const halves = [
    { key: "firstHalf", start: game.firstHalfStartedAt, end: game.firstHalfEndedAt },
    { key: "secondHalf", start: game.secondHalfStartedAt, end: game.secondHalfEndedAt },
  ];
  for (const half of halves) {
    if (typeof half.start !== "number") continue;
    const moves = events
      .filter((e) => (e.type === SWAP || e.type === POSITION_CHANGE) && e.half === half.key && e.at >= half.start)
      .sort((a, b) => a.at - b.at || (a.id ?? 0) - (b.id ?? 0));
    // Who was in goal at the start of the half: the first player to leave goal, or (if nobody
    // ever left) whoever is there now.
    const firstLeaver = moves.flatMap((e) => e.changes).find((c) => c.from === 0 && c.to !== 0);
    let keeper = firstLeaver ? firstLeaver.playerId : (game.lineups?.[half.key]?.positions?.[0] ?? null);
    let since = half.start;
    const spellEnded = (at) => {
      if (keeper && Math.floor((at - since) / 1000) >= needed) earned.add(keeper);
    };
    for (const event of moves) {
      const left = event.changes.find((c) => c.from === 0 && c.to !== 0);
      const arrived = event.changes.find((c) => c.to === 0 && c.from !== 0);
      if (left) {
        spellEnded(event.at);
        keeper = null;
      }
      if (arrived) {
        keeper = arrived.playerId;
        since = event.at;
      }
    }
    if (typeof half.end === "number") spellEnded(half.end);
  }
  return earned;
}

/** "4m": whole minutes, rounded down. Under a minute gives "" (nothing shown). */
export function benchTotalText(seconds) {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 1 ? `${minutes}m` : "";
}

/**
 * GDA-86: a player's number for the whole game (used by the Season record). With Carry over rotation order
 * OFF the on-screen numbers restart at 1 in the 2nd half, so a 2nd-half number is placed after all the 1st half's.
 * A player's FIRST number in the game wins.
 */
export function wholeGameBenchNumber(game, playerId) {
  return (game.recordNumbers ?? game.benchNumbers)?.[playerId] ?? null;
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

/** "2-1" style text for the score. */
export function scoreText(score) {
  return `${score.us}-${score.them}`;
}

/**
 * Goals can be added while a half is running and at Half Time (they count in the first half).
 * Not before kick-off, and not once the game is finished. (After the second half's End Half the
 * game is still open until FULL TIME is tapped, and Back brings the half back.)
 */
export function canAddGoal(game) {
  return game.state === FIRST_HALF || game.state === SECOND_HALF;
}

/** The player ids on the field right now, in position order. */
export function fieldPlayerIds(game) {
  return activePositions(game).filter((id) => id !== null && id !== undefined);
}

/** Every player this game knows about: on the field, on the bench, or marked absent. */
function gamePlayerIds(game) {
  const ids = [];
  for (const half of Object.values(game.lineups ?? {})) {
    ids.push(...(half.positions ?? []));
  }
  ids.push(...(game.benchOrder ?? []), ...(game.benchOrderAtEndHalf ?? []), ...(game.absent ?? []));
  return new Set(ids.filter((id) => id !== null && id !== undefined));
}

/**
 * Who has played today (GDA-90): anyone who has been on the field since kick-off, worked out from
 * the saved moves (a swap or a move that involves a position). Someone who played and then left
 * is still in this list. `events` are this game's events, any order. Returns a Set of player ids.
 */
export function playedToday(game, events) {
  const played = new Set(fieldPlayerIds(game));
  const kickOff = game.firstHalfStartedAt;
  if (typeof kickOff !== "number") {
    return played;
  }
  for (const event of events) {
    if ((event.type === SWAP || event.type === POSITION_CHANGE) && event.at >= kickOff) {
      for (const change of event.changes ?? []) {
        if (change.from !== BENCH || change.to !== BENCH) {
          played.add(change.playerId);
        }
      }
    }
  }
  return played;
}

/**
 * The players the "Who scored?" dialog offers (GDA-90), A to Z: everyone who is here, plus anyone
 * marked absent who has played today. `playedIds` is playedToday(), as a list or Set.
 */
export function scorerChoices(game, players, playedIds) {
  const played = new Set(playedIds ?? []);
  return players
    .filter((p) => !game.absent.includes(p.id) || played.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Adds a goal. `goal` is { id, side, scorerId }. Gives the game unchanged if goals are not allowed now.
 * A goal for us may be saved against any player in this game (field, bench, swapped off, left);
 * a goal for us with no scorer is an own goal. A goal against has no scorer.
 */
export function goalAdded(game, goal) {
  if (!canAddGoal(game)) {
    return game;
  }
  const side = goal.side === THEM ? THEM : US;
  const scorerId = side === US && gamePlayerIds(game).has(goal.scorerId) ? goal.scorerId : null;
  const half = game.state === SECOND_HALF ? "secondHalf" : "firstHalf";
  const minute = minuteOf(game, half, goal.at);
  return { ...game, goals: [...goalsOf(game), { id: goal.id, side, scorerId, half, ...(minute === null ? {} : { minute }) }] };
}

/**
 * GDA-82: the minute within the half a goal was scored in, as the half's own clock ran: 0:00 to 0:59 is
 * minute 1, 3:20 is minute 4 (shown "1st 4'"). A goal at Half Time counts at the moment the half ended.
 * Gives null when there is no time to work from. Goals saved before this version have no minute at all.
 */
export function minuteOf(game, half, at) {
  const start = half === "secondHalf" ? game.secondHalfStartedAt : game.firstHalfStartedAt;
  const end = half === "secondHalf" ? game.secondHalfEndedAt : game.firstHalfEndedAt;
  if (typeof at !== "number" || typeof start !== "number") {
    return null;
  }
  const stop = typeof end === "number" ? Math.min(at, end) : at;
  return Math.floor(Math.max(0, stop - start) / 60000) + 1;
}

/** Takes away the goal with this id (Undo last goal). An id that is not there changes nothing. */
export function goalRemoved(game, goalId) {
  return { ...game, goals: goalsOf(game).filter((goal) => goal.id !== goalId) };
}

/**
 * The second line of "Undo last goal" (GDA-91): who scored the newest goal and the score before it,
 * e.g. "Ronan · 1 - 0", "Own goal · 1 - 0", "Opposition · 1 - 0". null if there are no goals.
 * `nameOf(id)` gives a player's name (or undefined).
 */
export function undoLineOf(game, nameOf) {
  const goal = lastGoal(game);
  if (!goal) {
    return null;
  }
  const before = scoreOf(goalRemoved(game, goal.id));
  const who = goal.side === THEM ? "Opposition" : goal.scorerId === null ? "Own goal" : nameOf(goal.scorerId) ?? "Goal for us";
  return `${who} \u00b7 ${before.us} - ${before.them}`;
}

/** The most recent goal, or null if there are none. */
export function lastGoal(game) {
  const goals = goalsOf(game);
  return goals.length > 0 ? goals[goals.length - 1] : null;
}

// ---- Coach's notes and Player of the day (GDA-81, GDA-110) ----
// `game.notes` is { playerId: text }: at most ONE note per player per game. `game.potdId` is the one Player of
// the day (a player id) or absent/null. Both can change from kick-off until End game and save, then never.

/** Press and hold on a circle opens the note sheet after this long (GDA-81). One place to change it. */
export const HOLD_MS = 500;

/** True while notes and Player of the day may be changed: kicked off and not yet saved at Full Time. */
export function canEditNotes(game) {
  return Boolean(game) && canAddGoal(game);
}

/** One player's note ("" if none). */
export function noteOf(game, playerId) {
  return game.notes?.[playerId] ?? "";
}

/**
 * Saves a player's note. The text is kept exactly as typed (any length, commas, line breaks, quotes), only
 * trimmed at both ends; nothing left means no note. Unchanged if notes are locked or the player is not in this game.
 */
export function withNote(game, playerId, text) {
  if (!canEditNotes(game) || !gamePlayerIds(game).has(playerId)) {
    return game;
  }
  const notes = { ...(game.notes ?? {}) };
  const clean = String(text ?? "").trim();
  if (clean === "") {
    delete notes[playerId];
  } else {
    notes[playerId] = clean;
  }
  return { ...game, notes };
}

/** The Player of the day's id, or null. */
export function potdOf(game) {
  return game.potdId ?? null;
}

/**
 * Makes `playerId` the Player of the day (`on` true, replacing anyone else) or, with `on` false, clears
 * it if that player is the one chosen. Unchanged if locked or the player is not in this game.
 */
export function withPotd(game, playerId, on) {
  if (!canEditNotes(game) || !gamePlayerIds(game).has(playerId)) {
    return game;
  }
  if (on) {
    return { ...game, potdId: playerId };
  }
  return potdOf(game) === playerId ? { ...game, potdId: null } : game;
}

/**
 * What the Summary page shows (GDA-82), from the game and the squad. Names come from the squad, which keeps
 * players who left. goals: oldest first, each { when: "1st 4'" or "1st", who, side }. notes: players with a note, A to Z.
 */
export function summaryOf(game, players) {
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? null;
  const goals = goalsOf(game).map((goal) => ({
    when: `${goal.half === "secondHalf" ? "2nd" : "1st"}${typeof goal.minute === "number" ? ` ${goal.minute}'` : ""}`,
    who: goal.side === THEM ? "Opposition" : goal.scorerId === null ? "Own goal" : nameOf(goal.scorerId) ?? "Goal for us",
    side: goal.side === THEM ? THEM : US,
  }));
  const notes = Object.entries(game.notes ?? {})
    .map(([id, text]) => ({ name: nameOf(Number(id)) ?? nameOf(id) ?? "Player", text }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { score: scoreOf(game), goals, notes, potd: potdOf(game) === null ? null : nameOf(potdOf(game)) };
}
