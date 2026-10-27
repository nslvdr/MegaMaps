import { dialogHeader, showDialog } from "./dialog";
import { formatBytes, plural } from "./format";
import { icons } from "./icons";
import { shareOrDownload } from "./save-file";
import { language, locale, t } from "../i18n";
import { formatDistance } from "../viewer/measure";
import { preference, setPreference, type Preferences } from "../preferences";
import { backupDue, backupSummary, createBackup, readBackup, type Backup } from "../storage/backup";
import { listMaps } from "../storage/database";
import { storageProtected } from "../storage/protection";
import { loadSetting, saveSetting } from "../storage/settings";
import { track } from "../stats";

const heading = (text: string) => `<h2 class="settings-heading">${text}</h2>`;

const note = (text: string, id = "") => `<p class="settings-note"${id && ` id="${id}"`}>${text}</p>`;

// A one-line hint under a row's label replaces paragraphs between groups.
const label = (text: string, hint = "", id = "") =>
  `<span class="share-row-label">${text}<small${id && ` id="${id}"`}>${hint}</small></span>`;

const row = (id: string, icon: string, text: string, hint = "") =>
  `<button class="share-row" id="${id}"><span class="share-row-icon settings-icon">${icon}<span class="update-dot" aria-hidden="true"></span></span>${label(text, hint, `${id}-status`)}${icons.arrow}</button>`;

const choice = <K extends keyof Preferences>(key: K, icon: string, text: string, options: [Preferences[K], string][], hint = "") =>
  `<label class="share-row"><span class="share-row-icon settings-icon">${icon}</span>${label(text, hint)}<span class="settings-select"><select name="${key}">${options.map(([value, option]) =>
    `<option value="${value}"${value === preference(key) ? " selected" : ""}>${option}</option>`).join("")}</select>${icons.chevronDown}</span></label>`;

// Language names stay in their own language, so either can be found.
export const settingsMarkup = `<section id="settings" class="settings-page" aria-labelledby="settings-title" hidden><div class="top-edge" aria-hidden="true"></div>
<header class="page-header"><button type="button" class="page-back" id="settings-back" aria-label="${t("Back")}" title="${t("Back")}">${icons.arrow}</button><h1 id="settings-title">${t("Settings")}</h1></header>
${heading(t("Map"))}<div class="share-summary">${choice("label-size", icons.labelSize, t("Label size"), [["standard", t("Standard")], ["large", t("Large")]])}${choice("label-distance", icons.labelDistance, t("Show labels within"), [
  ...(["100", "200", "500", "1000"] as const).map((metres): [Preferences["label-distance"], string] => [metres, formatDistance(Number(metres))]),
  ["always", t("Always")]], t("Keeps pins clear from afar"))}${choice("walking-speed", icons.walkingSpeed, t("Walking speed"), (["2", "3", "4", "5"] as const).map((speed) => [speed, t("{speed} km/h", { speed })]), t("For route travel times"))}</div>
${heading(t("You"))}<div class="share-summary">${choice("language", icons.language, t("Language"), [["fr", "Français"], ["en", "English"]])}<label class="share-row"><span class="share-row-icon settings-icon">${icons.user}</span>${label(t("Nickname"), t("On maps you send"))}<input id="settings-name" type="text" maxlength="100" autocomplete="nickname" enterkeyhint="done" placeholder="${t("Add one")}"></label></div>
${heading(t("Your data"))}<div class="share-summary">${row("settings-backup", icons.backup, t("Save a backup"))}${row("settings-restore", icons.restore, t("Restore a backup"), t("Adds maps, keeps the ones here"))}<div class="share-row" id="settings-storage"><span class="share-row-icon settings-icon">${icons.storage}</span><span class="share-row-label">${t("Storage")}</span><span class="share-row-value" id="settings-storage-status"></span></div></div>${note("", "backup-note")}<p class="settings-error" id="backup-error" role="alert" hidden></p><input type="file" id="restore-input" accept=".megabackup,application/octet-stream" hidden>
${heading(t("Updates"))}<div class="share-summary">${choice("update-install", icons.download, t("Install updates"), [["auto", t("Automatically")], ["ask", t("Ask first")]])}${row("settings-update", icons.rotateRight, t("Check for updates"))}</div>
<button type="button" class="settings-erase" id="settings-erase">${icons.trash}<span>${t("Delete everything")}</span></button>
<p class="settings-foot">${t("No accounts: your maps, places and photos stay on this device.")}</p>
</section>`;

