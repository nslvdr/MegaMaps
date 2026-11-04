import { tileKey, type MapRecord } from "../types";
import { payloadStore } from "../storage/payloads";
import { darkMode, measureTone } from "../viewer/appearance";

// Library previews by map id. A map's tiles never change, so returning home
// reuses them instead of reading storage and flashing placeholders again.
const urls = new Map<string, Promise<string>>();
// A map shown dark is previewed dark too, the way the viewer tones it, rather
// than as the brightest thing on a black screen.
const darkFilters = new Map<string, Promise<string>>();
/** The filter each preview was last shown with, so it keeps its look at once. */
export const shownFilters = new Map<string, string>();
/** Each preview once loaded, for what needs it at once, such as the delete dialog. */
export const loadedThumbnails = new Map<string, string>();

/** A map's preview: its smallest tile, as an object URL kept until the map goes. */
export function thumbnail(map: MapRecord) {
  let url = urls.get(map.id);
  if (!url) {
    url = payloadStore(map.backend).get(map.id, tileKey(map.levels.length - 1, 0, 0)).then((blob) => {
      const loaded = URL.createObjectURL(blob);
      loadedThumbnails.set(map.id, loaded);
      return loaded;
    });
    // A failed read is tried again next time.
    url.catch(() => urls.delete(map.id));
    urls.set(map.id, url);
  }
  return url;
}

export function darkFilter(id: string, url: string) {
  let filter = darkFilters.get(id);
  if (!filter) {
    filter = fetch(url)
      .then((response) => response.blob())
      .then(createImageBitmap)
      .then((bitmap) => {
        const tone = measureTone(bitmap);
        bitmap.close();
        return darkMode(tone).filter;
      })
      .catch(() => "");
    darkFilters.set(id, filter);
  }
  return filter;
}

/** Lets a map's preview go, once the map is gone or its tiles are recut. */
export function forgetThumbnail(id: string, all = true) {
  const url = loadedThumbnails.get(id);
  if (url) URL.revokeObjectURL(url);
  loadedThumbnails.delete(id);
  urls.delete(id);
  if (!all) return;
  darkFilters.delete(id);
  shownFilters.delete(id);
}
