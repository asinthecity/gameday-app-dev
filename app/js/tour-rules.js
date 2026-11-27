// The App tour (GDA-212): plain rules, no screens and no storage, so they all run under `node --test`.
//
// What it is: on a brand-new install the app makes a "Demo team" and shows ten short tips, one at a
// time, on the real screens. Tips only ever show while the Demo team is the current team.
// Words come from docs/discovery/10-domain-model.md (team, player, game, line-up, bench, Swap, Full Time).

/** The one stored flag (meta store): true once the app has decided about the tour on this phone. */
export const TOUR_FLAG = "tourShown";
/** The tips already closed with "Got it" (meta store): a list of tip numbers. */
export const SEEN_KEY = "tourSeen";
/** The Demo team's name. Tips are tied to this name, so a coach who renames it ends the tips. */
export const DEMO_NAME = "Demo team";

/** The default team a new install starts with (db.js, firstTeam). */
const DEFAULT_TEAM_NAME = "My team";

/**
 * Is this a fresh install? Only when the ONE team is the untouched default ("My team") with no player
 * and no game at all (archived or removed ones count), and no flag has been stored yet. Anything else,
 * such as Ben's own phone with a squad, is NOT fresh and must never get a Demo team.
 * `facts` is { teams, players, games, flag }: the raw records of the three stores and the flag value.
 */
export function isFreshInstall(facts) {
  const { teams = [], players = [], games = [], flag } = facts;
  return flag === undefined && teams.length === 1 && teams[0].name === DEFAULT_TEAM_NAME && players.length === 0 && games.length === 0;
}

/** True when this team is the Demo team. */
export function isDemoTeam(team) {
  return Boolean(team) && team.name === DEMO_NAME;
}

/** True when any team (archived ones too) is the Demo team, so App tour does not make a second one. */
export function demoTeamExists(teams) {
  return teams.some(isDemoTeam);
}

/**
 * Restore (criterion 3): the records to write are the backup's own, plus the flag, so a restored phone
 * never gets a Demo team and never starts tips on its own, whether or not the backup had a flag.
 * Returns a new meta list; the backup's other records are untouched.
 */
export function metaWithFlag(meta) {
  return [...meta.filter((record) => record.key !== TOUR_FLAG), { key: TOUR_FLAG, value: true }];
}

// ---- The Demo team's contents ----
// Twelve made-up first names: 9 on the pitch and 3 on the bench for a 9-a-side game.
export const DEMO_PLAYERS = ["Alex", "Ben", "Charlie", "Dylan", "Ethan", "Finn", "George", "Harry", "Isaac", "Jack", "Kai", "Leo"];

/** The Demo team's settings: the same defaults as a team made on the Add team screen. */
export const DEMO_TEAM = { name: DEMO_NAME, playersPerSide: 9, halfMinutes: 25 };

const pad = (n) => String(n).padStart(2, "0");
/** "2026-11-28" in the phone's own date, the way the date box on the New game screen saves it. */
function dateText(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The two Demo games' details. `now` is a Date. The ready game is today; the finished game is a week ago
 * and was played at 10:00 (its times are real timestamps in the past, so no clock is running).
 */
export function demoGames(now) {
  const lastWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 10, 0, 0);
  return {
    ready: { date: dateText(now), kickOff: "10:00", opposition: "Sample FC", venueTag: "Home", venue: "" },
    finished: { date: dateText(lastWeek), kickOff: "10:00", opposition: "Example United", venueTag: "Away", venue: "" },
    kickOffAt: lastWeek.getTime(),
  };
}

const MIN = 60 * 1000;
/**
 * The finished game's story, as steps for the real game functions: kick-off, goals in the 1st half, half time,
 * the 2nd half, a goal against, Full Time. Won 3-2: three goals by players at positions 0..11 of the squad
 * (given as squad indexes), two against. Times are minutes after kick-off.
 */
