export interface PhotoView {
  scale: number;
  x: number;
  y: number;
}
interface Size {
  width: number;
  height: number;
}
interface Point {
  x: number;
  y: number;
}

const MAX_SCALE = 5;
const identity: PhotoView = { scale: 1, x: 0, y: 0 };

export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(1, scale));

/** Moves the view so the photo point under `from` lands under `to` at the new scale. */
export function zoomAt(view: PhotoView, scale: number, from: Point, to = from): PhotoView {
  const ratio = scale / view.scale;
  return { scale, x: to.x - (from.x - view.x) * ratio, y: to.y - (from.y - view.y) * ratio };
}

/**
 * Keeps the photo's edges on screen: a side wider than the screen can't pan
 * past its edge, and a narrower one stays centered. `photo` is the natural size,
 * shown contained in `box` before zooming.
 */
export function clampView(view: PhotoView, box: Size, photo: Size): PhotoView {
  const scale = clampScale(view.scale);
  const fit = photo.width && photo.height ? Math.min(box.width / photo.width, box.height / photo.height) : 1;
  const axis = (offset: number, size: number, natural: number) => {
    const shown = natural ? natural * fit : size;
    // Where the photo starts and how long it is on screen, zoomed from the corner.
    const start = ((size - shown) / 2) * scale, length = shown * scale;
    if (length <= size) return (size - length) / 2 - start;
    return Math.min(0 - start, Math.max(size - start - length, offset));
  };
  return { scale, x: axis(view.x, box.width, photo.width), y: axis(view.y, box.height, photo.height) };
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Full-screen photos: drag or arrow keys to page, pinch or the wheel to
 * zoom, drag to pan a zoomed photo. Every gesture follows the finger; only
 * releases animate, and touching mid-animation picks up where it is.
 */
export class PhotoViewer {
  private readonly stage: HTMLElement;
  private readonly track: HTMLElement;
  private index = 0;
  private view = identity;
  /** Horizontal drag of the track away from the current photo. */
  private drag = 0;
  private pointers = new Map<number, Point>();
  private gesture?: { view: PhotoView; drag: number; points: Point[]; pinched: boolean; moved: boolean; last: { x: number; time: number }; speed: number };

  constructor(private readonly dialog: HTMLDialogElement, signal: AbortSignal) {
    this.stage = dialog.querySelector(".photo-viewer-stage")!;
    this.track = dialog.querySelector(".photo-viewer-track")!;
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, action: (event: HTMLElementEventMap[K]) => void) =>
      target.addEventListener(type, action, { signal, passive: false });
    on(this.stage, "pointerdown", (event) => this.down(event));
    on(this.stage, "pointermove", (event) => this.move(event));
    on(this.stage, "pointerup", (event) => this.up(event));
    on(this.stage, "pointercancel", (event) => this.up(event));
    on(this.stage, "wheel", (event) => this.wheel(event));
    on(dialog, "close", () => this.pointers.clear());
    dialog.ownerDocument.defaultView?.addEventListener("resize", () => this.dialog.open && this.render(), { signal });
  }

  show(images: HTMLImageElement[], index: number) {
    this.track.replaceChildren(...images.map((image) => {
      const slide = this.dialog.ownerDocument.createElement("div");
      slide.className = "photo-viewer-slide";
      image.draggable = false;
      image.addEventListener("load", () => this.slides()[this.index] === slide && this.render(), { once: true });
      slide.append(image);
      return slide;
    }));
    this.index = index;
    this.view = identity;
    this.drag = 0;
    this.settle(false);
    this.dialog.showModal();
    this.render();
  }

  private slides() {
    return [...this.track.children] as HTMLElement[];
  }
  private image() {
    return this.slides()[this.index]?.querySelector("img") ?? undefined;
  }
  private box() {
    return { width: this.stage.clientWidth, height: this.stage.clientHeight };
  }
  private clamp(view: PhotoView) {
    const image = this.image();
    return clampView(view, this.box(), { width: image?.naturalWidth ?? 0, height: image?.naturalHeight ?? 0 });
  }
  private point(event: PointerEvent | WheelEvent): Point {
    const rect = this.stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  private render() {
    this.view = this.clamp(this.view);
    this.track.style.transform = `translateX(${this.drag - (this.slides()[this.index]?.offsetLeft ?? 0)}px)`;
    const image = this.image();
    if (image) image.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.scale})`;
  }
  private settle(animate: boolean) {
    if (animate) this.dialog.dataset.settling = "";
    else delete this.dialog.dataset.settling;
  }
  /** Freeze any release animation where it is on screen, so a new touch doesn't jump. */
  private freeze() {
    if (!("settling" in this.dialog.dataset)) return;
    const matrix = (element: Element) => new DOMMatrix(getComputedStyle(element).transform);
    this.drag = matrix(this.track).m41 + (this.slides()[this.index]?.offsetLeft ?? 0);
    const image = this.image();
    if (image) {
      const { a, e, f } = matrix(image);
      this.view = { scale: a, x: e, y: f };
    }
    this.settle(false);
  }
  private go(index: number) {
    const next = Math.max(0, Math.min(this.slides().length - 1, index));
    if (next !== this.index) {
      this.image()?.style.removeProperty("transform");
      this.index = next;
      this.view = identity;
    }
    this.drag = 0;
    this.settle(true);
    this.render();
  }

  private begin() {
    const points = [...this.pointers.values()];
    this.gesture = {
      view: this.view, drag: this.drag, points, pinched: points.length > 1 || !!this.gesture?.pinched,
      moved: !!this.gesture?.moved, last: { x: points[0]!.x, time: performance.now() }, speed: 0,
    };
  }
  private down(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    this.stage.setPointerCapture?.(event.pointerId);
    if (!this.pointers.size) {
      this.freeze();
      this.gesture = undefined;
    }
    this.pointers.set(event.pointerId, this.point(event));
    this.begin();
  }
  private move(event: PointerEvent) {
    const gesture = this.gesture;
    if (!gesture || !this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, this.point(event));
    const [a, b] = [...this.pointers.values()] as [Point, Point?];
    const [startA, startB] = gesture.points as [Point, Point?];
    if (distance(a, startA) > 8 || (b && startB)) gesture.moved = true;
    if (b && startB) {
      const scale = clampScale(gesture.view.scale * distance(a, b) / distance(startA, startB));
      this.view = zoomAt(gesture.view, scale, middle(startA, startB), middle(a, b));
    } else if (gesture.view.scale > 1) {
      this.view = { ...gesture.view, x: gesture.view.x + a.x - startA.x, y: gesture.view.y + a.y - startA.y };
    } else {
      // Paging past the first or last photo gives way, but only a little.
      const dx = a.x - startA.x, edge = (dx > 0 && this.index === 0) || (dx < 0 && this.index === this.slides().length - 1);
      this.drag = gesture.drag + (edge ? dx / 3 : dx);
      const now = performance.now();
      if (now > gesture.last.time) gesture.speed = (a.x - gesture.last.x) / (now - gesture.last.time);
      gesture.last = { x: a.x, time: now };
    }
    this.render();
  }
  private up(event: PointerEvent) {
    const gesture = this.gesture;
    if (!gesture || !this.pointers.delete(event.pointerId)) return;
    if (this.pointers.size) {
      // Lifting one finger of a pinch carries on as a pan from here.
      this.begin();
      return;
    }
    if (this.view.scale > 1 || !this.drag) return;
    const width = this.stage.clientWidth;
    const flick = Math.abs(gesture.speed) > 0.4 ? -Math.sign(gesture.speed) : 0;
    const step = Math.abs(this.drag) > width / 4 ? -Math.sign(this.drag) : flick;
    this.go(this.index + step);
  }
  private wheel(event: WheelEvent) {
    event.preventDefault();
    this.freeze();
    // Trackpad pinches arrive as small ctrl+wheel steps; mouse wheels as big ones.
    const scale = clampScale(this.view.scale * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)));
    this.view = zoomAt(this.view, scale, this.point(event));
    this.render();
  }
}
