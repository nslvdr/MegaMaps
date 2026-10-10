import test from "node:test";
import assert from "node:assert/strict";
import { attachInteractions } from "../src/viewer/interactions";
import { screenToWorld, type Camera } from "../src/viewer/camera";
class Canvas extends EventTarget {
  clientHeight = 844;
  getBoundingClientRect() {
    return { left: 0, top: 0 };
  }
  setPointerCapture() {}
}
function emit(
  canvas: Canvas,
  type: string,
  properties: Record<string, number | string>,
) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, properties);
  canvas.dispatchEvent(event);
}
function host(canvas: Canvas) {
  let camera: Camera = { x: 0, y: 0, scale: 1 };
  let locked = false,
    rotationLocked = true,
    editing = false,
    taps = 0,
    presses = 0,
    animations = 0;
  const interactions = attachInteractions(
    canvas as unknown as HTMLCanvasElement,
    {
      getCamera: () => camera,
      setCamera: (value) => {
        camera = value;
      },
      limits: () => ({ min: 0.01, max: 4 }),
      animate: (value) => {
        camera = value;
        animations++;
      },
      stopAnimation() {},
      locked: () => locked,
      rotationLocked: () => rotationLocked,
      editing: () => editing,
      tap: () => {
        if (editing) {
          taps++;
          return true;
        }
        return false;
      },
      longPress: () => {
        if (editing) return false;
        presses++;
        return true;
      },
    },
  );
  return {
    interactions,
    camera: () => camera,
    setLock: (value: boolean) => {
      locked = value;
      interactions.reset();
    },
    setRotationLock: (value: boolean) => {
      rotationLocked = value;
    },
    setEditing: (value: boolean) => {
      editing = value;
    },
    taps: () => taps,
    presses: () => presses,
    animations: () => animations,
  };
}
const pointer = (id: number, x: number, y: number) => ({
  pointerId: id,
  clientX: x,
  clientY: y,
  pointerType: "touch",
  button: 0,
});
test("pinch rotation respects its lock and preserves the moving gesture anchor", () => {
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: () => {},
    configurable: true,
  });
  for (const locked of [true, false]) {
    const canvas = new Canvas(),
      h = host(canvas);
    h.setRotationLock(locked);
    const world = screenToWorld(h.camera(), { x: 150, y: 100 });
    emit(canvas, "pointerdown", pointer(1, 100, 100));
    emit(canvas, "pointerdown", pointer(2, 200, 100));
    emit(canvas, "pointermove", pointer(2, 100, 200));
    assert.ok(
      Math.abs((h.camera().rotation ?? 0) - (locked ? 0 : Math.PI / 2)) < 1e-9,
    );
    const after = screenToWorld(h.camera(), { x: 100, y: 150 });
    assert.ok(
      Math.abs(world.x - after.x) < 1e-9 && Math.abs(world.y - after.y) < 1e-9,
    );
    h.interactions.dispose();
  }
});
test("touch lock blocks dragging, wheel and double zoom; edit taps never double-zoom", () => {
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: () => {},
    configurable: true,
  });
  const canvas = new Canvas(),
    h = host(canvas);
  h.setLock(true);
  emit(canvas, "pointerdown", pointer(1, 100, 100));
  emit(canvas, "pointermove", pointer(1, 200, 200));
  emit(canvas, "pointerup", pointer(1, 200, 200));
  emit(canvas, "wheel", {
    clientX: 100,
    clientY: 100,
    deltaY: -100,
    deltaMode: 0,
  });
  emit(canvas, "dblclick", { clientX: 100, clientY: 100 });
  assert.deepEqual(h.camera(), { x: 0, y: 0, scale: 1 });
  assert.equal(h.animations(), 0);
  h.setLock(false);
  h.setEditing(true);
  for (let i = 0; i < 2; i++) {
    emit(canvas, "pointerdown", pointer(1, 150, 150));
    emit(canvas, "pointerup", pointer(1, 150, 150));
  }
  assert.equal(h.taps(), 2);
  assert.equal(h.animations(), 0);
  h.interactions.dispose();
});
test("double-tap and drag zooms with one finger around the tapped point", () => {
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: () => {},
    configurable: true,
  });
  const canvas = new Canvas(),
    h = host(canvas);
  const anchor = screenToWorld(h.camera(), { x: 150, y: 150 });
  emit(canvas, "pointerdown", pointer(1, 150, 150));
  emit(canvas, "pointerup", pointer(1, 150, 150));
  emit(canvas, "pointerdown", pointer(1, 152, 150));
  emit(canvas, "pointermove", pointer(1, 152, 250));
  assert.ok(Math.abs(h.camera().scale - Math.E) < 1e-6, "drag down zooms in");
  const after = screenToWorld(h.camera(), { x: 152, y: 150 });
  assert.ok(Math.abs(after.x - anchor.x - 2) < 1e-6);
  assert.ok(Math.abs(after.y - anchor.y) < 1e-6);
  emit(canvas, "pointermove", pointer(1, 152, 50));
  assert.ok(Math.abs(h.camera().scale - 1 / Math.E) < 1e-6, "drag up zooms out");
  emit(canvas, "pointerup", pointer(1, 152, 50));
  assert.equal(h.animations(), 0, "a dragged double-tap is not a double-tap zoom");
  // A plain double tap still zooms in.
  emit(canvas, "pointerdown", pointer(1, 300, 300));
  emit(canvas, "pointerup", pointer(1, 300, 300));
  emit(canvas, "pointerdown", pointer(1, 300, 300));
  emit(canvas, "pointerup", pointer(1, 300, 300));
  assert.equal(h.animations(), 1);
  h.interactions.dispose();
});
test("a two-finger tap zooms out around its center; a pinch does not", () => {
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: () => {},
    configurable: true,
  });
  const canvas = new Canvas(),
    h = host(canvas);
  const center = screenToWorld(h.camera(), { x: 150, y: 100 });
  emit(canvas, "pointerdown", pointer(1, 100, 100));
  emit(canvas, "pointerdown", pointer(2, 200, 100));
  emit(canvas, "pointerup", pointer(1, 100, 100));
  emit(canvas, "pointerup", pointer(2, 200, 100));
  assert.equal(h.animations(), 1);
  assert.ok(Math.abs(h.camera().scale - 1 / 2.5) < 1e-9);
  const after = screenToWorld(h.camera(), { x: 150, y: 100 });
  assert.ok(Math.abs(after.x - center.x) < 1e-9 && Math.abs(after.y - center.y) < 1e-9);
  emit(canvas, "pointerdown", pointer(1, 100, 100));
  emit(canvas, "pointerdown", pointer(2, 200, 100));
  emit(canvas, "pointermove", pointer(2, 260, 100));
  emit(canvas, "pointerup", pointer(1, 100, 100));
  emit(canvas, "pointerup", pointer(2, 260, 100));
  assert.equal(h.animations(), 1, "a pinch is not a tap");
  // A single tap afterwards is still a tap, not a leftover pair.
  emit(canvas, "pointerdown", pointer(1, 300, 300));
  emit(canvas, "pointerup", pointer(1, 300, 300));
  emit(canvas, "pointerdown", pointer(1, 300, 300));
  emit(canvas, "pointerup", pointer(1, 300, 300));
  assert.equal(h.animations(), 2, "double tap still zooms in");
  h.interactions.dispose();
});
test("long press fires once without panning; moving or editing cancels it", async () => {
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: () => {},
    configurable: true,
  });
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const canvas = new Canvas(),
    h = host(canvas);
  emit(canvas, "pointerdown", pointer(1, 100, 100));
  await wait(560);
  assert.equal(h.presses(), 1);
  // Wobbling after the press must not pan the map.
  emit(canvas, "pointermove", pointer(1, 140, 140));
  emit(canvas, "pointerup", pointer(1, 140, 140));
  assert.deepEqual(h.camera(), { x: 0, y: 0, scale: 1 });
  emit(canvas, "pointerdown", pointer(1, 100, 100));
  emit(canvas, "pointermove", pointer(1, 160, 100));
  await wait(560);
  emit(canvas, "pointerup", pointer(1, 160, 100));
  assert.equal(h.presses(), 1, "dragging is not a long press");
  emit(canvas, "pointerdown", pointer(1, 100, 100));
  emit(canvas, "pointerup", pointer(1, 100, 100));
  await wait(560);
  assert.equal(h.presses(), 1, "a quick tap is not a long press");
  h.setEditing(true);
  emit(canvas, "pointerdown", pointer(1, 100, 100));
  await wait(560);
  emit(canvas, "pointerup", pointer(1, 100, 100));
  assert.equal(h.presses(), 1);
  assert.equal(h.taps(), 1, "while editing, a slow tap still places a point");
  h.interactions.dispose();
});

