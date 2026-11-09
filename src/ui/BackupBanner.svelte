<script lang="ts">
  import { errorMessage, plural, t } from "../i18n";
  import { createBackup, recordBackup } from "../storage/backup";
  import { track } from "../stats";
  import { app } from "./app-state.svelte";
  import { icons } from "./icons";
  import HeaderButton from "./kit/HeaderButton.svelte";
  import Icon from "./kit/Icon.svelte";
  import { shareOrDownload } from "./save-file";

  // The library's backup reminder: how much isn't backed up, saved in one tap or put away.
  let { shown, backedUp, dismiss }: {
    /** Only while the library shows does it prepare a backup. */
    shown: boolean;
    /** A backup was saved: the reminder's state is read again. */
    backedUp: () => void;
    dismiss: () => void;
  } = $props();

  const visible = $derived(shown && app.backup.banner);
  let prepared = $state<Awaited<ReturnType<typeof createBackup>>>();
  let error = $state<string>();

  // The file is ready before the tap, so the share sheet keeps the tap's permission;
  // a new count means new changes, so a new file.
  $effect(() => {
    if (!visible) return;
    void app.backup.changes;
    let current = true;
    prepared = undefined;
    error = undefined;
    createBackup().then((backup) => { if (current) prepared = backup; },
      (reason) => { if (current) error = t("Couldn’t prepare a backup: {reason}", { reason: errorMessage(reason) }); });
    return () => { current = false; };
  });

  async function save(event: MouseEvent) {
    if (!prepared) return;
    error = undefined;
    try {
      if (await shareOrDownload(prepared.file, (event.currentTarget as HTMLElement).parentElement!) === "cancelled") return;
      await recordBackup(prepared.manifest);
      track("backup_saved", { from: "library", changes: app.backup.changes });
      backedUp();
    } catch (reason) {
      error = errorMessage(reason);
    }
  }
</script>

<!-- One line above the maps; leaving, it goes the way it came. -->
<div id="backup-banner" hidden={!visible} class="motion mb-12 [--enter-from:translateY(-8px)]">
  <div class="flex min-h-52 items-center gap-12 rounded-pill border border-neon-saved/35 py-6 pr-12 pl-16 [--accent:var(--neon-saved)]">
    <span class="flex text-neon-saved [&>svg]:size-20"><Icon svg={icons.backup} /></span>
    <p id="backup-banner-count" class="m-0 min-w-0 flex-1 text-small leading-tight">
      <strong class="font-semibold">{plural(app.backup.changes, "change")}</strong>
      <span class="text-muted">{t("to back up")}</span>
    </p>
    <button type="button" id="backup-banner-save" disabled={!prepared} onclick={save}
      class="min-h-40 shrink-0 rounded-pill border border-neon-saved/45 tint-neon-saved/14 px-14 text-small font-strong text-neon-saved
        enabled:active:tint-neon-saved/24 enabled:hover:tint-neon-saved/22 disabled:opacity-50">{t("Back up")}</button>
    <HeaderButton id="backup-banner-dismiss" icon={icons.close} label={t("Not now")} onclick={dismiss} />
  </div>
  <p id="backup-banner-error" class="mx-16 mt-8 mb-0 text-small text-danger" role="alert" hidden={error === undefined}>{error}</p>
</div>
