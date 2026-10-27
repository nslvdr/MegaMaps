import { preference } from "./preferences";

// Anonymous usage counts for PostHog: which features are used, never what people
// write or where they go. Events wait on the device while it's offline underground
// and go out together once there's a connection.
const KEY = "phc_AixEBtZzy3mHfyJ7fUztrqikEr5FjrTY3r3taR75KNYw";
const ENDPOINT = "https://eu.i.posthog.com/batch/";
const QUEUE = "megamaps:stats-queue", ID = "megamaps:stats-id";
/** Older events drop first, so a long trip offline can't fill storage. */
const MAX_QUEUED = 500, BATCH = 100;

type Properties = Record<string, string | number | boolean>;
interface StatEvent { event: string; uuid: string; timestamp: string; properties: Properties }

let version: string | undefined;
let sending = false;
let timer: ReturnType<typeof setTimeout> | undefined;

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
  if (version === undefined || preference("usage-stats") === "off") return;
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

/** Turning stats off forgets what's waiting and the device id. */
export function clearStats() {
  try {
    localStorage.removeItem(QUEUE);
    localStorage.removeItem(ID);
  } catch {}
}

export async function sendStats() {
  if (version === undefined || sending || !navigator.onLine) return;
  const batch = queued().slice(0, BATCH);
  if (!batch.length) return;
  sending = true;
  let done = false;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: KEY, batch }),
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
