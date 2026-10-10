import { showDialog } from "./dialog";
import type { MapRecord } from "../types";
import { markerKinds, routeColor, type NavigationState } from "../viewer/navigation";
import { tileKey } from "../types";
import { payloadStore } from "../storage/payloads";
import { readShare, type SharedMap } from "../sharing/format";
import { exportFile, matchingMaps, prepareExport, type ImportMode, type PreparedExport, type ShareSelection } from "../sharing/storage";
import { loadNavigation } from "../storage/navigation";
import { displayName, formatBytes, plural } from "./format";
import { icons } from "./icons";
import { placeIcon } from "./place-icon";

export const sharingMarkup = `
<dialog id="share-dialog" class="sharing-dialog" aria-labelledby="share-title"><div id="share-main"><h2 id="share-title">Share map</h2><p class="share-map-name">${icons.map}<span id="share-map-name"></span></p><p id="share-loading" role="status">Preparing share…</p>
<div id="share-content" hidden><div class="share-summary"><button id="share-places" class="share-row" data-kind="marker"><span class="share-row-icon share-place">${icons.pin}</span><span class="share-row-label">Places</span><span id="share-places-count" class="share-row-value"></span>${icons.arrow}</button><button id="share-routes" class="share-row" data-kind="route"><span class="share-row-icon share-route">${icons.route}</span><span class="share-row-label">Routes</span><span id="share-routes-count" class="share-row-value"></span>${icons.arrow}</button>
<label class="share-row"><span class="share-row-icon share-image">${icons.map}</span><span class="share-row-label">Map image<small>Your friend won’t need the original</small></span><input id="share-image" class="switch" type="checkbox" role="switch"></label></div><p id="share-size" class="share-size" role="status" aria-live="polite"></p></div>
<p id="share-error" class="dialog-error" role="alert" hidden></p><div class="dialog-actions"><button id="share-send" class="primary" disabled>${icons.share}<span>Share file</span></button><button id="share-cancel" class="quiet">${icons.close}<span>Cancel</span></button></div></div>
<div id="share-picker" hidden><button id="share-back" class="share-back">${icons.arrow}<span>Share map</span></button><h2 id="share-picker-title"></h2><div class="share-selection-actions"><button id="share-all" class="secondary" aria-pressed="false">${icons.check}<span>All</span></button><button id="share-none" class="secondary" aria-pressed="false">${icons.close}<span>None</span></button></div><div id="share-items" class="share-items" role="group" aria-labelledby="share-picker-title"></div>
<div class="dialog-actions"><button id="share-done" class="primary">${icons.check}<span>Done</span></button></div></div></dialog>
<dialog id="receive-dialog" class="sharing-dialog" aria-labelledby="receive-title"><h2 id="receive-title">Import shared map</h2><p id="receive-summary"></p><p id="receive-loading" role="status">Looking for a matching map…</p>
<div id="receive-content" hidden><h3 id="receive-destinations-title" class="share-heading">Add to</h3><div id="receive-destinations" class="share-summary" role="radiogroup" aria-labelledby="receive-destinations-title"></div>
<div id="receive-mode-field" hidden><h3 id="receive-mode-title" class="share-heading">Your places and routes</h3><div class="share-segments" role="radiogroup" aria-labelledby="receive-mode-title"><label><input type="radio" name="receive-mode" value="merge" checked>${icons.merge}<span>Merge</span></label><label class="share-segment-danger"><input type="radio" name="receive-mode" value="replace">${icons.rotateRight}<span>Replace</span></label></div></div>
<p id="receive-note" class="dialog-note"></p><label id="receive-image-field" class="share-field" hidden>Original map image<input id="receive-image" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"><small>Choose the exact original image used by the sender.</small></label></div>
<p id="receive-error" class="dialog-error" role="alert" hidden></p><div class="dialog-actions"><button id="receive-import" class="primary" disabled>${icons.download}<span>Import</span></button><button id="receive-cancel" class="quiet">${icons.close}<span>Cancel</span></button></div></dialog>`;

