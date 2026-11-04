<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import type { ViewerControls } from "../viewer-controls.svelte";

  // Add: a place, placed with the next tap, or a route, drawn at once.
  let { controls, hidden }: { controls: ViewerControls; hidden: boolean } = $props();
  const choice = `flex min-h-88 min-w-0 flex-col items-center justify-center gap-8 rounded-md border border-k/35 text-body font-strong tint-k/6
    enabled:hover:border-k/55 enabled:hover:tint-k/12 enabled:active:tint-k/18 [@media(max-height:520px)]:min-h-64`;
</script>

<div id="sheet-add" {hidden} class="grid grid-cols-2 gap-12">
  <button type="button" id="add-marker" onclick={() => controls.mode("marker")} class={[choice, "[--k:var(--kind-place)]"]}
    ><Icon svg={icons.pin} class="size-26 text-k" /><span>{t("Place")}</span></button>
  <button type="button" id="add-route" onclick={() => controls.addRoute()} class={[choice, "[--k:var(--kind-route)]"]}
    ><Icon svg={icons.route} class="size-26 text-k" /><span>{t("Route")}</span></button>
</div>
