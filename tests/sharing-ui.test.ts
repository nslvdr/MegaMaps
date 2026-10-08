import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initSharing, sharingMarkup, type ShareDestination } from "../src/ui/sharing";
import { defaultNavigation } from "../src/viewer/navigation";
import { saveMap } from "../src/storage/database";
import { payloadStore } from "../src/storage/payloads";
import { encodeShare, fingerprint, readShare, type SharedMap, type ShareManifest } from "../src/sharing/format";
import type { MapRecord } from "../src/types";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
async function setup() {
  const { document, window } = parseHTML(`<html><body><main>${sharingMarkup}</main></body></html>`);
  const root = document.querySelector("main")!;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  for (const dialog of root.querySelectorAll("dialog")) {
    Object.defineProperties(dialog, {
      open: { get: () => dialog.hasAttribute("open") },
      showModal: { value: () => dialog.setAttribute("open", "") },
      close: { value: () => {
        dialog.removeAttribute("open");
        dialog.dispatchEvent(new window.Event("close"));
      } },
    });
  }
  // Linkedom lacks a select value setter and file picker state.
  let selected = "";
  Object.defineProperty(el("receive-destination"), "value", { get: () => selected, set: (value: string) => { selected = value; } });
  Object.defineProperty(el("receive-image"), "files", { value: [], writable: true });
  Object.defineProperty(el("receive-preview-image"), "decode", { value: async () => {}, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: { canShare: () => false }, configurable: true });
  const header = new Uint8Array(33);
  header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  header.set(new TextEncoder().encode("IHDR"), 12);
  new DataView(header.buffer).setUint32(16, 512);
  new DataView(header.buffer).setUint32(20, 256);
  const original = new File([header], "map.png", { type: "image/png" });
  const map: MapRecord = { id: crypto.randomUUID(), name: "Survey <west>.png", width: 512, height: 256,
    bytes: original.size, levels: [{ width: 512, height: 256, scale: 1, cols: 1, rows: 1 }],
    backend: "indexeddb", created: 1, status: "ready" };
  await saveMap(map);
  await payloadStore(map.backend).put(map.id, "original", original);
  await payloadStore(map.backend).put(map.id, "0-0-0.png", original);
  const state = defaultNavigation(map.id);
  state.markers = [{ id: "place", point: { x: 100, y: 80 }, label: "<script>entrance</script>", note: "A note", kind: "entrance", created: 1 }];
  state.routes = [{ id: "route", name: "Exit", points: [{ x: 100, y: 80 }, { x: 300, y: 200 }], draft: false, created: 1 }];
  const manifest: ShareManifest = { format: "megamap", version: 1,
    map: { name: map.name, width: map.width, height: map.height, fingerprint: await fingerprint(original) },
    markers: state.markers, routes: state.routes };
  const calls: { share: SharedMap; destination: ShareDestination }[] = [];
  const imported: string[] = [];
  let fail = false;
  let hold: (() => void) | undefined;
  const ui = initSharing(root, {
    maps: async () => [map],
    import: async (share, destination) => {
      calls.push({ share, destination });
      if (fail) throw new Error("Device storage full");
      await new Promise<void>((resolve) => { hold = resolve; });
      return { map, added: 2, skipped: 0 };
    },
    imported: async (result) => { imported.push(result.map.id); },
  });
  return { ui, el, map, state, manifest, original, calls, imported,
    fail: (value: boolean) => { fail = value; }, finish: () => hold?.(),
    click: (id: string) => el(id).dispatchEvent(new window.Event("click")),
    change: (id: string) => el(id).dispatchEvent(new window.Event("change")),
    escape: (id: string) => el(id).dispatchEvent(new window.Event("cancel", { cancelable: true })),
  };
}

test("share dialog selects individual items safely, toggles the image, and shares the prepared file", async () => {
  const { ui, el, map, state, click, change } = await setup();
  await ui.openExport(map, state, { kind: "marker", id: "place" });
  assert.equal(el<HTMLDialogElement>("share-dialog").open, true);
  const inputs = [...el("share-items").querySelectorAll<HTMLInputElement>("input")];
  assert.deepEqual(inputs.map((input) => input.checked), [true, false]);
  assert.equal(el("share-items").querySelector("script"), null);
  assert.match(el("share-items").textContent!, /<script>entrance<\/script>/);
  assert.equal(el<HTMLInputElement>("share-image").checked, false);
  click("share-none");
  assert.equal(el<HTMLButtonElement>("share-send").disabled, true);
  el<HTMLInputElement>("share-image").checked = true;
  change("share-image");
  assert.equal(el<HTMLButtonElement>("share-send").disabled, false, "image-only export is supported");
  click("share-all");
  let shared: ShareData | undefined;
  Object.defineProperty(globalThis, "navigator", { value: {
    canShare: () => true, share: async (value: ShareData) => { shared = value; },
  }, configurable: true });
  click("share-send");
  assert.ok(shared, "native share is called synchronously within the click");
  const decoded = await readShare(shared.files![0]!);
  assert.equal(decoded.manifest.markers.length, 1);
  assert.equal(decoded.manifest.routes.length, 1);
  assert.ok(decoded.image);
  assert.equal(el<HTMLButtonElement>("share-cancel").disabled, false);
  click("share-cancel");
});

