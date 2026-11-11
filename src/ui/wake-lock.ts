import type { Preferences } from "../preferences";

// Keeps the screen on while a map wants it. The browser drops the lock whenever
// the page hides, so it's taken again each time the page comes back.

let wanted = false, listening = false;
let lock: WakeLockSentinel | undefined, taking: Promise<void> | undefined;

/** Whether Keep screen on asks for the screen now. */
export const screenWanted = (setting: Preferences["screen-awake"], tripRunning: boolean) =>
  setting === "map" || (setting === "trip" && tripRunning);

async function take() {
  if (!wanted || document.hidden || !("wakeLock" in navigator) || (lock && !lock.released)) return;
  try {
    const taken = await navigator.wakeLock.request("screen");
    if (wanted) lock = taken;
    else void taken.release().catch(() => {});
  } catch {
    // Refused, such as on low battery: the screen locks as usual.
  }
}

/** Asks for the screen to stay on, or lets it lock again; repeated calls are cheap. */
export function keepScreenOn(on: boolean) {
  if (on === wanted) return;
  wanted = on;
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", () => { if (wanted && !document.hidden) taking ??= take().finally(() => (taking = undefined)); });
  }
  if (on) taking ??= take().finally(() => (taking = undefined));
  else {
    void lock?.release().catch(() => {});
    lock = undefined;
  }
}
