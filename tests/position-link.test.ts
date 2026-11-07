import test from "node:test";
import assert from "node:assert/strict";
import { canLink, LINK_URL, LinkRefused, PositionLink, readLinkState } from "../src/link/position-link";
import { worldToScreen } from "../src/viewer/camera";
import { aheadOf, invert, toMercator, type Geo } from "../src/viewer/geo";
import { directionPath } from "../src/viewer/overlays";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const running = { app: "sPDR", protocol: 1, running: true, hasGraph: true, steps: 12,
  position: { lat: 48.82, lon: 2.32, accuracy: 6, heading: 90, confidence: 0.8, relocalising: false } };
const settle = () => new Promise((done) => setTimeout(done, 5));

test("replies are checked: another program may be answering on the port", () => {
  assert.equal(readLinkState("hello"), undefined);
  assert.equal(readLinkState({ app: "x" }), undefined, "no running state");
  assert.equal(readLinkState({ app: "x", running: true, position: { lat: 91, lon: 2 } })?.position, undefined, "off the Earth");
  assert.equal(readLinkState({ app: "x", running: "yes" }), undefined);
  assert.deepEqual(readLinkState(running)?.position, { lat: 48.82, lon: 2.32, accuracy: 6, heading: 90, confidence: 0.8, relocalising: false });
});

test("a link that drops keeps the last position and comes back by itself", async () => {
  let reachable = true;
  const link = new PositionLink(() => {}, (async () => {
    if (!reachable) throw new TypeError("Failed to fetch");
    return json(running);
  }) as typeof fetch);
  link.connect();
  assert.equal(link.status, "waiting");
  await settle();
  assert.equal(link.status, "connected");
  assert.equal(link.state?.position?.lat, 48.82);
  reachable = false;
  await new Promise((done) => setTimeout(done, 1100));
  assert.equal(link.status, "waiting");
  assert.equal(link.state?.position?.lat, 48.82, "the last position stays");
  reachable = true;
  await new Promise((done) => setTimeout(done, 1100));
  assert.equal(link.status, "connected");
  link.disconnect();
  assert.equal(link.status, "off");
  assert.equal(link.state, undefined);
});

test("turned off, a reply still on its way changes nothing", async () => {
  let answer = (_: Response) => {};
  const link = new PositionLink(() => {}, (() => new Promise<Response>((done) => { answer = done; })) as typeof fetch);
  link.connect();
  link.disconnect();
  answer(json(running));
  await settle();
  assert.equal(link.status, "off");
  assert.equal(link.state, undefined);
});

test("a position goes out as JSON, and a refusal says why", async () => {
  const sent: [string, RequestInit | undefined][] = [];
  const link = new PositionLink(() => {}, (async (url: string, init?: RequestInit) => {
    sent.push([url, init]);
    return json({ error: "not-near" }, 409);
  }) as typeof fetch);
  await assert.rejects(link.sendPosition(48.8, 2.3, 10), (error: Error) => error instanceof LinkRefused && error.message === "not-near");
  assert.equal(sent[0]![0], `${LINK_URL}/position`);
  assert.deepEqual(JSON.parse(String(sent[0]![1]!.body)), { lat: 48.8, lon: 2.3, accuracy: 10 });
});

test("the link is offered off iOS only", () => {
  assert.equal(canLink({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)", maxTouchPoints: 5 }), true);
  assert.equal(canLink({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", maxTouchPoints: 5 }), false);
  assert.equal(canLink({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", maxTouchPoints: 5 }), false, "an iPad asks for desktop sites");
});

test("the direction points the way a bearing goes, on a turned map too", () => {
  const place = { lon: 2.32, lat: 48.82 };
  const direction = (bearing: number, geo: Geo) => {
    const toImage = invert(geo);
    return directionPath(worldToScreen(toImage, toMercator(place)), worldToScreen(toImage, aheadOf(place, bearing)));
  };
  const northUp: Geo = { x: 0, y: 0, scale: 1e-8 };
  assert.match(direction(90, northUp), /^M0,0L44\.0,0\.0/, "east is right");
  assert.match(direction(0, northUp), /^M0,0L0\.0,-44\.0/, "north is up");
  // On a map turned so its right edge points south, east points down the screen.
  assert.match(direction(90, { ...northUp, rotation: -Math.PI / 2 }), /^M0,0L0\.0,44\.0|^M0,0L-0\.0,44\.0/);
});

test("lines go out as a GeoJSON POST, with their length back, and time to build", async () => {
  let init: RequestInit | undefined;
  const link = new PositionLink(() => {}, (async (_: string, options?: RequestInit) => {
    init = options;
    return json({ edges: 9, metres: 1234 });
  }) as typeof fetch);
  assert.equal(await link.sendLines({ type: "FeatureCollection", features: [] }), 1234);
  assert.equal(JSON.parse(String(init!.body)).type, "FeatureCollection");
  assert.equal(readLinkState(running)?.position?.heading, 90);
});
