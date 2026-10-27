import type { Point } from "./camera";

/** Where the user said they were, and when. The trail is the trip under way: it
 * starts with its first point and ends when the user ends it. */
export interface TrailPoint extends Point {
  time: number;
  /** What the map showed as it was marked, so the user can come back to it. */
  view?: { center: Point; scale: number };
}
/** The last point pulses briskly when drawn, slower once aging, then rests dimmed: an old position is a guess. */
const FRESH_MS = 15 * 60 * 1000;
const AGING_MS = 60 * 60 * 1000;
export type TrailAge = "fresh" | "aging" | "old";

export const trailAge = (time: number, now: number): TrailAge =>
  now - time < FRESH_MS ? "fresh" : now - time < AGING_MS ? "aging" : "old";

/** Milliseconds until a point marked at `time` looks older, if it ever will. */
export function trailAgeChange(time: number, now: number) {
  const age = now - time;
  return age < FRESH_MS ? FRESH_MS - age : age < AGING_MS ? AGING_MS - age : undefined;
}

/** Saved trails come from this app's own storage or a backup file; drop anything malformed. */
const finite = (value: unknown, keys: string[]) =>
  typeof value === "object" && value !== null &&
  keys.every((key) => Number.isFinite((value as Record<string, unknown>)[key]));
export const isTrailPoint = (value: unknown): value is TrailPoint => {
  if (!finite(value, ["x", "y", "time"])) return false;
  const { view } = value as { view?: { center?: unknown } };
  return view === undefined || (finite(view, ["scale"]) && finite(view.center, ["x", "y"]));
};

/** A finished trip, kept to look back on: every point marked, and when it ended. */
export interface Trip {
  id: string;
  points: TrailPoint[];
  ended: number;
}
export const isTrip = (value: unknown): value is Trip => {
  if (typeof value !== "object" || value === null) return false;
  const { id, points, ended } = value as Record<string, unknown>;
  return typeof id === "string" && Number.isFinite(ended) &&
    Array.isArray(points) && points.length > 1 && points.every(isTrailPoint);
};
