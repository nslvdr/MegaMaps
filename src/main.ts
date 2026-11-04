import { flushSync, mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { showDialog } from "./ui/dialog";
import type { MapRecord } from "./types";
import { listMaps, markOpened, renameMap } from "./storage/database";
import { deleteAllData, deleteStoredMap } from "./storage/payloads";
import { importMap } from "./processing/import";
import { startRetiling } from "./processing/retile";
import { Viewer } from "./viewer/viewer";
import { registerOfflineShell } from "./pwa";
import { findAppUpdate, installAppUpdate } from "./app-update";
import { icons } from "./ui/icons";
import { displayName, plural, timeLeft } from "./ui/format";
import { ViewerControls } from "./ui/viewer-controls.svelte";
import { loadNavigation, lastMap, setLastMap } from "./storage/navigation";
import { prunePhotos } from "./storage/photos";
import { initFieldLift, initKeyboardInset, initTapAway } from "./ui/keyboard-inset";
import { lockPageZoom } from "./ui/page-zoom";
import { loadOcr } from "./storage/ocr";
import { needsOcr, type OcrIndex } from "./ocr/index";
import { detectMapText, ocrWorkerCount } from "./ocr/detect";
import { ocrCrops } from "./ocr/scan";
import { backupDue, isBackupFile, restoreBackup, type Backup } from "./storage/backup";
import { loadSetting } from "./storage/settings";
import { protectStorage, storageProtected } from "./storage/protection";
import { language, locale, t, errorMessage } from "./i18n";
import { preference, resetPreferences, setPreference } from "./preferences";
import { importAnnotations, importNewCopy } from "./sharing/storage";
import { isShareFile } from "./sharing/format";
import { isInstalled } from "./ui/InstallPage.svelte";
import { appDetails, describeApp, helpUrl, initHelp } from "./ui/help";
import { app, type Page } from "./ui/app-state.svelte";
import { forgetThumbnail, loadedThumbnails } from "./ui/thumbnails";
import type { SheetIcon } from "./ui/ActionSheet.svelte";
import type { ShareDestination, ShareImportResult } from "./ui/ReceiveDialog.svelte";
import type { SharedMap } from "./sharing/format";
import { failure, setPerson, startStats, track } from "./stats";

document.documentElement.lang = language;
document.documentElement.dataset.labels = preference("label-size");
const loadedVersion = document.querySelector<HTMLMetaElement>('meta[name="app-build"]')?.content ?? "";
const loadedRelease = new Date(document.querySelector<HTMLMetaElement>('meta[name="app-built-at"]')?.content ?? "");
// Stamped together with the date, so a known date means a real name, not the placeholder.
const releaseName = Number.isFinite(loadedRelease.getTime())
  ? document.querySelector<HTMLMetaElement>('meta[name="app-release"]')?.content
  : undefined;
// The dev site (`npm run build:dev`) is for trying changes: it sends no stats.
const released = import.meta.env.PROD && import.meta.env.MODE !== "dev";
// Maps imported in a browser tab stay there, so a tab only shows how to install, and sends nothing.
const inTab = import.meta.env.PROD && !isInstalled();
if (released && !inTab) startStats(releaseName ?? loadedVersion);
const canUpdate = import.meta.env.PROD && "serviceWorker" in navigator;
app.page = inTab ? "install" : "home";

let selectedMap: MapRecord | undefined;
let ocrJob:
  | {
      mapId: string;
      controller: AbortController;
      message: string;
      fraction: number;
      /** Roughly how long the scan has left, once it can tell. */
      left: string;
      done: Promise<void>;
    }
  | undefined;
const ocrErrors = new Map<string, string>();
// Versions installed automatically this session, so a failed one waits for a tap instead of retrying.
const autoInstalled = new Set<string>();
let controls: ViewerControls | undefined;
let pendingViewSave = Promise.resolve();
let openVersion = 0;
let viewer: Viewer | undefined,
  currentMap: MapRecord | undefined,
  maps: MapRecord[] = [];
let importing: AbortController | undefined,
  deleting: MapRecord | undefined,
  renderVersion = 0;
/** While the example map is being added; a map picked meanwhile waits for it. */
let preparingExample: Promise<void> | undefined;
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("map-viewer-library")
    : undefined;

const root = document.querySelector<HTMLDivElement>("#app")!;
const { parts } = mount(App, {
  target: root,
  props: {
    library: {
      dev: import.meta.env.MODE !== "production",
      saving: () => pendingViewSave,
      open: (map) => void openMap(map),
      more: mapActions,
      openSettings: showSettings,
      importFile: (file) => void importFile(file),
      canDrop,
      answerExample,
      // The footer checks quietly while the library shows; Settings mirrors its answer.
      // Unless Settings asks first, a found update installs by itself once nothing else is going on.
      findUpdate: canUpdate
        ? async () => {
            if (updates.isBusy()) return true;
            const update = await findAppUpdate(loadedVersion);
            settings.setUpdateReady(Boolean(update));
            if (update && preference("update-install") === "auto" && !autoInstalled.has(update.version)
              && !importing && !ocrJob && app.page === "home" && !document.querySelector("dialog[open]")) {
              autoInstalled.add(update.version);
              updates.start(update);
            }
            return Boolean(update);
          }
        : undefined,
      onupdate: openUpdates,
    },
    dialogs: {
      importFile: (file) => void importFile(file),
      cancelImport: () => importing?.abort(),
      deleteMap,
      rerunOcr,
      stopOcr: () => {
        if (ocrJob?.mapId === selectedMap?.id) ocrJob?.controller.abort();
      },
      startOcr: () => { offerAccepted = true; },
    },
    settings: {
      release: releaseName,
      back: hideSettings,
      checkUpdates: openUpdates,
      openWhatsNew: () => whatsNew.openAll(),
      restore: (backup) => void restore(backup),
      erase: (what) => void (what === "app" ? reset() : erase()),
      setLabelSize: (size) => { document.documentElement.dataset.labels = size; },
    },
    // Ask before downloading; keep the current map/session and wait for durable saves before reloading.
    updates: {
      currentRelease: Number.isFinite(loadedRelease.getTime()) ? loadedRelease : undefined,
      find: () => findAppUpdate(loadedVersion),
      install: (report) => mutate(async () => {
        if (importing || ocrJob) throw new Error(t("Mega Maps started preparing a map. Let it finish, then try again."));
        const installed = await installAppUpdate(loadedVersion, (progress) => report({ step: "download", ...progress }));
        if (!installed) return false;
        report({ step: "save" });
        await pendingViewSave;
        await controls?.prepareForUpdate();
        return true;
      }),
      restart: () => window.location.reload(),
    },
    welcome: {
      hasExample: () => preparingExample !== undefined || maps.some((map) => map.example),
      openExample: () => void openExample(),
    },
    rename: {
      save: async (id, name) => {
        await mutate(async () => {
          await renameMap(id, name);
          channel?.postMessage("changed");
        });
        await refresh();
      },
    },
    receive: { maps: listMaps, import: importShare, imported: sharedImported },
    closeMap: () => closeViewer(),
  },
});
flushSync();
const { home, settings, updates, welcome, whatsNew, share, receive } = parts();
const refreshFooter = () => home.refreshFooter();
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const progressDialog = element<HTMLDialogElement>("progress-dialog");
const messageDialog = element<HTMLDialogElement>("message-dialog");
const deleteDialog = element<HTMLDialogElement>("delete-dialog");
const advancedDialog = element<HTMLDialogElement>("advanced-map-dialog");
const ocrOfferDialog = element<HTMLDialogElement>("ocr-offer-dialog");
initHelp(root, describeApp(releaseName ?? loadedVersion, isInstalled()));

function showMessage(title: string, message: string, problem = false, detail = message) {
  app.message = { title, body: message, report: problem ? helpUrl("problem", appDetails(), { title, error: detail }) : "" };
  if (!messageDialog.open) showDialog(messageDialog);
}
// Something went wrong: say what, and offer to report it with the browser's own words filled in.
function showError(title: string, error: unknown) {
  showMessage(title, errorMessage(error), true, failure(error));
}
/** Opens the progress dialog for a long task. */
function startProgress(title: string, icon: string, note: string, name: string, message: string) {
  Object.assign(app.progress, { title, icon, note, name });
  showProgress(0, message);
  showDialog(progressDialog);
}

async function importShare(share: SharedMap, destination: ShareDestination): Promise<ShareImportResult> {
  if (importing || updates.isBusy()) throw new Error(t("Finish the current operation before importing a share."));
  await pendingViewSave;
  const controller = new AbortController();
  importing = controller;
  startProgress(t("Importing shared map"), icons.download, t("Keep Mega Maps open while the share is imported."),
    displayName(share.manifest.map.name), t("Checking shared map…"));
  try {
    const result = await mutate(async () => {
      if (destination.mapId) {
        controller.signal.throwIfAborted();
        const counts = await importAnnotations(destination.mapId, share.manifest, destination.mode, controller.signal, share.photos, share.ocr);
        const map = (await listMaps()).find((map) => map.id === destination.mapId);
        if (!map) throw new Error(t("This map is no longer available."));
        return { map, ...counts };
      }
      if (!destination.image) throw new Error(t("Choose the original map image to create a copy."));
      return importNewCopy(share, destination.image, (progress) =>
        showProgress(progress.fraction * 100, progress.message), controller.signal);
    });
    channel?.postMessage({ type: "annotations", mapId: result.map.id });
    return result;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      track("share_imported", { ok: false, into: destination.mapId ? destination.mode : "new", error: failure(error) });
    throw error;
  } finally {
    progressDialog.close();
    importing = undefined;
  }
}
async function sharedImported(result: ShareImportResult, destination: ShareDestination) {
  track("share_imported", { ok: true, into: destination.mapId ? destination.mode : "new", items: result.added });
  await refresh();
  await openMap(result.map);
  if (!destination.mapId) {
    showMessage(t("Share imported"), t("{items} added to a new map.", { items: plural(result.added, "item") }));
    // A share without its text scan asks once its summary is read.
    if (needsOcr(await loadOcr(result.map.id).catch(() => undefined)))
      messageDialog.addEventListener("close", () => {
        if (currentMap?.id === result.map.id) offerTextDetection(result.map);
      }, { once: true });
  }
  else if (destination.mode === "replace")
    showMessage(t("Share imported"), t("{removed} removed · {added} added.", { removed: plural(result.removed ?? 0, "item"), added: plural(result.added, "shared item") }));
  else if (result.updated)
    showMessage(t("Share imported"), t("{added} added · {updated} with new history · {skipped} already imported and skipped.\nYour existing annotations and local edits were kept.", { added: plural(result.added, "item"), updated: plural(result.updated, "place"), skipped: result.skipped }));
  else showMessage(t("Share imported"), t("{added} added · {skipped} already imported and skipped.\nYour existing annotations and local edits were kept.", { added: plural(result.added, "item"), skipped: result.skipped }));
}

// Flush pending edits before taking the independent export snapshot.
async function shareMap(map: MapRecord, item?: { kind: "marker" | "route"; id: string }) {
  try {
    await pendingViewSave;
    await controls?.prepareForUpdate();
    await share.openExport(map, await loadNavigation(map.id), item);
  } catch (error) {
    showError(t("Could not prepare share"), error);
  }
}
// An origin-wide lock prevents launch cleanup from racing another tab's import.
// Recutting maps steps aside for any change and resumes after it. With `wait`,
// work another window holds storage for waits its turn, until it is cancelled.
async function mutate<T>(work: () => Promise<T>, wait?: { signal: AbortSignal; waiting: () => void }): Promise<T> {
  await stopRetiling();
  try {
    if (!navigator.locks) return await work();
    const held = await navigator.locks.request("map-viewer-storage", { ifAvailable: true },
      async (lock) => lock ? { result: await work() } : undefined);
    if (held) return held.result;
    if (!wait)
      throw new Error(t("Mega Maps is preparing a map in another window. Let it finish first."));
    wait.waiting();
    return await navigator.locks.request("map-viewer-storage", { signal: wait.signal }, work);
  } finally {
    retileMaps();
  }
}
let retiling: ReturnType<typeof startRetiling> | undefined;
// Maps in older tile formats are quietly recut; the open map and its text scan are left alone.
function retileMaps() {
  if (retiling || !navigator.locks) return;
  const job = startRetiling(
    (id) => id === currentMap?.id || id === ocrJob?.mapId,
    (id) => forgetThumbnail(id, false),
  );
  retiling = job;
  void job.done.then(() => {
    if (retiling === job) retiling = undefined;
  });
}
async function stopRetiling() {
  const job = retiling;
  retiling = undefined;
  await job?.stop();
}
const appTitle = document.title;
/** The open map names the tab and the app switcher entry. */
function showTitle() {
  document.title = currentMap ? `${displayName(currentMap.name)} · ${appTitle}` : appTitle;
}
/** Shows a page at once, so what measures or scrolls it finds it laid out. */
function showPage(page: Page) {
  app.page = page;
  flushSync();
}
// Going home returns to the same place in the list, on the map just closed.
let libraryScroll = 0;
function closeViewer() {
  openVersion++;
  const closed = currentMap?.id;
  if (controls) pendingViewSave = controls.dispose();
  controls = app.controls = undefined;
  viewer?.dispose();
  viewer = undefined;
  currentMap = undefined;
  showTitle();
  void setLastMap(null).catch((error) =>
    showError(t("Could not save home view"), error),
  );
  showPage("home");
  void refreshFooter();
  retileMaps();
  document.body.classList.remove("viewing");
  void refresh()
    .then(() => {
      flushSync();
      // The map just left now leads the list; the library opens at it.
      if (app.page === "home") window.scrollTo(0, maps[0]?.id === closed ? 0 : libraryScroll);
    })
    .catch((error) => showError(t("Storage unavailable"), error));
}
async function openMap(map: MapRecord) {
  const version = ++openVersion;
  if (controls) pendingViewSave = controls.dispose();
  controls = app.controls = undefined;
  viewer?.dispose();
  viewer = undefined;
  if (app.page === "home") libraryScroll = window.scrollY;
  currentMap = map;
  if (retiling?.mapId === map.id) void stopRetiling();
  map.opened = Date.now();
  void markOpened(map.id, map.opened).catch(() => {});
  showTitle();
  showPage("viewer");
  document.body.classList.add("viewing");
  const started = Date.now();
  try {
    // Reopening immediately must read the completed save, not the last throttle tick.
    await pendingViewSave;
    if (version !== openVersion) return;
    const state = await loadNavigation(map.id);
    if (version !== openVersion) return;
    void prunePhotos(map.id).catch(() => {});
    controls = app.controls = new ViewerControls(element("viewer"), map, state, (item) => { void shareMap(map, item); });
    // Its controls are on the page before the map draws under them.
    flushSync();
    // A broken map is a big error: say so once, not for every unreadable tile.
    let reported = false;
    viewer = new Viewer(
      element<HTMLCanvasElement>("map-canvas"),
      map,
      // No zoom readout: the map is the only thing on screen.
      () => {},
      (message) => {
        if (!reported) showError(t("Couldn’t show this map"), message);
        reported = true;
      },
      controls.options(),
    );
    controls.attach(viewer);
    track("map_opened", { ok: true, example: !!map.example, megapixels: Math.round(map.width * map.height / 1e6),
      places: state.markers.length, routes: state.routes.length, ms: Date.now() - started });
    void prepareMapSearch(map, version);
    await setLastMap(map.id);
  } catch (error) {
    if (version === openVersion) {
      track("map_opened", { ok: false, error: failure(error) });
      closeViewer();
      showError(t("Could not open map"), error);
    }
  }
}
function confirmDelete(map: MapRecord) {
  deleting = map;
  app.deleting = map;
  app.deleteNote = t("This removes the map and its saved routes and places from this device.");
  showDialog(deleteDialog);
  // Name what would be lost, so an empty map reads as a light delete.
  void loadNavigation(map.id)
    .then(({ markers, routes }) => {
      if (deleting !== map) return;
      const saved = [
        markers.length && plural(markers.length, "place"),
        routes.length && plural(routes.length, "route"),
      ].filter(Boolean);
      app.deleteNote = saved.length
        ? t("This removes the map and its {saved} from this device.", { saved: saved.join(t(" and ")) })
        : t("This removes the map from this device.");
    })
    .catch(() => {});
}
function deleteMap() {
  const map = deleting;
  if (!map) return;
  deleteDialog.close();
  deleting = undefined;
  const job = ocrJob?.mapId === map.id ? ocrJob : undefined;
  job?.controller.abort();
  void (job?.done ?? Promise.resolve())
    .then(() =>
      mutate(async () => {
        await deleteStoredMap(map);
        channel?.postMessage("changed");
      }),
    )
    .then(() => refresh())
    .catch((error) => showError(t("Couldn’t delete map"), error));
}
// A map's ⋯: what it takes on the device, then its actions, with Delete apart.
function mapActions(map: MapRecord, detail: string, icon: SheetIcon) {
  Object.assign(app.sheet, {
    open: true,
    title: displayName(map.name),
    detail,
    icon,
    actions: [
      { label: t("Share"), icon: icons.share, action: () => { void shareMap(map); } },
      { label: t("Rename"), icon: icons.edit, action: () => parts().rename.open(map) },
      {
        label: t("Advanced settings"),
        icon: icons.tools,
        action: () => {
          selectedMap = map;
          app.advanced = { map, status: t("Checking text detection…"), scanned: false, running: false, blocked: true };
          showDialog(advancedDialog);
          void renderOcrSettings();
        },
      },
      { label: t("Delete"), icon: icons.trash, danger: true, action: () => confirmDelete(map) },
    ],
  });
}
async function refresh() {
  const version = ++renderVersion;
  const records = await listMaps();
  if (version !== renderVersion) return;
  maps = records
    .filter((m) => m.status === "ready")
    .sort((a, b) => (b.opened ?? b.created) - (a.opened ?? a.created));
  app.maps = maps;
  app.exampleOffer = maps.some((map) => map.example) && maps.some((map) => !map.example)
    && preference("example-offer") !== "seen";
  if (currentMap && !maps.some((m) => m.id === currentMap!.id)) {
    closeViewer();
    showMessage(t("Map removed"), t("This map was removed in another window."));
    return;
  }
  if (currentMap) {
    const updated = maps.find((map) => map.id === currentMap!.id);
    if (updated) {
      Object.assign(currentMap, updated);
      showTitle();
      controls?.refreshMetadata();
      void loadOcr(updated.id)
        .then((index) => {
          const job = ocrJob?.mapId === updated.id ? ocrJob : undefined;
          if (currentMap?.id === updated.id)
            controls?.updateOcr(
              index,
              job?.message ?? ocrErrors.get(updated.id),
              job?.fraction,
              job?.left,
            );
        })
        .catch(() => {});
    }
  }
  for (const id of [...loadedThumbnails.keys()])
    if (!maps.some((map) => map.id === id)) forgetThumbnail(id);
  if (app.page === "home") void showBackupReminder();
}
// Asked once: removing goes through the usual delete, keeping just hides it.
function answerExample(remove: boolean) {
  setPreference("example-offer", "seen");
  app.exampleOffer = false;
  track("example_offer_answered", { remove });
  const example = maps.find((map) => map.example);
  if (remove && example) confirmDelete(example);
}
async function importFile(file: File) {
  await preparingExample;
  if (importing) return;
  if (await isShareFile(file).catch(() => false)) void receive.openImport(file);
  else if (await isBackupFile(file).catch(() => false))
    void settings.review(file).catch((error) => showError(t("Couldn’t read this backup"), error));
  else importImage(file);
}
// Desktop: a map or .megamap file dropped on the library imports like Import.
// Anywhere else, a dropped file must not replace the app with the raw image.
function canDrop() {
  return app.page === "home" && !importing && !document.querySelector("dialog[open]");
}
for (const type of ["dragover", "drop"] as const)
  window.addEventListener(type, (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
// Pasting a copied image or screenshot imports it too.
document.addEventListener("paste", (event) => {
  let file = event.clipboardData?.files[0];
  if (!file || !canDrop()) return;
  event.preventDefault();
  // Screenshots arrive as "image.png"; a dated name tells them apart.
  if (/^image\.\w+$/i.test(file.name)) {
    const date = new Date().toLocaleDateString(locale, { dateStyle: "medium" });
    file = new File([file], `${t("Pasted map {date}", { date })}${file.name.slice(5)}`, { type: file.type });
  }
  void importFile(file);
});
function importImage(file: File) {
  if (importing) return;
  importing = new AbortController();
  const controller = importing;
  startProgress(t("Preparing map"), icons.map, t("Keep Mega Maps open while your map is prepared."), file.name, t("Reading image metadata…"));
  const started = Date.now();
  // Which kinds of file people pick, to see what fails; the name itself is never sent.
  const kind = { type: file.type || "none", extension: /\.(\w{1,10})$/.exec(file.name)?.[1]?.toLowerCase() ?? "none" };
  // The map opens once its tiles are saved; text detection waits for a yes.
  void mutate(() =>
    importMap(
      file,
      (progress) => showProgress(progress.fraction * 100, progress.message),
      controller.signal,
    ), { signal: controller.signal, waiting: () => showProgress(0, t("Waiting for Mega Maps to finish in another window…")) },
  )
    .then(async (map) => {
      track("map_imported", { ok: true, ...kind, megapixels: Math.round(map.width * map.height / 1e6), shrunk: !!map.shrunkFrom, seconds: Math.round((Date.now() - started) / 1000) });
      channel?.postMessage("changed");
      progressDialog.close();
      importing = undefined;
      await refresh();
      await openMap(map);
      if (currentMap?.id === map.id) offerTextDetection(map);
    })
    .catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      track("map_imported", { ok: false, ...kind, error: failure(error) });
      showError(t("Couldn’t import this map"), error);
    })
    .finally(() => {
      progressDialog.close();
      importing = undefined;
    });
}
// The tab title carries the percentage too, for imports left in the background.
// Rounded down, so 100% only shows once the work is done.
// When the shown task started, for its estimate; a task starting over resets it.
let progressStarted = 0, lastPercent = 0;
function showProgress(percent: number, message: string) {
  if (percent <= 0 || percent < lastPercent) progressStarted = performance.now();
  lastPercent = percent;
  Object.assign(app.progress, { percent, message, left: timeLeft(percent / 100, performance.now() - progressStarted) });
  document.title = `${Math.floor(percent)}% · ${appTitle}`;
}
progressDialog.addEventListener("close", showTitle);
// The example map, made again first if it went meanwhile.
async function openExample() {
  if (!maps.some((map) => map.example)) {
    if (importing && !preparingExample)
      return showMessage(t("Finish the current task first"), t("Mega Maps is busy with a map. Let it finish, then try again."));
    await (preparingExample ??= addExample(true).finally(() => (preparingExample = undefined)));
  }
  const example = maps.find((map) => map.example);
  if (!example) return;
  if (currentMap?.id !== example.id) await openMap(example);
}
function openUpdates() {
  if (updates.isBusy()) updates.open();
  else if (importing || ocrJob)
    updates.explain("Finish the current task first", t("Mega Maps is preparing a map. Let it finish, or stop it, then check for updates again."));
  else if (!canUpdate)
    updates.explain(t("Updates aren’t available here"), t("App updates work in the installed app or on the live HTTPS site."));
  else updates.open();
}
// Settings is a page of its own: it takes the library's place and Back returns.
// Nothing adds history entries, so an edge swipe has nowhere to go: only the
// Back buttons leave a map or Settings.
function showSettings() {
  libraryScroll = window.scrollY;
  app.page = "settings";
  settings.open();
}
function hideSettings() {
  showPage("home");
  void refreshFooter();
  void showBackupReminder();
  window.scrollTo(0, libraryScroll);
}
// Adds the backup's missing maps, one after another, then shows them in the library.
async function restore(backup: Backup) {
  if (importing || ocrJob || updates.isBusy())
    return showMessage("Finish the current task first", t("Mega Maps is busy with another map. Let it finish, then restore the backup."));
  const controller = new AbortController();
  importing = controller;
  startProgress(t("Restoring backup"), icons.restore, t("Keep Mega Maps open while your maps are prepared again."),
    plural(backup.manifest.maps.length, "map"), t("Starting…"));
  try {
    const result = await mutate(() => restoreBackup(backup, (progress) =>
      showProgress(progress.fraction * 100, progress.message), controller.signal));
    track("backup_restored", { ok: true, maps: result.added });
    progressDialog.close();
    showMessage(t("Backup restored"), t("{maps} added to your library.", { maps: plural(result.added, "map") }));
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      track("backup_restored", { ok: false, error: failure(error) });
      showError(t("Couldn’t restore the backup"), error);
    }
  } finally {
    progressDialog.close();
    importing = undefined;
    channel?.postMessage("changed");
    // The app starts again so every screen loads the restored maps, once the outcome is read.
    if (messageDialog.open) messageDialog.addEventListener("close", () => location.reload(), { once: true });
    else location.reload();
  }
}
// Reset's Delete all data, once its three steps are confirmed.
async function erase() {
  if (importing || ocrJob || updates.isBusy())
    return showMessage(t("Finish the current task first"), t("Mega Maps is busy with a map. Let it finish, then try again."));
  try {
    await mutate(deleteAllData);
    showMessage(t("Everything deleted"), t("No maps, places or photos are left on this device."));
  } catch (error) {
    showError(t("Couldn’t delete everything"), error);
  } finally {
    channel?.postMessage("changed");
    await refresh().catch(() => {});
    void settings.refresh();
  }
}
// Reset's Reset the app, once its three steps are confirmed: all data, then every setting.
// The app starts again as if just installed, with the welcome and the example map.
async function reset() {
  if (importing || ocrJob || updates.isBusy())
    return showMessage(t("Finish the current task first"), t("Mega Maps is busy with a map. Let it finish, then try again."));
  try {
    await mutate(deleteAllData);
    resetPreferences();
    channel?.postMessage("changed");
    location.reload();
  } catch (error) {
    showError(t("Couldn’t reset the app"), error);
    await refresh().catch(() => {});
    void settings.refresh();
  }
}
// A dot on Settings while a backup is due.
async function showBackupReminder() {
  const [lastBackup, kept] = await Promise.all([loadSetting("last-backup").catch(() => undefined), storageProtected()]);
  app.backupDue = backupDue(maps, lastBackup, Date.now(), kept !== false);
}
channel?.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (typeof data === "object" && data !== null && "type" in data && data.type === "annotations" &&
      "mapId" in data && data.mapId === currentMap?.id)
    void controls?.refreshImports().catch((error) => showError(t("Could not refresh shared items"), error));
  if (!importing)
    void refresh().catch((error) =>
      showError(t("Storage unavailable"), error),
    );
});

