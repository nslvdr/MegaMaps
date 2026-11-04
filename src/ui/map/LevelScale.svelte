<script lang="ts">
  import { markerCalloutIcon } from "../icons";
  import type { LevelStep } from "../format";
  import Icon from "../kit/Icon.svelte";
  // "Water level" under its kind's symbol, above every step with its own symbol,
  // read-only: the place's own step is filled in its colour, the others stay muted.
  let { kind, field, steps, at }: { kind: "flooded" | "unstable"; field: string; steps: LevelStep[]; at: number } = $props();
</script>

<span class="flex items-center gap-8"><Icon svg={markerCalloutIcon(kind)} class="size-16" />{field}</span>
<span data-scale class="grid auto-cols-fr grid-flow-col gap-3 rounded-pill bg-fill p-3">
  {#each steps as step (step.level)}
    <span aria-current={step.level === at || undefined} style:--level={step.level === at ? step.color : undefined}
      class={["flex min-w-0 items-center justify-center gap-6 rounded-pill py-6 text-small whitespace-nowrap",
        step.level === at && "bg-level font-bold text-bg"]}><Icon svg={step.symbol} class="size-16 flex-none" />{step.label}</span>
  {/each}
</span>
