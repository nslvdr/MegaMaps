/** Talks to a position app on this phone, such as sPDR. A web app can't listen for
 * connections, so the other app runs a tiny server on the phone's loopback address
 * and this asks it for news each second. Anything can answer on that port, so its
 * replies are checked like any file. Once on, it keeps trying until turned off: a
 * link that drops underground comes back by itself, keeping the last known position. */
export const LINK_URL = "http://127.0.0.1:47823/v1";
/** Opens sPDR from a tap, for when it isn't running and so can't answer. */
export const OPEN_SPDR_URL = "intent://open#Intent;scheme=spdr;package=org.spdr.companion;end";
const POLL_MS = 1000;
const TIMEOUT_MS = 3000;
/** The other app rebuilds its whole graph before answering. */
const GRAPH_TIMEOUT_MS = 120_000;

export interface LinkPosition {
  lat: number;
  lon: number;
  /** Metres. */
  accuracy: number;
  /** Which way the app says the user is going, in degrees clockwise from north. */
  heading?: number;
  /** The app's own belief in this position, from 0 to 1. */
  confidence?: number;
  /** The app is unsure where the user is and is searching. */
  relocalising: boolean;
}
export interface LinkState {
  app: string;
  running: boolean;
  /** Whether the app has lines to follow; without them it has no position to give. */
  hasGraph: boolean;
  steps: number;
  position?: LinkPosition;
}
export type LinkStatus = "off" | "waiting" | "connected";
/** Why a request was refused, in the other app's words: `open-app`, `no-graph`, `not-near`. */
export class LinkRefused extends Error {}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function readPosition(value: unknown): LinkPosition | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { lat, lon, accuracy, heading, confidence, relocalising } = value as Record<string, unknown>;
  if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return {
    lat, lon,
    accuracy: finite(accuracy) && accuracy >= 0 ? accuracy : 0,
    ...(finite(heading) ? { heading } : {}),
    ...(finite(confidence) ? { confidence } : {}),
    relocalising: relocalising === true,
  };
}
export function readLinkState(value: unknown): LinkState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { app, running, hasGraph, steps, position } = value as Record<string, unknown>;
  if (typeof app !== "string" || typeof running !== "boolean") return undefined;
  const at = readPosition(position);
  return { app: app.slice(0, 50), running, hasGraph: hasGraph === true, steps: finite(steps) ? steps : 0, ...(at ? { position: at } : {}) };
}

/** Android only: iOS blocks a page from reaching the phone's own address, and suspends other apps anyway. */
export const canLink = ({ userAgent, maxTouchPoints }: Pick<Navigator, "userAgent" | "maxTouchPoints">) =>
  !/iPad|iPhone|iPod/.test(userAgent) && !(/Macintosh/.test(userAgent) && maxTouchPoints > 1);

export class PositionLink {
  status: LinkStatus = "off";
  /** The last news; kept while waiting, since a stale position beats none. */
  state?: LinkState;
  private timer?: ReturnType<typeof setTimeout>;
  private run = 0;
  constructor(private changed: () => void, private request: typeof fetch = (...args) => fetch(...args)) {}

  connect() {
    if (this.status !== "off") return;
    this.status = "waiting";
    this.changed();
    void this.poll(++this.run);
  }
  disconnect() {
    this.run++;
    clearTimeout(this.timer);
    this.status = "off";
    this.state = undefined;
    this.changed();
  }
  private async poll(run: number) {
    let state: LinkState | undefined;
    try {
      const response = await this.request(`${LINK_URL}/state`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
      if (response.ok) state = readLinkState(await response.json());
    } catch { /* Not there at the moment: waiting says so, and the next try may reach it. */ }
    if (run !== this.run) return;
    this.status = state ? "connected" : "waiting";
    if (state) this.state = state;
    this.changed();
    this.timer = setTimeout(() => void this.poll(run), POLL_MS);
  }
  private async post(path: string, body?: unknown, timeout = TIMEOUT_MS) {
    const response = await this.request(`${LINK_URL}/${path}`, {
      method: "POST", signal: AbortSignal.timeout(timeout),
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (response.ok) return response;
    const { error } = await response.json().catch(() => ({ error: undefined })) as { error?: unknown };
    throw new LinkRefused(typeof error === "string" ? error : String(response.status));
  }
  async start() { await this.post("start"); }
  async stop() { await this.post("stop"); }
  /** Tells the other app where the user really is. */
  async sendPosition(lat: number, lon: number, accuracy: number) { await this.post("position", { lat, lon, accuracy }); }
  /** Gives the other app these lines to follow, in place of those sent before. Resolves to their length in metres, when it says. */
  async sendLines(geoJson: unknown) {
    const { metres } = await (await this.post("graph", geoJson, GRAPH_TIMEOUT_MS)).json().catch(() => ({})) as { metres?: unknown };
    return finite(metres) ? metres : undefined;
  }
}
