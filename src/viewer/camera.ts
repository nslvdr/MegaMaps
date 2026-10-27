import { TILE_SIZE, type Level } from "../types";
export interface Point {
  x: number;
  y: number;
}
export interface Camera {
  x: number;
  y: number;
  scale: number;
  rotation?: number;
}
export interface Size {
  width: number;
  height: number;
}
const trig = (angle: number) => ({
  c: Math.abs(Math.cos(angle)) < 1e-12 ? 0 : Math.cos(angle),
  s: Math.abs(Math.sin(angle)) < 1e-12 ? 0 : Math.sin(angle),
});
export function worldToScreen(camera: Camera, point: Point): Point {
  const { c, s } = trig(camera.rotation ?? 0);
  return {
    x: camera.x + camera.scale * (c * point.x - s * point.y),
    y: camera.y + camera.scale * (s * point.x + c * point.y),
  };
}
export function screenToWorld(camera: Camera, point: Point): Point {
  const { c, s } = trig(camera.rotation ?? 0),
    x = (point.x - camera.x) / camera.scale,
    y = (point.y - camera.y) / camera.scale;
  return { x: c * x + s * y, y: -s * x + c * y };
}
export function cameraAt(
  center: Point,
  viewport: Size,
  scale: number,
  rotation = 0,
): Camera {
  const p = worldToScreen({ x: 0, y: 0, scale, rotation }, center);
  return {
    x: viewport.width / 2 - p.x,
    y: viewport.height / 2 - p.y,
    scale,
    ...(rotation ? { rotation } : {}),
  };
}
export function fitCamera(image: Size, viewport: Size, rotation = 0): Camera {
  const { c, s } = trig(rotation);
  const width = Math.abs(c) * image.width + Math.abs(s) * image.height,
    height = Math.abs(s) * image.width + Math.abs(c) * image.height;
  return cameraAt(
    { x: image.width / 2, y: image.height / 2 },
    viewport,
    Math.min(viewport.width / width, viewport.height / height),
    rotation,
  );
}
export function transformAt(
  camera: Camera,
  scale: number,
  rotation: number,
  anchor: Point,
): Camera {
  const world = screenToWorld(camera, anchor),
    p = worldToScreen({ x: 0, y: 0, scale, rotation }, world);
  return { ...camera, x: anchor.x - p.x, y: anchor.y - p.y, scale, rotation };
}
export function zoomAt(
  camera: Camera,
  scale: number,
  x: number,
  y: number,
): Camera {
  const ratio = scale / camera.scale;
  return {
    ...camera,
    scale,
    x: x - (x - camera.x) * ratio,
    y: y - (y - camera.y) * ratio,
  };
}
/** Let every map edge reach the screen center while keeping the map in reach. */
export function constrain(camera: Camera, image: Size, viewport: Size): Camera {
  const corners = [
    { x: 0, y: 0 },
    { x: image.width, y: 0 },
    { x: 0, y: image.height },
    { x: image.width, y: image.height },
  ].map((p) => worldToScreen({ ...camera, x: 0, y: 0 }, p));
  const minX = Math.min(...corners.map((p) => p.x)),
    maxX = Math.max(...corners.map((p) => p.x)),
    minY = Math.min(...corners.map((p) => p.y)),
    maxY = Math.max(...corners.map((p) => p.y));
  const axis = (p: number, min: number, max: number, size: number) =>
    Math.max(size / 2 - max, Math.min(size / 2 - min, p));
  return {
    ...camera,
    x: axis(camera.x, minX, maxX, viewport.width) || 0,
    y: axis(camera.y, minY, maxY, viewport.height) || 0,
  };
}
export function chooseLevel(levels: Level[], scale: number, dpr: number) {
  return Math.min(
    levels.length - 1,
    Math.max(0, Math.floor(Math.log2(1 / (scale * dpr)))),
  );
}
/** The sharpest level whose tiles fit the decode budget wherever the screen is
 * panned. Counting only the tiles shown now would switch levels mid-pan, as
 * rows and columns of the grid slide in and out, and the map would flicker
 * between sharp and coarse tiles. */
