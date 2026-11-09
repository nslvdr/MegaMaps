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
const MAX_QUEUED = 500, BATCH = 50;
/** Browsers refuse a keepalive request over 64 KB, and the device and person
 * properties added on the way out roughly double each event, so a batch's
 * events stay well under half of that. */
const BATCH_BYTES = 24 * 1024;
/** Away this long, coming back starts a new session. */
const SESSION_GAP = 30 * 60_000;
/** A crash in a loop would otherwise fill the queue. */
const MAX_ERRORS = 10;

type Value = string | number | boolean | Value[] | { [key: string]: Value };
export type Properties = Record<string, Value>;
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
/** What a session did so far, kept with it so the summary survives the app being closed. */
export interface Session {
  id: string;
  /** When the app was hidden, while it is away. */
  hidden?: number;
  /** When the app came on screen, while it is on screen. */
  shown?: number;
  /** Time on screen before the app was last hidden, in ms. */
  visible?: number;
  /** Counts by event name, plus a few the summary needs; missing on sessions from older versions. */
  tally?: Record<string, number>;
}
let session: Session | undefined;
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
  if (fresh && session?.tally) endSession(session, now);
  session = fresh ? { id: uuidv7(), shown: now, visible: 0, tally: {} } : { ...session!, hidden: undefined, shown: now };
  keepSession();
  return fresh;
}
function hideSession(now: number) {
  const { shown, visible = 0 } = session!;
  session = { ...session!, shown: undefined, hidden: now, visible: visible + (shown === undefined ? 0 : now - shown) };
  keepSession();
}

/** Adds an event to the session's tally. */
function count(tally: Record<string, number>, event: string, properties: Properties) {
  const add = (key: string, amount = 1) => void (tally[key] = (tally[key] ?? 0) + amount);
  add("events");
  if (!navigator.onLine) add("offline");
  add(event);
  if (event === "map_viewed") {
    add(properties.example ? "example_seconds" : "own_map_seconds", Number(properties.seconds) || 0);
    add("trail_marked", Number(properties.trail_marked) || 0);
  }
}

/** One use of the app in one row, so usage reads without stitching events together. */
export function summarize({ visible = 0, tally = {} }: Session): Properties {
  const n = (key: string) => tally[key] ?? 0;
  const offline = n("events") ? n("offline") / n("events") : 0;
  const edits = n("place_added") + n("place_edited") + n("place_moved") + n("place_deleted") + n("route_saved");
  return {
    seconds: Math.round(visible / 1000),
    // Marking the trail only happens in the field, and underground the phone is offline.
    context: n("trail_marked") || n("trip_ended") || offline >= 0.5 ? "on_site" : "at_home",
    // A minute on one of their own maps, beyond trying the example.
    real_use: n("own_map_seconds") >= 60,
    own_map_seconds: n("own_map_seconds"), example_seconds: n("example_seconds"),
    places_opened: n("place_opened"), places_added: n("place_added"), edits,
    trail_marked: n("trail_marked"), trips_ended: n("trip_ended"), searches: n("search_used"),
    offline_share: Math.round(offline * 100) / 100,
  };
}
/** Sent once the session is over, which is only known when the app comes back to it,
 *  so it carries the time it really ended. */
function endSession(ended: Session, now: number) {
  enqueue("session_ended", summarize(ended), ended.hidden ?? now, ended.id);
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
      hideSession(Date.now());
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
  if (session?.tally) {
    count(session.tally, event, properties);
    keepSession();
  }
  if (!enqueue(event, properties, Date.now(), session?.id)) return;
  clearTimeout(timer);
  // A hidden app may be suspended before a timer fires.
  if (document.hidden) void sendStats();
  else timer = setTimeout(() => void sendStats(), 5000);
}

/** Queues an event; false when storage refuses it. */
function enqueue(event: string, properties: Properties, time: number, sessionId?: string) {
  try {
    // Online is read now, not when sent, to tell use underground from use above it.
    const entry = { event, uuid: crypto.randomUUID(), timestamp: new Date(time).toISOString(),
      properties: { ...properties, distinct_id: deviceId(), app_version: version!, online: navigator.onLine,
        ...(sessionId ? { $session_id: sessionId } : {}) } };
    save([...queued(), entry].slice(-MAX_QUEUED));
    return true;
  } catch {
    return false; // Storage may be full or blocked; stats never get in the way.
  }
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
  const waiting = queued(), batch: StatEvent[] = [];
  let bytes = 0;
  for (const entry of waiting.slice(0, BATCH)) {
    bytes += JSON.stringify(entry).length;
    if (batch.length && bytes > BATCH_BYTES) break;
    batch.push(entry);
  }
  if (!batch.length) return;
  sending = sendBatch(batch).finally(() => { sending = undefined; });
  if (await sending && batch.length < waiting.length) await sendStats();
}
