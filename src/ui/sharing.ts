import type { MapRecord } from "../types";
import type { NavigationState } from "../viewer/navigation";
import { tileKey } from "../types";
import { payloadStore } from "../storage/payloads";
import { readShare, type SharedMap } from "../sharing/format";
import { exportFile, matchingMaps, prepareExport, type PreparedExport, type ShareSelection } from "../sharing/storage";
import { formatBytes } from "./format";

export const sharingMarkup = `
<input id="shared-file-input" type="file" accept=".megamap,application/octet-stream" hidden>
<dialog id="share-dialog" class="sharing-dialog" aria-labelledby="share-title"><h2 id="share-title">Share map</h2><p id="share-map-name"></p><p id="share-loading" role="status">Preparing share…</p>
<div id="share-content" hidden><div id="share-selection" class="share-selection-actions"><button id="share-all" class="secondary">Select all</button><button id="share-none" class="secondary">Clear selection</button></div><div id="share-items" class="share-items" role="group" aria-label="Annotations to share"></div>
<label class="share-choice"><input id="share-image" type="checkbox"><span>Include map image<small>Your friend can import it without finding the original.</small></span></label><p id="share-size" role="status" aria-live="polite"></p><p class="dialog-note">Your friend receives an editable copy. Sending it again adds new items and keeps their edits.</p></div>
<p id="share-error" class="dialog-error" role="alert" hidden></p><div class="dialog-actions"><button id="share-send" class="primary" disabled>Share file</button><button id="share-save" class="secondary" disabled>Save file</button><button id="share-cancel" class="quiet">Cancel</button></div></dialog>
<dialog id="receive-dialog" class="sharing-dialog" aria-labelledby="receive-title"><h2 id="receive-title">Import shared map</h2><p id="receive-summary"></p><p id="receive-loading" role="status">Looking for a matching map…</p>
<div id="receive-content" hidden><label class="share-field">Destination<select id="receive-destination"></select></label><label id="receive-image-field" class="share-field" hidden>Original map image<input id="receive-image" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"><small>Choose the exact original image used by the sender.</small></label>
<p id="receive-match" class="dialog-note"></p><div id="receive-preview" class="share-preview" aria-label="Preview of shared annotations on the selected map" hidden><img id="receive-preview-image" alt="Selected map"><svg id="receive-preview-overlay" aria-hidden="true"></svg></div>
<label id="receive-confirm-field" class="share-choice" hidden><input id="receive-confirm" type="checkbox"><span>I checked that the annotations line up</span></label><p class="dialog-note">Existing annotations stay intact. Previously imported items are skipped, including items you edited or deleted.</p></div>
<p id="receive-error" class="dialog-error" role="alert" hidden></p><div class="dialog-actions"><button id="receive-import" class="primary" disabled>Import</button><button id="receive-cancel" class="quiet">Cancel</button></div></dialog>`;

export interface ShareDestination { mapId?: string; image?: File; allowDifferentImage: boolean }
export interface ShareImportResult { map: MapRecord; added: number; skipped: number }
interface SharingOptions {
  maps: () => Promise<MapRecord[]>;
  import: (share: SharedMap, destination: ShareDestination) => Promise<ShareImportResult>;
  imported: (result: ShareImportResult) => Promise<void>;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Owns selection, native file sharing, and the review step before any storage writes. */
export function initSharing(root: HTMLElement, options: SharingOptions) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const sendDialog = el<HTMLDialogElement>("share-dialog");
  const receiveDialog = el<HTMLDialogElement>("receive-dialog");
  const shareInput = el<HTMLInputElement>("shared-file-input");
  const items = el("share-items");
  const includeImage = el<HTMLInputElement>("share-image");
  const destination = el<HTMLSelectElement>("receive-destination");
  const suppliedImage = el<HTMLInputElement>("receive-image");
  const confirm = el<HTMLInputElement>("receive-confirm");
  let prepared: PreparedExport | undefined;
  let file: File | undefined;
  let received: SharedMap | undefined;
  let maps: MapRecord[] = [];
  let matches: string[] = [];
  let exporting = false;
  let receiving = false;
  let exportVersion = 0;
  let receiveVersion = 0;
  let previewVersion = 0;
  let previewURL: string | undefined;
  let matching: AbortController | undefined;

