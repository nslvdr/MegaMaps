import test from "node:test";
import assert from "node:assert/strict";
import { $, click, fire, flushSync, render, type } from "./dom";
import type { Release } from "../src/changelog";
import WhatsNew, { unseenReleases } from "../src/ui/WhatsNew.svelte";

const releases: Release[] = [
  { date: "2026-11-20", commit: "ccc", fixed: ["The page behind a dialog no longer scrolls."] },
  { date: "2026-11-10", commit: "bbb", added: ["Search finds words in any order."], changed: ["Map size limit: 300 → 600 megapixels."] },
  { date: "2026-11-01", commit: "aaa", added: ["Settings has a What’s new row with the changes in every version."] },
];

function setup() {
  localStorage.removeItem("megamaps:changelog-seen");
  const { instance: whatsNew } = render(WhatsNew, { releases });
  const dialog = $<HTMLDialogElement>("whats-new");
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
    ["New features", ["Search finds words in any order."]],
    ["Changes", ["Map size limit: 300 → 600 megapixels."]],
    ["Bug fixes", ["The page behind a dialog no longer scrolls."]],
  ]);
  dialog.close();
  whatsNew.atLaunch(true);
  assert.ok(!dialog.hasAttribute("open"), "the next launch has nothing new");
});

test("a launch busy with another dialog keeps what's new for the next one", () => {
  const { dialog, whatsNew, sections } = setup();
  localStorage.setItem("megamaps:changelog-seen", "bbb");
  whatsNew.atLaunch(true, false);
  assert.ok(!dialog.hasAttribute("open"));
  whatsNew.atLaunch(true);
  assert.deepEqual(sections(), [["Bug fixes", ["The page behind a dialog no longer scrolls."]]]);
});

test("Settings shows every release under its date and leaves the launch's marker alone", () => {
  const { dialog, whatsNew } = setup();
  localStorage.setItem("megamaps:changelog-seen", "bbb");
  whatsNew.openAll();
  assert.ok(dialog.hasAttribute("open"));
  assert.deepEqual([...dialog.querySelectorAll("article")].map((release) => [
    release.querySelector("p")!.textContent,
    [...release.querySelectorAll("h3")].map((heading) => heading.textContent),
  ]), [
    ["November 20, 2026", ["Bug fixes"]],
    ["November 10, 2026", ["New features", "Changes"]],
    ["November 1, 2026", ["New features"]],
  ]);
  assert.equal(localStorage.getItem("megamaps:changelog-seen"), "bbb");
});

test("a drawn scroll indicator shows while there is more to read and follows the scroll", () => {
  const { whatsNew } = setup();
  const body = $("whats-new-sections");
  const scroll = body.nextElementSibling as HTMLElement;
  // The test page has no layout.
  let scrollHeight = 400;
  Object.defineProperty(body, "clientHeight", { value: 400 });
  Object.defineProperty(body, "scrollHeight", { get: () => scrollHeight });
  Object.defineProperty(scroll, "clientHeight", { value: 400 });

  whatsNew.openAll();
  flushSync();
  assert.ok(scroll.hidden, "everything fits");

  scrollHeight = 1600;
  whatsNew.openAll();
  flushSync();
  assert.ok(!scroll.hidden);
  const thumb = scroll.querySelector("span")!;
  assert.equal(thumb.style.height, "100px");
  body.scrollTop = 1200;
  fire(body, "scroll");
  assert.equal(thumb.style.transform, "translateY(300px)");
});

test("a release that asks follows Got it with its question, and sends the answer", () => {
  localStorage.setItem("megamaps:changelog-seen", "aaa");
  const asking: Release[] = [releases[0]!, { ...releases[1]!, ask: true }, releases[2]!];
  const { instance: whatsNew } = render(WhatsNew, { releases: asking });
  const dialog = $<HTMLDialogElement>("whats-new");
  const answers: [string, string][] = [];
  whatsNew.atLaunch(true, true, (text: string, release: string) => answers.push([text, release]));
  assert.ok(!$("whats-new-answer"));

  click("whats-new-done");
  assert.ok(dialog.hasAttribute("open"), "Got it leads to the question");
  assert.ok($<HTMLButtonElement>("whats-new-send").disabled, "nothing to send yet");
  type("whats-new-answer", "  Water levels on routes  ");
  click("whats-new-send");
  assert.deepEqual(answers, [["Water levels on routes", "bbb"]]);
  assert.ok(!dialog.hasAttribute("open"));

  whatsNew.openAll();
  click("whats-new-done");
  assert.ok(!dialog.hasAttribute("open"), "Settings never asks");
});

test("without somewhere to send the answer, Got it just closes", () => {
  localStorage.setItem("megamaps:changelog-seen", "bbb");
  const { instance: whatsNew } = render(WhatsNew, { releases: [{ ...releases[0]!, ask: true }, ...releases.slice(1)] });
  whatsNew.atLaunch(true);
  click("whats-new-done");
  assert.ok(!$<HTMLDialogElement>("whats-new").hasAttribute("open"));
});
