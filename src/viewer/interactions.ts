import { zoomAt, transformAt, type Camera, type Point } from "./camera";
interface Pointer extends Point {
  start: Point;
  moved: boolean;
  /** A long press already handled this pointer. */
  held?: boolean;
  /** Landed on an editable point; moving drags it instead of the map. */
  grabbed?: boolean;
}
const LONG_PRESS_MS = 500;
interface InteractionHost {
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  limits(): { min: number; max: number };
  animate(camera: Camera): void;
  stopAnimation(): void;
  locked?(): boolean;
  rotationLocked?(): boolean;
  editing?(): boolean;
  tap?(point: Point): boolean;
  longPress?(point: Point): boolean;
  /** Whether an editable point is under this screen point (editing only). */
  grab?(point: Point): boolean;
  drag?(point: Point): void;
  drop?(point: Point): void;
  /** The drag was interrupted (second finger, cancel): put the point back. */
  cancelDrag?(): void;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
export function attachInteractions(
  canvas: HTMLCanvasElement,
  host: InteractionHost,
) {
  const controller = new AbortController(),
    { signal } = controller;
  const points = new Map<number, Pointer>();
  let velocity = { x: 0, y: 0 },
    lastMove = 0,
    inertia = 0,
    lastTap = { time: 0, x: 0, y: 0 },
    hadPinch = false,
    // Double-tap-and-drag zoom: one-handed, anchored where the finger landed.
    quickZoom: { anchor: Point; y: number; scale: number } | undefined,
    // Two fingers tapped together zoom out, the reverse of a double tap.
    pairTap: { time: number; center: Point } | undefined,
    pressTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelPress = () => {
    clearTimeout(pressTimer);
    pressTimer = undefined;
  };
  const point = (event: PointerEvent | MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const clampScale = (scale: number) => {
    const { min, max } = host.limits();
    return Math.max(min, Math.min(max, scale));
  };
  function stop() {
    cancelPress();
    cancelAnimationFrame(inertia);
    inertia = 0;
    host.stopAnimation();
  }
  function doubleZoom(p: Point) {
    if (host.locked?.() || host.editing?.()) return;
    stop();
    const camera = host.getCamera(),
      { min } = host.limits();
    const target =
      camera.scale >= Math.max(1, min * 8)
        ? min
        : clampScale(camera.scale * 2.5);
    host.animate(zoomAt(camera, target, p.x, p.y));
  }
  function zoomOut(p: Point) {
    stop();
    const camera = host.getCamera();
    host.animate(zoomAt(camera, clampScale(camera.scale / 2.5), p.x, p.y));
  }
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (
        host.locked?.() ||
        (event.pointerType === "mouse" && event.button !== 0)
      )
        return;
      stop();
      canvas.setPointerCapture(event.pointerId);
      const p = point(event);
      // A second finger turns a drag back into a pinch.
      for (const other of points.values())
        if (other.grabbed) {
          if (other.moved) host.cancelDrag?.();
          other.grabbed = false;
        }
      const grabbed =
        !points.size && !!host.editing?.() && !!host.grab?.(p);
      points.set(event.pointerId, { ...p, start: p, moved: false, grabbed });
      quickZoom = undefined;
      if (points.size === 1) pairTap = undefined;
      if (points.size === 1 && !grabbed) {
        hadPinch = false;
        const id = event.pointerId;
        if (
          event.pointerType !== "mouse" &&
          !host.editing?.() &&
          performance.now() - lastTap.time < 320 &&
          distance(lastTap, p) < 32
        )
          quickZoom = { anchor: p, y: p.y, scale: host.getCamera().scale };
        else if (host.longPress)
          pressTimer = setTimeout(() => {
            pressTimer = undefined;
            const held = points.get(id);
            if (!held || held.moved || points.size !== 1 || host.locked?.())
              return;
            if (host.longPress?.(held)) {
              held.held = true;
              lastTap.time = 0;
            }
          }, LONG_PRESS_MS);
      }
      if (points.size > 1) {
        hadPinch = true;
        lastTap.time = 0;
        const [a, b] = [...points.values()];
        pairTap =
          points.size === 2 && event.pointerType !== "mouse" && !a!.moved
            ? { time: performance.now(), center: midpoint(a!, b!) }
            : undefined;
      }
      velocity = { x: 0, y: 0 };
      lastMove = performance.now();
    },
    { signal },
  );
  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (host.locked?.()) return;
      const old = points.get(event.pointerId);
      if (!old) return;
      const before = [...points.values()],
        p = point(event);
      // Fingers wobble; a small slop keeps taps (route points) from becoming pans.
      const slop = event.pointerType === "mouse" ? 4 : 10;
      const moved = old.moved || distance(old.start, p) > slop;
      if (moved) {
        lastTap.time = 0;
        pairTap = undefined;
        cancelPress();
      }
      if (old.held) return;
      points.set(event.pointerId, { ...old, ...p, moved });
      if (old.grabbed) {
        if (moved) host.drag?.(p);
        return;
      }
      const after = [...points.values()];
      const camera = host.getCamera();
      if (quickZoom && after.length === 1) {
        // Drag down zooms in, up zooms out (as in common map apps).
        if (moved)
          host.setCamera(
            zoomAt(
              camera,
              clampScale(quickZoom.scale * Math.exp((p.y - quickZoom.y) * 0.01)),
              quickZoom.anchor.x,
              quickZoom.anchor.y,
            ),
          );
        return;
      }
      if (before.length >= 2) {
        const c0 = midpoint(before[0]!, before[1]!),
          c1 = midpoint(after[0]!, after[1]!);
        const ratio =
          distance(after[0]!, after[1]!) /
          Math.max(1, distance(before[0]!, before[1]!));
        const angle = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);
        const delta =
          angle(after[0]!, after[1]!) - angle(before[0]!, before[1]!);
        const rotation =
          (camera.rotation ?? 0) +
          (host.rotationLocked?.() === false
            ? Math.atan2(Math.sin(delta), Math.cos(delta))
            : 0);
        const zoomed = transformAt(
          camera,
          clampScale(camera.scale * ratio),
          rotation,
          c0,
        );
        host.setCamera({
          ...zoomed,
          x: zoomed.x + c1.x - c0.x,
          y: zoomed.y + c1.y - c0.y,
        });
        velocity = { x: 0, y: 0 };
      } else {
        const dx = p.x - old.x,
          dy = p.y - old.y,
          elapsed = Math.max(4, performance.now() - lastMove);
        velocity = {
          x: velocity.x * 0.3 + (dx / elapsed) * 0.7,
          y: velocity.y * 0.3 + (dy / elapsed) * 0.7,
        };
        host.setCamera({ ...camera, x: camera.x + dx, y: camera.y + dy });
      }
      lastMove = performance.now();
    },
    { signal },
  );
  const release = (event: PointerEvent) => {
    const pointer = points.get(event.pointerId);
    if (!pointer) return;
    points.delete(event.pointerId);
    cancelPress();
    const zooming = quickZoom;
    if (!points.size) quickZoom = undefined;
    if (event.type === "pointercancel" || event.type === "lostpointercapture") {
      if (pointer.grabbed && pointer.moved) host.cancelDrag?.();
      lastTap.time = 0;
      pairTap = undefined;
      velocity = { x: 0, y: 0 };
      return;
    }
    if (host.locked?.()) return;
    if (pointer.grabbed && pointer.moved) {
      host.drop?.(point(event));
      lastTap.time = 0;
      return;
    }
    if (pointer.held || (zooming && pointer.moved)) {
      lastTap.time = 0;
      return;
    }
    if (!points.size && !pointer.moved && !hadPinch && host.tap?.(pointer)) {
      lastTap.time = 0;
      return;
    }
    if (!points.size && pairTap && !pointer.moved) {
      if (performance.now() - pairTap.time < 300) zoomOut(pairTap.center);
      pairTap = undefined;
      return;
    }
    if (!pointer.moved && !hadPinch && event.pointerType !== "mouse") {
      const now = performance.now();
      if (now - lastTap.time < 320 && distance(lastTap, pointer) < 32) {
        doubleZoom(pointer);
        lastTap.time = 0;
      } else lastTap = { ...pointer, time: now };
    }
    if (
      points.size ||
      hadPinch ||
      !pointer.moved ||
      performance.now() - lastMove > 80
    )
      return;
    let time = performance.now();
    const tick = (now: number) => {
      if (document.hidden) {
        stop();
        return;
      }
      const dt = Math.min(32, now - time);
      time = now;
      const camera = host.getCamera();
      host.setCamera({
        ...camera,
        x: camera.x + velocity.x * dt,
        y: camera.y + velocity.y * dt,
      });
      velocity.x *= Math.exp(-dt / 240);
      velocity.y *= Math.exp(-dt / 240);
      if (Math.hypot(velocity.x, velocity.y) > 0.02)
        inertia = requestAnimationFrame(tick);
    };
    inertia = requestAnimationFrame(tick);
  };
  for (const event of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
  ] as const)
    canvas.addEventListener(event, release, { signal });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (host.locked?.()) return;
      stop();
      const p = point(event),
        camera = host.getCamera();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? canvas.clientHeight
            : 1);
      host.setCamera(
        zoomAt(
          camera,
          clampScale(
            camera.scale * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002)),
          ),
          p.x,
          p.y,
        ),
      );
    },
    { signal, passive: false },
  );
  canvas.addEventListener(
    "dblclick",
    (event) => {
      event.preventDefault();
      doubleZoom(point(event));
    },
    { signal },
  );
  canvas.addEventListener("contextmenu", (event) => event.preventDefault(), {
    signal,
  });
  return {
    stop,
    reset() {
      stop();
      points.clear();
      quickZoom = undefined;
      pairTap = undefined;
      lastTap.time = 0;
    },
    dispose() {
      stop();
      controller.abort();
    },
  };
}