export function demoFinishedPlan(kickOffAt, halfMinutes = DEMO_TEAM.halfMinutes) {
  const secondStart = kickOffAt + (halfMinutes + 5) * MIN;
  return {
    firstHalfStart: kickOffAt,
    firstHalfEnd: kickOffAt + halfMinutes * MIN,
    secondHalfStart: secondStart,
    secondHalfEnd: secondStart + halfMinutes * MIN,
    // Each goal: side, which squad player (index) scored it, and the time. Goals go in time order.
    goals: [
      { side: "us", scorer: 7, half: 1, at: kickOffAt + 6 * MIN },
      { side: "them", scorer: null, half: 1, at: kickOffAt + 14 * MIN },
      { side: "us", scorer: 4, half: 1, at: kickOffAt + 21 * MIN },
      { side: "us", scorer: 7, half: 2, at: secondStart + 8 * MIN },
      { side: "them", scorer: null, half: 2, at: secondStart + 17 * MIN },
    ],
    potd: 7, // squad index of the Player of the day
  };
}

// ---- The tips ----

/** The ten tips, exactly as approved in docs/mockups/gda-212/tips.html. `animated` tips show the drag animation. */
export const TIPS = [
  { n: 1, text: "Set up your Squad, formation and game day defaults in Team settings." },
  { n: 2, text: "Create a new game to get started." },
  { n: 3, text: "Drag players between the positions to set your starting line-up.", animated: true },
  { n: 4, text: "The bars show where each player has played so far this season." },
  { n: 5, text: "Tap a player to see their detailed season history." },
  { n: 6, text: "In a game, drag a bench player onto a pitch player to plan a swap.", animated: true },
  { n: 7, text: "Drag another bench player on to plan several swaps at once.", animated: true },
  { n: 8, text: "Tap Swap when you’re ready; all planned swaps happen together." },
  { n: 9, text: "Tap the score to log a goal. Tap a player for notes and Player of the day." },
  { n: 10, text: "At Full Time, check the summary, then tap End game and save." },
];
export const TIP_COUNT = TIPS.length;

/** The list of tip numbers marked seen, cleaned: only whole numbers 1 to 10, no repeats. */
export function cleanSeen(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((n) => Number.isInteger(n) && n >= 1 && n <= TIP_COUNT))];
}

/** The seen list with one more tip added (a new list; the old one is not changed). */
export function withSeen(seen, n) {
  return cleanSeen([...seen, n]);
}

/**
 * Which tip is due now, or null. One at a time: the lowest number whose trigger holds. Never any tip unless
 * the current team is the Demo team.
 * `ctx`: { demo, screen, seen, sheetOpen, topMenuOpen, profileOpen, notStarted, running, planned, swapMade, viewing }
 *   demo: the current team is the Demo team       screen: "home", "half1", "fullTime" ...
 *   notStarted: the open game has not kicked off   running: the open game's clock is running
 *   planned: a swap is planned                      swapMade: a swap has been made in the open game
 *   profileOpen: a player card is open              viewing: a finished game is being looked at from Home
 */
export function dueTip(ctx) {
  if (!ctx.demo) {
    return null;
  }
  const seen = (n) => ctx.seen.includes(n);
  const onLineUp = ctx.screen === "half1" && ctx.notStarted && !ctx.profileOpen;
  const inGame = (ctx.screen === "half1" || ctx.screen === "half2") && ctx.running && !ctx.profileOpen && !ctx.sheetOpen;
  const rules = [
    [1, ctx.screen === "home" && !seen(1)],
    [2, ctx.screen === "home" && seen(1) && !seen(2)],
    [3, onLineUp && !seen(3)],
    [4, onLineUp && seen(3) && !seen(4)],
    [5, ctx.screen === "half1" && ctx.notStarted && ctx.profileOpen && !seen(5)],
    [6, inGame && !seen(6) && !ctx.swapMade],
    [7, inGame && seen(6) && !seen(7) && ctx.planned && !ctx.swapMade],
    [8, inGame && seen(7) && !seen(8) && ctx.planned && !ctx.swapMade],
    [9, inGame && ctx.swapMade && !seen(9)],
    [10, ctx.screen === "fullTime" && !ctx.viewing && !seen(10)],
  ];
  const found = rules.find(([, due]) => due);
  return found ? found[0] : null;
}
