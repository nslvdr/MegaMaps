<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Actions from "../kit/Actions.svelte";
  import Button from "../kit/Button.svelte";
  import Icon from "../kit/Icon.svelte";
  import DialogHeader from "../kit/DialogHeader.svelte";
  import HeaderButton from "../kit/HeaderButton.svelte";
  import type { ViewerControls } from "../viewer-controls.svelte";
  import Ruler from "./Ruler.svelte";
  import { overMap } from "./styles";

  // Placing, drawing, measuring or moving swaps the pill for this card: the
  // panels' header (icon, title, X), a hint, and full-size actions. Measure and
  // the scale wear Measure's neon, as the line on the map does; Trail is red.
  let { controls }: { controls: ViewerControls } = $props();
  const tool = $derived((controls.tick, controls.confirming, controls.movingMark, controls.toolView()));
  const neon = $derived(controls.tool === "measure" || controls.tool === "scale" ? "[--c:var(--neon-measure)]"
    : controls.tool === "trail" ? "[--c:var(--neon-trail)]" : "[--c:var(--neon-add)]");
</script>

<section id="tool-bar" aria-labelledby="tool-title" hidden={controls.tool === "browse" || !!controls.openSheet} bind:offsetHeight={controls.toolHeight}
  class={[overMap, neon, "motion bottom-(--hud-bottom) z-5 rounded-lg border border-c/45 bg-black p-(--surface-padding) shadow-panel [--accent:var(--c)]",
    "[@media(max-height:520px)]:px-16 [@media(max-height:520px)]:py-12"]}>
  <DialogHeader id="tool-title" title={tool.title} icon={tool.icon} class="mb-8! [&_h2]:text-c"
    close={{ id: "tool-cancel", onclick: () => controls.cancelTool() }} closeLabel={tool.discarding ? t("Discard?") : t("Cancel")}
    closeArmed={tool.discarding}>
    {#snippet actions()}
      {#if tool.rename}<HeaderButton id="tool-rename" icon={icons.edit} label={tool.rename} onclick={() => controls.renameTool()} />{/if}
      {#if tool.undoSpot}<HeaderButton id="spot-undo" icon={icons.undo} label={t("Undo")} onclick={() => controls.undoSpot()} />{/if}
    {/snippet}
  </DialogHeader>
  <!-- Measuring, the big line is the total at one end and the walk at the other. -->
  {#if tool.distance}
    <p id="tool-total" class="mt-0 mb-4 flex flex-wrap justify-between gap-x-12 text-heading font-bold tabular-nums">
      <span id="tool-distance">{tool.distance}</span><span id="tool-time">{tool.walk}</span>
    </p>
  {/if}
  <p id="tool-message" role="status" class="m-0 text-body leading-normal text-muted">{tool.message}</p>
  <!-- Both ends down, the length is typed here, with the line still in view. -->
  {#if tool.scaleLength}
    <form id="scale-form" data-bar class="mt-12 flex items-center gap-12" onsubmit={(event) => { event.preventDefault(); controls.saveScale(); }}>
      <label for="scale-metres" class="text-body font-semibold">{t("Length")}</label>
      <span class="relative min-w-0 flex-1">
        <input id="scale-metres" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0"
          value={controls.scaleMetresShown} oninput={(event) => (controls.scaleMetresText = event.currentTarget.value)}
          class="min-h-50 w-full rounded-sm border border-line bg-black py-12 pr-40 pl-16 text-body text-text tabular-nums outline-none focus:border-c" />
        <span aria-hidden="true" class="pointer-events-none absolute top-1/2 right-14 -translate-y-1/2 text-body text-muted">m</span>
      </span>
    </form>
  {/if}
  {#if tool.rulers}
    <!-- Placing a measured map only turns it; its scale stays. -->
    {#if !controls.placing}
      <Ruler id="calibrate-scale" label={t("Scale")} value={tool.rulers.scale} onstep={(steps) => controls.adjustGeo("scale", steps)}
        reset={tool.rulers.measured ? { label: t("Back to the measured scale"), onclick: () => controls.resetScale() } : undefined} />
    {/if}
    <Ruler id="calibrate-rotation" label={t("Rotation")} value={tool.rulers.rotation} onstep={(steps) => controls.adjustGeo("rotation", steps)} />
  {/if}
  <!-- Matching spots: where to start on the streets. -->
  {#if tool.search}
    <form id="place-search" data-bar role="search" class="mt-12 flex gap-8"
      onsubmit={(event) => { event.preventDefault(); void controls.findPlace(); }}>
      <input id="place-query" type="search" aria-label={t("Town or street")} placeholder={t("Town or street")} maxlength="200" autocomplete="off"
        enterkeyhint="search" bind:value={controls.placeQuery} class="min-w-0 flex-1" />
      <button type="submit" aria-label={t("Search")} title={t("Search")}
        class="grid size-44 flex-none place-items-center self-center rounded-sm border border-line bg-black text-c"><Icon svg={icons.search} class="size-20" /></button>
    </form>
  {/if}
  <!-- Undo and Done share one row, Done on the thumb side. -->
  {#if tool.actions}
    <Actions row id="tool-actions" class="mt-16! [@media(max-height:520px)]:mt-8! [@media(max-height:520px)]:[&>button]:min-h-40">
      {#if tool.undo}<Button id="route-undo" variant="quiet" icon={icons.undo} label={t("Undo")} disabled={!tool.canUndo} onclick={() => controls.undo()} />{/if}
      {#if tool.useSliders}<Button id="use-rulers" variant="quiet" icon={icons.tools} label={t("Use rulers")} onclick={() => controls.useSliders()} />{/if}
      {#if tool.matchSpots}<Button id="match-spots" variant="quiet" icon={icons.pair} label={t("Match spots")} onclick={() => controls.matchSpots()} />{/if}
      {#if tool.done}<Button id="tool-done" icon={tool.doneIcon} label={tool.doneLabel}
        disabled={!tool.canFinish} onclick={() => controls.toolDone()} />{/if}
    </Actions>
  {/if}
</section>
