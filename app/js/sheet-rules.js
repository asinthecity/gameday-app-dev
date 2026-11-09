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
 * Tidies what Ben typed. Gives { ok, settings } or { ok: false, message }.
 * The address must be a secure web address (a local test address is allowed so the
 * computer checks can use a stand-in script).
 */
export function cleanSheetSettings(urlText, secretText) {
  const url = String(urlText ?? "").trim();
  const secret = String(secretText ?? "").trim();
  if (!url || !secret) {
    return { ok: false, message: "Enter both the web address and the secret." };
  }
  let address = null;
  try {
    address = new URL(url);
  } catch (error) {
    address = null;
  }
  // Only a Google Apps Script address (script.google.com, /macros/s/<id>/exec) is accepted,
  // so the secret and names can never be sent to another site. Local test address allowed.
  const google = address?.protocol === "https:" && address.hostname === "script.google.com" &&
    /^\/macros\/s\/[^/]+\/exec$/.test(address.pathname);
  const local = address?.protocol === "http:" && ["127.0.0.1", "localhost"].includes(address.hostname);
  if (!google && !local) {
    return { ok: false, message: "That doesn't look like a Google script address. It should start with script.google.com/macros/s/ and end with /exec" };
  }
  return { ok: true, settings: { url, secret } };
}

/**
 * The Sheet rows for a game: the game ID first, then the file's columns in order
 * (date, opposition, our score, their score, player, 1st half, 2nd half, goals, bench order).
 * No heading row. Every player of the game is in it (absent ones too).
 */
export function sheetRows(record, gameId) {
  return record.players.map((p) => [gameId, record.date, record.opposition, record.us, record.them, p.name, p.firstHalf, p.secondHalf, p.goals, p.benchOrder ?? ""]);
}

/** The text posted to the script. One game, all its rows, in one go. */
export function sheetBody(settings, game) {
  return JSON.stringify({ secret: settings.secret, gameId: game.id, rows: sheetRows(game.record, game.id) });
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
