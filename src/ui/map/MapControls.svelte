<script lang="ts">
  import { t } from "../../i18n";
  import ActionSheet from "../ActionSheet.svelte";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import { rotationModes, toastIcons, type ViewerControls } from "../viewer-controls.svelte";
  import Dock from "./Dock.svelte";
  import MapDialogs from "./MapDialogs.svelte";
  import PlaceCard from "./PlaceCard.svelte";
  import SavedMenu from "./SavedMenu.svelte";
  import SearchBar from "./SearchBar.svelte";
  import Sheet from "./Sheet.svelte";
  import ToolCard from "./ToolCard.svelte";
  import TrailCards from "./TrailCards.svelte";

  // Everything over an open map. Top corners: Back on the left; Rotation and
  // View on the right. Bottom: the pill, which Search, a task's card or a panel
  // takes the place of. Pinch and drag move the map, so there are no zoom or pan buttons.
  let { controls }: { controls: ViewerControls } = $props();

  const rotation = $derived((controls.tick, rotationModes[controls.state.rotationMode]));
  const chip = (sheet: "rotation" | "display") => [
    "grid size-44 place-items-center rounded-full border border-glass-line bg-black p-0 text-c shadow-glass disabled:opacity-35",
    "enabled:hover:border-c/50 enabled:hover:tint-c/18 enabled:active:tint-c/22",
    controls.openSheet === sheet && "border-c! tint-c/22!",
  ];
  const editing = $derived(controls.tool !== "browse");
  // The ⋯ sheet's actions follow its row, so an armed Delete says so.
  const rowActions = $derived.by(() => {
    controls.tick;
    const shown = controls.rowSheet;
    if (!shown) return [];
    const { places, routes } = controls.savedRows();
    return [...places, ...routes, ...controls.tripRows()].find((row) => row.key === shown.key)?.actions ?? shown.actions;
  });
  const toastTone = {
    done: "[--c:var(--neon-add)]", quiet: "[--c:var(--muted)]", removed: "[--c:var(--danger)]", error: "[--c:var(--danger)]",
  };
  const toast = "motion m-0 flex min-h-44 max-w-full items-center gap-12 rounded-lg border border-c/70 bg-black py-8 pr-20 pl-16 text-body leading-snug shadow-glass [--enter-from:translateY(-8px)]";
</script>

<div id="display-chips" role="group" aria-label={t("Map view controls")} class="absolute top-(--hud-top) right-(--edge-r) z-5 flex gap-8">
  <button type="button" id="open-rotation" aria-label={t("Rotation: {mode}", { mode: rotation.label })} title={t("Rotation: {mode}", { mode: rotation.label })}
    aria-controls="sheet" aria-expanded={controls.openSheet === "rotation"} disabled={editing} onclick={() => controls.toggleSheet("rotation")}
    class={[chip("rotation"), "[--c:var(--neon-lock)]"]}><Icon svg={rotation.icon} class="size-22" /></button>
  <button type="button" id="open-display" aria-label={t("View settings")} title={t("View settings")} aria-controls="sheet"
    aria-expanded={controls.openSheet === "display"} disabled={editing} onclick={() => controls.toggleSheet("display")}
    class={[chip("display"), "[--c:var(--neon-view)]"]}><Icon svg={icons.sun} class="size-22" /></button>
</div>

<!-- Passing messages share one pill: a tone colors its icon and outline. On
     phones they sit just under the corner controls; once there's room between
     those, they line up in the controls' row. Text detection stays on top. -->
<div class="pointer-events-none absolute top-[calc(var(--hud-top)+56px)] left-1/2 z-6 flex w-max max-w-(--surface-width) -translate-x-1/2
  flex-col items-center gap-8 wide:top-(--hud-top) wide:max-w-[min(var(--surface-width),calc(100vw-2*(var(--edge-r)+164px)))]">
  <div id="ocr-progress" role="progressbar" aria-label={t("Finding text")} aria-valuemin="0" aria-valuemax="100"
    aria-valuenow={controls.ocrProgress?.percent} hidden={!controls.ocrProgress} class={[toast, "[--c:var(--neon-saved)]"]}>
    <Icon svg={icons.scanText} class="size-20 text-c" /><p class="m-0 text-balance">{t("Finding text")}</p>
    <span id="ocr-percent" class="min-w-[4ch] text-right font-strong whitespace-nowrap tabular-nums"
      >{controls.ocrProgress?.left ? `${controls.ocrProgress.percent}% · ${controls.ocrProgress.left}` : `${controls.ocrProgress?.percent ?? 0}%`}</span>
  </div>
  <div id="toast-bar" hidden={!controls.toast.shown} data-tone={controls.toast.tone}
    class={[toast, toastTone[controls.toast.tone], controls.toastUndo && "py-4! pr-4!"]}>
    <Icon svg={toastIcons[controls.toast.tone]} class="size-20 text-c" />
    <p id="toast" role="status" aria-live="polite" class="m-0 text-balance">{controls.toast.message}</p>
    <!-- After a delete the pill carries Undo, the one part of it you can tap. -->
    {#if controls.toastUndo}
      <button type="button" id="toast-undo" onclick={() => controls.undoToast()}
        class="pointer-events-auto relative inline-flex h-34 shrink-0 items-center gap-8 rounded-pill pr-16 pl-12 text-body font-strong text-neon-add
          tint-neon-add/14 hit-5 enabled:hover:tint-neon-add/22"><Icon svg={icons.undo} class="size-18" /><span>{t("Undo")}</span></button>
    {/if}
  </div>
</div>

<SearchBar {controls} />
<Dock {controls} />
<ToolCard {controls} />
<Sheet {controls} />
<SavedMenu {controls} />
<PlaceCard {controls} />
<TrailCards {controls} />
<MapDialogs {controls} />
{#if controls.rowSheet}
  {@const shown = controls.rowSheet}
  <ActionSheet open={controls.rowMenu === shown.key} title={shown.title} detail={shown.detail} icon={shown.icon} actions={rowActions}
    onclose={() => controls.rowSheetClosed(shown.key)} />
{/if}
