<script lang="ts">
  import type { Snippet } from "svelte";
  // A group of rows in one outlined card, each row ruled from the next.
  let { children, id, class: className = "", tag = "div", ...rest }:
    { children: Snippet; id?: string; class?: string; tag?: "div" | "ol" | "ul"; [key: string]: unknown } = $props();
</script>

<svelte:element this={tag} {id} {...rest}
  class={["mt-16 overflow-hidden rounded-md border border-line [&>*+*]:border-t [&>*+*]:border-line", className]}>
  {@render children()}
</svelte:element>