export interface ShareDestination { mapId?: string; image?: File; mode: ImportMode }
export interface ShareImportResult { map: MapRecord; added: number; skipped: number; removed?: number }
interface SharingOptions {
  maps: () => Promise<MapRecord[]>;
  import: (share: SharedMap, destination: ShareDestination) => Promise<ShareImportResult>;
  imported: (result: ShareImportResult, destination: ShareDestination) => Promise<void>;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Owns selection, native file sharing, and the review step before any storage writes. */
export function initSharing(root: HTMLElement, options: SharingOptions) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const sendDialog = el<HTMLDialogElement>("share-dialog");
  const receiveDialog = el<HTMLDialogElement>("receive-dialog");
  const items = el("share-items");
  const includeImage = el<HTMLInputElement>("share-image");
  const destinations = el("receive-destinations");
  const suppliedImage = el<HTMLInputElement>("receive-image");
  let prepared: PreparedExport | undefined;
  let file: File | undefined;
  let received: SharedMap | undefined;
  let maps: MapRecord[] = [];
  let counts = new Map<string, { places: number; routes: number }>();
  let exporting = false;
  let receiving = false;
  let exportVersion = 0;
  let receiveVersion = 0;
  let thumbnailURLs: string[] = [];
  let matching: AbortController | undefined;

