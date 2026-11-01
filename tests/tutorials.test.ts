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

  // The step holds still before its finger moves, so the gesture is seen from its start.
  t.mock.timers.tick(1000);
  assert.equal(screen.dataset.show, "");
  t.mock.timers.tick(600);
  assert.equal(screen.dataset.show, "rotation");
  assert.ok(!sheet.hidden && sheet.dataset.panel === "rotation", "the tap opens the app's own Rotation sheet");
  t.mock.timers.tick(2600);
  t.mock.timers.tick(1600);
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

test("starting over fades the screen to black instead of reading as one more step", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tour, part, tutorials } = setup();
  tutorials.openList();
  tour.querySelector<HTMLElement>('[data-guide="rotate"]')!.click();
  const screen = part("tour-screen");
  const steps = [...part("tour-steps").querySelectorAll("li")];
  // Three steps of 0.9 s lead and 3.2 s each.
  t.mock.timers.tick(4100);
  t.mock.timers.tick(4100);
  t.mock.timers.tick(4099);
  assert.ok(!screen.classList.contains("fading"));
  assert.ok(steps[2]!.hasAttribute("aria-current"));
  t.mock.timers.tick(1);
  assert.ok(screen.classList.contains("fading"), "the last step fades out");
  assert.ok(steps[2]!.hasAttribute("aria-current"), "and holds while it does");
  t.mock.timers.tick(400);
  assert.ok(!screen.classList.contains("fading"), "the first step fades back in");
  assert.ok(steps[0]!.hasAttribute("aria-current"));
  assert.equal(screen.dataset.show, "");
});

test("search shows what the example map's own text gives", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tour, part, tutorials } = setup();
  tutorials.openList();
  tour.querySelector<HTMLElement>('[data-guide="search"]')!.click();
  const count = part("tour-screen").querySelector<HTMLElement>('[data-id="search-count"]')!;
  const steps = [...part("tour-steps").querySelectorAll("li")];
  const shown = (index: number) => {
    steps[index]!.click();
    t.mock.timers.tick(4000);
    return count.textContent;
  };
  assert.equal(shown(0), "2 matches", "both Allée 25 labels");
  assert.equal(shown(1), "2 / 2", "the count steps to the next one");
  assert.equal(shown(2), "1 match", "the one crossing of Allée 25 and 55");
});

test("search types its query out before showing what it finds", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tour, part, tutorials } = setup();
  tutorials.openList();
  tour.querySelector<HTMLElement>('[data-guide="search"]')!.click();
  const screen = part("tour-screen");
  const field = screen.querySelector<HTMLInputElement>('[data-id="map-search"]')!;
  const count = screen.querySelector<HTMLElement>('[data-id="search-count"]')!;
  const steps = [...part("tour-steps").querySelectorAll("li")];
  // Timers set as others fire run on the next tick, so time goes by in small steps.
  const wait = (ms: number) => {
    for (let i = 0; i < ms / 10; i++) t.mock.timers.tick(10);
  };
  // The finger taps the field, then the app answers.
  wait(900 + 650 + 300);
  assert.equal(field.value, "All", "typed a letter at a time");
  assert.ok(count.hidden, "no count while typing");
  wait(500);
  assert.equal(field.value, "Allée 25");
  assert.ok(!count.hidden);

  steps[2]!.click();
  assert.equal(field.value, "Allée 25", "the pair goes on from the first name");
  wait(900 + 650 + 80);
  assert.equal(field.value, "Allée 25;");
  assert.ok(count.hidden);
  wait(800);
  assert.equal(field.value, "Allée 25; Allée 55");
  assert.equal(count.textContent, "1 match");
});
