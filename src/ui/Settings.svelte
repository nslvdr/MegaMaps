<script lang="ts">
  import { showDialog } from "./dialog";
  import { formatBytes, plural } from "./format";
  import { githubNote } from "./help";
  import { icons } from "./icons";
  import { shareOrDownload } from "./save-file";
  import { language, locale, t, errorMessage } from "../i18n";
  import { formatDistance } from "../viewer/measure";
  import { preference, setPreference, type Preferences } from "../preferences";
  import { backupDue, backupSummary, createBackup, missingMaps, readBackup, type Backup } from "../storage/backup";
  import { listMaps } from "../storage/database";
  import { storageProtected } from "../storage/protection";
  import { storedBytes } from "../storage/usage";
  import { loadSetting, saveSetting } from "../storage/settings";
  import { track } from "../stats";
  import HelpLinks from "./HelpLinks.svelte";
  import Actions from "./kit/Actions.svelte";
  import Button from "./kit/Button.svelte";
  import DialogHeader from "./kit/DialogHeader.svelte";
  import Icon from "./kit/Icon.svelte";
  import Page from "./kit/Page.svelte";
  import Row from "./kit/Row.svelte";
  import Rows from "./kit/Rows.svelte";

  type Erase = "data" | "app";
  let { release, back, checkUpdates, openWhatsNew, restore, erase, setLabelSize }: {
    /** Name of the loaded version, such as 2026.10.30-14.32-13c17c2, when known. */
    release?: string;
    back(): void;
    checkUpdates(): void;
    openWhatsNew(): void;
    /** Rebuild the backup's missing maps; reports its own progress and outcome. */
    restore(backup: Backup): void;
    /** Once all three steps are confirmed, remove every map ("data") or everything the app keeps ("app"); reports its own outcome. */
    erase(what: Erase): void;
    /** Apply a new label size to the maps shown from now on. */
    setLabelSize(size: Preferences["label-size"]): void;
  } = $props();

  const day = (date: Date | number) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);

  // Settings, or Reset over it; neither while the library shows.
  let shown = $state<"settings" | "reset">();
  let nickname = $state("");
  let backupHint = $state(""), backupReady = $state(false), backupDot = $state<"due" | "">("");
  let backupNote = $state(""), backupError = $state<string>();
  let storage = $state("");
  let updateReady = $state(false), debugHint = $state<string>();
  const updateHint = $derived(debugHint ?? (updateReady
    ? t("Update ready to install")
    : release ? t("Version {name}", { name: release }) : t("See if a newer version is out")));
  let backup: File | undefined;
  let version = 0;
  let restoreInput: HTMLInputElement, restoreDialog: HTMLDialogElement, eraseDialog: HTMLDialogElement;

  /** Shows Settings with fresh values. */
  export function open() {
    shown = "settings";
    window.scrollTo(0, 0);
    void refresh();
  }
  // Reset is a page of its own over Settings, and Back returns to Settings.
  const showReset = (on: boolean) => {
    shown = on ? "reset" : "settings";
    window.scrollTo(0, 0);
  };

  const showError = (error?: unknown) => { backupError = error === undefined ? undefined : errorMessage(error); };
  // Only a browser that says it may clear the library gets the warning and the weekly reminder.
  let kept = true;
  function showLastBackup(at: number | undefined, due: boolean) {
    backupDot = due ? "due" : "";
    const advice = due && at
      ? kept
        ? t("Your last backup is from {date}, over a month ago. Save a new one to keep recent changes.", { date: day(at) })
        : t("Your last backup is from {date}. Save a new one to keep recent changes.", { date: day(at) })
      : at
        ? t("Last backup {date}. Keep it in Files or on another device.", { date: day(at) })
        : kept
          ? t("Your maps live only on this device. Keep a backup in Files or on another device.")
          : t("Keep a backup in Files or on another device.");
    backupNote = kept ? advice : `${t("This browser may clear your maps when the device runs low on space.")} ${advice}`;
  }

  // The file is ready before the tap, so the share sheet keeps the tap's permission.
  async function prepareBackup(current: number) {
    backup = undefined;
    backupReady = false;
    backupHint = t("Preparing…");
    try {
      const prepared = await createBackup();
      if (current !== version) return;
      const counts = backupSummary(prepared.manifest);
      if (!counts.maps) return (backupHint = t("No maps to back up yet"));
      backup = prepared.file;
      backupReady = true;
      backupHint = [plural(counts.maps, "map"), counts.places && plural(counts.places, "place"),
        counts.routes && plural(counts.routes, "route"), counts.photos && plural(counts.photos, "photo"),
        formatBytes(prepared.file.size)].filter(Boolean).join(" · ");
    } catch (error) {
      if (current === version) backupHint = t("Couldn’t prepare a backup: {reason}", { reason: errorMessage(error) });
    }
  }

  /** Reads fresh values; Settings does so each time it shows. */
  export async function refresh() {
    const current = ++version;
    showError();
    void prepareBackup(current);
    const [shareName, lastBackup, maps, used, protection] = await Promise.all([
      loadSetting("share-name").catch(() => undefined),
      loadSetting("last-backup").catch(() => undefined),
      listMaps().then((maps) => maps.filter((map) => map.status === "ready")).catch(() => []),
      storedBytes().catch(() => navigator.storage?.estimate?.().then((estimate) => estimate.usage).catch(() => undefined)),
      storageProtected(),
    ]);
    if (current !== version) return;
    nickname = shareName ?? "";
    kept = protection !== false;
    showLastBackup(lastBackup, backupDue(maps, lastBackup, Date.now(), kept));
    const usage = used !== undefined ? formatBytes(used) : t("Unknown");
    storage = protection === undefined ? usage : `${usage} · ${protection ? t("Protected") : t("Not protected")}`;
  }

  // Each choice is kept as it changes; a new language rebuilds every screen, so the app starts again in it.
  function choose<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    if (key === "language") {
      if (value === language) return;
      setPreference(key, value);
      location.reload();
      return;
    }
    setPreference(key, value);
    if (key === "label-size") setLabelSize(value as Preferences["label-size"]);
  }
  // Language names stay in their own language, so either can be found.
  const choices: { key: keyof Preferences; icon: string; label: string; hint?: string; options: [string, string][] }[][] = [
    [
      { key: "label-size", icon: icons.labelSize, label: t("Label size"), options: [["standard", t("Standard")], ["large", t("Large")]] },
      { key: "label-distance", icon: icons.labelDistance, label: t("Show labels within"), hint: t("Keeps pins clear from afar"), options: [
        ...["100", "200", "500", "1000"].map((metres): [string, string] => [metres, formatDistance(Number(metres))]), ["always", t("Always")]] },
      { key: "walking-speed", icon: icons.walkingSpeed, label: t("Walking speed"), hint: t("For route travel times"),
        options: ["2", "3", "4", "5"].map((speed) => [speed, t("{speed} km/h", { speed })]) },
    ],
    [{ key: "language", icon: icons.language, label: t("Language"), options: [["fr", "Français"], ["en", "English"]] }],
    [{ key: "update-install", icon: icons.download, label: t("Install updates"), options: [["auto", t("Automatically")], ["ask", t("Ask first")]] }],
  ];

  async function saveBackup() {
    if (!backup) return;
    showError();
    try {
      if (await shareOrDownload(backup, restoreInput.parentElement!) === "cancelled") return;
      const now = Date.now();
      await saveSetting("last-backup", now);
      track("backup_saved");
      showLastBackup(now, false);
      return true;
    } catch (error) {
      showError(error);
    }
  }

  function picked() {
    const file = restoreInput.files?.[0];
    restoreInput.value = "";
    if (file) void review(file).catch(showError);
  }

  // What a backup holds and what restoring adds, said before anything is written.
  let reviewed = $state<{ backup: Backup; summary: string; note: string; added: number }>();
  export async function review(file: Blob) {
    showError();
    const parsed = await readBackup(file);
    const counts = backupSummary(parsed.manifest);
    const added = missingMaps(parsed.manifest, await listMaps()).length;
    const already = counts.maps - added;
    reviewed = {
      backup: parsed,
      added,
      summary: `${t("Saved {date}", { date: day(parsed.manifest.createdAt) })}\n${[plural(counts.maps, "map"),
        plural(counts.places, "place"), plural(counts.routes, "route"), plural(counts.photos, "photo")].join(" · ")}`,
      note: !counts.maps
        ? t("This backup has no maps.")
        : !added
          ? t("Every map in this backup is already on this device.")
          : `${already
            ? t("{maps} will be added; {kept} already here stay as they are.", { maps: plural(added, "map"), kept: already })
            : t("{maps} will be added.", { maps: plural(added, "map") })} ${t("Each map is prepared again, which can take a while, so keep Mega Maps open.")}`,
    };
    showDialog(restoreDialog);
  }
  function confirmRestore() {
    if (!reviewed) return;
    const { backup } = reviewed;
    restoreDialog.close();
    restore(backup);
  }

  // Three distinct confirmations: what goes, that there's no undo, then a last check.
  // Each step's button wakes up after a pause, so a hurried triple tap can't pass all three.
  let erasing = $state<{ what: Erase; maps: number; lastBackup?: number; step: number; ready: boolean }>();
  let eraseTimer: ReturnType<typeof setTimeout> | undefined;
  const eraseStep = $derived.by(() => {
    if (!erasing) return;
    const { what, maps, lastBackup, step } = erasing;
    const app = what === "app";
    return [
      [app
        ? t("Every map on this device goes, with its places, routes, photos and detected text, and every setting, such as language and nickname, goes back to its default.")
        : t("Every map on this device goes, with its places, routes, photos and detected text, along with your nickname and backup date. Other settings stay."), t("Continue")],
      [lastBackup
        ? t("There’s no undo. Your last backup is from {date}: anything added or changed since is lost.", { date: day(lastBackup) })
        : t("There’s no undo, and you haven’t saved a backup. Save one first if you might want these maps again."), app ? t("Reset the app") : t("Delete all data")],
      [app
        ? t("Last check: delete {maps} and reset Mega Maps?", { maps: plural(maps, "map") })
        : t("Last check: delete {maps} from this device for good?", { maps: plural(maps, "map") }), app ? t("Reset now") : t("Delete forever")],
    ][step]!;
  });
  function pause() {
    erasing!.ready = false;
    clearTimeout(eraseTimer);
    eraseTimer = setTimeout(() => { if (erasing) erasing.ready = true; }, ERASE_STEP_PAUSE);
  }
  async function startErase(what: Erase) {
    const [maps, lastBackup] = await Promise.all([
      listMaps().then((maps) => maps.filter((map) => map.status === "ready").length).catch(() => 0),
      loadSetting("last-backup").catch(() => undefined),
    ]);
    erasing = { what, maps, lastBackup, step: 0, ready: false };
    pause();
    showDialog(eraseDialog);
  }
  function confirmErase() {
    if (!erasing?.ready) return;
    if (erasing.step < 2) {
      erasing.step++;
      return pause();
    }
    const { what } = erasing;
    eraseDialog.close();
    showReset(false);
    erase(what);
  }
  // A fresh backup answers the second step's worry.
  async function backupFirst() {
    if (!(await saveBackup()) || !erasing) return;
    erasing.lastBackup = Date.now();
    pause();
  }

  // A long press toggles the debug overlay instead of checking; its hint says which for a moment.
  let holdTimer: ReturnType<typeof setTimeout> | undefined, hintTimer: ReturnType<typeof setTimeout> | undefined, held = false;
  function press() {
    held = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      held = true;
      const on = preference("debug") === "off";
      setPreference("debug", on ? "on" : "off");
      debugHint = on ? "Debug overlay on" : "Debug overlay off";
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => (debugHint = undefined), 2000);
    }, DEBUG_HOLD);
  }
  const release_ = () => clearTimeout(holdTimer);
  function tapUpdate() {
    if (held) held = false;
    else checkUpdates();
  }

  /** Whether a found update waits to be installed. */
  export function setUpdateReady(ready: boolean) {
    updateReady = ready;
    debugHint = undefined;
  }