export function tileLevel(levels: Level[], camera: Camera, viewport: Size, dpr: number, most: number) {
  let level = chooseLevel(levels, camera.scale, dpr);
  while (level < levels.length - 1 && mostTiles(levels[level]!, camera, viewport) > most)
    level++;
  return level;
}
/** The most tiles of a level the screen can touch at this zoom and turn. The
 * grid is slid under the screen by steps of a fraction of a tile, and the
 * screen grows by one step on each side so the positions between are covered.
 * A map smaller than the screen counts only the tiles it has. */
function mostTiles(level: Level, camera: Camera, viewport: Size, steps = 8) {
  const extent = TILE_SIZE * level.scale,
    step = (extent * camera.scale) / steps;
  const { c, s } = trig(camera.rotation ?? 0);
  const grown = { width: viewport.width + 2 * step, height: viewport.height + 2 * step };
  let most = 0;
  for (let u = 0; u < steps; u++)
    for (let v = 0; v < steps; v++) {
      const slid = { ...camera, x: step * (1 + u * c - v * s), y: step * (1 + u * s + v * c) };
      const bounds = viewBounds(slid, grown);
      const left = Math.floor(bounds.left / extent), right = Math.floor(bounds.right / extent),
        top = Math.floor(bounds.top / extent), bottom = Math.floor(bounds.bottom / extent);
      const touched: Point[] = [];
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++)
          if (onScreen(slid, grown, { x: x * extent, y: y * extent, width: extent, height: extent }))
            touched.push({ x, y });
      // Slide the map's own grid over the touched tiles.
      for (let x0 = left; x0 <= Math.max(left, right - level.cols + 1); x0++)
        for (let y0 = top; y0 <= Math.max(top, bottom - level.rows + 1); y0++)
          most = Math.max(most, touched.filter((t) =>
            t.x >= x0 && t.x < x0 + level.cols && t.y >= y0 && t.y < y0 + level.rows).length);
    }
  // Growing the screen may add a row or column that no pan could show.
  const bounds = viewBounds(camera, viewport),
    span = (size: number, tiles: number) => Math.min(tiles, Math.floor(size / extent) + 2);
  return Math.min(most, span(bounds.right - bounds.left, level.cols) * span(bounds.bottom - bounds.top, level.rows));
}
/** World-space box around the screen. All four corners are inverse-projected:
 * an unrotated rectangle would miss areas along diagonal edges when rotated. */
export function viewBounds(camera: Camera, viewport: Size) {
  const corners = [
    { x: 0, y: 0 },
    { x: viewport.width, y: 0 },
    { x: 0, y: viewport.height },
    { x: viewport.width, y: viewport.height },
  ].map((p) => screenToWorld(camera, p));
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}
export function visibleTiles(level: Level, camera: Camera, viewport: Size) {
  const bounds = viewBounds(camera, viewport);
  const extent = TILE_SIZE * level.scale;
  const x0 = Math.max(0, Math.floor(bounds.left / extent)),
    y0 = Math.max(0, Math.floor(bounds.top / extent));
  const x1 = Math.min(level.cols - 1, Math.floor(bounds.right / extent)),
    y1 = Math.min(level.rows - 1, Math.floor(bounds.bottom / extent));
  const center = screenToWorld(camera, {
    x: viewport.width / 2,
    y: viewport.height / 2,
  });
  const tiles: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (onScreen(camera, viewport, { x: x * extent, y: y * extent, width: extent, height: extent }))
        tiles.push({ x, y });
  return tiles.sort(
    (a, b) =>
      (a.x + 0.5 - center.x / extent) ** 2 +
      (a.y + 0.5 - center.y / extent) ** 2 -
      (b.x + 0.5 - center.x / extent) ** 2 -
      (b.y + 0.5 - center.y / extent) ** 2,
  );
}
/** Whether a world-space rectangle inside the `viewBounds` box reaches the
 * screen. The box alone also takes in its corners beside a turned screen. */
export function onScreen(
  camera: Camera,
  viewport: Size,
  rect: { x: number; y: number; width: number; height: number },
) {
  const { c, s } = trig(camera.rotation ?? 0),
    center = worldToScreen(camera, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  // Half the rectangle's on-screen extents, turned with the map.
  const w = (camera.scale * (Math.abs(c) * rect.width + Math.abs(s) * rect.height)) / 2,
    h = (camera.scale * (Math.abs(s) * rect.width + Math.abs(c) * rect.height)) / 2;
  return center.x + w >= 0 && center.x - w <= viewport.width &&
    center.y + h >= 0 && center.y - h <= viewport.height;
}
