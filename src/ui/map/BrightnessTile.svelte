<script lang="ts">
  import { t } from "../../i18n";
  import { brightnessPercent } from "../../viewer/navigation";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";

  // A Brightness bar that fills from the left in the surrounding --c neon, in
  // five steps reading dim to bright. Each step is a native radio under its
  // fifth of the bar; sliding a finger along picks the step under it. `name`
  // prefixes the radios' ids.
  let { name, label, levels, value, disabled = false, onpick }: {
    name: string;
    label: string;
    /** Brightest first. */
    levels: readonly number[];
    value: number;
    disabled?: boolean;
    onpick: (level: number) => void;
  } = $props();

  const steps = $derived([...levels].reverse());
  const filled = $derived(Math.max(0, steps.findIndex((level) => level === value)) + 1);
  function slide(event: PointerEvent) {
    if (!event.buttons || disabled) return;
    const box = event.currentTarget instanceof HTMLElement && event.currentTarget.getBoundingClientRect();
    if (!box) return;
    const level = steps[Math.min(steps.length - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * steps.length)))];
    if (level !== undefined && level !== value) onpick(level);
  }
</script>

{#snippet text()}
  <Icon svg={icons.sun} /><span class="flex-1">{t("Brightness")}</span><span class="tabular-nums">{brightnessPercent(value)}%</span>
{/snippet}

<div onpointerdown={slide} onpointermove={slide} role="radiogroup" tabindex="-1" aria-label={label}
  class={["relative h-56 touch-pan-y overflow-hidden rounded-md bg-fill-strong transition-opacity duration-fast", disabled && "opacity-40"]}>
  <span aria-hidden="true" class="pointer-events-none absolute inset-0 flex items-center gap-10 px-20 text-body font-semibold text-text [&>svg]:size-20">
    {@render text()}</span>
  <!-- The fill holds the same words in black, as wide as the bar, so they turn black where it covers them. -->
  <span aria-hidden="true" style:width="{filled * 20}%"
    class="pointer-events-none absolute inset-y-0 left-0 overflow-hidden bg-c transition-[width] duration-fast">
    <span style:width="{500 / filled}%"
      class="absolute inset-y-0 left-0 flex items-center gap-10 px-20 text-body font-semibold text-black [&>svg]:size-20">{@render text()}</span>
  </span>
  <div class="absolute inset-0 grid grid-cols-5">
    {#each steps as level (level)}
      <input type="radio" {name} id="{name}-{brightnessPercent(level)}" value={level} checked={value === level} {disabled}
        aria-label="{brightnessPercent(level)}%" onchange={() => onpick(level)}
        class="m-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-default" />
    {/each}
  </div>
</div>
