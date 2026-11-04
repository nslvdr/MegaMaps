<script lang="ts">
  import { withClass } from "./svg";
  // An icon's markup (a Lucide icon or a place's pin), sized and coloured by its classes.
  let { svg, class: className = "" }: { svg: string; class?: string } = $props();
</script>

{@html withClass(svg, className)}
