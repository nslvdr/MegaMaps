<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import Switch from "../kit/Switch.svelte";
  import { BRIGHTNESS_LEVELS, brightnessPercent, layerNames } from "../../viewer/navigation";
  import type { ViewerControls } from "../viewer-controls.svelte";
  import { panelCard, panelHeading, panelRow, rowHint, rowIcon, rowText } from "./styles";

  // View settings: the map's look, then which layers show on it.
  let { controls, hidden }: { controls: ViewerControls; hidden: boolean } = $props();
  const view = $derived.by(() => {
    controls.tick;
    const state = controls.state;
    return { inverted: state.inverted, dimming: state.dimming, layers: { ...state.layers }, status: controls.darkStatus(),
      counts: { routes: state.routes.length, places: state.markers.length }, streets: controls.streetsView() };
  });
  const layers = {
    routes: { label: t("Routes"), icon: icons.route, neon: "[--c:var(--kind-route)]" },
    places: { label: t("Places"), icon: icons.pin, neon: "[--c:var(--kind-place)]" },
    labels: { label: t("Names"), icon: icons.text, neon: "[--c:var(--neon-saved)]" },
  };
  // Native radios and switches keep a full-size touch target under the tile.
  const fill = "absolute inset-0 m-0 size-full cursor-pointer opacity-0";
</script>

<div id="sheet-display" {hidden}>
  <h3 class={panelHeading}>{t("Map")}</h3>
  <div class={panelCard}>
    <label class={[panelRow, "cursor-pointer"]}>
      <span class={rowIcon}><Icon svg={icons.moon} /></span>
      <span class={rowText}><strong>{t("Dark map")}</strong><small id="dark-status" class={rowHint}>{view.status}</small></span>
      <Switch id="dark-map" checked={view.inverted} onchange={() => controls.setDark(!view.inverted)} />
    </label>
    <div class={[panelRow, "flex-wrap gap-y-8"]}>
      <span class={rowIcon}><Icon svg={icons.sun} /></span>
      <span class={rowText}><strong>{t("Brightness")}</strong><small id="brightness-help" class={rowHint}>{t("Dim the map so routes and places stand out.")}</small></span>
      <div role="radiogroup" aria-label={t("Map brightness")} aria-describedby="brightness-help" class="m-0 grid basis-full auto-cols-fr grid-flow-col gap-4">
        {#each BRIGHTNESS_LEVELS as level (level)}
          <label class="relative grid min-h-44 cursor-pointer place-items-center rounded-sm border border-glass-line bg-fill text-small font-semibold
            has-checked:border-c/40 has-checked:text-c has-checked:tint-c/12">
            <input type="radio" name="map-brightness" id="brightness-{brightnessPercent(level)}" value={level} checked={view.dimming === level}
              onchange={() => controls.setBrightness(level)} class={fill} /><span>{brightnessPercent(level)}%</span>
          </label>
        {/each}
      </div>
    </div>
  </div>
  <h3 class={panelHeading}>{t("Show on map")}</h3>
  <!-- A hidden layer reads as off at a glance: its name greys with its icon. -->
  <div role="group" aria-label={t("Show on map")} class="grid grid-cols-3 gap-8">
    {#each layerNames as layer (layer)}
      <label class={[layers[layer].neon, "relative flex min-h-62 min-w-0 cursor-pointer flex-col items-center justify-center gap-4 rounded-sm border",
        "border-glass-line bg-fill px-4 py-8 text-center text-small font-medium text-muted transition-colors duration-fast",
        "has-checked:border-c/40 has-checked:text-text has-checked:tint-c/5 has-checked:[&>svg]:text-c"]}>
        <input type="checkbox" role="switch" id="layer-{layer}" aria-label={layers[layer].label} checked={view.layers[layer]}
          onchange={(event) => controls.setLayer(layer, event.currentTarget.checked)} class={fill} />
        <Icon svg={layers[layer].icon} class="size-21" /><span>{layers[layer].label}</span>
        {#if layer !== "labels"}
          <small id="layer-{layer}-count" aria-hidden="true" class="pointer-events-none absolute top-5 right-8 text-small text-muted tabular-nums"
            >{view.counts[layer]}</small>
        {/if}
      </label>
    {/each}
  </div>
  <h3 class={panelHeading}>{t("Streets")}</h3>
  <div class={panelCard}>
    <div class={[panelRow, "flex-wrap gap-y-8"]}>
      <label class="contents cursor-pointer">
        <span class={rowIcon}><Icon svg={icons.map} /></span>
        <span class={rowText}><strong>{t("Streets on the map")}</strong><small id="streets-status" class={rowHint}>{view.streets.status}</small></span>
        <Switch id="streets" checked={view.streets.on} disabled={!view.streets.placed} onchange={() => controls.setStreets(!view.streets.on)} />
      </label>
      <button type="button" id="calibrate-streets" onclick={() => controls.calibrate()}
        class="min-h-44 basis-full cursor-pointer rounded-sm border border-c/40 text-small font-semibold text-c tint-c/12">{t("Calibrate")}</button>
    </div>
  </div>
</div>