  const showError = (id: string, error: unknown) => {
    el(id).textContent = errorMessage(error);
    el(id).hidden = false;
  };
  const exportBusy = (busy: boolean) => {
    exporting = busy;
    for (const id of ["share-cancel", "share-save", "share-send", "share-all", "share-none"])
      el<HTMLButtonElement>(id).disabled = busy || ((id === "share-save" || id === "share-send") && !file);
    includeImage.disabled = busy;
    for (const input of items.querySelectorAll<HTMLInputElement>("input")) input.disabled = busy;
  };
  const selection = (): ShareSelection => ({
    markers: [...items.querySelectorAll<HTMLInputElement>('input[data-kind="marker"]')].filter((input) => input.checked).map((input) => input.value),
    routes: [...items.querySelectorAll<HTMLInputElement>('input[data-kind="route"]')].filter((input) => input.checked).map((input) => input.value),
    includeImage: includeImage.checked,
  });
  const updateFile = () => {
    file = undefined;
    el("share-error").hidden = true;
    if (prepared) {
      try {
        file = exportFile(prepared, selection());
        const picked = selection();
        el("share-size").textContent = `${picked.markers.length} places · ${picked.routes.length} routes · ${formatBytes(file.size)}`;
      } catch (error) {
        el("share-size").textContent = "";
        showError("share-error", error);
      }
    }
    exportBusy(false);
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
  el("share-save").addEventListener("click", download);
  el("share-send").addEventListener("click", async () => {
    if (!file || exporting) return;
    el("share-error").hidden = true;
    try {
      if (!navigator.canShare?.({ files: [file] }) || !navigator.share) {
        download();
        el("share-size").textContent = "File saved. Send it from your files app.";
        return;
      }
      exportBusy(true);
      // The file is prepared before this click, preserving native user activation.
      await navigator.share({ files: [file], title: prepared?.map.name });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) showError("share-error", error);
    } finally { exportBusy(false); }
  });
  el("share-cancel").addEventListener("click", () => sendDialog.close());
  sendDialog.addEventListener("cancel", (event) => { if (exporting) event.preventDefault(); });
  sendDialog.addEventListener("close", () => {
    exportVersion++;
    prepared = undefined;
    file = undefined;
    items.replaceChildren();
  });
  for (const [id, checked] of [["share-all", true], ["share-none", false]] as const)
    el(id).addEventListener("click", () => {
      for (const input of items.querySelectorAll<HTMLInputElement>("input")) input.checked = checked;
      updateFile();
    });
  items.addEventListener("change", updateFile);
  includeImage.addEventListener("change", updateFile);

