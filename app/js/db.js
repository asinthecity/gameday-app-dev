// A small wrapper around the browser's database (IndexedDB).
//
// The rule for the whole app: every change is one all-or-nothing transaction,
// and the screen changes only after that transaction has finished. change()
// is what makes that easy to follow.

const DB_VERSION = 3;

/** Opens the database, creating it on first use. */
export function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
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
    };

    request.onsuccess = () => {
      const db = request.result;
      // A newer version of the app needs this database: let go so it can upgrade.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
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
