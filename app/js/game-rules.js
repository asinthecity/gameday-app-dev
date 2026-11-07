// Game rules. No screen code and no storage here, so they run under `node --test`.
//
// Dates and times are kept exactly as the date and time boxes give them, as plain
// text ("2026-11-14", "08:30"). They never pass through a time zone, so a game
// cannot slip to the day before or after, whatever the phone's zone or region.

// Fixed for now (J1-S5 is on the Later list). Stored on each game, so changing
// them later leaves old games correct.
export const FORMATION = "3-3-2";
export const HALF_MINUTES = 25;
// Line-up places in 3-3-2: 0 goal, 1-3 defence, 4-6 midfield, 7-8 forwards, each left to right.
export const POSITION_COUNT = 9;

export const NOT_STARTED = "not started";
export const NOT_PLANNED = "not planned";
export const PLANNED = "planned";

// Where a player can be, besides a place number.
export const BENCH = "bench";
export const ABSENT = "absent";

// The event log's first kind of event. See positionChangeEvent.
export const POSITION_CHANGE = "position-change";

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
  return { date: "", kickOff: "", opposition: "", venue: "", marked: {} };
}

/** All four details are needed. There is no minimum squad size and no date check. */
export function canCreateGame(form) {
  return [form.date, form.kickOff, form.opposition, form.venue].every((detail) => !isBlank(detail));
}

/** A line-up with every place empty. Each call gives a separate one. */
function emptyLineUp() {
  return { status: NOT_PLANNED, positions: new Array(POSITION_COUNT).fill(null) };
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
 * - A game with no rotation length uses 6 minutes (GDA-32 adds it).
 *
 * `squad` is the squad in alphabetical order. It fills the first half only.
 */
export function newGame(form, id, createdOrder, squad) {
  const game = {
    id,
    createdOrder,
    state: NOT_STARTED,
    date: form.date,
    kickOff: form.kickOff,
    opposition: cleanText(form.opposition),
    venue: cleanText(form.venue),
    formation: FORMATION,
    halfMinutes: HALF_MINUTES,
    absent: [],
    lineups: { firstHalf: emptyLineUp(), secondHalf: emptyLineUp() },
  };
  return prePlaced(game, squad);
}

/** Copies a game with a different first-half line-up. */
function withFirstHalf(game, changes) {
  const { firstHalf } = game.lineups;
  return { ...game, lineups: { ...game.lineups, firstHalf: { ...firstHalf, ...changes } } };
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
  return withFirstHalf(game, { status: PLANNED, positions });
}

/** What the line-up shows. Rows keep the order of `squad`, so they are always alphabetical. */
export function lineUpView(game, squad) {
  const { positions } = game.lineups.firstHalf;
  return {
    positions: positions.map((id) => squad.find((player) => player.id === id) ?? null),
    bench: squad.filter((player) => !positions.includes(player.id) && !game.absent.includes(player.id)),
    absent: squad.filter((player) => game.absent.includes(player.id)),
  };
}

function firstHalfWithout(game, playerId) {
  const positions = game.lineups.firstHalf.positions.map((id) => (id === playerId ? null : id));
  return withFirstHalf(game, { positions });
}

/** Absent leaves the player's position empty. Nobody moves in by themselves. */
export function markedAbsent(game, playerId) {
  const absent = game.absent.includes(playerId) ? game.absent : [...game.absent, playerId];
  return { ...firstHalfWithout(game, playerId), absent };
}

/** Back in means the bench: not being placed or absent is what puts a player there. */
export function markedBackIn(game, playerId) {
  return { ...game, absent: game.absent.filter((id) => id !== playerId) };
}

/** A player removed from the squad leaves an empty position, or simply leaves their row. */
export function withoutRemovedPlayer(game, playerId) {
  return markedBackIn(firstHalfWithout(game, playerId), playerId);
}

/** Where a player is in the first half: a place number, BENCH or ABSENT. */
export function whereIs(game, playerId) {
  if (game.absent.includes(playerId)) {
    return ABSENT;
  }
  const place = game.lineups.firstHalf.positions.indexOf(playerId);
  return place === -1 ? BENCH : place;
}

/**
 * A spot on the line-up is { playerId } for a player, or { place } for an empty
 * position. This gives the player in a spot, or null if it is empty.
 */
function playerIn(game, spot) {
  return spot.playerId ?? game.lineups.firstHalf.positions[spot.place] ?? null;
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
  const positions = [...game.lineups.firstHalf.positions];
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
  return { game: withFirstHalf(game, { positions }), changes };
}

/** Only a player who is not absent can be dragged. An empty position cannot. */
export function canDrag(game, spot) {
  return spot.playerId !== undefined && whereIs(game, spot.playerId) !== ABSENT;
}

/**
 * What a tap on a spot does: gives the player selected afterwards, and whether the
 * selected player moves onto the spot. A second tap on a player cancels. A tap on
 * another player in the same row moves the selection. A tap that cannot be a move
 * changes nothing, so the first player stays selected.
 */
export function afterTap(game, selectedId, spot) {
  const tappedId = playerIn(game, spot);
  if (selectedId === null) {
    return { selectedId: tappedId, move: false };
  }
  if (selectedId === tappedId) {
    return { selectedId: null, move: false };
  }
  if (movedOnto(game, selectedId, spot)) {
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
export function positionChangeEvent(gameId, changes, at) {
  return { gameId, type: POSITION_CHANGE, at, half: "firstHalf", changes };
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
