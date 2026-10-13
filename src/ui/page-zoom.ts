// The map and photos zoom themselves, so the page never should. Safari on
// iOS ignores the viewport's user-scalable=no and lets a pinch on a dialog
// zoom the whole page, which the map then can't pinch back out of. Its
// gesture events start that page zoom, so cancelling them keeps it at 1.
export function lockPageZoom(target: Pick<Document, "addEventListener"> = document) {
  for (const type of ["gesturestart", "gesturechange"])
    target.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}
