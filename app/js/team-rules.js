// Teams (GDA-70). Plain rules, no database: easy to test.
//
// A team is { id, name, playersPerSide, halfMinutes, formation, sheet }.
// "sheet" is the Sheet address and secret (or null when none was ever saved).
// Each player and game carries a teamId saying which team it belongs to.

/** The first team, made once when saved data is upgraded. The id is added by the database. */
export function firstTeam(sheetSettings) {
  return {
    name: "My team",
    playersPerSide: 9,
    halfMinutes: 25,
    formation: "3-3-2",
    sheet: sheetSettings ?? null,
  };
}

/** A copy of the record with teamId added. Every other field is left exactly as it was. */
export function withTeamId(record, teamId) {
  return { ...record, teamId };
}

/**
 * Which team a player or game belongs to. A record with no teamId counts as the
 * first team's, so nothing can drop out of sight (second guard).
 */
export function teamIdOf(record, firstTeamId) {
  return record.teamId ?? firstTeamId;
}

/** The message shown on Home when the upgrade failed and was undone. */
export const UPGRADE_FAILED_MESSAGE =
  "Your saved data could not be upgraded. Nothing has been changed. Close and reopen the app to try again.";

// ---- Several teams (GDA-68) ----

import { anyInProgress } from "./game-rules.js";
import { archiveWarning } from "./sheet-rules.js";
import { hasRecord } from "./record-rules.js";

export const MIN_SIDE = 5;
export const MAX_SIDE = 11;
export const LOCKED_MESSAGE = "Finish the game in progress first";
export const LAST_TEAM_MESSAGE = "Delete team is not offered: this is your only team. Add another team first.";
export const IN_PROGRESS_REFUSAL = "Finish or delete that game first";

/** The team that "no teamId" means: the one made first (lowest id). */
export function firstTeamIdOf(teams) {
  return teams.length ? Math.min(...teams.map((team) => team.id)) : undefined;
}

/** Only the records (players or games) of one team. A record with no teamId counts as the first team's. */
export function ofTeam(records, teamId, firstTeamId) {
  return records.filter((record) => teamIdOf(record, firstTeamId) === teamId);
}

// The first team's id, remembered by the app once teams are loaded, so that
// sameTeam can apply the same "no teamId = first team" guard inside transactions.
let rememberedFirstTeamId = null;
export function rememberFirstTeamId(id) {
  rememberedFirstTeamId = id ?? null;
}

/** True if two records belong to the same team. A record with no teamId counts as the first team's. */
export function sameTeam(a, b) {
  return (a.teamId ?? rememberedFirstTeamId) === (b.teamId ?? rememberedFirstTeamId);
}

/** Checks the team form. Gives { ok, values } or { ok: false, errors } naming each wrong field. */
export function cleanTeamForm(name, size, minutes) {
  const errors = {};
  const wholeNumber = (text) => (/^\d+$/.test(String(text).trim()) ? Number(String(text).trim()) : NaN);
  const cleanedName = String(name ?? "").trim();
  const side = wholeNumber(size);
  const half = wholeNumber(minutes);
  if (!cleanedName) {
    errors.name = "Name needed";
  }
  if (!(side >= MIN_SIDE && side <= MAX_SIDE)) {
    errors.size = `${MIN_SIDE} to ${MAX_SIDE}`;
  }
  if (!(half >= 1)) {
    errors.minutes = "1 or more";
  }
  if (Object.keys(errors).length) {
    return { ok: false, errors };
  }
  return { ok: true, values: { name: cleanedName, playersPerSide: side, halfMinutes: half } };
}

/** The Sheet address and secret to use for a team. The old shared setting is read only for the first team, and only if it has none. */
export function sheetOf(team, legacySettings, firstTeamId) {
  return team?.sheet ?? (team && team.id === firstTeamId ? legacySettings ?? null : null);
}

/** Switching team and Add team are allowed only when no game is in progress. */
export function canSwitchTeams(games) {
  return !anyInProgress(games);
}

/** Why a team cannot be deleted: "only", "inProgress", or null when it can. `games` are that team's games. */
export function deleteRefusal(teams, games) {
  if (teams.length < 2) {
    return "only";
  }
  return anyInProgress(games) ? "inProgress" : null;
}

/** What the delete confirm says: how many players and games go, and how many finished games are not in the Sheet. */
export function deleteSummary(players, games) {
  return {
    players: players.filter((player) => player.active !== false).length,
    games: games.length,
    notInSheet: games.filter((game) => hasRecord(game) && archiveWarning(game) !== null).length,
  };
}

/** "1 player" / "14 players". */
export function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
