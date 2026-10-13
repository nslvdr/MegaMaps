import type { Point } from "../viewer/camera";

export const OCR_VERSION = 2;
export interface OcrWord {
  text: string;
  polygon: Point[];
}
export interface OcrLine {
  text: string;
  confidence: number;
  words: OcrWord[];
}
export interface OcrIndex {
  mapId: string;
  version: number;
  completedAt: number;
  lines: OcrLine[];
}
export interface OcrMatch {
  text: string;
  polygons: Point[][];
}

// Fold case, accents and punctuation while retaining word boundaries.
export const normalizeText = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function needsOcr(index: OcrIndex | undefined) {
  return !index || index.version !== OCR_VERSION;
}

const digit = /\p{N}/u;
/** Where normalized text holds the needle. Words match from any part, but a
 * number only whole: "25" finds 25, never 125 or 250. */
export function findText(text: string, needle: string) {
  const offsets: number[] = [];
  let offset = text.indexOf(needle);
  while (offset !== -1) {
    const cutsNumber = (digit.test(needle[0]!) && digit.test(text[offset - 1] ?? "")) ||
      (digit.test(needle.at(-1)!) && digit.test(text[offset + needle.length] ?? ""));
    if (!cutsNumber) offsets.push(offset);
    offset = text.indexOf(needle, offset + (cutsNumber ? 1 : needle.length));
  }
  return offsets;
}

// Phrase matches highlight just the matching words, including partial-word
// queries, but carry the whole line so the callout reads in context.
export function searchOcr(
  index: OcrIndex | undefined,
  query: string,
): OcrMatch[] {
  const needle = normalizeText(query);
  if (!index || !needle) return [];
  const matches: OcrMatch[] = [];
  for (const line of index.lines) {
    let cursor = 0;
    const spans = line.words.map((word) => {
      const text = normalizeText(word.text);
      const start = cursor;
      cursor += text.length + 1;
      return { word, text, start, end: cursor - 1 };
    });
    const text = spans.map((span) => span.text).join(" ");
    const label = line.words.map((word) => word.text).join(" ");
    for (const offset of findText(text, needle)) {
      const words = spans.filter(
        (span) => span.start < offset + needle.length && span.end > offset,
      );
      if (words.length)
        matches.push({
          text: label,
          polygons: words.map(({ word }) => word.polygon),
        });
    }
  }
  // Overlapping crops and angle passes can see the same label more than once.
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = match.polygons
      .map((polygon) =>
        polygon.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(";"),
      )
      .join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The map label a point sits on, or just beside: a tap on printed text rarely
// lands inside a word's box. The nearest line wins where labels crowd.
export function ocrLabelAt(index: OcrIndex | undefined, point: Point) {
  let best: { text: string; distance: number } | undefined;
  for (const line of index?.lines ?? []) {
    const text = line.words.map((word) => word.text).join(" ").trim();
    if (!normalizeText(text) || text.length > 40) continue;
    for (const { polygon } of line.words) {
      const distance = distanceTo(polygon, point);
      if (distance > reach(polygon) || (best && best.distance <= distance)) continue;
      best = { text, distance };
    }
  }
  return best?.text;
}

const edges = (polygon: Point[]) =>
  polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length]!] as const);

// Half the word's height: about a letter's room around it.
const reach = (polygon: Point[]) =>
  Math.min(...edges(polygon).map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y))) / 2;

function distanceTo(polygon: Point[], p: Point) {
  let inside = false;
  let nearest = Infinity;
  for (const [a, b] of edges(polygon)) {
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y))
      inside = !inside;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return inside ? 0 : nearest;
}

function bounds(line: OcrLine) {
  const points = line.words.flatMap((word) => word.polygon);
  return {
    x0: Math.min(...points.map((p) => p.x)),
    y0: Math.min(...points.map((p) => p.y)),
    x1: Math.max(...points.map((p) => p.x)),
    y1: Math.max(...points.map((p) => p.y)),
  };
}

// Retain the strongest reading of a label seen in overlapping/rotated crops.
export function addOcrLine(lines: OcrLine[], candidate: OcrLine) {
  if (!candidate.words.length || !normalizeText(candidate.text)) return;
  const a = bounds(candidate);
  const duplicate = lines.findIndex((line) => {
    if (normalizeText(line.text) !== normalizeText(candidate.text))
      return false;
    const b = bounds(line);
    const intersection =
      Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
      Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    return (
      intersection /
        Math.max(
          1,
          Math.min(
            (a.x1 - a.x0) * (a.y1 - a.y0),
            (b.x1 - b.x0) * (b.y1 - b.y0),
          ),
        ) >
      0.5
    );
  });
  if (duplicate === -1) lines.push(candidate);
  else if (candidate.confidence > lines[duplicate]!.confidence)
    lines[duplicate] = candidate;
}
