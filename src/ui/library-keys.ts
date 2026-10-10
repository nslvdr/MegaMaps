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
    const id = card.dataset.map!;
    if (target.closest(".map-open") && (event.key === "F2" || event.key === "Delete" || event.key === "Backspace")) {
      if (event.key === "F2" && event.metaKey) return;
      event.preventDefault();
      if (event.key === "F2") actions.rename(id);
      else actions.remove(id);
      return;
    }
    if (event.metaKey) return;
    const cards = [...grid.querySelectorAll<HTMLElement>(".map-card")];
    const current = cards.indexOf(card);
    const next = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: cards.length - 1 }[event.key];
    const destination = next === undefined ? undefined : cards[next];
    if (!destination) return;
    event.preventDefault();
    // Stay in the same column: the map itself or its options button.
    const column = target.closest(".map-more") ? ".map-more" : ".map-open";
    destination.querySelector<HTMLElement>(column)!.focus();
  });
}
