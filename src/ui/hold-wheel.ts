import type { Point } from "../viewer/camera";

/** Lifting within this many pixels of where the press began chooses nothing. */
const CENTER = 30;
export type WheelChoice = "place" | "back" | "trail";

/** Three equal thirds: up-left adds a place, up-right goes back to the last
 * mark, down marks the trail. Up-left and up-right meet straight up. */
export function wheelChoice(start: Point, at: Point): WheelChoice | undefined {
  if (Math.hypot(at.x - start.x, at.y - start.y) < CENTER) return undefined;
  // Degrees anticlockwise from straight right, with up at 90.
  const angle = (Math.atan2(start.y - at.y, at.x - start.x) * 180 / Math.PI + 360) % 360;
  return angle >= 90 && angle < 210 ? "place" : angle >= 210 && angle < 330 ? "trail" : "back";
}
