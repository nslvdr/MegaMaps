import { showDialog } from "./dialog";
import type { AppUpdate, DownloadProgress } from "../app-update";
import { formatBytes } from "./format";
import { icons } from "./icons";

export const updateDialogMarkup = `<dialog id="update-dialog" aria-labelledby="update-title" aria-describedby="update-body"><div class="dialog-icon" id="update-icon"></div><h2 id="update-title"></h2><p id="update-body"></p><ul class="update-facts" id="update-facts" hidden></ul><div class="update-progress" id="update-progress" hidden><div class="progress-track" role="progressbar" aria-labelledby="update-step" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" id="update-fill"></div></div><div class="progress-info" aria-live="polite"><span id="update-step"></span><span id="update-percent"></span></div></div><p class="dialog-note" id="update-note" hidden></p><div class="dialog-actions" id="update-actions"><button class="primary" id="update-confirm"></button><button class="quiet" id="update-dismiss"></button></div></dialog>`;

/** What the app is doing once the user has agreed to update. */
export type UpdateStep =
  | ({ step: "download" } & DownloadProgress)
  | { step: "install" }
  | { step: "save" };

export type UpdateActions = {
  /** Resolves undefined when the loaded version is already the latest. */
  find(): Promise<AppUpdate | undefined>;
  /** Downloads, installs and saves the session; resolves false if nothing newer was installed. */
  install(report: (step: UpdateStep) => void): Promise<boolean>;
  restart(): void;
  /** Release date of the loaded version, when known. */
  currentRelease?: Date;
};

const releaseDate = (date: Date) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
const button = (icon: string, label: string) => `${icon}<span>${label}</span>`;

