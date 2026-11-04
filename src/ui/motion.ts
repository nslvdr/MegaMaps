// The app's timings, in milliseconds, matching the --motion-* tokens in app.css:
// press for a finger going down, fast for changes of state and anything leaving,
// base for anything arriving, slow only for emphasis, and pulse for one blink.
export const motion = { press: 80, fast: 150, base: 250, slow: 400, pulse: 1000 };

// One live query, as labels ask on every frame.
let query: MediaQueryList | undefined;
/** Whether the person asked for less motion: then things appear and go at once. */
export const reducedMotion = () =>
  (query ??= globalThis.matchMedia?.("(prefers-reduced-motion: reduce)"))?.matches ?? false;

/** Hides an element with its exit, then takes it out of the page. Its id passes
 * at once to whatever replaces it. */
export function leave(element: HTMLElement) {
  element.removeAttribute("id");
  element.hidden = true;
  setTimeout(() => element.remove(), motion.fast);
}
