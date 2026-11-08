// Service worker: keeps the app's files on the phone so it opens with no signal,
// and makes sure a new version goes on only when the coach taps Update.
//
// Why there is a "marker": a browser switches to a waiting new worker by itself
// as soon as every page of the app is closed, and a force-quit counts as closed.
// So a new worker may be running before the coach has agreed to anything. The marker
// keeps that harmless. It records which version's FILES are in use, and only a
// tap on Update changes it. A new worker carries on serving the old files, and
// the old files are kept, until then.

importScripts("./config.js", "./version.js", "./sw-rules.js");

const STORAGE_NAME = self.GAMEDAY_CONFIG.storageName;
const VERSION = self.GAMEDAY_VERSION;
const RULES = self.GAMEDAY_SW_RULES;

// Every file the app needs. tests/app-files.test.mjs fails if one is missing.
const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./config.js",
  "./version.js",
  "./sw-rules.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-512.png",
  "./js/db.js",
  "./js/drag.js",
  "./js/game-rules.js",
  "./js/game-store.js",
  "./js/main.js",
  "./js/persistence.js",
  "./js/record-rules.js",
  "./js/share-file.js",
  "./js/sheet-rules.js",
  "./js/sheet-send.js",
  "./js/screens.js",
  "./js/squad-rules.js",
  "./js/squad-store.js",
  "./js/storage-rules.js",
  "./js/update-rules.js",
  "./js/updates.js",
];

// The folder this worker looks after. It comes from where this file is served,
// so the app can move to any address without a change here.
const SCOPE_PATH = new URL("./", self.location).pathname;
const MARKER_URL = "./version-in-use";

async function readVersionInUse() {
  const markers = await caches.open(RULES.markerCacheName(STORAGE_NAME));
  const saved = await markers.match(MARKER_URL);
  return saved ? saved.text() : null;
}

async function saveVersionInUse(version) {
  const markers = await caches.open(RULES.markerCacheName(STORAGE_NAME));
  await markers.put(MARKER_URL, new Response(version));
}

self.addEventListener("install", (event) => {
  // No skipWaiting here on purpose: see the note at the top.
  // cache: "reload" skips the browser's normal file cache. Without it a new
  // version could store old files, because the host lets browsers reuse files
  // for 10 minutes.
  event.waitUntil(
    caches
      .open(RULES.filesCacheName(STORAGE_NAME, VERSION))
      .then((cache) => cache.addAll(APP_FILES.map((file) => new Request(file, { cache: "reload" }))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // The very first install has nothing to wait for. After that, this does
      // nothing, and no cache is deleted here: the files in use must survive.
      if ((await readVersionInUse()) === null) {
        await saveVersionInUse(VERSION);
      }
      await self.clients.claim();
    })()
  );
});

// Runs only when the page asks, and the page asks only after a tap on Update.
async function switchToThisVersion() {
  await saveVersionInUse(VERSION);
  await self.skipWaiting(); // Does nothing if this worker is already the active one.
  const names = await caches.keys();
  const old = RULES.cachesToDelete(names, STORAGE_NAME, VERSION);
  await Promise.all(old.map((name) => caches.delete(name)));
}

self.addEventListener("message", (event) => {
  const reply = event.ports[0];
  if (!reply || !event.data) {
    return;
  }
  if (event.data.type === "which-version") {
    reply.postMessage(VERSION);
  }
  if (event.data.type === "switch-to-this-version") {
    event.waitUntil(
      switchToThisVersion().then(
        () => reply.postMessage("done"),
        () => reply.postMessage("failed")
      )
    );
  }
});

// Stored files keep the host's "reuse this for 10 minutes" label. If the page
// sees that label, the browser keeps its own in-memory copies across a reload
// and never asks this worker. After Update that left the old version running,
// or a mix of old and new files. "no-store" means every load asks here, so the
// marker alone decides which version runs. Nothing is lost offline: the files
// are still in this worker's cache.
async function withoutReuseLabel(stored) {
  const headers = new Headers(stored.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(await stored.blob(), { headers });
}

async function fromFilesInUse(request) {
  const version = (await readVersionInUse()) || VERSION;
  const cache = await caches.open(RULES.filesCacheName(STORAGE_NAME, version));
  const options = { ignoreSearch: true, ignoreVary: true };
  const cached = await cache.match(request, options);
  if (cached) {
    return withoutReuseLabel(cached);
  }
  if (request.mode === "navigate") {
    const page = await cache.match("./index.html", options);
    if (page) {
      return withoutReuseLabel(page);
    }
  }
  return fetch(request);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only this copy's own files. Anything else is left alone.
  const isOurs =
    event.request.method === "GET" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith(SCOPE_PATH);
  if (isOurs) {
    event.respondWith(fromFilesInUse(event.request));
  }
});
