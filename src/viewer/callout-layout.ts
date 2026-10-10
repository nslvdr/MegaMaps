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

const CELL = 64, DOT = 8;

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

// One layout per frame coordinates search and saved labels around all anchors.
export class CalloutLayout {
  private leaders: { from: Point; to: Point }[] = [];
  // Pins and labels by 64px screen cell: crowded labels try 480 spots each,
  // and a spot only needs what is in the few cells it covers.
  private cells: CalloutBounds[][] = [];
  private columns: number;
  private rows: number;
  // Pins never move once labels start, so a summed count of the 8px dots
  // they cover proves most crowded spots taken without walking any list.
  private pins: CalloutBounds[] = [];
  private dots?: Int32Array;

  constructor(private viewport: Size, obstacles: CalloutBounds[] = []) {
    this.columns = Math.max(1, Math.ceil(viewport.width / CELL));
    this.rows = Math.max(1, Math.ceil(viewport.height / CELL));
    for (const obstacle of obstacles) this.addObstacle(obstacle);
  }

  addObstacle(rect: CalloutBounds) {
    if (rect.right >= 0 && rect.bottom >= 0 &&
        rect.left <= this.viewport.width && rect.top <= this.viewport.height) {
      this.index(rect);
      this.pins.push(rect);
      this.dots = undefined;
    }
  }

  // dots[(row + 1) * (width + 1) + column + 1] counts the covered dots above
  // and left of that corner. A dot counts when a pin overlaps its inside.
  private countDots() {
    const width = Math.ceil(this.viewport.width / DOT), height = Math.ceil(this.viewport.height / DOT);
    const dots = new Int32Array((width + 1) * (height + 1));
    for (const pin of this.pins) {
      const left = Math.max(0, Math.floor(pin.left / DOT)), right = Math.min(width - 1, Math.ceil(pin.right / DOT) - 1);
      const top = Math.max(0, Math.floor(pin.top / DOT)), bottom = Math.min(height - 1, Math.ceil(pin.bottom / DOT) - 1);
      for (let row = top; row <= bottom; row++)
        for (let column = left; column <= right; column++)
          // Only dots whose inside the pin really reaches; zero-width pins on a dot's edge reach none.
          if (pin.left < (column + 1) * DOT && pin.right > column * DOT && pin.top < (row + 1) * DOT && pin.bottom > row * DOT)
            dots[(row + 1) * (width + 1) + column + 1] = 1;
    }
    for (let row = 1; row <= height; row++)
      for (let column = 1; column <= width; column++)
        dots[row * (width + 1) + column] = dots[row * (width + 1) + column]! + dots[(row - 1) * (width + 1) + column]! +
          dots[row * (width + 1) + column - 1]! - dots[(row - 1) * (width + 1) + column - 1]!;
    return dots;
  }

  // True only if a pin certainly overlaps: a covered dot lies wholly inside.
  private surelyBlocked(left: number, top: number, right: number, bottom: number) {
    const dots = this.dots ??= this.countDots(), width = Math.ceil(this.viewport.width / DOT) + 1;
    const first = Math.max(0, Math.ceil(left / DOT)), last = Math.min(width - 1, Math.floor(right / DOT));
    const firstRow = Math.max(0, Math.ceil(top / DOT)), lastRow = Math.min(dots.length / width - 1, Math.floor(bottom / DOT));
    if (first >= last || firstRow >= lastRow) return false;
    return dots[lastRow * width + last]! - dots[firstRow * width + last]! -
      dots[lastRow * width + first]! + dots[firstRow * width + first]! > 0;
  }

  private occupy(placement: CalloutPlacement) {
    this.leaders.push(placement);
    this.index(placement.bounds);
    return placement;
  }

  private column(x: number) {
    return Math.max(0, Math.min(this.columns - 1, Math.floor(x / CELL)));
  }

  private row(y: number) {
    return Math.max(0, Math.min(this.rows - 1, Math.floor(y / CELL)));
  }

  private index(rect: CalloutBounds) {
    for (let row = this.row(rect.top); row <= this.row(rect.bottom); row++)
      for (let column = this.column(rect.left); column <= this.column(rect.right); column++)
        (this.cells[row * this.columns + column] ??= []).push(rect);
  }

