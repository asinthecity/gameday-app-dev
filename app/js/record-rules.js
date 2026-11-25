// The game record and the CSV file (GDA-46, GDA-50). No screen code and no storage
// here, so it all runs under `node --test`.
//
// The record is built once, at Full Time, from what is already saved: the game (its
// goals and final line-ups) and the event log (every position change with its time).
// It is stored on the game itself, in the same save that closes the game.

import { OLD_FORMATION, formationOf, positionNameIn } from "./formation-rules.js";
import { BENCH, FINISHED, SECOND_HALF, SWAP, POSITION_CHANGE, noteOf, potdOf, goalsOf, scoreOf, US, wholeGameBenchNumber } from "./game-rules.js";

export const BENCH_NAME = "Bench";
export const ABSENT_NAME = "Absent";

/** The position names Ben's Sheet uses, worked out from the game's shape (GDA-22). Games with no shape saved are 3-3-2. */
export function positionName(place, formation = OLD_FORMATION) {
  return positionNameIn(formation, place);
}

/**
 * Time spent in each position group by each player in ONE half, worked out by walking
 * backwards from the saved final line-up of the half, undoing each logged change.
 * Gives Map(playerId -> { start: group or BENCH, groups: { name: { ms, since } } }).
 * `since` is the earliest time the player was in that group (for the tie-break).
 * Only changes made while the half was running count: Half Time changes before the
 * 2nd half starts are already part of its start line-up.
 */
export function timeInPositions(finalPositions, playerIds, events, half, startedAt, endedAt, formation) {
  const where = new Map(playerIds.map((id) => [id, finalPositions.includes(id) ? finalPositions.indexOf(id) : BENCH]));
  const used = new Map(playerIds.map((id) => [id, {}]));
  const credit = (from, to) => {
    for (const [id, place] of where) {
      if (place !== BENCH) {
        const group = used.get(id);
        const name = positionName(place, formation);
        group[name] = { ms: (group[name]?.ms ?? 0) + Math.max(0, to - from), since: Math.min(group[name]?.since ?? Infinity, from) };
      }
    }
  };
  const inHalf = events
    .filter((e) => (e.type === POSITION_CHANGE || e.type === SWAP) && e.half === half && e.at >= startedAt && e.at <= endedAt)
    .sort((a, b) => a.at - b.at || (a.id ?? 0) - (b.id ?? 0));
  let boundary = endedAt;
  for (const event of [...inHalf].reverse()) {
    credit(event.at, boundary);
    boundary = event.at;
    for (const change of event.changes) {
      if (where.has(change.playerId)) {
        where.set(change.playerId, change.from);
      }
    }
  }
  credit(startedAt, boundary);
  return new Map(playerIds.map((id) => [id, { start: where.get(id), groups: used.get(id) }]));
}

/**
 * One player's position for one half: "Bench" only if never on the pitch that half,
 * otherwise the pitch position played longest; an exact tie goes to the position they
 * started the half in (or, if they started on the bench, the one they reached first).
 */
export function halfPosition({ start, groups }, formation) {
  const names = Object.keys(groups);
  if (names.length === 0) {
    return BENCH_NAME;
  }
  const most = Math.max(...names.map((n) => groups[n].ms));
  const tied = names.filter((n) => groups[n].ms === most);
  const startName = start === BENCH ? null : positionName(start, formation);
  if (startName && tied.includes(startName)) {
    return startName;
  }
  return tied.sort((a, b) => groups[a].since - groups[b].since)[0];
}

/**
 * The record for a game that has reached Full Time. `squad` is [{ id, name }];
 * `events` is the game's event log. Players marked absent get a normal row with "Absent" in both halves (GDA-49).
 * Gives null if the game is not in its second half with the half ended.
 */
