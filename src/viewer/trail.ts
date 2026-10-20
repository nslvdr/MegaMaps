import type { Point } from "./camera";

/** Where the user said they were, and when. */
export interface TrailPoint extends Point {
  time: number;
}
/** A gap this long between two points starts a new trail: another trip. */
export const TRAIL_GAP_MS = 6 * 60 * 60 * 1000;
/** The last point pulses for a while, then slower, then rests: an old position is a guess. */
const FRESH_MS = 15 * 60 * 1000;
const AGING_MS = 60 * 60 * 1000;
export type TrailAge = "fresh" | "aging" | "old";

/** The points as separate trips, each drawn as its own line. */
export function trailSegments(trail: readonly TrailPoint[]) {
  const segments: TrailPoint[][] = [];
  for (const [i, point] of trail.entries()) {
    if (!i || point.time - trail[i - 1]!.time >= TRAIL_GAP_MS) segments.push([]);
    segments.at(-1)!.push(point);
  }
  return segments;
}

export const trailAge = (time: number, now: number): TrailAge =>
  now - time < FRESH_MS ? "fresh" : now - time < AGING_MS ? "aging" : "old";

/** Milliseconds until a point marked at `time` looks older, if it ever will. */
export function trailAgeChange(time: number, now: number) {
  const age = now - time;
  return age < FRESH_MS ? FRESH_MS - age : age < AGING_MS ? AGING_MS - age : undefined;
}

/** Saved trails come from this app's own storage or a backup file; drop anything malformed. */
export const isTrailPoint = (value: unknown): value is TrailPoint =>
  typeof value === "object" && value !== null &&
  ["x", "y", "time"].every((key) => Number.isFinite((value as Record<string, unknown>)[key]));