  // Whether a pin or label overlaps this on-screen rectangle.
  private blocked(left: number, top: number, right: number, bottom: number) {
    for (let row = this.row(top); row <= this.row(bottom); row++)
      for (let column = this.column(left); column <= this.column(right); column++)
        for (const rect of this.cells[row * this.columns + column] ?? [])
          if (left < rect.right && right > rect.left && top < rect.bottom && bottom > rect.top) return true;
    return false;
  }

  // Whether a leader would run through a pin or label.
  private crossed(from: Point, to: Point) {
    for (let row = this.row(Math.min(from.y, to.y)); row <= this.row(Math.max(from.y, to.y)); row++)
      for (let column = this.column(Math.min(from.x, to.x)); column <= this.column(Math.max(from.x, to.x)); column++)
        for (const rect of this.cells[row * this.columns + column] ?? [])
          if (segmentCrossesBounds(from, to, rect)) return true;
    return false;
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
    // Every candidate stays within this reach of the target, so only leaders
    // that pass through it can run under one.
    const clampX = (x: number) => Math.max(8, Math.min(x, this.viewport.width - size.width - 8));
    const clampY = (y: number) => Math.max(8, Math.min(y, this.viewport.height - size.height - 8));
    const reach = {
      left: Math.min(target.left, clampX(Math.min(target.left - 278 - size.width, anchor.x - size.width / 2 - 80))) - 5,
      right: Math.max(target.right, clampX(Math.max(target.right + 278, anchor.x - size.width / 2 + 80)) + size.width) + 5,
      top: Math.min(target.top, clampY(Math.min(target.top - 198 - size.height, anchor.y - size.height / 2 - 40))) - 5,
      bottom: Math.max(target.bottom, clampY(Math.max(target.bottom + 198, anchor.y - size.height / 2 + 40)) + size.height) + 5,
    };
    const near = (rect: CalloutBounds) => rect.left <= reach.right && rect.right >= reach.left &&
      rect.top <= reach.bottom && rect.bottom >= reach.top;
    const clear = expand(target, 22);
    const leaders = this.leaders.filter(({ from, to }) => near({
      left: Math.min(from.x, to.x), right: Math.max(from.x, to.x),
      top: Math.min(from.y, to.y), bottom: Math.max(from.y, to.y),
    }));
    // Further rings let dense clusters spread into nearby unused map space.
    for (let gap = 22; gap <= 198; gap += 16) {
      for (const direction of directions) {
        for (const shift of [0, -40, 40, -80, 80]) {
          const desiredX = direction.x < 0 ? target.left - gap - size.width
            : direction.x > 0 ? target.right + gap : anchor.x - size.width / 2;
          const desiredY = direction.y < 0 ? target.top - gap - size.height
            : direction.y > 0 ? target.bottom + gap : anchor.y - size.height / 2;
          const x = clampX(desiredX + (direction.y ? shift : 0));
          const y = clampY(desiredY + (direction.y ? 0 : shift / 2));
          const right = x + size.width, bottom = y + size.height;
          if ((x < clear.right && right > clear.left && y < clear.bottom && bottom > clear.top) ||
              this.surelyBlocked(x - 5, y - 5, right + 5, bottom + 5) ||
              this.blocked(x - 5, y - 5, right + 5, bottom + 5)) continue;
          const bounds = { left: x, right, top: y, bottom };
          const padded = expand(bounds, 5);
          if (leaders.some(line => segmentCrossesBounds(line.from, line.to, padded))) continue;
          const to = edge(target, center(bounds));
          const from = edge(bounds, to);
          // Attach away from the label's rounded corners.
          if (Math.abs(from.x - bounds.left) < 1e-6 || Math.abs(from.x - bounds.right) < 1e-6)
            from.y = Math.max(bounds.top + 12, Math.min(from.y, bounds.bottom - 12));
          else from.x = Math.max(bounds.left + 12, Math.min(from.x, bounds.right - 12));
          if (this.crossed(from, to)) continue;
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
