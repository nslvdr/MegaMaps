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
