/** Long edge of a stored place photo: sharp on a phone, a few hundred KB to share. */
const PHOTO_EDGE = 1600;

/**
 * Camera photos are re-encoded as upright JPEGs. Shrinking keeps storage and
 * shares small, and re-encoding drops EXIF, including the GPS position.
 */
export async function preparePhoto(file: Blob) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("This photo could not be read. Choose a JPEG, PNG, WebP or HEIC image.");
  });
  try {
    const scale = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  } finally {
    bitmap.close();
  }
}
