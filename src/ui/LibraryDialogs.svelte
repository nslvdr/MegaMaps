<script lang="ts">
  import { t } from "../i18n";
  import { app } from "./app-state.svelte";
  import { showDialog } from "./dialog";
  import { displayName } from "./format";
  import { icons } from "./icons";
  import { loadedThumbnails, shownFilters } from "./thumbnails";
  import Actions from "./kit/Actions.svelte";
  import Button, { buttonClass } from "./kit/Button.svelte";
  import DialogHeader from "./kit/DialogHeader.svelte";
  import Icon from "./kit/Icon.svelte";
  import Progress from "./kit/Progress.svelte";
  import Row from "./kit/Row.svelte";
  import Rows from "./kit/Rows.svelte";

  // The library's dialogs. Each opens and closes as a dialog does; what it says comes from the app state.
  let { importFile, cancelImport, deleteMap, rerunOcr, stopOcr, startOcr }: {
    importFile: (file: File) => void;
    cancelImport: () => void;
    deleteMap: () => void;
    rerunOcr: () => void;
    stopOcr: () => void;
    /** Yes to the text detection offer, just before it closes. */
    startOcr: () => void;
  } = $props();

  let importDialog: HTMLDialogElement, fileInput: HTMLInputElement;
  /** Asks what to add: a new map or a shared file. */
  export const openImport = () => showDialog(importDialog);

  // Each row only narrows the picker; the file's header decides how it is imported.
  function pick(accept: string) {
    importDialog.close();
    fileInput.accept = accept;
    fileInput.click();
  }
  function picked() {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) importFile(file);
  }
  const close = (event: Event) => (event.currentTarget as Element).closest("dialog")!.close();
  const deleting = $derived(app.deleting);
  const thumbnail = $derived(deleting && loadedThumbnails.get(deleting.id));
</script>

<input bind:this={fileInput} type="file" id="file-input" hidden onchange={picked}>

<dialog bind:this={importDialog} id="import-dialog" aria-labelledby="import-title">
  <DialogHeader id="import-title" title={t("Import")} icon={icons.download} close={{ id: "import-cancel", onclick: () => importDialog.close() }} />
  <p>{t("What would you like to add?")}</p>
  <Rows>
    <Row id="import-image" icon={icons.map} tone="var(--neon-add)" label={t("New map")} hint={t("JPEG, PNG or WebP image")} arrow
      onclick={() => pick("image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp")} />
    <Row id="import-share" icon={icons.download} label={t("Shared file")} hint={t(".megamap with places and routes")} arrow
      onclick={() => pick(".megamap,application/octet-stream")} />
  </Rows>
</dialog>

<!-- A long task: the tab title carries its percentage too, for imports left in the background. -->
<dialog id="progress-dialog" aria-labelledby="progress-title" oncancel={(event) => { event.preventDefault(); cancelImport(); }}>
  <DialogHeader id="progress-title" title={app.progress.title} icon={app.progress.icon || icons.map}
    close={{ id: "cancel-import", onclick: cancelImport }} closeLabel={t("Cancel import")} />
  <p id="import-name">{app.progress.name}</p>
  <Progress id="progress-track" value={app.progress.percent} labelledby="progress-message" />
  <!-- The percentage and time left stay on one line; a long step wraps instead. -->
  <div class="flex items-center justify-between gap-12 text-small text-muted tabular-nums">
    <span id="progress-message">{app.progress.message}</span>
    <span id="progress-percent" class="flex-none whitespace-nowrap">{Math.floor(app.progress.percent)}%{app.progress.left && ` · ${app.progress.left}`}</span>
  </div>
  <p id="progress-note" class="my-16 text-small leading-roomy">{app.progress.note}</p>
</dialog>

