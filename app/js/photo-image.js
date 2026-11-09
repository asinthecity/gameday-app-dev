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
