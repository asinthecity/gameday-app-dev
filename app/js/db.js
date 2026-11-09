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

function run(db, storeNames, mode, work) {
  return new Promise((resolve, reject) => {
    // "strict" asks the browser to reach the disk before saying it has finished.
    const tx = db.transaction(storeNames, mode, { durability: "strict" });
    let answer;
    // Resolves on "complete", never earlier: until then nothing is safely saved.
    tx.oncomplete = () => resolve(answer);
    tx.onabort = () => reject(tx.error ?? new Error("Save was cancelled"));
    tx.onerror = () => reject(tx.error);
    try {
      work(tx, (value) => {
        answer = value;
      });
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
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
