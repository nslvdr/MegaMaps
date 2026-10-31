import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initTutorials, tutorialsMarkup } from "../src/ui/tutorials";
import { preference, setPreference } from "../src/preferences";

function setup() {
  const { window, document } = parseHTML(`<html><body>${tutorialsMarkup}</body></html>`);
  // Linkedom omits native dialog behavior.
  for (const element of document.querySelectorAll<HTMLDialogElement>("dialog"))
    Object.defineProperties(element, {
      open: { get: () => element.hasAttribute("open") },
      showModal: { value: () => element.setAttribute("open", "") },
      close: { value: () => {
        element.removeAttribute("open");
        element.dispatchEvent(new window.Event("close"));
      } },
    });
  const tour = document.querySelector<HTMLDialogElement>("#tour")!;
  const offer = document.querySelector<HTMLDialogElement>("#tour-offer")!;
  const part = (id: string) => document.querySelector<HTMLElement>(`#${id}`)!;
  return { tour, offer, part, tutorials: initTutorials(tour, offer) };
}

test("the first launch opens Getting started once; someone with maps is asked instead", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  setPreference("tour", "new");
  const first = setup();
  first.tutorials.atLaunch(false);
  assert.ok(first.tour.open);
  assert.equal(first.tour.dataset.view, "basics");
  assert.equal(preference("tour"), "seen");

  const again = setup();
  again.tutorials.atLaunch(false);
  again.tutorials.atLaunch(true);
  assert.ok(!again.tour.open && !again.offer.open, "nothing comes back on later launches");

  setPreference("tour", "new");
  const existing = setup();
  existing.tutorials.atLaunch(true);
  assert.ok(existing.offer.open && !existing.tour.open);
  existing.part("tour-offer-yes").click();
  assert.ok(!existing.offer.open);
  assert.equal(existing.tour.dataset.view, "basics");

  setPreference("tour", "new");
  const declined = setup();
  declined.tutorials.atLaunch(true);
  declined.part("tour-offer-no").click();
  assert.ok(!declined.offer.open && !declined.tour.open);
});

test("Getting started walks through the basics, then shows the tutorials before the app", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  setPreference("tour", "new");
  const { tour, part, tutorials } = setup();
  tutorials.atLaunch(false);
  const titles = [part("tour-title").textContent];
  part("tour-next").click();
  titles.push(part("tour-title").textContent);
  part("tour-next").click();
  titles.push(part("tour-title").textContent);
  assert.deepEqual(titles, ["Your maps, even underground", "Import a map", "Find your way around"]);
  assert.equal(part("tour-next").textContent, "See the tutorials");

  part("tour-next").click();
  assert.equal(tour.dataset.view, "list");
  assert.ok(part("tour-phone").hidden);
  assert.equal(part("tour-next").textContent, "Start using Mega Maps");
  part("tour-next").click();
  assert.ok(!tour.open);
});

test("a tutorial lists its steps and plays them on the map in turn", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tour, part, tutorials } = setup();
  tutorials.openList();
  assert.ok(part("tour-next").hidden, "the list opened from Settings has no start button");
  tour.querySelector<HTMLElement>('[data-guide="rotate"]')!.click();
  const screen = part("tour-screen");
  const steps = [...part("tour-steps").querySelectorAll("li")];
  assert.deepEqual(steps.map((step) => step.textContent), ["1Tap Rotation at the top", "2Choose Manual", "3Turn the map with two fingers"]);
  const sheet = screen.querySelector<HTMLElement>('[data-id="sheet"]')!;
  assert.ok(sheet.hidden);

  t.mock.timers.tick(1000);
  assert.equal(screen.dataset.show, "rotation");
  assert.ok(!sheet.hidden && sheet.dataset.panel === "rotation", "the tap opens the app's own Rotation sheet");
  t.mock.timers.tick(2200);
  t.mock.timers.tick(1000);
  assert.equal(screen.dataset.show, "rotation manual");
  assert.ok(steps[1]!.hasAttribute("aria-current"));

  // Tapping a step plays it from there.
  steps[0]!.click();
  assert.ok(steps[0]!.hasAttribute("aria-current"));
  assert.equal(screen.dataset.show, "");

  part("tour-back").click();
  assert.equal(tour.dataset.view, "list");
  assert.equal(part("tour-steps").children.length, 0);
});
