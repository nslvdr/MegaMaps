import test from "node:test";
import assert from "node:assert/strict";
import { $, click, flushSync, render, window } from "./dom";
import InstallPage, { isApple, isInstalled } from "../src/ui/InstallPage.svelte";

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

function setup(t: test.TestContext, userAgent: string) {
  const events = new window.EventTarget() as unknown as EventTarget;
  const { destroy } = render(InstallPage, { browser: { userAgent, maxTouchPoints: 5 }, events, host: "maps.example" });
  t.after(destroy);
  const items = () => [...$("install-steps").children];
  // Each step's label, without the hint under it.
  const steps = () => items().map((item) => item.children[1]!.firstChild!.textContent);
  const current = () => items().findIndex((item) => item.hasAttribute("aria-current"));
  return { dialog: $<HTMLDialogElement>("install-dialog"), events, steps, items, current };
}

test("Install opens Safari's Add to Home Screen steps on an iPhone, acted out step by step", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { dialog, steps, items, current } = setup(t, iPhone);
  click("install-open");
  assert.ok(dialog.open);
  assert.deepEqual(steps(), ["Tap Share", "Choose Add to Home Screen", "Open Mega Maps from your home screen"]);
  assert.match($("install-demo").textContent!, /Add to Home Screen/, "the demo shows Safari's share sheet");
  assert.match($("install-note").textContent!, /Safari and the app don’t share maps/);

  assert.equal($("install-demo").dataset.step, "0");
  assert.equal(current(), 0);
  t.mock.timers.tick(2600);
  flushSync();
  assert.equal($("install-demo").dataset.step, "1");
  assert.equal(current(), 1);
  // Tapping a step jumps there.
  click(items()[2]!);
  assert.equal($("install-demo").dataset.step, "2");
  assert.equal(current(), 2);
  t.mock.timers.tick(2600);
  flushSync();
  assert.equal($("install-demo").dataset.step, "0", "the demo loops");
});

test("Chrome's install sheet replaces the manual steps until it's used", (t) => {
  const { events, steps } = setup(t, android);
  assert.deepEqual(steps(), ["Open the browser menu", "Choose Install app", "Open Mega Maps from your home screen"]);
  assert.match($("install-demo").textContent!, /Install app/, "the demo shows Chrome's menu");

  let prompted = 0;
  const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: async () => { prompted++; } });
  events.dispatchEvent(offer);
  flushSync();
  assert.equal(offer.defaultPrevented, true, "Chrome's own banner stays hidden");
  assert.equal($("install-now").hidden, false);
  assert.equal($("install-demo").hidden, true);
  assert.deepEqual(steps(), ["Open Mega Maps from your home screen"]);

  click("install-now");
  assert.equal(prompted, 1);
  // Dismissed: the sheet can't open twice, so the manual steps return.
  assert.equal($("install-now").hidden, true);
  assert.equal(steps().length, 3);

  events.dispatchEvent(new Event("appinstalled"));
  flushSync();
  assert.deepEqual(steps(), ["Open Mega Maps from your home screen"]);
  assert.match($("install-note").textContent!, /^Installed\. Open Mega Maps/);
});
