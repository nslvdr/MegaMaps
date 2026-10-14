type VisibleArea = Pick<VisualViewport, "height" | "offsetTop">;

const nonTextInputs = new Set([
  "button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit",
]);

// How much of the layout viewport's bottom edge is hidden below the visible area.
export function keyboardInset(layoutHeight: number, visible: VisibleArea) {
  return Math.max(0, Math.round(layoutHeight - visible.offsetTop - visible.height));
}

export function isTextEntry(element: Element | null) {
  if (!element) return false;
  if (element.tagName === "TEXTAREA") return true;
  if (element.tagName === "INPUT")
    return !nonTextInputs.has((element as HTMLInputElement).type);
  return (element as HTMLElement).isContentEditable === true;
}

// Phone keyboards cover the page instead of resizing it, so controls pinned to
// the bottom (the search pill, dialogs on phones) end up under the keyboard.
// While a text field has focus, publish the covered height as --keyboard-inset
// so the CSS can lift those controls into view.
export function initKeyboardInset(root = document.documentElement) {
  const viewport = window.visualViewport;
  if (!viewport) return;
  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const inset = isTextEntry(document.activeElement)
        ? keyboardInset(root.clientHeight, viewport)
        : 0;
      root.style.setProperty("--keyboard-inset", `${inset}px`);
    });
  };
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  document.addEventListener("focusin", update);
  document.addEventListener("focusout", update);
}

const controls = "input, textarea, select, button, label, a";

// iOS keeps the keyboard up when empty space is tapped. Within `scope`, a tap
// on anything but a control puts it away. Only a tap: a drag that scrolls
// leaves it up, so the page never jumps under the finger.
export function initTapAway(scope: string, doc = document) {
  let start: { x: number; y: number } | undefined;
  doc.addEventListener("pointerdown", (event) => {
    start = { x: event.clientX, y: event.clientY };
  });
  doc.addEventListener("pointerup", (event) => {
    const active = doc.activeElement as HTMLElement | null;
    const target = event.target as Element;
    const moved = !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10;
    if (moved || !isTextEntry(active) || target.closest(controls) || !target.closest(scope)) return;
    active!.blur();
  });
}
