// Saving and loading player photos (GDA-52). One record per player: { playerId, data }.
// Kept apart from the players store on purpose (see photo-rules.js). A photo save is its
// own transaction, so a failure changes nothing else.

import { change, read } from "./db.js";
import { isStoredPhoto } from "./photo-rules.js";

/** Every photo as { playerId: data }. */
export function loadPhotos(db) {
  return read(db, ["photos"], (tx, answer) => {
    tx.objectStore("photos").getAll().onsuccess = (event) => {
      const byPlayer = {};
      for (const row of event.target.result) {
        byPlayer[row.playerId] = row.data;
      }
      answer(byPlayer);
    };
  });
}

/** Adds or replaces a player's photo. Refuses anything that is not our own small JPEG. */
export function savePhoto(db, playerId, data) {
  if (!isStoredPhoto(data)) {
    return Promise.reject(new Error("Not a photo"));
  }
  return change(db, ["photos"], (tx) => {
    tx.objectStore("photos").put({ playerId, data });
  });
}

/** Removes a player's photo (they go back to initials). */
export function removePhoto(db, playerId) {
  return change(db, ["photos"], (tx) => {
    tx.objectStore("photos").delete(playerId);
  });
}
