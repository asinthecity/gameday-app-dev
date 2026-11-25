// Teams (GDA-70). Plain rules, no database: easy to test.
//
// A team is { id, name, playersPerSide, halfMinutes, formation, ... }.
// Each player and game carries a teamId saying which team it belongs to.

/** The first team, made once when saved data is upgraded. (Its old `sheet` copy is deleted on the next start, GDA-189.) The id is added by the database. */
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

import { anyInProgress, blankGameForm, clampRotation, ROTATION_MINUTES } from "./game-rules.js";
import { evenSplit, firstFormationFor, fitsTeam, startingFormation } from "./formation-rules.js";

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

/** What the delete confirm says: how many players and games go. */
export function deleteSummary(players, games) {
  return {
    players: players.filter((player) => player.active !== false).length,
    games: games.length,
  };
}

/** "1 player" / "14 players". */
export function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// ---- Default game settings on the team (GDA-167) ----

/**
 * The settings a new game starts from. Teams made before GDA-167 (and old backups) have none of the new fields,
 * so each falls back to today's behaviour: 6 min, the team's last-used Formation, both carry-overs ON.
 */
export function teamGameDefaults(team) {
  return {
    rotationMinutes: Number.isFinite(team.rotationMinutes) ? team.rotationMinutes : ROTATION_MINUTES,
    rotationExtraSeconds: Number.isFinite(team.rotationExtraSeconds) ? team.rotationExtraSeconds : 0,
    formation: startingFormation(team),
    carryRotationOrder: team.carryRotationOrder !== false,
    carryBenchTime: team.carryBenchTime !== false,
    showSeasonChart: team.showSeasonChart !== false, // GDA-177: missing counts as ON
    showRotationCounts: team.showRotationCounts !== false,
  };
}

/** The New game form, pre-filled from the team's defaults. A rotation longer than the half is lowered on the form, with a note; the saved default is left alone. */
export function newGameFormFor(team) {
  const defaults = teamGameDefaults(team);
  const form = blankGameForm();
  form.halfMinutes = team.halfMinutes;
  form.playersPerSide = team.playersPerSide;
  form.formation = defaults.formation;
  form.carryRotationOrder = defaults.carryRotationOrder;
  form.carryBenchTime = defaults.carryBenchTime;
  form.showSeasonChart = defaults.showSeasonChart; // GDA-177: the new game copies the team's defaults (no row on the form)
  form.showRotationCounts = defaults.showRotationCounts;
  form.rotationMinutes = defaults.rotationMinutes;
  form.rotationExtraSeconds = defaults.rotationExtraSeconds;
  if (form.rotationMinutes > team.halfMinutes) {
    form.rotationNote = `Rotation lowered to ${team.halfMinutes} min to fit the half.`;
    form.rotationMinutes = clampRotation(form.rotationMinutes, team.halfMinutes);
    form.rotationExtraSeconds = 0;
  }
  return form;
}

/** The default Formation to show when Players per side is set to `size`: unchanged if the size is the team's own, otherwise an even split. `team` is null for a new team. */
export function formationAfterSizeChange(team, size) {
  if (!team) {
    return firstFormationFor(size); // a brand-new team starts as before: 3-3-2 for 9 a side, else an even split
  }
  return team.playersPerSide === size ? teamGameDefaults(team).formation : evenSplit(size);
}

/**
 * What is saved for a team: the cleaned name, size and half length plus the default game settings.
 * A default Formation that does not fit the size is never saved (an even split instead).
 * `defaults` is null for a brand-new team that made no choices.
 */
export function teamValuesToSave(values, defaults, team) {
  const chosen = defaults ?? (team ? teamGameDefaults(team) : { rotationMinutes: ROTATION_MINUTES, rotationExtraSeconds: 0, carryRotationOrder: true, carryBenchTime: true, showSeasonChart: true, showRotationCounts: true });
  const formation = chosen.formation && fitsTeam(chosen.formation, values.playersPerSide) ? chosen.formation : team ? evenSplit(values.playersPerSide) : firstFormationFor(values.playersPerSide);
  return {
    ...values,
    rotationMinutes: chosen.rotationMinutes,
    rotationExtraSeconds: chosen.rotationExtraSeconds,
    carryRotationOrder: chosen.carryRotationOrder !== false,
    carryBenchTime: chosen.carryBenchTime !== false,
    showSeasonChart: chosen.showSeasonChart !== false,
    showRotationCounts: chosen.showRotationCounts !== false,
    formation,
  };
}

/** The team form's starting values: the typed fields as text, and the default game settings. `team` is null for Add team. */
export function teamFormValues(team) {
  const defaults = team ? teamGameDefaults(team) : { rotationMinutes: ROTATION_MINUTES, rotationExtraSeconds: 0, carryRotationOrder: true, carryBenchTime: true, showSeasonChart: true, showRotationCounts: true, formation: firstFormationFor(9) };
  return team
    ? { name: team.name, size: String(team.playersPerSide), minutes: String(team.halfMinutes), defaults }
    : { name: "", size: "9", minutes: "25", defaults };
}
