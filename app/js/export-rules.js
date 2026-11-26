// Export to spreadsheet (GDA-189): one CSV of every team's finished games, for the coach to open in
// Google Sheets by hand. Rules only: no screens, no storage, so it all runs under `node --test`.
// The export only reads: nothing stored is changed.

import { csvCell, countsInSeason } from "./record-rules.js";
import { teamIdOf } from "./team-rules.js";

export const NOTHING_TO_EXPORT = "Nothing to export yet. Finish a game first.";
export const EXPORT_FAILED = "Could not make the export. Please try again.";
export const EXPORT_HINT = "Open the file in Google Sheets via Drive, or use File > Import.";

/** The column headings, in the order of the rows. */
export const EXPORT_HEADINGS = ["Team", "Game ID", "Date", "Opposition", "Us", "Them", "Player", "1st half", "2nd half", "Goals", "Bench order", "Home/Away", "Field", "Coach's note", "Player of the day"];

/**
 * Stops a text such as "=1+1" from being run as a formula in a spreadsheet: an apostrophe goes in front of
 * a text that starts with = + - or @ (after any leading tabs or line breaks). Numbers are left alone.
 * The same rule the old Sheet script used.
 */
export function safeCell(value) {
  return typeof value === "string" && /^[\t\r\n]*[=+\-@]/.test(value) ? "'" + value : value;
}

/** The rows of one game: the team's name, the game ID, then the columns after it. Every player is in it (absent ones too). */
function gameRows(game, teamName) {
  const record = game.record;
  return record.players.map((p) => [teamName, game.id, record.date, record.opposition, record.us, record.them, p.name, p.firstHalf, p.secondHalf, p.goals, p.benchOrder ?? "", record.venueTag ?? "", record.venue ?? "", p.note ?? "", p.playerOfTheDay ? "Yes" : ""]);
}

/**
 * The export rows (no heading row): every finished game with a record from every team. Games not yet
 * finished, and archived games (GDA-204), are left out. Teams in the order they were made, games oldest first.
 */
export function exportRows(teams, games) {
  const firstTeamId = teams.length ? Math.min(...teams.map((team) => team.id)) : undefined;
  const teamOrder = [...teams].sort((a, b) => a.id - b.id);
  const rows = [];
  for (const team of teamOrder) {
    const finished = games
      .filter((game) => countsInSeason(game) && teamIdOf(game, firstTeamId) === team.id)
      .sort((a, b) => String(a.record.date).localeCompare(String(b.record.date)) || a.id - b.id);
    for (const game of finished) {
      rows.push(...gameRows(game, team.name ?? ""));
    }
  }
  return rows;
}

/** The CSV text: the heading row, then one row per player per game. Every cell is made formula-safe, then quoted if needed. */
export function exportCsv(rows) {
  return [EXPORT_HEADINGS, ...rows].map((row) => row.map((cell) => csvCell(safeCell(cell))).join(",")).join("\r\n") + "\r\n";
}

/** "gameday-export-2026-11-25.csv" (the phone's own date, not UTC). */
export function exportFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `gameday-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}

// ---- Clean-up of the old Sheet connection (GDA-189) ----

/** The meta key the old app-wide Sheet setting was stored under. Only the start-up clean-up reads it. */
export const OLD_SHEET_KEY = "sheetSettings";

/** The team without the old Sheet copy (`sheet`). Gives the same team object if there was none, so nothing needs saving. */
export function teamWithoutSheet(team) {
  if (!Object.hasOwn(team, "sheet")) {
    return team;
  }
  const { sheet, ...rest } = team;
  return rest;
}
