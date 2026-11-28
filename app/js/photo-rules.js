// Player photos (GDA-52). Photos are kept on this phone only, in their own database store
// ("photos"), keyed by player id. They are never part of a player or game record, so the
// saved file and the export rows (built from those records) cannot contain one.

export const PHOTO_SIZE = 256; // Pixels on each side of the stored square.
export const PHOTO_QUALITY = 0.8; // JPEG quality: small (about 15 KB) and clear enough for a circle.
export const PHOTO_PROBLEM = "Couldn't save the photo";

/** The centre square of a picture of the given size: where to cut it. */
export function centreSquare(width, height) {
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}

/** True only for a small picture we made ourselves (a JPEG data address). */
export function isStoredPhoto(value) {
  return typeof value === "string" && value.startsWith("data:image/jpeg;base64,");
}

// ---- Move and zoom (GDA-119) ----
// The crop screen shows the photo behind a circle of `ring` pixels. Everything is measured from the
// circle's centre: (ox, oy) is where the photo's centre sits relative to it, and `zoom` runs from 1
// (the photo's shorter side just fits the circle) to MAX_ZOOM. Keeping the maths here, away from the
// screen, is what lets tests prove Save stores the part of the picture the circle showed.

export const MAX_ZOOM = 3;

/** How many screen pixels one photo pixel takes at zoom 1: the shorter side fits the circle. */
export function baseScale(width, height, ring) {
  return ring / Math.min(width, height);
}

/** Where the photo sits when the screen opens: centred, lowest zoom (same crop as centreSquare). */
export function startCrop() {
  return { zoom: 1, ox: 0, oy: 0 };
}

/** Holds the photo so it always covers the circle: no empty space can show inside it. */
export function clampOffset(ox, oy, width, height, ring, zoom) {
  const scale = baseScale(width, height, ring) * zoom;
  const maxX = Math.max(0, (width * scale - ring) / 2);
  const maxY = Math.max(0, (height * scale - ring) / 2);
  return { ox: Math.max(-maxX, Math.min(maxX, ox)) + 0, oy: Math.max(-maxY, Math.min(maxY, oy)) + 0 }; // + 0 turns -0 into 0
}

/** Changes the zoom about the circle's centre: the point under the centre stays under it. */
export function zoomAbout(crop, newZoom, width, height, ring) {
  const zoom = Math.max(1, Math.min(MAX_ZOOM, newZoom));
  const ratio = zoom / crop.zoom;
  return { zoom, ...clampOffset(crop.ox * ratio, crop.oy * ratio, width, height, ring, zoom) };
}

/** Moves the photo by a drag (dx, dy in screen pixels), held inside the limits. */
export function dragBy(crop, dx, dy, width, height, ring) {
  return { zoom: crop.zoom, ...clampOffset(crop.ox + dx, crop.oy + dy, width, height, ring, crop.zoom) };
}

/** The square of the original photo that lies inside the circle: what Save stores (x, y, side in photo pixels). */
export function cropSource(crop, width, height, ring) {
  const scale = baseScale(width, height, ring) * crop.zoom;
  const side = Math.min(Math.round(ring / scale), width, height);
  const x = Math.floor(width / 2 - crop.ox / scale - side / 2);
  const y = Math.floor(height / 2 - crop.oy / scale - side / 2);
  return { x: Math.max(0, Math.min(width - side, x)), y: Math.max(0, Math.min(height - side, y)), side };
}
