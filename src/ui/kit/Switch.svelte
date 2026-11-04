<script lang="ts">
  // An on/off switch in the surrounding --c neon.
  let { id, checked = $bindable(false), disabled = false, label, onchange }:
    { id?: string; checked?: boolean; disabled?: boolean; label?: string; onchange?: () => void } = $props();
</script>

<input type="checkbox" role="switch" {id} {disabled} aria-label={label} bind:checked {onchange}
  class="relative m-0 h-28 w-46 shrink-0 cursor-pointer appearance-none rounded-pill bg-fill-strong transition-colors duration-fast
    before:absolute before:top-3 before:left-3 before:size-22 before:rounded-full before:bg-white before:transition-transform before:duration-fast
    checked:bg-c checked:before:translate-x-18 checked:before:bg-black disabled:opacity-40" />
