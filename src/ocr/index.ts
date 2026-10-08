import type { Point } from "../viewer/camera";

export const OCR_VERSION = 1;
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

// Phrase matches reveal just the matching words, including partial-word queries.
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
    let offset = text.indexOf(needle);
    while (offset !== -1) {
      const words = spans.filter(
        (span) => span.start < offset + needle.length && span.end > offset,
      );
      if (words.length)
        matches.push({
          text: words.map(({ word }) => word.text).join(" "),
          polygons: words.map(({ word }) => word.polygon),
        });
      offset = text.indexOf(needle, offset + needle.length);
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
