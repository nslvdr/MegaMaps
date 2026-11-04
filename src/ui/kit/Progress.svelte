<script lang="ts">
  // A thin bar in the accent colour; without a value it sweeps, for work
  // that can't say how far along it is.
  let { id, value, labelledby, class: className = "" }:
    { id?: string; value?: number; labelledby: string; class?: string } = $props();
</script>

<div {id} role="progressbar" aria-labelledby={labelledby} aria-valuemin="0" aria-valuemax="100" aria-valuenow={value}
  class={["mt-20 mb-12 h-6 overflow-hidden rounded-pill tint-accent/16", className]}>
  <div class={["h-full bg-accent", value === undefined ? "w-[35%] animate-sweep" : "transition-[width] duration-fast"]}
    style:width={value === undefined ? undefined : `${value}%`}></div>
</div>