/** Shows a running scan in the map's Advanced settings. */
function showOcrJob(job: NonNullable<typeof ocrJob>) {
  if (selectedMap?.id !== job.mapId) return;
  app.advanced.status = job.left ? `${job.message} · ${job.left}` : job.message;
  app.advanced.blocked = true;
  app.advanced.running = true;
}
// OCR runs in the background, outside the storage lock, so the library stays
// usable. It commits only full scans, and only while the map still exists.
async function runOcr(
  map: MapRecord,
  controller: AbortController,
  onProgress: (progress: {
    fraction: number;
    message: string;
  }) => void = () => {},
) {
  if (ocrJob)
    throw new Error(
      t("Text detection is already running. Let it finish or stop it first."),
    );
  let previous: OcrIndex | undefined;
  let release = () => {};
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const job = {
    mapId: map.id,
    controller,
    message: t("Starting local text detection…"),
    fraction: 0,
    left: "",
    done,
  };
  ocrJob = job;
  ocrErrors.delete(map.id);
  if (retiling?.mapId === map.id) await stopRetiling();
  const update = () => {
    if (currentMap?.id === map.id)
      controls?.updateOcr(previous, job.message, job.fraction, job.left);
    showOcrJob(job);
  };
  try {
    previous = await loadOcr(map.id);
    update();
    const started = Date.now();
    const index = await detectMapText(
      map,
      (progress) => {
        job.message = progress.message;
        job.fraction = progress.fraction;
        job.left = timeLeft(progress.fraction, Date.now() - started);
        update();
        onProgress(progress);
      },
      controller.signal,
    );
    // How the scan was spread, to tell slow phones from scans that ran on too few workers.
    const sections = ocrCrops(map.width, map.height).length;
    track("text_scanned", { ok: true, labels: index.lines.length, seconds: Math.round((Date.now() - started) / 1000),
      sections, workers: ocrWorkerCount(sections), cores: navigator.hardwareConcurrency || 0 });
    if (currentMap?.id === map.id) controls?.updateOcr(index);
    channel?.postMessage("changed");
    return index;
  } catch (error) {
    track("text_scanned", { ok: false, ...controller.signal.aborted ? { stopped: true } : { error: failure(error) } });
    // A full device fails the save at the end; rerunning wouldn't help until there's room.
    const message = controller.signal.aborted
      ? t("Text detection stopped. Rerun it in Advanced settings.")
      : error instanceof Error && error.name === "QuotaExceededError" ? errorMessage(error)
      : t("Text detection failed. Rerun it in Advanced settings.");
    ocrErrors.set(map.id, message);
    if (currentMap?.id === map.id) controls?.updateOcr(previous, message);
    throw error;
  } finally {
    ocrJob = undefined;
    release();
    if (selectedMap?.id === map.id) void renderOcrSettings();
  }
}

