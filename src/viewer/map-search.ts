import { normalizeText, searchOcr, type OcrIndex, type OcrMatch } from "../ocr/index";
import type { MapMarker } from "./navigation";

export type MapSearchMatch = OcrMatch & { marker?: MapMarker };

// Keep every location, including repeated names, and search saved places before OCR is ready.
export function searchMap(index: OcrIndex | undefined, markers: MapMarker[], query: string): MapSearchMatch[] {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const places = markers.filter(marker =>
    normalizeText(`${marker.label} ${marker.note}`).includes(normalized),
  ).map(marker => ({ text: marker.label, polygons: [], marker }));
  return [...places, ...searchOcr(index, query)];
}
