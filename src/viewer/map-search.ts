import { normalizeText, searchOcr, type OcrIndex, type OcrMatch } from "../ocr/index";
import type { Point } from "./camera";
import type { MapMarker } from "./navigation";

/** A saved place, printed text, or where two searched alleys cross. */
export type MapSearchMatch = OcrMatch & { marker?: MapMarker; crossing?: Point };

// Keep every location, including repeated names, and search saved places before OCR is ready.
// Two alleys split by a semicolon look for their crossing instead.
export function searchMap(index: OcrIndex | undefined, markers: MapMarker[], query: string): MapSearchMatch[] {
  const terms = crossingTerms(query);
  if (terms) {
    const crossing = findCrossing(index, terms);
    return crossing ? [crossing] : [];
  }
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const places = markers.filter(marker =>
    normalizeText(`${marker.label} ${marker.description}`).includes(normalized),
  ).map(marker => ({ text: marker.label, polygons: [], marker }));
  return [...places, ...searchOcr(index, query)];
}

/** "Allée 25; Allée 55": the two alleys whose crossing is wanted. */
export function crossingTerms(query: string): [string, string] | undefined {
  const parts = query.split(";").map(normalizeText);
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : undefined;
}

const box = (match: OcrMatch) => {
  const points = match.polygons.flat(), xs = points.map(p => p.x), ys = points.map(p => p.y);
  // A word's shortest side is its letter height, whatever its angle.
  const height = Math.max(...match.polygons.map(polygon =>
    Math.min(...polygon.map((a, i) => {
      const b = polygon[(i + 1) % polygon.length]!;
      return Math.hypot(b.x - a.x, b.y - a.y);
    }))));
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), height };
};

// Quarry maps name both galleries at a junction, so the crossing is where
// their labels meet: the closest pair within a few letter heights of each other.
const CROSSING_REACH = 4;
function findCrossing(index: OcrIndex | undefined, terms: [string, string]): MapSearchMatch | undefined {
  const [firsts, seconds] = terms.map(term => searchOcr(index, term, true).map(match => ({ match, box: box(match) })));
  let best: { gap: number; first: OcrMatch; second: OcrMatch; point: Point } | undefined;
  for (const a of firsts!) for (const b of seconds!) {
    const gap = Math.hypot(
      Math.max(0, a.box.left - b.box.right, b.box.left - a.box.right),
      Math.max(0, a.box.top - b.box.bottom, b.box.top - a.box.bottom));
    if (gap > CROSSING_REACH * Math.max(a.box.height, b.box.height) || (best && best.gap <= gap)) continue;
    best = { gap, first: a.match, second: b.match, point: {
      x: (a.box.left + a.box.right + b.box.left + b.box.right) / 4,
      y: (a.box.top + a.box.bottom + b.box.top + b.box.bottom) / 4,
    } };
  }
  if (!best) return undefined;
  const { first, second, point } = best;
  return {
    text: first.text === second.text ? first.text : `${first.text} × ${second.text}`,
    polygons: [...first.polygons, ...second.polygons],
    crossing: point,
  };
}

/** Where a match is on the map, to bring into view. */
export const matchPoints = (match: MapSearchMatch) =>
  match.marker ? [match.marker.point] : [...match.polygons.flat(), ...match.crossing ? [match.crossing] : []];
