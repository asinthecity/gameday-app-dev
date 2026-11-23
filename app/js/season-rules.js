// Season totals from the saved games (GDA-173). No screen code and no storage, so it
// runs under `node --test`. GDA-48 (List) and GDA-57 (circle chart) read the answer.
//
// Only the current team's games that reached Full Time (they carry a saved record) count;
// archived games count too. The Sheet is never read. Every player is compared only with
// themselves: this file only adds up, it never ranks or suggests.

import { formationOf } from "./formation-rules.js";
import { halfPosition, hasRecord, timeInPositions } from "./record-rules.js";

/** The four areas, in the order screens show them. */
export const AREAS = ["Goal", "Defence", "Midfield", "Attack"];

/** Whole-number percent of part/whole, .5 rounds up. Integer maths so there are no float surprises. */
function percentOf(part, whole) {
  return Math.floor((200 * part + whole) / (2 * whole));
}

/**
 * Level 0 to 3 on the TRUE share (never the rounded percent):
 * 0 none; 1 up to and including one third; 2 up to and including two thirds; 3 above.
 * Whole-number comparison (3 x n against played) so exactly one third is never misjudged.
 */
export function levelOf(n, played) {
  if (n <= 0 || played <= 0) {
    return 0;
  }
  if (3 * n <= played) {
    return 1;
  }
  return 3 * n <= 2 * played ? 2 : 3;
}

const emptyAreas = () => Object.fromEntries(AREAS.map((a) => [a, 0]));

/** Games newest first: by date, then by the game's id. */
function newestFirst(lines) {
  return [...lines].sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.gameId > a.gameId ? 1 : b.gameId < a.gameId ? -1 : 0));
}

/**
 * @param {object} input
 * @param {object[]} input.games       the current team's games (any state, archived too)
 * @param {object[]} input.players     the current team's players [{ id, name }]
 * @param {Map|object} input.eventsByGame  gameId -> that game's saved events (a missing entry = no events)
 * @returns {{ gamesCounted: number, gamesWithMinutes: number, players: Map<number, PlayerSeason> }}
 *
 * PlayerSeason = {
 *   halvesPlayed,                      // halves in Goal/Defence/Midfield/Attack; 0 means show a dash
 *   halves:  { Goal, Defence, Midfield, Attack },   // counts
 *   share:   { ... },                  // true fraction 0..1 (0 if none played)
 *   percent: { ... },                  // whole number, .5 up; null when no halves played (show a dash)
 *   level:   { ... },                  // 0..3, on halves only
 *   minutes: { ... },                  // minutes on the pitch in that area (may be fractional)
 *   minutesTotal,                      // all minutes on the pitch
 *   minutesShare:   { ... },           // true fraction of minutes (0 if none)
 *   minutesPercent: { ... },           // whole number, .5 up; null when no minutes
 *   goals, potdCount,                // GDA-109: season counts (real numbers, 0 allowed)
 *   lastGames: [{ gameId, date, opposition, halves: [1st, 2nd], minutes: { Goal, Defence, Midfield, Attack, Bench } | null }], newest first, max 3
 * }
 * Halves are read from each saved record (matched to players by ID; older records by line-ups and events, else by name); minutes are worked
 * out again from the game's events, as the record keeps only the half's name.
 */
