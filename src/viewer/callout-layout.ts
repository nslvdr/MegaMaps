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
type Line = { from: Point; to: Point };

const span = (from: Point, to: Point) => ({
  left: Math.min(from.x, to.x), right: Math.max(from.x, to.x),
  top: Math.min(from.y, to.y), bottom: Math.max(from.y, to.y),
});

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

// One layout per frame coordinates labels around all anchors, on screen or
// not: a pan moves them all together, so it never changes where one goes.
export class CalloutLayout {
  // Pins, labels and leaders by 64px screen cell: a spot only needs what is
  // in the few cells it covers.
  private cells = new Map<number, CalloutBounds[]>();
  private lines = new Map<number, Line[]>();
  /** What the layout weighed, for the debug overlay; collected only when set. */
  trace?: { pins: CalloutBounds[]; taken: CalloutBounds[]; lines: Line[]; refused: CalloutBounds[] };

  constructor(private viewport: Size, obstacles: CalloutBounds[] = []) {
    for (const obstacle of obstacles) this.addObstacle(obstacle);
  }

  addObstacle(rect: CalloutBounds) {
    this.trace?.pins.push(rect);
    this.index(this.cells, rect, rect);
  }

  private *keys(rect: CalloutBounds) {
    for (let row = Math.floor(rect.top / CELL); row <= Math.floor(rect.bottom / CELL); row++)
      for (let column = Math.floor(rect.left / CELL); column <= Math.floor(rect.right / CELL); column++)
        yield row * 2 ** 20 + column;
  }

  private index<T>(grid: Map<number, T[]>, rect: CalloutBounds, item: T) {
    for (const key of this.keys(rect)) {
      const cell = grid.get(key);
      if (cell) cell.push(item);
      else grid.set(key, [item]);
    }
  }

  private *near<T>(grid: Map<number, T[]>, rect: CalloutBounds) {
    for (const key of this.keys(rect)) yield* grid.get(key) ?? [];
  }

  // Whether a pin or label overlaps, or a leader runs under, this rectangle.
  private blocked(rect: CalloutBounds, own: CalloutBounds[] = []) {
    for (const other of this.near(this.cells, rect))
      if (!own.includes(other) && boundsOverlap(rect, other)) return true;
    for (const line of this.near(this.lines, rect))
      if (segmentCrossesBounds(line.from, line.to, rect)) return true;
    return false;
  }

  // Whether a leader or tail would run through a pin or label, other than its own.
  private crossed(from: Point, to: Point, own: CalloutBounds[] = []) {
    for (const other of this.near(this.cells, span(from, to)))
      if (!own.includes(other) && segmentCrossesBounds(from, to, other)) return true;
    return false;
  }

  // A balloon takes its body, and its tail's line from its place to the body,
  // when they are free: a line, not a box, so a diagonal tail passes close to
  // pins beside it. It may cover its own symbols. Returns whether it took them.
  claim(body: CalloutBounds, tail: Line, own: CalloutBounds[] = []) {
    const free = !this.blocked(expand(body, 1), own) && !this.crossed(tail.from, tail.to, own);
    if (free) this.hold(body, tail);
    else this.trace?.refused.push(body);
    return free;
  }

  // Keeps a balloon's spot taken, such as while it shrinks out of it.
  hold(body: CalloutBounds, tail: Line) {
    this.trace?.taken.push(body);
    this.trace?.lines.push(tail);
    this.index(this.cells, body, body);
    this.index(this.lines, span(tail.from, tail.to), tail);
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
      const { from, to } = leader(bounds, target);
      if (this.blocked(expand(bounds, 5)) || this.crossed(from, to)) {
        this.trace?.refused.push(bounds);
        continue;
      }
      this.trace?.taken.push(bounds);
      this.trace?.lines.push({ from, to });
      this.index(this.cells, bounds, bounds);
      this.index(this.lines, span(from, to), { from, to });
      return { bounds, from, to, direction: direction.name };
    }
  }
}
