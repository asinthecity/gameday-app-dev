// The one network call in the app (GDA-47): post one finished game to Ben's Apps Script
// web app and read its reply. Nothing is retried here. Sent only if Google says so.

import { readSheetReply, sheetBody } from "./sheet-rules.js";

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
      body: sheetBody(settings, game),
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
