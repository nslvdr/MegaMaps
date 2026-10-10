import { stepFocus } from "./step-focus";

// Keyboard use of the library list. Up and Down step through the maps; Home
// and End jump to either end. As in file managers, F2 renames the focused map
// and Delete asks to remove it.
export function initLibraryKeys(
  grid: HTMLElement,
  actions: { rename(id: string): void; remove(id: string): void },
) {
  grid.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.shiftKey) return;
    const target = event.target as Element;
    const card = target.closest<HTMLElement>(".map-card");
    if (!card) return;
    if (target.closest(".map-open") && (event.key === "F2" || event.key === "Delete" || event.key === "Backspace")) {
      if (event.key === "F2" && event.metaKey) return;
      event.preventDefault();
      if (event.key === "F2") actions.rename(card.dataset.map!);
      else actions.remove(card.dataset.map!);
      return;
    }
    // An open menu takes the arrows itself.
    if (target.closest(".map-more")?.getAttribute("aria-expanded") === "true") return;
    // Stay in the same column: the map itself or its options button.
    const column = target.closest(".map-more") ? ".map-more" : ".map-open";
    stepFocus(event, [...grid.querySelectorAll<HTMLElement>(`.map-card ${column}`)]);
  });
}
