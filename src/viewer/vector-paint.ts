import type { VectorLayer } from "../vectors/layer";
import { invert, type Geo } from "./geo";
import { worldToScreen } from "./camera";

const LINE_COLOR = "#38d6ff";
const CASING_COLOR = "rgb(0 0 0 / 0.7)";
/** Each layer's lines in image pixels, so a frame only strokes them. Calibrating replaces `geo`. */
const paths = new WeakMap<VectorLayer, { geo: Geo; path: Path2D }>();
function pathOf(layer: VectorLayer, geo: Geo) {
  const cached = paths.get(layer);
  if (cached?.geo === geo) return cached.path;
  const toImage = invert(geo), path = new Path2D();
  for (const line of layer.lines)
    for (let i = 0; i < line.length; i += 2) {
      const { x, y } = worldToScreen(toImage, { x: line[i]!, y: line[i + 1]! });
      if (i) path.lineTo(x, y);
      else path.moveTo(x, y);
    }
  paths.set(layer, { geo, path });
  return path;
}
/** Draws on the map's own transform, at a steady width on screen. */
export function paintVectors(ctx: CanvasRenderingContext2D, layers: VectorLayer[], geo: Geo, scale: number) {
  ctx.lineCap = ctx.lineJoin = "round";
  for (const layer of layers) {
    if (!layer.visible) continue;
    const path = pathOf(layer, geo);
    ctx.strokeStyle = CASING_COLOR;
    ctx.lineWidth = 4 / scale;
    ctx.stroke(path);
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 2 / scale;
    ctx.stroke(path);
  }
}
