import { findText, normalizeText, searchOcr, type OcrIndex, type OcrMatch } from "../ocr/index";
import type { Point } from "./camera";
import type { MapMarker } from "./navigation";

/** A saved place, printed text, or a pair of them found together by a double search. */
export type MapSearchMatch = OcrMatch & { marker?: MapMarker; crossing?: Point; pins?: Point[] };

// Keep every location, including repeated names, and search saved places before OCR is ready.
// Two searches split by a semicolon keep only results that meet one another.
export function searchMap(index: OcrIndex | undefined, markers: MapMarker[], query: string): MapSearchMatch[] {
  const terms = crossingTerms(query);
  if (terms) return crossings(index, terms.map(term => searchMap(index, markers, term)) as [MapSearchMatch[], MapSearchMatch[]]);
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const places = markers.filter(marker =>
    findText(normalizeText(`${marker.label} ${marker.description}`), normalized).length,
  ).map(marker => ({ text: marker.label, polygons: [], marker }));
  return [...places, ...searchOcr(index, query)];
}

/** "Allée 25; Allée 55": the two alleys whose crossing is wanted. */
export function crossingTerms(query: string): [string, string] | undefined {
  const parts = query.split(";").map(normalizeText);
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : undefined;
}

// A word's shortest side is its letter height, whatever its angle.
const letterHeight = (polygon: Point[]) => Math.min(...polygon.map((a, i) => {
  const b = polygon[(i + 1) % polygon.length]!;
  return Math.hypot(b.x - a.x, b.y - a.y);
}));

const box = (match: MapSearchMatch) => {
  const points = match.marker ? [match.marker.point] : match.polygons.flat();
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
};
type Box = ReturnType<typeof box>;
const gapBetween = (a: Box, b: Box) => Math.hypot(
  Math.max(0, a.left - b.right, b.left - a.right),
  Math.max(0, a.top - b.bottom, b.top - a.bottom));

// Quarry maps name both galleries near a junction, so two results meet when
// they sit within ten letter heights of the map's usual text apart. Each
// result pairs with its nearest partner, and only pairs that choose each other
// count, so one label never makes two crossings.
const CROSSING_REACH = 10;
/** Letter height when the map's text is not known yet. */
const DEFAULT_LETTER = 20;
function crossings(index: OcrIndex | undefined, [firsts, seconds]: [MapSearchMatch[], MapSearchMatch[]]): MapSearchMatch[] {
  const heights = (index?.lines ?? []).flatMap(line => line.words.map(word => letterHeight(word.polygon))).sort((a, b) => a - b);
  const reach = CROSSING_REACH * (heights[Math.floor(heights.length / 2)] ?? DEFAULT_LETTER);
  const firstBoxes = firsts.map(box), secondBoxes = seconds.map(box);
  const nearest = (from: Box, to: Box[]) => {
    let best = -1, bestGap = Infinity;
    for (const [i, other] of to.entries()) {
      const gap = gapBetween(from, other);
      if (gap <= reach && gap < bestGap) [best, bestGap] = [i, gap];
    }
    return best;
  };
  return firsts.flatMap((first, i) => {
    const j = nearest(firstBoxes[i]!, secondBoxes);
    if (j < 0 || nearest(secondBoxes[j]!, firstBoxes) !== i) return [];
    const second = seconds[j]!, a = firstBoxes[i]!, b = secondBoxes[j]!;
    return [{
      text: first.text === second.text ? first.text : `${first.text} × ${second.text}`,
      polygons: [...first.polygons, ...second.polygons],
      crossing: { x: (a.left + a.right + b.left + b.right) / 4, y: (a.top + a.bottom + b.top + b.bottom) / 4 },
      pins: [first, second].flatMap(match => match.marker ? [match.marker.point] : []),
    }];
  });
}

/** Where a match is on the map, to bring into view. */
export const matchPoints = (match: MapSearchMatch) => match.marker ? [match.marker.point]
  : [...match.polygons.flat(), ...match.pins ?? [], ...match.crossing ? [match.crossing] : []];
