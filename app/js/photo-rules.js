// Player photos (GDA-52). Photos are kept on this phone only, in their own database store
// ("photos"), keyed by player id. They are never part of a player or game record, so the
// saved file and the Sheet rows (built from those records) cannot contain one.

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
