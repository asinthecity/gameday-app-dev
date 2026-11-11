// The one network call in the app (GDA-47): post one finished game to Ben's Apps Script
// web app and read its reply. Nothing is retried here. Sent only if Google says so.

import { checkBody, readCheckReply, readSheetReply, sheetBody, sheetTabOf } from "./sheet-rules.js";

const SEND_TIMEOUT_MS = 30000;

/** Gives { ok: true } or { ok: false, reason: "secret" | "failed" }. Never throws. */
export async function sendGameToSheet(settings, game, fetchFn = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    // text/plain keeps this a "simple" request, which is what the spike proved works.
    const response = await fetchFn(settings.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: sheetBody(settings, game, sheetTabOf(self.GAMEDAY_CONFIG)),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    let json = null;
    try {
      json = JSON.parse(await response.text());
    } catch (error) {
      json = null;
    }
    return readSheetReply(response.status, json);
  } catch (error) {
    return { ok: false, reason: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The connection check after Save (GDA-89): same call as a send, but the script writes no row.
 * Gives "connected" | "secret" | "offline" | "unreachable" | "tooOld". Never throws.
 */
export async function checkSheetConnection(settings, fetchFn = fetch, online = navigator.onLine) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetchFn(settings.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: checkBody(settings, sheetTabOf(self.GAMEDAY_CONFIG)),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    let json = null;
    try {
      json = JSON.parse(await response.text());
    } catch (error) {
      json = null;
    }
    return readCheckReply(response.status, json, online);
  } catch (error) {
    return readCheckReply(null, null, online);
  } finally {
    clearTimeout(timer);
  }
}
