// Formations (GDA-22). Plain rules, no screen and no storage: easy to test.
//
// A formation is text: the outfield lines from defence to attack, e.g. "3-3-2".
// The numbers add up to players per side minus 1 (the keeper). Place 0 is always
// the keeper, then the places run line by line, defence to attack, left to right.
// So changing the shape never moves anyone: it only regroups the same places.

export const MIN_LINES = 2;
export const MAX_ACROSS = 5;
export const OLD_FORMATION = "3-3-2"; // Every game made before GDA-22.

/** The sizes of the lines, e.g. "3-3-2" gives [3, 3, 2]. Assumes the text is valid. */
export function lineSizes(formation) {
  return String(formation ?? OLD_FORMATION).split("-").map(Number);
}

/**
 * GDA-83: keeps only the digits of what was typed or pasted and joins them with "-",
 * dash only between numbers ("332" -> "3-3-2", "3-3-" -> "3-3"). Every line is 1 to 5
 * players, so each number is one digit.
 */
export function formatFormationDigits(text) {
  return (String(text ?? "").match(/\d/g) ?? []).join("-");
}

/**
 * Checks typed text against the team size. Gives { ok: true, formation } or
 * { ok: false, message } saying what is wrong.
 */
export function checkFormation(text, playersPerSide) {
  const typed = String(text ?? "");
  if (!/^\d+(-\d+)*$/.test(typed)) {
    return { ok: false, message: "Type numbers and dashes, like 3-3-2." };
  }
  const sizes = typed.split("-").map(Number);
  if (sizes.length < MIN_LINES) {
    return { ok: false, message: "Use at least 2 lines, like 3-3-2." };
  }
  if (sizes.some((size) => size < 1 || size > MAX_ACROSS)) {
    return { ok: false, message: `Each line must be 1 to ${MAX_ACROSS} players.` };
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const needed = playersPerSide - 1;
  if (total !== needed) {
    return { ok: false, message: `${typed} adds to ${total} but this team needs ${needed}.` };
  }
  return { ok: true, formation: typed };
}

/** True if the shape is valid for the team size. */
export function fitsTeam(formation, playersPerSide) {
  return checkFormation(formation, playersPerSide).ok;
}

/** An even split of the outfield players over two lines, defence first getting any extra: 8 gives "4-4", 9 gives "5-4". */
export function evenSplit(playersPerSide) {
  const outfield = playersPerSide - 1;
  const defence = Math.ceil(outfield / 2);
  return `${defence}-${outfield - defence}`;
}

/** The shape a new game for this team starts with: the remembered one if it still fits, otherwise an even split. */
export function startingFormation(team) {
  return fitsTeam(team.formation, team.playersPerSide) ? team.formation : evenSplit(team.playersPerSide);
}

/** Lines of place numbers for drawing, attack first (top of the pitch), keeper last. */
export function pitchRows(formation) {
  const sizes = lineSizes(formation);
  const rows = [];
  let next = 1;
  for (const size of sizes) {
    rows.push(Array.from({ length: size }, () => next++));
  }
  return [...rows.reverse(), [0]];
}

/** Number of places for a shape (keeper included). */
export function placeCount(formation) {
  return 1 + lineSizes(formation).reduce((sum, size) => sum + size, 0);
}

/** Position name for a place in a shape: Goal, Defence (first line), Attack (last line), Midfield between. */
export function positionNameIn(formation, place) {
  if (place === 0) {
    return "Goal";
  }
  const sizes = lineSizes(formation);
  let end = 0;
  for (let line = 0; line < sizes.length; line++) {
    end += sizes[line];
    if (place <= end) {
      return line === 0 ? "Defence" : line === sizes.length - 1 ? "Attack" : "Midfield";
    }
  }
  return "Attack";
}

/** The first shape for a brand-new team: 3-3-2 for 9 a side (as before), otherwise an even split. */
export function firstFormationFor(playersPerSide) {
  return playersPerSide === 9 ? OLD_FORMATION : evenSplit(playersPerSide);
}
