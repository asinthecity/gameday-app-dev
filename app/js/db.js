// A small wrapper around the browser's database (IndexedDB).
//
// The rule for the whole app: every change is one all-or-nothing transaction,
// and the screen changes only after that transaction has finished. change()
// is what makes that easy to follow.

import { firstTeam, withTeamId } from "./team-rules.js";

const DB_VERSION = 5;

/** Opens the database, creating it on first use. */
export function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    let upgradeFailed = false;

    request.onupgradeneeded = (event) => {
      const db = request.result;
      try {
        upgrade(db, request.transaction, event.oldVersion);
      } catch (error) {
        failUpgrade(error);
      }
    };

    function upgrade(db, tx, oldVersion) {
      const event = { oldVersion };
      // Later versions add a new "if" below. Never edit a step already published.
      if (event.oldVersion < 1) {
        db.createObjectStore("players", { keyPath: "id", autoIncrement: true });
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (event.oldVersion < 2) {
        db.createObjectStore("games", { keyPath: "id" });
      }
      if (event.oldVersion < 3) {
        // The event log: what happened and when, one record per event, never
        // rewritten. The id counts up, so it is also the order things happened.
        // Every later kind of event (goals, half start and end) goes here too.
        const events = db.createObjectStore("events", { keyPath: "id", autoIncrement: true });
        events.createIndex("gameId", "gameId");
      }
      if (event.oldVersion < 4) {
        // Teams (GDA-70). Adds data only: one team, and a teamId on each player and game.
        // Nothing else is changed or deleted, and the old Sheet setting stays where it is.
        const teams = db.createObjectStore("teams", { keyPath: "id", autoIncrement: true });
        const meta = tx.objectStore("meta");
        meta.get("sheetSettings").onsuccess = guarded((found) => {
          teams.add(firstTeam(found.target.result?.value)).onsuccess = guarded((added) => {
            const teamId = added.target.result;
            meta.put({ key: "currentTeamId", value: teamId }); // The chosen team.
            for (const storeName of ["players", "games"]) {
              tx.objectStore(storeName).openCursor().onsuccess = guarded((step) => {
                const cursor = step.target.result;
                if (cursor) {
                  cursor.update(withTeamId(cursor.value, teamId));
                  // UPGRADE-STEP-DONE (the browser check breaks the upgrade here on purpose)
                  cursor.continue();
                }
              });
            }
          });
        });
      }
      if (event.oldVersion < 5) {
        // Player photos (GDA-52). Adds one empty store, keyed by player id. Nothing else is touched.
        db.createObjectStore("photos", { keyPath: "playerId" });
      }
    }

    // Any mistake inside an upgrade step (including the ones that run a moment later,
    // inside a database callback) undoes the whole upgrade.
    function guarded(step) {
      return (event) => {
        try {
          step(event);
        } catch (error) {
          failUpgrade(error);
        }
      };
    }
    function failUpgrade(error) {
      console.warn("Upgrade failed", error);
      upgradeFailed = true;
      try {
        request.transaction.abort(); // The browser puts the database back exactly as it was.
      } catch {
        // Already undone.
      }
    }

    request.onsuccess = () => {
      const db = request.result;
      // A newer version of the app needs this database: let go so it can upgrade.
      db.onversionchange = () => db.close();
      names.set(db, name);
      live.set(db, db);
      watch(db, db);
      resolve(db);
    };
    request.onerror = () => {
      if (upgradeFailed) {
        const problem = new Error("The saved data could not be upgraded");
        problem.upgradeFailed = true;
        reject(problem);
      } else {
        reject(request.error);
      }
    };
    request.onblocked = () => reject(new Error("Database is in use by an older page"));
  });
}

// GDA-117: the phone can leave a connection dead (rotate, lock) or a save that never answers.
// The handle the app holds never changes; this table says which live connection it stands for.
const SAVE_TIME_LIMIT_MS = 5000;
const names = new Map(); // app's handle -> database name
const live = new Map(); // app's handle -> the connection to use now (null = open a fresh one)

/** The connection to use now, opening a new one if the old one died. */
async function connection(handle) {
  if (!live.get(handle)) {
    live.set(handle, await openDatabase(names.get(handle)));
    watch(handle, live.get(handle));
  }
  return live.get(handle);
}

/** When the browser closes a connection behind our back, the next save opens a new one. */
function watch(handle, connectionNow) {
  connectionNow.onclose = () => live.get(handle) === connectionNow && live.set(handle, null);
}

/** Runs one transaction. Settles only on complete/abort/error, or fails after the time limit. */
function once(db, storeNames, mode, work, limit) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const end = (finish, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        finish(value);
      }
    };
    let tx;
    try {
      // "strict" asks the browser to reach the disk before saying it has finished.
      tx = db.transaction(storeNames, mode, { durability: "strict" });
    } catch (error) {
      error.connectionDead = true;
      reject(error);
      return;
    }
    let answer;
    // A save that has not settled in time is ended as failed. A late "complete" is ignored.
    const timer = setTimeout(() => {
      try {
        tx.abort(); // If it never committed, it never will.
      } catch {
        // Already finished or gone.
      }
      const problem = new Error("Save timed out");
      problem.timedOut = true;
      end(reject, problem);
    }, limit);
    // Resolves on "complete", never earlier: until then nothing is safely saved.
    tx.oncomplete = () => end(resolve, answer);
    tx.onabort = () => end(reject, tx.error ?? new Error("Save was cancelled"));
    tx.onerror = () => end(reject, tx.error);
    try {
      work(tx, (value) => {
        answer = value;
      });
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // Already finished.
      }
      end(reject, error);
    }
  });
}

async function run(db, storeNames, mode, work, limit = SAVE_TIME_LIMIT_MS) {
  if (!names.has(db)) {
    return once(db, storeNames, mode, work, limit); // Not opened by openDatabase (should not happen).
  }
  try {
    return await once(await connection(db), storeNames, mode, work, limit);
  } catch (error) {
    if (error?.timedOut) {
      live.set(db, null); // The connection is suspect: the next save opens a fresh one. No retry here.
    }
    if (!error?.connectionDead) {
      throw error;
    }
    // Dead connection: drop it, open a fresh one, and try once more.
    live.set(db, null);
    return once(await connection(db), storeNames, mode, work, limit);
  }
}

/** One all-or-nothing change. Finishes only once the change is saved. */
export function change(db, storeNames, work) {
  return run(db, storeNames, "readwrite", work);
}

/** Reads only. work(tx, answer) calls answer(value) with what it found. */
export function read(db, storeNames, work) {
  return run(db, storeNames, "readonly", work);
}

/** Reads one small saved value, such as a setting. */
export function getMeta(db, key) {
  return read(db, ["meta"], (tx, answer) => {
    tx.objectStore("meta").get(key).onsuccess = (event) => answer(event.target.result?.value);
  });
}

/** Saves one small value, such as a setting. */
export function setMeta(db, key, value) {
  return change(db, ["meta"], (tx) => {
    tx.objectStore("meta").put({ key, value });
  });
}
