<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "../kit/Icon.svelte";
  // A list's heading: its icon in a tinted ring, like the header buttons, its
  // name, how many it holds, and any menu for it.
  let { id, icon, label, count, countId, color, first = false, children }: {
    id: string; icon: string; label: string; count: string; countId: string;
    /** The section's colour, which its list wears too. */
    color: string; first?: boolean; children?: Snippet;
  } = $props();
</script>

<h3 {id} style:--k={color} class={["mb-8 flex items-center gap-8 text-small font-semibold text-text", first ? "mt-0" : "mt-20"]}>
  <Icon svg={icon} class="size-28 rounded-full p-6 text-k tint-k/14 inset-ring inset-ring-k/45" /><span>{label}</span>
  <small id={countId} class="ml-auto text-k tabular-nums">{count}</small>
  {@render children?.()}
</h3>
