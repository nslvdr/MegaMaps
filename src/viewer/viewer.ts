import { t } from "../i18n";
import { TILE_SIZE, tileKey, type MapRecord } from "../types";
import { payloadStore } from "../storage/payloads";
import {
  fitCamera,
  constrain,
  zoomAt,
  tileLevel,
  visibleTiles,
  onScreen,
  viewBounds,
  type Camera,
  type Point,
  cameraAt,
  screenToWorld,
  worldToScreen,
  transformAt,
} from "./camera";
import { TileCache } from "./cache";
import { attachInteractions, type Hold } from "./interactions";
import {
  defaultNavigation,
  captureView,
  restoreView,
  insideImage,
  type NavigationState,
  type Tool,
  type MapMarker,
  type PlannedRoute,
} from "./navigation";
import { NavigationOverlay } from "./overlays";
import {
  darkMode,
  measureTone,
  type DarkLook,
  type DarkMode,
  type MapTone,
} from "./appearance";
import { Darkener } from "./darkener";
import { SearchOverlay } from "./search-overlay";
import { CalloutLayout, type CalloutBounds } from "./callout-layout";
import { labelZoom } from "./measure";
import type { MapSearchMatch } from "./map-search";
export interface ViewerOptions {
  navigation: NavigationState;
  overlay: SVGSVGElement;
  searchOverlay?: SVGSVGElement;
  /** Visible controls/panels that map labels must not sit underneath. */
  labelObstacles?(): CalloutBounds[];
  onView(): void;
  onTap(point: Point): void;
  onMarker(marker: MapMarker): void;
  /** A browsing tap on a route's line or name. */
  onRoute?(route: PlannedRoute): void;
  /** A browsing tap that hit no place, label or route. */
  onEmptyTap?(): void;
  /** A search result's label was tapped, by its place among the matches. */
  onSearchResult?(index: number): void;
  /** A browsing tap on the trail's last point, the red dot. */
  onTrailMark?(): void;
  /** A browsing double tap; the map itself never zooms on one. */
  onDoubleTap?(): void;
  /** Long press on the map while browsing: `point` in image coordinates, `screen` on the map.
   * The returned hold follows the finger, in the same screen coordinates, until it lifts. */
  onHold?(point: Point, screen: Point): Hold | undefined;
  /** A route point or the moving place was picked up (before it changes). */
  onDragStart?(): void;
  /** It was put down (moved) or put back (interrupted). */
  onDrop?(moved: boolean): void;
  onAppearance?(mode: DarkMode): void;
}
/** Screen distance from a point to the segment between a and b. */
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(0, Math.min(1,
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export class Viewer {
  private navigation: NavigationState;
  private overlay?: NavigationOverlay;
  private searchOverlay?: SearchOverlay;
  private tool: Tool = "browse";
  /** The route being edited or the place being moved. */
  private target?: string;
  private dragging?: { point: Point; from: Point };
  /** The points of the line being measured, or of the scale being set. */
  private measure?: Point[];
  private tone?: MapTone;
  /** Tiles wait for the overview's tone, so they load in their final look once. */
  private measured = false;
  private dark = darkMode(undefined);
  /** The look baked into the loaded tiles; null before the first. */
  private look: DarkLook | undefined | null = null;
  private darkener = new Darkener();
  private baseBlob?: Blob;
  private camera: Camera = { x: 0, y: 0, scale: 1 };
  private width = 1;
  private height = 1;
  /** Map height hidden under a card at the bottom of the screen. */
  private covered = 0;
  private dpr = 1;
  private frame = 0;
  private level?: { view: string; level: number };
  private animation = 0;
  // Where the running animation ends, so quick key presses add up.
  private destination?: Camera;
  /** The compass's map rotation, eased toward a little every frame. */
  private heading?: number;
  private lastTurn = 0;
  private base?: ImageBitmap;
  private disposed = false;
  private cache: TileCache;
  private observer: ResizeObserver;
  private interactions;
  private frameTimes: number[] = [];
  private lastFrame = 0;
  private frames = 0;
  private controller = new AbortController();
  constructor(
    private canvas: HTMLCanvasElement,
    private map: MapRecord,
    private onZoom: (percent: number) => void,
    private onError: (message: string) => void,
    private options?: ViewerOptions,
  ) {
    this.navigation = options?.navigation ?? defaultNavigation(map.id);
    if (options) {
      this.overlay = new NavigationOverlay(options.overlay);
      this.overlay.rebuild(this.navigation);
      if (options.searchOverlay)
        this.searchOverlay = new SearchOverlay(options.searchOverlay);
    }
    this.cache = new TileCache(
      payloadStore(map.backend),
      map.id,
      () => this.invalidate(),
      onError,
      (blob) => this.decode(blob),
    );
    this.observer = new ResizeObserver(() => this.resize());
    this.interactions = attachInteractions(canvas, {
      getCamera: () => this.camera,
      setCamera: (camera) => this.setCamera(camera),
      limits: () => this.limits(),
      animate: (camera) => this.animate(camera),
      stopAnimation: () => this.stopAnimation(),
      locked: () => this.navigation.touchLocked,
      rotationLocked: () => this.navigation.rotationMode !== "free",
      editing: () => this.tool !== "browse",
      tap: (point) => this.tap(point),
      doubleTap: () => this.options?.onDoubleTap?.(),
      grab: (screen) => this.grab(screen),
      drag: (screen) => this.dragTo(screen),
      drop: (screen) => this.drop(screen),
      cancelDrag: () => this.cancelDrag(),
      longPress: (screen) => {
        const point = screenToWorld(this.camera, screen);
        if (this.tool !== "browse" || !insideImage(point, this.map)) return undefined;
        return this.options?.onHold?.(point, screen);
      },
    });
    // A mouse learns what a click would do before clicking: pins and labels
    // open, the map is a target while adding, and editable points drag.
    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (event.pointerType !== "mouse" || event.buttons) return;
        const rect = canvas.getBoundingClientRect();
        canvas.style.cursor = this.cursorAt({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      },
      { signal: this.controller.signal },
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.interactions.reset();
      },
      { signal: this.controller.signal },
    );
    this.observer.observe(canvas);
    const saved = this.navigation.view;
    this.resize();
    if (saved) this.setCamera(restoreView(saved, this.viewport()));
    else this.fit(false);
    this.applyAppearance();
    void this.loadBase();
  }
  private viewport() {
    return { width: this.width, height: this.height };
  }
  /** The map area above any covering card, where places center. */
  private visible() {
    return { width: this.width, height: Math.max(1, this.height - this.covered) };
  }
  private limits(rotation = this.camera.rotation ?? 0) {
    return {
      min: fitCamera(this.map, this.viewport(), rotation).scale,
      max: Math.max(4, fitCamera(this.map, this.viewport(), rotation).scale),
    };
  }
  private resize() {
    const viewportWidth = Math.max(1, this.canvas.clientWidth),
      viewportHeight = Math.max(1, this.canvas.clientHeight);
    // Cap the backing canvas at 4 MP (16 MiB); don't blindly allocate DPR=3 canvases.
    const dpr = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(4_000_000 / (viewportWidth * viewportHeight)),
    );
    // A dialog may already have synchronized the new size before its observer fires.
    if (viewportWidth === this.width && viewportHeight === this.height &&
      dpr === this.dpr && this.canvas.width === Math.round(viewportWidth * dpr) &&
      this.canvas.height === Math.round(viewportHeight * dpr)) return;
    this.interactions?.reset();
    const old = this.viewport(),
      center = screenToWorld(this.camera, {
        x: old.width / 2,
        y: old.height / 2,
      });
    const fitted = fitCamera(this.map, old, this.camera.rotation ?? 0);
    const wasFit =
      Math.abs(this.camera.scale - fitted.scale) < 0.00001 &&
      Math.abs(this.camera.x - fitted.x) < 0.00001 &&
      Math.abs(this.camera.y - fitted.y) < 0.00001;
    this.width = viewportWidth;
    this.height = viewportHeight;
    this.dpr = dpr;
    const width = Math.round(this.width * this.dpr),
      height = Math.round(this.height * this.dpr);
    // Assigning a size clears the canvas, even when it is unchanged.
    const cleared = this.canvas.width !== width || this.canvas.height !== height;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    if (wasFit) this.fit(false);
    else
      this.setCamera(
        cameraAt(
          center,
          this.viewport(),
          this.camera.scale,
          this.camera.rotation ?? 0,
        ),
      );
    // Repaint before the browser shows the cleared canvas, rather than on the
    // next frame, which a busy thread delays.
    if (cleared) this.drawNow();
  }
  private drawNow() {
    if (this.disposed) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.draw(performance.now());
  }
  private async loadBase() {
    try {
      const blob = await payloadStore(this.map.backend).get(
        this.map.id,
        tileKey(this.map.levels.length - 1, 0, 0),
      );
      const bitmap = await createImageBitmap(blob);
      this.tone = measureTone(bitmap);
      bitmap.close();
      this.baseBlob = blob;
    } catch {
      if (!this.disposed)
        this.onError(t("The map preview is missing. Reimport this map."));
    }
    if (this.disposed) return;
    this.measured = true;
    this.applyAppearance();
    this.invalidate();
  }
  private decode(blob: Blob) {
    return this.look ? this.darkener.decode(blob, this.look) : createImageBitmap(blob);
  }
  private async paintBase() {
    const blob = this.baseBlob,
      look = this.look;
    if (!blob) return;
    try {
      const bitmap = await this.decode(blob);
      if (this.disposed || look !== this.look) bitmap.close();
      else {
        this.base = bitmap;
        this.invalidate();
      }
    } catch {
      if (!this.disposed && look === this.look)
        this.onError(t("The map preview is missing. Reimport this map."));
    }
  }

  private setCamera(camera: Camera) {
    const { min, max } = this.limits(camera.rotation ?? 0);
    const scale = Math.max(min, Math.min(max, camera.scale));
    // Enforcing zoom limits must preserve the chosen center (saved views/resizes).
    const limited = scale === camera.scale
      ? camera
      : transformAt(camera, scale, camera.rotation ?? 0, {
          x: this.width / 2,
          y: this.height / 2,
        });
    this.camera = constrain(limited, this.map, this.visible());
    this.navigation.view = captureView(this.camera, this.viewport());
    this.options?.onView();
    this.onZoom(Math.round(this.camera.scale * 100));
    this.invalidate();
  }
  fit(animated = true) {
    if (this.navigation.touchLocked && animated) return;
    this.interactions?.reset();
    const camera = fitCamera(
      this.map,
      this.viewport(),
      this.camera.rotation ?? 0,
    );
    if (animated) this.animate(camera);
    else this.setCamera(camera);
  }
  setTool(tool: Tool, targetId?: string) {
    this.interactions.reset();
    this.dragging = undefined;
    this.tool = tool;
    this.target = targetId;
    this.canvas.style.cursor = "";
    this.overlay?.setEditing(
      tool === "route" ? targetId : undefined,
      tool === "move" ? targetId : undefined,
    );
    this.invalidate();
  }
  /** Shows the measuring line; its array is edited in place by drags. */
  setMeasure(points?: Point[]) {
    this.measure = points;
    this.overlay?.setMeasure(points);
    this.invalidate();
  }
  setSearch(matches: MapSearchMatch[], active: boolean, selected = 0) {
    this.searchOverlay?.set(matches, active, selected);
    this.overlay?.setSearchMarkers(active ? matches.flatMap(match => match.marker ? [match.marker.id] : []) : []);
    this.invalidate();
  }
  /** A finished trip, drawn over the map while its summary is open. */
  showTrip(points?: Point[]) {
    this.overlay?.setTrip(points);
    this.invalidate();
  }
  pulse(id: string) {
    this.overlay?.setFound(id);
    this.invalidate();
  }
  /** The place whose details are open stands out from the others. */
  select(id?: string) {
    this.overlay?.setSelected(id);
    this.invalidate();
  }
  previewPlace(place?: Pick<MapMarker, "point" | "kind">) {
    this.overlay?.setPreview(place);
    this.invalidate();
  }
  // Floating controls can move while the map itself is idle.
  refreshLabels() {
    this.invalidate();
  }
  updateNavigation(state: NavigationState) {
    this.interactions.reset();
    this.navigation = state;
    this.overlay?.rebuild(state);
    this.applyAppearance();
    this.invalidate();
  }
  private applyAppearance() {
    this.dark = darkMode(this.tone);
    const look = this.navigation.inverted ? this.dark.look : undefined;
    // A new look decodes every tile again; brightness is drawn per frame.
    if (this.measured && (this.look === null || this.look?.invert !== look?.invert ||
        this.look?.contrast !== look?.contrast || this.look?.brightness !== look?.brightness)) {
      this.look = look;
      this.cache.reset();
      this.base?.close();
      this.base = undefined;
      void this.paintBase();
    }
    this.options?.onAppearance?.(this.dark);
  }
  zoomBy(factor: number) {
    if (this.navigation.touchLocked) return;
    this.interactions.reset();
    const { min, max } = this.limits();
    this.animate(
      zoomAt(
        this.camera,
        Math.max(min, Math.min(max, this.camera.scale * factor)),
        this.width / 2,
        this.height / 2,
      ),
    );
  }
  panBy(x: number, y: number) {
    if (this.navigation.touchLocked) return;
    this.interactions.reset();
    this.setCamera({
      ...this.camera,
      x: this.camera.x + x,
      y: this.camera.y + y,
    });
  }
  /** A card whose top edge is at `edge` (in page coordinates) hides the map
   * below it; places center above it. Without an edge, the whole map shows. */
  cover(edge?: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.covered = edge === undefined
      ? 0
      : Math.min(this.height, Math.max(0, rect.top + this.height - edge));
    // Uncovering can leave the map's edge past the middle; ease it back.
    const camera = this.destination ?? this.camera;
    const constrained = constrain(camera, this.map, this.visible());
    if (constrained.x !== camera.x || constrained.y !== camera.y)
      this.animate(constrained);
  }
  // Glide to a place, or follow a resizing detail pane immediately without zooming out.
  jumpTo(point: Point, minimumScale = 0.2, animated = true) {
    if (this.navigation.touchLocked) return;
    this.interactions.reset();
    const camera = cameraAt(
      point,
      this.visible(),
      Math.max(this.camera.scale, minimumScale),
      this.camera.rotation ?? 0,
    );
    if (animated) this.animate(camera);
    else {
      this.stopAnimation();
      this.setCamera(camera);
    }
  }
  /** Glides back to a center and zoom the map once showed, keeping its turn. */
  showView(view: { center: Point; scale: number }) {
    if (this.navigation.touchLocked) return;
    this.interactions.reset();
    this.animate(cameraAt(view.center, this.viewport(), view.scale, this.camera.rotation ?? 0));
  }
  /** Slides the map up just enough that a pin stays in sight above a card
   * whose top edge is at `edge` (in page coordinates). */
  /** Returns where the point settles on screen, in page coordinates. */
  reveal(point: Point, edge: number): Point {
    const camera = this.destination ?? this.camera;
    const rect = this.canvas.getBoundingClientRect();
    const p = worldToScreen(camera, point);
    // The pin and its name stand above the point, so leave room for both.
    const top = 120,
      bottom = edge - rect.top - 40;
    if (!this.navigation.touchLocked && p.y > bottom && bottom >= top) {
      this.interactions.reset();
      this.animate({ ...camera, y: camera.y + bottom - p.y });
      p.y = bottom;
    }
    return { x: rect.left + p.x, y: rect.top + p.y };
  }
  /** Whether any of the points is on screen, or will be once the map settles. */
  showing(points: Point[]) {
    const camera = this.destination ?? this.camera;
    return points.some((point) => {
      const p = worldToScreen(camera, point);
      return p.x >= 0 && p.y >= 0 && p.x <= this.width && p.y <= this.height;
    });
  }
  // Frame a route or group of places above any covering card, leaving room
  // for the floating controls.
  fitPoints(points: Point[], animated = true) {
    if (this.navigation.touchLocked || !points.length) return;
    this.interactions.reset();
    const xs = points.map((p) => p.x),
      ys = points.map((p) => p.y);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const rotation = this.camera.rotation ?? 0,
      c = Math.abs(Math.cos(rotation)),
      s = Math.abs(Math.sin(rotation));
    const width = c * (maxX - minX) + s * (maxY - minY),
      height = s * (maxX - minX) + c * (maxY - minY);
    const { min, max } = this.limits(),
      visible = this.visible();
    // A covering card hides the bottom controls; only the top ones remain.
    const scale = Math.max(
      min,
      Math.min(
        max,
        1,
        (this.width - 96) / Math.max(1, width),
        (visible.height - (this.covered ? 160 : 260)) / Math.max(1, height),
      ),
    );
    const camera = cameraAt(
      { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      visible,
      scale,
      rotation,
    );
    if (animated) this.animate(camera);
    else {
      this.stopAnimation();
      this.setCamera(camera);
    }
  }
  private tap(screen: Point) {
    // Search labels float above everything else on the map, so they answer first.
    const result = this.tool === "browse" ? this.searchOverlay?.labelAt(screen) : undefined;
    if (result !== undefined && this.options?.onSearchResult) {
      this.options.onSearchResult(result);
      return true;
    }
    const point = screenToWorld(this.camera, screen);
    if (!insideImage(point, this.map)) {
      if (this.tool !== "browse") return true;
      this.options?.onEmptyTap?.();
      return false;
    }
    const marker = this.nearestPlace(screen);
    if (this.tool === "route" || this.tool === "measure") {
      // Snap route and measure points onto saved places the user taps.
      this.options?.onTap(marker ? { ...marker.point } : point);
      return true;
    }
    if (this.tool !== "browse") {
      this.options?.onTap(point);
      return true;
    }
    // Label chips read as buttons: a place's opens the place, like its pin,
    // and a route's opens the route, like its line.
    const label = marker ? undefined : this.overlay?.labelAt(screen);
    const labelled = marker ?? this.navigation.markers.find((m) => m.id === label?.markerId);
    if (labelled) {
      this.options?.onMarker(labelled);
      return true;
    }
    // Places and labels answer before the red dot, and the dot before a route's line.
    const here = this.navigation.trail.at(-1);
    if (!label && here && this.options?.onTrailMark && this.near(here, screen) < 24) {
      this.options.onTrailMark();
      return true;
    }
    const route = this.navigation.routes.find((r) => r.id === label?.routeId) ??
      this.nearestRoute(screen);
    if (route && this.options?.onRoute) {
      this.options.onRoute(route);
      return true;
    }
    // Not consumed, so a double tap can still turn the map in compass Tap.
    this.options?.onEmptyTap?.();
    return false;
  }
  private cursorAt(screen: Point) {
    if (this.navigation.touchLocked || !insideImage(screenToWorld(this.camera, screen), this.map)) return "";
    const here = this.navigation.trail.at(-1);
    if (this.tool === "browse")
      return this.searchOverlay?.labelAt(screen) !== undefined || this.nearestPlace(screen) ||
        this.overlay?.labelAt(screen) || (here && this.near(here, screen) < 24) || this.nearestRoute(screen)
        ? "pointer" : "";
    return this.grabbable(screen) ? "grab" : "crosshair";
  }
  private near(target: Point, screen: Point) {
    const p = worldToScreen(this.camera, target);
    return Math.hypot(p.x - screen.x, p.y - screen.y);
  }
  // A visible place within reach; where pins crowd, the closest one wins.
  private nearestPlace(screen: Point) {
    if (!this.navigation.layers.places) return undefined;
    let nearest: MapMarker | undefined,
      best = 24;
    for (const marker of this.navigation.markers) {
      const distance = this.near(marker.point, screen);
      if (distance < best) [nearest, best] = [marker, distance];
    }
    return nearest;
  }
  // A visible route whose line passes within reach; the closest one wins.
  private nearestRoute(screen: Point) {
    if (!this.navigation.layers.routes) return undefined;
    let nearest: PlannedRoute | undefined,
      best = 16;
    for (const route of this.navigation.routes) {
      const points = route.points.map((point) => worldToScreen(this.camera, point));
      points.forEach((point, index) => {
        const distance = segmentDistance(screen, points[index - 1] ?? point, point);
        if (distance < best) [nearest, best] = [route, distance];
      });
    }
    return nearest;
  }
  // Only while editing: the drawn route's points, or the place being moved.
  private grabbable(screen: Point) {
    const { routes, markers } = this.navigation;
    let found: { point: Point; replace(point: Point): void } | undefined;
    const line = this.tool === "route" ? routes.find((r) => r.id === this.target)?.points
      : this.tool === "measure" || this.tool === "scale" ? this.measure : undefined;
    let best = 28;
    // Later points win ties, so the end just drawn is the one picked up.
    line?.forEach((point, index) => {
      const d = this.near(point, screen);
      if (d <= best) {
        best = d;
        found = { point, replace: (p) => (line[index] = p) };
      }
    });
    if (this.tool === "move") {
      const marker = markers.find((m) => m.id === this.target);
      if (marker && this.near(marker.point, screen) < 36)
        found = { point: marker.point, replace: (p) => (marker.point = p) };
    }
    return found;
  }
  private grab(screen: Point) {
    const found = this.grabbable(screen);
    if (!found) return false;
    this.options?.onDragStart?.();
    // Its own copy, so a route point snapped onto a place moves alone.
    const point = { ...found.point };
    found.replace(point);
    this.dragging = { point, from: { ...point } };
    this.overlay?.rebuild(this.navigation);
    return true;
  }
  private dragTo(screen: Point) {
    const dragging = this.dragging;
    if (!dragging) return;
    const p = screenToWorld(this.camera, screen);
    dragging.point.x = Math.max(0, Math.min(this.map.width, p.x));
    dragging.point.y = Math.max(0, Math.min(this.map.height, p.y));
    this.invalidate();
  }
  private drop(screen: Point) {
    this.dragTo(screen);
    const dragging = this.dragging;
    if (!dragging) return;
    this.dragging = undefined;
    if (this.tool === "route" || this.tool === "measure") {
      const place = this.nearestPlace(screen);
      if (place) Object.assign(dragging.point, place.point);
    }
    this.options?.onDrop?.(true);
  }
  private cancelDrag() {
    const dragging = this.dragging;
    if (!dragging) return;
    this.dragging = undefined;
    Object.assign(dragging.point, dragging.from);
    this.invalidate();
    this.options?.onDrop?.(false);
  }
  private stopAnimation() {
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    this.destination = undefined;
  }
  private animate(target: Camera) {
    this.stopAnimation();
    target = constrain(target, this.map, this.visible());
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.setCamera(target);
      return;
    }
    this.destination = target;
    const start = { ...this.camera },
      startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / 240),
        ease = 1 - (1 - t) ** 3;
      const scale = Math.exp(
        Math.log(start.scale) +
          (Math.log(target.scale) - Math.log(start.scale)) * ease,
      );
      // Preserve the zoom anchor throughout the animation, not just at its end.
      const ratio = target.scale / start.scale;
      const anchorX =
        Math.abs(1 - ratio) > 0.00001
          ? (target.x - start.x * ratio) / (1 - ratio)
          : this.width / 2;
      const anchorY =
        Math.abs(1 - ratio) > 0.00001
          ? (target.y - start.y * ratio) / (1 - ratio)
          : this.height / 2;
      this.setCamera(
        Math.abs(1 - ratio) > 0.00001
          ? zoomAt(start, scale, anchorX, anchorY)
          : {
              ...start,
              scale,
              x: start.x + (target.x - start.x) * ease,
              y: start.y + (target.y - start.y) * ease,
            },
      );
      if (t < 1) this.animation = requestAnimationFrame(tick);
      else {
        this.destination = undefined;
        this.setCamera(target);
      }
    };
    this.animation = requestAnimationFrame(tick);
  }
  /** Turns the map back to 0°, the short way round, about the visible center. */
  straighten() {
    const from = this.camera.rotation ?? 0;
    if (!from) return;
    this.stopAnimation();
    this.interactions?.reset();
    const center = { x: this.width / 2, y: this.visible().height / 2 },
      turn = (rotation: number) =>
        this.setCamera(transformAt(this.camera, this.camera.scale, rotation, center));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      turn(0);
      return;
    }
    const delta = -Math.atan2(Math.sin(from), Math.cos(from)),
      startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / 240);
      turn(t < 1 ? from + delta * (1 - (1 - t) ** 3) : 0);
      if (t < 1) this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }
  /** Turns the map toward `rotation` (radians) from now on; undefined stops. */
  orient(rotation?: number) {
    this.heading = rotation;
    this.invalidate();
  }
  // Sensor readings jitter, so the map follows them smoothly instead of
  // jumping. Glides to a place or zoom finish first; their path is fixed.
  private turn(now: number) {
    if (this.heading === undefined || this.destination) {
      this.lastTurn = 0;
      return;
    }
    const rotation = this.camera.rotation ?? 0,
      delta = Math.atan2(Math.sin(this.heading - rotation), Math.cos(this.heading - rotation));
    const elapsed = this.lastTurn ? Math.min(100, now - this.lastTurn) : 16;
    this.lastTurn = now;
    if (Math.abs(delta) < 0.001) {
      this.lastTurn = 0;
      return;
    }
    // About 150 ms to cover most of a turn: steady, yet keeps up with walking.
    const next = Math.abs(delta) < 0.003 ? this.heading : rotation + delta * (1 - Math.exp(-elapsed / 150));
    this.setCamera(transformAt(this.camera, this.camera.scale, next, {
      x: this.width / 2,
      y: this.visible().height / 2,
    }));
  }
  private invalidate() {
    if (!this.frame && !this.disposed)
      this.frame = requestAnimationFrame((now) => {
        this.frame = 0;
        this.draw(now);
      });
  }
  private draw(now: number) {
    this.turn(now);
    const ctx = this.canvas.getContext("2d", { alpha: false })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Whole device pixels: a fling's slow tail moves less than a pixel a frame,
    // and sub-pixel offsets resample the tiles differently each time, so fine
    // lines shimmer as the map comes to rest.
    ctx.translate(
      Math.round(this.camera.x * this.dpr) / this.dpr,
      Math.round(this.camera.y * this.dpr) / this.dpr,
    );
    ctx.rotate(this.camera.rotation ?? 0);
    ctx.scale(this.camera.scale, this.camera.scale);
    ctx.fillRect(0, 0, this.map.width, this.map.height);
    // Only zooming, turning or resizing changes the level, never panning.
    const { scale, rotation = 0 } = this.camera,
      view = `${scale} ${rotation} ${this.width} ${this.height} ${this.dpr}`;
    if (this.level?.view !== view)
      this.level = { view, level: tileLevel(this.map.levels, this.camera, this.viewport(), this.dpr) };
    const { level } = this.level;
    const tiles = visibleTiles(this.map.levels[level]!, this.camera, this.viewport());
    if (this.measured) this.cache.plan(tiles.map((t) => ({ ...t, level })));
    // The overview stays beneath everything: it hides hairline seams where
    // anti-aliased tile edges meet. Coarser tiles only fill in while sharper
    // ones load.
    if (this.base)
      ctx.drawImage(this.base, 0, 0, this.map.width, this.map.height);
    const covered = this.cache.complete;
    const entries = this.cache.tiles
      .filter((t) => (covered ? t.level === level : t.level >= level))
      .sort((a, b) => b.level - a.level);
    // Cached tiles from earlier views stay decoded but are not drawn off screen.
    const viewport = this.viewport();
    const bounds = viewBounds(this.camera, viewport);
    for (const tile of entries) {
      const scale = this.map.levels[tile.level]!.scale;
      const x = tile.x * TILE_SIZE * scale,
        y = tile.y * TILE_SIZE * scale;
      const width = Math.min(tile.bitmap.width * scale, this.map.width - x),
        height = Math.min(tile.bitmap.height * scale, this.map.height - y);
      if (x > bounds.right || y > bounds.bottom || x + width < bounds.left || y + height < bounds.top ||
          !onScreen(this.camera, viewport, { x, y, width, height }))
        continue;
      ctx.imageSmoothingEnabled = this.camera.scale * scale * this.dpr < 1;
      // Clip rounded pyramid edges; level dimensions are ceil(original / scale).
      ctx.drawImage(
        tile.bitmap,
        0,
        0,
        width / scale,
        height / scale,
        x,
        y,
        width,
        height,
      );
    }
    // A faint 1px edge, just outside the map, shows where it ends on black.
    const edge = 1 / this.camera.scale;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = edge;
    ctx.strokeRect(-edge / 2, -edge / 2, this.map.width + edge, this.map.height + edge);
    // Dimming is a black veil, the same as brightness(), drawn only on frames
    // that change. Annotations are a separate layer and stay fully opaque.
    if (this.navigation.dimming < 1) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1 - this.navigation.dimming;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.globalAlpha = 1;
    }
    const labels = new CalloutLayout(viewport, this.options?.labelObstacles?.() ?? []);
    this.searchOverlay?.reserve(this.camera, labels);
    this.overlay?.reserve(this.camera, labels);
    // The current search result gets space first, then saved items share it.
    const searchGliding = this.searchOverlay?.draw(this.camera, viewport, labels);
    // Labels finish gliding to a new spot after the map stops.
    // Saved names show once zoomed in close; before, only pins.
    const named = this.camera.scale >= labelZoom(this.limits(), viewport, this.navigation.metresPerPixel);
    if (this.overlay?.draw(this.camera, viewport, labels, named) || searchGliding) this.invalidate();
    if (this.lastFrame && now - this.lastFrame < 100) {
      this.frameTimes.push(now - this.lastFrame);
      if (this.frameTimes.length > 120) this.frameTimes.shift();
    }
    this.lastFrame = now;
    this.frames++;
  }
  // Useful for device profiling; byte counts exclude browser/GPU/encoder overhead.
  diagnostics() {
    return {
      decodedTileBytes: this.cache.decodedBytes,
      canvasBytes: this.canvas.width * this.canvas.height * 4,
      overviewBytes: this.base ? this.base.width * this.base.height * 4 : 0,
      queuedTiles: this.cache.queued,
      renderedFrames: this.frames,
      activeFrameFps: this.frameTimes.length
        ? 1000 /
          (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length)
        : null,
      zoom: this.camera.scale,
      rotation: this.camera.rotation ?? 0,
      inverted: this.navigation.inverted,
      darkMode: this.dark.kind,
      touchLocked: this.navigation.touchLocked,
    };
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.stopAnimation();
    this.controller.abort();
    this.observer.disconnect();
    this.interactions.dispose();
    this.cache.dispose();
    this.darkener.dispose();
    this.base?.close();
    this.overlay?.dispose();
    this.searchOverlay?.dispose();
    this.canvas.width = this.canvas.height = 1;
  }
}
