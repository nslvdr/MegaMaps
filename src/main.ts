import "./style.css";
import { tileKey, type MapRecord } from "./types";
import { listMaps, renameMap } from "./storage/database";
import { payloadStore, deleteStoredMap } from "./storage/payloads";
import { importMap } from "./processing/import";
import { Viewer } from "./viewer/viewer";
import { registerOfflineShell } from "./pwa";
import { checkForAppUpdate } from "./app-update";
import { icons } from "./ui/icons";
import { formatBytes } from "./ui/format";
import { viewerMarkup } from "./ui/viewer-markup";
import { ViewerControls } from "./ui/viewer-controls";
import { loadNavigation, lastMap, setLastMap } from "./storage/navigation";
import { initLibraryFooter } from "./ui/library-footer";
import { initMapRename, mapRenameMarkup } from "./ui/map-rename";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main class="home" id="home">
    <header class="header"><div class="library-brand"><img class="library-logo" src="/icons/icon.svg" alt="" width="48" height="48"><h1>Mega Maps</h1></div><button class="update-app" id="update-app">${icons.rotateRight}<span>Update app</span></button></header>
    <div class="library-actions"><button class="library-action import-trigger">${icons.plus}<span>Import map</span></button></div>
    <section class="library" aria-labelledby="library-title"><div class="section-heading"><h2 id="library-title">Your maps <span id="map-count">0</span></h2></div><div class="map-list" id="map-grid"></div><div class="empty" id="empty" hidden><span class="empty-icon">${icons.map}</span><h3>Your next route starts here</h3><p>Import a JPEG, PNG or WebP map.<br>Keep it with you, even offline.</p></div></section>
    <footer class="library-footer"><div class="app-updated"><span>Last app update</span><time id="app-updated-at">Checking…</time></div><div class="connection-status" role="status" aria-live="polite"><span id="internet-status">Checking connection…</span><span id="app-availability">Checking live app…</span><span id="offline-availability">Checking offline app…</span></div></footer>
  </main>
  <section id="viewer" class="viewer" aria-label="Map viewer" hidden>${viewerMarkup}</section>
  <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden>
  <dialog id="progress-dialog"><div class="dialog-icon">${icons.map}</div><h2 id="progress-title">Preparing map</h2><p id="import-name"></p><div class="progress-track"><div id="progress-fill"></div></div><div class="progress-info"><span id="progress-message">Reading image…</span><span id="progress-percent">0%</span></div><p class="dialog-note" id="progress-note">Keep Mega Maps open while your map is prepared.</p><button class="secondary" id="cancel-import">Cancel import</button></dialog>
  <dialog id="message-dialog"><h2 id="message-title"></h2><p id="message-body"></p><button class="primary" id="message-close">Got it</button></dialog>
  <dialog id="delete-dialog"><h2>Delete this map?</h2><p id="delete-name"></p><p class="dialog-note">This removes the local copy and its tiles from this device.</p><div class="dialog-actions"><button class="secondary" id="delete-cancel">Keep map</button><button class="danger" id="delete-confirm">Delete map</button></div></dialog>
  ${mapRenameMarkup}
