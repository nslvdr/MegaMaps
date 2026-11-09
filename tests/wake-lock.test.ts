import "./dom";
import test from "node:test";
import assert from "node:assert/strict";
import { keepScreenOn, screenWanted } from "../src/ui/wake-lock";

test("Keep screen on asks during trips, with any map open, or never", () => {
  assert.equal(screenWanted("trip", false), false);
  assert.equal(screenWanted("trip", true), true);
  assert.equal(screenWanted("map", false), true);
  assert.equal(screenWanted("never", true), false);
});

test("the screen lock is taken again when the page comes back, and let go when no longer wanted", async (t) => {
  const locks: { released: boolean; release(): Promise<void> }[] = [];
  const wakeLock = { request: async () => {
    const lock = { released: false, release: async () => { lock.released = true; } };
    locks.push(lock);
    return lock;
  } };
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: wakeLock });
  t.after(() => delete (navigator as { wakeLock?: unknown }).wakeLock);
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  keepScreenOn(true);
  await settle();
  assert.equal(locks.length, 1);
  keepScreenOn(true);
  await settle();
  assert.equal(locks.length, 1, "asking again keeps the same lock");
  // The browser lets go while the page hides; coming back takes it again.
  locks[0]!.released = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(locks.length, 2);
  keepScreenOn(false);
  assert.ok(locks[1]!.released);
  document.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(locks.length, 2, "an unwanted lock isn't taken back");
});
