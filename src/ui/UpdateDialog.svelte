<script lang="ts" module>
  import type { AppUpdate, DownloadProgress } from "../app-update";
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
</script>

<script lang="ts">
  import { errorMessage, locale, t } from "../i18n";
  import { showDialog } from "./dialog";
  import { formatBytes } from "./format";
  import { icons } from "./icons";
  import Actions from "./kit/Actions.svelte";
  import Button from "./kit/Button.svelte";
  import DialogHeader from "./kit/DialogHeader.svelte";
  import Icon from "./kit/Icon.svelte";
  import Progress from "./kit/Progress.svelte";

  // Check first, ask before downloading (unless started automatically), then
  // show each step until the app restarts.
  let { find, install: installUpdate, restart, currentRelease }: UpdateActions = $props();
  type View = {
    state: string; icon: string; title: string; body: string; facts?: string[]; note?: string;
    confirm?: [icon: string, label: string, action: () => void]; dismiss?: string;
  };
  let dialog: HTMLDialogElement;
  let view = $state<View>({ state: "", icon: icons.update, title: "", body: "" });
  /** The bar under the body; a fraction of undefined sweeps. */
  let bar = $state<{ label: string; fraction?: number }>();
  let busy = $state(false);
  let found: AppUpdate | undefined;
  let attempt = 0;
  const percent = $derived(bar?.fraction === undefined ? undefined : Math.floor(Math.min(1, Math.max(0, bar.fraction)) * 100));
  const accent = $derived(view.state === "current" || view.state === "restarting" ? "var(--neon-add)"
    : view.state === "error" ? "var(--danger)" : "var(--neon-view)");
  const releaseDate = (date: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);

  function show(next: View) {
    view = next;
    bar = undefined;
  }
  function failed(error: unknown) {
    busy = false;
    show({
      state: "error", icon: icons.close, title: t("Couldn’t update Mega Maps"), body: errorMessage(error),
      note: t("You can keep using this version and try again later. Your maps, places and routes are unchanged."),
      confirm: [icons.rotateRight, t("Try again"), () => void check()], dismiss: t("Close"),
    });
  }
  function upToDate() {
    busy = false;
    show({
      state: "current", icon: icons.check, title: t("You’re up to date"),
      body: currentRelease
        ? t("You have the latest version of Mega Maps, released {date}.", { date: releaseDate(currentRelease) })
        : t("You have the latest version of Mega Maps."),
      confirm: [icons.check, t("Done"), () => dialog.close()],
    });
  }
  function offer(update: AppUpdate) {
    found = update;
    const released = update.releasedAt ? t(" (released {date})", { date: releaseDate(update.releasedAt) }) : "";
    show({
      state: "available", icon: icons.download, title: t("Update available"),
      body: update.downloaded
        ? t("A new version of Mega Maps{released} has already been downloaded. Restart to start using it.", { released })
        : t("A new version of Mega Maps{released} is ready to download.", { released }),
      facts: [
        ...(update.downloaded ? [] : [update.size ? t("About {size} to download", { size: formatBytes(update.size) }) : t("A one-time download")]),
        t("Your maps, places and routes stay on this device"),
        t("Mega Maps restarts and reopens where you left off"),
        t("Works offline again as soon as it restarts"),
      ],
      note: update.downloaded ? undefined : t("Keep Mega Maps open while the update downloads."),
      confirm: update.downloaded
        ? [icons.rotateRight, t("Restart now"), () => void install()]
        : [icons.download, t("Update now"), () => void install()],
      dismiss: t("Not now"),
    });
  }
  async function check() {
    const current = ++attempt;
    busy = false;
    show({ state: "checking", icon: icons.update, title: t("Checking for updates"),
      body: t("Looking for a newer version of Mega Maps…"), dismiss: t("Cancel") });
    bar = { label: t("Contacting Mega Maps…") };
    try {
      const update = await find();
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
    show({
      state: "installing", icon: found.downloaded ? icons.update : icons.download,
      title: found.downloaded ? t("Finishing the update") : t("Updating Mega Maps"),
      body: t("Your maps, places and routes stay on this device."),
      note: t("Keep Mega Maps open. It restarts by itself when the update is ready."),
    });
    // Downloading fills most of the bar; installing and saving take the rest.
    const report = (update: UpdateStep) => {
      // Late download messages must not move the label backwards.
      if (order.indexOf(update.step) < stage) return;
      stage = order.indexOf(update.step);
      if (update.step === "download") {
        const size = update.total || total;
        if (!size) return void (bar = { label: t("Downloading…") });
        if (update.loaded >= size) return report({ step: "install" });
        if (!update.loaded) return void (bar = { label: t("Starting download…"), fraction });
        fraction = Math.max(fraction, (update.loaded / size) * 0.9);
        bar = { label: t("Downloading · {loaded} of {total}", { loaded: formatBytes(update.loaded), total: formatBytes(size) }), fraction };
      } else if (update.step === "install") {
        fraction = Math.max(fraction, 0.92);
        bar = { label: t("Installing update…"), fraction };
      } else {
        fraction = Math.max(fraction, 0.97);
        bar = { label: t("Saving your place…"), fraction };
      }
    };
    if (found.downloaded) report({ step: "install" });
    else bar = { label: t("Starting download…"), fraction: 0 };
    try {
      if (!(await installUpdate(report))) return upToDate();
      show({ state: "restarting", icon: icons.check, title: t("Update installed"), body: t("Restarting Mega Maps with the new version…") });
      bar = { label: t("Restarting…"), fraction: 1 };
      restart();
    } catch (error) {
      failed(error);
    }
  }

  export function open() {
    if (!dialog.open) showDialog(dialog);
    if (!busy) void check();
  }
  /** Installs a found update without asking, showing each step until the restart. */
  export function start(update: AppUpdate) {
    if (busy) return;
    if (!dialog.open) showDialog(dialog);
    found = update;
    void install();
  }
  /** Explains why updating isn't possible right now. */
  export function explain(heading: string, message: string) {
    if (busy) return;
    show({ state: "info", icon: icons.update, title: heading, body: message, confirm: [icons.check, t("Got it"), () => dialog.close()] });
    if (!dialog.open) showDialog(dialog);
  }
  export const isBusy = () => busy;
</script>

<dialog bind:this={dialog} id="update-dialog" aria-labelledby="update-title" aria-describedby="update-body"
  data-state={view.state} style:--accent={accent}
  oncancel={(event) => busy && event.preventDefault()} onclose={() => { ++attempt; found = undefined; }}>
  <DialogHeader id="update-title" title={view.title} icon={view.icon}
    close={{ id: "update-dismiss", onclick: () => !busy && dialog.close() }} closeLabel={view.dismiss ?? t("Close")} closeDisabled={busy}
    class={view.state === "checking" ? "[&>span>svg]:animate-spin" : ""} />
  <p id="update-body">{view.body}</p>
  <ul id="update-facts" hidden={!view.facts?.length}
    class="mt-16 grid list-none gap-12 rounded-md border border-line bg-white/3 p-16">
    {#each view.facts ?? [] as fact (fact)}
      <li class="flex items-start gap-12 text-small leading-cozy"><Icon svg={icons.check} class="mt-2 size-18 text-accent" /><span>{fact}</span></li>
    {/each}
  </ul>
  <div id="update-progress" hidden={!bar}>
    <Progress value={percent} labelledby="update-step" class="mt-16!" />
    <div class="flex items-center justify-between gap-12 text-small text-muted tabular-nums" aria-live="polite">
      <span id="update-step">{bar?.label}</span><span id="update-percent" class="flex-none whitespace-nowrap">{percent === undefined ? "" : `${percent}%`}</span>
    </div>
  </div>
  <p id="update-note" class="my-16 text-small leading-roomy" hidden={!view.note}>{view.note}</p>
  <Actions id="update-actions" hidden={!view.confirm}>
    <Button id="update-confirm" icon={view.confirm?.[0]} label={view.confirm?.[1] ?? ""} onclick={() => view.confirm?.[2]()} />
  </Actions>
</dialog>