export const restoreDialogMarkup = `<dialog id="restore-dialog" aria-labelledby="restore-title" aria-describedby="restore-summary">${dialogHeader("restore-title", t("Restore backup"), icons.restore, "restore-cancel")}<p id="restore-summary"></p><p class="dialog-note" id="restore-note"></p><div class="dialog-actions" id="restore-actions"><button class="primary" id="restore-confirm">${icons.restore}<span>${t("Restore")}</span></button></div></dialog>`;

export const eraseDialogMarkup = `<dialog id="erase-dialog" aria-labelledby="erase-title" aria-describedby="erase-summary">${dialogHeader("erase-title", t("Delete everything"), icons.trash, "erase-cancel")}<p id="erase-summary"></p><p class="dialog-note" id="erase-step"></p><div class="dialog-actions"><button class="danger" id="erase-confirm">${icons.trash}<span></span></button><button class="secondary" id="erase-backup" hidden>${icons.backup}<span>${t("Save a backup first")}</span></button></div></dialog>`;

interface SettingsOptions {
  /** Release date of the loaded version, when known. */
  release?: Date;
  back(): void;
  checkUpdates(): void;
  /** Rebuild the backup's missing maps; reports its own progress and outcome. */
  restore(backup: Backup): void;
  /** Remove every map and setting once all three steps are confirmed; reports its own outcome. */
  erase(): void;
  /** Apply a new label size to the maps shown from now on. */
  setLabelSize(size: Preferences["label-size"]): void;
}

const day = (date: Date | number) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
// Each step's button wakes up after a pause, so a hurried triple tap can't pass all three.
export const ERASE_STEP_PAUSE = 800;

