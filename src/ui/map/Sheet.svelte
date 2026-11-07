<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import DialogHeader from "../kit/DialogHeader.svelte";
  import HeaderButton from "../kit/HeaderButton.svelte";
  import { rotationModes, sheets, type ViewerControls } from "../viewer-controls.svelte";
  import AddPanel from "./AddPanel.svelte";
  import DisplayPanel from "./DisplayPanel.svelte";
  import RotationPanel from "./RotationPanel.svelte";
  import SavedPanel from "./SavedPanel.svelte";
  import { overMap } from "./styles";
  import TrailPanel from "./TrailPanel.svelte";

  // Like a task's card, an open panel takes the pill's place, each tinted with
  // its control's neon. View and Rotation open below their corner buttons;
  // Saved, Trail and Add rise from the bottom. Leaving, it keeps its place and
  // colour as it goes.
  let { controls }: { controls: ViewerControls } = $props();
  type Panel = (typeof sheets)[number];
  const shown = $derived(controls.openSheet === "search" ? undefined : controls.openSheet);
  let last: Panel = "saved";
  const panel = $derived(shown ? (last = shown) : last);
  const looks: Record<Panel, { title: string; neon: string }> = {
    display: { title: t("View"), neon: "[--c:var(--neon-view)]" },
    rotation: { title: t("Rotation"), neon: "[--c:var(--neon-lock)]" },
    trail: { title: t("Trail"), neon: "[--c:var(--neon-trail)]" },
    saved: { title: t("Saved"), neon: "[--c:var(--neon-saved)]" },
    add: { title: t("Add"), neon: "[--c:var(--neon-add)]" },
  };
  const mode = $derived((controls.tick, controls.state.rotationMode));
  const icon = $derived(panel === "display" ? icons.sun : panel === "trail" ? icons.trail
    : panel === "rotation" ? rotationModes[mode].icon : panel === "add" ? icons.add : icons.saved);
  const top = $derived(panel === "display" || panel === "rotation");
  const link = $derived(controls.linkView());
  const started = $derived(panel === "trail" ? (controls.tick, controls.tripStarted()) : undefined);
</script>

{#snippet tripStart()}<p id="trip-started" class="mt-4 mb-0 text-small text-muted">{started}</p>{/snippet}

<button type="button" id="sheet-dismiss" aria-label={t("Close")} hidden={!shown} onclick={() => controls.sheet(undefined)}
  class="motion absolute inset-0 z-3 size-full bg-black/25 enabled:active:scale-100"></button>
<section id="sheet" aria-labelledby="sheet-title" hidden={!shown} data-panel={shown ?? ""}
  ontransitionend={(event) => controls.sheetSettled(event)}
  class={[overMap, looks[panel].neon, "motion z-4 flex flex-col rounded-lg border border-c/45 bg-black p-(--surface-padding) shadow-panel [--accent:var(--c)]",
    top
      ? "top-[calc(var(--hud-top)+52px)] bottom-auto max-h-[calc(100svh-var(--hud-top)-var(--hud-bottom)-52px)] pb-20"
      : "bottom-(--hud-bottom) max-h-[min(calc(100svh-var(--hud-top)-var(--hud-bottom)-8px),calc(640px+var(--dock-h)+8px))]"]}>
  <DialogHeader id="sheet-title" title={looks[panel].title} {icon} class="shrink-0 [&_h2]:text-c"
    subtitle={started ? tripStart : undefined} close={{ id: "close-sheet", onclick: () => controls.sheet(undefined) }}>
    {#snippet actions()}
      {#if panel === "trail" && controls.canLink}
        <!-- Green once there's an app answering. -->
        <span class={["contents", link?.connected && "[--accent:var(--neon-link)]"]}>
          <HeaderButton id="position-link" icon={icons.link} expanded={!!link} label={link ? t("Disconnect from sPDR") : t("Connect to sPDR")}
            onclick={() => controls.toggleLink()} />
        </span>
      {/if}
      {#if panel === "saved" && controls.onShare}
        <HeaderButton id="share-saved" icon={icons.share} label={t("Share map or selected items")} onclick={() => controls.onShare?.()} />
      {/if}
      <!-- Compass mode turns the map with the phone, so a reset would not hold. -->
      {#if panel === "rotation" && mode !== "compass"}
        <HeaderButton id="reset-rotation" icon={icons.undo} label={t("Reset rotation to 0°")} onclick={() => controls.straighten()} />
      {/if}
    {/snippet}
  </DialogHeader>
  <!-- Room inside the scroller so edge highlights aren't clipped; content stays put. -->
  <div id="sheet-content" onscroll={() => controls.closeRowMenu()} class="-mx-8 -mb-8 min-h-0 overflow-auto overscroll-contain px-8 pb-8">
    <DisplayPanel {controls} hidden={shown !== "display"} />
    <RotationPanel {controls} hidden={shown !== "rotation"} />
    <TrailPanel {controls} hidden={shown !== "trail"} />
    <SavedPanel {controls} hidden={shown !== "saved"} />
    <AddPanel {controls} hidden={shown !== "add"} />
  </div>
</section>