</script>

<script module lang="ts">
  export const ERASE_STEP_PAUSE = 800;
  /** How long Check for updates is held to turn the hidden map debug overlay on or off. */
  export const DEBUG_HOLD = 1500;
</script>

{#snippet heading(text: string)}
  <!-- Groups breathe apart; a heading sits close to its own card. -->
  <h2 class="mx-12 mt-32 mb-8 text-small font-strong tracking-[0] text-muted">{text}</h2>
{/snippet}

{#snippet choice({ key, icon, label, hint, options }: (typeof choices)[number][number])}
  <!-- A choice reads as its plain value at the row's end and opens the system picker. -->
  <Row tag="label" {icon} {label} {hint}>
    <span class="relative shrink-0 text-muted">
      <select name={key} onchange={(event) => choose(key, event.currentTarget.value as Preferences[typeof key])}
        class="min-h-44 cursor-pointer appearance-none border-0 bg-transparent pr-24 pl-8 text-right text-body text-muted">
        {#each options as [value, option] (value)}<option {value} selected={value === preference(key)}>{option}</option>{/each}
      </select>
      <Icon svg={icons.chevronDown} class="pointer-events-none absolute top-1/2 right-0 size-16 -translate-y-1/2" />
    </span>
  </Row>
{/snippet}

<Page id="settings" title={t("Settings")} hidden={shown !== "settings"} back={() => { shown = undefined; back(); }}>
  {@render heading(t("Map"))}
  <Rows class="mt-0!">{#each choices[0]! as item (item.key)}{@render choice(item)}{/each}</Rows>

  {@render heading(t("You"))}
  <Rows class="mt-0!">
    {@render choice(choices[1]![0]!)}
    <Row tag="label" icon={icons.user} label={t("Nickname")} hint={t("On maps you send")}>
      <!-- The nickname box sits at the row's end, like the choices above it. Done on the keyboard closes it. -->
      <input id="settings-name" type="text" maxlength="100" autocomplete="nickname" enterkeyhint="done" placeholder={t("Add one")}
        bind:value={nickname} oninput={() => void saveSetting("share-name", nickname.trim())} onchange={() => (nickname = nickname.trim())}
        onkeydown={(event) => { if (event.key === "Enter" && !event.isComposing) event.currentTarget.blur(); }}
        class="min-h-40 min-w-0 flex-[0_1_160px] rounded-sm border border-white/15 bg-bg px-12 text-body text-text transition-colors
          duration-fast placeholder:text-muted focus:border-neon-view focus:outline-none" />
    </Row>
  </Rows>

  {@render heading(t("Your data"))}
  <Rows class="mt-0!">
    <Row id="settings-backup" icon={icons.backup} tone="var(--neon-saved)" label={t("Save a backup")} hint={backupHint}
      hintId="settings-backup-status" dot={backupDot} arrow disabled={!backupReady} onclick={() => void saveBackup()} />
    <Row id="settings-restore" icon={icons.restore} tone="var(--neon-saved)" label={t("Restore a backup")}
      hint={t("Adds maps, keeps the ones here")} arrow onclick={() => restoreInput.click()} />
    <Row tag="div" id="settings-storage" icon={icons.storage} tone="var(--muted)" label={t("Storage")}
      value={storage} valueId="settings-storage-status" />
  </Rows>
  <!-- The backup note lines up with the row labels above it. -->
  <p id="backup-note" class="mx-12 mt-8 text-small leading-roomy text-muted">{backupNote}</p>
  <p id="backup-error" class="mx-12 mt-8 text-small leading-roomy text-danger" role="alert" hidden={backupError === undefined}>{backupError}</p>
  <input bind:this={restoreInput} type="file" id="restore-input" accept=".megabackup,application/octet-stream" hidden onchange={picked}>

  {@render heading(t("Updates"))}
  <Rows class="mt-0!">
    {@render choice(choices[2]![0]!)}
    <!-- Held for the debug overlay, so no system callout or selection. -->
    <Row id="settings-update" icon={icons.update} tone={updateReady ? "var(--neon-add)" : undefined} label={t("Check for updates")}
      hint={updateHint} hintId="settings-update-status" dot={updateReady ? "ready" : ""} arrow onclick={tapUpdate}
      onpointerdown={press} onpointerup={release_} onpointercancel={release_} onpointerleave={release_}
      oncontextmenu={(event) => event.preventDefault()}
      class={["select-none [-webkit-touch-callout:none]", updateReady && "[&_small]:text-neon-add"]} />
    <Row id="settings-whats-new" icon={icons.sparkle} label={t("What’s new")} hint={t("Changes in each version")} arrow onclick={openWhatsNew} />
  </Rows>

  {@render heading(t("Help & ideas"))}
  <HelpLinks />
  <p class="mx-12 mt-8 text-small leading-roomy text-muted">{githubNote}</p>

  <!-- Reset, the way to irreversible actions, stays quiet, apart from the settings. -->
  <button type="button" id="settings-erase" onclick={() => showReset(true)}
    class="mt-32 flex min-h-48 w-full items-center justify-center gap-8 bg-transparent font-semibold text-danger [&>svg]:size-18">
    <Icon svg={icons.reset} /><span>{t("Reset")}</span>
  </button>
  <p class="mx-16 mt-4 text-center text-small leading-normal text-muted">{t("No accounts: your maps, places and photos stay on this device.")}</p>
  <p class="mx-16 mt-16 text-center text-small leading-normal text-muted">
    {@html t("Made by {name}", { name: `<strong class="text-accent">Nytro</strong>` })}
  </p>
</Page>

<!-- Reached from Settings' Reset: the two ways to start over, each confirmed in three steps. -->
<Page id="reset" title={t("Reset")} hidden={shown !== "reset"} back={() => showReset(false)}>
  {@render heading(t("Start over"))}
  <Rows class="mt-0!">
    <Row id="reset-data" icon={icons.trash} tone="var(--danger)" label={t("Delete all data")}
      hint={t("Maps, places and photos; settings stay")} arrow onclick={() => void startErase("data")} />
    <Row id="reset-app" icon={icons.reset} tone="var(--danger)" label={t("Reset the app")}
      hint={t("All data, and settings back to default")} arrow onclick={() => void startErase("app")} />
  </Rows>
</Page>

<dialog bind:this={restoreDialog} id="restore-dialog" aria-labelledby="restore-title" aria-describedby="restore-summary"
  onclose={() => (reviewed = undefined)}>
  <DialogHeader id="restore-title" title={t("Restore backup")} icon={icons.restore} close={{ id: "restore-cancel", onclick: () => restoreDialog.close() }} />
  <p id="restore-summary">{reviewed?.summary}</p>
  <p id="restore-note" class="my-16 text-small leading-roomy">{reviewed?.note}</p>
  <Actions id="restore-actions" hidden={!reviewed?.added}>
    <Button id="restore-confirm" icon={icons.restore} label={t("Restore")} onclick={confirmRestore} />
  </Actions>
</dialog>

<dialog bind:this={eraseDialog} id="erase-dialog" aria-labelledby="erase-title" aria-describedby="erase-summary"
  onclose={() => { erasing = undefined; clearTimeout(eraseTimer); }}>
  <DialogHeader id="erase-title" title={erasing?.what === "app" ? t("Reset the app") : t("Delete all data")}
    icon={erasing?.what === "app" ? icons.reset : icons.trash} close={{ id: "erase-cancel", onclick: () => eraseDialog.close() }} />
  <p id="erase-summary">{eraseStep?.[0]}</p>
  <p id="erase-step" class="my-16 text-small leading-roomy">{erasing && t("Step {step} of 3", { step: erasing.step + 1 })}</p>
  <Actions>
    <Button id="erase-confirm" variant="danger" icon={icons.trash} label={eraseStep?.[1] ?? ""} disabled={!erasing?.ready} onclick={confirmErase} />
    <Button id="erase-backup" variant="secondary" icon={icons.backup} label={t("Save a backup first")}
      hidden={erasing?.step !== 1 || !backupReady} onclick={() => void backupFirst()} />
  </Actions>
</dialog>