`;
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const home = element("home"),
  viewerSection = element("viewer"),
  grid = element("map-grid");
const fileInput = element<HTMLInputElement>("file-input");
const progressDialog = element<HTMLDialogElement>("progress-dialog");
const messageDialog = element<HTMLDialogElement>("message-dialog");
const deleteDialog = element<HTMLDialogElement>("delete-dialog");
const refreshFooter = initLibraryFooter(home);
let controls: ViewerControls | undefined;
let pendingViewSave = Promise.resolve();
let openVersion = 0;
let updating = false;
let viewer: Viewer | undefined,
  currentMap: MapRecord | undefined,
  maps: MapRecord[] = [];
let importing: AbortController | undefined,
  deleting: MapRecord | undefined,
  thumbnailURLs: string[] = [],
  renderVersion = 0;
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("map-viewer-library")
    : undefined;
const openRenameMap = initMapRename(
  element<HTMLDialogElement>("rename-map-dialog"),
  async (id, name) => {
    await mutate(async () => {
      await renameMap(id, name);
      channel?.postMessage("changed");
    });
    await refresh();
  },
);
function showMessage(title: string, message: string) {
  element("message-title").textContent = title;
  element("message-body").textContent = message;
  if (!messageDialog.open) messageDialog.showModal();
}
// An origin-wide lock prevents launch cleanup from racing another tab's import.
async function mutate<T>(work: () => Promise<T>): Promise<T | undefined> {
  if (navigator.locks)
    return navigator.locks.request(
      "map-viewer-storage",
      { ifAvailable: true },
      (lock) => {
        if (!lock)
          throw new Error(
            "Mega Maps is preparing a map in another window. Let it finish first.",
          );
        return work();
      },
    );
  return work();
}
function closeViewer() {
  openVersion++;
  if (controls) pendingViewSave = controls.dispose();
  controls = undefined;
  viewer?.dispose();
  viewer = undefined;
  currentMap = undefined;
  void setLastMap(null).catch((error) =>
    showMessage("Could not save home view", String(error)),
  );
  viewerSection.hidden = true;
  home.hidden = false;
  void refreshFooter();
  document.body.classList.remove("viewing");
  void refresh().catch((error) =>
    showMessage("Storage unavailable", String(error)),
  );
}
async function openMap(map: MapRecord) {
  const version = ++openVersion;
  if (controls) pendingViewSave = controls.dispose();
  controls = undefined;
  viewer?.dispose();
  viewer = undefined;
  currentMap = map;
  home.hidden = true;
  viewerSection.hidden = false;
  document.body.classList.add("viewing");
  element("viewer-error").hidden = true;
  try {
    // Reopening immediately must read the completed save, not the last throttle tick.
    await pendingViewSave;
    if (version !== openVersion) return;
    const state = await loadNavigation(map.id);
    if (version !== openVersion) return;
    controls = new ViewerControls(viewerSection, map, state);
    viewer = new Viewer(
      element<HTMLCanvasElement>("map-canvas"),
      map,
      () => {}, // No zoom readout: the map is the only thing on screen.
      (message) => {
        element("viewer-error").textContent = message;
        element("viewer-error").hidden = false;
      },
      controls.options(),
    );
    controls.attach(viewer);
    element("map-canvas").focus();
    await setLastMap(map.id);
  } catch (error) {
    if (version === openVersion) {
      closeViewer();
      showMessage("Could not open map", String(error));
    }
  }
}
async function refresh() {
  const version = ++renderVersion;
  const records = await listMaps();
  if (version !== renderVersion) return;
  maps = records
    .filter((m) => m.status === "ready")
    .sort((a, b) => b.created - a.created);
  if (currentMap && !maps.some((m) => m.id === currentMap!.id)) {
    closeViewer();
    showMessage("Map removed", "This map was removed in another window.");
    return;
  }
  if (currentMap) {
    const updated = maps.find((map) => map.id === currentMap!.id);
    if (updated) {
      Object.assign(currentMap, updated);
      controls?.refreshMetadata();
    }
  }
  for (const url of thumbnailURLs) URL.revokeObjectURL(url);
  thumbnailURLs = [];
  grid.replaceChildren();
  element("empty").hidden = maps.length > 0;
  element("map-count").textContent = `${maps.length}`;
  for (const map of maps) {
    const card = document.createElement("article");
    card.className = "map-card";
    card.innerHTML = `<button class="map-open"><div class="thumbnail"><span class="thumbnail-placeholder">${icons.map}</span></div><div class="map-details"><h3></h3><p class="dimensions"></p><p class="map-size"></p></div></button><div class="map-actions"><button class="rename-map" title="Rename map">${icons.edit}</button><button class="delete-map" title="Delete map">${icons.trash}</button></div>`;
    card.querySelector("h3")!.textContent = map.name;
    card.querySelector(".dimensions")!.textContent =
      `${map.width.toLocaleString()} × ${map.height.toLocaleString()} px`;
    card.querySelector(".map-size")!.textContent =
      formatBytes(map.bytes);
    card.querySelector(".map-open")!.addEventListener("click", () => {
      void openMap(map);
    });
    const rename = card.querySelector<HTMLButtonElement>(".rename-map")!;
    rename.setAttribute("aria-label", `Rename ${map.name}`);
    rename.addEventListener("click", () => openRenameMap(map));
    card
      .querySelector(".delete-map")!
      .setAttribute("aria-label", `Delete ${map.name}`);
    card.querySelector(".delete-map")!.addEventListener("click", () => {
      deleting = map;
      element("delete-name").textContent = map.name;
      deleteDialog.showModal();
    });
    grid.append(card);
    void payloadStore(map.backend)
      .get(map.id, tileKey(map.levels.length - 1, 0, 0))
      .then((blob) => {
        if (version !== renderVersion) return;
        const url = URL.createObjectURL(blob);
        thumbnailURLs.push(url);
        const img = new Image();
        img.src = url;
        img.alt = "";
        img.loading = "lazy";
        card.querySelector(".thumbnail")!.prepend(img);
      })
      .catch(() => {
        card.querySelector(".thumbnail-placeholder")!.textContent =
          "Preview unavailable";
      });
  }
}
for (const button of document.querySelectorAll(".import-trigger"))
  button.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file || importing) return;
  importing = new AbortController();
  const controller = importing;
  element("progress-title").textContent = "Preparing map";
  element("progress-note").textContent =
    "Keep Mega Maps open while your map is prepared.";
  element("cancel-import").textContent = "Cancel import";
  element("import-name").textContent = file.name;
  element("progress-fill").style.width = "0%";
  element("progress-percent").textContent = "0%";
  element("progress-message").textContent = "Reading image metadata…";
  progressDialog.showModal();
  void mutate(async () => {
    await importMap(
      file,
      (progress) => {
        element("progress-fill").style.width = `${progress.fraction * 100}%`;
        element("progress-percent").textContent =
          `${Math.round(progress.fraction * 100)}%`;
        element("progress-message").textContent = progress.message;
      },
      controller.signal,
    );
    channel?.postMessage("changed");
  })
    .then(async () => {
      await refresh();
    })
    .catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        showMessage(
          "Couldn’t import this map",
          error instanceof Error ? error.message : String(error),
        );
    })
    .finally(() => {
      progressDialog.close();
      importing = undefined;
    });
});
element("cancel-import").addEventListener("click", () => {
  importing?.abort();
});
progressDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  importing?.abort();
});
element("message-close").addEventListener("click", () => messageDialog.close());
messageDialog.addEventListener("cancel", (event) => {
  if (updating) event.preventDefault();
});
element("update-app").addEventListener("click", () => void updateApp());

// Keep the current map/session and wait for durable saves before reloading.
async function updateApp() {
  if (updating) return;
  if (importing) {
    showMessage("App update", "Finish the current import, then try again.");
    return;
  }
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    showMessage("App update", "App updates are available in the installed app or on the live HTTPS site.");
    return;
  }
  updating = true;
  const close = element<HTMLButtonElement>("message-close");
  close.disabled = true;
  showMessage("Checking for updates", "Keep the app open while the update downloads. Your saved maps, places and routes are kept.");
  try {
    await mutate(async () => {
      const loadedVersion = document.querySelector<HTMLMetaElement>('meta[name="app-build"]')?.content ?? "";
      if (!(await checkForAppUpdate(loadedVersion))) {
        showMessage("You’re up to date", "You already have the latest version. Your saved data is unchanged.");
        return;
      }
      await pendingViewSave;
      await controls?.prepareForUpdate();
      showMessage("Update ready", "Your changes are saved. Reloading…");
      window.location.reload();
    });
  } catch (error) {
    showMessage("Couldn’t update the app", `${error instanceof Error ? error.message : String(error)} You can keep using the current app and try again later.`);
  } finally {
    updating = false;
    close.disabled = false;
  }
}
element("delete-cancel").addEventListener("click", () => deleteDialog.close());
element("delete-confirm").addEventListener("click", () => {
  const map = deleting;
  if (!map) return;
  deleteDialog.close();
  deleting = undefined;
  void mutate(async () => {
    await deleteStoredMap(map);
    channel?.postMessage("changed");
  })
    .then(() => refresh())
    .catch((error) => showMessage("Couldn’t delete map", String(error)));
});
element("back").addEventListener("click", closeViewer);
document.addEventListener("keydown", (event) => {
  if (
    !viewer ||
    document.querySelector("dialog[open]") ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(
      (event.target as HTMLElement).tagName,
    )
  )
    return;
  if (event.key === "Escape" && !controls?.escape()) closeViewer();
  if (event.key === "0" || event.key.toLowerCase() === "f") viewer.fit();
});
channel?.addEventListener("message", () => {
  if (!importing)
    void refresh().catch((error) =>
      showMessage("Storage unavailable", String(error)),
    );
});
void registerOfflineShell().then(refreshFooter);
async function start() {
  await mutate(async () => {
    for (const map of await listMaps())
      if (map.status !== "ready") await deleteStoredMap(map);
  }).catch(() => {}); // Another tab may legitimately be importing; don't touch its files.
  await refresh();
  const resume = await lastMap();
  const map = maps.find((map) => map.id === resume);
  if (map) await openMap(map);
}
void start().catch((error) =>
  showMessage(
    "Local storage unavailable",
    error instanceof Error ? error.message : String(error),
  ),
);
Object.defineProperty(window, "MapViewer", {
  value: {
    diagnostics: () => viewer?.diagnostics() ?? null,
    library: () => maps.map((m) => ({ ...m })),
  },
  configurable: true,
});
