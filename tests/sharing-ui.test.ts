import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initSharing, sharingMarkup, type ShareDestination } from "../src/ui/sharing";
import { defaultNavigation } from "../src/viewer/navigation";
import { saveMap } from "../src/storage/database";
import { saveNavigation } from "../src/storage/navigation";
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
  // Linkedom lacks file picker state.
  Object.defineProperty(el("receive-image"), "files", { value: [], writable: true });
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
    choose: (name: string, value: string) => {
      for (const input of document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) input.checked = input.value === value;
      document.querySelector(`input[name="${name}"][value="${value}"]`)!.dispatchEvent(new window.Event("change", { bubbles: true }));
    },
    rows: () => [...el("receive-destinations").querySelectorAll<HTMLInputElement>("input")].map((input) => input.value),
  };
}

test("share dialog summarizes the file, picks items per kind, toggles the image, and shares the prepared file", async () => {
  const { ui, el, map, state, click, change, escape } = await setup();
  await ui.openExport(map, state, { kind: "marker", id: "place" });
  assert.equal(el<HTMLDialogElement>("share-dialog").open, true);
  assert.equal(el("share-places-count").textContent, "All 1");
  assert.equal(el("share-routes-count").textContent, "None");
  assert.match(el("share-size").textContent!, /Annotations only/);
  const inputs = [...el("share-items").querySelectorAll<HTMLInputElement>("input")];
  assert.deepEqual(inputs.map((input) => input.checked), [true, false]);
  assert.equal(el("share-items").querySelector("script"), null);
  assert.match(el("share-items").textContent!, /<script>entrance<\/script>/);
  assert.equal(el<HTMLInputElement>("share-image").checked, false);
  click("share-places");
  assert.equal(el("share-main").hidden, true);
  assert.equal(el("share-picker-title").textContent, "Places");
  assert.deepEqual(inputs.map((input) => input.closest("label")!.hidden), [false, true]);
  assert.equal(el("share-all").getAttribute("aria-pressed"), "true");
  click("share-none");
  assert.equal(inputs[0]!.checked, false);
  assert.equal(escape("share-dialog"), false, "Escape steps back instead of closing");
  assert.equal(el("share-main").hidden, false);
  assert.equal(el("share-places-count").textContent, "None");
  assert.equal(el<HTMLButtonElement>("share-send").disabled, true);
  el<HTMLInputElement>("share-image").checked = true;
  change("share-image");
  assert.equal(el<HTMLButtonElement>("share-send").disabled, false, "image-only export is supported");
  assert.match(el("share-size").textContent!, /With map image/);
  click("share-routes");
  assert.deepEqual(inputs.map((input) => input.closest("label")!.hidden), [true, false]);
  click("share-all");
  assert.equal(inputs[0]!.checked, false, "select all only affects the open kind");
  click("share-done");
  click("share-places");
  click("share-all");
  click("share-back");
  assert.equal(el("share-places-count").textContent, "All 1");
  assert.equal(el("share-routes-count").textContent, "All 1");
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
  assert.equal(el<HTMLDialogElement>("share-dialog").open, false, "a completed share closes the dialog");
});

test("share dialog with no annotations offers the image only", async () => {
  const { ui, el, map, click } = await setup();
  await ui.openExport(map, defaultNavigation(map.id));
  assert.equal(el("share-places-count").textContent, "None saved");
  assert.equal(el<HTMLButtonElement>("share-places").disabled, true);
  assert.equal(el<HTMLButtonElement>("share-routes").disabled, true);
  assert.equal(el<HTMLInputElement>("share-image").checked, true);
  assert.equal(el<HTMLButtonElement>("share-send").disabled, false);
  click("share-cancel");
  assert.equal(el<HTMLDialogElement>("share-dialog").open, false);
});

test("import dialog merges into a matching map by default and warns before replacing", async () => {
  const { ui, el, map, state, manifest, calls, imported, click, choose, rows, finish } = await setup();
  await saveNavigation(state);
  await ui.openImport(encodeShare(manifest));
  assert.deepEqual(rows(), [map.id, "new"]);
  assert.equal(el<HTMLInputElement>("receive-destinations").querySelector<HTMLInputElement>("input")!.checked, true);
  assert.equal(el("receive-destinations").querySelector("script"), null);
  assert.match(el("receive-destinations").textContent!, /Survey <west>/);
  assert.equal(el("receive-mode-field").hidden, false);
  assert.match(el("receive-note").textContent!, /Keeps your 1 place and 1 route/);
  assert.equal(el("receive-import").textContent, "Merge into Survey <west>");
  assert.equal(el("receive-import").classList.contains("danger"), false);
  choose("receive-mode", "replace");
  assert.match(el("receive-note").textContent!, /Deletes your 1 place and 1 route.*can’t be undone/);
  assert.equal(el("receive-import").textContent, "Replace on Survey <west>");
  assert.equal(el("receive-import").classList.contains("danger"), true);
  click("receive-import");
  assert.deepEqual(calls[0]!.destination, { mapId: map.id, mode: "replace" });
  finish();
  await settle();
  assert.deepEqual(imported, [map.id]);
});

test("a new map hides merge and replace, needs an image, waits for one import and supports retry", async () => {
  const { ui, el, map, manifest, original, calls, imported, click, change, choose, escape, fail, finish } = await setup();
  await ui.openImport(encodeShare(manifest));
  assert.match(el("receive-summary").textContent!, /Annotations only/);
  choose("receive-destination", "new");
  assert.equal(el("receive-mode-field").hidden, true);
  assert.equal(el("receive-import").textContent, "Import as new map");
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
  assert.deepEqual(calls[1]!.destination, { image: original, mode: "merge" });
  assert.equal(escape("receive-dialog"), false);
  finish();
  await settle();
  assert.equal(el<HTMLDialogElement>("receive-dialog").open, false);
  assert.deepEqual(imported, [map.id]);
});

test("embedded shares can merge into a matching map or import an independent copy", async () => {
  const { ui, el, map, manifest, original, calls, click, choose, finish } = await setup();
  const file = encodeShare({ ...manifest, image: { name: original.name, type: original.type, bytes: original.size } }, original);
  await ui.openImport(file);
  assert.equal(el("receive-image-field").hidden, true);
  click("receive-import");
  assert.deepEqual(calls[0]!.destination, { mapId: map.id, mode: "merge" });
  finish();
  await settle();
  await ui.openImport(file);
  choose("receive-mode", "replace");
  choose("receive-destination", "new");
  assert.equal(el("receive-mode-field").hidden, true);
  assert.equal(el("receive-image-field").hidden, true);
  assert.equal(el("receive-import").classList.contains("danger"), false);
  assert.equal(el<HTMLButtonElement>("receive-import").disabled, false);
  click("receive-import");
  assert.equal(calls[1]!.destination.mapId, undefined);
  assert.equal(calls[1]!.destination.mode, "merge");
  assert.deepEqual(await calls[1]!.destination.image!.arrayBuffer(), await original.arrayBuffer());
  finish();
  await settle();
});

test("maps made from a different image are not offered as destinations", async () => {
  const { ui, el, manifest, rows } = await setup();
  await ui.openImport(encodeShare({ ...manifest, map: { ...manifest.map, fingerprint: "f".repeat(64) } }));
  assert.deepEqual(rows(), ["new"]);
  assert.equal(el("receive-destinations-title").hidden, true);
  assert.match(el("receive-destinations").textContent!, /None of your maps match/);
  assert.equal(el("receive-mode-field").hidden, true);
  assert.equal(el<HTMLButtonElement>("receive-import").disabled, true, "an annotations-only share needs the original image");
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
