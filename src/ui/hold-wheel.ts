import type { Point } from "../viewer/camera";

/** Lifting within this many pixels of where the press began chooses nothing. */
const CENTER = 30;
export type WheelChoice = "place" | "trail";

/** The top half of the wheel adds a place, the bottom half a trail point; they meet at the sides. */
export function wheelChoice(start: Point, at: Point): WheelChoice | undefined {
  if (Math.hypot(at.x - start.x, at.y - start.y) < CENTER) return undefined;
  return at.y < start.y ? "place" : "trail";
}
