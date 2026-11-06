// Game rules. No screen code and no storage here, so they run under `node --test`.
//
// Dates and times are kept exactly as the date and time boxes give them, as plain
// text ("2026-11-14", "08:30"). They never pass through a time zone, so a game
// cannot slip to the day before or after, whatever the phone's zone or region.

// Fixed for now (J1-S5 is on the Later list). Stored on each game, so changing
// them later leaves old games correct.
export const FORMATION = "3-3-2";
export const HALF_MINUTES = 25;
// Line-up places in 3-3-2: 0 goal, 1-3 defence, 4-6 midfield, 7-8 forwards, each left to right.
export const POSITION_COUNT = 9;

export const NOT_STARTED = "not started";
export const NOT_PLANNED = "not planned";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function cleanText(text) {
  return String(text ?? "").trim();
}

/** A blank detail, or one holding only spaces. */
export function isBlank(text) {
  return cleanText(text).length === 0;
}

/** What the New game screen holds before anything is typed. `marked` lists fields showing Needed. */
export function blankGameForm() {
  return { date: "", kickOff: "", opposition: "", venue: "", marked: {} };
}

/** All four details are needed. There is no minimum squad size and no date check. */
export function canCreateGame(form) {
  return [form.date, form.kickOff, form.opposition, form.venue].every((detail) => !isBlank(detail));
}

/** A line-up with every place empty. Each call gives a separate one. */
function emptyLineUp() {
  return { status: NOT_PLANNED, positions: new Array(POSITION_COUNT).fill(null) };
}

/**
 * The saved game. Later stories build on this shape:
 * - `id` never changes. It is random rather than 1, 2, 3 so that it stays unique
 *   even if the phone's data is lost and counting would start again: the Sheet
 *   uses it to skip games it already holds. Event log entries will point to it.
 * - `lineups` has one line-up per half. `positions` holds player ids, or null for
 *   an empty place. The bench is whoever is neither placed nor absent.
 * - `absent` holds player ids, on the game and not on a half (GDA-18).
 * - A game with no rotation length uses 6 minutes (GDA-32 adds it).
 */
export function newGame(form, id, createdOrder) {
  return {
    id,
    createdOrder,
    state: NOT_STARTED,
    date: form.date,
    kickOff: form.kickOff,
    opposition: cleanText(form.opposition),
    venue: cleanText(form.venue),
    formation: FORMATION,
    halfMinutes: HALF_MINUTES,
    absent: [],
    lineups: { firstHalf: emptyLineUp(), secondHalf: emptyLineUp() },
  };
}

/** The number for a new game: one more than the highest so far. */
export function nextCreatedOrder(games) {
  return games.reduce((highest, game) => Math.max(highest, game.createdOrder), 0) + 1;
}

/** Soonest kick-off first. With the same kick-off, the one created first comes first. */
export function gamesInOrder(games) {
  return [...games].sort((a, b) => {
    const first = a.date + " " + a.kickOff;
    const second = b.date + " " + b.kickOff;
    if (first === second) {
      return a.createdOrder - b.createdOrder;
    }
    return first < second ? -1 : 1;
  });
}

/** "2026-11-14" becomes "Sat 14 Nov". Worked out in UTC only so no time zone can move the day. */
export function formatGameDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  const calendarDay = new Date(0);
  calendarDay.setUTCFullYear(year, month - 1, day);
  return `${DAYS[calendarDay.getUTCDay()]} ${day} ${MONTHS[month - 1]}`;
}

/** "08:30" becomes "8:30 am". Written out by hand so the phone's region cannot change it. */
export function formatKickOff(kickOff) {
  const [hours, minutes] = kickOff.split(":");
  const hour = Number(hours);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minutes} ${hour < 12 ? "am" : "pm"}`;
}
