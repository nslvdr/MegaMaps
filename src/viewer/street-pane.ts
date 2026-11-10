import { cameraAt, screenToWorld, worldToScreen, type Camera, type Point } from "./camera";
import { MAX_STREET_ZOOM, STREET_TILE_SIZE } from "./geo";
import { attachInteractions } from "./interactions";
import { STREETS_STRENGTH, type StreetTiles } from "./street-tiles";

/** A few streets across: close enough to tell one corner from the next. */
const START_SCALE = STREET_TILE_SIZE * 2 ** 16;
/** From the whole world to two zooms past the deepest tiles, for placing a spot exactly. */
const LIMITS = { min: STREET_TILE_SIZE, max: STREET_TILE_SIZE * 2 ** (MAX_STREET_ZOOM + 2) };

/** The neon dot that marks a matched spot, the same on the map and the streets. */
export function paintSpot(ctx: CanvasRenderingContext2D, { x, y }: Point, label: string) {
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, 2 * Math.PI);
  ctx.fillStyle = "#b6ff3b";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#000";
  ctx.stroke();
  ctx.fillStyle = "#000";
  ctx.font = "600 14px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
}

/** The streets alone on their own canvas, north up, moved by the fingers
 * apart from the map: matching spots, each half is looked around separately.
 * The canvas runs on behind the card; `window`, its parent, is the part left
 * in sight, whose middle the cross marks. */
export class StreetPane {
  /** The part in sight. */
  private width = 1;
  private height = 1;
  /** Takes Mercator to this canvas's pixels; the whole world until a place is known. */
  private camera: Camera = cameraAt({ x: 0.5, y: 0.5 }, this.viewport, LIMITS.min);
  private dpr = 1;
  private frame = 0;
  private spot?: Point;
  private interactions;
  private observer = new ResizeObserver(() => this.resize());
  private window: HTMLElement;
  constructor(
    private canvas: HTMLCanvasElement,
    private tiles: StreetTiles,
    private dark: () => boolean,
  ) {
    this.window = canvas.parentElement!;
    this.interactions = attachInteractions(canvas, {
      getCamera: () => this.camera,
      setCamera: (camera) => this.setCamera(camera),
      limits: () => LIMITS,
      animate: (camera) => this.setCamera(camera),
      stopAnimation: () => {},
    });
    this.observer.observe(canvas);
    this.observer.observe(this.window);
    this.resize();
  }
  private get viewport() {
    return { width: this.width, height: this.height };
  }
  /** The Mercator point under the cross, in the middle of the pane. */
  center() {
    return screenToWorld(this.camera, { x: this.width / 2, y: this.height / 2 });
  }
  /** Screen pixels a Mercator unit spans now. */
  scale() {
    return this.camera.scale;
  }
  /** Brings `center` under the cross, close enough to read the streets. */
  moveTo(center: Point) {
    this.interactions.reset();
    this.setCamera(cameraAt(center, this.viewport, START_SCALE));
  }
  /** The first matched spot, shown where it lies. */
  mark(spot?: Point) {
    this.spot = spot;
    this.invalidate();
  }
  invalidate() {
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }
  private setCamera({ x, y, scale }: Camera) {
    // The cross never leaves the world.
    const inside = (p: number, size: number) => Math.max(size / 2 - scale, Math.min(size / 2, p));
    this.camera = { x: inside(x, this.width), y: inside(y, this.height), scale };
    this.invalidate();
  }
  private resize() {
    const { clientWidth: width, clientHeight: height } = this.window;
    // Hidden while the match is checked over the map.
    if (!width || !height) return;
    const center = this.center();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(this.canvas.clientWidth * this.dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * this.dpr);
    this.setCamera(cameraAt(center, this.viewport, this.camera.scale));
    this.paint();
  }
  private paint() {
    const ctx = this.canvas.getContext("2d", { alpha: false })!,
      dark = this.dark();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = dark ? "#0e1013" : "#f2efe9";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = true;
    this.tiles.draw(ctx, this.camera, { width: this.canvas.clientWidth, height: this.canvas.clientHeight }, this.dpr, dark);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1 - STREETS_STRENGTH;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    ctx.globalAlpha = 1;
    if (this.spot) paintSpot(ctx, worldToScreen(this.camera, this.spot), "1");
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.interactions.dispose();
  }
}
