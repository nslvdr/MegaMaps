import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initInstallPage, installMarkup, isApple, isInstalled } from "../src/ui/install-page";

const iPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const iPad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";

test("only a home screen launch counts as installed", () => {
  const view = (standalone: boolean, iosFlag?: boolean) => ({
    matchMedia: (query: string) => ({ matches: standalone && query === "(display-mode: standalone)" }) as MediaQueryList,
    navigator: { userAgent: iPhone, maxTouchPoints: 5, standalone: iosFlag },
  });
  assert.equal(isInstalled(view(false)), false);
  assert.equal(isInstalled(view(true)), true);
  assert.equal(isInstalled(view(false, true)), true);
  // iPadOS reports a Mac, but a Mac has no touch screen.
  assert.equal(isApple({ userAgent: iPad, maxTouchPoints: 5 }), true);
  assert.equal(isApple({ userAgent: iPad, maxTouchPoints: 0 }), false);
});

function setup(userAgent: string) {
  const { document } = parseHTML(`<html><body>${installMarkup}</body></html>`);
  // The backdrop's balloons are drawn by the viewer's own code.
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const page = document.querySelector<HTMLElement>("#install")!;
  const dialog = document.querySelector<HTMLDialogElement>("#install-dialog")!;
  // Linkedom omits native dialog behavior.
  Object.defineProperty(dialog, "showModal", { value: () => dialog.setAttribute("open", "") });
  const events = new EventTarget();
  initInstallPage(page, dialog, { userAgent, maxTouchPoints: 5 }, events, "maps.example");
  const part = (id: string) => dialog.querySelector<HTMLElement>(`#${id}`)!;
  const steps = () => [...dialog.querySelectorAll("#install-steps .share-row-label")].map((label) => label.firstChild!.textContent);
  return { page, dialog, events, steps, part };
}

test("Install opens Safari's Add to Home Screen steps on an iPhone, acted out step by step", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { page, dialog, steps, part } = setup(iPhone);
  assert.equal(page.hidden, false);
  page.querySelector<HTMLButtonElement>(".install-open")!.click();
  assert.ok(dialog.hasAttribute("open"));
  assert.deepEqual(steps(), ["Tap Share", "Choose Add to Home Screen", "Open Mega Maps from your home screen"]);
  assert.ok(part("install-demo").querySelector(".demo-sheet"), "the demo shows Safari's share sheet");
  assert.match(part("install-note").textContent!, /Safari and the app don’t share maps/);

  const current = () => [...dialog.querySelectorAll("#install-steps li")].findIndex((item) => item.hasAttribute("aria-current"));
  assert.equal(part("install-demo").dataset.step, "0");
  assert.equal(current(), 0);
  t.mock.timers.tick(2600);
  assert.equal(part("install-demo").dataset.step, "1");
  assert.equal(current(), 1);
  // Tapping a step jumps there.
  dialog.querySelectorAll<HTMLElement>("#install-steps li")[2]!.click();
  assert.equal(part("install-demo").dataset.step, "2");
  assert.equal(current(), 2);
  t.mock.timers.tick(2600);
  assert.equal(part("install-demo").dataset.step, "0", "the demo loops");
});

test("Chrome's install sheet replaces the manual steps until it's used", () => {
  const { events, steps, part } = setup(android);
  assert.deepEqual(steps(), ["Open the browser menu", "Choose Install app", "Open Mega Maps from your home screen"]);
  assert.ok(part("install-demo").querySelector(".demo-menu"), "the demo shows Chrome's menu");

  let prompted = 0;
  const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: async () => { prompted++; } });
  events.dispatchEvent(offer);
  assert.equal(offer.defaultPrevented, true, "Chrome's own banner stays hidden");
  assert.equal(part("install-now").hidden, false);
  assert.equal(part("install-demo").hidden, true);
  assert.deepEqual(steps(), ["Open Mega Maps from your home screen"]);

  part("install-now").click();
  assert.equal(prompted, 1);
  // Dismissed: the sheet can't open twice, so the manual steps return.
  assert.equal(part("install-now").hidden, true);
  assert.equal(steps().length, 3);

  events.dispatchEvent(new Event("appinstalled"));
  assert.deepEqual(steps(), ["Open Mega Maps from your home screen"]);
  assert.match(part("install-note").textContent!, /^Installed\. Open Mega Maps/);
});
