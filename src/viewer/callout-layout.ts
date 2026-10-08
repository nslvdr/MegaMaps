import type { Point, Size } from "./camera";

export interface CalloutBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const directions = [
  { name: "above", x: 0, y: -1 },
  { name: "below", x: 0, y: 1 },
  { name: "right", x: 1, y: 0 },
  { name: "left", x: -1, y: 0 },
  { name: "upper-right", x: 1, y: -1 },
  { name: "upper-left", x: -1, y: -1 },
  { name: "lower-right", x: 1, y: 1 },
  { name: "lower-left", x: -1, y: 1 },
] as const;

export interface CalloutPlacement {
  bounds: CalloutBounds;
  from: Point;
  to: Point;
  direction: (typeof directions)[number]["name"];
  gap: number;
  shift: number;
}

const center = (rect: CalloutBounds) => ({
  x: (rect.left + rect.right) / 2,
  y: (rect.top + rect.bottom) / 2,
});
const expand = (rect: CalloutBounds, padding: number) => ({
  left: rect.left - padding, right: rect.right + padding,
  top: rect.top - padding, bottom: rect.bottom + padding,
});
export const boundsOverlap = (a: CalloutBounds, b: CalloutBounds) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// Intersect the center-to-target ray with the rectangle's boundary.
const edge = (rect: CalloutBounds, toward: Point) => {
  const origin = center(rect);
  const dx = toward.x - origin.x, dy = toward.y - origin.y;
  const scale = Math.min(
    dx ? (rect.right - rect.left) / 2 / Math.abs(dx) : Infinity,
    dy ? (rect.bottom - rect.top) / 2 / Math.abs(dy) : Infinity,
  );
  return Number.isFinite(scale)
    ? { x: origin.x + dx * scale, y: origin.y + dy * scale }
    : origin;
};

// Boundary-only contact is allowed so a leader can end at its own target.
export function segmentCrossesBounds(from: Point, to: Point, rect: CalloutBounds) {
  let near = 0, far = 1;
  for (const [start, delta, min, max] of [
    [from.x, to.x - from.x, rect.left, rect.right],
    [from.y, to.y - from.y, rect.top, rect.bottom],
  ] as const) {
    if (!delta) {
      if (start <= min || start >= max) return false;
      continue;
    }
    const a = (min - start) / delta, b = (max - start) / delta;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near >= far) return false;
  }
  return near < 1 - 1e-6 && far > 1e-6;
}

// One layout per frame coordinates search and saved labels around all anchors.
export class CalloutLayout {
  private obstacles: CalloutBounds[] = [];
  private labels: CalloutBounds[] = [];
  private leaders: { from: Point; to: Point }[] = [];

  constructor(private viewport: Size, obstacles: CalloutBounds[] = []) {
    for (const obstacle of obstacles) this.addObstacle(obstacle);
  }

  addObstacle(rect: CalloutBounds) {
    if (rect.right >= 0 && rect.bottom >= 0 &&
        rect.left <= this.viewport.width && rect.top <= this.viewport.height)
      this.obstacles.push(rect);
  }

  private occupy(placement: CalloutPlacement) {
    this.labels.push(placement.bounds);
    this.leaders.push(placement);
    return placement;
  }

  // Prefer nearby free positions, retaining the previous direction when possible.
  place(size: Size, target: CalloutBounds, anchor = center(target), previous?: CalloutPlacement) {
    if (size.width > this.viewport.width - 16 || size.height > this.viewport.height - 16)
      return undefined;
    let best: { placement: CalloutPlacement; score: number } | undefined;
    const minimumDistance = 22 + Math.min(
      (size.width + target.right - target.left) / 2,
      (size.height + target.bottom - target.top) / 2,
    );
    // Further rings let dense clusters spread into nearby unused map space.
    for (let gap = 22; gap <= 198; gap += 16) {
      for (const direction of directions) {
        for (const shift of [0, -40, 40, -80, 80]) {
          const desiredX = direction.x < 0 ? target.left - gap - size.width
            : direction.x > 0 ? target.right + gap : anchor.x - size.width / 2;
          const desiredY = direction.y < 0 ? target.top - gap - size.height
            : direction.y > 0 ? target.bottom + gap : anchor.y - size.height / 2;
          const x = Math.max(8, Math.min(desiredX + (direction.y ? shift : 0), this.viewport.width - size.width - 8));
          const y = Math.max(8, Math.min(desiredY + (direction.y ? 0 : shift / 2), this.viewport.height - size.height - 8));
          const bounds = { left: x, right: x + size.width, top: y, bottom: y + size.height };
          const padded = expand(bounds, 5);
          if (boundsOverlap(bounds, expand(target, 22)) ||
              this.obstacles.some(rect => boundsOverlap(padded, rect)) ||
              this.labels.some(rect => boundsOverlap(padded, rect)) ||
              this.leaders.some(line => segmentCrossesBounds(line.from, line.to, padded))) continue;
          const to = edge(target, center(bounds));
          const from = edge(bounds, to);
          // Attach away from the label's rounded corners.
          if (Math.abs(from.x - bounds.left) < 1e-6 || Math.abs(from.x - bounds.right) < 1e-6)
            from.y = Math.max(bounds.top + 12, Math.min(from.y, bounds.bottom - 12));
          else from.x = Math.max(bounds.left + 12, Math.min(from.x, bounds.right - 12));
          if (this.obstacles.some(rect => segmentCrossesBounds(from, to, rect)) ||
              this.labels.some(rect => segmentCrossesBounds(from, to, rect))) continue;
          const sideX = bounds.left >= target.right ? 1 : bounds.right <= target.left ? -1 : 0;
          const sideY = bounds.top >= target.bottom ? 1 : bounds.bottom <= target.top ? -1 : 0;
          const actualDirection = directions.find(candidate => candidate.x === sideX && candidate.y === sideY)!.name;
          const score = Math.hypot(center(bounds).x - anchor.x, center(bounds).y - anchor.y)
            + (previous && previous.direction !== actualDirection ? 20 : 0)
            + (previous && previous.gap !== gap ? 4 : 0)
            + (previous && previous.shift !== shift ? 3 : 0);
          if (!best || score < best.score)
            best = { score, placement: { bounds, from, to, direction: actualDirection, gap, shift } };
          // Most labels fit immediately; avoid scanning the other candidates then.
          if (best.score <= minimumDistance + 1e-6) return this.occupy(best.placement);
        }
      }
    }
    if (!best) return undefined;
    return this.occupy(best.placement);
  }
}
