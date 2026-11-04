<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Actions from "../kit/Actions.svelte";
  import Button from "../kit/Button.svelte";
  import DialogHeader from "../kit/DialogHeader.svelte";
  import HeaderButton from "../kit/HeaderButton.svelte";
  import type { ViewerControls } from "../viewer-controls.svelte";
  import { overMap } from "./styles";

  // Placing, drawing, measuring or moving swaps the pill for this card: the
  // panels' header (icon, title, X), a hint, and full-size actions. Measure and
  // the scale wear Measure's neon, as the line on the map does; Trail is red.
  let { controls }: { controls: ViewerControls } = $props();
  const tool = $derived((controls.tick, controls.confirming, controls.movingMark, controls.toolView()));
  const neon = $derived(controls.tool === "measure" || controls.tool === "scale" ? "[--c:var(--neon-measure)]"
    : controls.tool === "trail" ? "[--c:var(--neon-trail)]" : "[--c:var(--neon-add)]");
</script>

<section id="tool-bar" aria-labelledby="tool-title" hidden={controls.tool === "browse" || !!controls.openSheet}
  class={[overMap, neon, "motion bottom-(--hud-bottom) z-5 rounded-lg border border-c/45 bg-black p-(--surface-padding) shadow-panel [--accent:var(--c)]",
    "[@media(max-height:520px)]:px-16 [@media(max-height:520px)]:py-12"]}>
  <DialogHeader id="tool-title" title={tool.title} icon={tool.icon} class="mb-8! [&_h2]:text-c"
    close={{ id: "tool-cancel", onclick: () => controls.cancelTool() }} closeLabel={tool.discarding ? t("Discard?") : t("Cancel")}
    closeArmed={tool.discarding}>
    {#snippet actions()}
      {#if tool.rename}<HeaderButton id="tool-rename" icon={icons.edit} label={tool.rename} onclick={() => controls.renameTool()} />{/if}
    {/snippet}
  </DialogHeader>
  <!-- Measuring, the big line is the total at one end and the walk at the other. -->
  {#if tool.distance}
    <p id="tool-total" class="mt-0 mb-4 flex flex-wrap justify-between gap-x-12 text-heading font-bold tabular-nums">
      <span id="tool-distance">{tool.distance}</span><span id="tool-time">{tool.walk}</span>
    </p>
  {/if}
  <p id="tool-message" role="status" class="m-0 text-body leading-normal text-muted">{tool.message}</p>
  <!-- Undo and Done share one row, Done on the thumb side. -->
  {#if tool.actions}
    <Actions row id="tool-actions" class="mt-16! [@media(max-height:520px)]:mt-8! [@media(max-height:520px)]:[&>button]:min-h-40">
      {#if tool.undo}<Button id="route-undo" variant="quiet" icon={icons.undo} label={t("Undo")} disabled={!tool.canUndo} onclick={() => controls.undo()} />{/if}
      {#if tool.done}<Button id="tool-done" icon={tool.next ? icons.next : icons.check} label={tool.next ? t("Next") : t("Done")}
        disabled={!tool.canFinish} onclick={() => controls.toolDone()} />{/if}
    </Actions>
  {/if}
</section>
