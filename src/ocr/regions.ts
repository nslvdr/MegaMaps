import type { Point } from "../viewer/camera";

export interface TextRegion {
  center: Point;
  width: number;
  height: number;
  angle: number;
  score: number;
}

// Rectangles use the label's long axis as X; its reading direction is resolved by OCR.
export function regionPoint(region: TextRegion, x: number, y: number) {
  const c = Math.cos(region.angle),
    s = Math.sin(region.angle);
  return {
    x: region.center.x + c * x - s * y,
    y: region.center.y + s * x + c * y,
  };
}
const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

// A monotone hull reduces a component's boundary to the edges that determine its box.
function convexHull(points: Point[]) {
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (ordered: Point[]) => {
    const hull: Point[] = [];
    for (const point of ordered) {
      while (
        hull.length >= 2 &&
        cross(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0
      )
        hull.pop();
      hull.push(point);
    }
    hull.pop();
    return hull;
  };
  return [...half(points), ...half([...points].reverse())];
}

// The minimum-area box follows diagonal/vertical text instead of the image axes.
function minimumRegion(
  points: Point[],
  score = 1,
): TextRegion | undefined {
  const hull = convexHull(points);
  if (hull.length < 3) return;
  let best: TextRegion | undefined;
  let area = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!,
      b = hull[(i + 1) % hull.length]!;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(angle),
      s = Math.sin(angle);
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const p of hull) {
      const x = c * p.x + s * p.y,
        y = -s * p.x + c * p.y;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const width = x1 - x0,
      height = y1 - y0;
    if (width * height >= area) continue;
    area = width * height;
    best = {
      center: {
        x: (c * (x0 + x1)) / 2 - (s * (y0 + y1)) / 2,
        y: (s * (x0 + x1)) / 2 + (c * (y0 + y1)) / 2,
      },
      width: Math.max(width, height),
      height: Math.min(width, height),
      angle: angle + (height > width ? Math.PI / 2 : 0),
      score,
    };
  }
  return best;
}

// Decode the DB detector's probability map without shipping an OpenCV runtime.
// Only boundary pixels survive each connected-component walk; buffers are reused.
export function probabilityRegions(
  data: Float32Array,
  width: number,
  height: number,
  // Lower than PaddleOCR's 0.3, so faint small print still forms a region.
  threshold = 0.2,
  minimumScore = 0.6,
) {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const regions: TextRegion[] = [];
  for (let seed = 0; seed < data.length; seed++) {
    if (visited[seed] || data[seed]! <= threshold) continue;
    let head = 0,
      tail = 1,
      sum = 0;
    queue[0] = seed;
    visited[seed] = 1;
    const boundary: Point[] = [];
    while (head < tail) {
      const index = queue[head++]!,
        x = index % width,
        y = (index - x) / width;
      sum += data[index]!;
      let edge = false;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0),
          ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          edge = true;
          continue;
        }
        const next = ny * width + nx;
        if (data[next]! <= threshold) edge = true;
        else if (!visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
      // Pixel corners, so a one-pixel-thin stroke still has an area.
      if (edge)
        boundary.push(
          { x, y },
          { x: x + 1, y },
          { x, y: y + 1 },
          { x: x + 1, y: y + 1 },
        );
    }
    const score = sum / tail;
    if (tail < 6 || score < minimumScore) continue;
    const region = minimumRegion(boundary, score);
    if (!region || region.height < 2) continue;
    // DB predicts shrunken text interiors. Expand by area/perimeter, as in its unclip step.
    const padding =
      (1.5 * region.width * region.height) /
      (2 * (region.width + region.height));
    region.width += padding * 2;
    region.height += padding * 2;
    regions.push(region);
  }
  return regions;
}
