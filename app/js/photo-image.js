// Turns a picked or taken photo into a small centre-cropped square (browser only).
// Works on the phone, so a big new iPhone photo is stored small.

import { PHOTO_QUALITY, PHOTO_SIZE, centreSquare } from "./photo-rules.js";

/** Finishes with a JPEG data address, or throws if the file cannot be read as a picture. */
export async function shrinkPhoto(file) {
  // imageOrientation "from-image" makes an upright picture of a sideways-stored iPhone photo.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { x, y, side } = centreSquare(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    canvas.getContext("2d").drawImage(bitmap, x, y, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
  } finally {
    bitmap.close();
  }
}

// ---- Move and zoom (GDA-119): player photos only. Logos keep shrinkPhoto above. ----

/** Reads a picked file as an upright picture, or throws if it cannot be read as one. */
export function loadPhotoBitmap(file) {
  // "from-image" turns a sideways-stored iPhone photo upright, as shrinkPhoto does.
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

/** A copy of the picture to show on the crop screen: at most 2048 px, so a huge photo cannot overload a phone. */
export function previewCanvas(bitmap) {
  const shrink = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * shrink);
  canvas.height = Math.round(bitmap.height * shrink);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** The chosen square of the picture (x, y, side in its own pixels) as a small JPEG data address. */
export function cropPhoto(bitmap, { x, y, side }) {
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  canvas.getContext("2d").drawImage(bitmap, x, y, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
}