test("import dialog offers existing-map and separate-copy destinations, waits for one import and supports retry", async () => {
  const { ui, el, map, manifest, original, calls, imported, click, change, escape, fail, finish } = await setup();
  await ui.openImport(encodeShare(manifest));
  assert.equal(el<HTMLSelectElement>("receive-destination").value, map.id);
  assert.match(el("receive-summary").textContent!, /Annotations only/);
  assert.equal(el("receive-preview").hidden, false);
  assert.equal(el("receive-preview-overlay").querySelectorAll("circle").length, 1);
  assert.equal(el<HTMLButtonElement>("receive-import").disabled, false);
  el<HTMLSelectElement>("receive-destination").value = "new";
  change("receive-destination");
  assert.equal(el("receive-image-field").hidden, false);
  assert.equal(el<HTMLButtonElement>("receive-import").disabled, true);
  Object.defineProperty(el("receive-image"), "files", { value: [original] });
  change("receive-image");
  assert.equal(el<HTMLButtonElement>("receive-import").disabled, false);
  fail(true);
  click("receive-import");
  await settle();
  assert.equal(el<HTMLDialogElement>("receive-dialog").open, true);
  assert.match(el("receive-error").textContent!, /storage full/);
  assert.equal(el<HTMLButtonElement>("receive-import").disabled, false);
  fail(false);
  click("receive-import");
  click("receive-import");
  assert.equal(calls.length, 2, "a pending import cannot be submitted twice");
  assert.equal(calls[1]!.destination.mapId, undefined);
  assert.equal(calls[1]!.destination.image, original);
  assert.equal(escape("receive-dialog"), false);
  finish();
  await settle();
  assert.equal(el<HTMLDialogElement>("receive-dialog").open, false);
  assert.deepEqual(imported, [map.id]);
});

test("unmatched images require a loaded preview and explicit alignment confirmation", async () => {
  const { ui, el, map, manifest, click, change, calls, finish } = await setup();
  const different = { ...manifest, map: { ...manifest.map, fingerprint: "f".repeat(64) } };
  await ui.openImport(encodeShare(different));
  assert.equal(el<HTMLSelectElement>("receive-destination").value, "new");
  el<HTMLSelectElement>("receive-destination").value = map.id;
  change("receive-destination");
  assert.equal(el<HTMLButtonElement>("receive-import").disabled, true);
  assert.equal(el<HTMLInputElement>("receive-confirm").disabled, true);
  await settle();
  assert.equal(el<HTMLInputElement>("receive-confirm").disabled, false);
  assert.equal(el("receive-confirm-field").hidden, false);
  el<HTMLInputElement>("receive-confirm").checked = true;
  change("receive-confirm");
  click("receive-import");
  assert.equal(calls[0]!.destination.allowDifferentImage, true);
  finish();
  await settle();
});

test("cancelling and invalid files never perform an import", async () => {
  const { ui, el, manifest, calls, click } = await setup();
  await ui.openImport(new Blob(["bad file"]));
  assert.equal(el("receive-error").hidden, false);
  assert.equal(el<HTMLButtonElement>("receive-import").disabled, true);
  click("receive-cancel");
  const loading = ui.openImport(encodeShare(manifest));
  click("receive-cancel");
  await loading;
  assert.equal(el<HTMLDialogElement>("receive-dialog").open, false);
  assert.deepEqual(calls, []);
});

test("a damaged map preview cannot authorize importing onto an unmatched image", async () => {
  const { ui, el, manifest, map, change, calls } = await setup();
  Object.defineProperty(el("receive-preview-image"), "decode", { value: async () => { throw new Error("Damaged image"); } });
  await ui.openImport(encodeShare({ ...manifest, map: { ...manifest.map, fingerprint: "a".repeat(64) } }));
  el<HTMLSelectElement>("receive-destination").value = map.id;
  change("receive-destination");
  await settle();
  assert.equal(el("receive-preview").hidden, true);
  assert.equal(el<HTMLInputElement>("receive-confirm").disabled, true);
  assert.match(el("receive-error").textContent!, /Damaged image/);
  el<HTMLInputElement>("receive-confirm").checked = true;
  change("receive-confirm");
  assert.equal(el<HTMLButtonElement>("receive-import").disabled, true);
  assert.deepEqual(calls, []);
});
