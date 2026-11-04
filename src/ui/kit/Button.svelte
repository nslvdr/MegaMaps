<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ClassValue } from "svelte/elements";
  import Icon from "./Icon.svelte";
  type Variant = "primary" | "secondary" | "quiet" | "danger" | "quiet-danger";
  // The app's buttons: primary in the dialog's accent, danger in red, and
  // secondary or quiet as neutral fills. A danger armed for a second tap fills red.
  let {
    variant = "primary", icon, label, children, id, type = "button", disabled = false, hidden = false,
    armed = false, pressed, class: className = "", onclick,
  }: {
    variant?: Variant; icon?: string; label?: string; children?: Snippet; id?: string;
    type?: "button" | "submit"; disabled?: boolean; hidden?: boolean; armed?: boolean; pressed?: boolean;
    class?: ClassValue; onclick?: (event: MouseEvent) => void;
  } = $props();
</script>

<!-- data-variant says which kind it is, such as a danger that warns before replacing. -->
<button {id} {type} {disabled} {hidden} {onclick} aria-pressed={pressed} data-variant={variant}
  class={[buttonClass(variant, armed), className]}
>{#if icon}<Icon svg={icon} />{/if}{#if label !== undefined}<span>{label}</span>{/if}{@render children?.()}</button>

<script module lang="ts">
  export function buttonClass(variant: Variant, armed = false) {
    return [
      "inline-flex min-h-50 items-center justify-center gap-8 rounded-md border px-16 py-12 text-body font-strong [&>svg]:size-20",
      armed
        ? "border-danger bg-danger text-[#1a0703]"
        : {
            primary: "border-accent/45 tint-accent/14 text-accent enabled:active:tint-accent/24 enabled:hover:tint-accent/22",
            danger: "border-danger/45 tint-danger/14 text-danger enabled:active:tint-danger/24 enabled:hover:tint-danger/22",
            secondary: "border-line bg-white/7 text-text enabled:active:bg-white/12 enabled:hover:bg-white/10",
            quiet: "border-line bg-white/7 text-text enabled:active:bg-white/12 enabled:hover:bg-white/10",
            "quiet-danger": "border-danger/30 tint-danger/10 text-danger enabled:active:tint-danger/20 enabled:hover:tint-danger/16",
          }[variant],
    ];
  }
</script>
