import { stepFocus } from "./step-focus";

// Keyboard use of the library list. Up and Down step through the maps; Home
// and End jump to either end. As in file managers, F2 renames the focused map
// and Delete asks to remove it. Typing a name's first letters jumps to it, and
// repeating one letter cycles through the maps that start with it.
const TYPEAHEAD_MS = 700;

export function initLibraryKeys(
  grid: HTMLElement,
  actions: { rename(id: string): void; remove(id: string): void },
) {
  let typed = "", typedAt = 0;
  grid.addEventListener("keydown", (event) => {
    if (event.key.length === 1 && event.key !== " " && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const column = (event.target as Element).closest(".map-more") ? ".map-more" : ".map-open";
      const items = [...grid.querySelectorAll<HTMLElement>(`.map-card ${column}`)];
      const current = items.findIndex((item) => item.contains(event.target as Node));
      if (current < 0) return;
      const now = Date.now();
      typed = (now - typedAt > TYPEAHEAD_MS ? "" : typed) + event.key.toLowerCase();
      typedAt = now;
      const repeat = [...typed].every((letter) => letter === typed[0]);
      const prefix = repeat ? typed.charAt(0) : typed;
      for (let step = repeat ? 1 : 0; step <= items.length; step++) {
        const item = items[(current + step) % items.length]!;
        const name = item.closest(".map-card")?.querySelector("h3")?.textContent ?? "";
        if (!name.trim().toLowerCase().startsWith(prefix)) continue;
        event.preventDefault();
        item.focus();
        return;
      }
      return;
    }
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
