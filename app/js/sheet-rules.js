// Sending a finished game to the season Google Sheet (GDA-47). Rules only: no screens,
// no storage, no network, so it all runs under `node --test`.
//
// A game is "to send" if it reached Full Time on this version or later (the mark is set
// by gameAtFullTime). It is "sent" only after Google's reply says so. There is no
// automatic retry anywhere: the app tries once at Full Time, then Ben taps Send now.

export const SETTINGS_KEY = "sheetSettings";

/** True if both the web address and the secret have been entered. */
export function settingsComplete(settings) {
  return Boolean(settings && settings.url && settings.secret);
}

/**
 * The setup code the Sheet's Game Day menu shows is the script address and the secret
 * joined with #:  script.google.com/macros/s/<id>/exec#<secret> (with the secure prefix)
 * Gives { ok, settings: { url, secret } } or { ok: false, message }.
 * Only a Google Apps Script address (script.google.com, /macros/s/<id>/exec) is accepted,
 * so the secret and names can never be sent to another site. A local test address is
 * allowed so the computer checks can use a stand-in script.
 */
export function parseSetupCode(text) {
  const code = String(text ?? "").trim();
  if (!code) {
    return { ok: false, message: "Paste the setup code from the Sheet's Game Day menu." };
  }
  const cut = code.indexOf("#");
  const url = cut < 0 ? code : code.slice(0, cut).trim();
  const secret = cut < 0 ? "" : code.slice(cut + 1).trim();
  let address = null;
  try {
    address = new URL(url);
  } catch (error) {
    address = null;
  }
  const google = address?.protocol === "https:" && address.hostname === "script.google.com" &&
    /^\/macros\/s\/[^/]+\/exec$/.test(address.pathname) && !address.search;
  const local = address?.protocol === "http:" && ["127.0.0.1", "localhost"].includes(address.hostname);
  if (!google && !local) {
    return { ok: false, message: "That doesn't look like a Game Day setup code. Copy it again from the Sheet's Game Day menu." };
  }
  if (!secret) {
    return { ok: false, message: "That is only the address. Paste the whole setup code from the Sheet's Game Day menu (Game Day > Set up)." };
  }
  if (!/^[0-9A-Za-z_-]{8,200}$/.test(secret)) {
    return { ok: false, message: "That setup code looks cut short. Copy all of it again from the Sheet's Game Day menu." };
  }
  return { ok: true, settings: { url, secret } };
}

/**
 * The column headings the app sends, in the order of sheetRows. The script matches values to
 * headings BY NAME, so this text is a contract: renaming one makes the script add a new column.
 */
export const SHEET_HEADINGS = ["Game ID", "Date", "Opposition", "Us", "Them", "Player", "1st half", "2nd half", "Goals", "Bench order", "Home/Away", "Field"];

/**
 * The Sheet rows for a game: the game ID first, then the columns in SHEET_HEADINGS order.
 * No heading row here (the headings are sent separately). Every player of the game is in it (absent ones too).
 */
export function sheetRows(record, gameId) {
  return record.players.map((p) => [gameId, record.date, record.opposition, record.us, record.them, p.name, p.firstHalf, p.secondHalf, p.goals, p.benchOrder ?? "", record.venueTag ?? "", record.venue ?? ""]);
}

/** The tab this copy writes to: "Test" on the test copy, "Season" on the real one (set in config.js). */
export function sheetTabOf(config) {
  return config && config.sheetTab === "Season" ? "Season" : "Test";
}

/** The text posted to the script. One game, all its rows, in one go. */
export function sheetBody(settings, game, tab) {
  return JSON.stringify({ secret: settings.secret, tab, action: "add", gameId: game.id, headings: SHEET_HEADINGS, rows: sheetRows(game.record, game.id) });
}

/** The connection check: same address and secret, writes no row. */
export function checkBody(settings, tab) {
  return JSON.stringify({ secret: settings.secret, tab, action: "check" });
}

/**
 * What a connection check came to. status/json are the reply (null if the fetch failed),
 * online is navigator.onLine. Gives "connected" | "secret" | "offline" | "unreachable" | "tooOld".
 * A reply with ok but no scriptVersion (or an error such as "bad") is the old script.
 */
export function readCheckReply(status, json, online) {
  if (status === null) {
    return online === false ? "offline" : "unreachable";
  }
  if (status !== 200 || !json || typeof json !== "object") {
    return "unreachable";
  }
  if (json.error === "secret") {
    return "secret";
  }
  return json.ok === true && json.scriptVersion ? "connected" : "tooOld";
}

/** The one message shown after Save. */
export function checkMessage(kind, tab) {
  switch (kind) {
    case "connected": return `Connected. Games go to the ${tab} tab.`;
    case "secret": return "The setup code is out of date. Copy it again from the Sheet's Game Day menu.";
    case "offline": return "No signal. Saved; it will be checked when you send.";
    case "tooOld": return "The script in the Sheet is out of date. Paste the new Code.gs.";
    default: return "Couldn't reach the script. In Apps Script check Deploy > Manage deployments: Who has access must be Anyone.";
  }
}

/** The setup code for settings already saved (so the box shows what is stored). */
export function setupCodeOf(settings) {
  return settings && settings.url && settings.secret ? `${settings.url}#${settings.secret}` : "";
}

/**
 * What a send came to, from Google's reply. Only status 200 with { ok: true } counts as
 * sent (a repeat of a game already in the Sheet also says ok, and adds nothing).
 * reason "secret" means the script refused the secret; anything else is "failed".
 */
export function readSheetReply(status, json) {
  if (status === 200 && json && json.ok === true) {
    return { ok: true };
  }
  return { ok: false, reason: json && json.error === "secret" ? "secret" : "failed" };
}

/**
 * What Home shows on a finished game. Gives null for a game with no "to send" mark
 * (finished before the Sheet version): no status, no button.
 * kind: sent | sending | notSetUp | notSent.  `problem` is "secret" after a refused secret.
 */
export function sheetStatus(game, settings, sendingId, problem) {
  if (!game.toSend) {
    return null;
  }
  if (game.sentToSheet) {
    return { kind: "sent" };
  }
  if (sendingId === game.id) {
    return { kind: "sending" };
  }
  if (!settingsComplete(settings)) {
    return { kind: "notSetUp" };
  }
  return { kind: "notSent", checkSettings: problem === "secret" };
}

/** True if a game may be sent now: marked, not yet sent, and the Sheet is set up. */
export function canSend(game, settings) {
  return Boolean(game.toSend) && !game.sentToSheet && settingsComplete(settings);
}

/** Delete is offered only before START 1ST HALF has been tapped (GDA-66). */
export function canDeleteGame(game) {
  return game.state === "not started";
}

/** Archive is offered only on a finished game (one with a record) not already archived (GDA-69). */
export function canArchiveGame(game) {
  return Boolean(game.record) && !game.archived;
}

/** The game with the "archived" flag set. Nothing is erased or sent. A game that cannot be archived is returned as it is. */
export function gameArchived(game) {
  return canArchiveGame(game) ? { ...game, archived: true } : game;
}

/**
 * The red warning on the Archive confirm (GDA-69): null if the game is already in the Sheet,
 * "notInSheet" if it is not (not sent, sending, or Sheet not set up), "noStatus" for an old game with no Sheet status.
 */
export function archiveWarning(game) {
  if (!game.toSend) {
    return "noStatus";
  }
  return game.sentToSheet ? null : "notInSheet";
}
