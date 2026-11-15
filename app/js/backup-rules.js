// Back up and restore all app data (GDA-153). Pure rules, no database here.
// The file is plain JSON: { type, dbVersion, savedAt, stores: { players: [...], ... } }.
// Photos and logos are stored as text (a JPEG data address), so they travel as they are, byte for byte.

import { isStoredPhoto } from "./photo-rules.js";

export const BACKUP_TYPE = "gameday-backup";
export const NOT_A_BACKUP = "This is not a Game Day backup.";
export const WRONG_VERSION = "Made by a different version of the app. Make a new backup first.";
export const RESTORE_ASK = "Restore will replace all data on this phone. Continue?";
export const RESTORE_BUSY = "Finish the game first";
export const RESTORE_FAILED = "Restore did not work. Your data is unchanged.";
export const BACKUP_FAILED = "Could not make the backup. Please try again.";

/** Each store, and the name of the key its records are kept under. */
const KEYS = { players: "id", meta: "key", games: "id", events: "id", teams: "id", photos: "playerId", logos: "teamId" };
export const STORE_NAMES = Object.keys(KEYS);

/** The text of a backup file. `stores` holds every record of every store. */
export function makeBackup(dbVersion, stores, now = new Date()) {
  return JSON.stringify({ type: BACKUP_TYPE, dbVersion, savedAt: now.toISOString(), stores });
}

/** "gameday-backup-2026-11-15.json" (the phone's own date, not UTC). */
export function backupFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `gameday-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** True when a record has its key and, for photos and logos, a real stored picture. */
function recordOk(store, record) {
  if (!isObject(record)) {
    return false;
  }
  const key = record[KEYS[store]];
  if (key === undefined || key === null || key === "") {
    return false;
  }
  if (store === "photos" || store === "logos") {
    return isStoredPhoto(record.data);
  }
  if (store === "events") {
    return record.gameId !== undefined; // Every event belongs to a game.
  }
  return true;
}

/**
 * Checks the WHOLE file before anything is written. Returns { ok: true, stores } or
 * { ok: false, message }. Nothing is changed here.
 */
export function parseBackup(text, dbVersion) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, message: NOT_A_BACKUP };
  }
  if (!isObject(file) || file.type !== BACKUP_TYPE || !isObject(file.stores)) {
    return { ok: false, message: NOT_A_BACKUP };
  }
  if (file.dbVersion !== dbVersion) {
    return { ok: false, message: WRONG_VERSION };
  }
  const seen = {};
  for (const store of STORE_NAMES) {
    const records = file.stores[store];
    if (!Array.isArray(records)) {
      return { ok: false, message: NOT_A_BACKUP };
    }
    seen[store] = new Set();
    for (const record of records) {
      // A bad record, or two records with one key, refuses the whole file.
      if (!recordOk(store, record) || seen[store].has(record[KEYS[store]])) {
        return { ok: false, message: NOT_A_BACKUP };
      }
      seen[store].add(record[KEYS[store]]);
    }
  }
  // A backup with no team cannot be a real one: the app always has at least one.
  if (file.stores.teams.length === 0) {
    return { ok: false, message: NOT_A_BACKUP };
  }
  const stores = {};
  for (const store of STORE_NAMES) {
    stores[store] = file.stores[store];
  }
  return { ok: true, stores };
}
