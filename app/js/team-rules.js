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
