<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Button from "../kit/Button.svelte";
  import Row from "../kit/Row.svelte";
  import Rows from "../kit/Rows.svelte";
  import type { ViewerControls } from "../viewer-controls.svelte";
  import { panelHeading } from "./styles";

  // Map setup, opened from the scale chip in the map's corner. Once done, it
  // reads the scale and north, with Set up again to change them. Otherwise:
  // where the scale stands, then the two ways to set it, best first. Matching
  // two spots on the streets sets the scale and orientation at once; otherwise
  // measure a known length, then place the map on the streets with one spot and turn it.
  let { controls, hidden }: { controls: ViewerControls; hidden: boolean } = $props();
  const view = $derived((controls.tick, controls.setupView()));
  const tone = "var(--neon-add)";
</script>

<div id="sheet-setup" {hidden}>
  {#if view.settings}
    <Rows id="setup-settings" class="mt-0!">
      <Row tag="div" icon={icons.scale} {tone} label={t("Scale")} hint={view.settings.source}
        value={view.settings.scale} valueId="setup-scale" />
      <Row tag="div" icon={icons.north} {tone} label={t("North")} hint={t("Placed on the streets")}
        value={view.settings.north} valueId="setup-north" />
    </Rows>
    <Button id="setup-again" variant="quiet" icon={icons.reset} label={t("Set up again")}
      onclick={() => controls.setUpAgain()} class="mt-16 w-full" />
  {:else}
    <p id="setup-status" class="mt-0 mb-16 text-body text-muted">{view.status}</p>
    <h3 class={panelHeading}>{t("Best")}</h3>
    <Rows class="mt-0!">
      <Row id="setup-two-spots" icon={view.lined ? icons.check : icons.pair} {tone} label={t("Match two spots on the streets")}
        hint={t("Sets the scale and orientation at once")} arrow onclick={() => controls.calibrate()} />
    </Rows>
    <h3 class={panelHeading}>{t("Or: scale, then place")}</h3>
    <Rows class="mt-0!">
      <Row id="setup-measure" icon={view.measured ? icons.check : icons.scale} {tone} label={t("1. Measure a known length")}
        hint={t("Like the scale bar on your map")} arrow onclick={() => controls.startScale()} />
      <Row id="setup-place" icon={view.placed ? icons.check : icons.map} {tone} label={t("2. Place it on the streets")}
        hint={view.measured || view.lined ? t("Match one spot, then turn it") : t("Measure first")}
        disabled={!view.measured && !view.lined} arrow onclick={() => controls.calibrate(true)} class="disabled:opacity-50" />
    </Rows>
  {/if}
</div>
