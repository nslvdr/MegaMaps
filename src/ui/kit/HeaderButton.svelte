<script lang="ts">
  import Icon from "./Icon.svelte";
  // Close, Edit, Share and Reset share one tinted, outlined circle the height of
  // the title beside it; the tap target grows to 44px. Armed, it fills red.
  let {
    id, icon, label, onclick, armed = false, hidden = false, disabled = false, expanded, controls, popup,
  }: {
    id?: string; icon: string; label: string; onclick?: (event: MouseEvent) => void; armed?: boolean; hidden?: boolean;
    disabled?: boolean; expanded?: boolean; controls?: string; popup?: "dialog" | "menu";
  } = $props();
</script>

<button type="button" {id} {hidden} {disabled} {onclick} aria-label={label} title={label}
  aria-expanded={expanded} aria-controls={controls} aria-haspopup={popup}
  class={[
    "relative grid size-28 flex-none place-items-center rounded-full p-6 [&>svg]:size-full",
    "after:absolute after:inset-x-[-4px] after:inset-y-[-8px]",
    armed
      ? "bg-danger text-[#1a0703] [--accent:var(--danger)]"
      : "tint-accent/14 text-accent inset-ring inset-ring-accent/45 enabled:active:tint-accent/24 enabled:hover:tint-accent/22 enabled:hover:inset-ring-accent/60",
  ]}><Icon svg={icon} /></button>