test("while editing, a finger on a point drags it instead of the map", () => {
  // Fast pans start inertia; it isn't under test here.
  for (const name of ["requestAnimationFrame", "cancelAnimationFrame"])
    Object.defineProperty(globalThis, name, { value: () => 0, configurable: true });
  const canvas = new Canvas();
  let camera: Camera = { x: 0, y: 0, scale: 1 },
    editing = false,
    taps = 0;
  const log: string[] = [];
  const handle = { x: 100, y: 100 };
  const interactions = attachInteractions(
    canvas as unknown as HTMLCanvasElement,
    {
      getCamera: () => camera,
      setCamera: (value) => {
        camera = value;
      },
      limits: () => ({ min: 0.01, max: 4 }),
      animate: (value) => {
        camera = value;
      },
      stopAnimation() {},
      editing: () => editing,
      tap: () => {
        taps++;
        return true;
      },
      grab: (p) => Math.hypot(p.x - handle.x, p.y - handle.y) < 28,
      drag: (p) => log.push(`drag ${p.x},${p.y}`),
      drop: (p) => log.push(`drop ${p.x},${p.y}`),
      cancelDrag: () => log.push("cancel"),
    },
  );
  // Browsing: the same gesture pans.
  emit(canvas, "pointerdown", pointer(1, 100, 100));
  emit(canvas, "pointermove", pointer(1, 160, 100));
  emit(canvas, "pointerup", pointer(1, 160, 100));
  assert.equal(camera.x, 60);
  assert.deepEqual(log, []);
  editing = true;
  camera = { x: 0, y: 0, scale: 1 };
  emit(canvas, "pointerdown", pointer(1, 105, 95));
  emit(canvas, "pointermove", pointer(1, 108, 95));
  assert.deepEqual(log, [], "wobble inside the slop does not drag");
  emit(canvas, "pointermove", pointer(1, 160, 140));
  emit(canvas, "pointerup", pointer(1, 160, 140));
  assert.deepEqual(log, ["drag 160,140", "drop 160,140"]);
  assert.deepEqual(camera, { x: 0, y: 0, scale: 1 }, "the map stays put");
  assert.equal(taps, 0);
  // A still touch on a point is still a tap.
  emit(canvas, "pointerdown", pointer(1, 100, 100));
  emit(canvas, "pointerup", pointer(1, 100, 100));
  assert.equal(taps, 1);
  // Away from points, editing still pans.
  emit(canvas, "pointerdown", pointer(1, 300, 300));
  emit(canvas, "pointermove", pointer(1, 340, 300));
  emit(canvas, "pointerup", pointer(1, 340, 300));
  assert.equal(camera.x, 40);
  // A second finger puts the point back and pinches instead.
  log.length = 0;
  emit(canvas, "pointerdown", pointer(1, 100, 100));
  emit(canvas, "pointermove", pointer(1, 150, 100));
  emit(canvas, "pointerdown", pointer(2, 300, 300));
  assert.deepEqual(log, ["drag 150,100", "cancel"]);
  emit(canvas, "pointerup", pointer(2, 300, 300));
  emit(canvas, "pointerup", pointer(1, 150, 100));
  assert.deepEqual(log, ["drag 150,100", "cancel"], "no drop after a cancel");
  interactions.dispose();
});
