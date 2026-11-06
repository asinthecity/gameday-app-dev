// Squad rules. No screen code and no storage here, so they run under `node --test`.

// The number of placeholder colours (.c0 to .c7 in style.css).
export const COLOUR_COUNT = 8;

/** Removes spaces before and after: "  Kit " becomes "Kit". */
export function cleanName(text) {
  return String(text ?? "").trim();
}

/** A blank name, or only spaces, cannot be saved. */
export function canSaveName(text) {
  return cleanName(text).length > 0;
}

/**
 * The placeholder text: the first two letters in capitals, or one letter for a
 * one-letter name. Characters that are not letters are skipped ("O'Neil" gives
 * "ON"). A name with no letters or digits at all shows its first two characters.
 */
export function initialsFor(name) {
  const letters = name.match(/\p{L}\p{M}*|\p{N}/gu) ?? Array.from(name);
  return letters.slice(0, 2).join("").toUpperCase();
}

/**
 * The colour for a new player, taken in turn. The count includes removed
 * players, so it only ever goes up. The colour is stored with the player and
 * never worked out again, so it survives restarts and renames.
 */
export function colourForNewPlayer(playersEverAdded) {
  return playersEverAdded % COLOUR_COUNT;
}

/** Alphabetical by name, ignoring capitals. Two players of the same name keep the order they were added. */
export function compareByName(a, b) {
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id - b.id;
}

/** The squad as shown: removed players left out, in alphabetical order. */
export function squadInOrder(allPlayers) {
  return allPlayers.filter((player) => player.active).sort(compareByName);
}
