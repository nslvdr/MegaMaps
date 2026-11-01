import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import type { Release } from "../src/changelog";
import { initWhatsNew, unseenReleases, whatsNewMarkup } from "../src/ui/whats-new";

const releases: Release[] = [
  { date: "2026-11-20", commit: "ccc", fixed: ["Map previews in the main menu are square."] },
  { date: "2026-11-10", commit: "bbb", added: ["A “Need help?” box above the bottom bar."], changed: ["Map size limit: 300 → 600 megapixels."] },
  { date: "2026-11-01", commit: "aaa", added: ["An example map, Val Moulin, to try the app without importing anything."] },
];

function setup() {
  localStorage.removeItem("megamaps:changelog-seen");
  const { document } = parseHTML(whatsNewMarkup);
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  // Linkedom omits native dialog behavior.
  Object.defineProperty(dialog, "showModal", { value: () => dialog.setAttribute("open", "") });
  const whatsNew = initWhatsNew(dialog, releases);
  const sections = () => [...dialog.querySelectorAll("section")].map((section) => [
    section.querySelector("h3")!.textContent,
    [...section.querySelectorAll("li")].map((item) => item.textContent),
  ]);
  return { dialog, whatsNew, sections };
}

test("a device sees the releases since the one it last showed", () => {
  assert.deepEqual(unseenReleases(releases, "aaa", true).map((release) => release.commit), ["ccc", "bbb"]);
  assert.deepEqual(unseenReleases(releases, "ccc", true), []);
  assert.deepEqual(unseenReleases(releases, null, false), [], "a new device has nothing new to see");
  assert.deepEqual(unseenReleases(releases, null, true).map((release) => release.commit), ["ccc"],
    "a device with maps updated from before the changelog");
});

test("everything new shows once, new features first, without empty sections", () => {
  const { dialog, whatsNew, sections } = setup();
  localStorage.setItem("megamaps:changelog-seen", "aaa");
  whatsNew.atLaunch(true);
  assert.ok(dialog.hasAttribute("open"));
  assert.deepEqual(sections(), [
    ["New features", ["A “Need help?” box above the bottom bar."]],
    ["Changes", ["Map size limit: 300 → 600 megapixels."]],
    ["Bug fixes", ["Map previews in the main menu are square."]],
  ]);
  dialog.removeAttribute("open");
  whatsNew.atLaunch(true);
  assert.ok(!dialog.hasAttribute("open"), "the next launch has nothing new");
});

test("a launch busy with another dialog keeps what's new for the next one", () => {
  const { dialog, whatsNew, sections } = setup();
  localStorage.setItem("megamaps:changelog-seen", "bbb");
  whatsNew.atLaunch(true, false);
  assert.ok(!dialog.hasAttribute("open"));
  whatsNew.atLaunch(true);
  assert.deepEqual(sections(), [["Bug fixes", ["Map previews in the main menu are square."]]]);
});