// Scanning is slow and heavy, so it never starts without a yes: a new map asks,
// and so does a map scanned before detection improved. A no leaves it to
// Advanced settings; each map asks once per session.
const offeredMaps = new Set<string>();
let offeredMap: MapRecord | undefined;
let offerAccepted = false;
function offerTextDetection(map: MapRecord, update = false) {
  // Detection runs on WebAssembly, so a browser without it could only fail.
  if (typeof WebAssembly === "undefined" || offeredMaps.has(map.id) || ocrOfferDialog.open) return;
  offeredMaps.add(map.id);
  offeredMap = map;
  offerAccepted = false;
  app.ocrOfferUpdate = update;
  showDialog(ocrOfferDialog);
}
ocrOfferDialog.addEventListener("close", () => {
  const map = offeredMap;
  offeredMap = undefined;
  if (!map) return;
  track("text_scan_offered", { accepted: offerAccepted, update: app.ocrOfferUpdate });
  if (offerAccepted)
    void runOcr(map, new AbortController()).catch((error) => {
      if (!ocrErrors.has(map.id))
        showError(t("Couldn’t start text detection"), error);
    });
});

// Search uses whatever scan the map has; an outdated one offers a rescan.
async function prepareMapSearch(map: MapRecord, version: number) {
  try {
    const index = await loadOcr(map.id);
    if (version !== openVersion) return;
    const job = ocrJob?.mapId === map.id ? ocrJob : undefined;
    controls?.updateOcr(index, job?.message ?? ocrErrors.get(map.id), job?.fraction, job?.left);
    if (index && needsOcr(index) && !job) offerTextDetection(map, true);
  } catch (error) {
    if (version === openVersion && !ocrErrors.has(map.id))
      controls?.updateOcr(
        undefined,
        t("{error} Retry in the map’s Advanced settings.", { error: errorMessage(error) }),
      );
  }
}

