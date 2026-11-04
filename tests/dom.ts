// A browser page for component tests: happy-dom's window as the global one,
// and helpers that act as a finger would, then let Svelte update the page.
import { Window } from "happy-dom";
import { flushSync, mount, unmount, type Component, type ComponentProps } from "svelte";

const window = new Window({ url: "https://megamaps.test/" });
const globals = globalThis as unknown as Record<string, unknown>;
for (const key of Object.getOwnPropertyNames(window))
  if (!(key in globalThis) && /^[A-Z]|^(document|getComputedStyle|requestAnimationFrame|cancelAnimationFrame|matchMedia|visualViewport|location)$/.test(key))
    Object.defineProperty(globalThis, key, { value: (window as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
for (const key of ["window", "document", "Event", "CustomEvent", "KeyboardEvent", "PointerEvent", "MouseEvent"])
  Object.defineProperty(globalThis, key, { value: key === "window" ? window : (window as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
globals.self = window;
// Text fields' select() and scrolling aren't laid out here.
window.HTMLInputElement.prototype.select = function () {};
window.HTMLElement.prototype.scrollTo = function () {};

export { window, flushSync };
export const document = window.document as unknown as Document;

/** Mounts a component in a fresh body; `destroy` takes it away again, once. */
export function render<C extends Component<any, any>>(component: C, props: ComponentProps<C>) {
  const target = document.createElement("div");
  document.body.replaceChildren(target);
  const instance = mount(component, { target, props });
  flushSync();
  let mounted = true;
  return { instance, target, destroy: () => mounted && (mounted = false, unmount(instance)) };
}

export const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector.startsWith("#") || /[.[\s>]/.test(selector) ? selector : `#${selector}`)!;

/** Dispatches a bubbling event and lets the page update. */
export function fire(target: EventTarget | string, type: string, init: Record<string, unknown> = {}) {
  const element = typeof target === "string" ? $(target) : target;
  const event = new window.Event(type, { bubbles: true, cancelable: true }) as unknown as Event;
  for (const [key, value] of Object.entries(init)) Object.defineProperty(event, key, { value });
  const result = element.dispatchEvent(event);
  flushSync();
  return result;
}
export const click = (target: EventTarget | string) => fire(target, "click");
/** Types into a field: its value changes, then `input` fires. */
export function type(target: HTMLInputElement | HTMLTextAreaElement | string, value: string) {
  const field = typeof target === "string" ? $<HTMLInputElement>(target) : target;
  field.value = value;
  return fire(field, "input");
}
/** Picks a checkbox, radio or option: it changes, then `change` fires. */
export function pick(target: HTMLInputElement | HTMLSelectElement | string, value: boolean | string = true) {
  const field = typeof target === "string" ? $<HTMLInputElement>(target) : target;
  if (typeof value === "boolean") (field as HTMLInputElement).checked = value;
  else field.value = value;
  fire(field, "input");
  return fire(field, "change");
}
export const submit = (target: HTMLFormElement | string) => fire(target, "submit");
/** A close request, as Back or Escape sends; false when the dialog refused it. */
export const cancel = (dialog: HTMLDialogElement | string) => {
  const element = typeof dialog === "string" ? $<HTMLDialogElement>(dialog) : dialog;
  const event = new window.Event("cancel", { cancelable: true }) as unknown as Event;
  const allowed = element.dispatchEvent(event);
  flushSync();
  return allowed;
};
/** Waits for promises already under way, then lets the page update. */
export const settle = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  flushSync();
};
