// Asks the phone to keep our data rather than clear it when space runs short.
// It answered yes on the test iPhone (spike W2). That is a strong request, not a
// guarantee, and the app works either way, so nothing here ever stops the app.

import { getMeta, setMeta } from "./db.js";
import { shouldAskToKeepData } from "./storage-rules.js";

/** True when running from the Home Screen icon. Looks at how the app is running, never at the browser ID text. */
function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export async function askToKeepDataOnce(db) {
  try {
    const supported = typeof navigator.storage?.persist === "function";
    const alreadyAsked = (await getMeta(db, "keepDataAnswer")) !== undefined;
    if (!shouldAskToKeepData({ installed: isInstalled(), supported, alreadyAsked })) {
      return;
    }
    const granted = await navigator.storage.persist();
    // Kept for Settings to show later (technical outline, check 3).
    await setMeta(db, "keepDataAnswer", { granted, askedAt: new Date().toISOString() });
  } catch (error) {
    // Nothing is recorded, so it is asked again on the next open.
    console.warn("Could not ask to keep data", error);
  }
}
