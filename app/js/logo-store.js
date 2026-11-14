// Saving and loading team logos (GDA-126). One record per team: { teamId, data }.
// Same idea as player photos (photo-store.js): kept apart from the team and game records on
// purpose, so the saved file and the Sheet rows (built from those records) cannot contain one.

import { change, read } from "./db.js";
import { isStoredPhoto } from "./photo-rules.js";

/** Every logo as { teamId: data }. */
export function loadLogos(db) {
  return read(db, ["logos"], (tx, answer) => {
    tx.objectStore("logos").getAll().onsuccess = (event) => {
      const byTeam = {};
      for (const row of event.target.result) {
        byTeam[row.teamId] = row.data;
      }
      answer(byTeam);
    };
  });
}

/** Adds or replaces a team's logo. Refuses anything that is not our own small JPEG. */
export function saveLogo(db, teamId, data) {
  if (!isStoredPhoto(data)) {
    return Promise.reject(new Error("Not a logo"));
  }
  return change(db, ["logos"], (tx) => {
    tx.objectStore("logos").put({ teamId, data });
  });
}

/** Removes a team's logo (the team goes back to its initials disc). */
export function removeLogo(db, teamId) {
  return change(db, ["logos"], (tx) => {
    tx.objectStore("logos").delete(teamId);
  });
}
