// The team Season history page (GDA-187): the counting and ordering behind it. No screen code and no storage,
// so it runs under `node --test`. Read-only: it only adds up and orders what is already saved.
//
// Which games count is decided by the existing rule (countsInSeason: Full Time with a saved record, not archived;
// GDA-204), the same one seasonTotals uses, so every figure on the page counts the same games.
// Each player's goals, Player of the day count and positions come from seasonTotals; only the team record and
// "games played" (new) are worked out here.

import { AREAS } from "./season-rules.js";
import { countsInSeason, ABSENT_NAME } from "./record-rules.js";
import { finishedNewestFirst } from "./game-rules.js";

/** W, D or L from this team's point of view (its goals are first). */
export function resultLetter(us, them) {
  return us > them ? "W" : us < them ? "L" : "D";
}

/** The games that count: the same ones seasonTotals counts. */
export function countedGames(games) {
  return games.filter(countsInSeason);
}

/** The team's record over the counted games. */
export function teamRecord(games) {
  const record = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0 };
  for (const game of countedGames(games)) {
    const us = Number(game.record.us) || 0;
    const them = Number(game.record.them) || 0;
    const letter = resultLetter(us, them);
    record.played++;
    record[letter === "W" ? "won" : letter === "D" ? "drawn" : "lost"]++;
    record.goalsFor += us;
    record.goalsAgainst += them;
  }
  record.goalDifference = record.goalsFor - record.goalsAgainst;
  return record;
}

/** Goal difference as text: +4, -2 (a real minus sign), 0. */
export function goalDifferenceText(n) {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
}

/** Every counted game as a result row, newest first (the order Home uses). */
export function resultRows(games) {
  return finishedNewestFirst(countedGames(games)).map((game) => {
    const us = Number(game.record.us) || 0;
    const them = Number(game.record.them) || 0;
    return { id: game.id, date: game.record.date ?? game.date, opposition: game.record.opposition ?? game.opposition, letter: resultLetter(us, them), us, them };
  });
}

/**
 * How many counted games each player was in (not Absent). A player has played if their saved row is there and is not
 * Absent in both halves. Matched by ID, or by name for older records that have no IDs (as seasonTotals does).
 * @returns {Map<number, number>} id -> games (0 for someone who never played)
 */
export function gamesPlayed(games, players) {
  const idByName = new Map(players.map((p) => [p.name, p.id]));
  const played = new Map(players.map((p) => [p.id, 0]));
  for (const game of countedGames(games)) {
    const rows = game.record.players ?? [];
    const byId = rows.some((r) => r.id !== undefined);
    const here = new Set();
    for (const row of rows) {
      const id = byId ? row.id : idByName.get(row.name);
      if (played.has(id) && !(row.firstHalf === ABSENT_NAME && row.secondHalf === ABSENT_NAME)) {
        here.add(id);
      }
    }
    for (const id of here) {
      played.set(id, played.get(id) + 1);
    }
  }
  return played;
}

/** Level 0 to 3 of a true share (0 to 1): the same thirds as the circle chart. */
function levelOfShare(share) {
  return share <= 0 ? 0 : share * 3 <= 1 + 1e-9 ? 1 : share * 3 <= 2 + 1e-9 ? 2 : 3;
}

export const HISTORY_COLUMNS = ["name", "played", "goals", "potd"];

/**
 * The player table rows, sorted. `totals` is seasonTotals(...).players. Ties and the first view are A to Z by name; zero is a
 * number like any other. `levels` is null (a dash) when the player has no halves (or no minutes, in Minutes).
 * @returns {{ id, name, played, goals, potd, levels: null | { Goal, Defence, Midfield, Attack } }[]}
 */
export function historyRows(players, totals, playedBy, sort, mode = "halves") {
  const rows = players.map((p) => {
    const season = totals.get(p.id);
    let levels = null;
    if (mode === "minutes" ? season?.minutesTotal > 0 : season?.halvesPlayed > 0) {
      levels = Object.fromEntries(AREAS.map((a) => [a, mode === "minutes" ? levelOfShare(season.minutesShare[a]) : season.level[a]]));
    }
    return { id: p.id, name: p.name, played: playedBy.get(p.id) ?? 0, goals: season?.goals ?? 0, potd: season?.potdCount ?? 0, levels };
  });
  const way = sort.descending ? -1 : 1;
  const byName = (a, b) => a.name.localeCompare(b.name);
  return rows.sort((a, b) => (sort.column === "name" ? byName(a, b) * way : (a[sort.column] - b[sort.column]) * way || byName(a, b)));
}
