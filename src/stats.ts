import { loadSetting } from "./storage/settings";

// Usage counts for PostHog: which features are used, on what device and by which
// nickname, never what people write or where they go. Only the installed app counts.
// Events wait on the device while it's offline underground and go out together once
// there's a connection.
const KEY = "phc_AixEBtZzy3mHfyJ7fUztrqikEr5FjrTY3r3taR75KNYw";
const ENDPOINT = "https://eu.i.posthog.com/batch/";
const QUEUE = "megamaps:stats-queue", ID = "megamaps:stats-id";
const SESSION = "megamaps:stats-session", VERSION = "megamaps:stats-version";
/** Older events drop first, so a long trip offline can't fill storage. */
const MAX_QUEUED = 500, BATCH = 100;
/** Away this long, coming back starts a new session. */
const SESSION_GAP = 30 * 60_000;
/** A crash in a loop would otherwise fill the queue. */
const MAX_ERRORS = 10;

type Value = string | number | boolean | Value[] | { [key: string]: Value };
type Properties = Record<string, Value>;
interface StatEvent { event: string; uuid: string; timestamp: string; properties: Properties }

interface UserAgentData {
  platform: string;
  brands: { brand: string }[];
  getHighEntropyValues(hints: string[]): Promise<{ model?: string; platformVersion?: string }>;
}

let version: string | undefined;
let sending: Promise<boolean> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let device: Promise<Properties> | undefined;
/** Person properties the app knows, such as how many maps it holds. */
let traits: Properties = {};
let session: { id: string; hidden?: number } | undefined;
let errors = 0;

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
  return name ? { $set: { ...traits, name } } : { $set: traits, $unset: ["name"] };
}
/** Sets person properties on the events sent from now on, for cohorts like "3 maps or more". */
export function setPerson(properties: Properties) {
  traits = { ...traits, ...properties };
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

/** PostHog reads a session's start time from its UUIDv7 id. */
function uuidv7() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 5, time = Date.now(); i >= 0; i--, time = Math.floor(time / 256)) bytes[i] = time % 256;
  bytes[6] = bytes[6]! & 0x0f | 0x70;
  bytes[8] = bytes[8]! & 0x3f | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function keepSession() {
  try {
    localStorage.setItem(SESSION, JSON.stringify(session));
  } catch {} // Without storage, the next launch starts a new session.
}
/** A session lasts until the app has been away for half an hour. Reading a map for an hour
 *  sends nothing, so only time away ends it, not time since the last event. */
function resumeSession(now: number) {
  const away = session?.hidden === undefined ? 0 : now - session.hidden;
  const fresh = !session || away > SESSION_GAP;
  session = fresh ? { id: uuidv7() } : { id: session!.id };
  keepSession();
  return fresh;
}

/** Only the released, installed app counts; tests, the dev server and browser tabs never start it. */
export function startStats(appVersion: string) {
  version = appVersion;
  let firstLaunch = false, updatedFrom: string | null = null;
  try {
    firstLaunch = localStorage.getItem(ID) === null;
    updatedFrom = localStorage.getItem(VERSION);
    localStorage.setItem(VERSION, appVersion);
    session = JSON.parse(localStorage.getItem(SESSION) ?? "null") ?? undefined;
  } catch {}
  resumeSession(Date.now());
  // The first launch on a device is the install: the app never counts a browser tab.
  if (firstLaunch) track("app_installed");
  else if (updatedFrom && updatedFrom !== appVersion) track("app_updated", { from: updatedFrom });
  addEventListener("online", () => void sendStats());
  addEventListener("error", (event) => reportError(event.error ?? event.message));
  addEventListener("unhandledrejection", (event) => reportError(event.reason));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      session = { id: session!.id, hidden: Date.now() };
      keepSession();
      void sendStats();
    } else if (resumeSession(Date.now())) track("app_resumed");
  });
  void sendStats();
}

/** Crashes, for PostHog's error tracking: the device and version come with every event. */
function reportError(error: unknown) {
  if (errors++ >= MAX_ERRORS) return;
  const type = error instanceof Error ? error.name : "Error";
  const value = (error instanceof Error ? error.message : String(error)).slice(0, 200);
  const stack = error instanceof Error && error.stack ? error.stack.split("\n").slice(0, 8).join("\n").slice(0, 1000) : "";
  track("$exception", {
    $exception_list: [{ type, value, mechanism: { handled: false, synthetic: false } }],
    ...(stack ? { stack } : {}),
  });
}

/** Why an import failed, as the browser or app put it, so device-specific bugs show up. */
export function failure(error: unknown) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 200);
}

export function track(event: string, properties: Properties = {}) {
  if (version === undefined) return;
  try {
    // Online is read now, not when sent, to tell use underground from use above it.
    const entry = { event, uuid: crypto.randomUUID(), timestamp: new Date().toISOString(),
      properties: { ...properties, distinct_id: deviceId(), app_version: version, online: navigator.onLine,
        ...(session ? { $session_id: session.id } : {}) } };
    save([...queued(), entry].slice(-MAX_QUEUED));
  } catch {
    return; // Storage may be full or blocked; stats never get in the way.
  }
  clearTimeout(timer);
  // A hidden app may be suspended before a timer fires.
  if (document.hidden) void sendStats();
  else timer = setTimeout(() => void sendStats(), 5000);
}

/** Sends one batch; true once the server has taken it or refused it for good. */
async function sendBatch(batch: StatEvent[]) {
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
    const done = response.ok || (response.status < 500 && response.status !== 429);
    if (done) {
      const sent = new Set(batch.map((entry) => entry.uuid));
      save(queued().filter((entry) => !sent.has(entry.uuid)));
    }
    return done;
  } catch {
    return false; // Offline after all: they go with the next batch.
  }
}

export async function sendStats(): Promise<void> {
  if (version === undefined || !navigator.onLine) return;
  // Events queued while a batch is on its way go once it lands.
  if (sending) {
    await sending;
    return sendStats();
  }
  const batch = queued().slice(0, BATCH);
  if (!batch.length) return;
  sending = sendBatch(batch).finally(() => { sending = undefined; });
  if (await sending && batch.length === BATCH) await sendStats();
}
