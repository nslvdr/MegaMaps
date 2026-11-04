<script lang="ts">
  import { t } from "../../i18n";
  import { keepFormOpen } from "../dialog";
  import { icons } from "../icons";
  import Actions from "../kit/Actions.svelte";
  import Button from "../kit/Button.svelte";
  import DialogHeader from "../kit/DialogHeader.svelte";
  import HeaderButton from "../kit/HeaderButton.svelte";
  import Icon from "../kit/Icon.svelte";
  import { placeIcon } from "../place-icon";
  import { markerKinds, type MapMarker } from "../../viewer/navigation";
  import type { ViewerControls } from "../viewer-controls.svelte";

  // The map's smaller dialogs: every pin to pick from, a photo full screen, a
  // note for a place's history, the map's scale, and a route's name.
  let { controls }: { controls: ViewerControls } = $props();
  const color = $derived((controls.tick, controls.formKind, controls.formWater, controls.formDanger, controls.cardLook().color));
  const close = (id: string) => (document.getElementById(id) as HTMLDialogElement).close();
  const kinds = Object.entries(markerKinds) as [MapMarker["kind"], (typeof markerKinds)[MapMarker["kind"]]][];
  const discarding = $derived(controls.discarding === "entry-cancel");
</script>

<!-- Every pin, named, three a row; tapping one, even the chosen one, picks it and goes back to the form. -->
<dialog id="kind-dialog" aria-labelledby="kind-title" style:--c={color} class="[--accent:var(--c)]">
  <DialogHeader id="kind-title" title={t("Icon and type")} icon={icons.pin} close={{ id: "kind-close", onclick: () => close("kind-dialog") }} />
  <div role="radiogroup" aria-labelledby="kind-title" class="grid grid-cols-3 gap-4">
    {#each kinds as [kind, { label }] (kind)}
      <label class="relative grid min-w-0 cursor-pointer place-items-center gap-4 rounded-sm border-[1.5px] border-transparent px-4 py-8 text-center
        text-small text-text transition-colors duration-fast has-checked:border-c has-checked:bg-c/12 has-checked:[&>svg]:scale-108">
        <input type="radio" name="marker-kind" value={kind} checked={controls.formKind === kind} onclick={() => controls.pickKind(kind)}
          class="pointer-events-none absolute opacity-0" />
        <Icon svg={placeIcon(kind)} class="size-36 transition-transform duration-fast ease-out" /><span class="max-w-full truncate">{label}</span>
      </label>
    {/each}
  </div>
</dialog>

<!-- A tapped photo fills the screen, uncropped, clear of the notch and home bar; swipe for the item's others. -->
<dialog id="photo-viewer" aria-label={t("Photos")}
  class="group/viewer inset-0 m-0 h-dvh max-h-none w-screen max-w-none transform-none overflow-hidden rounded-none border-0 bg-black p-0 shadow-none
    open:backdrop:bg-black">
  <div class="photo-viewer-stage absolute inset-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]
    touch-none overflow-hidden select-none">
    <div class="photo-viewer-track flex h-full gap-16 group-data-settling/viewer:transition-transform group-data-settling/viewer:duration-base
      group-data-settling/viewer:ease-out"></div>
  </div>
  <div class="absolute top-[calc(env(safe-area-inset-top)+12px)] right-[calc(env(safe-area-inset-right)+12px)]">
    <HeaderButton id="photo-viewer-close" icon={icons.close} label={t("Close")} onclick={() => close("photo-viewer")} />
  </div>
</dialog>

<!-- Opens on today, ready to type a note; Add with none records a visit. -->
<dialog id="entry-dialog" aria-labelledby="entry-title" style:--c={color} class="[--accent:var(--c)]" oncancel={keepFormOpen}>
  <form id="entry-form" onsubmit={(event) => { event.preventDefault(); controls.addEntry(); }}>
    <DialogHeader id="entry-title" title={t("Add to history")} icon={icons.history}
      close={{ id: "entry-cancel", onclick: () => controls.cancelEntry() }} closeLabel={discarding ? t("Discard?") : t("Close")} closeArmed={discarding} />
    <label>{t("Date")}<input id="entry-date" type="date" required max={controls.today} bind:value={controls.entryDate} /></label>
    <label>{t("Note")}<textarea id="entry-text" maxlength="2000" rows="3" placeholder={t("Leave empty to log a visit")}
      bind:value={controls.entryText}></textarea></label>
    <Actions><Button type="submit" id="entry-add" icon={icons.check} label={t("Add")} /></Actions>
  </form>
</dialog>

<dialog id="scale-ask-dialog" aria-labelledby="scale-ask-title" class="[--accent:var(--neon-measure)]">
  <DialogHeader id="scale-ask-title" title={t("Set the map scale?")} icon={icons.scale} close={{ id: "scale-ask-close", onclick: () => close("scale-ask-dialog") }} />
  <p>{t("Distances need the map’s scale. Tap both ends of a known length, like the scale bar, then enter that length.")}</p>
  <Actions>
    <Button id="scale-ask-start" icon={icons.scale} label={t("Set scale")} onclick={() => controls.startScale()} />
    <Button id="scale-ask-later" variant="quiet" label={t("Not now")} onclick={() => close("scale-ask-dialog")} />
  </Actions>
</dialog>

<dialog id="scale-dialog" aria-labelledby="scale-title" class="[--accent:var(--neon-measure)]" oncancel={keepFormOpen}>
  <form id="scale-form" onsubmit={(event) => { event.preventDefault(); controls.saveScale(); }}>
    <DialogHeader id="scale-title" title={t("Distance between the points")} icon={icons.scale}
      close={{ id: "scale-cancel", onclick: () => close("scale-dialog") }} />
    <label>{t("Metres")}<input id="scale-metres" type="number" inputmode="decimal" min="0.1" max="100000" step="any" required enterkeyhint="done"
      bind:value={controls.scaleMetresValue} /></label>
    <Actions><Button type="submit" id="scale-save" icon={icons.check} label={t("Save")} disabled={!controls.scaleMetres} /></Actions>
  </form>
</dialog>

<dialog id="name-dialog" aria-labelledby="name-title" class="[--accent:var(--neon-saved)]" oncancel={keepFormOpen}>
  <form id="name-form" onsubmit={(event) => { event.preventDefault(); controls.saveName(); }}>
    <DialogHeader id="name-title" title={controls.nameTitle} icon={icons.edit} close={{ id: "name-cancel", onclick: () => close("name-dialog") }} />
    <label>{t("Name")}<input id="name-input" required maxlength="100" autocomplete="off" enterkeyhint="done" bind:value={controls.nameValue} /></label>
    <Actions><Button type="submit" icon={icons.check} label={t("Save")} /></Actions>
  </form>
</dialog>
