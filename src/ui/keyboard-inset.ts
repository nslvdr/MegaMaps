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
