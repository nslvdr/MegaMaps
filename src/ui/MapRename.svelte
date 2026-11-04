<script lang="ts">
  import { errorMessage, t } from "../i18n";
  import type { MapRecord } from "../types";
  import { keepFormOpen, showDialog } from "./dialog";
  import { displayName } from "./format";
  import { icons } from "./icons";
  import Actions from "./kit/Actions.svelte";
  import Button from "./kit/Button.svelte";
  import DialogHeader from "./kit/DialogHeader.svelte";

  // Keeps the dialog open on a failed save so the name can be retried.
  let { save }: { save: (id: string, name: string) => Promise<void> } = $props();
  let dialog: HTMLDialogElement, input: HTMLInputElement;
  let mapId: string | undefined;
  let name = $state(""), error = $state(""), saving = $state(false);

  export function open(map: Pick<MapRecord, "id" | "name">) {
    mapId = map.id;
    // The library never shows the file extension, so neither does Rename.
    name = input.value = displayName(map.name);
    error = "";
    showDialog(dialog);
    // Ready to type over the name; a tap places the cursor instead.
    input.focus();
    input.select();
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!mapId || saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      error = t("Enter a map name.");
      input.focus();
      return;
    }
    saving = true;
    error = "";
    try {
      await save(mapId, trimmed);
      dialog.close();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      saving = false;
      if (dialog.open) queueMicrotask(() => input.focus());
    }
  }
</script>

<dialog bind:this={dialog} id="rename-map-dialog" aria-labelledby="rename-map-title" class="[--accent:var(--neon-saved)]"
  oncancel={keepFormOpen} onclose={() => (mapId = undefined)}>
  <form onsubmit={submit}>
    <DialogHeader id="rename-map-title" title={t("Rename map")} icon={icons.edit}
      close={{ id: "rename-map-cancel", onclick: () => dialog.close() }} closeDisabled={saving} />
    <label>{t("Name")}<input bind:this={input} id="rename-map-name" bind:value={name} oninput={() => (error = "")}
      disabled={saving} required autocomplete="off" enterkeyhint="done" aria-describedby="rename-map-error">
      <!-- In the label, so it stays with the name in the bar above the keyboard. -->
      <span id="rename-map-error" class="mt-8 block text-danger" role="alert" hidden={!error}>{error}</span></label>
    <Actions><Button type="submit" icon={icons.check} label={t("Save")} disabled={saving} /></Actions>
  </form>
</dialog>
