<script lang="ts">
  import type { Snippet } from "svelte";
  // A dialog's buttons: the main action first and full width, the rest sharing
  // the row beneath it; `row` keeps them all on one row.
  let { children, row = false, id, hidden = false, class: className = "" }:
    { children: Snippet; row?: boolean; id?: string; hidden?: boolean; class?: string } = $props();
</script>

<div {id} {hidden} class={["mt-20 flex gap-8 *:flex-1", row ? "flex-nowrap" : "flex-wrap *:first:basis-full", className]}>
  {@render children()}
</div>