<!-- Something to know, and for a problem a way to report it with the browser's own words filled in. -->
<dialog id="message-dialog" aria-labelledby="message-title" aria-describedby="message-body" class="[--accent:var(--neon-view)]">
  <DialogHeader id="message-title" title={app.message.title} icon={icons.sparkle} close={{ id: "message-dismiss", onclick: close }} />
  <p id="message-body">{app.message.body}</p>
  <Button id="message-close" icon={icons.check} label={t("Got it")} onclick={close} class="mt-8 w-full" />
  <a id="message-report" href={app.message.report || undefined} target="_blank" rel="noopener" data-help="problem" hidden={!app.message.report}
    class={[buttonClass("quiet"), "mt-8 w-full no-underline"]}><Icon svg={icons.bug} /><span>{t("Report this problem")}</span></a>
</dialog>

<dialog id="delete-dialog" aria-labelledby="delete-title" class="[--accent:var(--danger)]">
  <DialogHeader id="delete-title" title={t("Delete this map?")} icon={icons.trash} close={{ id: "delete-cancel", onclick: close }} />
  <!-- The preview shows which map goes, not just its name; framed from outside, so a dark preview's filter leaves the border alone. -->
  <p id="delete-name" class="flex items-center gap-12 font-semibold text-text [overflow-wrap:anywhere]">
    {#if thumbnail}<span class="size-44 shrink-0 overflow-hidden rounded-sm border border-line"><img src={thumbnail} alt="" draggable="false"
      style:filter={shownFilters.get(deleting!.id) || undefined} class="block size-full object-cover" /></span>{/if}
    {deleting && displayName(deleting.name)}
  </p>
  <p id="delete-note" class="my-16 text-small leading-roomy">{app.deleteNote}</p>
  <Actions><Button id="delete-confirm" variant="danger" icon={icons.trash} label={t("Delete map")} onclick={deleteMap} /></Actions>
</dialog>

<dialog id="advanced-map-dialog" aria-labelledby="advanced-map-title">
  <DialogHeader id="advanced-map-title" title={t("Advanced settings")} icon={icons.tools} close={{ id: "advanced-map-close", onclick: close }} />
  <p id="advanced-map-name">{app.advanced.map && displayName(app.advanced.map.name)}</p>
  <h3>{t("Text detection")}</h3>
  <p id="ocr-status" role="status" aria-live="polite">{app.advanced.status}</p>
  <p class="my-16 text-small leading-roomy">{t("Detect labels in all directions for map search. Everything stays on this device. Large maps can take a while; keep the app open.")}</p>
  <div class="mt-20 mb-12 flex flex-col gap-8">
    <Button id="rerun-ocr" icon={icons.search} label={app.advanced.scanned ? t("Rerun text detection") : t("Run text detection")}
      disabled={app.advanced.blocked} onclick={rerunOcr} class="justify-start gap-12 text-left" />
    <Button id="stop-ocr" variant="secondary" icon={icons.close} label={t("Stop detection")} hidden={!app.advanced.running}
      onclick={stopOcr} class="justify-start gap-12 text-left" />
  </div>
</dialog>

<!-- Scanning is slow and heavy, so it never starts without a yes. -->
<dialog id="ocr-offer-dialog" aria-labelledby="ocr-offer-title">
  <DialogHeader id="ocr-offer-title" title={app.ocrOfferUpdate ? t("Update this map’s text search?") : t("Search this map’s text?")}
    icon={icons.scanText} close={{ id: "ocr-offer-close", onclick: close }} />
  <p id="ocr-offer-body">{app.ocrOfferUpdate
    ? t("Text detection has improved since this map was scanned. Scanning again runs on this device and can take a while on large maps.")
    : t("Text detection reads the labels printed on the map so search can find them. It runs on this device and can take a while on large maps.")}</p>
  <p class="my-16 text-small leading-roomy">{t("You can run it later from the map’s Advanced settings.")}</p>
  <Actions>
    <Button id="ocr-offer-start" icon={icons.scanText} label={t("Detect text")} onclick={(event) => { startOcr(); close(event); }} />
    <Button id="ocr-offer-later" variant="quiet" label={t("Not now")} onclick={close} />
  </Actions>
</dialog>
