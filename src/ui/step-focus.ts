/** Up and Down move focus through `items`, Home and End jump to either end.
 * Menus wrap around; lists stop at their ends. True when the key was used. */
export function stepFocus(event: KeyboardEvent, items: readonly HTMLElement[], wrap = false) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const current = items.findIndex((item) => item.contains(event.target as Node));
  let next = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: items.length - 1 }[event.key];
  if (next === undefined) return false;
  // From outside (a menu's button), Down enters at the top and Up at the bottom.
  if (current < 0 && event.key.startsWith("Arrow")) next = event.key === "ArrowDown" ? 0 : items.length - 1;
  if (wrap) next = (next + items.length) % items.length;
  const item = items[next];
  if (!item) return false;
  event.preventDefault();
  item.focus();
  return true;
}

const TYPEAHEAD_MS = 700;

/** Typing a name's first letters focuses the next of `items` whose name starts
 * with them; repeating one letter cycles through the matches. Each list keeps
 * its own typed letters. True when the key was used. */
export function typeahead(name: (item: HTMLElement) => string) {
  let typed = "", typedAt = 0;
  return (event: KeyboardEvent, items: readonly HTMLElement[]) => {
    if (event.altKey || event.ctrlKey || event.metaKey || !/^[\p{L}\p{N}]$/u.test(event.key)) return false;
    const current = items.findIndex((item) => item.contains(event.target as Node));
    if (current < 0) return false;
    const now = Date.now();
    typed = (now - typedAt > TYPEAHEAD_MS ? "" : typed) + event.key.toLowerCase();
    typedAt = now;
    const repeat = [...typed].every((letter) => letter === typed.charAt(0));
    const prefix = repeat ? typed.charAt(0) : typed;
    for (let step = repeat ? 1 : 0; step <= items.length; step++) {
      const item = items[(current + step) % items.length]!;
      // Leading quotes or brackets are skipped: "(Old) Gate" is found by O.
      if (!name(item).toLowerCase().replace(/^[^\p{L}\p{N}]+/u, "").startsWith(prefix)) continue;
      event.preventDefault();
      item.focus();
      return true;
    }
    return false;
  };
}
