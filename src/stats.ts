import { loadSetting } from "./storage/settings";

// Usage counts for PostHog: which features are used, on what device and by which
// nickname, never what people write or where they go. Events wait on the device while
// it's offline underground and go out together once there's a connection.
const KEY = "phc_AixEBtZzy3mHfyJ7fUztrqikEr5FjrTY3r3taR75KNYw";
const ENDPOINT = "https://eu.i.posthog.com/batch/";
const QUEUE = "megamaps:stats-queue", ID = "megamaps:stats-id";
/** Older events drop first, so a long trip offline can't fill storage. */
const MAX_QUEUED = 500, BATCH = 100;

type Properties = Record<string, string | number | boolean>;
interface StatEvent { event: string; uuid: string; timestamp: string; properties: Properties }

interface UserAgentData {
  platform: string;
  brands: { brand: string }[];
  getHighEntropyValues(hints: string[]): Promise<{ model?: string; platformVersion?: string }>;
}

let version: string | undefined;
let sending = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let device: Promise<Properties> | undefined;

/** PostHog's own property names, so its device and browser breakdowns pick them up. */
async function describeDevice(): Promise<Properties> {
  const agent = navigator.userAgent;
  const ipad = /iPad/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
  const ios = ipad || /iPhone|iPod/.test(agent);
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  // Chrome on Android hides the model from the user agent but gives it when asked.
  const details = await data?.getHighEntropyValues(["model", "platformVersion"]).catch(() => undefined);
  const os = ios ? "iOS" : data?.platform || (/Android/.test(agent) ? "Android"
    : /Windows/.test(agent) ? "Windows" : /Mac OS/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "Other");
  const osVersion = details?.platformVersion
    || agent.match(/OS (\d+)_(\d+)/)?.slice(1).join(".") || agent.match(/Android ([\d.]+)/)?.[1];
  const model = ios ? (ipad ? "iPad" : "iPhone")
    : details?.model || agent.match(/Android [\d.]+; ([^;)]+)\)/)?.[1]?.replace(/ Build.*/, "");
  const browser = /SamsungBrowser/.test(agent) ? "Samsung Internet" : /Firefox|FxiOS/.test(agent) ? "Firefox"
    : /EdgA?\//.test(agent) ? "Edge" : /Chrome|CriOS/.test(agent) ? "Chrome" : /Safari/.test(agent) ? "Safari" : "Other";
  return {
    $os: os, ...(osVersion ? { $os_version: osVersion } : {}),
    // Reduced Android user agents only say "K" for the model.
    ...(model && model !== "K" ? { $device_model: model } : {}),
    $device_type: ipad || (/Android/.test(agent) && !/Mobile/.test(agent)) ? "Tablet"
      : ios || /Android|Mobile/.test(agent) ? "Mobile" : "Desktop",
    $browser: browser, $browser_language: navigator.language,
    $screen_width: screen.width, $screen_height: screen.height,
  };
}

/** The nickname from Settings names the person in PostHog, and clearing it removes it there. */
async function person() {
  const name = (await loadSetting("share-name").catch(() => undefined))?.trim();
  return name ? { $set: { name } } : { $unset: ["name"] };
}

function queued(): StatEvent[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE) ?? "[]");
  } catch {
    return [];
  }
}
function save(events: StatEvent[]) {
  if (events.length) localStorage.setItem(QUEUE, JSON.stringify(events));
  else localStorage.removeItem(QUEUE);
}
/** A random id per device, so returning visits count as one person. */
function deviceId() {
  let id = localStorage.getItem(ID);
  if (!id) localStorage.setItem(ID, id = crypto.randomUUID());
  return id;
}

/** Only the released app counts; tests and the dev server never start it. */
export function startStats(appVersion: string) {
  version = appVersion;
  addEventListener("online", () => void sendStats());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void sendStats();
  });
  void sendStats();
}

export function track(event: string, properties: Properties = {}) {
  if (version === undefined) return;
  try {
    const entry = { event, uuid: crypto.randomUUID(), timestamp: new Date().toISOString(),
      properties: { ...properties, distinct_id: deviceId(), app_version: version } };
    save([...queued(), entry].slice(-MAX_QUEUED));
  } catch {
    return; // Storage may be full or blocked; stats never get in the way.
  }
  clearTimeout(timer);
  timer = setTimeout(() => void sendStats(), 5000);
}

export async function sendStats() {
  if (version === undefined || sending || !navigator.onLine) return;
  const batch = queued().slice(0, BATCH);
  if (!batch.length) return;
  sending = true;
  let done = false;
  try {
    // Added on the way out, so waiting events always go with the current nickname.
    const extra = { ...await (device ??= describeDevice()), ...await person() };
    const response = await fetch(ENDPOINT, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: KEY,
        batch: batch.map((entry) => ({ ...entry, properties: { ...entry.properties, ...extra } })) }),
    });
    // A rejected batch would fail forever; only a busy or unreachable server is retried.
    done = response.ok || (response.status < 500 && response.status !== 429);
    if (done) {
      const sent = new Set(batch.map((entry) => entry.uuid));
      save(queued().filter((entry) => !sent.has(entry.uuid)));
    }
  } catch {
    // Offline after all: they go with the next batch.
  } finally {
    sending = false;
  }
  if (done && batch.length === BATCH) await sendStats();
}