// Check first, ask before downloading, then show each step until the app restarts.
export function initUpdateDialog(dialog: HTMLDialogElement, actions: UpdateActions) {
  const part = <T extends HTMLElement>(id: string) => dialog.querySelector<T>(`#${id}`)!;
  const icon = part("update-icon"), title = part("update-title"), body = part("update-body");
  const facts = part("update-facts"), progress = part("update-progress"), note = part("update-note");
  const track = progress.querySelector<HTMLElement>(".progress-track")!;
  const fill = part("update-fill"), step = part("update-step"), percent = part("update-percent");
  const actionRow = part("update-actions");
  const confirm = part<HTMLButtonElement>("update-confirm"), dismiss = part<HTMLButtonElement>("update-dismiss");
  let found: AppUpdate | undefined;
  let busy = false;
  let attempt = 0;
  let onConfirm = () => {};

  function view(state: string, options: {
    icon: string; title: string; body: string; facts?: string[]; note?: string;
    confirm?: [icon: string, label: string, action: () => void]; dismiss?: string;
  }) {
    dialog.dataset.state = state;
    icon.innerHTML = options.icon;
    title.textContent = options.title;
    body.textContent = options.body;
    facts.replaceChildren(...(options.facts ?? []).map((fact) => {
      const item = dialog.ownerDocument.createElement("li");
      const text = dialog.ownerDocument.createElement("span");
      item.innerHTML = icons.check;
      text.textContent = fact;
      item.append(text);
      return item;
    }));
    facts.hidden = !options.facts?.length;
    note.textContent = options.note ?? "";
    note.hidden = !options.note;
    progress.hidden = true;
    confirm.hidden = !options.confirm;
    if (options.confirm) {
      confirm.innerHTML = button(options.confirm[0], options.confirm[1]);
      onConfirm = options.confirm[2];
    }
    dismiss.hidden = !options.dismiss;
    dismiss.innerHTML = button(icons.close, options.dismiss ?? "");
    actionRow.hidden = !options.confirm && !options.dismiss;
  }

  /** Fraction undefined shows an indeterminate bar. */
  function bar(label: string, fraction?: number) {
    progress.hidden = false;
    step.textContent = label;
    track.classList.toggle("indeterminate", fraction === undefined);
    if (fraction === undefined) {
      fill.style.width = "";
      percent.textContent = "";
      track.removeAttribute("aria-valuenow");
      return;
    }
    const value = Math.floor(Math.min(1, Math.max(0, fraction)) * 100);
    fill.style.width = `${value}%`;
    percent.textContent = `${value}%`;
    track.setAttribute("aria-valuenow", String(value));
  }

  function failed(error: unknown) {
    busy = false;
    view("error", {
      icon: icons.close,
      title: "Couldn’t update Mega Maps",
      body: error instanceof Error ? error.message : String(error),
      note: "You can keep using this version and try again later. Your maps, places and routes are unchanged.",
      confirm: [icons.rotateRight, "Try again", () => void check()],
      dismiss: "Close",
    });
  }

  function upToDate() {
    busy = false;
    view("current", {
      icon: icons.check,
      title: "You’re up to date",
      body: actions.currentRelease
        ? `You have the latest version of Mega Maps, released ${releaseDate(actions.currentRelease)}.`
        : "You have the latest version of Mega Maps.",
      confirm: [icons.check, "Done", () => dialog.close()],
    });
  }

  function offer(update: AppUpdate) {
    found = update;
    const released = update.releasedAt ? ` (released ${releaseDate(update.releasedAt)})` : "";
    view("available", {
      icon: icons.download,
      title: "Update available",
      body: update.downloaded
        ? `A new version of Mega Maps${released} has already been downloaded. Restart to start using it.`
        : `A new version of Mega Maps${released} is ready to download.`,
      facts: [
        ...(update.downloaded ? [] : [update.size ? `About ${formatBytes(update.size)} to download` : "A one-time download"]),
        "Your maps, places and routes stay on this device",
        "Mega Maps restarts and reopens where you left off",
        "Works offline again as soon as it restarts",
      ],
      note: update.downloaded ? undefined : "Keep Mega Maps open while the update downloads.",
      confirm: update.downloaded
        ? [icons.rotateRight, "Restart now", () => void install()]
        : [icons.download, "Update now", () => void install()],
      dismiss: "Not now",
    });
  }

  async function check() {
    const current = ++attempt;
    busy = false;
    view("checking", {
      icon: icons.rotateRight,
      title: "Checking for updates",
      body: "Looking for a newer version of Mega Maps…",
      dismiss: "Cancel",
    });
    bar("Contacting Mega Maps…");
    try {
      const update = await actions.find();
      if (current !== attempt || !dialog.open) return;
      if (update) offer(update);
      else upToDate();
    } catch (error) {
      if (current === attempt && dialog.open) failed(error);
    }
  }

  async function install() {
    if (busy || !found) return;
    busy = true;
    ++attempt;
    const total = found.size;
    const order = ["download", "install", "save"];
    let fraction = 0, stage = 0;
    view("installing", {
      icon: found.downloaded ? icons.rotateRight : icons.download,
      title: found.downloaded ? "Finishing the update" : "Updating Mega Maps",
      body: "Your maps, places and routes stay on this device.",
      note: "Keep Mega Maps open. It restarts by itself when the update is ready.",
    });
    // Downloading fills most of the bar; installing and saving take the rest.
    const report = (update: UpdateStep) => {
      // Late download messages must not move the label backwards.
      if (order.indexOf(update.step) < stage) return;
      stage = order.indexOf(update.step);
      if (update.step === "download") {
        const size = update.total || total;
        if (!size) return bar("Downloading…");
        if (update.loaded >= size) return report({ step: "install" });
        if (!update.loaded) return bar("Starting download…", fraction);
        fraction = Math.max(fraction, (update.loaded / size) * 0.9);
        bar(`Downloading · ${formatBytes(update.loaded)} of ${formatBytes(size)}`, fraction);
      } else if (update.step === "install") {
        fraction = Math.max(fraction, 0.92);
        bar("Installing update…", fraction);
      } else {
        fraction = Math.max(fraction, 0.97);
        bar("Saving your place…", fraction);
      }
    };
    if (found.downloaded) report({ step: "install" });
    else bar("Starting download…", 0);
    try {
      if (!(await actions.install(report))) return upToDate();
      view("restarting", {
        icon: icons.check,
        title: "Update installed",
        body: "Restarting Mega Maps with the new version…",
      });
      bar("Restarting…", 1);
      actions.restart();
    } catch (error) {
      failed(error);
    }
  }

  confirm.addEventListener("click", () => onConfirm());
  dismiss.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    ++attempt;
    found = undefined;
  });

  return {
    open() {
      if (!dialog.open) showDialog(dialog);
      if (!busy) void check();
    },
    /** Explain why updating isn't possible right now. */
    explain(heading: string, message: string) {
      if (busy) return;
      view("info", { icon: icons.rotateRight, title: heading, body: message, confirm: [icons.check, "Got it", () => dialog.close()] });
      if (!dialog.open) showDialog(dialog);
    },
    get busy() { return busy; },
  };
}