  const clearPreview = () => {
    previewVersion++;
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = undefined;
    el<HTMLImageElement>("receive-preview-image").removeAttribute("src");
    el("receive-preview").hidden = true;
    el("receive-preview-overlay").replaceChildren();
  };
  const updateDestination = async () => {
    clearPreview();
    confirm.checked = false;
    el("receive-error").hidden = true;
    const map = maps.find((map) => map.id === destination.value);
    const exact = !!map && matches.includes(map.id);
    const newCopy = destination.value === "new";
    confirm.disabled = !newCopy && !exact;
    el("receive-image-field").hidden = !newCopy || !!received?.image;
    el("receive-confirm-field").hidden = newCopy || exact;
    el("receive-match").textContent = newCopy
      ? received?.image ? "The map image is included. A separate copy will be created." : "This share contains annotations only. Supply the original map image to create a copy."
      : exact ? "Exact image match. Map filenames can differ." : "This image is not an exact match. Check the preview before importing; a different map revision can move passages.";
    updateImportButton();
    if (!map || !received) return;
    const version = previewVersion;
    try {
      const overview = await payloadStore(map.backend).get(map.id, tileKey(map.levels.length - 1, 0, 0));
      if (version !== previewVersion) return;
      previewURL = URL.createObjectURL(overview);
      const image = el<HTMLImageElement>("receive-preview-image");
      image.src = previewURL;
      await image.decode();
      if (version !== previewVersion) return;
      const preview = el("receive-preview");
      preview.style.aspectRatio = `${map.width} / ${map.height}`;
      const svg = el("receive-preview-overlay");
      svg.setAttribute("viewBox", `0 0 ${map.width} ${map.height}`);
      const append = (tag: string, attributes: Record<string, string>) => {
        const node = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
        svg.append(node);
      };
      const stroke = String(Math.max(map.width, map.height) / 150);
      for (const route of received.manifest.routes)
        append("polyline", { points: route.points.map((point) => `${point.x},${point.y}`).join(" "), fill: "none", stroke: "#38d6ff", "stroke-width": stroke });
      for (const marker of received.manifest.markers)
        append("circle", { cx: String(marker.point.x), cy: String(marker.point.y), r: stroke, fill: "#ff9a5c", stroke: "#000", "stroke-width": String(Number(stroke) / 3) });
      preview.hidden = false;
      confirm.disabled = false;
      updateImportButton();
    } catch (error) {
      if (version === previewVersion) {
        showError("receive-error", new Error(`Map preview unavailable. ${errorMessage(error)}`));
        // Manual matching requires a visible preview, not a blind confirmation.
        if (!exact) el<HTMLInputElement>("receive-confirm").disabled = true;
        updateImportButton();
      }
    }
  };
  function updateImportButton() {
    const newCopy = destination.value === "new";
    const existing = maps.some((map) => map.id === destination.value);
    const exact = matches.includes(destination.value);
    el<HTMLButtonElement>("receive-import").disabled = receiving || !received ||
      (newCopy ? !(received.image || suppliedImage.files?.[0]) : !existing || (!exact && (!confirm.checked || confirm.disabled)));
  }
  destination.addEventListener("change", () => {
    confirm.disabled = false;
    void updateDestination();
  });
  suppliedImage.addEventListener("change", updateImportButton);
  confirm.addEventListener("change", updateImportButton);
  el("receive-cancel").addEventListener("click", () => receiveDialog.close());
  receiveDialog.addEventListener("cancel", (event) => { if (receiving) event.preventDefault(); });
  receiveDialog.addEventListener("close", () => {
    receiveVersion++;
    matching?.abort();
    received = undefined;
    suppliedImage.value = "";
    clearPreview();
  });
  el("receive-import").addEventListener("click", async () => {
    if (!received || receiving || el<HTMLButtonElement>("receive-import").disabled) return;
    receiving = true;
    updateImportButton();
    el("receive-error").hidden = true;
    el<HTMLButtonElement>("receive-cancel").disabled = true;
    destination.disabled = true;
    suppliedImage.disabled = true;
    confirm.disabled = true;
    try {
      const newCopy = destination.value === "new";
      const result = await options.import(received, {
        ...(newCopy ? { image: received.image ?? suppliedImage.files?.[0] } : { mapId: destination.value }),
        allowDifferentImage: !newCopy && !matches.includes(destination.value),
      });
      receiveDialog.close();
      await options.imported(result);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) showError("receive-error", error);
    } finally {
      receiving = false;
      el<HTMLButtonElement>("receive-cancel").disabled = false;
      destination.disabled = false;
      suppliedImage.disabled = false;
      confirm.disabled = false;
      updateImportButton();
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
    clearPreview();
    updateImportButton();
    if (!receiveDialog.open) receiveDialog.showModal();
    try {
      const parsed = await readShare(input);
      if (version !== receiveVersion) return;
      const share = parsed.manifest;
      el("receive-summary").textContent = `${share.map.name}\n${share.markers.length} places · ${share.routes.length} routes · ${parsed.image ? "Map image included" : "Annotations only"}`;
      const available = (await options.maps()).filter((map) => map.status === "ready" && map.width === share.map.width && map.height === share.map.height);
      const exact = await matchingMaps(share, available, controller.signal);
      if (version !== receiveVersion) return;
      maps = available;
      matches = exact;
      received = parsed;
      destination.replaceChildren();
      const addOption = (value: string, label: string) => {
        const option = root.ownerDocument.createElement("option");
        option.value = value;
        option.textContent = label;
        destination.append(option);
      };
      addOption("new", "Create a separate copy");
      for (const map of maps) addOption(map.id, `${map.name}${matches.includes(map.id) ? " · exact match" : " · check alignment"}`);
      destination.value = matches[0] ?? "new";
      confirm.disabled = false;
      el("receive-content").hidden = false;
      await updateDestination();
    } catch (error) {
      if (version === receiveVersion) showError("receive-error", error);
    } finally {
      if (version === receiveVersion) el("receive-loading").hidden = true;
    }
  }
  shareInput.addEventListener("change", () => {
    const file = shareInput.files?.[0];
    shareInput.value = "";
    if (file) void openImport(file);
  });
  return {
    importFile: () => shareInput.click(),
    openImport,
    async openExport(map: MapRecord, state: NavigationState, initial?: { kind: "marker" | "route"; id: string }) {
      if (exporting) return;
      const version = ++exportVersion;
      prepared = undefined;
      file = undefined;
      items.replaceChildren();
      el("share-map-name").textContent = map.name;
      el("share-loading").hidden = false;
      el("share-content").hidden = true;
      el("share-error").hidden = true;
      exportBusy(false);
      if (!sendDialog.open) sendDialog.showModal();
      try {
        const data = await prepareExport(map, state);
        if (version !== exportVersion) return;
        prepared = data;
        includeImage.checked = !initial && data.markers.length + data.routes.length === 0;
        for (const [kind, entries] of [["marker", data.markers], ["route", data.routes]] as const)
          for (const item of entries) {
            const label = root.ownerDocument.createElement("label");
            label.className = "share-choice";
            const input = root.ownerDocument.createElement("input");
            input.type = "checkbox";
            input.value = item.id;
            input.dataset.kind = kind;
            input.checked = !initial || (initial.kind === kind && initial.id === item.id);
            const span = root.ownerDocument.createElement("span");
            span.textContent = `${kind === "marker" ? "Place" : "Route"} · ${"label" in item ? item.label : item.name}`;
            label.append(input, span);
            items.append(label);
          }
        el("share-selection").hidden = !items.childElementCount;
        if (!items.childElementCount) {
          const note = root.ownerDocument.createElement("p");
          note.textContent = "No saved annotations yet. You can share the map image.";
          items.append(note);
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