export function buildRecord(game, squad, events) {
  const ended = game.state === SECOND_HALF && typeof game.secondHalfEndedAt === "number";
  if (!ended || typeof game.firstHalfEndedAt !== "number") {
    return null;
  }
  const isAbsent = (p) => game.absent.includes(p.id);
  // GDA-43: someone who left mid-game is in the absent list but did play, so their time is worked out too.
  const ids = squad.map((p) => p.id);
  const first = timeInPositions(game.lineups.firstHalf.positions, ids, events, "firstHalf", game.firstHalfStartedAt, game.firstHalfEndedAt, formationOf(game, 1));
  const second = timeInPositions(game.lineups.secondHalf.positions, ids, events, "secondHalf", game.secondHalfStartedAt, game.secondHalfEndedAt, formationOf(game, 2));
  // Played = was in a position at some point in that half (so a leaver who played is not "Absent").
  const played = (half, p) => Object.keys(half.get(p.id).groups).length > 0;
  const goals = goalsOf(game);
  const nameOf = (id) => squad.find((p) => p.id === id)?.name ?? null;
  const score = scoreOf(game);
  return {
    date: game.date,
    opposition: game.opposition,
    venueTag: game.venueTag ?? "",
    venue: game.venue ?? "",
    us: score.us,
    them: score.them,
    goals: goals.map((g) => ({ side: g.side, scorer: g.side === US && g.scorerId !== null ? nameOf(g.scorerId) : null, half: g.half, ...(typeof g.minute === "number" ? { minute: g.minute } : {}) })),
    // Everyone in the squad, once. Absent players keep their row (0 goals as they never played).
    players: squad.map((p) => ({
      id: p.id, // GDA-178: season totals match by ID, so a rename or a twin name cannot mix players up.
      name: p.name,
      firstHalf: isAbsent(p) && !played(first, p) ? ABSENT_NAME : halfPosition(first.get(p.id), formationOf(game, 1)),
      secondHalf: isAbsent(p) && !played(second, p) ? ABSENT_NAME : halfPosition(second.get(p.id), formationOf(game, 2)),
      goals: goals.filter((g) => g.side === US && g.scorerId === p.id).length,
      // GDA-56: the bench-order number, or blank if never off the bench (absent players too).
      benchOrder: isAbsent(p) && !played(first, p) && !played(second, p) ? "" : wholeGameBenchNumber(game, p.id) ?? "",
      // GDA-81 / GDA-110: the coach's note ("" if none) and whether this player is the Player of the day.
      note: noteOf(game, p.id),
      playerOfTheDay: potdOf(game) === p.id,
    })),
  };
}

/**
 * The game, closed for good with its record stored on it. Full Time is final.
 * `toSend` marks it for the season Sheet (GDA-47); games finished before that have no mark.
 */
export function gameAtFullTime(game, record) {
  const { atKickOff, ...rest } = game; // GDA-98: no Undo kick-off after Full Time.
  // GDA-116: keep only the 1st half as it ended, so the finished game's 1st Half screen can still show its rings and numbers.
  const firstHalfAtWhistle = atKickOff?.secondHalf ?? game.firstHalfAtWhistle;
  return { ...rest, ...(firstHalfAtWhistle ? { firstHalfAtWhistle } : {}), state: FINISHED, record, toSend: true };
}

/**
 * GDA-155: after goals, notes or Player of the day change on a finished game, brings its stored record into line.
 * Only the score, goals list, and each player's goals, note and Player of the day change; positions, bench order,
 * names, ids, date, opposition and venue stay exactly as stored (never rebuilt from today's squad).
 */
export function withRecordCorrected(game, squad = []) {
  const record = game.record;
  if (!record) {
    return game;
  }
  const goals = goalsOf(game);
  const score = scoreOf(game);
  // Records saved before GDA-178 have no player ids: match a row to a player by name, as season-rules.js does
  // (a name shared by two players cannot be told apart, so that row is left alone).
  const idOf = (row) => {
    if (row.id !== undefined) {
      return row.id;
    }
    const same = squad.filter((p) => p.name === row.name);
    return same.length === 1 ? same[0].id : undefined;
  };
  const nameOf = (id) => record.players.find((p) => idOf(p) === id)?.name ?? null;
  return {
    ...game,
    record: {
      ...record,
      us: score.us,
      them: score.them,
      goals: goals.map((g) => ({ side: g.side, scorer: g.side === US && g.scorerId !== null ? nameOf(g.scorerId) : null, half: g.half ?? null, ...(typeof g.minute === "number" ? { minute: g.minute } : {}) })),
      players: record.players.map((p) => {
        const id = idOf(p);
        return id === undefined ? p : { ...p, goals: goals.filter((g) => g.side === US && g.scorerId === id).length, note: noteOf(game, id), playerOfTheDay: potdOf(game) === id };
      }),
    },
  };
}

/** One CSV cell. Wrapped in quotes if it holds a comma, quote or line break; quotes are doubled. */
export function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The CSV text: one row per player, NO heading row (the headings sit once at the top of
 * the season Sheet), fixed column order: date, opposition, us, them, player, position
 * 1st half, position 2nd half, goals, bench order (GDA-56; blank for older games). The game fields repeat on every row.
 */
export function recordToCsv(record) {
  return record.players
    .map((p) => [record.date, record.opposition, record.us, record.them, p.name, p.firstHalf, p.secondHalf, p.goals, p.benchOrder ?? ""].map(csvCell).join(",") + "\n")
    .join("");
}

/** True for a finished game that has a record (old test games have none). */
export function hasRecord(game) {
  return game.state === FINISHED && Boolean(game.record);
}
