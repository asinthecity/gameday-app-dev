// What the update notice says. No screen code, so it runs under `node --test`.

/**
 * @param updateReady true when a new version is on the phone, waiting for the coach.
 * @param gameInProgress must be exactly false to allow an update. Not knowing
 *   counts as a game being on, so a mistake can never update during a game.
 */
export function updateNotice({ updateReady, gameInProgress }) {
  if (!updateReady) {
    return { show: false, text: "", canUpdate: false };
  }
  if (gameInProgress !== false) {
    return { show: true, text: "New version ready. Update when the game is over", canUpdate: false };
  }
  return { show: true, text: "New version ready", canUpdate: true };
}