export function initSettingsPage(page: HTMLElement, dialogs: { restore: HTMLDialogElement; erase: HTMLDialogElement }, options: SettingsOptions) {
  const part = <T extends HTMLElement = HTMLElement>(root: HTMLElement, id: string) => root.querySelector<T>(`#${id}`)!;
  const { restore: dialog, erase: eraseDialog } = dialogs;
  const name = part<HTMLInputElement>(page, "settings-name");
  const backupRow = part<HTMLButtonElement>(page, "settings-backup");
  const restoreInput = part<HTMLInputElement>(page, "restore-input");
  const backupError = part(page, "backup-error");
  const eraseConfirm = part<HTMLButtonElement>(eraseDialog, "erase-confirm");
  const eraseBackup = part<HTMLButtonElement>(eraseDialog, "erase-backup");
  const status = (id: string, text: string) => { part(page, `${id}-status`).textContent = text; };
  let backup: File | undefined;
  let reviewed: Backup | undefined;
  let version = 0;

  const showError = (error?: unknown) => {
    backupError.hidden = error === undefined;
    backupError.textContent = error === undefined ? "" : errorMessage(error);
  };
  // Only a browser that says it may clear the library gets the warning and the weekly reminder.
  let kept = true;
  const showLastBackup = (at: number | undefined, due: boolean) => {
    backupRow.dataset.state = due ? "due" : "";
    const advice = due && at
      ? kept
        ? t("Your last backup is from {date}, over a month ago. Save a new one to keep recent changes.", { date: day(at) })
        : t("Your last backup is from {date}. Save a new one to keep recent changes.", { date: day(at) })
      : at
        ? t("Last backup {date}. Keep it in Files or on another device.", { date: day(at) })
        : kept
          ? t("Your maps live only on this device. Keep a backup in Files or on another device.")
          : t("Keep a backup in Files or on another device.");
    part(page, "backup-note").textContent = kept
      ? advice
      : `${t("This browser may clear your maps when the device runs low on space.")} ${advice}`;
  };

  // The file is ready before the tap, so the share sheet keeps the tap's permission.
  async function prepareBackup(current: number) {
    backup = undefined;
    backupRow.disabled = true;
    status("settings-backup", t("Preparing…"));
    try {
      const prepared = await createBackup();
      if (current !== version) return;
      const counts = backupSummary(prepared.manifest);
      if (!counts.maps) return status("settings-backup", t("No maps to back up yet"));
      backup = prepared.file;
      backupRow.disabled = false;
      status("settings-backup", [plural(counts.maps, "map"), counts.places && plural(counts.places, "place"),
        counts.routes && plural(counts.routes, "route"), counts.photos && plural(counts.photos, "photo"),
        formatBytes(prepared.file.size)].filter(Boolean).join(" · "));
    } catch (error) {
      if (current === version) status("settings-backup", t("Couldn’t prepare a backup: {reason}", { reason: errorMessage(error) }));
    }
  }

  async function refresh() {
    const current = ++version;
    showError();
    void prepareBackup(current);
    const [shareName, lastBackup, maps, estimate, protection] = await Promise.all([
      loadSetting("share-name").catch(() => undefined),
      loadSetting("last-backup").catch(() => undefined),
      listMaps().then((maps) => maps.filter((map) => map.status === "ready")).catch(() => []),
      navigator.storage?.estimate?.().catch(() => undefined),
      storageProtected(),
    ]);
    if (current !== version) return;
    name.value = shareName ?? "";
    kept = protection !== false;
    showLastBackup(lastBackup, backupDue(maps, lastBackup, Date.now(), kept));
    const usage = estimate?.usage !== undefined ? formatBytes(estimate.usage) : t("Unknown");
    status("settings-storage", protection === undefined ? usage : `${usage} · ${protection ? t("Protected") : t("Not protected")}`);
  }

  // A new language rebuilds every screen, so the app starts again in it.
  page.addEventListener("change", (event) => {
    const select = event.target as HTMLSelectElement;
    if (select.name === "language" && select.value !== language) {
      setPreference("language", select.value as Preferences["language"]);
      location.reload();
    } else if (select.name === "label-size") {
      const size = select.value as Preferences["label-size"];
      setPreference("label-size", size);
      options.setLabelSize(size);
    } else if (select.name === "walking-speed") {
      setPreference("walking-speed", select.value as Preferences["walking-speed"]);
    } else if (select.name === "label-distance") {
      setPreference("label-distance", select.value as Preferences["label-distance"]);
    } else if (select.name === "update-install") {
      setPreference("update-install", select.value as Preferences["update-install"]);
    }
  });

  name.addEventListener("input", () => void saveSetting("share-name", name.value.trim()));
  name.addEventListener("change", () => { name.value = name.value.trim(); });
  // Done on the keyboard closes it, as on a form.
  name.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) name.blur(); });

  async function saveBackup() {
    if (!backup) return;
    showError();
    try {
      if (await shareOrDownload(backup, page) === "cancelled") return;
      const now = Date.now();
      await saveSetting("last-backup", now);
      track("backup_saved");
      showLastBackup(now, false);
      return true;
    } catch (error) {
      showError(error);
    }
  }
  backupRow.addEventListener("click", () => void saveBackup());

  part(page, "settings-restore").addEventListener("click", () => restoreInput.click());
  restoreInput.addEventListener("change", () => {
    const file = restoreInput.files?.[0];
    restoreInput.value = "";
    if (file) void review(file).catch(showError);
  });

  /** Say what a backup holds and what restoring adds before anything is written. */
  async function review(file: Blob) {
    showError();
    const parsed = await readBackup(file);
    const present = new Set((await listMaps()).map((map) => map.id));
    const counts = backupSummary(parsed.manifest);
    const added = parsed.manifest.maps.filter((map) => !present.has(map.id)).length;
    const kept = counts.maps - added;
    reviewed = parsed;
    part(dialog, "restore-summary").textContent = `${t("Saved {date}", { date: day(parsed.manifest.createdAt) })}\n${[plural(counts.maps, "map"),
      plural(counts.places, "place"), plural(counts.routes, "route"), plural(counts.photos, "photo")].join(" · ")}`;
    part(dialog, "restore-note").textContent = !counts.maps
      ? t("This backup has no maps.")
      : !added
        ? t("Every map in this backup is already on this device.")
        : `${kept
          ? t("{maps} will be added; {kept} already here stay as they are.", { maps: plural(added, "map"), kept })
          : t("{maps} will be added.", { maps: plural(added, "map") })} ${t("Each map is prepared again, which can take a while, so keep Mega Maps open.")}`;
    part(dialog, "restore-actions").hidden = !added;
    showDialog(dialog);
  }

  part(dialog, "restore-cancel").addEventListener("click", () => dialog.close());
  part(dialog, "restore-confirm").addEventListener("click", () => {
    if (!reviewed) return;
    dialog.close();
    options.restore(reviewed);
  });
  dialog.addEventListener("close", () => { reviewed = undefined; });

  // Three distinct confirmations: what goes, that there's no undo, then a last check.
  let eraseStep = 0, eraseTimer = 0;
  let erasing: { maps: number; lastBackup?: number } | undefined;
  function showEraseStep() {
    if (!erasing) return;
    const { maps, lastBackup } = erasing;
    const steps = [
      [t("Every map on this device goes, with its places, routes, photos and detected text, along with your nickname and backup date."), t("Continue")],
      [lastBackup
        ? t("There’s no undo. Your last backup is from {date}: anything added or changed since is lost.", { date: day(lastBackup) })
        : t("There’s no undo, and you haven’t saved a backup. Save one first if you might want these maps again."), t("Delete everything")],
      [t("Last check: delete {maps} from this device for good?", { maps: plural(maps, "map") }), t("Delete forever")],
    ] as const;
    const [text, action] = steps[eraseStep]!;
    part(eraseDialog, "erase-summary").textContent = text;
    part(eraseDialog, "erase-step").textContent = t("Step {step} of 3", { step: eraseStep + 1 });
    eraseConfirm.querySelector("span")!.textContent = action;
    eraseBackup.hidden = eraseStep !== 1 || !backup;
    eraseConfirm.disabled = true;
    clearTimeout(eraseTimer);
    eraseTimer = window.setTimeout(() => { eraseConfirm.disabled = false; }, ERASE_STEP_PAUSE);
  }
  part(page, "settings-erase").addEventListener("click", async () => {
    const [maps, lastBackup] = await Promise.all([
      listMaps().then((maps) => maps.filter((map) => map.status === "ready").length),
      loadSetting("last-backup").catch(() => undefined),
    ]);
    erasing = { maps, lastBackup };
    eraseStep = 0;
    showEraseStep();
    showDialog(eraseDialog);
  });
  eraseConfirm.addEventListener("click", () => {
    if (!erasing || eraseConfirm.disabled) return;
    if (eraseStep < 2) {
      eraseStep++;
      return showEraseStep();
    }
    eraseDialog.close();
    options.erase();
  });
  // A fresh backup answers the second step's worry.
  eraseBackup.addEventListener("click", async () => {
    if (!(await saveBackup()) || !erasing) return;
    erasing.lastBackup = Date.now();
    showEraseStep();
  });
  part(eraseDialog, "erase-cancel").addEventListener("click", () => eraseDialog.close());
  eraseDialog.addEventListener("close", () => {
    erasing = undefined;
    clearTimeout(eraseTimer);
  });

  part(page, "settings-update").addEventListener("click", options.checkUpdates);
  part(page, "settings-back").addEventListener("click", options.back);

  const setUpdateReady = (ready: boolean) => {
    part(page, "settings-update").dataset.state = ready ? "ready" : "";
    status("settings-update", ready
      ? t("Update ready to install")
      : options.release ? t("Version from {date}", { date: day(options.release) }) : t("See if a newer version is out"));
  };
  setUpdateReady(false);

  return {
    /** Read fresh values each time the page shows. */
    refresh,
    review,
    setUpdateReady,
  };
}
