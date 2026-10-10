import { TILE_SIZE, tileKey, type MapRecord } from "../types";
import { payloadStore } from "../storage/payloads";
import {
  fitCamera,
  constrain,
  zoomAt,
  chooseLevel,
  visibleTiles,
  type Camera,
  type Point,
  cameraAt,
  screenToWorld,
  worldToScreen,
  transformAt,
} from "./camera";
import { TileCache } from "./cache";
import { attachInteractions } from "./interactions";
import {
  defaultNavigation,
  DEFAULT_DIMMING,
  captureView,
  restoreView,
  insideImage,
  type NavigationState,
  type Tool,
  type MapMarker,
} from "./navigation";
import { NavigationOverlay } from "./overlays";
import {
  darkMode,
  measureTone,
  type DarkMode,
  type MapTone,
} from "./appearance";
import { SearchOverlay } from "./search-overlay";
import { CalloutLayout, type CalloutBounds } from "./callout-layout";
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
  /** Long press on the map while browsing, in image coordinates. */
  onLongPress?(point: Point): void;
  /** A route point or the moving place was picked up (before it changes). */
  onDragStart?(): void;
  /** It was put down (moved) or put back (interrupted). */
  onDrop?(moved: boolean): void;
  onAppearance?(mode: DarkMode): void;
}
export class Viewer {
  private navigation: NavigationState;
  private overlay?: NavigationOverlay;
  private searchOverlay?: SearchOverlay;
  private tool: Tool = "browse";
  /** The route being edited or the place being moved. */
  private target?: string;
  private dragging?: { point: Point; from: Point };
  private tone?: MapTone;
  private dark = darkMode(undefined);
  private camera: Camera = { x: 0, y: 0, scale: 1 };
  private width = 1;
  private height = 1;
  private dpr = 1;
  private frame = 0;
  private animation = 0;
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
    );
    this.observer = new ResizeObserver(() => this.resize());
    this.interactions = attachInteractions(canvas, {
      getCamera: () => this.camera,
      setCamera: (camera) => this.setCamera(camera),
      limits: () => this.limits(),
      animate: (camera) => this.animate(camera),
      stopAnimation: () => this.stopAnimation(),
      locked: () => this.navigation.touchLocked,
      rotationLocked: () => this.navigation.rotationLocked,
      editing: () => this.tool !== "browse",
      tap: (point) => this.tap(point),
      grab: (screen) => this.grab(screen),
      drag: (screen) => this.dragTo(screen),
      drop: (screen) => this.drop(screen),
      cancelDrag: () => this.cancelDrag(),
      longPress: (screen) => {
        const point = screenToWorld(this.camera, screen);
        if (this.tool !== "browse" || !insideImage(point, this.map)) return false;
        if (!this.options?.onLongPress) return false;
        this.options.onLongPress(point);
        return true;
      },
    });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.interactions.reset();
      },
      { signal: this.controller.signal },
    );
    canvas.addEventListener(
      "keydown",
      (event) => {
        if (this.navigation.touchLocked) return;
        // Browser zoom (⌘+/⌘−) and history keys keep working over the map.
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const camera = this.camera,
          movement = 60;
        const deltas: Record<string, [number, number]> = {
          ArrowLeft: [movement, 0],
          ArrowRight: [-movement, 0],
          ArrowUp: [0, movement],
          ArrowDown: [0, -movement],
        };
        const delta = deltas[event.key];
        if (delta) {
          event.preventDefault();
          this.interactions.stop();
          this.setCamera({
            ...camera,
            x: camera.x + delta[0],
            y: camera.y + delta[1],
          });
        }
        if (["+", "=", "-", "_"].includes(event.key)) {
          event.preventDefault();
          this.interactions.stop();
          const { min, max } = this.limits();
          this.animate(
            zoomAt(
              camera,
              Math.max(
                min,
                Math.min(
                  max,
                  camera.scale *
                    (event.key === "-" || event.key === "_" ? 1 / 1.5 : 1.5),
                ),
              ),
              this.width / 2,
              this.height / 2,
            ),
          );
        }
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
  private limits(rotation = this.camera.rotation ?? 0) {
    return {
      min: fitCamera(this.map, this.viewport(), rotation).scale,
      max: Math.max(4, fitCamera(this.map, this.viewport(), rotation).scale),
    };
  }
  private resize() {
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
    this.width = Math.max(1, this.canvas.clientWidth);
    this.height = Math.max(1, this.canvas.clientHeight);
    // Cap the backing canvas at 4 MP (16 MiB); don't blindly allocate DPR=3 canvases.
    this.dpr = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(4_000_000 / (this.width * this.height)),
    );
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
    // Repaint before the browser shows the cleared canvas: the dark filter
    // turns it light grey until the next frame, which a busy thread delays.
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
      const index = this.map.levels.length - 1;
      const bitmap = await createImageBitmap(
        await payloadStore(this.map.backend).get(
          this.map.id,
          tileKey(index, 0, 0),
        ),
      );
      if (this.disposed) bitmap.close();
      else {
        this.base = bitmap;
        this.tone = measureTone(bitmap);
        this.applyAppearance();
        this.invalidate();
      }
    } catch {
      if (!this.disposed)
        this.onError("The map preview is missing. Reimport this map.");
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
    this.camera = constrain(limited, this.map, this.viewport());
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
    this.overlay?.setEditing(
      tool === "route" ? targetId : undefined,
      tool === "move" ? targetId : undefined,
    );
    this.invalidate();
  }
  setSearch(matches: MapSearchMatch[], active: boolean, selected = 0) {
    this.searchOverlay?.set(matches, active, selected);
    this.overlay?.setSearchMarkers(active ? matches.flatMap(match => match.marker ? [match.marker.id] : []) : []);
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
    const filter = [
      this.navigation.inverted ? this.dark.filter : "",
      this.navigation.dimming < 1 ? `brightness(${this.navigation.dimming})` : "",
    ]
      .filter(Boolean)
      .join(" ");
    this.canvas.style.filter = filter;
    // Annotations stay at full strength at the default dim and only fade
    // (never below 60%) when the map is dimmed further.
    if (this.options)
      this.options.overlay.style.opacity = String(
        Math.min(1, Math.max(0.6, this.navigation.dimming / DEFAULT_DIMMING)),
      );
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
  // `deliberate` lets an explicit "north up" reset bypass the twist lock.
  rotateTo(rotation: number, deliberate = false) {
    if (
      this.navigation.touchLocked ||
      (this.navigation.rotationLocked && !deliberate)
    )
      return;
    this.interactions.reset();
    this.setCamera(
      transformAt(this.camera, this.camera.scale, rotation, {
        x: this.width / 2,
        y: this.height / 2,
      }),
    );
  }
  jumpTo(point: Point) {
    if (this.navigation.touchLocked) return;
    this.interactions.reset();
    this.setCamera(
      cameraAt(
        point,
        this.viewport(),
        Math.max(this.camera.scale, 0.2),
        this.camera.rotation ?? 0,
      ),
    );
  }
  // Frame a route or group of places, leaving room for the floating controls.
  fitPoints(points: Point[]) {
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
    const { min, max } = this.limits();
    const scale = Math.max(
      min,
      Math.min(
        max,
        1,
        (this.width - 96) / Math.max(1, width),
        (this.height - 260) / Math.max(1, height),
      ),
    );
    this.animate(
      cameraAt(
        { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        this.viewport(),
        scale,
        rotation,
      ),
    );
  }
  private tap(screen: Point) {
    const point = screenToWorld(this.camera, screen);
    if (!insideImage(point, this.map)) return this.tool !== "browse";
    const near = (target: Point, radius: number) => {
      const p = worldToScreen(this.camera, target);
      return Math.hypot(p.x - screen.x, p.y - screen.y) < radius;
    };
    const markers = this.navigation.layers.places ? this.navigation.markers : [];
    if (this.tool === "route") {
      // Snap route points onto saved places the user taps.
      const snap = markers
        .map((m) => m.point)
        .find((target) => near(target, 24));
      this.options?.onTap(snap ? { ...snap } : point);
      return true;
    }
    if (this.tool !== "browse") {
      this.options?.onTap(point);
      return true;
    }
    const marker = markers.find((marker) => near(marker.point, 24));
    if (marker) {
      this.options?.onMarker(marker);
      return true;
    }
    return false;
  }
  private near(target: Point, screen: Point) {
    const p = worldToScreen(this.camera, target);
    return Math.hypot(p.x - screen.x, p.y - screen.y);
  }
  // Only while editing: the drawn route's points, or the place being moved.
  private grab(screen: Point) {
    const { routes, markers } = this.navigation;
    let found: { point: Point; replace(point: Point): void } | undefined;
    if (this.tool === "route") {
      const route = routes.find((r) => r.id === this.target);
      let best = 28;
      // Later points win ties, so the end just drawn is the one picked up.
      route?.points.forEach((point, index) => {
        const d = this.near(point, screen);
        if (d <= best) {
          best = d;
          found = { point, replace: (p) => (route.points[index] = p) };
        }
      });
    }
    if (this.tool === "move") {
      const marker = markers.find((m) => m.id === this.target);
      if (marker && this.near(marker.point, screen) < 36)
        found = { point: marker.point, replace: (p) => (marker.point = p) };
    }
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
    if (this.tool === "route" && this.navigation.layers.places) {
      const place = this.navigation.markers.find(
        (m) => this.near(m.point, screen) < 24,
      );
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
  }
  private animate(target: Camera) {
    this.stopAnimation();
    target = constrain(target, this.map, this.viewport());
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.setCamera(target);
      return;
    }
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
      else this.setCamera(target);
    };
    this.animation = requestAnimationFrame(tick);
  }
  private invalidate() {
    if (!this.frame && !this.disposed)
      this.frame = requestAnimationFrame((now) => {
        this.frame = 0;
        this.draw(now);
      });
  }
  private draw(now: number) {
    const ctx = this.canvas.getContext("2d", { alpha: false })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Margins and unloaded areas become pure black after the display filter.
    const black = this.navigation.inverted ? this.dark.black : "#000";
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.camera.x, this.camera.y);
    ctx.rotate(this.camera.rotation ?? 0);
    ctx.scale(this.camera.scale, this.camera.scale);
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, this.map.width, this.map.height);
    if (this.base)
      ctx.drawImage(this.base, 0, 0, this.map.width, this.map.height);
    let level = chooseLevel(this.map.levels, this.camera.scale, this.dpr);
    let tiles = visibleTiles(
      this.map.levels[level]!,
      this.camera,
      this.viewport(),
    );
    // Keep all visible tiles within the decoded-byte budget, including edge tiles.
    while (tiles.length > 22 && level < this.map.levels.length - 1)
      tiles = visibleTiles(
        this.map.levels[++level]!,
        this.camera,
        this.viewport(),
      );
    this.cache.plan(tiles.map((t) => ({ ...t, level })));
    const entries = this.cache.tiles
      .filter((t) => t.level >= level)
      .sort((a, b) => b.level - a.level);
    for (const tile of entries) {
      const scale = this.map.levels[tile.level]!.scale;
      ctx.imageSmoothingEnabled = this.camera.scale * scale * this.dpr < 1;
      const x = tile.x * TILE_SIZE * scale,
        y = tile.y * TILE_SIZE * scale;
      const width = Math.min(tile.bitmap.width * scale, this.map.width - x),
        height = Math.min(tile.bitmap.height * scale, this.map.height - y);
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
    const viewport = this.viewport();
    const labels = new CalloutLayout(viewport, this.options?.labelObstacles?.() ?? []);
    this.searchOverlay?.reserve(this.camera, labels);
    this.overlay?.reserve(this.camera, labels);
    // The current search result gets space first, then saved items share it.
    this.searchOverlay?.draw(this.camera, viewport, labels);
    this.overlay?.draw(this.camera, viewport, labels);
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
    this.base?.close();
    this.overlay?.dispose();
    this.searchOverlay?.dispose();
    this.canvas.width = this.canvas.height = 1;
  }
}