  const showError = (id: string, error: unknown) => {
    el(id).textContent = errorMessage(error);
    el(id).hidden = false;
  };
  const kindInputs = (kind: "marker" | "route") => [...items.querySelectorAll<HTMLInputElement>(`input[data-kind="${kind}"]`)];
  let picking: "marker" | "route" | undefined;
  const exportBusy = (busy: boolean) => {
    exporting = busy;
    for (const id of ["share-cancel", "share-send", "share-all", "share-none", "share-back", "share-done"])
      el<HTMLButtonElement>(id).disabled = busy || (id === "share-send" && !file);
    for (const [id, kind] of [["share-places", "marker"], ["share-routes", "route"]] as const)
      el<HTMLButtonElement>(id).disabled = busy || !kindInputs(kind).length;
    includeImage.disabled = busy;
    for (const input of items.querySelectorAll<HTMLInputElement>("input")) input.disabled = busy;
  };
  const selection = (): ShareSelection => ({
    markers: kindInputs("marker").filter((input) => input.checked).map((input) => input.value),
    routes: kindInputs("route").filter((input) => input.checked).map((input) => input.value),
    includeImage: includeImage.checked,
  });
  const updateFile = () => {
    file = undefined;
    el("share-error").hidden = true;
    el("share-size").replaceChildren();
    for (const [id, kind] of [["share-places-count", "marker"], ["share-routes-count", "route"]] as const) {
      const inputs = kindInputs(kind), picked = inputs.filter((input) => input.checked).length;
      el(id).textContent = !inputs.length ? "None saved" : picked === inputs.length ? `All ${picked}` : picked ? `${picked} of ${inputs.length}` : "None";
    }
    if (picking) {
      const inputs = kindInputs(picking), picked = inputs.filter((input) => input.checked).length;
      el("share-all").setAttribute("aria-pressed", String(picked === inputs.length));
      el("share-none").setAttribute("aria-pressed", String(!picked));
    }
    if (prepared) {
      try {
        file = exportFile(prepared, selection());
        const kind = root.ownerDocument.createElement("span"), size = root.ownerDocument.createElement("b");
        kind.textContent = includeImage.checked ? "With map image" : "Annotations only";
        size.textContent = formatBytes(file.size);
        el("share-size").append(kind, size);
      } catch (error) {
        showError("share-error", error);
      }
    }
    exportBusy(false);
  };
  // Places and routes are picked on their own page so the summary never scrolls.
  const showPicker = (kind?: "marker" | "route") => {
    picking = kind;
    el("share-main").hidden = !!kind;
    el("share-picker").hidden = !kind;
    if (kind) {
      el("share-picker-title").textContent = kind === "marker" ? "Places" : "Routes";
      for (const label of items.children) (label as HTMLElement).hidden = label.querySelector("input")?.dataset.kind !== kind;
    }
    updateFile();
  };
  const download = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = root.ownerDocument.createElement("a");
    link.href = url;
    link.download = file.name;
    root.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  el("share-send").addEventListener("click", async () => {
    if (!file || exporting) return;
    el("share-error").hidden = true;
    try {
      // Browsers without file sharing (e.g. desktop Firefox) get a download instead.
      if (!navigator.canShare?.({ files: [file] }) || !navigator.share) {
        download();
        el("share-size").textContent = "File saved. Send it from your files app.";
        return;
      }
      exportBusy(true);
      // The file is prepared before this click, preserving native user activation.
      await navigator.share({ files: [file], title: prepared?.map.name });
      sendDialog.close();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) showError("share-error", error);
    } finally { exportBusy(false); }
  });
  el("share-cancel").addEventListener("click", () => sendDialog.close());
  el("share-places").addEventListener("click", () => showPicker("marker"));
  el("share-routes").addEventListener("click", () => showPicker("route"));
  for (const id of ["share-back", "share-done"]) el(id).addEventListener("click", () => showPicker());
  sendDialog.addEventListener("cancel", (event) => {
    if (exporting) event.preventDefault();
    // Escape on a picker page steps back to the summary.
    else if (picking) {
      event.preventDefault();
      showPicker();
    }
  });
  sendDialog.addEventListener("close", () => {
    exportVersion++;
    prepared = undefined;
    file = undefined;
    picking = undefined;
    el("share-main").hidden = false;
    el("share-picker").hidden = true;
    items.replaceChildren();
  });
  for (const [id, checked] of [["share-all", true], ["share-none", false]] as const)
    el(id).addEventListener("click", () => {
      if (!picking) return;
      for (const input of kindInputs(picking)) input.checked = checked;
      updateFile();
    });
  items.addEventListener("change", updateFile);
  includeImage.addEventListener("change", updateFile);

  const checked = (name: string) => [...root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].find((input) => input.checked)?.value;
  const destinationValue = () => checked("receive-destination") ?? "new";
  const modeValue = (): ImportMode => checked("receive-mode") === "replace" ? "replace" : "merge";
  const clearThumbnails = () => {
    for (const url of thumbnailURLs) URL.revokeObjectURL(url);
    thumbnailURLs = [];
  };
  const sharedItems = () => {
    const share = received!.manifest;
    return `${plural(share.markers.length, "place")} and ${plural(share.routes.length, "route")}`;
  };
  const setImportLabel = (icon: string, text: string) => {
    const button = el("receive-import"), label = root.ownerDocument.createElement("span");
    label.textContent = text;
    button.innerHTML = icon;
    button.append(label);
  };
  /** Shows what the chosen destination and mode will do before anything is written. */
  function updateImport() {
    const value = destinationValue(), map = maps.find((map) => map.id === value);
    const replace = !!map && modeValue() === "replace";
    el("receive-mode-field").hidden = !map;
    el("receive-image-field").hidden = !!map || !received || !!received.image;
    const button = el<HTMLButtonElement>("receive-import");
    button.classList.toggle("danger", replace);
    button.disabled = receiving || !received || (map ? false : !(received.image || suppliedImage.files?.[0]));
    if (!received) return;
    const note = el("receive-note"), name = map ? displayName(map.name) : "";
    const own = counts.get(value);
    note.classList.toggle("dialog-error", replace);
    if (!map) {
      note.textContent = `Creates a separate map with the shared ${sharedItems()}. Your existing maps stay as they are.`;
      setImportLabel(icons.download, "Import as new map");
    } else if (replace) {
      note.textContent = own && own.places + own.routes
        ? `Deletes your ${plural(own.places, "place")} and ${plural(own.routes, "route")} on this map and keeps only the shared ones. This can’t be undone.`
        : "Uses only the shared places and routes. This map has none of its own yet.";
      setImportLabel(icons.rotateRight, `Replace on ${name}`);
    } else {
      note.textContent = `${own && own.places + own.routes ? `Keeps your ${plural(own.places, "place")} and ${plural(own.routes, "route")}` : "Keeps this map as it is"} and adds the new ones. Items you already imported are skipped.`;
      setImportLabel(icons.merge, `Merge into ${name}`);
    }
  }
  /** One row per map made from the same image, plus a new map; nothing else can line up. */
  function showDestinations() {
    clearThumbnails();
    destinations.replaceChildren();
    const single = !maps.length;
    el("receive-destinations-title").hidden = single;
    destinations.classList.toggle("single", single);
    const addRow = (value: string, title: string, detail: string, map?: MapRecord) => {
      const row = root.ownerDocument.createElement("label");
      row.className = "share-row";
      const thumbnail = root.ownerDocument.createElement("span");
      thumbnail.className = map ? "receive-thumbnail" : "receive-thumbnail receive-new";
      thumbnail.innerHTML = map ? icons.map : icons.plus;
      const label = root.ownerDocument.createElement("span");
      label.className = "share-row-label";
      label.textContent = title;
      const small = root.ownerDocument.createElement("small");
      small.textContent = detail;
      if (map) small.className = "receive-match";
      label.append(small);
      const input = root.ownerDocument.createElement("input");
      input.type = "radio";
      input.name = "receive-destination";
      input.value = value;
      input.hidden = single;
      row.append(thumbnail, label, input);
      destinations.append(row);
      if (!map) return;
      void payloadStore(map.backend).get(map.id, tileKey(map.levels.length - 1, 0, 0)).then((overview) => {
        if (!row.isConnected) return;
        const url = URL.createObjectURL(overview);
        thumbnailURLs.push(url);
        const image = root.ownerDocument.createElement("img");
        image.alt = "";
        image.src = url;
        thumbnail.replaceChildren(image);
      }, () => {});
    };
    for (const map of maps) addRow(map.id, displayName(map.name), "Same map", map);
    addRow("new", "New map", single ? "None of your maps match this one" : received?.image ? "Uses the image in the file" : "Needs the original map image");
    const selected = destinations.querySelector<HTMLInputElement>(`input[value="${maps[0]?.id ?? "new"}"]`)!;
    selected.checked = true;
  }
  destinations.addEventListener("change", updateImport);
  for (const input of root.querySelectorAll<HTMLInputElement>('input[name="receive-mode"]')) input.addEventListener("change", updateImport);
  suppliedImage.addEventListener("change", updateImport);
  el("receive-cancel").addEventListener("click", () => receiveDialog.close());
  receiveDialog.addEventListener("cancel", (event) => { if (receiving) event.preventDefault(); });
  receiveDialog.addEventListener("close", () => {
    receiveVersion++;
    matching?.abort();
    received = undefined;
    suppliedImage.value = "";
    destinations.replaceChildren();
    clearThumbnails();
  });
  const receiveBusy = (busy: boolean) => {
    receiving = busy;
    el<HTMLButtonElement>("receive-cancel").disabled = busy;
    suppliedImage.disabled = busy;
    for (const input of receiveDialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')) input.disabled = busy;
    updateImport();
  };
  el("receive-import").addEventListener("click", async () => {
    if (!received || receiving || el<HTMLButtonElement>("receive-import").disabled) return;
    const value = destinationValue();
    const destination: ShareDestination = value === "new"
      ? { image: received.image ?? suppliedImage.files?.[0], mode: "merge" }
      : { mapId: value, mode: modeValue() };
    el("receive-error").hidden = true;
    receiveBusy(true);
    try {
      const result = await options.import(received, destination);
      receiveDialog.close();
      await options.imported(result, destination);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) showError("receive-error", error);
    } finally {
      receiveBusy(false);
    }
  });

  async function openImport(input: Blob) {
    if (receiving) return;
    matching?.abort();
    matching = new AbortController();
    const controller = matching;
    const version = ++receiveVersion;
    received = undefined;
    el("receive-content").hidden = true;
    el("receive-loading").hidden = false;
    el("receive-error").hidden = true;
    el("receive-summary").textContent = "Reading shared file…";
    suppliedImage.value = "";
    updateImport();
    if (!receiveDialog.open) showDialog(receiveDialog);
    try {
      const parsed = await readShare(input);
      if (version !== receiveVersion) return;
      const share = parsed.manifest;
      el("receive-summary").textContent = `${share.map.name}\n${plural(share.markers.length, "place")} · ${plural(share.routes.length, "route")} · ${parsed.image ? "Map image included" : "Annotations only"}`;
      const available = (await options.maps()).filter((map) => map.status === "ready" && map.width === share.map.width && map.height === share.map.height);
      const exact = await matchingMaps(share, available, controller.signal);
      const states = await Promise.all(exact.map((id) => loadNavigation(id)));
      if (version !== receiveVersion) return;
      maps = available.filter((map) => exact.includes(map.id));
      counts = new Map(states.map((state) => [state.mapId, { places: state.markers.length, routes: state.routes.filter((route) => !route.draft).length }]));
      received = parsed;
      root.querySelector<HTMLInputElement>('input[name="receive-mode"][value="merge"]')!.checked = true;
      showDestinations();
      el("receive-content").hidden = false;
      updateImport();
    } catch (error) {
      if (version === receiveVersion) showError("receive-error", error);
    } finally {
      if (version === receiveVersion) el("receive-loading").hidden = true;
    }
  }
  return {
    openImport,
    async openExport(map: MapRecord, state: NavigationState, initial?: { kind: "marker" | "route"; id: string }) {
      if (exporting) return;
      const version = ++exportVersion;
      prepared = undefined;
      file = undefined;
      picking = undefined;
      items.replaceChildren();
      el("share-main").hidden = false;
      el("share-picker").hidden = true;
      el("share-map-name").textContent = displayName(map.name);
      el("share-loading").hidden = false;
      el("share-content").hidden = true;
      el("share-error").hidden = true;
      exportBusy(false);
      if (!sendDialog.open) showDialog(sendDialog);
      try {
        const data = await prepareExport(map, state);
        if (version !== exportVersion) return;
        prepared = data;
        includeImage.checked = !initial && data.markers.length + data.routes.length === 0;
        for (const [kind, entries] of [["marker", data.markers], ["route", data.routes]] as const)
          for (const item of entries) {
            const label = root.ownerDocument.createElement("label");
            label.className = "share-choice";
            const icon = root.ownerDocument.createElement("span");
            icon.className = "share-choice-icon";
            icon.innerHTML = "label" in item ? placeIcon(item.kind) : icons.route.replace("<svg ", `<svg style="color:${routeColor(state, item.id)}" `);
            const text = root.ownerDocument.createElement("span");
            text.className = "share-choice-text";
            text.textContent = "label" in item ? item.label : item.name;
            const detail = root.ownerDocument.createElement("small");
            detail.textContent = "label" in item ? (markerKinds[item.kind] ?? markerKinds.landmark).label : plural(item.points.length, "point");
            text.append(detail);
            const input = root.ownerDocument.createElement("input");
            input.type = "checkbox";
            input.value = item.id;
            input.dataset.kind = kind;
            input.checked = !initial || (initial.kind === kind && initial.id === item.id);
            label.append(icon, text, input);
            items.append(label);
          }
        el("share-content").hidden = false;
        updateFile();
      } catch (error) {
        if (version === exportVersion) showError("share-error", error);
      } finally {
        if (version === exportVersion) el("share-loading").hidden = true;
      }
    },
  };
}