async function renderOcrSettings() {
  const map = selectedMap;
  if (!map) return;
  const index: OcrIndex | undefined = await loadOcr(map.id).catch(
    () => undefined,
  );
  if (selectedMap?.id !== map.id) return;
  const running = ocrJob?.mapId === map.id;
  app.advanced = {
    map,
    status: running
      ? ocrJob!.left ? `${ocrJob!.message} · ${ocrJob!.left}` : ocrJob!.message
      : (ocrErrors.get(map.id) ??
        (index
          ? `${plural(index.lines.length, "detected label")}\n${t("Last scanned {date}", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(index.completedAt) })}`
          : t("Text detection has not run yet."))),
    scanned: !!index,
    running,
    blocked: !!ocrJob || !!importing,
  };
}
function rerunOcr() {
  const map = selectedMap;
  if (!map || ocrJob || importing) return;
  app.advanced.blocked = true;
  void runOcr(map, new AbortController())
    .catch((error) => {
      if (!ocrErrors.has(map.id))
        showError(t("Couldn’t start text detection"), error);
    })
    .finally(() => void renderOcrSettings());
}
initKeyboardInset();
initFieldLift("dialog, #settings, [data-bar]");
initTapAway("dialog, #settings");
lockPageZoom();
void registerOfflineShell().then(refreshFooter);
async function start() {
  if (inTab) return;
  await mutate(async () => {
    for (const map of await listMaps())
      if (map.status !== "ready") await deleteStoredMap(map);
  }).catch(() => {}); // Another tab may legitimately be importing; don't touch its files.
  // Reopening on the last map skips building the library beneath it, whose
  // previews and counts would compete with the map for storage.
  const resume = await lastMap();
  if (resume) app.page = "";
  await refresh();
  // Ask on every launch: Chrome may grant it later, once the app is installed or used more.
  if (maps.length) void protectStorage().then(showBackupReminder);
  setPerson({ maps: maps.length, language });
  void storageProtected().then((kept) => track("app_opened", {
    installed: true, maps: maps.length, protected: kept ?? "unknown", language,
    "label-size": preference("label-size"), "update-install": preference("update-install"),
  }));
  if (import.meta.env.DEV) await restoreDevData().catch((error) => console.warn("Dev data", error));
  const map = maps.find((map) => map.id === resume);
  if (map) await openMap(map);
  else if (app.page === "") {
    app.page = "home";
    await refresh();
  }
  retileMaps();
  // Made while the welcome shows, so it's ready to try.
  if (!maps.length && preference("tour") !== "seen")
    preparingExample = addExample().finally(() => (preparingExample = undefined));
  const welcomed = welcome.atLaunch(maps.length > 0);
  whatsNew.atLaunch(maps.length > 0, !welcomed);
}
// New users get the example map to try, made quietly while the welcome
// shows. Made again when opened from the welcome, it shows its progress.
async function addExample(shown = false) {
  const controller = new AbortController();
  importing = controller;
  if (shown)
    startProgress(t("Preparing the example map"), icons.map, t("Keep Mega Maps open while your map is prepared."),
      t("Val Moulin (example)"), t("Reading image…"));
  try {
    const { addExampleMap } = await import("./example/example-map");
    await mutate(() => addExampleMap(controller.signal, shown ? (progress) => showProgress(progress.fraction * 100, progress.message) : undefined));
    track("example_map_added", { ok: true });
    channel?.postMessage("changed");
  } catch (error) {
    const stopped = error instanceof DOMException && error.name === "AbortError";
    if (!stopped) track("example_map_added", { ok: false, error: failure(error) });
    if (shown && !stopped) showError(t("Could not prepare the example map."), error);
  } finally {
    importing = undefined;
    if (shown) progressDialog.close();
  }
  await refresh().catch(() => {});
}
// A dev server on a new port starts empty; it brings back the shared dev maps.
async function restoreDevData() {
  const { devBackups, loadDevBackup } = await import("./dev-data");
  for (const backup of await devBackups())
    if (backup.maps.some((id) => !maps.some((map) => map.id === id)))
      await restore(await loadDevBackup(backup.name));
}
void start().catch((error) =>
  showError(t("Local storage unavailable"), error),
);
Object.defineProperty(window, "MapViewer", {
  value: {
    diagnostics: () => viewer?.diagnostics() ?? null,
    library: () => maps.map((m) => ({ ...m })),
  },
  configurable: true,
});
