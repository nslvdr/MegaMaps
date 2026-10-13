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
}

const CELL = 64, GAP = 22;

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

// The leader runs between the nearest edges of the label and its target.
export function leader(bounds: CalloutBounds, target: CalloutBounds) {
  const to = edge(target, center(bounds));
  const from = edge(bounds, to);
  // Attach away from the label's rounded corners.
  if (Math.abs(from.x - bounds.left) < 1e-6 || Math.abs(from.x - bounds.right) < 1e-6)
    from.y = Math.max(bounds.top + 12, Math.min(from.y, bounds.bottom - 12));
  else from.x = Math.max(bounds.left + 12, Math.min(from.x, bounds.right - 12));
  return { from, to };
}

// Boundary-only contact is allowed so a leader can end at its own target.
export function segmentCrossesBounds(from: Point, to: Point, rect: CalloutBounds) {
  // Most rectangles are nowhere near the segment.
  if (Math.max(from.x, to.x) < rect.left || Math.min(from.x, to.x) > rect.right ||
      Math.max(from.y, to.y) < rect.top || Math.min(from.y, to.y) > rect.bottom) return false;
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

// One layout per frame coordinates labels around all anchors.
export class CalloutLayout {
  // Pins, labels and leaders by 64px screen cell: a spot only needs what is
  // in the few cells it covers.
  private cells: CalloutBounds[][] = [];
  private lines: { from: Point; to: Point }[][] = [];
  private columns: number;
  private rows: number;

  constructor(private viewport: Size, obstacles: CalloutBounds[] = []) {
    this.columns = Math.max(1, Math.ceil(viewport.width / CELL));
    this.rows = Math.max(1, Math.ceil(viewport.height / CELL));
    for (const obstacle of obstacles) this.addObstacle(obstacle);
  }

  addObstacle(rect: CalloutBounds) {
    if (rect.right >= 0 && rect.bottom >= 0 &&
        rect.left <= this.viewport.width && rect.top <= this.viewport.height)
      this.index(this.cells, rect, rect);
  }

  private column(x: number) {
    return Math.max(0, Math.min(this.columns - 1, Math.floor(x / CELL)));
  }

  private row(y: number) {
    return Math.max(0, Math.min(this.rows - 1, Math.floor(y / CELL)));
  }

  private index<T>(grid: T[][], rect: CalloutBounds, item: T) {
    for (let row = this.row(rect.top); row <= this.row(rect.bottom); row++)
      for (let column = this.column(rect.left); column <= this.column(rect.right); column++)
        (grid[row * this.columns + column] ??= []).push(item);
  }

  private *near<T>(grid: T[][], rect: CalloutBounds) {
    for (let row = this.row(rect.top); row <= this.row(rect.bottom); row++)
      for (let column = this.column(rect.left); column <= this.column(rect.right); column++)
        yield* grid[row * this.columns + column] ?? [];
  }

  // Whether a pin or label overlaps, or a leader runs under, this rectangle.
  private blocked(rect: CalloutBounds) {
    for (const other of this.near(this.cells, rect)) if (boundsOverlap(rect, other)) return true;
    for (const line of this.near(this.lines, rect))
      if (segmentCrossesBounds(line.from, line.to, rect)) return true;
    return false;
  }

  // Whether a leader would run through a pin or label.
  private crossed(from: Point, to: Point) {
    const rect = { left: Math.min(from.x, to.x), right: Math.max(from.x, to.x),
      top: Math.min(from.y, to.y), bottom: Math.max(from.y, to.y) };
    for (const other of this.near(this.cells, rect))
      if (segmentCrossesBounds(from, to, other)) return true;
    return false;
  }

  // A label sits at its normal spot above its target and turns to another
  // side only when something is in the way. With every side taken, it has none.
  place(size: Size, target: CalloutBounds, anchor = center(target)): CalloutPlacement | undefined {
    if (size.width > this.viewport.width - 16 || size.height > this.viewport.height - 16)
      return undefined;
    for (const direction of directions) {
      const left = direction.x < 0 ? target.left - GAP - size.width
        : direction.x > 0 ? target.right + GAP : anchor.x - size.width / 2;
      const top = direction.y < 0 ? target.top - GAP - size.height
        : direction.y > 0 ? target.bottom + GAP : anchor.y - size.height / 2;
      const bounds = { left, right: left + size.width, top, bottom: top + size.height };
      if (this.blocked(expand(bounds, 5))) continue;
      const { from, to } = leader(bounds, target);
      if (this.crossed(from, to)) continue;
      this.index(this.cells, bounds, bounds);
      this.index(this.lines, { left: Math.min(from.x, to.x), right: Math.max(from.x, to.x),
        top: Math.min(from.y, to.y), bottom: Math.max(from.y, to.y) }, { from, to });
      return { bounds, from, to, direction: direction.name };
    }
  }
}
