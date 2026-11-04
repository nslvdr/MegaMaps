<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import { popoverPosition } from "../popover-position";
  import type { ViewerControls } from "../viewer-controls.svelte";

  // A Saved section's menu: its order, picked once, and for places the kinds to
  // show, several at a time; each ticks what's chosen. It sits beside the panel,
  // outside its scrolling content, kept inside the panel's edges.
  let { controls }: { controls: ViewerControls } = $props();
  const WIDTH = 256;
  let menu: HTMLElement;
  const open = $derived(!!controls.menu && controls.rowMenu === controls.menu);
  const groups = $derived((controls.tick, controls.placeOrder, controls.routeOrder, controls.menu ? controls.menuGroups() : []));
  const label = $derived(controls.menu === "routes-order" ? t("Order routes") : t("Order and filter places"));

  // Placed once it's laid out, again after the panel has risen into place.
  $effect(() => {
    controls.settled;
    groups;
    if (!open || !controls.menu) return;
    const anchor = document.getElementById(controls.menu), sheet = document.getElementById("sheet");
    const origin = menu.offsetParent?.getBoundingClientRect();
    if (!anchor || !sheet || !origin) return;
    const bounds = sheet.getBoundingClientRect();
    menu.style.width = `${Math.max(0, Math.min(WIDTH, bounds.width - 16))}px`;
    const position = popoverPosition(anchor.getBoundingClientRect(), bounds, { width: WIDTH, height: menu.scrollHeight + 2 });
    menu.style.left = `${position.left - origin.left}px`;
    menu.style.top = `${position.top - origin.top}px`;
    menu.style.maxHeight = `${position.maxHeight}px`;
  });
</script>

<div bind:this={menu} id="saved-section-menu" role="menu" aria-label={label} data-menu hidden={!open}
  class="motion absolute z-5 w-216 origin-top-right overflow-y-auto overscroll-contain rounded-md border border-glass-line bg-panel p-8 shadow-popover
    [--enter-from:scale(0.92)]">
  {#each groups as group, index (group.label)}
    <div class={["px-12 py-4 text-small font-semibold text-muted", index > 0 && "mt-8 border-t border-line pt-12"]}>{group.label}</div>
    {#each group.items as item (item.label)}
      <button type="button" role={item.role} aria-checked={item.checked} onclick={item.action}
        class="relative flex min-h-46 w-full items-center gap-12 rounded-sm bg-transparent px-12 py-8 text-left text-body font-semibold
          hover:bg-fill-strong enabled:active:bg-fill-strong">
        <Icon svg={item.icon} class="size-20 shrink-0 text-muted [&.place-icon]:size-24" /><span>{item.label}</span>
        <Icon svg={icons.check} class={["ml-auto size-20 text-neon-saved", !item.checked && "invisible"].filter(Boolean).join(" ")} />
      </button>
    {/each}
  {/each}
</div>
