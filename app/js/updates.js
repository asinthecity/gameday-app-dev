// The page's half of controlled updates (the other half is in sw.js).
// The app looks for a new version when it opens and when it comes back to the
// front. A new version goes on only when the coach taps Update.

import { updateNotice } from "./update-rules.js";

const VERSION = self.GAMEDAY_VERSION;
const NO_REPLY_MS = 5000;

let registration = null;
let updateReady = false;
let gameInProgress = true; // Counts as "on" until checked.
let problem = "";
let tellScreen = () => {};

/**
 * THE PLACE FOR THE 'GAME IN PROGRESS' RULE.
 * No game can start yet. When GDA-24 adds kick-off, this must read the saved
 * game state from the database and answer true if a game is under way. It is
 * asked again at the moment of the tap, in case a game has just started.
 */
async function isGameInProgress() {
  return false;
}

/** Sends the worker a message and waits for its answer. */
function askWorker(worker, type) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error("No reply from the service worker")), NO_REPLY_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}

/** Is a newer version than the files in use on this phone? */
async function findUpdate() {
  if (!registration?.active) {
    return false; // The very first install has nothing to replace.
  }
  if (registration.waiting) {
    return true;
  }
  // A new worker may already be running with the old files still in use (see sw.js).
  const workerVersion = await askWorker(registration.active, "which-version").catch(() => VERSION);
  return workerVersion !== VERSION;
}

async function refresh() {
  updateReady = await findUpdate();
  gameInProgress = await isGameInProgress();
  tellScreen();
}

async function checkForUpdate() {
  try {
    await registration?.update();
  } catch {
    // No signal, most likely. The installed version simply carries on.
  }
  await refresh();
}

function watchInstalling(worker) {
  worker?.addEventListener("statechange", refresh);
}

/** Starts the service worker. The app works without it, so failures are not shown. */
export async function startUpdates(onChange) {
  tellScreen = onChange;
  if (!("serviceWorker" in navigator)) {
    return;
  }
  try {
    // "none" makes update checks skip the browser's file cache.
    registration = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
  } catch (error) {
    console.warn("Service worker could not start", error);
    registration = (await navigator.serviceWorker.getRegistration().catch(() => null)) ?? null;
    if (!registration) {
      return;
    }
  }
  registration.addEventListener("updatefound", () => watchInstalling(registration.installing));
  watchInstalling(registration.installing);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForUpdate();
    }
  });
  await checkForUpdate();
}

/** What the Home screen should show. */
export function currentUpdateNotice() {
  const notice = updateNotice({ updateReady, gameInProgress });
  return { ...notice, problem };
}

/** Runs only from a tap on Update. */
export async function applyUpdate() {
  problem = "";
  await refresh();
  const worker = registration?.waiting ?? registration?.active;
  if (!currentUpdateNotice().canUpdate || !worker) {
    return;
  }
  const answer = await askWorker(worker, "switch-to-this-version").catch(() => "failed");
  if (answer === "done") {
    window.location.reload();
    return;
  }
  problem = "Update did not finish. Please try again.";
  tellScreen();
}
