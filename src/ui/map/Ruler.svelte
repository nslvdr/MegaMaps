<script lang="ts">
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";

  // A value set on a ruler that slides under a fixed mark, for changes too fine
  // for a finger: a slow drag is exact, a quick one covers ground, and − and +
  // are the smallest step you can see. Steps count up as the ruler moves left.
  let { id, label, value, onstep, reset }: {
    id: string; label: string; value: string; onstep: (steps: number) => void; reset?: { label: string; onclick: () => void };
  } = $props();
  const NUDGE = 2;
  let offset = $state(0);
  let held: number | undefined;
  function drag(event: PointerEvent) {
    if (held === undefined) return;
    const moved = event.clientX - held;
    held = event.clientX;
    offset += moved;
    onstep(-moved * (1 + Math.abs(moved) / 2));
  }
  function nudge(steps: number) {
    offset -= steps * 5;
    onstep(steps);
  }
  const button = "grid size-44 flex-none place-items-center rounded-full border border-glass-line bg-fill p-0 enabled:active:tint-c/22";
</script>

<div class="mt-8">
  <p class="mt-0 mb-4 flex min-h-30 items-center gap-8 text-body font-semibold">
    <span class="flex-1">{label}</span>
    <span id="{id}-value" class="text-small font-normal text-muted tabular-nums">{value}</span>
    {#if reset}
      <button type="button" id="{id}-reset" aria-label={reset.label} title={reset.label} onclick={reset.onclick}
        class="relative grid size-30 flex-none place-items-center rounded-full bg-fill-strong p-0 text-muted hit-7 hover:text-text active:text-text"><Icon svg={icons.undo} class="size-16" /></button>
    {/if}
  </p>
  <div class="flex items-center gap-8">
    <button type="button" id="{id}-less" aria-label="{label} −" onclick={() => nudge(-NUDGE)} class={button}><Icon svg={icons.minus} class="size-20" /></button>
    <div {id} role="presentation" style:background-position-x="{offset}px"
      onpointerdown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); held = event.clientX; }}
      onpointermove={drag} onpointerup={() => (held = undefined)} onpointercancel={() => (held = undefined)}
      class="relative h-44 min-w-0 flex-1 touch-none overflow-hidden rounded-sm bg-fill
        bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.5)_0_1px,transparent_1px_50px),repeating-linear-gradient(90deg,rgb(255_255_255/0.22)_0_1px,transparent_1px_10px)]
        before:absolute before:inset-0 before:bg-[linear-gradient(90deg,#000,transparent_25%,transparent_75%,#000)]
        after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 after:bg-c"></div>
    <button type="button" id="{id}-more" aria-label="{label} +" onclick={() => nudge(NUDGE)} class={button}><Icon svg={icons.plus} class="size-20" /></button>
  </div>
</div>
