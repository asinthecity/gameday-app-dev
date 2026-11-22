// The season List (GDA-48): who is listed, in what order. No screen code, so it runs under `node --test`.
// It only orders what GDA-173 (seasonTotals) already worked out. It never ranks, suggests or highlights:
// the coach chooses the sort by tapping a heading, and the app never sorts by itself.

import { AREAS } from "./season-rules.js";

/** The List's columns, in order: the name, then the four areas. */
export const LIST_COLUMNS = ["name", ...AREAS];

const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * @param {object[]} players  the current squad [{ id, name }]
 * @param {Map} totals        seasonTotals(...).players (id -> PlayerSeason)
 * @param {number[]} absentIds players marked Absent for this game
 * @param {{column: string, descending: boolean}} sort
 * @param {"halves"|"minutes"} mode  which figures to show (GDA-176); the sort and dash rules are the same in both
 * @returns {{ here: Row[], absent: Row[] }}   Row = { id, name, played, percent: {Goal.. Attack} } (percent null = show a dash)
 *
 * Absent players are listed last, under their own heading, sorted the same way within it.
 * On an area column, players with no halves played (dashes) come last in BOTH directions.
 * Ties are always by name A to Z. The sort uses the whole-number percent that is shown.
 */
export function listRows(players, totals, absentIds, sort, mode = "halves") {
  const rows = players.map((p) => {
    const season = totals.get(p.id);
    const none = Object.fromEntries(AREAS.map((a) => [a, null]));
    if (mode === "minutes") {
      // "played" here means "has minutes": a player with no minutes shows dashes, last in either direction (S5).
      return { id: p.id, name: p.name, played: season?.minutesTotal > 0 ? 1 : 0, percent: season?.minutesPercent ?? none };
    }
    return { id: p.id, name: p.name, played: season?.halvesPlayed ?? 0, percent: season?.percent ?? none };
  });
  const way = sort.descending ? -1 : 1;
  const order = (a, b) => {
    if (sort.column === "name") {
      return byName(a, b) * way;
    }
    if (a.played === 0 || b.played === 0) {
      return a.played === b.played ? byName(a, b) : a.played === 0 ? 1 : -1; // dashes last, whichever way it sorts
    }
    return (a.percent[sort.column] - b.percent[sort.column]) * way || byName(a, b);
  };
  const sorted = [...rows].sort(order);
  return { here: sorted.filter((r) => !absentIds.includes(r.id)), absent: sorted.filter((r) => absentIds.includes(r.id)) };
}

/** The measure's name, the first part of the caption. */
export function listMeasure(mode) {
  return mode === "minutes" ? "% of minutes played" : "% of halves played";
}

/** The "based on" part of the caption: "based on 8 games", or in Minutes "based on 5 games, 4 with minutes" (older games have no minutes). */
export function listBasedOn(gamesCounted, mode = "halves", gamesWithMinutes = 0) {
  const games = `${gamesCounted} ${gamesCounted === 1 ? "game" : "games"}`;
  return mode === "minutes" ? `based on ${games}, ${gamesWithMinutes} with minutes` : `based on ${games}`;
}

/** The whole caption as text: "% of halves played · based on 8 games". */
export function listCaption(gamesCounted, mode = "halves", gamesWithMinutes = 0) {
  return `${listMeasure(mode)} \u00b7 ${listBasedOn(gamesCounted, mode, gamesWithMinutes)}`;
}