export function seasonTotals({ games, players, eventsByGame }) {
  const eventsOf = (id) => (eventsByGame instanceof Map ? eventsByGame.get(id) : eventsByGame?.[id]) ?? [];
  const halves = new Map(players.map((p) => [p.id, emptyAreas()]));
  const ms = new Map(players.map((p) => [p.id, emptyAreas()]));
  const idByName = new Map(players.map((p) => [p.name, p.id]));
  const ids = players.map((p) => p.id);
  const stats = new Map(players.map((p) => [p.id, { goals: 0, potd: 0, games: [] }])); // GDA-109
  let gamesCounted = 0;
  let gamesWithMinutes = 0;

  for (const game of games) {
    if (!hasRecord(game)) {
      continue; // not at Full Time, or no record: not counted
    }
    gamesCounted++;
    // Minutes (and, for old records, halves) come from the events. A game with no events counts in halves only.
    const events = eventsOf(game.id);
    const hasTimes = events.length > 0 && typeof game.firstHalfStartedAt === "number" && typeof game.secondHalfStartedAt === "number";
    const first = hasTimes ? timeInPositions(game.lineups.firstHalf.positions, ids, events, "firstHalf", game.firstHalfStartedAt, game.firstHalfEndedAt, formationOf(game, 1)) : null;
    const second = hasTimes ? timeInPositions(game.lineups.secondHalf.positions, ids, events, "secondHalf", game.secondHalfStartedAt, game.secondHalfEndedAt, formationOf(game, 2)) : null;
    const rows = game.record.players ?? [];
    // What each player did in this game (GDA-109): [1st half, 2nd half] names, goals and Player of the Day.
    const pair = new Map();
    const note = (id, names) => {
      if (id !== undefined && halves.has(id)) {
        pair.set(id, names);
        for (const name of names) {
          if (AREAS.includes(name)) {
            halves.get(id)[name]++; // Bench and Absent are not areas
          }
        }
      }
    };
    if (rows.some((r) => r.id !== undefined)) {
      // GDA-178: records now carry each player's ID, so match by ID (a deleted player's row is skipped).
      for (const row of rows) {
        note(row.id, [row.firstHalf, row.secondHalf]);
      }
    } else if (hasTimes) {
      // Older record, no IDs: work each player's half position out by ID, as buildRecord did.
      for (const id of ids) {
        note(id, [halfPosition(first.get(id), formationOf(game, 1)), halfPosition(second.get(id), formationOf(game, 2))]);
      }
    } else {
      // Older record and no events to work from: fall back to the name.
      for (const row of rows) {
        note(idByName.get(row.name), [row.firstHalf, row.secondHalf]);
      }
    }
    for (const row of rows) {
      const id = row.id !== undefined ? row.id : idByName.get(row.name);
      if (stats.has(id)) {
        stats.get(id).goals += Number(row.goals) || 0;
        stats.get(id).potd += row.playerOfTheDay ? 1 : 0;
      }
    }
    // The player's own line for this game, kept only if they were on the pitch for part of a half (last 3 games, GDA-109).
    for (const [id, names] of pair) {
      if (!names.some((n) => AREAS.includes(n))) {
        continue;
      }
      const line = { gameId: game.id, date: game.record.date, opposition: game.record.opposition, halves: names, minutes: null };
      if (hasTimes) {
        const times = { Goal: 0, Defence: 0, Midfield: 0, Attack: 0, Bench: 0 };
        [[first, game.firstHalfStartedAt, game.firstHalfEndedAt, names[0]], [second, game.secondHalfStartedAt, game.secondHalfEndedAt, names[1]]].forEach(([half, from, to, name]) => {
          let onPitch = 0;
          for (const [group, { ms }] of Object.entries(half.get(id)?.groups ?? {})) {
            if (AREAS.includes(group)) {
              times[group] += ms / 60000;
              onPitch += ms;
            }
          }
          if (name !== "Absent") {
            times.Bench += Math.max(0, to - from - onPitch) / 60000; // a half's time off the pitch
          }
        });
        line.minutes = times;
      }
      stats.get(id).games.push(line);
    }
    if (!hasTimes) {
      continue;
    }
    gamesWithMinutes++;
    for (const half of [first, second]) {
      for (const [id, { groups }] of half) {
        for (const name of Object.keys(groups)) {
          if (AREAS.includes(name)) {
            ms.get(id)[name] += groups[name].ms;
          }
        }
      }
    }
  }

  const result = new Map();
  for (const { id } of players) {
    const h = halves.get(id);
    const m = ms.get(id);
    const played = AREAS.reduce((sum, a) => sum + h[a], 0);
    const msTotal = AREAS.reduce((sum, a) => sum + m[a], 0);
    const each = (fn) => Object.fromEntries(AREAS.map((a) => [a, fn(a)]));
    result.set(id, {
      halvesPlayed: played,
      halves: { ...h },
      share: each((a) => (played ? h[a] / played : 0)),
      percent: each((a) => (played ? percentOf(h[a], played) : null)),
      level: each((a) => levelOf(h[a], played)),
      minutes: each((a) => m[a] / 60000),
      minutesTotal: msTotal / 60000,
      minutesShare: each((a) => (msTotal ? m[a] / msTotal : 0)),
      minutesPercent: each((a) => (msTotal ? percentOf(m[a], msTotal) : null)),
      goals: stats.get(id).goals, // GDA-109: season goals
      potdCount: stats.get(id).potd, // GDA-109: times Player of the Day (saved games only, so never today)
      lastGames: newestFirst(stats.get(id).games).slice(0, 3), // GDA-109: the last three games played in
    });
  }
  return { gamesCounted, gamesWithMinutes, players: result };
}
