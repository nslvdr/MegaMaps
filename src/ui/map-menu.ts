import { popoverPosition } from "./popover-position";
import { stepFocus } from "./step-focus";

export type MapMenuItem = {
  label: string;
  icon: string;
  danger?: boolean;
  action: () => void;
};

// One floating menu for the library cards, mounted on the body so card overflow cannot clip it.
export function initMapMenu() {
  let menu: HTMLElement | undefined;
  let anchor: HTMLButtonElement | undefined;

  const close = (returnFocus = false) => {
    if (!menu) return;
    const previous = anchor;
    menu.remove();
    previous?.setAttribute("aria-expanded", "false");
    previous?.removeAttribute("aria-controls");
    menu = undefined;
    anchor = undefined;
    if (returnFocus) previous?.focus({ preventScroll: true });
  };

  const position = () => {
    if (!menu || !anchor) return;
    const viewport = window.visualViewport;
    const bounds = {
      left: 0,
      top: 0,
      right: viewport?.width ?? window.innerWidth,
      bottom: viewport?.height ?? window.innerHeight,
    };
    menu.style.width = `${Math.max(0, Math.min(216, bounds.right - 16))}px`;
    const place = popoverPosition(anchor.getBoundingClientRect(), bounds, {
      width: 216,
      height: menu.scrollHeight + 2,
    });
    menu.style.left = `${place.left}px`;
    menu.style.top = `${place.top}px`;
    menu.style.maxHeight = `${place.maxHeight}px`;
  };

  document.addEventListener("pointerdown", (event) => {
    if (!menu) return;
    const target = event.target as Element | null;
    if (target?.closest?.(".map-menu, .map-more")) return;
    close();
  });
  document.addEventListener("keydown", (event) => {
    if (!menu) return;
    if (event.key === "Escape") close(true);
    // Arrows walk the items, from the open menu's button too.
    else if (event.target === anchor || menu.contains(event.target as Node))
      stepFocus(event, [...menu.querySelectorAll<HTMLElement>(".popover-item")], true);
  });
  window.addEventListener("scroll", () => close(), true);
  window.addEventListener("resize", () => close());

  const toggle = (button: HTMLButtonElement, label: string, items: MapMenuItem[]) => {
    const wasOpen = anchor === button;
    close();
    if (wasOpen) return;
    menu = document.createElement("div");
    menu.id = "map-menu";
    menu.className = "row-popover map-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", label);
    for (const item of items) {
      const action = document.createElement("button");
      action.className = item.danger ? "popover-item danger" : "popover-item";
      action.setAttribute("role", "menuitem");
      action.innerHTML = item.icon;
      const text = document.createElement("span");
      text.textContent = item.label;
      action.append(text);
      action.addEventListener("click", () => {
        close();
        item.action();
      });
      menu.append(action);
    }
    anchor = button;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", menu.id);
    document.body.append(menu);
    position();
  };

  return { toggle, close: () => close() };
}
